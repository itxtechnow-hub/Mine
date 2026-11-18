'use strict';

/**
 * Local runner that mirrors the Vercel deployment: static files from
 * ./public, /api/rpc, and the /v1 + /health rewrites to /api/gateway.
 *
 *   npm run dev            -> http://localhost:3000
 *   PORT=8080 npm run dev
 *
 * Data is kept in ./.data unless KV / Blob environment variables are set.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env / .env.local if present (no dependency needed).
for (const f of ['.env', '.env.local']) {
  try {
    const text = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
}

const rpc = require('./api/rpc');
const gateway = require('./api/gateway');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/api/rpc') return rpc(req, res);
  if (p === '/api/gateway' || p === '/health' || p === '/v1' || p.startsWith('/v1/')) return gateway(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
  res.statusCode = 405;
  res.end();
});

const port = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3000;
server.listen(port, () => {
  console.log('Mine console  http://localhost:' + port);
  console.log('Gateway       http://localhost:' + port + '/v1');
});

module.exports = server;
