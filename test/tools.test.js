'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { calculator, buildTeamToolDefinitions, executeTeamTool } = require('../lib/gateway/tools');

test('calculator evaluates arithmetic without dynamic code execution', () => {
  assert.strictEqual(calculator('(12 * 7) + 3'), 87);
  assert.strictEqual(calculator('2^3'), 8);
  assert.throws(() => calculator('process.exit()'));
  assert.throws(() => calculator('1 / 0'));
  assert.throws(() => calculator('2^99'));
});

test('team tool definitions include only explicitly enabled tools', () => {
  const tools = buildTeamToolDefinitions(['calculator', 'memory_search']);
  assert.deepStrictEqual(tools.map((tool) => tool.function.name), ['calculator', 'memory.search']);
  assert.ok(tools.every((tool) => tool.type === 'function'));
});

test('memory tools enforce model permissions and write through the memory store', () => {
  const state = {};
  const written = [];
  const result = executeTeamTool(state, 'memory.write', {
    title: 'Agent note',
    content: 'A verified project detail.',
    scope: 'shared',
  }, 'provider/model-a', (record) => written.push(record));
  assert.strictEqual(result.title, 'Agent note');
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0].id, result.id);
  const read = executeTeamTool(state, 'memory.read', { id: result.id }, 'provider/model-a');
  assert.strictEqual(read.content, 'A verified project detail.');
  assert.throws(() => executeTeamTool(state, 'memory.read', { id: result.id }, 'provider/model-b'));
});
