'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  isPrivateAddress,
  resolvePublicHost,
  validateEndpoint,
  cleanToolList,
} = require('../lib/gateway/mcp-client');

test('MCP client rejects loopback, private, link-local and reserved addresses', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.1.2', '192.168.1.4', '169.254.1.2', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('MCP endpoint requires HTTPS and blocks unsafe DNS answers', async () => {
  await assert.rejects(validateEndpoint('http://example.com/mcp'), /HTTPS/);
  await assert.rejects(validateEndpoint('https://user:pass@example.com/mcp'), /Credentials/);
  await assert.rejects(validateEndpoint('https://localhost/mcp'), /public hostname/);
  await assert.rejects(validateEndpoint('https://example.com/mcp', async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]), /public IP/);
});

test('MCP endpoint resolves and pins a public address', async () => {
  const checked = await validateEndpoint('https://mcp.example.com/rpc', async () => [
    { address: '203.0.113.10', family: 4 },
  ]).catch((error) => error);
  // TEST-NET ranges are reserved and therefore intentionally blocked.
  assert.match(checked.message, /public IP/);
  const safe = await validateEndpoint('https://mcp.example.com/rpc', async () => [
    { address: '8.8.8.8', family: 4 },
  ]);
  assert.equal(safe.resolved.address, '8.8.8.8');
});

test('remote MCP tools are normalized, bounded and namespaced', () => {
  const tools = cleanToolList([
    { name: 'search', description: 'Search docs', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
    { name: 'bad name' },
    { name: 'read_file', inputSchema: { type: 'string' } },
  ], 'docs-server');
  assert.deepEqual(tools.map((tool) => tool.function.name), ['mcp_docs_server_search', 'mcp_docs_server_read_file']);
  assert.equal(tools[0].function.parameters.additionalProperties, false);
  assert.deepEqual(tools[1].function.parameters, { type: 'object', properties: {}, additionalProperties: false });
});
