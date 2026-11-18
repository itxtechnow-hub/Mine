'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { createGateway } = require('../lib/gateway/server');

function request(gateway, body, options) {
  const opts = options || {};
  const captured = { status: 200, headers: {}, body: '' };
  const req = {
    method: opts.method || 'POST',
    url: opts.url || '/mcp',
    headers: { host: 'localhost', ...(opts.headers || {}) },
    rawBody: body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)),
  };
  const res = {
    writeHead(status, headers) { captured.status = status; captured.headers = headers || {}; },
    end(value) { captured.body = value == null ? '' : String(value); },
  };
  return gateway.handleRequest(req, res).then(() => ({
    status: captured.status,
    headers: captured.headers,
    body: captured.body ? JSON.parse(captured.body) : null,
  }));
}

test('MCP endpoint authenticates the API key and initializes Streamable HTTP', async () => {
  const gateway = createGateway({
    settings: { gatewayApiKey: 'mcp-test-secret', vkey: true },
    teams: [{ id: 'team-1', slug: 'research', name: 'Research Team', enabled: true }],
    models: [{ id: 'provider/model-a', providerId: 'provider-a' }],
    providers: [{ id: 'provider-a', name: 'Provider A' }],
  });
  const denied = await request(gateway, { jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.strictEqual(denied.status, 401);

  const initialized = await request(gateway, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, {
    url: '/mcp?apiKey=mcp-test-secret',
  });
  assert.strictEqual(initialized.status, 200);
  assert.strictEqual(initialized.body.result.serverInfo.name, 'mine-gateway');
  assert.ok(initialized.body.result.capabilities.tools);
});

test('MCP tools/list and Mine catalog tools expose teams and models', async () => {
  const gateway = createGateway({
    settings: { gatewayApiKey: 'mcp-test-secret' },
    teams: [{ id: 'team-1', slug: 'research', name: 'Research Team', enabled: true }],
    models: [{ id: 'provider/model-a', providerId: 'provider-a' }],
    providers: [{ id: 'provider-a', name: 'Provider A' }],
  });
  const headers = { authorization: 'Bearer mcp-test-secret' };
  const listed = await request(gateway, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, { headers });
  assert.strictEqual(listed.status, 200);
  assert.deepStrictEqual(listed.body.result.tools.map((tool) => tool.name), [
    'mine_list_models', 'mine_list_teams', 'mine_chat_completion',
  ]);

  const models = await request(gateway, {
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mine_list_models', arguments: {} },
  }, { headers });
  assert.ok(models.body.result.structuredContent.some((item) => item.id === 'mine/team/research'));
  assert.ok(models.body.result.structuredContent.some((item) => item.id === 'provider/model-a'));

  const teams = await request(gateway, {
    jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mine_list_teams', arguments: {} },
  }, { headers });
  assert.strictEqual(teams.body.result.structuredContent[0].model, 'mine/team/research');
});
