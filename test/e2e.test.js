'use strict';

/**
 * End-to-end: console API + gateway against a mock OpenAI-compatible
 * upstream. Runs the same handlers Vercel runs, through dev-server.js.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, before, after } = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mine-e2e-'));
process.env.MINE_DATA_DIR = dataDir;
process.env.MINE_SECRET = 'test-secret-' + Date.now();
process.env.PORT = '0';
delete process.env.VERCEL;

let upstream;
let upstreamUrl;
let server;
let base;
let cookie = '';
const seen = [];

function startUpstream() {
  return new Promise((resolve) => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const auth = req.headers.authorization || '';
        seen.push({ path: req.url, auth, body: body ? JSON.parse(body) : null });
        if (req.url.endsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ data: [{ id: 'good-model' }, { id: 'other-model' }] }));
        }
        if (auth === 'Bearer key-limited') {
          res.writeHead(429, { 'content-type': 'application/json' });
          return res.end('{"error":{"message":"slow down"}}');
        }
        if (auth === 'Bearer team-key-limited') {
          res.writeHead(429, { 'content-type': 'application/json' });
          return res.end('{"error":{"message":"team key rate limited"}}');
        }
        if (auth === 'Bearer team-key-plan') {
          res.writeHead(403, { 'content-type': 'application/json' });
          return res.end('{"error":{"code":"free_tier_requires_subscription","message":"This model requires a paid plan"}}');
        }
        if (auth === 'Bearer key-dead') {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end('{"error":{"message":"bad key"}}');
        }
        const parsed = JSON.parse(body || '{}');
        if (parsed.model === 'missing-model') {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end('{"error":{"message":"no such model"}}');
        }
        if (Array.isArray(parsed.tools) && parsed.tools.some((tool) => tool.function && tool.function.name === 'spawn_subagent') &&
            !(parsed.messages || []).some((message) => message.role === 'tool')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({
            id: 'spawn-call',
            choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{
              id: 'spawn-e2e-1',
              type: 'function',
              function: { name: 'spawn_subagent', arguments: '{"task":"Complete the requested task","specialty":"general"}' },
            }] } }],
            usage: { total_tokens: 8 },
          }));
        }
        if ((parsed.messages || []).some((message) => message.role === 'tool' && String(message.tool_call_id || '').startsWith('spawn-'))) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({
            id: 'spawn-result',
            choices: [{ index: 0, message: { role: 'assistant', content: 'echo:good-model' } }],
            usage: { total_tokens: 10 },
          }));
        }
        if (Array.isArray(parsed.tools) && parsed.tools.some((tool) => tool.function && tool.function.name === 'calculator') &&
            !(parsed.messages || []).some((message) => message.role === 'tool')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({
            id: 'tool-call',
            choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{
              id: 'calc-e2e-1',
              type: 'function',
              function: { name: 'calculator', arguments: '{"expression":"6 * 7"}' },
            }] } }],
            usage: { total_tokens: 9 },
          }));
        }
        if ((parsed.messages || []).some((message) => message.role === 'tool')) {
          const toolMessage = parsed.messages.find((message) => message.role === 'tool');
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({
            id: 'tool-result',
            choices: [{ index: 0, message: { role: 'assistant', content: 'The executed calculator returned ' + toolMessage.content } }],
            usage: { total_tokens: 12 },
          }));
        }
        if ((parsed.messages || []).some((message) => String(message.content || '').includes('provider health results'))) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ id: 'maintenance-analysis', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ summary: 'Provider health review completed.', recommendations: [] }) } }] }));
        }
        if (parsed.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
          setTimeout(() => {
            res.write('data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":7}}\n\n');
            res.end('data: [DONE]\n\n');
          }, 30);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'x',
            object: 'chat.completion',
            model: parsed.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'echo:' + parsed.model } }],
            usage: { total_tokens: 11 },
          })
        );
      });
    });
    upstream.listen(0, '127.0.0.1', () => {
      upstreamUrl = 'http://127.0.0.1:' + upstream.address().port + '/v1';
      resolve();
    });
  });
}

async function rpc(method, ...args) {
  const res = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ method, args }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const json = await res.json();
  return { status: res.status, ...json };
}

before(async () => {
  await startUpstream();
  server = require('../dev-server.js');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  server.close();
  upstream.close();
});

let gatewayKey;

test('fresh deployment requires creating a password, then a session', async () => {
  let st = await rpc('auth:getStatus');
  assert.strictEqual(st.result.needsSetup, true);
  assert.strictEqual(st.result.authenticated, false);

  const denied = await rpc('store:get', 'keys');
  assert.strictEqual(denied.status, 401);

  const short = await rpc('auth:setPassword', { newPassword: 'short' });
  assert.strictEqual(short.result.success, false);

  const ok = await rpc('auth:setPassword', { username: 'mineowner', newPassword: 'correct horse battery' });
  assert.strictEqual(ok.result.success, true);
  assert.ok(cookie.startsWith('mine_session='));

  st = await rpc('auth:getStatus');
  assert.strictEqual(st.result.authenticated, true);
  assert.strictEqual(st.result.username, 'mineowner');
  assert.strictEqual(st.result.needsSetup, false);

  // A stranger cannot overwrite the password.
  const saved = cookie;
  cookie = '';
  const hijack = await rpc('auth:setPassword', { newPassword: 'attacker-password' });
  assert.strictEqual(hijack.result.success, false);
  const wrongUser = await rpc('auth:verify', { username: 'intruder', password: 'correct horse battery' });
  assert.strictEqual(wrongUser.result.success, false);
  const wrong = await rpc('auth:verify', { username: 'mineowner', password: 'nope-nope' });
  assert.strictEqual(wrong.result.success, false);
  const right = await rpc('auth:verify', { username: 'mineowner', password: 'correct horse battery' });
  assert.strictEqual(right.result.success, true);
  assert.ok(cookie && cookie !== saved);

  const rename = await rpc('auth:setPassword', {
    username: 'mineadmin',
    currentPassword: 'correct horse battery',
  });
  assert.strictEqual(rename.result.success, true);
  st = await rpc('auth:getStatus');
  assert.strictEqual(st.result.username, 'mineadmin');
  const renamedLogin = await rpc('auth:verify', { username: 'mineadmin', password: 'correct horse battery' });
  assert.strictEqual(renamedLogin.result.success, true);
});

test('auth hash never leaves the server', async () => {
  const a = await rpc('store:get', 'auth');
  assert.ok(!a.result || !a.result.hash);
  const all = await rpc('store:getAll');
  assert.ok(!all.result.auth);
  assert.ok(!all.result.settings.gatewayApiKey);
  const raw = fs.readFileSync(path.join(dataDir, 'mine-state.enc.json'), 'utf8');
  assert.ok(!raw.includes('correct horse'));
  assert.ok(JSON.parse(raw).mine === 1, 'state is encrypted at rest');
});

test('console can configure a provider, keys, models and the queue', async () => {
  const p = await rpc('providers:addCustom', { id: 'mock', name: 'Mock', url: upstreamUrl, custom: true });
  assert.ok(Array.isArray(p.result));

  const added = await rpc('keys:add' === 'x' ? '' : 'key:add', [
    { key: 'key-limited', provider: 'mock' },
    { key: 'key-good', provider: 'mock' },
    { key: 'key-dead', provider: 'mock' },
  ]);
  assert.strictEqual(added.result.length, 3);

  const dup = await rpc('key:add', [{ key: 'key-good', provider: 'mock' }]);
  assert.strictEqual(dup.result.length, 0, 'duplicate keys are ignored');

  const models = await rpc('models:fetchFromKeys');
  assert.strictEqual(models.result.success, true);
  assert.deepStrictEqual(models.result.models.map((m) => m.id).sort(), ['mock/good-model', 'mock/other-model']);

  const q = await rpc('store:set', 'modelQueue', [
    { id: 'mock/missing-model', provider: 'mock', rawId: 'missing-model', enabled: true },
    { id: 'mock/good-model', provider: 'mock', rawId: 'good-model', enabled: true },
  ]);
  assert.strictEqual(q.result, true);

  const test1 = await rpc('gateway:testKey', { key: 'key-good', provider: 'mock' });
  assert.strictEqual(test1.result.success, true);

  const ck = await rpc('gateway:copyKey');
  gatewayKey = ck.result.key;
  assert.ok(/^sk-mine-[0-9a-f]{48}$/.test(gatewayKey));

  const cfg = await rpc('gateway:clientConfig');
  assert.strictEqual(cfg.result.baseUrl, base + '/v1');
  assert.strictEqual(cfg.result.apiKey, '');
});

test('automation validates the selected model and runs an AI-assisted provider review', async () => {
  const models = await rpc('store:get', 'fetchedModels');
  assert.ok(Array.isArray(models.result) && models.result.some((m) => m.id === 'mock/good-model'));
  const saved = await rpc('automation:save', { enabled: true, frequency: 'weekly', day: 2, modelId: 'mock/good-model' });
  assert.strictEqual(saved.result.success, true);
  assert.strictEqual(saved.result.config.modelId, 'mock/good-model');
  const invalid = await rpc('automation:save', { enabled: true, frequency: 'daily', modelId: 'not-in-catalog' });
  assert.strictEqual(invalid.result.success, false);
  const report = await rpc('automation:run');
  assert.strictEqual(report.result.success, true);
  assert.strictEqual(report.result.report.modelId, 'mock/good-model');
  assert.ok(report.result.report.analysis && report.result.report.analysis.summary);
  const history = await rpc('automation:get');
  assert.strictEqual(history.result.history[0].id, report.result.report.id);
});
test('provider endpoint repairs require explicit approval and revalidate the catalog URL', async () => {
  await rpc('store:set', 'providers', [{ id: 'openai', url: 'https://wrong.example/v1' }]);
  await rpc('store:set', 'automationHistory', [{ id: 'repair-report', proposals: [{ id: 'repair-1', provider: 'openai', field: 'url', from: 'https://wrong.example/v1', to: 'https://api.openai.com/v1', status: 'pending' }] }]);
  const approved = await rpc('automation:approve', { reportId: 'repair-report', proposalId: 'repair-1' });
  assert.strictEqual(approved.result.success, true);
  assert.strictEqual((await rpc('store:get', 'providers')).result[0].url, 'https://api.openai.com/v1');
  assert.strictEqual((await rpc('automation:get')).result.history[0].proposals[0].status, 'approved');
});
test('automation cron endpoint rejects requests without its bearer secret', async () => {
  const response = await fetch(base + '/api/automation');
  assert.strictEqual(response.status, 401);
});
test('settings saves keep the gateway key', async () => {
  const s = await rpc('store:get', 'settings');
  assert.ok(!s.result.gatewayApiKey);
  await rpc('store:set', 'settings', { ...s.result, theme: 'dark' });
  const ck = await rpc('gateway:copyKey');
  assert.strictEqual(ck.result.key, gatewayKey);
});

function gw(pathname, body, key) {
  return fetch(base + pathname, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (key || gatewayKey) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('gateway rejects a wrong key and lists models', async () => {
  const bad = await gw('/v1/models', null, 'sk-mine-wrong');
  assert.strictEqual(bad.status, 401);
  const res = await gw('/v1/models');
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  const ids = j.data.map((m) => m.id);
  assert.ok(ids.includes('mine/auto'));
  assert.ok(ids.includes('mock/good-model'));
});

test('gateway rotates past 429 and 401 keys', async () => {
  // Two requests to be sure every key gets tried at least once.
  for (let i = 0; i < 2; i++) {
    const res = await gw('/v1/chat/completions', {
      model: 'mock/good-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.choices[0].message.content, 'echo:good-model');
    assert.strictEqual(res.headers.get('x-provider'), 'mock');
  }
  const keys = (await rpc('store:get', 'keys')).result;
  const byKey = Object.fromEntries(keys.map((k) => [k.key, k]));
  assert.strictEqual(byKey['key-good'].status, 'ACTIVE');
  assert.ok(byKey['key-good'].usageTotal >= 2);
  assert.ok(['COOLDOWN', 'ACTIVE'].includes(byKey['key-limited'].status));
  // Upstream never saw the client's gateway key.
  assert.ok(seen.every((s) => !s.auth.includes('sk-mine-')));
});

test('mine/auto falls through a missing model to the next in the queue', async () => {
  const res = await gw('/v1/chat/completions', {
    model: 'mine/auto',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.strictEqual(j.choices[0].message.content, 'echo:good-model');
  assert.strictEqual(j.resolvedModel, 'mock/good-model');
});

test('streaming responses are passed through as SSE', async () => {
  const res = await gw('/v1/chat/completions', {
    model: 'mock/good-model',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.ok(text.includes('"Hel"') && text.includes('[DONE]'));
});

test('teams run through the gateway', async () => {
  await rpc('store:set', 'teams', [
    {
      id: 't1',
      slug: 'duo',
      name: 'Duo',
      nodes: [
        { id: 'boss', type: 'planner', model: 'mock/good-model' },
        { id: 'w1', type: 'worker', model: 'mock/good-model', specialty: 'general' },
        { id: 'syn', type: 'synthesizer', model: 'mock/good-model' },
      ],
    },
  ]);
  const res = await gw('/v1/chat/completions', {
    model: 'mine/agent/duo',
    messages: [{ role: 'user', content: 'plan a picnic' }],
  });
  assert.strictEqual(res.status, 200);
  const j = await res.json();
  assert.strictEqual(j.choices[0].message.content, 'echo:good-model');
  assert.ok(Array.isArray(j.mine.nodes));
  assert.ok(j.mine.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'text')));
  assert.ok(!JSON.stringify(j.mine).includes('echo:good-model'), 'worker transcripts are not exposed in metadata');
});

test('team delegates rotate keys after a 429 instead of failing the worker', async () => {
  await rpc('providers:addCustom', { id: 'retrymock', name: 'Retry Mock', url: upstreamUrl, custom: true });
  await rpc('key:add', [
    { key: 'team-key-limited', provider: 'retrymock' },
    { key: 'team-key-good', provider: 'retrymock' },
  ]);
  // Make the rate-limited key the deterministic first candidate. Key ordering
  // is based on usage/latency, not insertion order.
  const retryKeys = (await rpc('store:get', 'keys')).result;
  await rpc('store:set', 'keys', retryKeys.map((key) => (
    key.key === 'team-key-good' ? { ...key, usageToday: 100 } :
    key.key === 'team-key-limited' ? { ...key, usageToday: 0 } : key
  )));
  await rpc('store:set', 'teams', [{
    id: 'retry-team',
    slug: 'retry',
    name: 'Retry Team',
    nodes: [
      { id: 'worker', type: 'worker', model: 'retrymock/good-model', specialty: 'general' },
      { id: 'synth', type: 'synthesizer', model: 'retrymock/good-model' },
    ],
    connections: [],
  }]);

  const res = await gw('/v1/chat/completions', {
    model: 'mine/agent/retry',
    messages: [{ role: 'user', content: 'test team key rotation' }],
  });
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.match(json.choices[0].message.content, /echo:good-model/);
  assert.ok(
    seen.some((entry) => entry.auth === 'Bearer team-key-limited'),
    'the limited key must actually be attempted; attempts=' + JSON.stringify(seen.filter((entry) => entry.auth.includes('team-key-'))),
  );
  const keys = (await rpc('store:get', 'keys')).result;
  const limited = keys.find((k) => k.key === 'team-key-limited');
  const good = keys.find((k) => k.key === 'team-key-good');
  assert.strictEqual(limited.status, 'COOLDOWN');
  assert.strictEqual(good.status, 'ACTIVE');
  assert.ok(good.usageTotal >= 1, 'the fallback key served the team request');
});

test('provider plan restriction does not mark a valid team key as dead', async () => {
  await rpc('providers:addCustom', { id: 'planmock', name: 'Plan Mock', url: upstreamUrl, custom: true });
  await rpc('key:add', [
    { key: 'team-key-plan', provider: 'planmock' },
    { key: 'team-key-plan-good', provider: 'planmock' },
  ]);
  await rpc('store:set', 'teams', [{
    id: 'plan-team',
    slug: 'plan',
    name: 'Plan Team',
    nodes: [
      { id: 'worker', type: 'worker', model: 'planmock/good-model', specialty: 'general' },
      { id: 'synth', type: 'synthesizer', model: 'planmock/good-model' },
    ],
    connections: [],
  }]);
  const response = await gw('/v1/chat/completions', {
    model: 'mine/agent/plan',
    messages: [{ role: 'user', content: 'test plan restriction handling' }],
  });
  assert.strictEqual(response.status, 200);
  const keys = (await rpc('store:get', 'keys')).result;
  const restricted = keys.find((key) => key.key === 'team-key-plan');
  const fallback = keys.find((key) => key.key === 'team-key-plan-good');
  assert.notStrictEqual(restricted.status, 'DEAD');
  assert.strictEqual(fallback.status, 'ACTIVE');
});

test('gateway diagnostics expose provider and agent health without secrets', async () => {
  const response = await rpc('gateway:diagnostics');
  assert.ok(response.result.checkedAt);
  assert.ok(Array.isArray(response.result.providers));
  assert.ok(Array.isArray(response.result.agents));
  const provider = response.result.providers.find((p) => p.id === 'retrymock');
  assert.ok(provider);
  assert.strictEqual(provider.keys.total, 2);
  assert.strictEqual(provider.keys.cooldown, 1);
  assert.strictEqual(typeof response.result.mcp.outboundClient.available, 'boolean');
  assert.strictEqual(typeof response.result.tools.workspace.available, 'boolean');
  assert.strictEqual(response.result.tools.builtIn.available, true);
  assert.ok(response.result.tools.builtIn.names.includes('calculator'));
  const serialized = JSON.stringify(response.result);
  assert.ok(!serialized.includes('team-key-limited'));
  assert.ok(!serialized.includes('team-key-good'));
});

test('inbound MCP tools/list works and requires the gateway key', async () => {
  const denied = await fetch(base + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-key' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.strictEqual(denied.status, 401);

  const response = await fetch(base + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + gatewayKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  assert.strictEqual(response.status, 200);
  const json = await response.json();
  const names = json.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('memory.list'));
  assert.ok(names.includes('memory.search'));
  assert.ok(names.includes('memory.read'));
});

test('hosted gateway executes provider function calls through the team tool runtime', async () => {
  await rpc('providers:addCustom', { id: 'toolmock', name: 'Tool Mock', url: upstreamUrl, custom: true });
  await rpc('key:add', { key: 'team-tool-key', provider: 'toolmock' });
  await rpc('store:set', 'teams', [{
    id: 'tool-e2e-team',
    slug: 'tool-e2e',
    name: 'Tool E2E Team',
    nodes: [
      { id: 'planner', type: 'planner', model: 'toolmock/good-model' },
      { id: 'worker', type: 'worker', model: 'toolmock/good-model', specialty: 'general' },
      { id: 'tools', type: 'tool', enabledTools: ['calculator'] },
      { id: 'synth', type: 'synthesizer', model: 'toolmock/good-model' },
    ],
    connections: [],
  }]);
  const response = await gw('/v1/chat/completions', {
    model: 'mine/agent/tool-e2e',
    messages: [{ role: 'user', content: 'tool execution integration test' }],
  });
  assert.strictEqual(response.status, 200);
  const toolRequests = seen.filter((request) => request.body && Array.isArray(request.body.tools) &&
    request.body.tools.some((tool) => tool.function && tool.function.name === 'calculator'));
  assert.ok(toolRequests.length >= 1, 'the gateway sent calculator tool definitions to the provider');
  const executed = seen.find((request) => request.body && Array.isArray(request.body.messages) &&
    request.body.messages.some((message) => message.role === 'tool' && /42/.test(message.content || '')));
  assert.ok(executed, 'the gateway sent the executed calculator result back to the provider');
});

test('dashboard poll sees logs, analytics and key health', async () => {
  const p = await rpc('gateway:poll', null);
  assert.ok(p.result.logs.length >= 4);
  assert.ok(p.result.analytics.allTime.requests >= 4);
  assert.ok(p.result.keys.length >= 3);
  const st = await rpc('gateway:status');
  assert.strictEqual(st.result.running, true);
  assert.ok(st.result.stats.totalRequests >= 4);
});

test('stopping the gateway returns 503, starting brings it back', async () => {
  await rpc('gateway:stop');
  const off = await gw('/v1/models');
  assert.strictEqual(off.status, 503);
  const on = await rpc('gateway:start');
  assert.strictEqual(on.result.success, true);
  const back = await gw('/v1/models');
  assert.strictEqual(back.status, 200);
});

test('backup round trip and reset keep the password', async () => {
  const enc = await rpc('crypto:encryptBackup', { text: '{"a":1}', password: 'backup-pass' });
  const dec = await rpc('crypto:decryptBackup', { bundle: enc.result.data, password: 'backup-pass' });
  assert.strictEqual(dec.result.text, '{"a":1}');
  const bad = await rpc('crypto:decryptBackup', { bundle: enc.result.data, password: 'nope' });
  assert.strictEqual(bad.result.success, false);

  await rpc('store:reset');
  const keys = await rpc('store:get', 'keys');
  assert.deepStrictEqual(keys.result, []);
  const st = await rpc('auth:getStatus');
  assert.strictEqual(st.result.authenticated, true);
  assert.strictEqual(st.result.needsSetup, false);
  const ck = await rpc('gateway:copyKey');
  assert.strictEqual(ck.result.key, gatewayKey);
});

test('cross-origin console calls are blocked', async () => {
  const res = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example' },
    body: JSON.stringify({ method: 'store:get', args: ['keys'] }),
  });
  assert.strictEqual(res.status, 403);
});

test('sign out ends the session', async () => {
  await rpc('auth:logout');
  const res = await rpc('store:get', 'keys');
  assert.strictEqual(res.status, 401);
});
