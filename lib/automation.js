'use strict';
const { testApiKey } = require('./model-discovery');
const { PROVIDER_DIRECTORY } = require('./provider-directory');
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; out[index] = await fn(items[index], index); }
  }));
  return out;
}
function safeError(value) {
  return String(value || 'Provider request failed')
    .replace(/(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/gi, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]').slice(0, 220);
}
function extractText(body) {
  const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part && (part.text || '')).join('\n');
  return '';
}
function parseAnalysis(text) {
  let raw = String(text || '').trim();
  const fence = String.fromCharCode(96, 96, 96);
  if (raw.slice(0, 3) === fence) {
    const lines = raw.split('\n');
    lines.shift();
    if (lines.length && lines[lines.length - 1].trim() === fence) lines.pop();
    raw = lines.join('\n').trim();
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      summary: String(parsed.summary || 'Provider health analysis completed').slice(0, 1200),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 12).map((item) => ({
        provider: String(item.provider || '').slice(0, 100),
        severity: ['low', 'medium', 'high'].includes(item.severity) ? item.severity : 'medium',
        issue: String(item.issue || '').slice(0, 500),
        action: String(item.action || '').slice(0, 500),
        requiresApproval: true,
      })) : [],
    };
  } catch (_) { return { summary: raw.slice(0, 1200) || 'The selected model returned no analysis.', recommendations: [] }; }
}
async function runProviderMaintenance(state, modelId, origin) {
  const selectedId = String(modelId || '').trim();
  const model = (Array.isArray(state.fetchedModels) ? state.fetchedModels : []).find((item) => item && item.id === selectedId);
  if (!selectedId || !model) return { success: false, error: 'Select an available model from the model catalog first.' };
  const keys = (Array.isArray(state.keys) ? state.keys : []).filter((key) => key && key.enabled !== false && key.status !== 'DEAD' && key.key);
  const customProviders = Array.isArray(state.customProviders) ? state.customProviders : [];
  const storedProviders = Array.isArray(state.providers) ? state.providers : [];
  const checked = await mapLimit(keys, 6, async (key) => {
    const provider = String(key.provider || key.providerId || 'unknown');
    const result = await testApiKey(key.key, provider, customProviders, storedProviders);
    return { provider, success: !!result.success, latency: Number(result.latency) || 0, error: result.success ? null : safeError(result.error) };
  });
  const grouped = new Map();
  for (const item of checked) {
    const row = grouped.get(item.provider) || { provider: item.provider, tested: 0, working: 0, failed: 0, errors: [] };
    row.tested++;
    if (item.success) row.working++;
    else { row.failed++; if (row.errors.length < 3) row.errors.push(item.error); }
    grouped.set(item.provider, row);
  }
  const report = {
    id: require('crypto').randomUUID(), timestamp: new Date().toISOString(), modelId: selectedId,
    tested: checked.length, working: checked.filter((item) => item.success).length,
    failed: checked.filter((item) => !item.success).length, providers: Array.from(grouped.values()),
    analysis: null, analysisError: null,
  };
  const proposals = [];
  for (const row of report.providers) {
    if (!row.failed) continue;
    const configured = storedProviders.find((item) => item && item.id === row.provider);
    const canonical = PROVIDER_DIRECTORY.find((item) => item && item.id === row.provider);
    if (configured && canonical && configured.url && canonical.url && configured.url !== canonical.url) {
      proposals.push({ id: require('crypto').randomUUID(), provider: row.provider, field: 'url', from: String(configured.url).slice(0, 300), to: canonical.url, reason: 'The configured endpoint differs from the trusted built-in provider catalog.', status: 'pending', requiresApproval: true });
    }
  }
  report.proposals = proposals;
  const gatewayKey = state.settings && state.settings.gatewayApiKey;
  if (!gatewayKey) { report.analysisError = 'Mine gateway key is not configured.'; return { success: true, report }; }
  const base = String(origin || process.env.MINE_PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://mine-console.vercel.app')).replace(/\/+$/, '');
  try {
    const response = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + gatewayKey },
      body: JSON.stringify({
        model: selectedId, temperature: 0, max_tokens: 900,
        messages: [
          { role: 'system', content: 'You are Mine provider-maintenance analyst. Diagnose the supplied provider health results. Never ask for, repeat, or infer API keys or secrets. Do not claim to have changed anything. Return only JSON: {"summary":"short summary","recommendations":[{"provider":"exact provider id","severity":"low|medium|high","issue":"specific observed issue","action":"safe next step"}]}. Recommend configuration changes only for owner review; never execute them.' },
          { role: 'user', content: JSON.stringify({ providers: report.providers, tested: report.tested, working: report.working, failed: report.failed }) },
        ],
      }),
      signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) report.analysisError = 'Maintenance model request failed (HTTP ' + response.status + ').';
    else {
      const parsed = parseAnalysis(extractText(await response.json()));
      const allowed = new Set(report.providers.map((item) => item.provider));
      parsed.recommendations = parsed.recommendations.filter((item) => allowed.has(item.provider));
      report.analysis = parsed;
    }
  } catch (error) { report.analysisError = safeError(error && error.message); }
  return { success: true, report };
}
module.exports = { runProviderMaintenance };
