'use strict';
const crypto = require('crypto');
const { loadState, saveState } = require('../lib/storage');
const { runProviderMaintenance } = require('../lib/automation');
function safeEqual(a, b) {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
module.exports = async function automationCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.authorization, 'Bearer ' + secret)) {
    res.statusCode = 401; res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
  }
  if (req.method !== 'GET') {
    res.statusCode = 405; res.setHeader('Allow', 'GET');
    return res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
  }
  let state;
  try { state = await loadState(); }
  catch (_) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, error: 'Vault unavailable' })); }
  const config = state.automationConfig || {};
  if (!config.enabled) { res.statusCode = 200; return res.end(JSON.stringify({ ok: true, skipped: 'schedule disabled' })); }
  const now = new Date();
  if (config.frequency === 'weekly' && now.getUTCDay() !== Number(config.day)) {
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true, skipped: 'not scheduled for today' }));
  }
  const date = now.toISOString().slice(0, 10);
  if (state.automationLastRunDate === date) {
    res.statusCode = 200; return res.end(JSON.stringify({ ok: true, skipped: 'already ran today' }));
  }
  const origin = process.env.MINE_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://mine-console.vercel.app');
  const result = await runProviderMaintenance(state, config.modelId, origin);
  if (!result.success) { res.statusCode = 422; return res.end(JSON.stringify({ ok: false, error: result.error })); }
  state.automationLastRunDate = date;
  state.automationHistory = [result.report, ...(Array.isArray(state.automationHistory) ? state.automationHistory : [])].slice(0, 30);
  try { await saveState(state); }
  catch (_) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, error: 'Could not persist maintenance report' })); }
  res.setHeader('Content-Type', 'application/json'); res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, reportId: result.report.id, tested: result.report.tested, failed: result.report.failed }));
};
