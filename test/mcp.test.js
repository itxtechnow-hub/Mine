'use strict';

const assert = require('assert');
const { test } = require('node:test');
const storage = require('../lib/storage');
const mcp = require('../api/mcp');

async function callMcp(body, options) {
  const opts = options || {};
  const captured = { status: 200, headers: {}, body: '' };
  const req = {
    method: 'POST',
    url: opts.url || '/mcp',
    headers: opts.headers || {},
    body: JSON.stringify(body),
  };
  const res = {
    statusCode: 200,
    setHeader(name, value) { captured.headers[name] = value; },
    end(value) { captured.status = this.statusCode; captured.body = value == null ? '' : String(value); },
  };
  await mcp(req, res);
  return { status: captured.status, headers: captured.headers, body: captured.body ? JSON.parse(captured.body) : null };
}

test('deployed /mcp endpoint accepts gateway API key in query and lists Mine tools', async () => {
  let raw = null;
  storage.setBackend({ name: 'test-memory', durable: false, async read() { return raw; }, async write(value) { raw = value; }, async clear() { raw = null; } });
  await storage.saveState({
    ...storage.DEFAULTS(),
    settings: { gatewayApiKey: 'mcp-test-secret' },
    teams: [{ id: 'team-1', slug: 'research', name: 'Research Team', enabled: true, nodes: [
      { id: 'leader', type: 'planner', model: 'provider/leader' },
      { id: 'researcher', type: 'worker', model: 'provider/research', specialty: 'research' },
      { id: 'writer', type: 'worker', model: 'provider/writer', specialty: 'writing' },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ] }],
    fetchedModels: [{ id: 'provider/model-a', providerId: 'provider-a' }],
  });

  const denied = await callMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.strictEqual(denied.status, 401);

  const initialized = await callMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, {
    url: '/mcp?apiKey=mcp-test-secret',
  });
  assert.strictEqual(initialized.status, 200);
  assert.strictEqual(initialized.body.result.serverInfo.name, 'mine');

  const listed = await callMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, {
    headers: { authorization: 'Bearer mcp-test-secret' },
  });
  const names = listed.body.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('memory.search'));
  assert.ok(names.includes('mine_list_models'));
  assert.ok(names.includes('mine_list_teams'));
  assert.ok(names.includes('mine_chat_completion'));

  const apiKeyHeader = await callMcp({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, {
    headers: { 'x-api-key': 'mcp-test-secret' },
  });
  assert.strictEqual(apiKeyHeader.status, 200);
  assert.ok(apiKeyHeader.body.result.tools.length > 0);
});

test('deployed MCP model and team catalog tools return current Mine entries', async () => {
  let raw = null;
  storage.setBackend({ name: 'test-memory', durable: false, async read() { return raw; }, async write(value) { raw = value; }, async clear() { raw = null; } });
  await storage.saveState({
    ...storage.DEFAULTS(),
    settings: { gatewayApiKey: 'mcp-test-secret' },
    teams: [{ id: 'team-1', slug: 'research', name: 'Research Team', enabled: true, nodes: [
      { id: 'leader', type: 'planner', model: 'provider/leader' },
      { id: 'researcher', type: 'worker', model: 'provider/research', specialty: 'research' },
      { id: 'writer', type: 'worker', model: 'provider/writer', specialty: 'writing' },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ] }],
    fetchedModels: [{ id: 'provider/model-a', providerId: 'provider-a' }],
  });
  const headers = { authorization: 'Bearer mcp-test-secret' };
  const models = await callMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mine_list_models', arguments: {} } }, { headers });
  assert.ok(models.body.result.structuredContent.some((item) => item.id === 'mine/team/research'));
  assert.ok(models.body.result.structuredContent.some((item) => item.id === 'provider/model-a'));

  const teams = await callMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mine_list_teams', arguments: {} } }, { headers });
  assert.strictEqual(teams.body.result.structuredContent[0].model, 'mine/team/research');
  assert.deepStrictEqual(teams.body.result.structuredContent[0].configuredRoles, ['planner', 'worker', 'synthesizer']);
  assert.strictEqual(teams.body.result.structuredContent[0].workerTemplates.length, 2);
  assert.strictEqual(teams.body.result.structuredContent[0].workerTemplates[0].configured, true);
});
