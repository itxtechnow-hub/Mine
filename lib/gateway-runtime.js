'use strict';

/**
 * Runs the Mine gateway for one serverless invocation.
 *
 * Load the vault, build a gateway around it, serve the request, then write
 * back only what the request changed (key health/usage, the request log, and
 * analytics) on top of a fresh read, so a concurrent edit in the console is
 * not overwritten.
 */

const crypto = require('crypto');
const { loadState, saveState, MemStore } = require('./storage');
const { createGateway } = require('./gateway/server');
const { createLivenessChecker } = require('./gateway/liveness');
const { createAnalytics } = require('./analytics');
const { PROVIDER_DIRECTORY } = require('./provider-directory');
const { errorResponse, jsonResponse } = require('./gateway/http-util');

const MAX_LOGS = 200;

function ensureGatewayKey(state) {
  state.settings = state.settings || {};
  if (!state.settings.gatewayApiKey) {
    state.settings.gatewayApiKey = 'sk-mine-' + crypto.randomBytes(24).toString('hex');
    return true;
  }
  return false;
}

/** Built-in directory, overlaid with edited / custom providers. */
function allProviders(state) {
  const byId = new Map();
  for (const p of PROVIDER_DIRECTORY) if (p && p.id) byId.set(p.id, { ...p });
  for (const p of state.providers || []) if (p && p.id) byId.set(p.id, { ...byId.get(p.id), ...p });
  for (const p of state.customProviders || []) {
    if (!p || !p.id) continue;
    const merged = { ...byId.get(p.id), ...p, custom: true };
    if (!merged.url && merged.baseUrl) merged.url = merged.baseUrl;
    byId.set(p.id, merged);
  }
  return [...byId.values()];
}

function isGatewayOnline(state) {
  const s = state.settings || {};
  if (s.gatewayOnline === undefined) return true; // on by default when hosted
  return !!s.gatewayOnline;
}

function buildGateway(state, sink) {
  const keys = (state.keys || []).map((k) => (k.enabled === undefined ? { ...k, enabled: true } : { ...k }));
  const providers = allProviders(state);
  const models = Array.isArray(state.fetchedModels) ? state.fetchedModels : [];
  const settings = {
    ...(state.settings || {}),
    // A hosted gateway is reachable by anyone; the key is always required.
    vkey: 1,
  };
  const liveness = createLivenessChecker({ keys, providers, models, store: null });
  // Seed liveness with the last stored sweep so teams skip dead workers.
  const stored = state.modelLiveness || {};
  for (const [id, r] of Object.entries(stored)) liveness.cache.set(id, r);

  const gw = createGateway({
    keys,
    providers,
    models,
    modelQueue: Array.isArray(state.modelQueue) ? state.modelQueue : [],
    teams: Array.isArray(state.teams) ? state.teams : [],
    settings,
    liveness,
    onKeyUpdate: (keyId, updates) => {
      sink.keyUpdates[keyId] = { ...(sink.keyUpdates[keyId] || {}), ...updates };
    },
    onKeyStatusChange: (keyId, status, error) => {
      sink.keyUpdates[keyId] = {
        ...(sink.keyUpdates[keyId] || {}),
        status,
        ...(error ? { lastError: error } : {}),
      };
    },
    onRequestLog: (entry) => sink.logs.push(entry),
    onActiveKey: (data) => {
      sink.activeKey = data;
    },
  });
  if (state.settings && state.settings.gatewayStartedAt) gw.markStarted(state.settings.gatewayStartedAt);
  return gw;
}

/** Apply what a gateway request changed on top of the latest stored state. */
function applySink(state, sink) {
  const store = new MemStore(state);
  const ids = Object.keys(sink.keyUpdates);
  if (ids.length) {
    const keys = state.keys || [];
    for (const k of keys) {
      const upd = sink.keyUpdates[k.id];
      if (!upd) continue;
      // Usage counters are deltas against the snapshot the request started
      // from; take the larger value so parallel requests never go backwards.
      for (const [field, value] of Object.entries(upd)) {
        if (['usageToday', 'usageTotal', 'totalTokens', 'errors'].includes(field)) {
          k[field] = Math.max(Number(k[field]) || 0, Number(value) || 0);
        } else {
          k[field] = value;
        }
      }
    }
    store.set('keys', keys);
  }
  if (sink.logs.length) {
    const analytics = createAnalytics(store);
    for (const entry of sink.logs) {
      analytics.recordRequestMetric({
        tokens: entry.tokens || 0,
        latency: entry.latency || 0,
        status: entry.status,
        keyId: entry.keyId,
        providerId: entry.provider,
      });
    }
    const logs = [...sink.logs.slice().reverse(), ...(state.requestLogs || [])].slice(0, MAX_LOGS);
    store.set('requestLogs', logs);
    const s = state.settings || {};
    store.set('settings', {
      ...s,
      gatewayTotals: {
        requests: ((s.gatewayTotals && s.gatewayTotals.requests) || 0) +
          sink.logs.filter((l) => l.status && l.status < 400).length,
        tokens: ((s.gatewayTotals && s.gatewayTotals.tokens) || 0) +
          sink.logs.reduce((n, l) => n + (l.tokens || 0), 0),
      },
    });
  }
  if (sink.activeKey) store.set('lastActiveKey', sink.activeKey);
  return store.dirty;
}

async function persistSink(sink) {
  if (!Object.keys(sink.keyUpdates).length && !sink.logs.length && !sink.activeKey) return;
  // Two tries in case of a racing writer.
  for (let i = 0; i < 2; i++) {
    try {
      const fresh = await loadState();
      if (applySink(fresh, sink)) await saveState(fresh);
      return;
    } catch (err) {
      if (i === 1) console.error('[mine] could not persist gateway stats:', err.message);
    }
  }
}

/** Vercel handler body for /v1/* and /health. */
async function handleGatewayRequest(req, res, pathname) {
  if (pathname === '/health' && req.method === 'GET') {
    return jsonResponse(res, 200, {
      status: 'ok',
      service: 'mine-gateway',
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      timestamp: new Date().toISOString(),
    });
  }

  let state;
  try {
    state = await loadState();
  } catch (err) {
    return errorResponse(res, 500, 'Vault unavailable: ' + err.message);
  }

  if (ensureGatewayKey(state)) {
    // First request ever: persist the generated key.
    await saveState(state).catch(() => {});
  }

  if (req.method !== 'OPTIONS' && !isGatewayOnline(state)) {
    return errorResponse(res, 503, 'The Mine gateway is stopped. Start it from the console.', 'gateway_offline');
  }

  const sink = { keyUpdates: {}, logs: [], activeKey: null };
  const gw = buildGateway(state, sink);
  await gw.handleRequest(req, res, pathname);
  await persistSink(sink);
}

module.exports = {
  handleGatewayRequest,
  buildGateway,
  applySink,
  allProviders,
  ensureGatewayKey,
  isGatewayOnline,
};
