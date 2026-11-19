'use strict';

const dns = require('dns').promises;
const https = require('https');
const net = require('net');
const crypto = require('crypto');

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12000;
const MAX_TOOLS = 80;

function ipv4Number(ip) {
  return ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
}

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const n = ipv4Number(address);
    const ranges = [
      [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10],
      [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
      [0xc0a80000, 16], [0xc0000000, 24], [0xc0000200, 24],
      [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 4],
      [0xf0000000, 4],
    ];
    return ranges.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) === (base & mask);
    });
  }
  if (version === 6) {
    const ip = address.toLowerCase().split('%')[0];
    if (ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip) || ip.startsWith('ff')) return true;
    // Only global-unicast 2000::/3 addresses are eligible. This also blocks
    // unspecified transition, benchmarking, documentation and other special ranges.
    if (!/^[23]/.test(ip) || ip.startsWith('2001:db8:') || /^2001:0*2:/i.test(ip) || ip.startsWith('2002:')) return true;
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice(7);
      if (net.isIP(mapped) === 4) return isPrivateAddress(mapped);
      const hex = mapped.split(':');
      if (hex.length === 2) {
        const a = parseInt(hex[0], 16), b = parseInt(hex[1], 16);
        return isPrivateAddress([(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join('.'));
      }
    }
    return false;
  }
  return true;
}

async function resolvePublicHost(hostname, lookup) {
  const resolver = lookup || dns.lookup.bind(dns);
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('MCP endpoint resolves to a non-public address');
    return { address: hostname, family: net.isIP(hostname) };
  }
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || !records.length || records.some((r) => isPrivateAddress(r.address))) {
    throw new Error('MCP endpoint must resolve only to public IP addresses');
  }
  return records[0];
}

async function validateEndpoint(value, lookup) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw new Error('Enter a valid MCP endpoint URL'); }
  if (url.protocol !== 'https:') throw new Error('Remote MCP endpoints must use HTTPS');
  if (url.username || url.password) throw new Error('Credentials must not be embedded in the MCP URL');
  if (url.hash) throw new Error('MCP endpoint URLs cannot contain fragments');
  if (url.port && url.port !== '443') throw new Error('Only the standard HTTPS port (443) is allowed');
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) {
    throw new Error('MCP endpoint must use a public hostname');
  }
  const resolved = await resolvePublicHost(url.hostname, lookup);
  url.search = url.search.slice(0, 512);
  return { url, resolved };
}

function parseRpcResponse(raw, contentType) {
  const text = String(raw || '').trim();
  if (!text) return {};
  if (/text\/event-stream/i.test(contentType || '')) {
    const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
    for (const item of data) {
      try { return JSON.parse(item); } catch (_) {}
    }
    throw new Error('MCP server returned no JSON-RPC result');
  }
  try { return JSON.parse(text); } catch (_) { throw new Error('MCP server returned invalid JSON'); }
}

function requestJsonRpc(endpoint, resolved, token, method, params, sessionId, notification) {
  const id = notification ? null : crypto.randomUUID();
  const body = JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, ...(params === undefined ? {} : { params }) });
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(body),
      ...(sessionId ? { 'MCP-Protocol-Version': '2025-03-26' } : {}),
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (sessionId) headers['MCP-Session-Id'] = sessionId;
    const req = https.request(endpoint, {
      method: 'POST',
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      servername: endpoint.hostname,
      lookup(_hostname, options, callback) {
        if (typeof options === 'function') callback = options;
        callback(null, resolved.address, resolved.family);
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) req.destroy(new Error('MCP response exceeded 1 MB'));
        else chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('MCP server returned HTTP ' + res.statusCode));
        if (notification) return resolve({ result: {}, sessionId: res.headers['mcp-session-id'] || sessionId || null });
        try {
          const parsed = parseRpcResponse(Buffer.concat(chunks).toString('utf8'), res.headers['content-type']);
          if (parsed.error) return reject(new Error(String(parsed.error.message || 'MCP request failed').slice(0, 300)));
          if (parsed.id !== id) return reject(new Error('MCP server returned a missing or mismatched JSON-RPC id'));
          resolve({ result: parsed.result || {}, sessionId: res.headers['mcp-session-id'] || sessionId || null });
        } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('MCP request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

function cleanInputSchema(input, depth) {
  const schema = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const level = Number(depth) || 0;
  if (level > 6) return { type: 'object', properties: {}, additionalProperties: false };
  const allowedTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);
  const type = allowedTypes.has(schema.type) ? schema.type : 'object';
  const out = { type };
  if (typeof schema.description === 'string') out.description = schema.description.slice(0, 300);
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 50).filter((value) => ['string', 'number', 'boolean'].includes(typeof value)).map((value) => typeof value === 'string' ? value.slice(0, 200) : value);
  if (type === 'object') {
    const source = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {};
    const properties = {};
    for (const [key, value] of Object.entries(source).slice(0, 40)) {
      if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key)) continue;
      properties[key] = cleanInputSchema(value, level + 1);
    }
    out.properties = properties;
    if (Array.isArray(schema.required)) out.required = schema.required.filter((key) => Object.prototype.hasOwnProperty.call(properties, key)).slice(0, 40);
    out.additionalProperties = false;
  }
  if (type === 'array' && schema.items) out.items = cleanInputSchema(schema.items, level + 1);
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (Number.isFinite(schema[key])) out[key] = Math.max(0, Math.min(1000000, schema[key]));
  }
  return out;
}

function cleanToolList(tools, serverId) {
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, MAX_TOOLS).filter((tool) =>
    tool && typeof tool.name === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(tool.name)
  ).map((tool) => ({
    type: 'function',
    function: {
      name: 'mcp_' + serverId.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24) + '_' + tool.name,
      description: String(tool.description || 'Remote MCP tool').slice(0, 500),
      parameters: cleanInputSchema(tool.inputSchema),
    },
    _mcp: { serverId, remoteName: tool.name },
  }));
}

async function connectRemoteServer(config, options) {
  const cfg = config || {}, opts = options || {};
  const id = String(cfg.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id)) throw new Error('Invalid MCP server ID');
  const checked = await validateEndpoint(cfg.url, opts.lookup);
  const initialized = await requestJsonRpc(checked.url, checked.resolved, cfg.token, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'Mine', version: '2.0.0' },
  });
  const sessionId = initialized.sessionId;
  await requestJsonRpc(checked.url, checked.resolved, cfg.token, 'notifications/initialized', {}, sessionId, true).catch((error) => {
    if (!/HTTP 202|HTTP 204|HTTP 405/i.test(error.message)) throw error;
  });
  const listed = await requestJsonRpc(checked.url, checked.resolved, cfg.token, 'tools/list', {}, sessionId);
  return {
    server: { id, name: String(cfg.name || id).slice(0, 80), url: checked.url.toString(), sessionId },
    tools: cleanToolList(listed.result.tools, id),
  };
}

async function callRemoteTool(config, resolved, remoteName, args, sessionId) {
  const checked = await validateEndpoint(config.url);
  const result = await requestJsonRpc(checked.url, resolved || checked.resolved, config.token, 'tools/call', {
    name: remoteName,
    arguments: args && typeof args === 'object' ? args : {},
  }, sessionId || config.sessionId);
  return result.result;
}

module.exports = {
  isPrivateAddress,
  resolvePublicHost,
  validateEndpoint,
  parseRpcResponse,
  cleanToolList,
  cleanInputSchema,
  connectRemoteServer,
  callRemoteTool,
};
