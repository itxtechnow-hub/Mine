'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runDelegationGraph } = require('../lib/gateway/delegation-graph');

test('LangGraph fans out task-scoped workers with bounded concurrency', async () => {
  let active = 0;
  let maximumActive = 0;
  const received = [];
  const tasks = Array.from({ length: 7 }, (_, index) => ({
    taskIndex: index + 1,
    prompt: 'Only task ' + (index + 1),
    privateContext: 'context-' + (index + 1),
  }));
  const results = await runDelegationGraph(tasks, async (task) => {
    assert.deepEqual(Object.keys(task).sort(), ['privateContext', 'prompt', 'taskIndex']);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    received.push(task.prompt);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    return { taskIndex: task.taskIndex, text: task.prompt, ok: true };
  }, 2);

  assert.equal(maximumActive, 2);
  assert.deepEqual(received.sort(), tasks.map((task) => task.prompt).sort());
  assert.deepEqual(results.map((result) => result.taskIndex), [1, 2, 3, 4, 5, 6, 7]);
});
