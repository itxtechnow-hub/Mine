'use strict';

/**
 * Console sessions.
 *
 * A session is a signed, HttpOnly, SameSite=Strict cookie:
 *   mine_session = <expiresAt>.<nonce>.<hmac>
 * The HMAC covers the password salt, so changing the password signs every
 * existing session out.
 */

const crypto = require('crypto');
const { deriveKey } = require('./storage');

const COOKIE = 'mine_session';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload, salt) {
  return crypto
    .createHmac('sha256', deriveKey('session'))
    .update(payload + '|' + (salt || ''))
    .digest('base64url');
}

function issue(salt) {
  const exp = Date.now() + TTL_MS;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const payload = exp + '.' + nonce;
  return payload + '.' + sign(payload, salt);
}

function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    });
  return out;
}

function verify(req, salt) {
  if (!salt) return false;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, mac] = parts;
  if (!(Number(exp) > Date.now())) return false;
  const expected = sign(exp + '.' + nonce, salt);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isSecure(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https' || !!process.env.VERCEL;
}

function setCookie(res, req, token) {
  const parts = [
    COOKIE + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + Math.floor(TTL_MS / 1000),
  ];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res, req) {
  const parts = [COOKIE + '=', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = { issue, verify, setCookie, clearCookie, COOKIE };
