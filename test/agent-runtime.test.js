'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');

const originalLoad = storage.loadState;
const originalSave = storage.saveState;
const originalFetch = global.fetch;

let state;
let sent;

function seed() {
  return {
    settings: { gatewayApiKey: 'sk-mine-test' },
    teams: [{ id: 'team-1', slug: 'team-1', nodes: [
      { id: 'planner', type: 'planner', model: 'openai/gpt-4o' },
      { id: 'worker', type: 'worker', model: 'openai/gpt-4o-mini' },
      { id: 'synth', type: 'synthesizer', model: 'openai/gpt-4o' },
    ], connections: [] }],
    fetchedModels: [
      { id: 'openai/gpt-4o-mini', provider: 'openai' },
      { id: 'openai/gpt-4o', provider: 'openai' },
    ],
    keys: [{ id: 'key-1', provider: 'openai', key: 'secret-key', enabled: true, status: 'ACTIVE' }],
    modelQueue: [], agents: [], agentJobs: [],
  };
}

test('persistent agent spawn writes a worker into the existing flow and publishes a durable queue task', async (t) => {
  state = seed(); sent = null;
  storage.loadState = async () => structuredClone(state);
  storage.saveState = async (next) => { state = structuredClone(next); };
  delete require.cache[require.resolve('../lib/agent-runtime')];
  const runtime = require('../lib/agent-runtime');
  runtime._setQueueSendForTests(async (topic, payload, options) => { sent = { topic, payload, options }; return { messageId: 'queue-message-1' }; });
  const localTeam = structuredClone(state.teams[0]);
  const result = await runtime.spawnAgent(localTeam, { name: 'Researcher', model_id: 'openai/gpt-4o-mini', task: 'Research queue durability', specialty: 'research' });
  assert.equal(result.status, 'queued');
  assert.equal(sent.topic, 'mine-agent-tasks');
  assert.equal(sent.payload.jobId, result.jobId);
  assert.ok(sent.options.idempotencyKey.includes(result.jobId));
  assert.ok(state.teams[0].nodes.some((node) => node.id === result.agentId && node.type === 'worker' && node.persistentAgent === true));
  assert.ok(state.teams[0].connections.some((edge) => edge.to === result.agentId));
  assert.equal(state.agentJobs[0].status, 'queued');
  assert.ok(localTeam.nodes.some((node) => node.id === result.agentId));

  process.env.MINE_PUBLIC_URL = 'http://mine.test';
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://mine.test/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer sk-mine-test');
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Research complete.' } }] }) };
  };
  const completed = await runtime.processAgentJob(result.jobId);
  assert.equal(completed.success, true);
  const agent = state.agents.find((item) => item.id === result.agentId);
  const job = state.agentJobs.find((item) => item.id === result.jobId);
  assert.equal(agent.status, 'idle');
  assert.equal(agent.lastResult, 'Research complete.');
  assert.equal(agent.messages.at(-1).content, 'Research complete.');
  assert.equal(job.status, 'completed');
  assert.equal(job.modelUsed, 'openai/gpt-4o-mini');
  delete process.env.MINE_PUBLIC_URL;
  global.fetch = originalFetch;
});

test('queued follow-up messages do not replace the active task and stopped agents reject new work', async () => {
  state = seed();
  state.agents = [{ id: 'agent-1', teamId: 'team-1', name: 'Researcher', modelId: 'openai/gpt-4o-mini', status: 'running', activeJobId: 'job-active', messages: [] }];
  storage.loadState = async () => structuredClone(state);
  storage.saveState = async (next) => { state = structuredClone(next); };
  delete require.cache[require.resolve('../lib/agent-runtime')];
  const runtime = require('../lib/agent-runtime');
  runtime._setQueueSendForTests(async (topic, payload) => { sent = { topic, payload }; return { messageId: 'queue-message-2' }; });
  const result = await runtime.sendAgentMessage('agent-1', 'Check one more source');
  assert.equal(result.status, 'queued');
  assert.equal(state.agents[0].activeJobId, 'job-active');
  assert.equal(state.agents[0].status, 'running');
  assert.equal(state.agentJobs[0].status, 'queued');
  await runtime.stopAgent('agent-1');
  await assert.rejects(() => runtime.sendAgentMessage('agent-1', 'Do not run'), /stopped/);
});

test.after(() => {
  storage.loadState = originalLoad;
  storage.saveState = originalSave;
  global.fetch = originalFetch;
  delete process.env.MINE_PUBLIC_URL;
});

test('agent task switches its flow node to a working fallback model after a provider failure', async () => {
  state = seed();
  const agent = { id: 'agent-fallback', teamId: 'team-1', name: 'Fallback Agent', modelId: 'openai/gpt-4o-mini', status: 'queued', activeJobId: null, messages: [] };
  state.agents = [agent];
  state.agentJobs = [{ id: 'job-fallback', agentId: agent.id, teamId: agent.teamId, modelId: agent.modelId, task: 'Do the task', status: 'queued' }];
  state.modelQueue = ['openai/gpt-4o'];
  state.teams[0].nodes.push({ id: agent.id, type: 'worker', model: agent.modelId, agentId: agent.id, agentStatus: 'queued' });
  storage.loadState = async () => structuredClone(state);
  storage.saveState = async (next) => { state = structuredClone(next); };
  delete require.cache[require.resolve('../lib/agent-runtime')];
  const runtime = require('../lib/agent-runtime');
  process.env.MINE_PUBLIC_URL = 'http://mine.test';
  const tried = [];
  global.fetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    tried.push(model);
    if (model === 'openai/gpt-4o-mini') return { ok: false, status: 503, json: async () => ({ error: { message: 'provider unavailable' } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Fallback completed.' } }] }) };
  };
  const result = await runtime.processAgentJob('job-fallback');
  assert.equal(result.success, true);
  assert.deepEqual(tried, ['openai/gpt-4o-mini', 'openai/gpt-4o']);
  assert.equal(state.agents[0].modelId, 'openai/gpt-4o');
  assert.equal(state.teams[0].nodes.find((node) => node.id === agent.id).model, 'openai/gpt-4o');
  assert.equal(state.agentJobs[0].modelUsed, 'openai/gpt-4o');
  delete process.env.MINE_PUBLIC_URL;
  global.fetch = originalFetch;
});

test('subagent processes queued follow-ups sequentially after its active task completes', async () => {
  state = seed();
  const agent = { id: 'agent-queue', teamId: 'team-1', name: 'Queue Agent', modelId: 'openai/gpt-4o-mini', status: 'running', activeJobId: 'job-1', messages: [] };
  state.agents = [agent];
  state.agentJobs = [
    { id: 'job-1', agentId: agent.id, teamId: agent.teamId, modelId: agent.modelId, task: 'First task', status: 'running' },
    { id: 'job-2', agentId: agent.id, teamId: agent.teamId, modelId: agent.modelId, task: 'Second task', status: 'queued' },
  ];
  state.teams[0].nodes.push({ id: agent.id, type: 'worker', model: agent.modelId, agentId: agent.id, agentStatus: 'running' });
  storage.loadState = async () => structuredClone(state);
  storage.saveState = async (next) => { state = structuredClone(next); };
  delete require.cache[require.resolve('../lib/agent-runtime')];
  const runtime = require('../lib/agent-runtime');
  runtime._setQueueSendForTests(async (topic, payload) => { sent = { topic, payload }; return { messageId: 'next-message' }; });
  process.env.MINE_PUBLIC_URL = 'http://mine.test';
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'First task done.' } }] }) });
  await runtime.processAgentJob('job-1');
  assert.equal(state.agentJobs[0].status, 'completed');
  assert.equal(state.agentJobs[1].status, 'queued');
  assert.equal(sent.payload.jobId, 'job-2');
  assert.equal(state.agents[0].status, 'queued');
  delete process.env.MINE_PUBLIC_URL;
  global.fetch = originalFetch;
});

test('persistent agent model can be replaced only while idle and updates its flow node', async () => {
  state = seed();
  const agent = { id: 'agent-update', teamId: 'team-1', name: 'Old Name', modelId: 'openai/gpt-4o-mini', status: 'error', messages: [] };
  state.agents = [agent];
  state.teams[0].nodes.push({ id: agent.id, type: 'worker', persistentAgent: true, agentId: agent.id, name: agent.name, model: agent.modelId, agentStatus: 'error' });
  storage.loadState = async () => structuredClone(state);
  storage.saveState = async (next) => { state = structuredClone(next); };
  delete require.cache[require.resolve('../lib/agent-runtime')];
  const runtime = require('../lib/agent-runtime');
  const result = await runtime.updateAgent(agent.id, { model_id: 'openai/gpt-4o', name: 'Updated Researcher' });
  assert.equal(result.success, true);
  assert.equal(state.agents[0].modelId, 'openai/gpt-4o');
  assert.equal(state.agents[0].name, 'Updated Researcher');
  const node = state.teams[0].nodes.find((item) => item.id === agent.id);
  assert.equal(node.model, 'openai/gpt-4o');
  assert.equal(node.name, 'Updated Researcher');
  assert.equal(node.agentStatus, 'idle');
  state.agents[0].status = 'running';
  await assert.rejects(() => runtime.updateAgent(agent.id, { model_id: 'openai/gpt-4o-mini' }), /current task to finish/);
});
