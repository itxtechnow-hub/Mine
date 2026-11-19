'use strict';

const { buildTeamToolDefinitions, executeTeamTool, buildBossFlowToolDefinitions, executeBossFlowTool, safeToolResult } = require('./tools');
const { runDelegationGraph } = require('./delegation-graph');
const { createSandboxToolExecutor } = require('./sandbox');
const { createMcpToolExecutor } = require('./mcp-tools');

const TEAM_PREFIX = 'mine/agent/';

/**
 * Check if a model id refers to a team.
 */
function isTeamRequest(model) {
  return typeof model === 'string' && (model.startsWith('mine/agent/') || model.startsWith('mine/team/'));
}

/**
 * Resolve a team by its id from the teams array.
 * Also resolves 'mine/auto' to the first enabled team.
 */
function findTeam(teams, model) {
  if (!teams || !Array.isArray(teams)) return null;

  // Handle mine/auto -> first enabled team
  if (model === 'mine/auto') {
    return teams.find((t) => t.enabled !== false) || null;
  }

  // Handle mine/team/<slug>
  if (typeof model === 'string' && (model.startsWith('mine/agent/') || model.startsWith('mine/team/'))) {
    const slug = model.startsWith('mine/agent/') ? model.slice('mine/agent/'.length) : model.slice('mine/team/'.length);
    return teams.find((t) => (t.id === slug || t.slug === slug) && t.enabled !== false) || null;
  }

  return null;
}

/**
 * Get all team model ids for /v1/models listing.
 */
function teamModelIds(teams) {
  if (!teams || !Array.isArray(teams)) return [];
  return teams
    .filter((t) => t.enabled !== false)
    .map((t) => `mine/team/${t.slug || t.id}`);
}

/**
 * Validate a team configuration.
 * Returns an array of problem strings (empty if valid).
 */
function validateTeam(team) {
  const problems = [];

  if (!team.id) problems.push('Team missing id');
  if (!team.name) problems.push('Team missing name');
  if (!team.slug) problems.push('Team missing slug');
  if (!Array.isArray(team.nodes) || team.nodes.length === 0) {
    problems.push('Team has no nodes');
    return problems;
  }

  const planners = team.nodes.filter((n) => n.type === 'planner');
  const synthesizers = team.nodes.filter((n) => n.type === 'synthesizer');
  const hasPlanner = planners.length > 0;
  const hasSynthesizer = synthesizers.length > 0;
  const agents = team.nodes.filter((n) => n.type === 'agent');
  const workers = team.nodes.filter((n) => n.type === 'worker');

  if (!hasPlanner) problems.push('Team needs at least one planner node');
  // A dedicated synthesizer is optional. The graph can finish through an
  // agent connected directly after the workers, or the planner can synthesize
  // when no separate finalizer node is configured.
  if (!hasSynthesizer && agents.length > 1) {
    problems.push('Team has multiple agent finalizers; connect one clear final agent or add a synthesizer');
  }
  if (workers.length === 0) problems.push('Team needs at least one worker node');

  // Check that worker models exist in the catalog (checked at runtime)
  for (const node of team.nodes) {
    if (!node.id || !node.type) {
      problems.push(`Node missing id or type`);
    }
    if (node.type === 'worker' && !node.model) {
      problems.push(`Worker node ${node.id} missing model`);
    }
  }

  return problems;
}


function safeDelegateError(error) {
  const message = String(error && error.message || error || 'Unknown provider error');
  if (/no active key/i.test(message)) return 'No active API key is configured for this provider';
  if (/free_tier_requires_subscription|model is not available on this provider account plan|plan restriction/i.test(message)) return 'The selected model is not included in this provider account plan; choose a supported model or another provider';
  if (/429|rate.?limit|cooldown/i.test(message)) return 'Provider rate limit reached; retry after cooldown or add another key';
  if (/401|403|unauthorized|forbidden/i.test(message)) return 'Provider rejected the API key; check or replace the key';
  if (/402|payment|credit/i.test(message)) return 'Provider account has no available credit';
  if (/404|model.*not found/i.test(message)) return 'The selected model was not found by the provider';
  if (/timeout/i.test(message)) return 'Provider request timed out';
  if (/no provider/i.test(message)) return 'No provider is configured for the selected model';
  return 'Provider request failed; inspect the gateway diagnostics for the request details';
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const count = Math.min(Math.max(1, limit || 1), items.length);
  await Promise.all(Array.from({ length: count }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function parsePlannerPlan(text) {
  let source = String(text || '').trim();
  source = source.replace(/^\x60\x60\x60(?:json)?\s*/i, '').replace(/\s*\x60\x60\x60$/, '').trim();
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(source.slice(start, end + 1));
    if (Array.isArray(parsed)) return parsed;
    return parsed && Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch (_) {
    return [];
  }
}

function validatePlannerPlan(items, originalPrompt, workers, maxDelegates) {
  const templates = Array.isArray(workers) ? workers : [];
  const specialties = new Map();
  for (const worker of templates) {
    const label = String(worker && worker.specialty || 'general').trim();
    if (label && !specialties.has(label.toLowerCase())) specialties.set(label.toLowerCase(), label);
  }
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedRequest = normalize(originalPrompt);
  const seen = new Set();
  const result = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, Math.max(1, maxDelegates))) {
    if (!item || typeof item !== 'object') continue;
    const part = String(item.part || item.task || '').trim().slice(0, 4000);
    const normalized = normalize(part);
    if (!part || !normalized || normalized === normalizedRequest ||
        (normalizedRequest.length > 80 && normalized.includes(normalizedRequest.slice(0, 100))) ||
        seen.has(normalized)) continue;
    const requested = String(item.specialty || specialties.values().next().value || 'general').trim().toLowerCase();
    const specialty = specialties.get(requested);
    if (!specialty) continue;
    seen.add(normalized);
    result.push({ part, specialty, taskIndex: result.length + 1 });
  }
  return result;
}

async function runNodeWithTools(callModel, modelId, prompt, options, tools, executeTool, emit, nodeId) {
  if (!Array.isArray(tools) || tools.length === 0) return callModel(modelId, prompt, options);
  const messages = [{ role: 'user', content: prompt }];
  const maxRounds = 4;
  const maxToolCalls = 8;
  let toolCallCount = 0;
  let last = null;
  for (let round = 0; round < maxRounds; round++) {
    try {
      last = await callModel(modelId, prompt, { ...options, messages, tools, stream: false });
    } catch (error) {
      const message = String(error && error.message || error);
      if (/tool.{0,20}(not supported|unsupported)|function calling.{0,20}(not supported|unsupported)|tool_choice|unknown.{0,20}tools/i.test(message)) {
        emit('tool.unavailable', { nodeId, reason: 'The assigned provider/model does not support tool calling.' });
        const fallbackMessages = [{
          role: 'system',
          content: 'Callable tools are not supported by this provider for this request. Do not claim to have executed tools. Answer only from the context already available.',
        }, ...messages];
        return callModel(modelId, prompt, { ...options, messages: fallbackMessages, tools: undefined });
      }
      throw error;
    }
    const calls = Array.isArray(last.toolCalls) ? last.toolCalls : [];
    if (!calls.length) return last;
    messages.push({
      role: 'assistant',
      content: last.text || null,
      tool_calls: calls,
    });
    const batch = calls.slice(0, Math.max(0, maxToolCalls - toolCallCount));
    toolCallCount += batch.length;
    await Promise.all(batch.map(async (call, callIndex) => {
      const id = String(call.id || 'tool-' + round + '-' + callIndex);
      const fn = call.function || {};
      const name = String(fn.name || '');
      let args = {};
      try { args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : (fn.arguments || {}); }
      catch (_) { args = {}; }
      emit('tool.started', { nodeId, delegateId: options && options.delegateId || null, toolCallId: id, tool: name });
      let result;
      try {
        result = await executeTool(name, args);
        emit('tool.completed', { nodeId, delegateId: options && options.delegateId || null, toolCallId: id, tool: name });
      } catch (error) {
        result = { error: String(error && error.message || 'Tool execution failed').slice(0, 300) };
        emit('tool.failed', { nodeId, delegateId: options && options.delegateId || null, toolCallId: id, tool: name, error: safeDelegateError(error), errorType: String(error && error.name || 'Error').slice(0, 40), errorCode: String(error && error.code || '').slice(0, 40), errorHint: /^(ReferenceError|TypeError)$/.test(String(error && error.name || '')) ? String(error && error.message || '').slice(0, 160) : undefined });
      }
      messages.push({
        role: 'tool',
        tool_call_id: id,
        name,
        content: safeToolResult(result, 12000),
      });
    }));
    if (toolCallCount >= maxToolCalls) break;
  }
  messages.push({ role: 'user', content: 'Use the tool results already provided and give your final answer now. Do not request more tool calls.' });
  return callModel(modelId, prompt, { ...options, messages, stream: false });
}

/**
 * Run a team against a user prompt.
 * ctx = { callModel(modelId, prompt, opts) -> { text, ... } }
 */
async function runTeam(team, userPrompt, ctx) {
  const { callModel, liveness, models, availableModels, memory, memoryState, onMemoryWrite, onTeamUpdate, onTeamCreate, modelQueue, onEvent, stream, settings, skipCommandRouting } = ctx || {};
  const modelPool = Array.isArray(models) ? models : [];
  const queuedModels = Array.isArray(modelQueue) ? modelQueue.map((m) => typeof m === 'string' ? m : (m && (m.id || m.model))).filter(Boolean) : [];
  const runId = 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  function emit(type, data) { if (typeof onEvent === 'function') { try { onEvent({ type, runId, timestamp: Date.now(), ...(data || {}) }); } catch (_) {} } }
  function pickModel(node) {
    if (node && node.model) return node.model;
    const conns = team.connections || team.conns || [];
    // Check if a model node is connected to this node
    const modelConn = conns.find((c) => c.to === (node && node.id) && (c.tp === 'model' || c.tp === 'main'));
    if (modelConn) {
      const srcNode = nodes.find((n) => n.id === modelConn.from && n.type === 'model');
      if (srcNode && srcNode.model) return srcNode.model;
    }
    return queuedModels.find((id) => modelPool.some((m) => m && (m.id === id || m.rawId === id))) || null;
  }
  const nodes = Array.isArray(team.nodes) ? team.nodes : [];

  // Help when no command given
  const t = String(userPrompt || '').trim();
  if (t === '' || t === '/' || t.toLowerCase() === 'help') {
    const cmds = [];
    cmds.push('/status - show status of all nodes');
    const planners = nodes.filter((n) => n.type === 'planner');
    planners.forEach((p, i) => cmds.push('/boss' + (i ? (i+1) : '') + ' <msg> - talk to ' + (p.id || 'boss' + (i+1))));
    const workers = nodes.filter((n) => n.type === 'worker');
    workers.forEach((w, i) => cmds.push('/worker' + (i+1) + ' <msg> - talk to ' + (w.id || 'worker' + (i+1))));
    const synths = nodes.filter((n) => n.type === 'synthesizer');
    synths.forEach((sy, i) => cmds.push('/synth' + (i ? (i+1) : '') + ' <msg> - talk to synthesizer'));
    cmds.push('/team <msg> - talk to all nodes at once');
    return { final: 'Available commands:\n' + cmds.join('\n'), nodes: [], skipped: [], timings: {} };
  }

  const planners = nodes.filter((n) => n.type === 'planner');
  const synthesizers = nodes.filter((n) => n.type === 'synthesizer');
  const workers = nodes.filter((n) => n.type === 'worker');

  // Inline command routing
  const trimmed = String(userPrompt || '').trim();
  const cmdMatch = trimmed.match(/^\/(status|team|boss\d*|worker\d*|synth|synthesizer|agent)\b(.*)$/i);
  if (!skipCommandRouting && cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const rest = (cmdMatch[2] || '').trim();
    if (cmd === 'team') return runTeam(team, rest || userPrompt, { ...ctx, skipCommandRouting: true });
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });

    if (cmd === 'status') {
      const statusLines = nodes.map((n) => {
        const live = liveness && typeof liveness.isLive === 'function' ? liveness.isLive(n.model) : true;
        return '[' + n.type + ':' + n.id + '] model=' + (n.model || '(auto)') + ' ' + (live ? 'LIVE' : 'DEAD') + (n.specialty ? ' specialty=' + n.specialty : '');
      });
      return { final: 'Team status:\n' + statusLines.join('\n'), nodes: [], skipped: [], timings: {} };
    }

    const targetNodes = [];
    if (cmd === 'team') {
      targetNodes.push(...nodes);
    } else if (cmd === 'boss' || /^boss\d+$/.test(cmd)) {
      const n = /^boss\d+$/.test(cmd) ? planners[parseInt(cmd.replace('boss',''),10)-1] : planners[0];
      if (n) targetNodes.push(n);
    } else if (cmd === 'worker' || /^worker\d+$/.test(cmd)) {
      const n = /^worker\d+$/.test(cmd) ? workers[parseInt(cmd.replace('worker',''),10)-1] : workers[0];
      if (n) targetNodes.push(n);
    } else if (cmd === 'synth' || cmd === 'synthesizer') {
      if (synthesizers[0]) targetNodes.push(synthesizers[0]);
    } else if (cmd === 'agent') {
      const ag = nodes.find((n) => n.type === 'agent');
      if (ag) targetNodes.push(ag);
    }

    if (targetNodes.length) {
      const prompt = rest || userPrompt;
      const results = await Promise.all(targetNodes.map(async (n) => {
        n.model = pickModel(n);
        if (!n.model) return { id: n.id, type: n.type, ok: false, error: 'No model assigned', text: '' };
        const sys = (n.systemPrompt || '') + (n.description ? ('\n' + n.description) : '');
        try {
          const out = await callModel(n.model, (sys ? sys + '\n\n' : '') + prompt, { maxTokens: 1024 });
          return { id: n.id, type: n.type, ok: true, text: out.text };
        } catch (e) {
          return { id: n.id, type: n.type, ok: false, error: safeDelegateError(e), text: '' };
        }
      }));
      const usable = results.filter((r) => r.ok && String(r.text || '').trim());
      const final = usable.length ? usable[0].text : 'I could not produce a reliable response from the selected node. Check its model assignment and provider key, then try again.';
      return { final, nodes: results, skipped: [], timings: {} };
    }
  }

  // Liveness check: skip dead workers
  const liveWorkers = [];
  const skipped = [];
  for (const w of workers) {
    let live = true;
    if (liveness && typeof liveness.isLive === 'function') {
      live = liveness.isLive(w.model);
    }
    if (live) liveWorkers.push(w);
    else skipped.push(w.id);
  }

  const availableModelIds = (Array.isArray(availableModels) ? availableModels : [])
    .map((model) => typeof model === 'string' ? model : model && model.id)
    .filter((id) => typeof id === 'string' && id);
  const configuredWorkerModels = liveWorkerModelIds();
  function liveWorkerModelIds() {
    return liveWorkers.map((worker) => pickModel(worker)).filter(Boolean);
  }
  const dynamicModelPool = Array.from(new Set([...configuredWorkerModels, ...availableModelIds]));
  function pickDynamicModel(template, taskIndex) {
    if (!dynamicModelPool.length) return pickModel(template);
    return dynamicModelPool[(Math.max(1, Number(taskIndex) || 1) - 1) % dynamicModelPool.length];
  }

  const timings = {};

  // Memory sync bus: collect shared memory context from memory nodes
  const memNodes = nodes.filter((n) => n.type === 'memory');
  const toolNodes = nodes.filter((n) => n.type === 'tool');
  const mcpNodes = nodes.filter((n) => n.type === 'mcp');
  const inputNodes = nodes.filter((n) => n.type === 'input');
  const outputNodes = nodes.filter((n) => n.type === 'output');
  const agentNodes = nodes.filter((n) => n.type === 'agent');

  // Build shared context from memory nodes
  let sharedMemoryPrompt = '';
  if (memNodes.length > 0) {
    const memoryNotes = memNodes.map((m) => m.description || m.systemPrompt).filter(Boolean);
    const stored = memory && Array.isArray(memory.records) ? memory.records : [];
    const durable = stored.filter((r) => r.scope === 'shared').slice(0, 12);
    const durableText = durable.map((r) => '[Memory: ' + r.title + ']\n' + String(r.content || '').slice(0, 1400)).join('\n\n');
    sharedMemoryPrompt = '\n\n[Mine Cloud Memory: persistent shared workspace context. Treat these as saved project facts and build on them.]' +
      (durableText ? '\n' + durableText : '') + (memoryNotes.length ? '\n' + memoryNotes.join('\n') : '');
  }

  // Built-in tools and MCP instructions
  let toolPrompt = '';
  if (toolNodes.length > 0) {
    toolPrompt = '\n\n[Worker tools: when enabled, each worker receives a fresh isolated Vercel Sandbox with a private workspace, bounded command/file operations, no inherited gateway credentials, and network access disabled. Tools are available only when exposed to that worker. Never claim a command or file operation succeeded without its returned tool result.]';
  }
  let mcpPrompt = '';
  if (mcpNodes.length > 0) {
    const mcpLines = [];
    mcpNodes.forEach((m) => {
      const enabledList = Array.isArray(m.enabledServers) && m.enabledServers.length > 0
        ? m.enabledServers
        : [m.serverName || 'filesystem'];
      const params = m.serverParams || {};

      enabledList.forEach((srvId) => {
        const srvParam = params[srvId] || (srvId === m.serverName ? m.param : '');
        const paramStr = srvParam ? ` [Target: ${srvParam}]` : '';
        mcpLines.push(`• MCP Server "${srvId}"${paramStr}`);
      });
    });
    mcpPrompt = '\n\n[Configured MCP server metadata]:\n' + mcpLines.join('\n') + '\nRemote custom MCP endpoints must use public HTTPS and are exposed only when discovery succeeds. Local stdio presets cannot execute inside the hosted serverless runtime. Never claim a tool ran unless its call returned a result.';
  }

  // Helper to check if a node has permission for a shared capability
  function hasPerm(node, cap) {
    if (!node || !node.permissions) return true;
    return node.permissions[cap] !== false;
  }

  function memoryPromptFor(node) {
    const privateRecords = memory && Array.isArray(memory.records)
      ? memory.records.filter((r) => r.scope === 'private' && r.owner === node.model).slice(0, 6)
      : [];
    const privateText = privateRecords.map((r) => '[Private model memory: ' + r.title + ']\n' + String(r.content || '').slice(0, 1000)).join('\n\n');
    return sharedMemoryPrompt + (privateText ? '\n' + privateText : '');
  }

  // Plan: boss splits task into parts tagged by specialty
  let plan = [];
  const precomputedResults = [];
  let dynamicSpawnCount = 0;
  const reservedTasks = new Set();
  const t0 = Date.now();
  let planDone = false;
  let fallbackPlanner = null;
  let planningMode = 'none';
  let flowMutationCount = 0;
  let plannerResponseText = '';
  for (const planner of planners) {
    if (planDone) break;
    planner.model = pickModel(planner);
    if (!planner.model) continue;
    fallbackPlanner = planner;
    try {
      const desc = planner.description ? ('\nContext/limitations: ' + planner.description) : '';
      const pMem = hasPerm(planner, 'memory') ? memoryPromptFor(planner) : '';
      const pTool = hasPerm(planner, 'tool') ? toolPrompt : '';
      const pMcp = hasPerm(planner, 'mcp') ? mcpPrompt : '';
      const delegateId = runId + ':' + planner.id + ':plan';
      emit('delegate.started', { delegateId, nodeId: planner.id, modelId: planner.model, task: 'Planning', stage: 'planning', role: 'planner' });
      const plannerPrompt = [
        'You are the Team Leader for Mine. You can create real temporary subagents using the spawn_subagent tool.',
        'Use spawn_subagent once for each independent subtask. The tool starts a worker and returns its result. You may call it more than once, within the run limit.',
        'You can also inspect and safely edit the current flow with flow_read, flow_add_node, flow_update_node, flow_connect, and flow_validate. Use team_create to create a separate starter team. These changes are saved automatically; never modify credentials or delete existing teams/nodes.',
        'If the request names Worker A, Worker B, or separate roles, create one spawn call per named task and copy only that role’s task into the task argument.',
        'Never send the entire original request to multiple workers. Every task must be specific, distinct, and independently actionable. Never duplicate a previous task.',
        'Never claim you cannot create subagents. Never ask the user to install a skill for delegation.',
        'Available worker specialties: ' + liveWorkers.map((w) => w.specialty || 'general').join(', '),
        'Delegate when it improves quality or speed. For simple requests, create one worker or answer directly.',
        'After spawning workers, synthesize their returned results into a concise answer. Do not return a JSON task list.',
        'Leader instructions: ' + String(planner.systemPrompt || '') + '\nRequest: ' + userPrompt + desc + pMem + pTool + pMcp,
      ].join('\n');
      const spawnTool = [{
        type: 'function',
        function: {
          name: 'spawn_subagent',
          description: 'Create and run a temporary subagent immediately. Returns its completed result for the Team Leader to use.',
          parameters: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'A specific, independent subtask. Never copy the entire original user request; extract only this worker assignment.' },
              specialty: { type: 'string', description: 'Worker specialty to use.' },
            },
            required: ['task'],
            additionalProperties: false,
          },
        },
      }];
      const maxDynamic = Math.max(1, Math.min(64, Number(settings && settings.teamMaxDelegates) || 8));
      const spawn = async (name, args) => {
        if (name !== 'spawn_subagent') throw new Error('Tool is not available to the Team Leader.');
        if (dynamicSpawnCount >= maxDynamic) throw new Error('Team worker limit reached for this run.');
        const task = String(args && args.task || '').trim();
        if (!task) throw new Error('A non-empty task is required.');
        // Reserve a unique slot before awaiting the worker so parallel tool calls
        // cannot exceed the run limit or collide on task indexes.
        const taskIndex = ++dynamicSpawnCount;
        const specialty = String(args && args.specialty || liveWorkers[0] && liveWorkers[0].specialty || 'general').slice(0, 80);
        if (liveWorkers.length && !liveWorkers.some((w) => (w.specialty || 'general') === specialty)) {
          throw new Error('No worker template is configured for specialty: ' + specialty);
        }
        const matching = liveWorkers.filter((worker) => (worker.specialty || 'general') === specialty);
        const candidates = matching.length ? matching : liveWorkers;
        if (!candidates.length) throw new Error('No worker template is configured for this team.');
        // Reserve templates by task index, not completed-result count.
        // Parallel spawns can finish out of order, so reserve before awaiting.
        const template = candidates[(taskIndex - 1) % candidates.length];
        const worker = { ...template, model: pickDynamicModel(template, taskIndex) };
        if (!worker.model) throw new Error('The selected worker has no assigned or queued model.');
        const delegateId = runId + ':' + worker.id + ':dynamic-' + taskIndex;
        const workerTask = task.slice(0, 4000);
        const normalizeTask = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const normalizedTask = normalizeTask(workerTask);
        const normalizedRequest = normalizeTask(userPrompt);
        if (normalizedTask === normalizedRequest || (normalizedRequest.length > 80 && normalizedTask.includes(normalizedRequest.slice(0, 100)))) {
          throw new Error('This is the entire original request, not a delegated subtask. Split it into one specific independent assignment and try again.');
        }
        if (reservedTasks.has(normalizedTask)) {
          throw new Error('Duplicate subtask rejected. Create a different independent assignment.');
        }
        reservedTasks.add(normalizedTask);
        const wMem = hasPerm(worker, 'memory') ? memoryPromptFor(worker) : '';
        const wTool = hasPerm(worker, 'tool') ? toolPrompt : '';
        const wMcp = hasPerm(worker, 'mcp') ? mcpPrompt : '';
        const sys = (worker.systemPrompt || '') + (worker.description ? ('\\nContext/limitations: ' + worker.description) : '') + wMem + wTool + wMcp;
        const enabledToolIds = hasPerm(worker, 'tool') ? toolNodes.filter((node) => node.enabled !== false).flatMap((node) => Array.isArray(node.enabledTools) ? node.enabledTools : ['calculator', 'memory_list', 'memory_search', 'memory_read']) : [];
        const permittedToolIds = hasPerm(worker, 'memory') ? enabledToolIds : enabledToolIds.filter((id) => id === 'calculator');
        const sandboxExecutor = hasPerm(worker, 'tool') && toolNodes.some((node) => node.enabled !== false) ? createSandboxToolExecutor() : null;
        const workerMcpExecutor = hasPerm(worker, 'mcp') ? await createMcpToolExecutor(mcpNodes, worker, emit) : null;
        const workerTools = buildTeamToolDefinitions(permittedToolIds).concat(sandboxExecutor ? sandboxExecutor.definitions : [], workerMcpExecutor ? workerMcpExecutor.definitions : []);
        emit('delegate.started', { delegateId, nodeId: worker.id, taskIndex, modelId: worker.model, specialty, task: workerTask });
        const started = Date.now();
        try {
          const [workerResult] = await runDelegationGraph([{ taskIndex, task: workerTask }], async (taskEnvelope) => {
            const out = await runNodeWithTools(
              callModel, worker.model, (sys ? sys + '\n\n' : '') + taskEnvelope.task,
              { maxTokens: 1536, stream: false, nodeId: worker.id, delegateId, role: 'worker' },
              workerTools,
              (toolName, toolArgs) => toolName.startsWith('sandbox_') && sandboxExecutor ? sandboxExecutor.execute(toolName, toolArgs) : toolName.startsWith('mcp_') && workerMcpExecutor ? workerMcpExecutor.execute(toolName, toolArgs) : executeTeamTool(memoryState, toolName, toolArgs, worker.model, onMemoryWrite),
              emit, worker.id,
            );
            const result = { worker: worker.id, specialty, taskIndex: taskEnvelope.taskIndex, task: workerTask, modelId: worker.model, delegateId, ok: true, text: String(out.text || ''), tokens: out.tokens || 0, usage: out.usage || null, durationMs: Date.now() - started };
            plan.push({ part: workerTask, specialty, taskIndex });
            precomputedResults.push(result);
            emit('delegate.completed', { delegateId, nodeId: worker.id, taskIndex, modelId: worker.model, tokens: out.tokens || 0, usage: out.usage || null });
            return result;
          }, 1);
          return { completed: true, taskIndex, specialty, worker: worker.id, result: workerResult.text };
        } catch (error) {
          const safeError = safeDelegateError(error);
          emit('delegate.failed', { delegateId, nodeId: worker.id, taskIndex, modelId: worker.model, error: safeError, errorType: String(error && error.name || 'Error').slice(0, 40), errorCode: String(error && error.code || '').slice(0, 40) });
          throw new Error(safeError);
        } finally {
          if (sandboxExecutor) await sandboxExecutor.close();
        }
      };
      const plannerMcpExecutor = hasPerm(planner, 'mcp') ? await createMcpToolExecutor(mcpNodes, planner, emit) : null;
      const bossTools = (hasPerm(planner, 'flow') ? spawnTool.concat(buildBossFlowToolDefinitions()) : spawnTool)
        .concat(plannerMcpExecutor ? plannerMcpExecutor.definitions : []);
      const executePlannerTool = async (name, args) => {
        if (name === 'spawn_subagent') return spawn(name, args);
        if (name.startsWith('mcp_') && plannerMcpExecutor) return plannerMcpExecutor.execute(name, args);
        if (!hasPerm(planner, 'flow')) throw new Error('Flow editing permission is disabled for the Boss node.');
        const result = executeBossFlowTool(team, name, args, {
          onTeamUpdate: (updated) => { if (typeof onTeamUpdate === 'function') onTeamUpdate(updated); },
          onTeamCreate: (created) => typeof onTeamCreate === 'function' ? onTeamCreate(created) : false,
          defaultModel: planner.model,
          workerModel: liveWorkers[0] ? pickModel(liveWorkers[0]) : planner.model,
        });
        if (['flow_add_node', 'flow_update_node', 'flow_connect', 'team_create'].includes(name)) flowMutationCount += 1;
        return result;
      };
      const out = await runNodeWithTools(
        callModel, planner.model, plannerPrompt,
        { maxTokens: 1200, stream: false, nodeId: planner.id, delegateId, role: 'planner', toolChoice: 'required' },
        bossTools, executePlannerTool, emit, planner.id,
      );
      plannerResponseText = String(out && out.text || '');
      emit('delegate.completed', { delegateId, nodeId: planner.id, modelId: planner.model, tokens: out.tokens || 0, stage: 'planning', role: 'planner' });
      if (!plan.length) {
        plan = validatePlannerPlan(
          parsePlannerPlan(out.text),
          userPrompt,
          liveWorkers,
          Math.max(1, Math.min(64, Number(settings && settings.teamMaxDelegates) || 8)),
        );
      }
      if (plan.length > 0) {
        planningMode = precomputedResults.length > 0 ? 'native_tool' : 'structured_json';
        planDone = true;
      }
    } catch (plannerError) {
      emit('delegate.failed', { delegateId: runId + ':' + planner.id + ':plan', nodeId: planner.id, modelId: planner.model, error: safeDelegateError(plannerError) });
    }
  }
  timings.plan = Date.now() - t0;

  if ((!Array.isArray(plan) || plan.length === 0) && planners.length > 0 && fallbackPlanner && liveWorkers.length > 0) {
    const maxFallbackTasks = Math.max(1, Math.min(64, Number(settings && settings.teamMaxDelegates) || 8));
    const specialties = Array.from(new Set(liveWorkers.map((worker) => worker.specialty || 'general')));
    const fallbackPrompt = [
      'You are the Team Leader for Mine. No worker was created by the native delegation call.',
      'Create a valid fallback plan for the original request. Delegate only when the work benefits from separate independent workers.',
      'Return ONLY a JSON array. Each item must have exactly these fields: part (a specific independent task) and specialty (one exact value from the allowed specialties).',
      'Do not return markdown, code fences, explanations, or the final answer.',
      'Never copy the entire original request into a task. Never duplicate tasks. Do not invent specialties or workers.',
      'If the request is simple and does not need delegation, return an empty array.',
      'Maximum tasks: ' + maxFallbackTasks,
      'Allowed specialties: ' + specialties.join(', '),
      'Original request: ' + String(userPrompt || ''),
    ].join('\n');
    emit('planner.fallback.started', {
      nodeId: fallbackPlanner.id,
      modelId: fallbackPlanner.model,
      mode: 'structured_json',
    });
    try {
      const fallbackOut = await callModel(fallbackPlanner.model, fallbackPrompt, {
        maxTokens: 1200,
        stream: false,
        nodeId: fallbackPlanner.id,
        role: 'planner-fallback',
        messages: [
          { role: 'system', content: 'Return only a valid JSON array of task objects. Do not claim that you executed workers or tools.' },
          { role: 'user', content: fallbackPrompt },
        ],
      });
      plan = validatePlannerPlan(parsePlannerPlan(fallbackOut && fallbackOut.text), userPrompt, liveWorkers, maxFallbackTasks);
      if (plan.length > 0) {
        planningMode = 'structured_json';
        emit('planner.fallback.completed', {
          nodeId: fallbackPlanner.id,
          modelId: fallbackPlanner.model,
          mode: planningMode,
          taskCount: plan.length,
        });
      } else {
        emit('planner.fallback.empty', {
          nodeId: fallbackPlanner.id,
          modelId: fallbackPlanner.model,
          reason: 'No valid independent tasks were returned.',
        });
      }
    } catch (error) {
      emit('planner.fallback.failed', {
        nodeId: fallbackPlanner.id,
        modelId: fallbackPlanner.model,
        error: safeDelegateError(error),
      });
    }
  }

  if ((!Array.isArray(plan) || plan.length === 0) && flowMutationCount > 0) {
    const final = plannerResponseText.trim() || 'The requested team or flow changes were saved successfully.';
    emit('run.completed', { status: 'completed', flowMutations: flowMutationCount });
    return { final, nodes: [], skipped, timings: { ...timings, plan: Date.now() - t0 }, runId, status: 'completed', planningMode, flowMutations: flowMutationCount };
  }

  if (!Array.isArray(plan) || plan.length === 0) {
    // Do not fabricate delegation by sending the same full prompt to every
    // configured worker. A Team Leader run must produce a real tool call or
    // an explicit structured plan before worker cards can be shown as started.
    if (planners.length > 0) {
      const reason = 'The Team Leader did not create any subagents or return a valid structured fallback plan. No workers were started.';
      emit('run.failed', { status: 'failed', reason, successfulWorkers: 0, failedWorkers: 0, dynamicSpawnCount });
      return {
        final: reason,
        nodes: [],
        skipped,
        timings: { ...timings, plan: Date.now() - t0 },
        runId,
        status: 'failed',
        failure: 'no_subagents_created',
        planningMode,
      };
    }
    plan = liveWorkers.map((w) => ({ part: userPrompt, specialty: w.specialty || 'general' }));
    planningMode = 'configured_workers';
  }

  // Treat planner output as untrusted: bound task count and field sizes before
  // creating ephemeral delegates.
  const maxDelegates = Math.max(1, Math.min(64, Number(settings && settings.teamMaxDelegates) || 8));
  plan = plan.slice().sort((a, b) => (Number(a && a.taskIndex) || 0) - (Number(b && b.taskIndex) || 0))
    .filter((item) => item && typeof item.part === 'string' && item.part.trim())
    .slice(0, maxDelegates)
    .map((item) => ({
      part: item.part.trim().slice(0, 4000),
      specialty: String(item.specialty || 'general').slice(0, 80),
      // Keep the original dynamic task index. Parallel workers can finish out
      // of order, and failed earlier tasks must not shift later assignments.
      taskIndex: Number.isInteger(Number(item.taskIndex)) && Number(item.taskIndex) > 0
        ? Number(item.taskIndex)
        : null,
    }));

  // Create a fresh delegate instance for every planned task. Dynamic spawn
  // results are matched by their reserved task index, never completion order.
  const specialtyOffsets = new Map();
  const assignments = plan.map((p, index) => {
    const specialty = p.specialty || 'general';
    const matching = liveWorkers.filter((worker) => (worker.specialty || 'general') === specialty);
    const candidates = matching.length ? matching : liveWorkers;
    if (!candidates.length) return null;
    const offset = specialtyOffsets.get(specialty) || 0;
    specialtyOffsets.set(specialty, offset + 1);
    const template = candidates[offset % candidates.length];
    const taskIndex = p.taskIndex || index + 1;
    const precomputed = precomputedResults.find((result) => result.text && result.taskIndex === taskIndex) || null;
    const workerId = precomputed ? precomputed.worker : template.id;
    return {
      part: p.part,
      specialty,
      precomputed,
      workerId,
      taskIndex,
      worker: { ...template, id: workerId, model: precomputed ? precomputed.modelId : pickDynamicModel(template, taskIndex) },
    };
  }).filter(Boolean);

  // Execute worker delegates concurrently, each with its own run identity.
  const t1 = Date.now();
  const workerConcurrency = Math.max(1, Math.min(8, Number(settings && settings.teamConcurrency) || 2));
  const results = await runDelegationGraph(assignments, async (a) => {
    if (a.precomputed) return a.precomputed;
    a.worker.model = pickModel(a.worker);
    const delegateId = runId + ':' + a.workerId + ':task-' + a.taskIndex;
    if (!a.worker.model) {
      emit('delegate.failed', { delegateId, nodeId: a.workerId, taskIndex: a.taskIndex, error: 'No assigned or queued model' });
      return { worker: a.workerId, specialty: a.specialty, taskIndex: a.taskIndex, delegateId, ok: false, error: 'No assigned or queued model', text: '', tokens: 0 };
    }
    const wMem = hasPerm(a.worker, 'memory') ? memoryPromptFor(a.worker) : '';
    const wTool = hasPerm(a.worker, 'tool') ? toolPrompt : '';
    const wMcp = hasPerm(a.worker, 'mcp') ? mcpPrompt : '';
    const sys = (a.worker.systemPrompt || '') + (a.worker.description ? ('\nContext/limitations: ' + a.worker.description) : '') + wMem + wTool + wMcp;
    emit('delegate.started', { delegateId, nodeId: a.workerId, taskIndex: a.taskIndex, modelId: a.worker.model, specialty: a.specialty, task: String(a.part || '').slice(0, 160) });
    try {
      const enabledToolIds = hasPerm(a.worker, 'tool') ? toolNodes.filter((node) => node.enabled !== false).flatMap((node) => Array.isArray(node.enabledTools) ? node.enabledTools : ['calculator', 'memory_list', 'memory_search', 'memory_read']) : [];
      const permittedToolIds = hasPerm(a.worker, 'memory') ? enabledToolIds : enabledToolIds.filter((id) => id === 'calculator');
      const sandboxExecutor = hasPerm(a.worker, 'tool') && toolNodes.some((node) => node.enabled !== false) ? createSandboxToolExecutor() : null;
      const workerMcpExecutor = hasPerm(a.worker, 'mcp') ? await createMcpToolExecutor(mcpNodes, a.worker, emit) : null;
      const toolDefinitions = buildTeamToolDefinitions(permittedToolIds).concat(sandboxExecutor ? sandboxExecutor.definitions : [], workerMcpExecutor ? workerMcpExecutor.definitions : []);
      const out = await runNodeWithTools(
        callModel,
        a.worker.model,
        (sys ? sys + '\n\n' : '') + a.part,
        { maxTokens: 1536, stream, nodeId: a.workerId, delegateId, role: 'worker' },
        toolDefinitions,
        (name, args) => name.startsWith('sandbox_') && sandboxExecutor ? sandboxExecutor.execute(name, args) : name.startsWith('mcp_') && workerMcpExecutor ? workerMcpExecutor.execute(name, args) : executeTeamTool(memoryState, name, args, a.worker.model, onMemoryWrite),
        emit,
        a.workerId,
      );
      emit('delegate.completed', { delegateId, nodeId: a.workerId, taskIndex: a.taskIndex, modelId: a.worker.model, tokens: out.tokens || 0, usage: out.usage || null });
      return { worker: a.workerId, specialty: a.specialty, taskIndex: a.taskIndex, task: String(a.part || '').slice(0, 4000), modelId: a.worker.model, delegateId, ok: true, text: out.text, tokens: out.tokens || 0, usage: out.usage || null };
    } catch (e) {
      emit('delegate.failed', { delegateId, nodeId: a.workerId, taskIndex: a.taskIndex, modelId: a.worker.model, error: safeDelegateError(e) });
      return { worker: a.workerId, specialty: a.specialty, taskIndex: a.taskIndex, modelId: a.worker.model, delegateId, ok: false, error: safeDelegateError(e), text: '', tokens: 0 };
    } finally {
      if (sandboxExecutor) await sandboxExecutor.close();
    }
  }, workerConcurrency);
  timings.work = Date.now() - t1;

  // Synthesize successful worker findings. Failed worker diagnostics stay in
  // run metadata and are never injected into the user-facing answer.
  const t2 = Date.now();
  const usableResults = results.filter((r) => r.ok && String(r.text || '').trim());
  let final = '';
  const synthPrompt = [
    'You are the central Mine coordinator. Produce the single final answer for the user.',
    'Do not expose raw worker transcripts, internal logs, stack traces, provider payloads, or tool metadata.',
    'Resolve overlap, remove repetition, organize the answer with clear headings and concise bullets when useful.',
    'Separate verified findings from uncertainty. Never claim a tool ran unless a worker supplied verifiable tool output.',
    'If a finding is incomplete, explain the limitation briefly. Answer the original request directly.',
    '',
    'Original user request:',
    String(userPrompt || ''),
    '',
    'Successful worker findings:',
    usableResults.map((r, i) => 'Finding ' + (i + 1) + ' (' + (r.specialty || 'general') + '):\n' + r.text).join('\n\n'),
  ].join('\n');

  // Prefer configured synthesizers, then the lead agent, planner, and finally
  // a successful worker model as a recovery synthesizer.
  // Prefer the dedicated synthesizer. If it was removed from the graph,
  // route worker findings directly to the configured agent; if there is no
  // agent, let the planner perform the final synthesis. A worker is the last
  // recovery option only when the graph has no other finalizer.
  const graphConnections = team.connections || team.conns || [];
  const connectedNodeIds = new Set(graphConnections
    .filter((c) => c && c.from && c.to)
    .flatMap((c) => [c.from, c.to]));
  const connectedAgents = agentNodes.filter((n) => connectedNodeIds.has(n.id));
  const synthesisNodes = synthesizers.length
    ? [...synthesizers, ...connectedAgents, ...agentNodes, ...planners, ...liveWorkers]
    : [...connectedAgents, ...agentNodes, ...planners, ...liveWorkers];
  const seenSynthesisModels = new Set();
  let synthesisNodeUsed = null;
  for (const node of synthesisNodes) {
    node.model = pickModel(node);
    if (!node.model || seenSynthesisModels.has(node.model) || !usableResults.length) continue;
    seenSynthesisModels.add(node.model);
    try {
      const sMem = hasPerm(node, 'memory') ? memoryPromptFor(node) : '';
      const delegateId = runId + ':' + node.id + ':synthesize';
      emit('delegate.started', { delegateId, nodeId: node.id, modelId: node.model, task: 'Central synthesis', stage: 'synthesis', role: 'synthesizer' });
      const out = await callModel(node.model, (node.systemPrompt ? node.systemPrompt + '\n\n' : '') + synthPrompt + sMem, {
        maxTokens: 2048, stream, nodeId: node.id, delegateId, role: 'synthesizer',
      });
      if (out && String(out.text || '').trim()) {
        final = String(out.text).trim();
        synthesisNodeUsed = node.id;
        emit('delegate.completed', { delegateId, nodeId: node.id, modelId: node.model, tokens: out.tokens || 0, stage: 'synthesis', role: 'synthesizer' });
        break;
      }
      emit('delegate.failed', { delegateId, nodeId: node.id, modelId: node.model, error: 'Empty synthesis response' });
    } catch (e) {
      emit('delegate.failed', { delegateId: runId + ':' + node.id + ':synthesize', nodeId: node.id, modelId: node.model, error: safeDelegateError(e), stage: 'synthesis', role: 'synthesizer' });
    }
  }
  timings.synthesize = Date.now() - t2;

  if (!final) {
    final = usableResults.length
      ? 'I collected worker findings, but the central synthesis step could not complete. I’m withholding the raw worker output rather than presenting an unreviewed transcript. Please check the synthesizer model and provider availability, then retry.'
      : 'I could not complete this team run because no worker returned a usable result. Check the worker model assignments, API keys, and provider availability, then retry.';
  }
  // Agent review loop: synthesizer connects back to agent
  if (team.reviewFinal === true && agentNodes.length > 0 && agentNodes[0].systemPrompt && synthesisNodeUsed !== agentNodes[0].id) {
    const agent = agentNodes[0];
    agent.model = pickModel(agent);
    if (agent.model) {
      try {
        const agentPrompt = `You are the lead AI Agent coordinator. Review and finalize this synthesized output before delivering to output:\n\nOriginal Request: ${userPrompt}\n\nSynthesized Response:\n${final}`;
        const agentMem = hasPerm(agent, 'memory') ? memoryPromptFor(agent) : '';
        const delegateId = runId + ':' + agent.id + ':review';
        emit('delegate.started', { delegateId, nodeId: agent.id, modelId: agent.model, task: 'Final review', stage: 'review', role: 'agent' });
        const agentOut = await callModel(agent.model, (agent.systemPrompt ? agent.systemPrompt + '\n\n' : '') + agentMem + agentPrompt, { maxTokens: 2048, stream, nodeId: agent.id, delegateId, role: 'agent' });
        emit('delegate.completed', { delegateId, nodeId: agent.id, modelId: agent.model, tokens: agentOut.tokens || 0, stage: 'review', role: 'agent' });
        if (agentOut && agentOut.text) {
          final = agentOut.text;
        }
      } catch (_) {}
    }
  }

  if (memory && typeof memory.save === 'function' && memNodes.some((n) => n.syncWithAgent !== false)) {
    try {
      await memory.save({
        title: 'Team run: ' + (team.name || team.slug || team.id),
        content: '# ' + (team.name || team.slug || team.id) + '\n\n**Request**\n' + String(userPrompt).slice(0, 3000) + '\n\n**Result**\n' + String(final).slice(0, 5000),
        scope: 'shared',
        format: 'markdown',
        tags: ['team-run', team.slug || team.id],
      });
    } catch (_) {}
  }
  const runStatus = usableResults.length > 0 && synthesisNodeUsed ? 'completed' : 'failed';
  const runFailure = runStatus === 'completed' ? null : (usableResults.length > 0 ? 'synthesis_failed' : 'no_worker_results');
  emit(runStatus === 'completed' ? 'run.completed' : 'run.failed', {
    status: runStatus,
    failure: runFailure,
    totalTokens: results.reduce((sum, item) => sum + (item.tokens || 0), 0),
    successfulWorkers: usableResults.length,
    failedWorkers: results.length - usableResults.length,
    planningMode,
    timings,
  });
  return {
    final,
    nodes: results,
    skipped,
    timings,
    runId,
    planningMode,
    status: runStatus,
    failure: runFailure,
    successfulWorkers: usableResults.length,
    failedWorkers: results.length - usableResults.length,
  };
}


module.exports = {
  runTeam,
  TEAM_PREFIX,
  isTeamRequest,
  findTeam,
  teamModelIds,
  validateTeam,
};
