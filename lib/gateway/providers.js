'use strict';

const { URL } = require('url');

/**
 * Provider matching helpers.
 *
 * A model id is namespaced as `provider/model` (e.g. `openrouter/llama-3`).
 * The prefix selects which upstream provider handles the request.
 */

function normalizeProviderId(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

const PROVIDER_ALIASES = {
  opencodezen: 'opencode',
  opencode: 'opencode',
};

function matchProvider(p1, p2) {
  const a = PROVIDER_ALIASES[normalizeProviderId(p1)] || normalizeProviderId(p1);
  const b = PROVIDER_ALIASES[normalizeProviderId(p2)] || normalizeProviderId(p2);
  return a === b && a.length > 0;
}

function resolveProvider(providers, model) {
  if (!model || typeof model !== 'string') return null;
  const slash = model.indexOf('/');
  if (slash < 0) return null;
  const prefix = model.slice(0, slash);

  const exact = providers.find(
    (p) => p.prefix === prefix || p.id === prefix || p.name === prefix
  );
  if (exact) return exact;

  return (
    providers.find(
      (p) => matchProvider(p.id, prefix) || matchProvider(p.name, prefix)
    ) || null
  );
}

function stripProviderPrefix(model) {
  if (!model || typeof model !== 'string') return model;
  const slash = model.indexOf('/');
  return slash < 0 ? model : model.slice(slash + 1);
}

function getModelProvider(model) {
  if (!model || typeof model !== 'string') return null;
  const slash = model.indexOf('/');
  return slash < 0 ? null : model.slice(0, slash);
}

function isKeyUsable(key, now = Date.now()) {
  if (!key || key.enabled === false) return false;
  if (['DEAD', 'EXPIRED', 'INVALID', 'CREDIT_EMPTY'].includes(String(key.status || '').toUpperCase())) return false;
  if (String(key.status || '').toUpperCase() === 'COOLDOWN' && Number(key.cooldownUntil || 0) > now) return false;
  return !key.status || ['ACTIVE', 'UNKNOWN', 'UNTESTED', 'COOLDOWN'].includes(String(key.status).toUpperCase());
}

function hasActiveKeyForModel(model, keys) {
  const provider = getModelProvider(model);
  if (!provider) return false;
  return (keys || []).some((key) => isKeyUsable(key) && matchProvider(key.provider || key.providerId, provider));
}

/**
 * Pick the model to serve when the client asked for `mine/auto`.
 *
 * Preference order: the user's model queue (first enabled entry that has a
 * working key), then any available model, preferring pinned ones.
 */
function chooseAutomaticModel(models, modelQueue = [], keys = []) {
  const queue = Array.isArray(modelQueue) ? modelQueue : [];

  for (const entry of queue) {
    if (!entry || entry.enabled === false) continue;
    const id = typeof entry === 'string' ? entry : entry.id;
    if (!id) continue;
    if (!hasActiveKeyForModel(id, keys)) continue;
    const match = (models || []).find((m) => m && m.id === id);
    if (match) return match;
  }

  const available = (models || []).filter(
    (m) =>
      m &&
      typeof m.id === 'string' &&
      m.id !== 'mine/auto' &&
      m.id !== 'auto' &&
      m.enabled !== false &&
      hasActiveKeyForModel(m.id, keys)
  );

  return available.find((m) => m.pin) || available[0] || null;
}

/**
 * Every model `mine/auto` may try, in order: the enabled queue entries that
 * have a working key, then the remaining discovered models (pinned first).
 */
function automaticCandidates(models, modelQueue = [], keys = []) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(models) ? models : [];
  const push = (m) => {
    if (!m || !m.id || seen.has(m.id)) return;
    seen.add(m.id);
    out.push(m);
  };

  for (const entry of Array.isArray(modelQueue) ? modelQueue : []) {
    if (!entry || entry.enabled === false) continue;
    const id = typeof entry === 'string' ? entry : entry.id;
    if (!id || !hasActiveKeyForModel(id, keys)) continue;
    const match = list.find((m) => m && m.id === id);
    push(match || { id, rawId: (typeof entry === 'object' && entry.rawId) || stripProviderPrefix(id), provider: getModelProvider(id) });
  }

  // When the user built a queue, it is the routing order; only fall back to
  // the whole catalog when there is no usable queue entry at all.
  if (out.length) return out;

  const available = list.filter(
    (m) =>
      m &&
      typeof m.id === 'string' &&
      m.id !== 'mine/auto' &&
      m.id !== 'auto' &&
      m.enabled !== false &&
      hasActiveKeyForModel(m.id, keys)
  );
  available.filter((m) => m.pin).forEach(push);
  available.slice(0, 8).forEach(push);
  return out;
}

function normalizeUpstreamModel(model, providerId) {
  let id = String(model || '').trim();
  const provider = normalizeProviderId(providerId);
  // Google's model catalogue may return REST resource names such as
  // "models/gemini-2.5-flash", while the OpenAI-compatible endpoint expects
  // the bare Gemini model ID.
  if (provider === 'gemini' || provider === 'google') {
    id = id.replace(/^models\//i, '');
  }
  return id;
}

/**
 * Build the upstream URL for a proxied request.
 *
 * The base path the user configured MUST survive. A base like
 * `https://openrouter.ai/api/v1` has to produce
 * `https://openrouter.ai/api/v1/chat/completions`, not
 * `https://openrouter.ai/chat/completions`.
 *
 * `new URL(path, base)` cannot be used here: a leading-slash path resolves
 * against the origin and discards the base's path component entirely.
 *
 * The incoming `/v1` prefix is the same `/v1` the base already ends in, so it
 * is stripped from the incoming path and the base path is kept intact.
 */
function resolveUpstreamUrl(base, path, providerId) {
  let b = (base || '').trim().replace(/\/+$/, '');

  if (!b && providerId) {
    // Fallback guess. Better than nothing, but most providers will 404 here.
    const slug = String(providerId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    b = `https://api.${slug}.com/v1`;
  }

  let subpath = path.startsWith('/v1/') ? path.slice(3) : path;

  // Only strip a leading /v1 from the subpath if the base does not already
  // supply one. This keeps `https://api.example.com` -> `/v1/...` working.
  const baseHasV1 = /\/v1$/.test(b);
  if (baseHasV1 && subpath.startsWith('/v1/')) {
    subpath = subpath.slice(3);
  }

  if (!subpath.startsWith('/')) subpath = '/' + subpath;

  const url = new URL(b + subpath);
  return url;
}

module.exports = {
  normalizeProviderId,
  matchProvider,
  resolveProvider,
  stripProviderPrefix,
  getModelProvider,
  normalizeUpstreamModel,
  hasActiveKeyForModel,
  isKeyUsable,
  chooseAutomaticModel,
  automaticCandidates,
  resolveUpstreamUrl,
};
