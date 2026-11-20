'use strict';

const http = require('http');
const https = require('https');
const { matchProvider, isKeyUsable } = require('./providers');

function chatUrlFromBaseUrl(baseUrl) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  if (b.endsWith('/models')) return b.slice(0, -'/models'.length) + '/chat/completions';
  if (b.endsWith('/v1')) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

function authHeadersFor(provider, apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  const pid = (provider && provider.id) || '';
  if (pid === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }
  return headers;
}

function httpPost(url, headers, body, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { resolve({ ok: false, status: 0, body: '', error: 'bad url' }); return; }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(parsed, { method: 'POST', headers, timeout: timeoutMs || 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '', error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

function probeModel(baseUrl, provider, apiKey, modelId, timeoutMs) {
  const url = chatUrlFromBaseUrl(baseUrl);
  const headers = authHeadersFor(provider, apiKey);
  const body = JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 });
  const start = Date.now();
  return httpPost(url, headers, body, timeoutMs || 15000).then((r) => {
    const latency = Date.now() - start;
    if (r.ok) return { status: 'live', latencyMs: latency };
    if (r.status === 429) return { status: 'rate_limited', latencyMs: latency, error: '429' };
    if (r.status === 401 || r.status === 403) return { status: 'dead', latencyMs: latency, error: String(r.status) };
    if (r.status === 404) return { status: 'unsupported', latencyMs: latency, error: '404' };
    if (r.status === 402) return { status: 'credit_empty', latencyMs: latency, error: '402' };
    return { status: 'error', latencyMs: latency, error: r.error || String(r.status) };
  });
}

function createLivenessChecker(opts) {
  opts = opts || {};
  const keys = opts.keys || [];
  const providers = opts.providers || [];
  const models = opts.models || [];
  const store = opts.store || null;

  const cache = new Map(); // modelId -> { status, latencyMs, error, checkedAt }
  const providerCache = new Map(); // providerId -> { results, expiresAt }

  function findProvider(providerId) {
    return providers.find((p) => p.id === providerId) || { id: providerId };
  }

  function findKey(providerId) {
    return keys
      .filter((key) => key && key.key && isKeyUsable(key) && matchProvider(key.providerId || key.provider, providerId))
      .sort((a, b) => {
        const statusRank = (key) => key.status === 'ACTIVE' ? 0 : key.status === 'UNKNOWN' ? 1 : 2;
        return statusRank(a) - statusRank(b) ||
          (Number(a.usageToday) || 0) - (Number(b.usageToday) || 0) ||
          (Number(a.lastLatency) || 0) - (Number(b.lastLatency) || 0);
      })[0] || null;
  }

  function findBaseUrl(providerId) {
    const p = findProvider(providerId);
    return p.baseUrl || p.base_url || p.url || '';
  }

  function isLive(modelId) {
    const c = cache.get(modelId);
    if (!c) return true; // unknown -> assume live
    return c.status === 'live' || c.status === 'rate_limited';
  }

  async function checkProvider(providerId, modelIds) {
    const now = Date.now();
    const cached = providerCache.get(providerId);
    if (cached && now < cached.expiresAt) return cached.results;

    const baseUrl = findBaseUrl(providerId);
    const key = findKey(providerId);
    if (!baseUrl || !key) {
      const res = {};
      for (const mid of modelIds) res[mid] = { status: 'no_key', latencyMs: 0, error: 'no key' };
      return res;
    }

    const provider = findProvider(providerId);
    const results = {};
    for (const mid of modelIds) {
      const r = await probeModel(baseUrl, provider, key.key, mid, 15000);
      results[mid] = r;
      cache.set(mid, { ...r, checkedAt: now });
    }
    providerCache.set(providerId, { results, expiresAt: now + 60000 });
    return results;
  }

  async function run({ forceRescan, isCancelled, onProgress, onModelStatus }) {
    forceRescan = !!forceRescan;
    const allModels = Array.isArray(models) ? models : (store ? store.get('fetchedModels', []) : []);
    // group by provider
    const byProvider = new Map();
    for (const m of allModels) {
      const pid = m.provider || m.providerId;
      if (!pid) continue;
      if (!byProvider.has(pid)) byProvider.set(pid, []);
      byProvider.get(pid).push(m);
    }

    let total = allModels.length;
    let done = 0;
    const startedAt = Date.now();
    if (onProgress) onProgress({ total, done, running: true, startedAt });

    const providerIds = [...byProvider.keys()];
    // run providers with concurrency 1 each, but sequentially across providers to be safe
    for (const pid of providerIds) {
      if (isCancelled && isCancelled()) break;
      const ms = byProvider.get(pid);
      const ids = ms.map((m) => m.id || m.rawId);
      const results = await checkProvider(pid, ids);
      for (const m of ms) {
        const mid = m.id || m.rawId;
        const r = results[mid] || { status: 'error', latencyMs: 0 };
        if (onModelStatus) onModelStatus(m, r);
        // persist to store
        if (store) {
          const liv = store.get('modelLiveness', {});
          liv[mid] = { status: r.status, latencyMs: r.latencyMs, error: r.error, checkedAt: Date.now() };
          store.set('modelLiveness', liv);
        }
        done++;
        if (onProgress) onProgress({ total, done, running: true, startedAt });
      }
    }

    const finishedAt = Date.now();
    if (store) {
      const liv = store.get('modelLiveness', {});
      const liveCount = Object.values(liv).filter((x) => x.status === 'live').length;
      store.set('modelLivenessMeta', { lastSweepAt: finishedAt, total: Object.keys(liv).length, live: liveCount });
    }
    if (onProgress) onProgress({ total, done, running: false, startedAt, finishedAt });
    return { total, done, cancelled: !!(isCancelled && isCancelled()) };
  }

  function getStatus() {
    const meta = store ? store.get('modelLivenessMeta', {}) : {};
    const liv = store ? store.get('modelLiveness', {}) : {};
    return {
      total: Object.keys(liv).length || (models || []).length,
      done: Object.keys(liv).length,
      running: false,
      cancelled: false,
      startedAt: meta.lastSweepAt || null,
      finishedAt: meta.lastSweepAt || null,
      live: Object.values(liv).filter((x) => x.status === 'live').length,
    };
  }

  return { checkProvider, run, getStatus, isLive, cache };
}

module.exports = { createLivenessChecker, chatUrlFromBaseUrl };
