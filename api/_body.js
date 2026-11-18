'use strict';

/**
 * Body helpers shared by the API functions. Vercel may have already buffered
 * and parsed the body (req.body); a plain Node server has not.
 */

function readStream(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Raw request body as a Buffer. */
async function rawBody(req, limit = 10 * 1024 * 1024) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  let parsed;
  try {
    parsed = req.body;
  } catch (_) {
    parsed = undefined;
  }
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed)) return parsed;
    if (typeof parsed === 'string') return Buffer.from(parsed, 'utf8');
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return Buffer.alloc(0);
  return readStream(req, limit);
}

module.exports = { rawBody };
