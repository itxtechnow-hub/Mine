'use strict';

const cloudMemory = require('../cloud-memory');

const MEMORY_TOOL_MAP = {
  memory_list: 'memory.list',
  memory_search: 'memory.search',
  memory_read: 'memory.read',
  memory_write: 'memory.write',
};

function calculator(expression) {
  const source = String(expression || '').trim();
  if (!source || source.length > 200 || !/^[0-9+\-*/().%\s^]+$/.test(source)) {
    throw new Error('Calculator accepts only basic arithmetic expressions.');
  }
  let index = 0;
  function whitespace() { while (/\s/.test(source[index] || '')) index++; }
  function primary() {
    whitespace();
    if (source[index] === '+') { index++; return primary(); }
    if (source[index] === '-') { index++; return -primary(); }
    if (source[index] === '(') {
      index++;
      const value = addSub();
      whitespace();
      if (source[index++] !== ')') throw new Error('Missing closing parenthesis.');
      return value;
    }
    const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) throw new Error('Expected a number.');
    index += match[0].length;
    return Number(match[0]);
  }
  function power() {
    let value = primary();
    whitespace();
    if (source[index] === '^') {
      index++;
      const exponent = unary();
      if (Math.abs(exponent) > 12) throw new Error('Exponent is limited to ±12.');
      value = Math.pow(value, exponent);
    }
    return value;
  }
  function unary() { whitespace(); if (source[index] === '-') { index++; return -unary(); } if (source[index] === '+') { index++; return unary(); } return power(); }
  function multiply() {
    let value = unary();
    while (true) {
      whitespace();
      const op = source[index];
      if (op !== '*' && op !== '/' && op !== '%') break;
      index++;
      const right = unary();
      if ((op === '/' || op === '%') && right === 0) throw new Error('Division by zero.');
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  }
  function addSub() {
    let value = multiply();
    while (true) {
      whitespace();
      const op = source[index];
      if (op !== '+' && op !== '-') break;
      index++;
      const right = multiply();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = addSub();
  whitespace();
  if (index !== source.length || !Number.isFinite(result)) throw new Error('Invalid or non-finite arithmetic expression.');
  return result;
}

function buildTeamToolDefinitions(enabledIds) {
  const enabled = new Set(Array.isArray(enabledIds) ? enabledIds : []);
  const tools = [];
  if (enabled.has('calculator')) {
    tools.push({
      type: 'function',
      function: {
        name: 'calculator',
        description: 'Evaluate a basic arithmetic expression. Use this for exact arithmetic.',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'Arithmetic expression using numbers, parentheses, +, -, *, /, %, and ^.' } },
          required: ['expression'],
          additionalProperties: false,
        },
      },
    });
  }
  for (const [id, name] of Object.entries(MEMORY_TOOL_MAP)) {
    if (!enabled.has(id)) continue;
    const definitions = cloudMemory.toolDefinitions();
    const definition = definitions.find((item) => item.name === name);
    if (!definition) continue;
    tools.push({
      type: 'function',
      function: {
        name,
        description: definition.description,
        parameters: { ...definition.inputSchema, additionalProperties: false },
      },
    });
  }
  return tools;
}

function executeTeamTool(state, name, args, modelId, onMemoryWrite) {
  const input = { ...(args || {}), modelId };
  if (name === 'calculator') {
    return { result: calculator(input.expression) };
  }
  if (!Object.values(MEMORY_TOOL_MAP).includes(name)) {
    throw new Error('This tool is not enabled for the current team node.');
  }
  const result = cloudMemory.callTool(state, name, input);
  if (name === 'memory.write' && typeof onMemoryWrite === 'function') onMemoryWrite(result);
  return result;
}


const FLOW_NODE_TYPES = new Set(['input', 'output', 'planner', 'worker', 'synthesizer', 'agent', 'tool', 'mcp', 'memory', 'model']);
const FLOW_NODE_FIELDS = new Set(['name', 'type', 'model', 'specialty', 'description', 'systemPrompt', 'enabled', 'permissions', 'enabledTools', 'enabledServers', 'serverName', 'x', 'y', 'color']);

function buildBossFlowToolDefinitions() {
  const definitions = [
    ['flow_read', 'Read the current team flow without exposing credentials.', { type: 'object', properties: {}, additionalProperties: false }],
    ['flow_add_node', 'Add a configured node to the current team flow.', { type: 'object', properties: { node: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: Array.from(FLOW_NODE_TYPES) }, name: { type: 'string' }, model: { type: 'string' }, specialty: { type: 'string' }, description: { type: 'string' }, systemPrompt: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['id', 'type'], additionalProperties: false } }, required: ['node'], additionalProperties: false }],
    ['flow_update_node', 'Update safe editable properties on an existing node. Credentials and server secrets cannot be changed.', { type: 'object', properties: { nodeId: { type: 'string' }, patch: { type: 'object' } }, required: ['nodeId', 'patch'], additionalProperties: false }],
    ['flow_connect', 'Connect two existing nodes in the current team flow.', { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, type: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false }],
    ['flow_delete_node', 'Delete a node and its attached connections. Requires explicit user intent and confirmation.', { type: 'object', properties: { nodeId: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['nodeId', 'confirm'], additionalProperties: false }],
    ['flow_disconnect', 'Remove a connection between two nodes. Requires explicit user intent and confirmation.', { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['from', 'to', 'confirm'], additionalProperties: false }],
    ['flow_validate', 'Validate the current team graph and report structural issues.', { type: 'object', properties: {}, additionalProperties: false }],
    ['team_create', 'Create a new team with a working starter graph. Existing teams are never overwritten.', { type: 'object', properties: { name: { type: 'string' }, slug: { type: 'string' }, workerModel: { type: 'string' }, plannerModel: { type: 'string' } }, required: ['name'], additionalProperties: false }],
  ];
  return definitions.map(([name, description, parameters]) => ({
    type: 'function',
    function: { name, description, parameters },
  }));
}

function safeFlowNode(node) {
  const out = {};
  for (const key of ['id', 'type', 'name', 'model', 'specialty', 'description', 'systemPrompt', 'enabled', 'permissions', 'enabledTools', 'enabledServers', 'serverName', 'x', 'y', 'color']) {
    if (node && node[key] !== undefined) out[key] = node[key];
  }
  return out;
}

function executeBossFlowTool(team, name, args, options) {
  const a = args || {};
  const ctx = options || {};
  const nodes = Array.isArray(team.nodes) ? team.nodes : (team.nodes = []);
  const connections = Array.isArray(team.connections) ? team.connections : (team.connections = []);
  const changed = () => { if (typeof ctx.onTeamUpdate === 'function') ctx.onTeamUpdate(team); };
  if (name === 'flow_read') {
    return { team: { id: team.id, slug: team.slug, name: team.name, nodes: nodes.map(safeFlowNode), connections: connections.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type || edge.tp || 'main' })) } };
  }
  if (name === 'flow_add_node') {
    const node = a.node || {};
    const id = String(node.id || '').trim().slice(0, 100);
    const type = String(node.type || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !FLOW_NODE_TYPES.has(type)) throw new Error('Node id or type is invalid.');
    if (nodes.some((item) => item.id === id)) throw new Error('A node with this id already exists.');
    if (node.model && Array.isArray(ctx.allowedModels) && ctx.allowedModels.length && !ctx.allowedModels.includes(node.model)) throw new Error('Node model must be backed by an active Mine gateway key.');
    const clean = { id, type };
    for (const [key, value] of Object.entries(node)) {
      if (!FLOW_NODE_FIELDS.has(key) || key === 'id' || key === 'type') continue;
      if (typeof value === 'string') clean[key] = value.slice(0, key === 'systemPrompt' ? 12000 : 1000);
      else if (['number', 'boolean'].includes(typeof value) || (value && typeof value === 'object' && ['permissions', 'enabledTools', 'enabledServers'].includes(key))) clean[key] = value;
    }
    nodes.push(clean);
    changed();
    return { success: true, node: safeFlowNode(clean) };
  }
  if (name === 'flow_update_node') {
    const node = nodes.find((item) => item.id === String(a.nodeId || ''));
    if (!node) throw new Error('Node not found.');
    const patch = a.patch && typeof a.patch === 'object' ? a.patch : {};
    const updated = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!FLOW_NODE_FIELDS.has(key)) continue;
      if (typeof value === 'string') updated[key] = value.slice(0, key === 'systemPrompt' ? 12000 : 1000);
      else if (['number', 'boolean'].includes(typeof value) || (value && typeof value === 'object' && ['permissions', 'enabledTools', 'enabledServers'].includes(key))) updated[key] = value;
    }
    if (updated.model && Array.isArray(ctx.allowedModels) && ctx.allowedModels.length && !ctx.allowedModels.includes(updated.model)) throw new Error('Node model must be backed by an active Mine gateway key.');
    if (updated.type && !FLOW_NODE_TYPES.has(updated.type)) throw new Error('Node type is invalid.');
    Object.assign(node, updated);
    changed();
    return { success: true, node: safeFlowNode(node) };
  }
  if (name === 'flow_connect') {
    const from = String(a.from || ''), to = String(a.to || '');
    if (!nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to)) throw new Error('Both connection endpoints must exist.');
    if (from === to) throw new Error('A node cannot connect to itself.');
    if (connections.some((edge) => edge.from === from && edge.to === to)) return { success: true, unchanged: true };
    const edge = { id: 'edge-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), from, to, tp: String(a.type || 'main').slice(0, 40) };
    connections.push(edge);
    changed();
    return { success: true, connection: edge };
  }
  if (name === 'flow_delete_node') {
    if (!ctx.allowDestructive) throw new Error('Node deletion requires an explicit user request.');
    if (a.confirm !== true) throw new Error('Confirm node deletion before proceeding.');
    const index = nodes.findIndex((node) => node.id === String(a.nodeId || ''));
    if (index < 0) throw new Error('Node not found.');
    const node = nodes[index];
    if (node.type === 'planner' && nodes.filter((item) => item.type === 'planner').length <= 1) throw new Error('The last Boss/planner node cannot be deleted.');
    if (node.type === 'worker' && nodes.filter((item) => item.type === 'worker').length <= 1) throw new Error('The last worker node cannot be deleted.');
    nodes.splice(index, 1);
    const removedConnections = connections.filter((edge) => edge.from === node.id || edge.to === node.id).length;
    team.connections = connections.filter((edge) => edge.from !== node.id && edge.to !== node.id);
    changed();
    return { success: true, deletedNodeId: node.id, removedConnections };
  }
  if (name === 'flow_disconnect') {
    if (!ctx.allowDestructive) throw new Error('Disconnecting a flow edge requires an explicit user request.');
    if (a.confirm !== true) throw new Error('Confirm connection deletion before proceeding.');
    const index = connections.findIndex((edge) => edge.from === String(a.from || '') && edge.to === String(a.to || ''));
    if (index < 0) throw new Error('Connection not found.');
    const [removed] = connections.splice(index, 1);
    changed();
    return { success: true, removedConnection: { from: removed.from, to: removed.to } };
  }
  if (name === 'flow_validate') {
    const problems = [];
    if (!team.id || !team.slug || !team.name) problems.push('Team identity is incomplete.');
    if (!nodes.length) problems.push('Team has no nodes.');
    const ids = new Set(nodes.map((node) => node.id));
    for (const node of nodes) {
      if (!FLOW_NODE_TYPES.has(node.type)) problems.push('Unsupported node type: ' + node.type);
      if (node.type === 'worker' && !node.model) problems.push('Worker ' + node.id + ' has no assigned model.');
    }
    for (const edge of connections) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push('Connection has a missing endpoint.');
    }
    return { valid: problems.length === 0, problems };
  }
  if (name === 'team_create') {
    if (typeof ctx.onTeamCreate !== 'function') throw new Error('Team creation is unavailable in this runtime.');
    const nameValue = String(a.name || '').trim().slice(0, 100);
    const slug = String(a.slug || nameValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 80);
    if (!nameValue || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('A valid team name and slug are required.');
    const plannerModel = String(a.plannerModel || ctx.defaultModel || '').slice(0, 200);
    const workerModel = String(a.workerModel || ctx.workerModel || plannerModel).slice(0, 200);
    if (!plannerModel || !workerModel) throw new Error('Assign available planner and worker models before creating a team.');
    const id = 'team-' + slug + '-' + Math.random().toString(36).slice(2, 7);
    const created = {
      id, slug, name: nameValue, enabled: true,
      nodes: [
        { id: 'input', type: 'input', name: 'Input', x: 80, y: 220 },
        { id: 'boss', type: 'planner', name: 'Boss', model: plannerModel, x: 340, y: 220, permissions: { flow: true, tool: true, mcp: true, memory: true } },
        { id: 'worker-1', type: 'worker', name: 'Worker 1', specialty: 'general', model: workerModel, x: 620, y: 220 },
        { id: 'synth', type: 'synthesizer', name: 'Synthesizer', model: plannerModel, x: 900, y: 220 },
        { id: 'output', type: 'output', name: 'Output', x: 1180, y: 220 },
      ],
      connections: [
        { id: 'edge-input-boss', from: 'input', to: 'boss', tp: 'main' },
        { id: 'edge-boss-worker', from: 'boss', to: 'worker-1', tp: 'main' },
        { id: 'edge-worker-synth', from: 'worker-1', to: 'synth', tp: 'main' },
        { id: 'edge-synth-output', from: 'synth', to: 'output', tp: 'main' },
      ],
    };
    const result = ctx.onTeamCreate(created);
    return { success: true, team: { id, slug, name: nameValue }, persisted: result !== false };
  }
  throw new Error('This flow tool is not available to the current node.');
}

function safeToolResult(value, maxBytes) {
  let text;
  try { text = JSON.stringify(value); } catch (_) { text = String(value); }
  const limit = Math.max(1000, Number(maxBytes) || 12000);
  return text.length > limit ? text.slice(0, limit) + '…[truncated]' : text;
}

module.exports = { calculator, buildTeamToolDefinitions, executeTeamTool, buildBossFlowToolDefinitions, executeBossFlowTool, safeToolResult };
