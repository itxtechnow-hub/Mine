'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Perform a single upstream HTTP request.
 *
 * Resolves with the raw IncomingMessage so the caller can stream, buffer, or
 * inspect headers. Rejects on network failure or timeout.
 */
function proxyRequest(providerUrl, path, headers, body, timeout, providerId) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = providerUrl instanceof URL ? providerUrl : new URL(providerUrl);
    } catch (err) {
      reject(new Error('Invalid provider URL: ' + (providerUrl && providerUrl.href)));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const targetPath = url.pathname + (url.search || '');

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: targetPath,
      method: 'POST',
      headers: { ...headers },
      timeout,
    };

    // Host and content-length must reflect the upstream hop, not the client.
    delete options.headers['host'];
    delete options.headers['Host'];
    delete options.headers['content-length'];
    delete options.headers['Content-Length'];
    if (body) {
      options.headers['content-length'] = Buffer.byteLength(body);
    }

    const req = lib.request(options, (res) => resolve(res));

    req.on('error', (err) => {
      reject(new Error(err.message + ' (' + (providerId || 'upstream') + ')'));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upstream request timed out'));
    });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = { proxyRequest };
