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
const cloudMemory = require('./cloud-memory');
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
  const counterBaseline = new Map(keys.map((k) => [k.id, { usageToday: Number(k.usageToday) || 0, usageTotal: Number(k.usageTotal) || 0, totalTokens: Number(k.totalTokens) || 0, errors: Number(k.errors) || 0 }]));
  // Seed liveness with the last stored sweep so teams skip dead workers.
  const stored = state.modelLiveness || {};
  for (const [id, r] of Object.entries(stored)) liveness.cache.set(id, r);

  const gw = createGateway({
    keys,
    providers,
    models,
    modelQueue: Array.isArray(state.modelQueue) ? state.modelQueue : [],
    teams: Array.isArray(state.teams) ? state.teams : [],
    cloudMemoryRecords: (state.cloudMemory && Array.isArray(state.cloudMemory.records)) ? state.cloudMemory.records : [],
    cloudMemoryState: state.cloudMemory || {},
    onMemoryWrite: (record) => sink.memoryWrites.push(record),
    onTeamUpdate: (team) => sink.teamUpdates.push(JSON.parse(JSON.stringify(team))),
    onTeamCreate: (team) => { sink.teamCreates.push(JSON.parse(JSON.stringify(team))); return true; },
    settings,
    liveness,
    onKeyUpdate: (keyId, updates) => {
      const baseline = counterBaseline.get(keyId) || { usageToday: 0, usageTotal: 0, totalTokens: 0, errors: 0 };
      const delta = {};
      for (const field of ['usageToday', 'usageTotal', 'totalTokens', 'errors']) {
        if (updates[field] !== undefined) {
          const value = Number(updates[field]) || 0;
          delta[field + 'Delta'] = value - (Number(baseline[field]) || 0);
          baseline[field] = value;
        }
      }
      counterBaseline.set(keyId, baseline);
      const other = { ...updates };
      for (const field of ['usageToday', 'usageTotal', 'totalTokens', 'errors']) delete other[field];
      sink.keyUpdates[keyId] = { ...(sink.keyUpdates[keyId] || {}), ...other, ...delta };
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
        if (field.endsWith('Delta') && ['usageTodayDelta', 'usageTotalDelta', 'totalTokensDelta', 'errorsDelta'].includes(field)) {
          const counter = field.slice(0, -5);
          k[counter] = Math.max(0, (Number(k[counter]) || 0) + (Number(value) || 0));
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
      if (entry.kind === 'team-run') continue; // delegate logs already account for upstream calls
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
          sink.logs.filter((l) => l.kind !== 'team-run' && l.status && l.status < 400).length,
        tokens: ((s.gatewayTotals && s.gatewayTotals.tokens) || 0) +
          sink.logs.filter((l) => l.kind !== 'team-run').reduce((n, l) => n + (l.tokens || 0), 0),
      },
    });
  }
  if (sink.activeKey) store.set('lastActiveKey', sink.activeKey);
  if ((sink.teamUpdates && sink.teamUpdates.length) || (sink.teamCreates && sink.teamCreates.length)) {
    const teams = Array.isArray(state.teams) ? state.teams.slice() : [];
    for (const updated of sink.teamUpdates || []) {
      const index = teams.findIndex((team) => team.id === updated.id);
      if (index >= 0) teams[index] = updated;
    }
    for (const created of sink.teamCreates || []) {
      if (!teams.some((team) => team.id === created.id || team.slug === created.slug)) teams.push(created);
    }
    store.set('teams', teams);
  }
  if (Array.isArray(sink.memoryWrites) && sink.memoryWrites.length) {
    for (const entry of sink.memoryWrites) {
      try { cloudMemory.write(state, entry, 'team-agent', 'write'); } catch (err) { console.error('[mine] cloud memory write skipped:', err.message); }
    }
    store.set('cloudMemory', state.cloudMemory);
  }
  return store.dirty;
}

async function persistSink(sink) {
  if (!Object.keys(sink.keyUpdates).length && !sink.logs.length && !sink.activeKey && !(sink.memoryWrites && sink.memoryWrites.length) && !(sink.teamUpdates && sink.teamUpdates.length) && !(sink.teamCreates && sink.teamCreates.length)) return;
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

  const sink = { keyUpdates: {}, logs: [], activeKey: null, memoryWrites: [], teamUpdates: [], teamCreates: [] };
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
