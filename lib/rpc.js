'use strict';

/**
 * The console API.
 *
 * Every channel the Electron preload bridge exposed is implemented here and
 * reached through POST /api/rpc { method, args }. The browser-side shim
 * (public/src/ui/js/lib/web-bridge.js) recreates `window.vault` on top of it,
 * so the original UI runs unchanged.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const { loadState, saveState, clearState, backendInfo, MemStore } = require('./storage');
const { hashPassword, verifyPassword, createCrypter, encryptBackup, decryptBackup } = require('./crypto');
const { deriveKey } = require('./storage');
const session = require('./session');
const { detectProviderFromPrefix, getProviderModelsUrl } = require('./provider-catalog');
const { testApiKey, fetchModelsForProvider } = require('./model-discovery');
const { createAnalytics } = require('./analytics');
const { ensureGatewayKey, allProviders, isGatewayOnline } = require('./gateway-runtime');
const { createLivenessChecker } = require('./gateway/liveness');
const cloudMemory = require('./cloud-memory');
const { matchProvider } = require('./gateway/providers');

const VERSION = require('../package.json').version;

// Keys the console can never read or write through store:get / store:set.
const PROTECTED_KEYS = new Set(['auth', 'authThrottle']);

// Channels that work without a session.
const PUBLIC_METHODS = new Set(['auth:getStatus', 'auth:verify', 'auth:setPassword', 'auth:logout', 'app:getVersion']);

function publicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http'))
    .split(',')[0]
    .trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return (process.env.MINE_PUBLIC_URL || proto + '://' + host).replace(/\/+$/, '');
}

function envPassword() {
  const p = process.env.MINE_ADMIN_PASSWORD;
  return p && p.length >= 8 ? p : null;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9._-]{3,32}$/.test(value);
}

function authInfo(state) {
  const auth = state.auth || {};
  return { hasPassword: !!(auth && auth.hash && auth.salt), auth };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return resolve({ ok: false, error: 'bad url' });
    }
    if (!/^https?:$/.test(parsed.protocol)) return resolve({ ok: false, error: 'bad url' });
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(parsed, { timeout: timeoutMs || 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => {
        data += c;
        if (data.length > 1e6) req.destroy();
      });
      res.on('end', () => {
        try {
          resolve({ ok: true, json: JSON.parse(data) });
        } catch (_) {
          resolve({ ok: false, error: 'parse failed' });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

function pingModel(state, modelId) {
  const keys = state.keys || [];
  const model = (state.fetchedModels || []).find((m) => m.id === modelId);
  if (!model) return Promise.resolve({ success: false, error: 'Model not found' });
  const providerId = model.provider || modelId.split('/')[0];
  const key = keys.find(
    (k) => (k.provider || k.providerId) === providerId && k.enabled !== false && k.status !== 'DEAD' && k.key
  );
  if (!key) return Promise.resolve({ success: false, error: 'No active key for provider' });

  const prov = allProviders(state).find((p) => p.id === providerId);
  let baseUrl = prov ? prov.url || prov.baseUrl || '' : '';
  if (!baseUrl) {
    baseUrl = getProviderModelsUrl(providerId, state.customProviders, state.providers) || '';
    if (baseUrl.endsWith('/models')) baseUrl = baseUrl.slice(0, -'/models'.length);
  }
  if (!baseUrl) return Promise.resolve({ success: false, error: 'No base URL' });
  const b = baseUrl.replace(/\/+$/, '');
  const chatUrl = /\/v\d+[a-z]*$/.test(b) || /\/openai$/.test(b) ? b + '/chat/completions' : b + '/v1/chat/completions';

  const parsed = new URL(chatUrl);
  const mod = parsed.protocol === 'https:' ? https : http;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key.key };
  if (providerId === 'anthropic') {
    headers['x-api-key'] = key.key;
    headers['anthropic-version'] = '2023-06-01';
  }
  const body = JSON.stringify({
    model: model.rawId,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
  });
  const start = Date.now();
  return new Promise((resolve) => {
    const req = mod.request(parsed, { method: 'POST', headers, timeout: 20000 }, (res) => {
      res.resume();
      res.on('end', () => {
        const latency = Date.now() - start;
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ success: true, status: res.statusCode, latency });
        else resolve({ success: false, status: res.statusCode, latency, error: 'HTTP ' + res.statusCode });
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message, latency: Date.now() - start }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'timeout', latency: Date.now() - start });
    });
    req.write(body);
    req.end();
  });
}

/**
 * Throttle password guesses across all clients: after 5 failures, each
 * further attempt must wait (30s, doubling, max 15 min).
 */
function throttleCheck(state) {
  const t = state.authThrottle || {};
  if (t.until && t.until > Date.now()) {
    return Math.ceil((t.until - Date.now()) / 1000);
  }
  return 0;
}
function throttleFail(state) {
  const t = state.authThrottle || { fails: 0 };
  t.fails = (t.fails || 0) + 1;
  if (t.fails >= 5) {
    const wait = Math.min(15 * 60, 30 * Math.pow(2, t.fails - 5));
    t.until = Date.now() + wait * 1000;
  }
  state.authThrottle = t;
}

/**
 * Dispatch one call. Returns { result, save, setCookie, clearCookie }.
 */
async function dispatch(method, args, ctx) {
  const { req, state } = ctx;
  const store = new MemStore(state);
  const crypter = createCrypter(deriveKey('user-crypto'));
  const r = (result) => ({ result, save: store.dirty });
  const a = Array.isArray(args) ? args : [];

  switch (method) {
    // ── Auth ────────────────────────────────────────────────────────────────
    case 'auth:getStatus': {
      const { hasPassword } = authInfo(state);
      const needsSetup = !hasPassword && !envPassword();
      return r({
        enabled: true,
        hasPassword: hasPassword || !!envPassword(),
        needsSetup,
        username: (state.auth && state.auth.username) || process.env.MINE_ADMIN_USERNAME || 'admin',
        authenticated: ctx.authenticated,
        hosted: true,
        storage: backendInfo(),
      });
    }

    case 'auth:verify': {
      const wait = throttleCheck(state);
      if (wait) return { result: { success: false, error: 'Too many attempts. Try again in ' + wait + 's.', retryAfter: wait } };
      const credentials = a[0] && typeof a[0] === 'object' ? a[0] : { username: 'admin', password: a[0] };
      const username = normalizeUsername(credentials.username);
      const password = String(credentials.password || '');
      let { hasPassword, auth } = authInfo(state);
      const expectedUsername = normalizeUsername((auth && auth.username) || process.env.MINE_ADMIN_USERNAME || 'admin');
      if (!validUsername(username) || username !== expectedUsername) {
        throttleFail(state);
        return { result: { success: false, error: 'Incorrect username or password' }, save: true };
      }
      if (!hasPassword) {
        const envPw = envPassword();
        if (!envPw) return r({ success: false, needsSetup: true, error: 'Create a console account first.' });
        if (password !== envPw) {
          throttleFail(state);
          return { result: { success: false, error: 'Incorrect password' }, save: true };
        }
        // Adopt the env password as the stored hash.
        const { hash, salt } = hashPassword(envPw);
        state.auth = { enabled: true, username, hash, salt };
        auth = state.auth;
        state.authThrottle = { fails: 0 };
        return { result: { success: true }, save: true, setCookie: session.issue(salt) };
      }
      if (!verifyPassword(password, auth.hash, auth.salt)) {
        throttleFail(state);
        return { result: { success: false, error: 'Incorrect username or password' }, save: true };
      }
      // Migrate existing password-only accounts without changing their password.
      const needsUsernameMigration = !auth.username;
      if (needsUsernameMigration) {
        state.auth = { ...auth, username: 'admin' };
        auth = state.auth;
      }
      const hadFails = state.authThrottle && state.authThrottle.fails;
      state.authThrottle = { fails: 0 };
      return { result: { success: true }, save: !!hadFails || needsUsernameMigration, setCookie: session.issue(auth.salt) };
    }

    case 'auth:setPassword': {
      const { username: requestedUsername, newPassword, currentPassword } = a[0] || {};
      const { hasPassword, auth } = authInfo(state);
      const username = normalizeUsername(requestedUsername || (auth && auth.username) || process.env.MINE_ADMIN_USERNAME || 'admin');
      if (!validUsername(username)) return r({ success: false, error: 'Username must be 3–32 characters: letters, numbers, dots, underscores, or hyphens.' });
      if (!hasPassword && !requestedUsername && !envPassword()) return r({ success: false, error: 'Choose a username.' });
      if (hasPassword) {
        if (!ctx.authenticated) return r({ success: false, error: 'Sign in first' });
        if (!verifyPassword(String(currentPassword || ''), auth.hash, auth.salt)) {
          return r({ success: false, error: 'Incorrect current password' });
        }
      } else if (envPassword()) {
        if (String(currentPassword || '') !== envPassword() && !ctx.authenticated) {
          return r({ success: false, error: 'Sign in with MINE_ADMIN_PASSWORD first' });
        }
      }
      if (!newPassword && hasPassword) {
        if (username === normalizeUsername(auth.username || 'admin')) {
          return r({ success: false, error: 'Enter a new password or change your username.' });
        }
        state.auth = { ...auth, username };
        return { result: { success: true }, save: true, setCookie: session.issue(auth.salt) };
      }
      if (!newPassword || String(newPassword).length < 8) {
        return r({ success: false, error: 'Password must be at least 8 characters' });
      }
      const { hash, salt } = hashPassword(String(newPassword));
      state.auth = { enabled: true, username, hash, salt };
      state.authThrottle = { fails: 0 };
      return { result: { success: true }, save: true, setCookie: session.issue(salt) };
    }

    case 'auth:disable':
      return r({
        success: false,
        error: 'A hosted console is reachable from the internet, so its password cannot be turned off. Change it instead.',
      });

    case 'auth:logout':
      return { result: { success: true }, clearCookie: true };

    case 'app:getVersion':
      return r({ version: VERSION });

    // ── Store ───────────────────────────────────────────────────────────────
    case 'store:get': {
      const key = String(a[0] || '');
      if (PROTECTED_KEYS.has(key)) return r(a[1]);
      if (key === 'keys') {
        const keys = store.get('keys', []);
        let changed = false;
        for (const k of keys) {
          if (k && k.enabled === undefined) {
            k.enabled = true;
            changed = true;
          }
        }
        if (changed) store.set('keys', keys);
        return r(keys);
      }
      if (key === 'settings') {
        if (ensureGatewayKey(state)) store.dirty = true;
        const { gatewayApiKey, ...rest } = store.get('settings', {});
        return r({ ...rest, gatewayOnline: isGatewayOnline(state) });
      }
      const v = store.get(key, a[1]);
      return r(v === undefined ? null : v);
    }

    case 'store:set': {
      const key = String(a[0] || '');
      if (PROTECTED_KEYS.has(key)) return r(false);
      let value = a[1];
      if (key === 'settings') {
        const prev = store.get('settings', {});
        value = { ...(value || {}) };
        // Server-owned fields survive a console save.
        for (const f of ['gatewayApiKey', 'gatewayOnline', 'gatewayStartedAt', 'gatewayTotals']) {
          if (prev[f] !== undefined) value[f] = prev[f];
          else delete value[f];
        }
      }
      store.set(key, value);
      return r(true);
    }

    case 'store:delete': {
      const key = String(a[0] || '');
      if (PROTECTED_KEYS.has(key)) return r(false);
      store.delete(key);
      return r(true);
    }

    case 'store:clear':
    case 'store:reset': {
      // The password and gateway key survive a reset so the hosted console
      // never becomes claimable by a stranger.
      const keep = { auth: state.auth, settings: { gatewayApiKey: (state.settings || {}).gatewayApiKey } };
      store.clear();
      Object.assign(state, keep);
      return { result: method === 'store:reset' ? { success: true } : true, save: true };
    }

    case 'store:getAll': {
      const { auth, authThrottle, ...rest } = state;
      const settings = { ...(rest.settings || {}) };
      delete settings.gatewayApiKey;
      return r({ ...rest, settings });
    }

    case 'store:getStorageMetrics': {
      const size = Buffer.byteLength(JSON.stringify(state));
      const info = backendInfo();
      return r({
        success: true,
        sizeBytes: size,
        sizeMB: Math.round((size / (1024 * 1024)) * 1000) / 1000,
        dataDir: info.name,
        directory: info.name,
        path: info.name,
        count: 1,
        backend: info.name,
        durable: info.durable,
      });
    }

    case 'store:cleanStorage': {
      const type = a[0];
      if (type === 'dataReset') {
        const keep = { auth: state.auth, settings: { gatewayApiKey: (state.settings || {}).gatewayApiKey } };
        store.clear();
        Object.assign(state, keep);
        return { result: { success: true, message: 'All data cleared.' }, save: true };
      }
      if (type === 'trafficLogs') {
        store.set('usageHistory', []);
        store.set('requestLogs', []);
        store.set('analytics', undefined);
        delete state.analytics;
        return r({ success: true, message: 'Traffic logs cleared.' });
      }
      if (type === 'chatHistory') {
        store.set('chatConversations', []);
        return r({ success: true, message: 'Chat history cleared.' });
      }
      if (type === 'cache') {
        store.set('fetchedModels', []);
        return r({ success: true, message: 'Model cache cleared.' });
      }
      return r({ success: false, error: 'Unknown cleanup type' });
    }

    case 'analytics:get':
      return r(createAnalytics(store).read());

    case 'time:fetch': {
      const url = a[0] || 'https://worldtimeapi.org/api/timezone/Etc/UTC';
      const res = await fetchJson(url, 8000);
      if (!res.ok) return r({ success: false, error: res.error });
      const unix = res.json.unixtime || res.json.datetime || res.json.dateTime;
      let ms;
      if (typeof unix === 'number') ms = unix * 1000;
      else if (typeof unix === 'string') ms = new Date(unix).getTime();
      else ms = Date.now();
      return r({ success: true, offset: ms - Date.now(), server: url });
    }

    // ── Gateway ─────────────────────────────────────────────────────────────
    case 'gateway:start': {
      ensureGatewayKey(state);
      state.settings.gatewayOnline = true;
      state.settings.gatewayStartedAt = Date.now();
      const origin = new URL(publicOrigin(ctx.req));
      return {
        result: {
          success: true,
          host: origin.host,
          port: origin.port || (origin.protocol === 'https:' ? 443 : 80),
          url: publicOrigin(ctx.req) + '/v1',
        },
        save: true,
      };
    }

    case 'gateway:stop': {
      state.settings = state.settings || {};
      state.settings.gatewayOnline = false;
      state.settings.gatewayStartedAt = null;
      return { result: { success: true }, save: true };
    }

    case 'gateway:status': {
      const running = isGatewayOnline(state);
      const keys = state.keys || [];
      const origin = new URL(publicOrigin(ctx.req));
      const totals = (state.settings && state.settings.gatewayTotals) || {};
      return r({
        running,
        host: origin.host,
        port: origin.port || 443,
        stats: {
          uptime:
            running && state.settings && state.settings.gatewayStartedAt
              ? Math.floor((Date.now() - state.settings.gatewayStartedAt) / 1000)
              : 0,
          totalRequests: totals.requests || 0,
          totalTokens: totals.tokens || 0,
          keys: {
            total: keys.length,
            active: keys.filter((k) => k.enabled !== false && (k.status === 'ACTIVE' || !k.status)).length,
            cooldown: keys.filter((k) => k.status === 'COOLDOWN').length,
            dead: keys.filter((k) => k.status === 'DEAD').length,
            creditEmpty: keys.filter((k) => k.status === 'CREDIT_EMPTY').length,
          },
          providers: allProviders(state).length,
          models: (state.fetchedModels || []).length,
        },
      });
    }

    case 'gateway:diagnostics': {
      const providers = allProviders(state);
      const keys = state.keys || [];
      const models = state.fetchedModels || [];
      const liveness = state.modelLiveness || {};
      const teams = state.teams || [];
      const providerDiagnostics = providers.map((provider) => {
        const providerKeys = keys.filter((key) => matchProvider(key.providerId || key.provider, provider.id));
        const providerModels = models.filter((model) => matchProvider(model.providerId || model.provider || String(model.id || '').split('/')[0], provider.id));
        const enabledKeys = providerKeys.filter((key) => key.enabled !== false);
        return {
          id: provider.id,
          name: provider.name || provider.id,
          baseUrlConfigured: !!(provider.url || provider.baseUrl || provider.base_url),
          keys: {
            total: providerKeys.length,
            enabled: enabledKeys.length,
            active: enabledKeys.filter((key) => !['DEAD', 'CREDIT_EMPTY', 'COOLDOWN'].includes(key.status)).length,
            cooldown: enabledKeys.filter((key) => key.status === 'COOLDOWN').length,
            dead: enabledKeys.filter((key) => key.status === 'DEAD').length,
            creditEmpty: enabledKeys.filter((key) => key.status === 'CREDIT_EMPTY').length,
            disabled: providerKeys.length - enabledKeys.length,
          },
          models: providerModels.length,
          status: !enabledKeys.length ? 'missing_key' : enabledKeys.some((key) => !['DEAD', 'CREDIT_EMPTY', 'COOLDOWN'].includes(key.status)) ? 'configured' : 'keys_unavailable',
        };
      });
      const agents = teams.flatMap((team) => (team.nodes || [])
        .filter((node) => ['planner', 'worker', 'synthesizer', 'agent'].includes(node.type))
        .map((node) => {
          const health = node.model ? liveness[node.model] : null;
          return {
            team: team.slug || team.id,
            id: node.id,
            type: node.type,
            specialty: node.specialty || null,
            model: node.model || null,
            modelAssigned: !!node.model,
            modelHealth: health ? health.status : 'unknown',
            lastCheckedAt: health ? health.checkedAt || null : null,
          };
        }));
      return r({
        checkedAt: new Date().toISOString(),
        gateway: { online: isGatewayOnline(state) },
        providers: providerDiagnostics,
        agents,
        mcp: {
          inboundServer: {
            available: true,
            endpoint: publicOrigin(ctx.req) + '/api/mcp',
            tools: ['memory.list', 'memory.search', 'memory.read', 'memory.write', 'memory.update', 'memory.delete'],
          },
          outboundClient: {
            available: true,
            transport: 'Streamable HTTP over HTTPS',
            security: 'Public-address DNS validation, pinned IP requests, bounded responses and per-node permissions',
            limitation: 'Local stdio presets require an external MCP host; configure a public HTTPS endpoint in a Custom MCP node.',
          },
        },
        tools: {
          builtIn: {
            available: true,
            names: ['calculator', 'memory.list', 'memory.search', 'memory.read', 'memory.write', 'sandbox_run_command', 'sandbox_read_file', 'sandbox_write_file'],
            maxCallsPerDelegate: 8,
          },
          workspace: {
            available: !!process.env.VERCEL,
            runtime: 'Vercel Sandbox',
            isolation: 'One ephemeral sandbox per worker delegate; network access denied by default; 30-second command timeout; 64 KB file limit.',
            persistence: 'Temporary per-delegate workspace. Artifacts must be returned in the worker result or saved through an explicitly configured storage tool.',
          },
          cloudMemory: {
            available: true,
            operations: ['memory.list', 'memory.search', 'memory.read', 'memory.write'],
          },
        },
        providerQuota: {
          available: false,
          reason: 'Generic provider quota and remaining-credit data are not exposed by the current gateway API.',
        },
      });
    }

    case 'gateway:clientConfig': {
      const created = ensureGatewayKey(state);
      const base = publicOrigin(ctx.req);
      return {
        result: {
          baseUrl: base + '/v1',
          modelsUrl: base + '/v1/models',
          healthUrl: base + '/health',
          apiKey: '',
          requiresApiKey: true,
          hosted: true,
        },
        save: created,
      };
    }

    case 'gateway:copyKey':
    case 'gateway:revealKey': {
      const created = ensureGatewayKey(state);
      return { result: { success: true, key: state.settings.gatewayApiKey }, save: created };
    }

    case 'gateway:rotateKey': {
      state.settings = state.settings || {};
      state.settings.gatewayApiKey = 'sk-mine-' + crypto.randomBytes(24).toString('hex');
      return { result: { success: true, key: state.settings.gatewayApiKey }, save: true };
    }

    case 'gateway:syncConfig': {
      const cfg = a[0] || {};
      if (Array.isArray(cfg.modelQueue)) store.set('modelQueue', cfg.modelQueue);
      // keys / settings / teams are saved through store:set by the console;
      // the hosted gateway reads them fresh on every request.
      return r(true);
    }

    case 'gateway:poll': {
      const since = a[0] || null;
      const logs = state.requestLogs || [];
      return r({
        running: isGatewayOnline(state),
        logs: since ? logs.filter((l) => l.timestamp > since) : logs,
        allLogsCount: logs.length,
        analytics: createAnalytics(store).read(),
        keys: (state.keys || []).map((k) => ({
          id: k.id,
          status: k.status,
          lastError: k.lastError,
          usageToday: k.usageToday,
          usageTotal: k.usageTotal,
          totalTokens: k.totalTokens,
          lastLatency: k.lastLatency,
          lastUsed: k.lastUsed,
          cooldownUntil: k.cooldownUntil,
          errors: k.errors,
        })),
        activeKey: state.lastActiveKey || null,
      });
    }

    case 'gateway:testKey': {
      const keyObj = a[0] || {};
      return r(await testApiKey(keyObj.key, keyObj.provider, state.customProviders || [], state.providers || []));
    }

    case 'gateway:testAllKeys': {
      const keys = (state.keys || []).filter((k) => k.enabled !== false);
      const results = await pool(keys, 8, async (keyObj) => ({
        keyId: keyObj.id,
        result: await testApiKey(keyObj.key, keyObj.provider, state.customProviders || [], state.providers || []),
      }));
      return r(results);
    }

    // ── Keys ────────────────────────────────────────────────────────────────
    case 'key:add': {
      const customProviders = store.get('customProviders', []);
      const existing = store.get('keys', []);
      const toAdd = Array.isArray(a[0]) ? a[0] : [a[0]];
      const added = [];
      for (const entry of toAdd) {
        if (!entry) continue;
        const key = String(typeof entry === 'string' ? entry : entry.key || '').trim();
        if (!key) continue;
        if (existing.some((k) => k.key === key)) continue; // no duplicates
        const provider =
          (typeof entry === 'object' && entry.provider) || detectProviderFromPrefix(key, customProviders) || 'unknown';
        const existingCount = existing.filter((k) => (k.provider || k.providerId) === provider).length;
        const label =
          (typeof entry === 'object' && entry.label) || provider.toUpperCase() + ' Key ' + (existingCount + 1);
        const keyObj = {
          id: crypto.randomUUID(),
          key,
          provider,
          providerId: provider,
          label,
          status: 'ACTIVE',
          usageToday: 0,
          usageTotal: 0,
          totalTokens: 0,
          lastLatency: 0,
          lastUsed: null,
          addedAt: new Date().toISOString(),
          enabled: true,
        };
        existing.push(keyObj);
        added.push(keyObj);
      }
      store.set('keys', existing);
      return r(added);
    }

    case 'key:replace': {
      const id = String(a[0] || '');
      const replacementKey = String(a[1] || '').trim();
      if (!id) return r({ success: false, error: 'API key id is required' });
      if (!replacementKey) return r({ success: false, error: 'Enter a replacement API key' });
      const keys = store.get('keys', []);
      const idx = keys.findIndex((k) => k.id === id);
      if (idx === -1) return r({ success: false, error: 'API key not found' });
      if (keys.some((k, i) => i !== idx && k.key === replacementKey)) return r({ success: false, error: 'This API key is already saved' });
      // Preserve provider, id, label, enabled state, and usage history.
      keys[idx] = { ...keys[idx], key: replacementKey, status: 'ACTIVE', lastError: null, lastLatency: 0, cooldownUntil: null, errors: 0 };
      store.set('keys', keys);
      return r({ success: true, key: keys[idx] });
    }

    case 'key:setEnabled': {
      const keys = store.get('keys', []);
      const idx = keys.findIndex((k) => k.id === a[0]);
      if (idx === -1) return r({ success: false, error: 'API key not found' });
      keys[idx] = { ...keys[idx], enabled: a[1] !== false };
      store.set('keys', keys);
      return r({ success: true, key: keys[idx] });
    }

    case 'key:remove': {
      const filtered = store.get('keys', []).filter((k) => k.id !== a[0]);
      store.set('keys', filtered);
      return r({ success: true, remaining: filtered.length });
    }

    case 'key:prune': {
      const keys = store.get('keys', []);
      const alive = keys.filter((k) => k.status !== 'DEAD');
      store.set('keys', alive);
      return r({ success: true, pruned: keys.length - alive.length, remaining: alive.length });
    }

    // ── Crypto ──────────────────────────────────────────────────────────────
    case 'crypto:encrypt':
      try {
        return r({ success: true, data: crypter.encrypt(a[0]) });
      } catch (e) {
        return r({ success: false, error: e.message });
      }
    case 'crypto:decrypt':
      try {
        return r({ success: true, data: crypter.decrypt(a[0]) });
      } catch (e) {
        return r({ success: false, error: e.message });
      }
    case 'crypto:encryptBackup': {
      const { text, password } = a[0] || {};
      if (!text || !password) return r({ success: false, error: 'Missing backup text or password' });
      return r({ success: true, data: encryptBackup(text, password) });
    }
    case 'crypto:decryptBackup': {
      const { bundle, password } = a[0] || {};
      if (!bundle || !password) return r({ success: false, error: 'Missing backup bundle or password' });
      return r(decryptBackup(bundle, password));
    }

    // ── Providers ───────────────────────────────────────────────────────────
    case 'providers:getCustom':
      return r(store.get('customProviders', []));

    case 'providers:configureCloudflare': {
      const accountId = String((a[0] && a[0].accountId) || '').trim();
      if (!/^[a-f0-9]{32}$/i.test(accountId)) {
        return r({ success: false, error: 'Cloudflare Account ID must be exactly 32 hexadecimal characters' });
      }
      const providers = store.get('providers', []);
      const entry = {
        id: 'cloudflare-workers-ai',
        name: 'Cloudflare Workers AI',
        accountId,
        url: 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/ai/v1',
      };
      const idx = providers.findIndex((p) => p && p.id === entry.id);
      if (idx >= 0) providers[idx] = { ...providers[idx], ...entry };
      else providers.push(entry);
      store.set('providers', providers);
      return r({ success: true, provider: entry });
    }

    case 'providers:addCustom':
    case 'providers:update': {
      const provider = a[0] || {};
      if (!provider.id) return r({ success: false, error: 'Provider id required' });
      const customs = store.get('customProviders', []);
      const idx = customs.findIndex((p) => p.id === provider.id);
      if (idx >= 0) customs[idx] = { ...customs[idx], ...provider };
      else customs.push(provider);
      store.set('customProviders', customs);
      if (method === 'providers:addCustom') return r(customs);
      return r({
        success: true,
        provider,
        customProviders: customs,
        providers: [...(store.get('providers', []) || []), ...customs],
      });
    }

    case 'providers:removeCustom': {
      const customs = store.get('customProviders', []).filter((p) => p.id !== a[0]);
      store.set('customProviders', customs);
      return r(customs);
    }

    // ── Models ──────────────────────────────────────────────────────────────
    case 'models:fetchFromKeys': {
      const keys = store.get('keys', []);
      const customProviders = store.get('customProviders', []);
      const storedProviders = store.get('providers', []);
      const activeKeys = keys.filter((k) => k.enabled !== false && k.status !== 'DEAD' && k.key);
      if (!activeKeys.length) {
        return r({
          success: false,
          error: 'No active API keys found. Please add an API key first.',
          models: [],
          count: 0,
          results: [],
          errors: [],
        });
      }
      const byProvider = new Map();
      for (const key of activeKeys) {
        const pid = key.provider || key.providerId;
        if (!pid) continue;
        if (!byProvider.has(pid)) byProvider.set(pid, []);
        byProvider.get(pid).push(key);
      }

      const providerResults = await pool([...byProvider.entries()], 8, async ([providerId, providerKeys]) => {
        let last = { success: false, provider: providerId, models: [], error: 'No models endpoint' };
        // One working key per provider is enough to list its models.
        for (const key of providerKeys.slice(0, 3)) {
          const result = await fetchModelsForProvider(key.key, providerId, customProviders, key.id, storedProviders);
          last = result;
          if (result.success && result.models.length) return result;
        }
        return last;
      });

      // Model discovery is a manual refresh, not a live-only list. Replace
      // the cache only for providers that returned a complete, non-empty list.
      // Keep every other provider's last-known models when its key/API is down.
      const cached = store.get('fetchedModels', []);
      const cacheById = new Map((Array.isArray(cached) ? cached : []).filter((m) => m && m.id).map((m) => [m.id, m]));
      const successfulProviders = new Set();
      const results = [];
      const failed = [];
      const now = new Date().toISOString();

      for (const res of providerResults) {
        if (res.success && Array.isArray(res.models) && res.models.length) {
          successfulProviders.add(res.provider);
          results.push({ ...res, models: undefined });
          for (const [cachedId, cachedModel] of cacheById.entries()) {
            if (cachedModel.provider === res.provider) cacheById.delete(cachedId);
          }
          for (const model of res.models) {
            const previous = cacheById.get(model.id);
            cacheById.set(model.id, {
              ...(previous || {}),
              ...model,
              discoveredAt: previous && previous.discoveredAt ? previous.discoveredAt : now,
              lastSeenAt: now,
            });
          }
        } else {
          failed.push(res);
        }
      }

      // A successful refresh replaces that provider's list (so removed models
      // disappear); a failed or unscanned provider retains its previous cache.
      const refreshed = [...cacheById.values()].filter((model) => {
        return !successfulProviders.has(model.provider);
      });
      for (const providerId of successfulProviders) {
        for (const model of cacheById.values()) {
          if (model.provider === providerId) refreshed.push(model);
        }
      }
      const unique = new Map();
      for (const model of refreshed) unique.set(model.id, model);
      const allModels = [...unique.values()].sort((a, b) =>
        String(a.provider || '').localeCompare(String(b.provider || '')) ||
        String(a.rawId || a.id).localeCompare(String(b.rawId || b.id))
      );
      store.set('fetchedModels', allModels);
      return r({
        success: allModels.length > 0 || failed.length === 0,
        models: allModels,
        count: allModels.length,
        refreshedProviders: [...successfulProviders],
        retainedProviders: [...new Set(allModels.map((m) => m.provider).filter((id) => id && !successfulProviders.has(id)))],
        results,
        errors: failed.map((x) => ({ provider: x.provider, error: x.error })),
      });
    }

    case 'models:ping':
      return r(await pingModel(state, a[0]));

    case 'modelQueue:get':
      return r(store.get('modelQueue', []));

    case 'modelQueue:set':
      store.set('modelQueue', a[0] || []);
      return r({ success: true, modelQueue: a[0] || [] });

    // ── Cloud Memory ───────────────────────────────────────────────────────
    case 'cloudMemory:get': {
      const memory = cloudMemory.ensureCloudMemory(state);
      return r({
        records: memory.records,
        audit: memory.audit.slice(0, 200),
        pendingDeletes: memory.pendingDeletes,
        permissions: memory.permissions,
        modelPermissions: memory.modelPermissions,
        mcpServers: memory.mcpServers,
        mcpClients: memory.mcpClients || [],
        endpoint: publicOrigin(req) + '/mcp',
      });
    }
    case 'cloudMemory:save': {
      try {
        const saved = cloudMemory.write(state, a[0] || {}, 'admin', a[1] === 'update' ? 'update' : 'write');
        return { result: { success: true, record: saved }, save: true };
      } catch (err) { return r({ success: false, error: err.message }); }
    }
    case 'cloudMemory:delete': {
      const result = cloudMemory.requestDelete(state, a[0], 'admin');
      return { result, save: true };
    }
    case 'cloudMemory:approveDelete': {
      return { result: cloudMemory.approveDelete(state, a[0], a[1] === true, 'admin'), save: true };
    }
    case 'cloudMemory:setPermissions': {
      const memory = cloudMemory.ensureCloudMemory(state);
      const next = a[0] || {};
      memory.permissions = {
        read: next.read !== false,
        write: next.write !== false,
        update: next.update !== false,
        delete: false,
      };
      return { result: { success: true, permissions: memory.permissions }, save: true };
    }
    case 'cloudMemory:setModelPermissions': {
      const memory = cloudMemory.ensureCloudMemory(state);
      const input = a[0] || {};
      const modelId = String(input.modelId || '').trim().slice(0, 160);
      if (!modelId) return r({ success: false, error: 'Model ID is required' });
      const p = input.permissions || {};
      memory.modelPermissions[modelId] = {
        read: p.read !== false,
        write: p.write !== false,
        update: p.update !== false,
      };
      return { result: { success: true, modelId, permissions: memory.modelPermissions[modelId] }, save: true };
    }

    case 'cloudMemory:setServers': {
      const memory = cloudMemory.ensureCloudMemory(state);
      memory.mcpServers = Array.isArray(a[0]) ? a[0].slice(0, 50) : [];
      return { result: { success: true, mcpServers: memory.mcpServers }, save: true };
    }

    // Provider maintenance diagnostics
    case 'automation:get': {
      const config = store.get('automationConfig', { enabled: false, frequency: 'daily', time: '03:00', timezone: 'UTC' });
      const history = store.get('automationHistory', []);
      return r({ config, history: history.slice(0, 20), lastRun: history[0] || null });
    }
    case 'automation:save': {
      const input = a[0] || {};
      const frequency = ['daily', 'weekly'].includes(input.frequency) ? input.frequency : 'daily';
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input.time || '')) ? input.time : '03:00';
      const day = Math.max(0, Math.min(6, Number(input.day) || 0));
      const config = { enabled: input.enabled === true, frequency, time, day, timezone: 'UTC', updatedAt: new Date().toISOString() };
      store.set('automationConfig', config);
      return r({ success: true, config, scheduling: 'saved_only' });
    }
    case 'automation:run': {
      const keys = (store.get('keys', []) || []).filter((k) => k && k.enabled !== false && k.key);
      const customProviders = store.get('customProviders', []) || [];
      const storedProviders = store.get('providers', []) || [];
      const checked = await pool(keys, 6, async (key) => {
        const provider = key.provider || key.providerId || 'unknown';
        const result = await testApiKey(key.key, provider, customProviders, storedProviders);
        return { keyId: key.id, provider, label: key.label || provider, success: !!result.success, latency: result.latency || 0, error: result.success ? null : String(result.error || 'Connection failed').slice(0, 220) };
      });
      const byProvider = new Map();
      for (const item of checked) {
        const current = byProvider.get(item.provider) || { provider: item.provider, tested: 0, working: 0, failed: 0, errors: [] };
        current.tested++;
        if (item.success) current.working++; else { current.failed++; if (current.errors.length < 3) current.errors.push(item.error); }
        byProvider.set(item.provider, current);
      }
      const report = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), tested: checked.length, working: checked.filter((x) => x.success).length, failed: checked.filter((x) => !x.success).length, providers: [...byProvider.values()], recommendations: checked.filter((x) => !x.success).map((x) => ({ provider: x.provider, label: x.label, reason: x.error, action: 'Review provider URL, permissions, or replace the API key. No configuration was changed.' })) };
      const history = store.get('automationHistory', []);
      store.set('automationHistory', [report, ...(Array.isArray(history) ? history : [])].slice(0, 30));
      return r({ success: true, report });
    }
    // ── Teams ───────────────────────────────────────────────────────────────
    case 'teams:get':
      return r(store.get('teams', []));
    case 'teams:set':
      store.set('teams', a[0] || []);
      return r({ success: true, teams: store.get('teams', []) });
    case 'teams:remove': {
      const filtered = store.get('teams', []).filter((t) => t.id !== a[0]);
      store.set('teams', filtered);
      return r({ success: true, teams: filtered });
    }

    // ── Liveness ────────────────────────────────────────────────────────────
    case 'liveness:get':
      return r(store.get('modelLiveness', {}));

    case 'sweep:start': {
      const models = (store.get('fetchedModels', []) || []).slice(0, 60);
      const checker = createLivenessChecker({
        keys: store.get('keys', []),
        providers: allProviders(state),
        models,
        store,
      });
      const started = Date.now();
      const res = await checker.run({
        forceRescan: true,
        isCancelled: () => Date.now() - started > 50000,
      });
      return r({ success: true, ...res });
    }

    case 'sweep:status':
    case 'sweep:results':
      return r(store.get(method === 'sweep:status' ? 'modelLivenessMeta' : 'modelLiveness', {}));

    default:
      return { result: undefined, error: 'Unknown method: ' + method, status: 404 };
  }
}

/** Vercel handler body for POST /api/rpc. */
async function handleRpc(req, res, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const send = (status, obj) => {
    const payload = JSON.stringify(obj);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(payload);
  };

  if (req.method !== 'POST') return send(405, { ok: false, error: 'POST only' });

  // CSRF: the console only talks to its own origin.
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch (_) {
      host = '';
    }
    const expected = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host !== expected) return send(403, { ok: false, error: 'Cross-origin request blocked' });
  }

  const method = body && typeof body.method === 'string' ? body.method : '';
  const args = body && Array.isArray(body.args) ? body.args : [];
  if (!method) return send(400, { ok: false, error: 'Missing method' });

  let state;
  try {
    state = await loadState();
  } catch (err) {
    return send(500, { ok: false, error: err.message });
  }

  const { hasPassword, auth } = authInfo(state);
  const authenticated = hasPassword ? session.verify(req, auth.salt) : false;

  if (!PUBLIC_METHODS.has(method) && !authenticated) {
    return send(401, { ok: false, error: 'Not signed in', locked: true });
  }

  let out;
  try {
    out = await dispatch(method, args, { req, state, authenticated });
  } catch (err) {
    console.error('[mine] rpc ' + method + ' failed:', err);
    return send(500, { ok: false, error: err.message || 'Internal error' });
  }

  if (out.error) return send(out.status || 400, { ok: false, error: out.error });

  if (out.save) {
    try {
      await saveState(state);
    } catch (err) {
      return send(500, { ok: false, error: 'Could not save: ' + err.message });
    }
  }
  if (out.setCookie) session.setCookie(res, req, out.setCookie);
  if (out.clearCookie) session.clearCookie(res, req);

  return send(200, { ok: true, result: out.result === undefined ? null : out.result });
}

module.exports = { handleRpc, dispatch, PUBLIC_METHODS };
