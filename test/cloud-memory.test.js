'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const memory = require('../lib/cloud-memory');

function state() {
  return { cloudMemory: { records: [], audit: [], pendingDeletes: [], permissions: { read: true, write: true, update: true, delete: false }, mcpServers: [] } };
}

test('shared memory is visible to agents and can be searched', () => {
  const s = state();
  const saved = memory.write(s, { title: 'Mine plan', content: 'Keep the gateway private', scope: 'shared', format: 'markdown' }, 'agent-a', 'write');
  assert.equal(memory.read(s, saved.id, 'agent-b').content, 'Keep the gateway private');
  assert.equal(memory.search(s, 'gateway', { modelId: 'agent-b' }).length, 1);
});

test('private memory is isolated by model ID', () => {
  const s = state();
  const saved = memory.write(s, { title: 'Private notes', content: 'Only model A', scope: 'private' }, 'model-a', 'write');
  assert.equal(memory.read(s, saved.id, 'model-a').content, 'Only model A');
  assert.equal(memory.read(s, saved.id, 'model-b'), null);
  assert.equal(memory.list(s, { modelId: 'model-b' }).length, 0);
});

test('JSON memory validates its content', () => {
  const s = state();
  assert.throws(() => memory.write(s, { title: 'bad', content: '{oops', format: 'json' }, 'agent', 'write'), /valid JSON/);
  const saved = memory.write(s, { title: 'good', content: { ok: true }, format: 'json' }, 'agent', 'write');
  assert.deepEqual(JSON.parse(saved.content), { ok: true });
});

test('model deletion requests require owner approval', () => {
  const s = state();
  const saved = memory.write(s, { title: 'Decision', content: 'Keep this' }, 'agent', 'write');
  const request = memory.requestDelete(s, saved.id, 'agent');
  assert.equal(request.approvalRequired, true);
  assert.ok(memory.read(s, saved.id, 'agent'));
  const rejected = memory.approveDelete(s, request.requestId, false, 'admin');
  assert.equal(rejected.request.status, 'rejected');
  const request2 = memory.requestDelete(s, saved.id, 'agent');
  memory.approveDelete(s, request2.requestId, true, 'admin');
  assert.equal(memory.read(s, saved.id, 'agent'), null);
});

test('per-model permissions override workspace defaults', () => {
  const s = state();
  s.cloudMemory.modelPermissions = { 'model-a': { read: false, write: false, update: false } };
  assert.throws(() => memory.write(s, { title: 'blocked', content: 'nope' }, 'model-a', 'write'), /permission is disabled/);
  const shared = memory.write(s, { title: 'shared', content: 'visible' }, 'admin', 'write');
  assert.throws(() => memory.read(s, shared.id, 'model-a'), /permission is disabled/);
  assert.equal(memory.read(s, shared.id, 'model-b').content, 'visible');
});
