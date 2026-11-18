'use strict';

const http = require('http');
const https = require('https');

const { getProviderModelsUrl } = require('./provider-catalog');

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_CONTEXT_WINDOW = 128000;

function authHeadersFor(provider, apiKey, parsedUrl) {
  const headers = { 'User-Agent': 'Mine/1.0' };

  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider === 'google' || provider === 'gemini') {
    // Google's OpenAI-compat shim expects the key in the query string.
    parsedUrl.searchParams.set('key', apiKey);
  } else {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }

  return headers;
}

function httpGetJson(url, headers) {
  return new Promise((resolve) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_) {
      resolve({ ok: false, status: 0, body: '', error: 'Invalid URL' });
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const start = Date.now();

    const req = client.request(
      parsedUrl,
      { method: 'GET', headers, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            body,
            latency: Date.now() - start,
          })
        );
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: '', latency: Date.now() - start, error: 'Request timed out' });
    });
    req.on('error', (err) =>
      resolve({ ok: false, status: 0, body: '', latency: Date.now() - start, error: err.message })
    );

    req.end();
  });
}

/**
 * Verify that an API key works, without mutating any stored state.
 */
async function testApiKey(apiKey, provider, customProviders, storedProviders) {
  const url = getProviderModelsUrl(provider, customProviders, storedProviders);
  if (!url) {
    const detail = provider === 'cloudflare-workers-ai' ? 'Cloudflare Workers AI requires a valid 32-character Account ID. Add it in the API key form.' : 'Unknown provider or no models endpoint';
    return { success: false, latency: 0, error: detail };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_) {
    return { success: false, latency: 0, error: 'Invalid models URL' };
  }

  const headers = authHeadersFor(provider, apiKey, parsedUrl);
  const result = await httpGetJson(parsedUrl.toString(), headers);

  if (result.ok) {
    return { success: true, latency: result.latency, error: null };
  }

  let errorMsg = result.error || 'HTTP ' + result.status;
  try {
    const parsed = JSON.parse(result.body);
    errorMsg = (parsed.error && parsed.error.message) || parsed.message || errorMsg;
  } catch (_) {
    /* keep the HTTP status error */
  }

  return { success: false, latency: result.latency, error: errorMsg };
}

/**
 * Fetch the model list for one provider using one API key.
 */
async function fetchModelsForProvider(apiKey, provider, customProviders, sourceKeyId, storedProviders) {
  const url = getProviderModelsUrl(provider, customProviders, storedProviders);
  if (!url) {
    const detail = provider === 'cloudflare-workers-ai' ? 'Cloudflare Workers AI requires a valid 32-character Account ID. Add it in the API key form.' : 'No models endpoint available';
    return { success: false, provider, models: [], error: detail };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_) {
    return { success: false, provider, models: [], error: 'Invalid models URL' };
  }

  const headers = authHeadersFor(provider, apiKey, parsedUrl);
  const result = await httpGetJson(parsedUrl.toString(), headers);

  if (!result.ok) {
    return { success: false, provider, models: [], error: result.error || 'HTTP ' + result.status };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.body);
  } catch (_) {
    return { success: false, provider, models: [], error: 'Failed to parse JSON response' };
  }

  const list = Array.isArray(parsed.data)
    ? parsed.data
    : Array.isArray(parsed.models)
      ? parsed.models
      : Array.isArray(parsed.result)
        ? parsed.result
        : Array.isArray(parsed.items)
          ? parsed.items
          : [];

  const models = list
    .map((m) => {
      const rawId = typeof m === 'string' ? m : m.id || m.model || m.model_id || m.name;
      const cleanId = String(rawId || '').replace(/^models\//, '');
      const displayName = typeof m === 'object' && m
        ? String(m.name || m.display_name || m.displayName || cleanId)
        : cleanId;
      const ctx =
        m.context_window ||
        m.max_context_length ||
        m.input_token_limit ||
        m.contextWindow ||
        m.inputTokenLimit ||
        DEFAULT_CONTEXT_WINDOW;
      const pricing = m.pricing || m.price || null;
      const explicitFree =
        m.free === true || m.is_free === true || m.free === 1 ||
        String(cleanId).endsWith(':free') || String(cleanId).endsWith('-free') ||
        /free/i.test(String(cleanId));
      const hasZeroPricing = !!(pricing &&
        Number(pricing.prompt ?? pricing.input ?? 1) === 0 &&
        Number(pricing.completion ?? pricing.output ?? 1) === 0);
      const isFree = explicitFree || hasZeroPricing;
      const isPaid = !!(
        m.requires_paid === true || m.paid_only === true ||
        m.requires_payment === true ||
        String(m.billing_tier || m.billingTier || m.plan || '').toLowerCase() === 'paid' ||
        (pricing &&
          (Number(pricing.prompt ?? pricing.input ?? 0) > 0 ||
           Number(pricing.completion ?? pricing.output ?? 0) > 0))
      );
      // Cloudflare's free Neurons allowance is shared across eligible models.
      // Only label a model Free/Paid when its metadata says so; otherwise
      // make the shared quota requirement explicit rather than guessing.
      const billingTier = provider === 'cloudflare-workers-ai'
        ? (isPaid ? 'paid' : isFree ? 'free' : 'quota')
        : null;

      return {
        id: provider + '/' + cleanId,
        rawId: cleanId,
        displayName,
        provider,
        ctx: Number(ctx) || DEFAULT_CONTEXT_WINDOW,
        free: isFree ? 1 : 0,
        billingTier,
        pricing,
        ownedBy: m.owned_by || m.ownedBy || m.provider || provider,
        sourceKeyId: sourceKeyId || null,
        lastSeenAt: new Date().toISOString(),
        pin: 0,
      };
    })
    .filter((model) => model.rawId);

  return { success: true, provider, models, count: models.length };
}

module.exports = { testApiKey, fetchModelsForProvider };
