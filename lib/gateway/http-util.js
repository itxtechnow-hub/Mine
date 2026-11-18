'use strict';

const crypto = require('crypto');

const MAX_LOG_ENTRIES = 100;
const DEFAULT_TIMEOUT_MS = 30000;

// The hosted gateway is a public, bearer-authenticated API (like OpenAI's), so
// browser clients on any origin may call it. Cookies are never accepted here.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-ID, X-Mine-Agent, X-Api-Key, Anthropic-Version, OpenAI-Organization, OpenAI-Project',
  'Access-Control-Expose-Headers': 'x-resolved-model, x-provider',
  'Access-Control-Max-Age': '86400',
};

const PROXY_PATHS = [
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/embeddings',
];

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

function errorResponse(res, status, message, type) {
  jsonResponse(res, status, { error: { message, type: type || 'api_error' } });
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function readBody(req) {
  // Some runtimes hand over a pre-read body.
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Constant-time credential comparison.
 *
 * A plain `===` leaks the key length and prefix through timing, which is
 * enough to brute-force a local key byte by byte. timingSafeEqual requires
 * equal-length buffers, so the length is compared first (that leak is benign
 * for a fixed-length key).
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

class CircularLog {
  constructor(max) {
    this.max = max;
    this.items = [];
  }
  push(item) {
    this.items.unshift(item);
    if (this.items.length > this.max) this.items.length = this.max;
  }
  all() {
    return this.items.slice();
  }
  clear() {
    this.items = [];
  }
}

module.exports = {
  MAX_LOG_ENTRIES,
  DEFAULT_TIMEOUT_MS,
  CORS_HEADERS,
  PROXY_PATHS,
  MAX_BODY_BYTES,
  jsonResponse,
  errorResponse,
  readBody,
  safeEqual,
  CircularLog,
};
