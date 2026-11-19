'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runTeam } = require('../lib/gateway/team');

test('Boss can create and persist a new team through its authorized flow tools', async () => {
  const createdTeams = [];
  const team = {
    id: 'boss-flow-team',
    slug: 'boss-flow-team',
    name: 'Boss Flow Team',
    nodes: [
      { id: 'boss', type: 'planner', model: 'provider/boss', permissions: { flow: true } },
      { id: 'worker', type: 'worker', model: 'provider/worker', specialty: 'general' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Create a new research team', {
    models: [{ id: 'provider/boss' }, { id: 'provider/worker' }],
    availableModels: ['provider/boss', 'provider/worker'],
    modelQueue: [],
    onTeamCreate: (created) => { createdTeams.push(created); return true; },
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'planner') {
        const toolMessages = (options.messages || []).filter((message) => message.role === 'tool');
        if (toolMessages.length) return { text: 'Created the new team.' };
        return { text: '', toolCalls: [{
          id: 'create-team',
          type: 'function',
          function: { name: 'team_create', arguments: JSON.stringify({ name: 'Research Team', slug: 'research-team', plannerModel: 'provider/boss', workerModel: 'provider/worker' }) },
        }] };
      }
      return { text: 'unexpected' };
    },
  });

  assert.equal(result.status, 'completed');
  assert.match(result.final, /Created the new team/);
  assert.equal(createdTeams.length, 1);
  assert.equal(createdTeams[0].slug, 'research-team');
  assert.equal(createdTeams[0].nodes.filter((node) => node.type === 'worker').length, 1);
  assert.equal(createdTeams[0].connections.length, 4);
});

test('Boss flow tools reject unsafe node types and dangling connections', async () => {
  const { executeBossFlowTool } = require('../lib/gateway/tools');
  const team = { id: 'safe', slug: 'safe', name: 'Safe', nodes: [{ id: 'boss', type: 'planner' }], connections: [] };
  assert.throws(() => executeBossFlowTool(team, 'flow_add_node', { node: { id: 'x', type: 'shell' } }), /invalid/i);
  assert.throws(() => executeBossFlowTool(team, 'flow_connect', { from: 'boss', to: 'missing' }), /endpoints/i);
});

test('Boss flow deletion requires explicit intent and confirmation', () => {
  const { executeBossFlowTool } = require('../lib/gateway/tools');
  const team = {
    id: 'delete-safe', slug: 'delete-safe', name: 'Delete Safe',
    nodes: [{ id: 'boss', type: 'planner' }, { id: 'worker', type: 'worker' }, { id: 'extra', type: 'tool' }],
    connections: [{ id: 'edge', from: 'worker', to: 'extra', tp: 'main' }],
  };
  assert.throws(() => executeBossFlowTool(team, 'flow_delete_node', { nodeId: 'extra', confirm: true }, { allowDeleteNode: false }), /explicit user request/i);
  assert.throws(() => executeBossFlowTool(team, 'flow_delete_node', { nodeId: 'extra', confirm: false }, { allowDeleteNode: true }), /confirm/i);
  const deleted = executeBossFlowTool(team, 'flow_delete_node', { nodeId: 'extra', confirm: true }, { allowDeleteNode: true });
  assert.equal(deleted.removedConnections, 1);
  assert.equal(team.nodes.some((node) => node.id === 'extra'), false);
  assert.throws(() => executeBossFlowTool(team, 'flow_delete_node', { nodeId: 'worker', confirm: true }, { allowDeleteNode: true }), /last worker/i);
  assert.throws(() => executeBossFlowTool(team, 'flow_disconnect', { from: 'worker', to: 'extra', confirm: true }, { allowDisconnect: false }), /explicit user request/i);
});


test('Boss flow tools never return MCP endpoint tokens or private server parameters', () => {
  const { executeBossFlowTool } = require('../lib/gateway/tools');
  const team = {
    id: 'mcp-safe', slug: 'mcp-safe', name: 'MCP Safe',
    nodes: [{ id: 'boss', type: 'planner' }, { id: 'worker', type: 'worker' }],
    connections: [],
  };
  const result = executeBossFlowTool(team, 'flow_add_node', {
    node: {
      id: 'remote-mcp', type: 'mcp', name: 'Remote MCP',
      serverName: 'custom', enabledServers: ['custom'],
      serverParams: { custom: 'https://mcp.example.com/rpc' },
    },
  });
  assert.equal(result.success, true);
  assert.equal(JSON.stringify(result).includes('mcp.example.com'), false);
  team.nodes[2].serverTokens = { custom: 'secret-token-value' };
  const read = executeBossFlowTool(team, 'flow_read', {});
  assert.equal(JSON.stringify(read).includes('secret-token-value'), false);
  assert.equal(JSON.stringify(read).includes('serverTokens'), false);
});
