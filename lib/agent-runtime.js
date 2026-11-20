'use strict';

const crypto = require('crypto');
const { send } = require('@vercel/queue');
let sendQueueMessage = send;
const { loadState, saveState } = require('./storage');

const TOPIC = 'mine-agent-tasks';
const MAX_JOBS = 300;
const MAX_MESSAGES = 40;

function id(prefix) { return prefix + '-' + crypto.randomUUID(); }
function list(value) { return Array.isArray(value) ? value : []; }
function safeError(value) {
  return String(value || 'Agent task failed')
    .replace(/(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}/gi, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}
function contentOf(data) {
  const value = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => part && part.text || '').join('\n');
  return '';
}
function activeModel(state, modelId) {
  const model = list(state.fetchedModels).find((item) => item && item.id === modelId);
  if (!model) return null;
  const provider = model.providerId || model.provider || String(model.id).split('/')[0];
  const key = list(state.keys).find((item) => item && (item.provider || item.providerId) === provider && item.key && item.enabled !== false && item.status !== 'DEAD' && item.status !== 'EXPIRED');
  return key ? model : null;
}
async function publish(jobId) {
  return sendQueueMessage(TOPIC, { jobId }, { idempotencyKey: 'mine-agent:' + jobId, retentionSeconds: 604800 });
}
async function publishNextQueuedAgentJob(agentId) {
  const state = await loadState();
  const agent = list(state.agents).find((item) => item && item.id === agentId);
  if (!agent || agent.status === 'stopped' || agent.activeJobId) return null;
  const next = list(state.agentJobs).find((item) => item && item.agentId === agentId && item.status === 'queued');
  if (!next) return null;
  await publish(next.id);
  return next.id;
}
function updateWorkerNode(state, agent, status, result) {
  const team = list(state.teams).find((item) => item && item.id === agent.teamId);
  const node = team && list(team.nodes).find((item) => item && item.id === agent.id);
  if (!node) return;
  node.agentStatus = status;
  node.agentId = agent.id;
  node.agentLastUpdatedAt = new Date().toISOString();
  if (result !== undefined) node.lastResult = String(result).slice(0, 4000);
  if (agent.lastError) node.lastError = safeError(agent.lastError);
}
function addWorkerNode(team, agent) {
  team.nodes = list(team.nodes);
  team.connections = list(team.connections || team.conns);
  if (team.nodes.some((node) => node && node.id === agent.id)) return;
  const planner = team.nodes.find((node) => node && node.type === 'planner');
  const synth = team.nodes.find((node) => node && node.type === 'synthesizer');
  const workerTemplate = team.nodes.find((node) => node && node.type === 'worker' && node.persistentAgent !== true);
  team.nodes.push({
    id: agent.id, type: 'worker', persistentAgent: true, agentId: agent.id, name: agent.name, specialty: agent.specialty || 'general',
    model: agent.modelId, description: agent.description || '', systemPrompt: agent.systemPrompt || '',
    enabled: true, agentStatus: 'queued', permissions: { ...(workerTemplate && workerTemplate.permissions || { tool: true, mcp: true, memory: false }) },
    x: 620, y: 120 + Math.max(0, team.nodes.filter((node) => node && node.type === 'worker').length) * 150,
  });
  if (planner) team.connections.push({ id: 'edge-' + planner.id + '-' + agent.id, from: planner.id, to: agent.id, tp: 'main' });
  if (synth) team.connections.push({ id: 'edge-' + agent.id + '-' + synth.id, from: agent.id, to: synth.id, tp: 'main' });
}

async function spawnAgent(team, input) {
  const args = input || {};
  const teamId = String(team && (team.id || team.slug) || '').trim();
  const modelId = String(args.model_id || args.modelId || '').trim();
  const task = String(args.task || '').trim();
  const name = String(args.name || 'Subagent').trim().slice(0, 80) || 'Subagent';
  if (!teamId || !task) throw new Error('A team and a specific task are required.');
  if (task.length > 12000) throw new Error('Agent task is too long (12,000 characters maximum).');
  const state = await loadState();
  const target = list(state.teams).find((item) => item && (item.id === teamId || item.slug === teamId));
  if (!target) throw new Error('The target team no longer exists.');
  const model = activeModel(state, modelId);
  if (!model) throw new Error('Choose a model in the catalog that has an enabled, usable provider key.');
  const agentId = id('agent');
  const jobId = id('job');
  const agent = {
    id: agentId, teamId: target.id, name, modelId, specialty: String(args.specialty || 'general').slice(0, 80),
    description: String(args.description || '').slice(0, 500), systemPrompt: String(args.systemPrompt || '').slice(0, 4000),
    status: 'queued', activeJobId: null, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const job = { id: jobId, agentId, teamId: target.id, modelId, task, status: 'queued', createdAt: new Date().toISOString(), attempts: 0 };
  addWorkerNode(target, agent);
  state.agents = [...list(state.agents), agent].slice(-100);
  state.agentJobs = [...list(state.agentJobs), job].slice(-MAX_JOBS);
  await saveState(state);
  try {
    await publish(jobId);
  } catch (error) {
    const fresh = await loadState();
    const failed = list(fresh.agentJobs).find((item) => item && item.id === jobId);
    if (failed) { failed.status = 'failed'; failed.error = safeError(error.message); failed.updatedAt = new Date().toISOString(); }
    const currentAgent = list(fresh.agents).find((item) => item && item.id === agentId);
    if (currentAgent) currentAgent.status = 'idle';
    await saveState(fresh);
    throw new Error('Could not queue the agent task: ' + safeError(error.message));
  }
  if (team && team.id === target.id) {
    team.nodes = target.nodes;
    team.connections = target.connections;
  }
  return { success: true, agentId, jobId, status: 'queued', name, modelId };
}

async function sendAgentMessage(agentId, message) {
  const text = String(message || '').trim();
  if (!text || text.length > 12000) throw new Error('A message between 1 and 12,000 characters is required.');
  const state = await loadState();
  const agent = list(state.agents).find((item) => item && item.id === agentId);
  if (!agent) throw new Error('Agent not found.');
  if (agent.status === 'stopped') throw new Error('This agent is stopped. Resume it before sending a message.');
  if (!activeModel(state, agent.modelId)) throw new Error('The agent model has no active provider key. Update its model in Teams/Flow first.');
  const job = { id: id('job'), agentId, teamId: agent.teamId, modelId: agent.modelId, task: text, status: 'queued', createdAt: new Date().toISOString(), attempts: 0 };
  const hasEarlierQueued = list(state.agentJobs).some((item) => item.agentId === agentId && item.status === 'queued');
  const publishNow = !agent.activeJobId && !hasEarlierQueued;
  state.agentJobs = [...list(state.agentJobs), job].slice(-MAX_JOBS);
  agent.status = agent.activeJobId ? 'running' : 'queued';
  updateWorkerNode(state, agent, agent.status);
  agent.updatedAt = new Date().toISOString();
  await saveState(state);
  try { if (publishNow) await publish(job.id); }
  catch (error) {
    const fresh = await loadState();
    const failed = list(fresh.agentJobs).find((item) => item && item.id === job.id);
    if (failed) { failed.status = 'failed'; failed.error = safeError(error.message); }
    const currentAgent = list(fresh.agents).find((item) => item && item.id === agentId);
    if (currentAgent && !currentAgent.activeJobId) { currentAgent.status = 'error'; currentAgent.lastError = safeError(error.message); updateWorkerNode(fresh, currentAgent, 'error'); }
    await saveState(fresh);
    throw new Error('Could not queue the follow-up: ' + safeError(error.message));
  }
  return { success: true, jobId: job.id, agentId, status: 'queued' };
}

async function listAgents(teamId) {
  const state = await loadState();
  return list(state.agents).filter((agent) => !teamId || agent.teamId === teamId).map((agent) => ({
    id: agent.id, teamId: agent.teamId, name: agent.name, modelId: agent.modelId, specialty: agent.specialty,
    status: agent.status, activeJobId: agent.activeJobId || null, createdAt: agent.createdAt, updatedAt: agent.updatedAt,
    lastResult: agent.lastResult || null,
  }));
}
async function waitForAgents(agentIds, timeoutMs) {
  const ids = new Set(list(agentIds).map(String));
  const deadline = Date.now() + Math.max(0, Math.min(15000, Number(timeoutMs) || 0));
  let state;
  do {
    state = await loadState();
    const agents = list(state.agents).filter((agent) => ids.has(agent.id));
    const jobs = list(state.agentJobs).filter((job) => ids.has(job.agentId));
    const pending = jobs.some((job) => ['queued', 'running'].includes(job.status));
    if (!pending || Date.now() >= deadline) return { agents, jobs: jobs.slice(-40), pending };
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return { agents: [], jobs: [], pending: true };
}
async function stopAgent(agentId) {
  const state = await loadState();
  const agent = list(state.agents).find((item) => item && item.id === agentId);
  if (!agent) throw new Error('Agent not found.');
  agent.status = 'stopped'; agent.activeJobId = null; updateWorkerNode(state, agent, 'stopped'); agent.updatedAt = new Date().toISOString();
  for (const job of list(state.agentJobs)) if (job.agentId === agentId && job.status === 'queued') job.status = 'cancelled';
  await saveState(state);
  return { success: true, agentId, status: 'stopped' };
}
async function updateAgent(agentId, input) {
  const args = input || {};
  const state = await loadState();
  const agent = list(state.agents).find((item) => item && item.id === agentId);
  if (!agent) throw new Error('Agent not found.');
  if (agent.activeJobId || ['running', 'queued'].includes(agent.status)) throw new Error('Wait for the current task to finish before changing this agent model.');
  const modelId = String(args.model_id || args.modelId || '').trim();
  if (modelId && !activeModel(state, modelId)) throw new Error('Choose a catalog model with an enabled provider key.');
  if (modelId) agent.modelId = modelId;
  if (args.name) agent.name = String(args.name).trim().slice(0, 80);
  if (args.specialty) agent.specialty = String(args.specialty).trim().slice(0, 80);
  if (args.systemPrompt !== undefined) agent.systemPrompt = String(args.systemPrompt).slice(0, 4000);
  if (args.description !== undefined) agent.description = String(args.description).slice(0, 500);
  if (agent.status === 'error') { agent.status = 'idle'; agent.lastError = null; }
  agent.updatedAt = new Date().toISOString();
  const team = list(state.teams).find((item) => item && item.id === agent.teamId);
  const node = team && list(team.nodes).find((item) => item && item.id === agent.id);
  if (node) {
    node.model = agent.modelId; node.name = agent.name; node.specialty = agent.specialty; node.systemPrompt = agent.systemPrompt;
    node.description = agent.description; node.agentStatus = agent.status; node.agentId = agent.id; node.persistentAgent = true;
  }
  await saveState(state);
  return { success: true, agent: { id: agent.id, name: agent.name, modelId: agent.modelId, status: agent.status } };
}

async function deleteAgent(agentId) {
  const state = await loadState();
  const agent = list(state.agents).find((item) => item && item.id === agentId);
  if (!agent) return { success: false, error: 'Agent not found.' };
  const pending = list(state.agentJobs).some((job) => job.agentId === agentId && ['queued', 'running'].includes(job.status));
  if (pending || agent.status === 'running' || agent.status === 'queued') throw new Error('Stop and finish the agent before deleting it.');
  state.agents = list(state.agents).filter((item) => item.id !== agentId);
  const team = list(state.teams).find((item) => item.id === agent.teamId);
  if (team) {
    team.nodes = list(team.nodes).filter((node) => node.id !== agentId);
    team.connections = list(team.connections).filter((edge) => edge.from !== agentId && edge.to !== agentId);
  }
  await saveState(state);
  return { success: true, agentId, deleted: true };
}

async function callModel(base, gatewayKey, modelId, messages) {
  const response = await fetch(base + '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + gatewayKey },
    body: JSON.stringify({ model: modelId, messages, temperature: 0.2, max_tokens: 1800 }),
    signal: AbortSignal.timeout(45000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Model request failed (HTTP ' + response.status + '): ' + safeError(payload && payload.error && payload.error.message));
  const text = contentOf(payload);
  if (!text) throw new Error('The selected model returned an empty response.');
  return text;
}
async function processAgentJob(jobId) {
  let state = await loadState();
  let job = list(state.agentJobs).find((item) => item && item.id === jobId);
  if (!job) return { skipped: true };
  if (job.status === 'completed') {
    await publishNextQueuedAgentJob(job.agentId);
    return { skipped: true, reason: 'already completed' };
  }
  if (job.status === 'cancelled') return { skipped: true };
  if (job.status === 'failed') {
    await publishNextQueuedAgentJob(job.agentId);
    return { skipped: true, reason: 'previously failed' };
  }
  let agent = list(state.agents).find((item) => item && item.id === job.agentId);
  if (!agent || agent.status === 'stopped') { job.status = 'cancelled'; await saveState(state); return { skipped: true }; }
  if (agent.activeJobId && agent.activeJobId !== job.id) throw new Error('Agent has another task in progress; retry after it finishes.');
  agent.activeJobId = job.id; agent.status = 'running'; updateWorkerNode(state, agent, 'running'); agent.updatedAt = new Date().toISOString();
  job.status = 'running'; job.startedAt = job.startedAt || new Date().toISOString(); job.attempts = (job.attempts || 0) + 1;
  await saveState(state);

  const base = String(process.env.MINE_PUBLIC_URL || 'https://mine-console.vercel.app').replace(/\/+$/, '');
  const gatewayKey = state.settings && state.settings.gatewayApiKey;
  if (!gatewayKey) {
    job.status = 'failed'; job.error = 'Mine gateway key is not configured.'; job.completedAt = new Date().toISOString();
    agent.activeJobId = null;
    const nextJob = list(state.agentJobs).find((item) => item.agentId === agent.id && item.id !== job.id && item.status === 'queued');
    agent.status = nextJob ? 'queued' : 'error'; agent.lastError = job.error; updateWorkerNode(state, agent, agent.status);
    await saveState(state);
    if (nextJob) await publish(nextJob.id);
    return { success: false, error: job.error };
  }
  const queuedFallbacks = list(state.modelQueue).map((item) => typeof item === 'string' ? item : item && (item.modelId || item.id)).filter(Boolean).slice(0, 2);
  const catalogFallbacks = list(state.fetchedModels).map((item) => typeof item === 'string' ? item : item && item.id).filter(Boolean).filter((id) => id !== agent.modelId).slice(0, 2);
  const candidates = [agent.modelId, ...queuedFallbacks, ...catalogFallbacks].filter((value, index, all) => value && all.indexOf(value) === index);
  let result = ''; let usedModel = ''; let lastError = null;
  const messages = [...list(agent.messages), { role: 'user', content: job.task }].slice(-20);
  for (const modelId of candidates) {
    if (!activeModel(state, modelId)) continue;
    try {
      result = await callModel(base, gatewayKey, modelId, [
        { role: 'system', content: String(agent.systemPrompt || 'You are an independent Mine subagent. Complete only the assigned task. Return a concise, useful result. Do not claim actions you did not perform.') },
        ...messages,
      ]);
      usedModel = modelId; break;
    } catch (error) { lastError = error; }
  }
  if (!result) {
    state = await loadState(); job = list(state.agentJobs).find((item) => item && item.id === jobId); agent = list(state.agents).find((item) => item && item.id === job.agentId);
    if (job) { job.status = 'failed'; job.error = safeError(lastError && lastError.message); job.completedAt = new Date().toISOString(); }
    const nextJob = agent && list(state.agentJobs).find((item) => item.agentId === agent.id && item.id !== jobId && item.status === 'queued');
    if (agent) { agent.status = nextJob ? 'queued' : 'error'; agent.lastError = safeError(lastError && lastError.message); agent.activeJobId = null; updateWorkerNode(state, agent, agent.status); agent.updatedAt = new Date().toISOString(); }
    await saveState(state);
    if (nextJob) await publish(nextJob.id);
    return { success: false, error: safeError(lastError && lastError.message) };
  }

  state = await loadState(); job = list(state.agentJobs).find((item) => item && item.id === jobId); agent = list(state.agents).find((item) => item && item.id === job.agentId);
  if (!job || !agent) return { skipped: true };
  if (agent.status === 'stopped') { job.status = 'cancelled'; job.completedAt = new Date().toISOString(); await saveState(state); return { skipped: true }; }
  if (usedModel !== agent.modelId) {
    agent.modelId = usedModel;
    const team = list(state.teams).find((item) => item && item.id === agent.teamId);
    const node = team && list(team.nodes).find((item) => item && item.id === agent.id);
    if (node) node.model = usedModel;
    agent.modelChanges = [...list(agent.modelChanges), { from: job.modelId || null, to: usedModel, at: new Date().toISOString() }].slice(-20);
  }
  agent.messages = [...list(agent.messages), { role: 'user', content: job.task }, { role: 'assistant', content: result }].slice(-MAX_MESSAGES);
  agent.lastResult = result.slice(0, 12000); agent.lastCompletedAt = new Date().toISOString();
  agent.activeJobId = null;
  const nextJob = list(state.agentJobs).find((item) => item.agentId === agent.id && item.id !== job.id && item.status === 'queued');
  agent.status = nextJob ? 'queued' : 'idle'; updateWorkerNode(state, agent, agent.status, result); agent.updatedAt = new Date().toISOString();
  job.status = 'completed'; job.result = result.slice(0, 12000); job.modelUsed = usedModel; job.completedAt = new Date().toISOString();
  await saveState(state);
  if (nextJob) await publish(nextJob.id);
  return { success: true, jobId, agentId: agent.id, modelUsed: usedModel };
}

module.exports = { _setQueueSendForTests: (fn) => { sendQueueMessage = fn || send; }, publishNextQueuedAgentJob, updateWorkerNode, updateAgent, TOPIC, spawnAgent, sendAgentMessage, listAgents, waitForAgents, stopAgent, deleteAgent, processAgentJob, safeError };
