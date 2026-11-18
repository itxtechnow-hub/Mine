'use strict';

const { handleRpc } = require('../lib/rpc');
const { rawBody } = require('./_body');

module.exports = async function rpc(req, res) {
  let body = null;
  try {
    const buf = await rawBody(req, 20 * 1024 * 1024);
    body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch (err) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
  }
  return handleRpc(req, res, body);
};
