'use strict';

const assert = require('assert');
const { test } = require('node:test');
const storage = require('../lib/storage');

function fakeBlobApi(storeAccess) {
  const blobs = new Map();
  return {
    blobs,
    async put(pathname, text, opts) {
      if (opts.access !== storeAccess) throw new Error('Cannot use ' + opts.access + ' access on a ' + storeAccess + ' store');
      if (blobs.has(pathname) && !opts.allowOverwrite) throw new Error('exists');
      blobs.set(pathname, text);
      return { pathname, url: 'https://x/' + pathname, etag: String(text.length) };
    },
    async get(pathname, opts) {
      if (opts.access !== storeAccess) throw new Error('access mismatch');
      if (!blobs.has(pathname)) return null;
      const data = Buffer.from(blobs.get(pathname));
      return {
        statusCode: 200,
        stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(data)); c.close(); } }),
        blob: { etag: 'e' },
      };
    },
    async del(pathname) {
      blobs.delete(pathname);
    },
  };
}

for (const access of ['private', 'public']) {
  test('blob backend round trip on a ' + access + ' store', async () => {
    const api = fakeBlobApi(access);
    storage.setBackend(storage.createBlobBackend(api));
    let st = await storage.loadState();
    assert.deepStrictEqual(st.keys, []);
    st.keys.push({ id: 'k', key: 'sk-secret-value' });
    await storage.saveState(st);
    const raw = [...api.blobs.values()][0];
    assert.ok(!raw.includes('sk-secret-value'), 'encrypted at rest');
    // A fresh backend instance (cold start) reads it back.
    storage.setBackend(storage.createBlobBackend(api));
    st = await storage.loadState();
    assert.strictEqual(st.keys[0].key, 'sk-secret-value');
    await storage.clearState();
    st = await storage.loadState();
    assert.deepStrictEqual(st.keys, []);
  });
}

test('redis backend speaks the Upstash REST protocol', async () => {
  const db = new Map();
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const [cmd, key, val] = JSON.parse(init.body);
    assert.strictEqual(init.headers.Authorization, 'Bearer tok');
    let result = null;
    if (cmd === 'GET') result = db.has(key) ? db.get(key) : null;
    if (cmd === 'SET') { db.set(key, val); result = 'OK'; }
    if (cmd === 'DEL') { db.delete(key); result = 1; }
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    storage.setBackend(storage.createRedisBackend({ url: 'https://r.example', token: 'tok' }));
    const st = await storage.loadState();
    st.settings.theme = 'dark';
    await storage.saveState(st);
    const again = await storage.loadState();
    assert.strictEqual(again.settings.theme, 'dark');
  } finally {
    global.fetch = realFetch;
  }
});

test('a different MINE_SECRET cannot read the vault', () => {
  const sealed = storage.seal({ a: 1 });
  const prev = process.env.MINE_SECRET;
  process.env.MINE_SECRET = 'another-secret';
  assert.throws(() => storage.unseal(sealed));
  process.env.MINE_SECRET = prev;
  if (prev === undefined) delete process.env.MINE_SECRET;
  assert.deepStrictEqual(storage.unseal(sealed), { a: 1 });
});
