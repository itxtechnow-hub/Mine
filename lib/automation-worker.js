'use strict';

const { loadState, saveState } = require('./storage');
const { runProviderMaintenance } = require('./automation');
const { scheduleAutomation, TOPIC } = require('./scheduler');
const { send } = require('@vercel/queue');

async function processAutomationSchedule(message) {
  const payload = message || {};
  if (!payload.scheduleId || !payload.runAt) throw new Error('Invalid automation schedule message.');
  let state = await loadState();
  const config = state.automationConfig || {};
  if (!config.enabled || config.scheduleId !== payload.scheduleId) return { skipped: true, reason: 'schedule changed or disabled' };
  const dueAt = new Date(payload.runAt);
  if (!Number.isFinite(dueAt.getTime())) throw new Error('Invalid automation run time.');
  if (Date.now() < dueAt.getTime() - 1000) {
    const delaySeconds = Math.min(604800, Math.max(0, Math.ceil((dueAt.getTime() - Date.now()) / 1000)));
    await send(TOPIC, payload, { idempotencyKey: 'mine-automation:' + payload.scheduleId + ':' + payload.runAt, delaySeconds, retentionSeconds: 604800 });
    return { skipped: true, reason: 'not due yet' };
  }
  if (state.automationLastRunAt === payload.runAt) { await scheduleAutomation(config, new Date()); return { skipped: true, reason: 'already completed' }; }

  const origin = process.env.MINE_PUBLIC_URL || 'https://mine-console.vercel.app';
  const result = await runProviderMaintenance(state, config.modelId, origin);
  const fresh = await loadState();
  const current = fresh.automationConfig || {};
  if (!current.enabled || current.scheduleId !== payload.scheduleId) return { skipped: true, reason: 'schedule changed during run' };
  const report = result.success ? result.report : {
    id: require('crypto').randomUUID(), timestamp: new Date().toISOString(), modelId: config.modelId,
    tested: 0, working: 0, failed: 0, providers: [], proposals: [], error: String(result.error || 'Automation failed').slice(0, 300),
  };
  fresh.automationHistory = [report, ...(Array.isArray(fresh.automationHistory) ? fresh.automationHistory : [])].slice(0, 30);
  fresh.automationLastRunAt = payload.runAt;
  fresh.automationLastRunDate = new Date().toISOString().slice(0, 10);
  await saveState(fresh);
  await scheduleAutomation(current, new Date());
  return { success: !!result.success, reportId: report.id, failed: report.failed || 0 };
}

module.exports = { processAutomationSchedule };
