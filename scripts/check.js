'use strict';

/**
 * Build step for Vercel: verifies every server module loads and the static
 * console is present. Fails the deploy early instead of at first request.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  'public/index.html',
  'public/src/ui/js/lib/web-bridge.js',
  'public/src/ui/js/app.js',
  'public/src/ui/js/views/memory.js',
  'public/assets/mine_icon.png',
];
for (const f of required) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error('Missing ' + f);
    process.exit(1);
  }
}

for (const m of ['api/rpc.js', 'api/gateway.js', 'api/mcp.js', 'lib/rpc.js', 'lib/gateway-runtime.js', 'lib/storage.js', 'lib/cloud-memory.js']) {
  require(path.join(root, m));
}

const storage = require('../lib/storage');
const backend = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  ? 'Upstash Redis / Vercel KV'
  : process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
    ? 'Vercel Blob'
    : 'NONE (data will not persist - connect a Blob store or Upstash Redis)';
console.log('[mine] storage backend: ' + backend);
if (!process.env.MINE_SECRET) {
  console.log('[mine] tip: set MINE_SECRET to a long random string so the vault key never depends on a storage token.');
}
void storage;
console.log('[mine] build check passed');
