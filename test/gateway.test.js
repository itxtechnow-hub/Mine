'use strict';

/**
 * Gateway smoke tests.
 *
 * Exercises the routing, URL construction, and key rotation logic without
 * needing Electron or a network connection.
 */

const assert = require('assert');
const http = require('http');
const { test } = require('node:test');

const { resolveUpstreamUrl, resolveProvider, stripProviderPrefix, matchProvider } = require('../lib/gateway/providers');
const { safeEqual } = require('../lib/gateway/http-util');
const { selectBestUntried } = require('../lib/gateway/key-rotation');
const { createGateway } = require('../lib/gateway/server');

test('resolveUpstreamUrl preserves the provider base path', () => {
  const cases = [
    ['https://openrouter.ai/api/v1', '/v1/chat/completions', 'https://openrouter.ai/api/v1/chat/completions'],
    ['https://api.openai.com/v1', '/v1/responses', 'https://api.openai.com/v1/responses'],
    ['https://api.groq.com/openai/v1', '/v1/chat/completions', 'https://api.groq.com/openai/v1/chat/completions'],
    ['https://api.fireworks.ai/inference/v1', '/v1/chat/completions', 'https://api.fireworks.ai/inference/v1/chat/completions'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', '/v1/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['https://api.z.ai/api/paas/v4', '/v1/chat/completions', 'https://api.z.ai/api/paas/v4/chat/completions'],
    ['https://api.perplexity.ai', '/v1/chat/completions', 'https://api.perplexity.ai/chat/completions'],
    ['http://127.0.0.1:11434/v1', '/v1/chat/completions', 'http://127.0.0.1:11434/v1/chat/completions'],
    ['https://api.openai.com/v1/', '/v1/chat/completions', 'https://api.openai.com/v1/chat/completions'],
  ];

  for (const [base, path, expected] of cases) {
    const got = resolveUpstreamUrl(base, path, 'test').toString();
    assert.strictEqual(got, expected, 'base ' + base);
  }
});

test('resolveUpstreamUrl never produces a double slash', () => {
  for (const base of ['https://api.openai.com/v1', 'https://api.perplexity.ai', 'http://127.0.0.1:8080/v1/']) {
    const got = resolveUpstreamUrl(base, '/v1/chat/completions', 'x').toString();
    assert.ok(!got.replace('https://', '').replace('http://', '').includes('//'), got);
  }
});

test('resolveProvider matches by id, prefix, and name', () => {
  const providers = [{ id: 'openrouter', name: 'OpenRouter', prefix: 'or' }];
  assert.strictEqual(resolveProvider(providers, 'openrouter/llama-3'), providers[0]);
  assert.strictEqual(resolveProvider(providers, 'or/llama-3'), providers[0]);
  assert.strictEqual(resolveProvider(providers, 'OpenRouter/llama-3'), providers[0]);
  assert.strictEqual(resolveProvider(providers, 'unknown/llama-3'), null);
  assert.strictEqual(resolveProvider(providers, 'no-slash'), null);
});

test('stripProviderPrefix removes only the first namespace segment', () => {
  assert.strictEqual(stripProviderPrefix('openai/gpt-4o'), 'gpt-4o');
  assert.strictEqual(stripProviderPrefix('provider/model/extra'), 'model/extra');
  assert.strictEqual(stripProviderPrefix('bare'), 'bare');
});

test('matchProvider normalises separators and case', () => {
  assert.ok(matchProvider('Open-Router', 'openrouter'));
  assert.ok(matchProvider('open_router', 'openrouter'));
  assert.ok(!matchProvider('openai', 'openrouter'));
});

test('safeEqual compares without leaking length mismatches', () => {
  assert.strictEqual(safeEqual('abc', 'abc'), true);
  assert.strictEqual(safeEqual('abc', 'abd'), false);
  assert.strictEqual(safeEqual('abc', 'abcd'), false);
  assert.strictEqual(safeEqual(null, 'abc'), false);
});

test('selectBestUntried prefers the least-used key then the fastest', () => {
  const keys = [
    { id: 'a', provider: 'openai', usageToday: 5, lastLatency: 10 },
    { id: 'b', provider: 'openai', usageToday: 1, lastLatency: 90 },
    { id: 'c', provider: 'openai', usageToday: 1, lastLatency: 20 },
  ];
  assert.strictEqual(selectBestUntried(keys, 'openai', 60000, new Set()).id, 'c');
});

test('selectBestUntried skips dead, disabled, and cooling keys', () => {
  const keys = [
    { id: 'dead', provider: 'openai', status: 'DEAD' },
    { id: 'off', provider: 'openai', enabled: false },
    { id: 'cool', provider: 'openai', status: 'COOLDOWN', cooldownUntil: Date.now() + 60000 },
    { id: 'ok', provider: 'openai', status: 'ACTIVE' },
  ];
  assert.strictEqual(selectBestUntried(keys, 'openai', 60000, new Set()).id, 'ok');
});

test('selectBestUntried revives a key whose cooldown has expired', () => {
  const keys = [{ id: 'cool', provider: 'openai', status: 'COOLDOWN', cooldownUntil: Date.now() - 1 }];
  const picked = selectBestUntried(keys, 'openai', 60000, new Set());
  assert.strictEqual(picked.id, 'cool');
  assert.strictEqual(picked.status, 'ACTIVE');
});

test('gateway requires the bearer key and serves /health without one', async () => {
  const gateway = createGateway({
    keys: [],
    providers: [],
    models: [],
    settings: { host: '127.0.0.1', port: 4599, vkey: 1, gatewayApiKey: 'sk-test-key' },
  });
  const info = await gateway.start();
  assert.ok(info.port);

  try {
    const health = await get(4599, '/health');
    assert.strictEqual(health.status, 200);

    const unauth = await get(4599, '/v1/models');
    assert.strictEqual(unauth.status, 401);

    const auth = await get(4599, '/v1/models', 'sk-test-key');
    assert.strictEqual(auth.status, 200);
    assert.ok(Array.isArray(auth.body.data));

    const wrong = await get(4599, '/v1/models', 'sk-wrong');
    assert.strictEqual(wrong.status, 401);
  } finally {
    await gateway.stop();
  }
});

test('gateway reports a helpful error when no provider matches', async () => {
  const gateway = createGateway({
    keys: [],
    providers: [{ id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1' }],
    models: [],
    settings: { host: '127.0.0.1', port: 4598, vkey: 1, gatewayApiKey: 'sk-test-key' },
  });
  await gateway.start();

  try {
    const res = await post(4598, '/v1/chat/completions', { model: 'unknown/model' }, 'sk-test-key');
    assert.strictEqual(res.status, 400);
    assert.ok(/No provider found/.test(res.body.error.message));
  } finally {
    await gateway.stop();
  }
});

test('gateway returns 404 for an unknown route', async () => {
  const gateway = createGateway({
    keys: [],
    providers: [],
    models: [],
    settings: { host: '127.0.0.1', port: 4597, vkey: 1, gatewayApiKey: 'sk-test-key' },
  });
  await gateway.start();

  try {
    const res = await get(4597, '/nope', 'sk-test-key');
    assert.strictEqual(res.status, 404);
  } finally {
    await gateway.stop();
  }
});

function get(port, path, key) {
  return request(port, 'GET', path, key, null);
}

function post(port, path, body, key) {
  return request(port, 'POST', path, key, body);
}

function request(port, method, path, key, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (key) headers.authorization = 'Bearer ' + key;
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          parsed = null;
        }
        resolve({ status: res.statusCode, body: parsed, text });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
