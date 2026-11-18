'use strict';

/**
 * Persistent state for Mine on Vercel.
 *
 * The whole vault is one JSON document, encrypted with AES-256-GCM before it
 * leaves the function. Three backends are supported and picked automatically:
 *
 *   1. Upstash Redis / Vercel KV  (KV_REST_API_URL + KV_REST_API_TOKEN, or
 *      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). Strongly consistent,
 *      the best choice when you have it.
 *   2. Vercel Blob                (BLOB_READ_WRITE_TOKEN). Every save writes a
 *      new immutable version, so reads never hit a stale CDN copy; older
 *      versions are pruned.
 *   3. Local file in /tmp          (fallback for `npm run dev` and for a
 *      deployment with no storage attached; NOT durable on Vercel).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STATE_KEY = 'mine:state:v1';
const BLOB_PATH = process.env.MINE_BLOB_PATH || 'mine-vault/state.enc.json';

// ── Encryption ──────────────────────────────────────────────────────────────

function storageSecretSource() {
  return (
    process.env.MINE_SECRET ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_STORE_ID ||
    'mine-dev-only-secret-change-me'
  );
}

function deriveKey(label) {
  return crypto.createHash('sha256').update('mine|' + label + '|' + storageSecretSource()).digest();
}

const ENC_KEY = () => deriveKey('vault-encryption');

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({
    mine: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

function unseal(text) {
  if (!text) return null;
  const env = typeof text === 'string' ? JSON.parse(text) : text;
  if (!env || !env.mine) return env; // plaintext (should not happen)
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY(), Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

// ── Backends ────────────────────────────────────────────────────────────────

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function createRedisBackend(cfg) {
  async function cmd(args) {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error('Redis error: ' + (json.error || res.status));
    return json.result;
  }
  return {
    name: 'Upstash Redis (Vercel KV)',
    durable: true,
    async read() {
      return cmd(['GET', STATE_KEY]);
    },
    async write(text) {
      await cmd(['SET', STATE_KEY, text]);
    },
    async clear() {
      await cmd(['DEL', STATE_KEY]);
    },
  };
}

/**
 * Vercel Blob backend. `api` is the @vercel/blob module (injectable for tests).
 *
 * One blob, overwritten in place, read with `useCache: false` so every read
 * comes from origin storage. Works with both private and public stores: a
 * private write is tried first and the access type the store accepts is
 * remembered.
 */
function createBlobBackend(api) {
  const auth = {};
  if (process.env.BLOB_READ_WRITE_TOKEN) auth.token = process.env.BLOB_READ_WRITE_TOKEN;
  let access = process.env.MINE_BLOB_ACCESS || null; // 'private' | 'public'
  let etag = null;

  async function readStream(stream) {
    const reader = stream.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function tryGet(acc) {
    const res = await api.get(BLOB_PATH, { access: acc, useCache: false, ...auth });
    if (!res) return null;
    if (res.statusCode !== 200 || !res.stream) return null;
    etag = (res.blob && res.blob.etag) || null;
    return readStream(res.stream);
  }

  return {
    name: 'Vercel Blob',
    durable: true,
    async read() {
      const order = access ? [access] : ['private', 'public'];
      let lastErr = null;
      for (const acc of order) {
        try {
          const text = await tryGet(acc);
          if (text !== null) {
            access = acc;
            return text;
          }
          if (access) return null;
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr && access) throw lastErr;
      return null;
    },
    async write(text) {
      const order = access ? [access] : ['private', 'public'];
      let lastErr = null;
      for (const acc of order) {
        try {
          const res = await api.put(BLOB_PATH, text, {
            access: acc,
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
            cacheControlMaxAge: 60,
            ...auth,
          });
          access = acc;
          etag = (res && res.etag) || null;
          return;
        } catch (err) {
          lastErr = err;
          if (!/access|private|public/i.test(String(err && err.message))) break;
        }
      }
      throw lastErr;
    },
    async clear() {
      try {
        await api.del(BLOB_PATH, auth);
      } catch (_) {}
      etag = null;
    },
    get etag() {
      return etag;
    },
  };
}

function createFileBackend(file) {
  return {
    name: process.env.VERCEL ? 'Temporary (/tmp – attach Blob or KV!)' : 'Local file',
    durable: !process.env.VERCEL,
    async read() {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (_) {
        return null;
      }
    },
    async write(text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    async clear() {
      try {
        fs.unlinkSync(file);
      } catch (_) {}
    },
  };
}

let backend = null;

function getBackend() {
  if (backend) return backend;
  const redis = redisConfig();
  if (redis) {
    backend = createRedisBackend(redis);
  } else if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    backend = createBlobBackend(require('@vercel/blob'));
  } else {
    const dir = process.env.MINE_DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', '.data'));
    backend = createFileBackend(path.join(dir, 'mine-state.enc.json'));
  }
  return backend;
}

function setBackend(b) {
  backend = b;
}

// ── Public API ──────────────────────────────────────────────────────────────

const DEFAULTS = () => ({
  keys: [],
  settings: {},
  providers: [],
  customProviders: [],
  pinnedModels: [],
  modelQueue: [],
  usageHistory: [],
  auth: { enabled: false, hash: null, salt: null },
  teams: [],
  modelLiveness: {},
});

async function loadState() {
  const b = getBackend();
  const raw = await b.read();
  let state = null;
  if (raw) {
    try {
      state = unseal(raw);
    } catch (err) {
      throw new Error(
        'Could not decrypt the stored vault. Did MINE_SECRET change? (' + err.message + ')'
      );
    }
  }
  return { ...DEFAULTS(), ...(state || {}) };
}

async function saveState(state) {
  const text = seal(state);
  await getBackend().write(text);
  return text.length;
}

async function clearState() {
  await getBackend().clear();
}

function backendInfo() {
  const b = getBackend();
  return { name: b.name, durable: !!b.durable };
}

/**
 * Synchronous electron-store-like facade over an in-memory state object, so
 * the original analytics / liveness modules work unchanged.
 */
class MemStore {
  constructor(state) {
    this.store = state;
    this.dirty = false;
  }
  get(key, def) {
    return Object.prototype.hasOwnProperty.call(this.store, key) && this.store[key] !== undefined
      ? this.store[key]
      : def;
  }
  set(key, value) {
    this.store[key] = value;
    this.dirty = true;
  }
  delete(key) {
    delete this.store[key];
    this.dirty = true;
  }
  clear() {
    for (const k of Object.keys(this.store)) delete this.store[k];
    Object.assign(this.store, DEFAULTS());
    this.dirty = true;
  }
}

module.exports = {
  loadState,
  saveState,
  clearState,
  backendInfo,
  getBackend,
  setBackend,
  createBlobBackend,
  createFileBackend,
  createRedisBackend,
  deriveKey,
  seal,
  unseal,
  MemStore,
  DEFAULTS,
};
