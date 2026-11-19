'use strict';

const { connectRemoteServer, callRemoteTool } = require('./mcp-client');

function serverEndpoint(node, serverId) {
  const params = node && node.serverParams && typeof node.serverParams === 'object' ? node.serverParams : {};
  const value = params[serverId] || (serverId === node.serverName ? node.param : '');
  return String(value || '').trim();
}

async function createMcpToolExecutor(nodes, actor, emit) {
  const definitions = [];
  const routes = new Map();
  const servers = Array.isArray(nodes) ? nodes : [];
  for (const node of servers) {
    if (!node || node.enabled === false) continue;
    const enabled = Array.isArray(node.enabledServers) && node.enabledServers.length
      ? node.enabledServers
      : [node.serverName || 'custom'];
    for (const serverId of enabled) {
      const endpoint = serverEndpoint(node, serverId);
      // Local stdio presets cannot run inside a Vercel Function. Remote HTTPS
      // endpoints are supported by the hardened Streamable HTTP MCP client.
      if (!/^https:\/\//i.test(endpoint)) continue;
      const id = String((node.id || 'node') + '-' + serverId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      try {
        const token = node.serverTokens && node.serverTokens[serverId] || '';
        const connected = await connectRemoteServer({
          id,
          name: node.name || serverId,
          url: endpoint,
          token,
        });
        for (const tool of connected.tools) {
          if (definitions.length >= 80) break;
          const fn = tool.function || {};
          definitions.push({ type: 'function', function: { name: fn.name, description: fn.description, parameters: fn.parameters } });
          routes.set(fn.name, {
            server: { ...connected.server, token },
            remoteName: tool._mcp && tool._mcp.remoteName,
          });
        }
        if (typeof emit === 'function') emit('mcp.connected', { nodeId: node.id, serverId, toolCount: connected.tools.length, actor: actor && actor.id || null });
      } catch (error) {
        if (typeof emit === 'function') emit('mcp.unavailable', { nodeId: node.id, serverId, reason: String(error && error.message || 'MCP connection failed').slice(0, 240) });
      }
    }
    if (definitions.length >= 80) break;
  }

  return {
    definitions,
    async execute(name, args) {
      const route = routes.get(String(name || ''));
      if (!route || !route.remoteName) throw new Error('Remote MCP tool is not enabled for this worker.');
      const result = await callRemoteTool(route.server, undefined, route.remoteName, args || {}, route.server.sessionId);
      return result;
    },
  };
}

module.exports = { createMcpToolExecutor, serverEndpoint };
