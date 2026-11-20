'use strict';

const { rawBody } = require('../api/_body');

async function runQueueCallback(req, res, callback) {
  const body = await rawBody(req);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (value == null || ['host', 'connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  const origin = 'https://' + String(req.headers.host || 'localhost');
  const request = new Request(new URL(req.url || '/', origin), {
    method: req.method || 'POST', headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await callback(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

module.exports = { runQueueCallback };
