'use strict';

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
    return teams.find((t) => t.id === slug && t.enabled !== false) || null;
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
    .map((t) => `mine/team/${t.slug}`);
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
  const workers = team.nodes.filter((n) => n.type === 'worker');

  if (!hasPlanner) problems.push('Team needs at least one planner node');
  if (!hasSynthesizer) problems.push('Team needs at least one synthesizer node');
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


/**
 * Run a team against a user prompt.
 * ctx = { callModel(modelId, prompt, opts) -> { text, ... } }
 */
async function runTeam(team, userPrompt, ctx) {
  const { callModel, liveness, models, memory, modelQueue, onEvent, stream } = ctx || {};
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
  if (cmdMatch) {
    const cmd = cmdMatch[1].toLowerCase();
    const rest = (cmdMatch[2] || '').trim();
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
        if (!n.model) return { id: n.id, type: n.type, text: '[no model]' };
        const sys = (n.systemPrompt || '') + (n.description ? ('\n' + n.description) : '');
        try {
          const out = await callModel(n.model, (sys ? sys + '\n\n' : '') + prompt, { maxTokens: 1024 });
          return { id: n.id, type: n.type, text: out.text };
        } catch (e) {
          return { id: n.id, type: n.type, text: '[error: ' + e.message + ']' };
        }
      }));
      const final = results.map((r) => '[' + r.type + ':' + r.id + '] ' + r.text).join('\n\n');
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
    toolPrompt = '\n\n[Built-in Tools Enabled: You have access to workspace tools: grep (search codebase), powershell (run shell commands), file_view (read files), file_edit (surgical edits). Call tools as needed to inspect and verify.]';
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
    mcpPrompt = '\n\n[Active Model Context Protocol (MCP) Servers Connected]:\n' + mcpLines.join('\n') + '\nYou have access to execute tools from these MCP servers (such as reading files, GitHub exploration, web fetching, and database querying) to fulfill your tasks.';
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
  const t0 = Date.now();
  let planDone = false;
  for (const planner of planners) {
    if (planDone) break;
    planner.model = pickModel(planner);
    if (!planner.model) continue;
    try {
      const desc = planner.description ? ('\nContext/limitations: ' + planner.description) : '';
      const pMem = hasPerm(planner, 'memory') ? memoryPromptFor(planner) : '';
      const pTool = hasPerm(planner, 'tool') ? toolPrompt : '';
      const pMcp = hasPerm(planner, 'mcp') ? mcpPrompt : '';
      const delegateId = runId + ':' + planner.id + ':plan';
      emit('delegate.started', { delegateId, nodeId: planner.id, modelId: planner.model, task: 'Planning' });
      const out = await callModel(planner.model, 'Split this request into parts, each tagged with a specialty from this list: ' + liveWorkers.map((w) => w.specialty || 'general').join(', ') + '. Request: ' + userPrompt + desc + pMem + pTool + pMcp + '\nRespond as JSON array of {part, specialty}.', { maxTokens: 512, stream, nodeId: planner.id, delegateId, role: 'planner' });
      emit('delegate.completed', { delegateId, nodeId: planner.id, modelId: planner.model, tokens: out.tokens || 0 });
      const m = out.text.match(/\[[\s\S]*\]/);
      if (m) plan = JSON.parse(m[0]);
    } catch (_) {}
  }
  timings.plan = Date.now() - t0;

  if (!Array.isArray(plan) || plan.length === 0) {
    // fallback: one part per worker
    plan = liveWorkers.map((w, i) => ({ part: userPrompt, specialty: w.specialty || 'general' }));
  }

  // Assign parts to workers by specialty
  const assignments = plan.map((p) => {
    const w = liveWorkers.find((x) => (x.specialty || 'general') === (p.specialty || 'general')) || liveWorkers[0];
    return { part: p.part, worker: w };
  }).filter((a) => a.worker);

  // Execute worker delegates concurrently, each with its own run identity.
  const t1 = Date.now();
  const results = await Promise.all(assignments.map(async (a, index) => {
    a.worker.model = pickModel(a.worker);
    const delegateId = runId + ':' + a.worker.id + ':' + (index + 1);
    if (!a.worker.model) {
      emit('delegate.failed', { delegateId, nodeId: a.worker.id, error: 'No assigned or queued model' });
      return { worker: a.worker.id, specialty: a.worker.specialty, delegateId, text: '[no assigned or queued model]', tokens: 0 };
    }
    const wMem = hasPerm(a.worker, 'memory') ? memoryPromptFor(a.worker) : '';
    const wTool = hasPerm(a.worker, 'tool') ? toolPrompt : '';
    const wMcp = hasPerm(a.worker, 'mcp') ? mcpPrompt : '';
    const sys = (a.worker.systemPrompt || '') + (a.worker.description ? ('\nContext/limitations: ' + a.worker.description) : '') + wMem + wTool + wMcp;
    emit('delegate.started', { delegateId, nodeId: a.worker.id, modelId: a.worker.model, specialty: a.worker.specialty || 'general', task: String(a.part || '').slice(0, 160) });
    try {
      const out = await callModel(a.worker.model, (sys ? sys + '\n\n' : '') + a.part, { maxTokens: 1024, stream, nodeId: a.worker.id, delegateId, role: 'worker' });
      emit('delegate.completed', { delegateId, nodeId: a.worker.id, modelId: a.worker.model, tokens: out.tokens || 0, usage: out.usage || null });
      return { worker: a.worker.id, specialty: a.worker.specialty, modelId: a.worker.model, delegateId, text: out.text, tokens: out.tokens || 0, usage: out.usage || null };
    } catch (e) {
      emit('delegate.failed', { delegateId, nodeId: a.worker.id, modelId: a.worker.model, error: e.message });
      return { worker: a.worker.id, specialty: a.worker.specialty, modelId: a.worker.model, delegateId, text: '[error: ' + e.message + ']', tokens: 0 };
    }
  }));
  timings.work = Date.now() - t1;

  // Synthesize: merge worker outputs
  const t2 = Date.now();
  let final = results.map((r) => r.text).join('\n\n');
  for (const synthesizer of synthesizers) {
    synthesizer.model = pickModel(synthesizer);
    if (!synthesizer.model) continue;
    try {
      const synthDesc = synthesizer.description ? ('\nContext/limitations: ' + synthesizer.description) : '';
      const sMem = hasPerm(synthesizer, 'memory') ? memoryPromptFor(synthesizer) : '';
      const synthPrompt = 'Merge these worker outputs into one coherent answer to the original request: ' + userPrompt + synthDesc + sMem + '\n\n' + results.map((r) => '[' + r.specialty + '] ' + r.text).join('\n\n');
      const delegateId = runId + ':' + synthesizer.id + ':synthesize';
      emit('delegate.started', { delegateId, nodeId: synthesizer.id, modelId: synthesizer.model, task: 'Synthesis' });
      const out = await callModel(synthesizer.model, synthPrompt, { maxTokens: 2048, stream, nodeId: synthesizer.id, delegateId, role: 'synthesizer' });
      emit('delegate.completed', { delegateId, nodeId: synthesizer.id, modelId: synthesizer.model, tokens: out.tokens || 0 });
      final = out.text;
      break;
    } catch (_) {}
  }
  timings.synthesize = Date.now() - t2;

  // Agent review loop: synthesizer connects back to agent
  if (agentNodes.length > 0 && agentNodes[0].systemPrompt) {
    const agent = agentNodes[0];
    agent.model = pickModel(agent);
    if (agent.model) {
      try {
        const agentPrompt = `You are the lead AI Agent coordinator. Review and finalize this synthesized output before delivering to output:\n\nOriginal Request: ${userPrompt}\n\nSynthesized Response:\n${final}`;
        const agentMem = hasPerm(agent, 'memory') ? memoryPromptFor(agent) : '';
        const delegateId = runId + ':' + agent.id + ':review';
        emit('delegate.started', { delegateId, nodeId: agent.id, modelId: agent.model, task: 'Final review' });
        const agentOut = await callModel(agent.model, (agent.systemPrompt ? agent.systemPrompt + '\n\n' : '') + agentMem + agentPrompt, { maxTokens: 2048, stream, nodeId: agent.id, delegateId, role: 'agent' });
        emit('delegate.completed', { delegateId, nodeId: agent.id, modelId: agent.model, tokens: agentOut.tokens || 0 });
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
  emit('run.completed', { totalTokens: results.reduce((sum, item) => sum + (item.tokens || 0), 0), timings });
  return { final, nodes: results, skipped, timings, runId };
}


module.exports = {
  runTeam,
  TEAM_PREFIX,
  isTeamRequest,
  findTeam,
  teamModelIds,
  validateTeam,
};
