'use strict';

const { matchProvider } = require('./providers');

/**
 * Select the best key for a provider, excluding keys already tried in this
 * request.
 *
 * Ordering: fewest uses today first, then lowest recorded latency. This gives
 * round-robin-ish spread without hammering a single key, while still
 * preferring the key that is currently responding fastest.
 */
function selectBestUntried(allKeys, providerId, cooldownMs, triedIds) {
  const now = Date.now();

  const candidates = (allKeys || []).filter((k) => {
    if (!k) return false;
    if (triedIds && triedIds.has(k.id)) return false;
    if (k.enabled === false) return false;

    const pId = k.providerId || k.provider;
    if (!pId) return false;
    if (!matchProvider(pId, providerId) && pId !== providerId) return false;

    if (k.status === 'DEAD' || k.status === 'CREDIT_EMPTY') return false;

    if (k.status === 'COOLDOWN') {
      if (k.cooldownUntil && k.cooldownUntil > now) return false;
      // Cooldown elapsed — bring the key back into rotation.
      k.status = 'ACTIVE';
      k.cooldownUntil = null;
    }

    return (
      k.status === 'ACTIVE' ||
      k.status === 'UNKNOWN' ||
      k.status === 'UNTESTED' ||
      !k.status
    );
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const usageDiff = (a.usageToday || 0) - (b.usageToday || 0);
    if (usageDiff !== 0) return usageDiff;
    return (a.lastLatency || 0) - (b.lastLatency || 0);
  });

  return candidates[0];
}

/**
 * Mask a key for display: first 8 and last 4 characters.
 * The full value never leaves the main process.
 */
function keyLabel(key) {
  if (!key) return null;
  const k = key.key || '';
  if (k.length <= 12) return k.substring(0, 4) + '...';
  return k.substring(0, 8) + '...' + k.substring(k.length - 4);
}

function buildLog(requestStart, agent, model, providerId, keyId, label, tokens, latency, status, error) {
  return {
    timestamp: new Date(requestStart).toISOString(),
    agent,
    model,
    provider: providerId,
    keyId: keyId || null,
    keyLabel: label || null,
    tokens,
    latency,
    status,
    error: error || null,
  };
}

module.exports = { selectBestUntried, keyLabel, buildLog };
