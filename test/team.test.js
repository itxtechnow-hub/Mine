'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { runTeam } = require('../lib/gateway/team');

test('Team worker delegates execute concurrently and emit independent lifecycle events', async () => {
  let active = 0;
  let maximumActive = 0;
  const events = [];
  const team = {
    id: 'parallel-team',
    nodes: [
      { id: 'worker-a', type: 'worker', model: 'provider/model-a', specialty: 'research' },
      { id: 'worker-b', type: 'worker', model: 'provider/model-b', specialty: 'coding' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Do two tasks', {
    models: [{ id: 'provider/model-a' }, { id: 'provider/model-b' }],
    modelQueue: [],
    onEvent: (event) => events.push(event),
    callModel: async (modelId, prompt, options) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return { text: modelId + ' completed', tokens: 12, usage: { totalTokens: 12 } };
    },
  });
  assert.strictEqual(maximumActive, 2);
  assert.strictEqual(result.nodes.length, 2);
  assert.ok(events.filter((event) => event.type === 'delegate.started').length >= 2);
  assert.ok(events.filter((event) => event.type === 'delegate.completed').length >= 2);
  assert.ok(result.nodes.every((node) => node.delegateId && node.modelId));
});

test('Team never silently selects an arbitrary discovered model', async () => {
  let calls = 0;
  const team = {
    id: 'explicit-model-team',
    nodes: [{ id: 'worker-empty', type: 'worker', specialty: 'general' }],
    connections: [],
  };
  const result = await runTeam(team, 'Run without assignment', {
    models: [{ id: 'provider/unselected-model' }],
    modelQueue: [],
    callModel: async () => { calls += 1; return { text: 'unexpected' }; },
  });
  assert.strictEqual(calls, 0);
  assert.match(result.nodes[0].text, /no assigned or queued model/i);
});
