'use strict';

const { send } = require('@vercel/queue');
const TOPIC = 'mine-automation-schedule';
const WEEK = 7 * 24 * 60 * 60;

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}
function localDateTimeToUtc(parts, timeZone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const actual = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0);
    guess += target - represented;
  }
  return new Date(guess);
}
function nextRunAt(config, after) {
  const now = after instanceof Date ? after : new Date(after || Date.now());
  const timezone = String(config && config.timezone || 'UTC');
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(config && config.time || '')) ? String(config.time) : '03:00';
  const [hour, minute] = time.split(':').map(Number);
  const local = zonedParts(now, timezone);
  const dayBase = new Date(Date.UTC(local.year, local.month - 1, local.day));
  let offset = 0;
  if (config && config.frequency === 'weekly') {
    const targetDay = Math.max(0, Math.min(6, Number(config.day) || 0));
    offset = (targetDay - dayBase.getUTCDay() + 7) % 7;
  }
  let candidate = localDateTimeToUtc({ year: dayBase.getUTCFullYear(), month: dayBase.getUTCMonth() + 1, day: dayBase.getUTCDate() + offset, hour, minute, second: 0 }, timezone);
  if (candidate.getTime() <= now.getTime() + 1000) {
    const nextDay = new Date(Date.UTC(dayBase.getUTCFullYear(), dayBase.getUTCMonth(), dayBase.getUTCDate() + (config && config.frequency === 'weekly' ? 7 : 1)));
    candidate = localDateTimeToUtc({ year: nextDay.getUTCFullYear(), month: nextDay.getUTCMonth() + 1, day: nextDay.getUTCDate(), hour, minute, second: 0 }, timezone);
  }
  return candidate;
}
async function scheduleAutomation(config, after) {
  if (!config || !config.enabled || !config.scheduleId) return { scheduled: false, reason: 'disabled' };
  const runAt = nextRunAt(config, after);
  if (!process.env.VERCEL) return { scheduled: false, runAt: runAt.toISOString(), reason: 'queue activates on Vercel deployment' };
  const delaySeconds = Math.max(0, Math.min(WEEK, Math.ceil((runAt.getTime() - Date.now()) / 1000)));
  const result = await send(TOPIC, { scheduleId: config.scheduleId, runAt: runAt.toISOString() }, {
    idempotencyKey: 'mine-automation:' + config.scheduleId + ':' + runAt.toISOString(),
    delaySeconds, retentionSeconds: WEEK,
  });
  return { scheduled: true, runAt: runAt.toISOString(), messageId: result.messageId };
}
module.exports = { TOPIC, nextRunAt, scheduleAutomation };
