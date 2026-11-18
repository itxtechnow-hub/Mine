'use strict';

/**
 * The OpenAI-compatible gateway.
 *
 * vercel.json rewrites /v1/* and /health here. The original path is either
 * still in req.url or carried in the `__p` query parameter.
 */

const { handleGatewayRequest } = require('../lib/gateway-runtime');
const { errorResponse } = require('../lib/gateway/http-util');
const { rawBody } = require('./_body');

function resolvePath(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/health' || url.pathname === '/v1' || url.pathname.startsWith('/v1/')) {
    return url.pathname.replace(/\/+$/, '') || '/';
  }
  const p = url.searchParams.get('__p');
  if (p === '__health' || p === 'health') return '/health';
  if (p !== null) return ('/v1/' + p.replace(/^\/+/, '')).replace(/\/+$/, '');
  return url.pathname;
}

module.exports = async function gateway(req, res) {
  const pathname = resolvePath(req);
  try {
    if (req.method === 'POST') req.rawBody = await rawBody(req);
  } catch (err) {
    return errorResponse(res, 413, err.message);
  }
  try {
    await handleGatewayRequest(req, res, pathname);
  } catch (err) {
    console.error('[mine] gateway error:', err);
    if (!res.headersSent) errorResponse(res, 500, 'Internal gateway error: ' + err.message);
    else
      try {
        res.end();
      } catch (_) {}
  }
};

module.exports.resolvePath = resolvePath;
