'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { nextRunAt, scheduleAutomation } = require('../lib/scheduler');

test('durable automation scheduling', async (t) => {
  await t.test('computes the next daily run in the selected local timezone', () => {
    const next = nextRunAt({ frequency: 'daily', time: '09:30', timezone: 'Asia/Karachi' }, new Date('2026-11-20T05:00:00.000Z'));
    assert.equal(next.toISOString(), '2026-11-21T04:30:00.000Z');
  });

  await t.test('computes the next weekly run on the selected weekday and local time', () => {
    const next = nextRunAt({ frequency: 'weekly', day: 1, time: '10:00', timezone: 'UTC' }, new Date('2026-11-20T05:00:00.000Z'));
    assert.equal(next.toISOString(), '2026-11-23T10:00:00.000Z');
  });

  await t.test('moves a missed weekly time to the following week', () => {
    const next = nextRunAt({ frequency: 'weekly', day: 1, time: '10:00', timezone: 'UTC' }, new Date('2026-11-23T10:30:00.000Z'));
    assert.equal(next.toISOString(), '2026-11-30T10:00:00.000Z');
  });

  await t.test('preserves local wall-clock time across daylight-saving changes', () => {
    const next = nextRunAt({ frequency: 'daily', time: '09:00', timezone: 'America/New_York' }, new Date('2026-03-07T15:00:00.000Z'));
    assert.equal(next.toISOString(), '2026-03-08T13:00:00.000Z');
  });

  await t.test('does not require Vercel credentials in local tests', async () => {
    const previous = process.env.VERCEL;
    delete process.env.VERCEL;
    try {
      const result = await scheduleAutomation({ enabled: true, scheduleId: 'test', frequency: 'daily', time: '08:00', timezone: 'UTC' }, new Date('2026-11-20T00:00:00.000Z'));
      assert.equal(result.scheduled, false);
      assert.match(result.reason, /Vercel deployment/);
    } finally {
      if (previous !== undefined) process.env.VERCEL = previous;
    }
  });
});
