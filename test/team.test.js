'use strict';

const assert = require('assert');
const { test } = require('node:test');
const { runTeam } = require('../lib/gateway/team');

test('Team worker delegates execute concurrently and emit independent lifecycle events', async () => {
  let active = 0;
  let maximumActive = 0;
  const events = [];
  const team = {
    id: 'parallel-team',
    nodes: [
      { id: 'worker-a', type: 'worker', model: 'provider/model-a', specialty: 'research' },
      { id: 'worker-b', type: 'worker', model: 'provider/model-b', specialty: 'coding' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Do two tasks', {
    models: [{ id: 'provider/model-a' }, { id: 'provider/model-b' }],
    modelQueue: [],
    onEvent: (event) => events.push(event),
    callModel: async (modelId, prompt, options) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return { text: modelId + ' completed', tokens: 12, usage: { totalTokens: 12 } };
    },
  });
  assert.strictEqual(maximumActive, 2);
  assert.strictEqual(result.nodes.length, 2);
  assert.ok(events.filter((event) => event.type === 'delegate.started').length >= 2);
  assert.ok(events.filter((event) => event.type === 'delegate.completed').length >= 2);
  assert.ok(result.nodes.every((node) => node.delegateId && node.modelId));
});

test('Team never silently selects an arbitrary discovered model', async () => {
  let calls = 0;
  const team = {
    id: 'explicit-model-team',
    nodes: [{ id: 'worker-empty', type: 'worker', specialty: 'general' }],
    connections: [],
  };
  const result = await runTeam(team, 'Run without assignment', {
    models: [{ id: 'provider/unselected-model' }],
    modelQueue: [],
    callModel: async () => { calls += 1; return { text: 'unexpected' }; },
  });
  assert.strictEqual(calls, 0);
  assert.match(result.nodes[0].error, /no assigned or queued model/i);
});


test('Central synthesizer returns an organized answer and excludes raw worker failures', async () => {
  const team = {
    id: 'synthesis-team',
    nodes: [
      { id: 'worker-good', type: 'worker', model: 'provider/worker', specialty: 'research' },
      { id: 'worker-bad', type: 'worker', model: 'provider/worker', specialty: 'coding' },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Investigate this issue', {
    models: [{ id: 'provider/worker' }, { id: 'provider/synth' }],
    modelQueue: [],
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'worker' && options.nodeId === 'worker-bad') {
        throw new Error('upstream 429 raw-provider-payload');
      }
      if (options.role === 'synthesizer') {
        assert.match(prompt, /Do not expose raw worker transcripts/);
        assert.match(prompt, /Finding 1/);
        assert.doesNotMatch(prompt, /raw-provider-payload/);
        return { text: '## Findings\\n- The issue is confirmed.\\n\\n## Recommendation\\n- Retry with an available key.' };
      }
      return { text: 'The issue is confirmed by the worker.' };
    },
  });
  assert.match(result.final, /## Findings/);
  assert.doesNotMatch(result.final, /raw-provider-payload|upstream 429/);
  assert.strictEqual(result.nodes.find((n) => n.worker === 'worker-bad').ok, false);
});

test('Team with failed synthesis fails closed instead of returning raw worker text', async () => {
  const team = {
    id: 'synthesis-fallback-team',
    nodes: [
      { id: 'worker', type: 'worker', model: 'provider/model', specialty: 'general' },
      { id: 'synth', type: 'synthesizer', model: 'provider/model' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Do the task', {
    models: [{ id: 'provider/model' }],
    modelQueue: [],
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'synthesizer') throw new Error('upstream 403 provider details');
      return { text: 'PRIVATE RAW WORKER TRANSCRIPT' };
    },
  });
  assert.match(result.final, /withholding the raw worker output/i);
  assert.doesNotMatch(result.final, /PRIVATE RAW WORKER TRANSCRIPT|provider details/);
});


test('Team worker concurrency respects the configured per-run limit', async () => {
  let active = 0;
  let maximumActive = 0;
  const team = {
    id: 'bounded-team',
    nodes: Array.from({ length: 5 }, (_, index) => ({
      id: 'worker-' + index,
      type: 'worker',
      model: 'provider/model',
      specialty: 'general',
    })),
    connections: [],
  };
  const result = await runTeam(team, 'Run five independent tasks', {
    settings: { teamConcurrency: 2 },
    models: [{ id: 'provider/model' }],
    modelQueue: [],
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'synthesizer') return { text: 'Five worker findings were combined.' };
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { text: 'Worker finding ' + options.nodeId };
    },
  });
  assert.strictEqual(maximumActive, 2);
  assert.match(result.final, /Five worker findings/);
});


test('planner can spawn bounded ephemeral delegates from one worker template', async () => {
  const workerCalls = [];
  const team = {
    id: 'dynamic-team',
    nodes: [
      { id: 'planner', type: 'planner', model: 'provider/planner' },
      { id: 'worker-template', type: 'worker', model: 'provider/worker', specialty: 'general' },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Split this into subtasks', {
    settings: { teamMaxDelegates: 3, teamConcurrency: 2 },
    models: [{ id: 'provider/planner' }, { id: 'provider/worker' }, { id: 'provider/synth' }],
    modelQueue: [],
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'planner') {
        return { text: JSON.stringify([
          { part: 'Research part A', specialty: 'general' },
          { part: 'Research part B', specialty: 'general' },
          { part: 'Research part C', specialty: 'general' },
          { part: 'This fourth task must be capped', specialty: 'general' },
        ]) };
      }
      if (options.role === 'worker') {
        workerCalls.push({ nodeId: options.nodeId, delegateId: options.delegateId, prompt });
        return { text: 'Completed: ' + prompt };
      }
      return { text: 'Combined three delegate findings.' };
    },
  });
  assert.strictEqual(workerCalls.length, 3);
  assert.strictEqual(new Set(workerCalls.map((call) => call.delegateId)).size, 3);
  assert.ok(workerCalls.every((call) => call.nodeId === 'worker-template'));
  assert.strictEqual(result.nodes.length, 3);
  assert.deepStrictEqual(result.nodes.map((node) => node.taskIndex), [1, 2, 3]);
});

test('worker can execute enabled calculator tools and use the result', async () => {
  const events = [];
  const team = {
    id: 'tool-team',
    nodes: [
      { id: 'planner', type: 'planner', model: 'provider/planner' },
      { id: 'worker', type: 'worker', model: 'provider/worker', specialty: 'general' },
      { id: 'tools', type: 'tool', enabledTools: ['calculator'] },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Calculate twelve times seven', {
    models: [{ id: 'provider/planner' }, { id: 'provider/worker' }, { id: 'provider/synth' }],
    modelQueue: [],
    onEvent: (event) => events.push(event),
    memoryState: {},
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'planner') return { text: '[{"part":"Calculate 12 * 7","specialty":"general"}]' };
      if (options.role === 'worker' && Array.isArray(options.tools)) {
        const last = options.messages[options.messages.length - 1];
        if (last.role === 'user') {
          return {
            text: '',
            toolCalls: [{
              id: 'calc-call-1',
              type: 'function',
              function: { name: 'calculator', arguments: JSON.stringify({ expression: '12 * 7' }) },
            }],
          };
        }
        assert.strictEqual(last.role, 'tool');
        assert.match(last.content, /84/);
        return { text: '12 times 7 equals 84.' };
      }
      if (options.role === 'worker') return { text: 'Worker did not receive tool definitions.' };
      return { text: 'The answer is 84.' };
    },
  });
  assert.match(result.final, /84/);
  assert.ok(events.some((event) => event.type === 'tool.started' && event.tool === 'calculator'));
  assert.ok(events.some((event) => event.type === 'tool.completed' && event.tool === 'calculator'));
});


test('worker falls back without tools when provider rejects function calling', async () => {
  let rejectedTools = false;
  const team = {
    id: 'no-tools-team',
    nodes: [
      { id: 'planner', type: 'planner', model: 'provider/planner' },
      { id: 'worker', type: 'worker', model: 'provider/worker', specialty: 'general' },
      { id: 'tools', type: 'tool', enabledTools: ['calculator'] },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Answer without unsupported tool calls', {
    models: [{ id: 'provider/planner' }, { id: 'provider/worker' }, { id: 'provider/synth' }],
    modelQueue: [],
    memoryState: {},
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'planner') return { text: '[{"part":"Do the task","specialty":"general"}]' };
      if (options.role === 'worker' && Array.isArray(options.tools)) {
        rejectedTools = true;
        throw new Error('tools are not supported by this model');
      }
      if (options.role === 'worker') {
        assert.ok(options.messages.some((message) => message.role === 'system' && /Do not claim to have executed tools/.test(message.content)));
        return { text: 'Completed without tool execution.' };
      }
      return { text: 'Final answer based on available context.' };
    },
  });
  assert.ok(rejectedTools);
  assert.match(result.final, /Final answer/);
});


test('Team Leader receives executable spawn_subagent tool and queued tasks reach synthesis', async () => {
  const events = [];
  let plannerToolSeen = false;
  let workerRuns = 0;
  const team = {
    id: 'spawn-tool-team',
    nodes: [
      { id: 'leader', type: 'planner', model: 'provider/leader', systemPrompt: 'Delegate independent work.' },
      { id: 'researcher', type: 'worker', model: 'provider/worker', specialty: 'research' },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Research and summarize this topic', {
    settings: { teamMaxDelegates: 2 },
    models: [{ id: 'provider/leader' }, { id: 'provider/worker' }, { id: 'provider/synth' }],
    modelQueue: [],
    onEvent: (event) => events.push(event),
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'planner' && Array.isArray(options.tools)) {
        plannerToolSeen = options.tools.some((tool) => tool.function && tool.function.name === 'spawn_subagent');
        assert.match(options.messages[0].content, /Delegate independent work/);
        const toolResult = options.messages.find((message) => message.role === 'tool');
        if (toolResult) {
          assert.match(toolResult.content, /Three verified facts were found/);
          return { text: 'Plan accepted using the worker result.' };
        }
        return { text: '', toolCalls: [{
          id: 'spawn-1', type: 'function',
          function: { name: 'spawn_subagent', arguments: JSON.stringify({ task: 'Find three reliable facts', specialty: 'research' }) },
        }] };
      }
      if (options.role === 'worker') {
        workerRuns += 1;
        return { text: 'Three verified facts were found.' };
      }
      if (options.role === 'synthesizer') {
        assert.match(prompt, /Three verified facts were found/);
        return { text: 'Summary based on three verified facts.' };
      }
      return { text: 'Unexpected role' };
    },
  });
  assert.ok(plannerToolSeen);
  assert.strictEqual(workerRuns, 1);
  assert.match(result.final, /three verified facts/i);
  assert.ok(events.some((event) => event.type === 'tool.started' && event.tool === 'spawn_subagent'));
  assert.ok(events.some((event) => event.type === 'delegate.started' && event.task === 'Find three reliable facts'));
});


test('Team Leader can spawn independent subagents concurrently and synthesize both results', async () => {
  let activeWorkers = 0;
  let maximumActiveWorkers = 0;
  let plannerToolCalls = 0;
  const events = [];
  const team = {
    id: 'parallel-spawn-team',
    nodes: [
      { id: 'leader', type: 'planner', model: 'provider/leader' },
      { id: 'researcher', type: 'worker', model: 'provider/worker', specialty: 'research' },
      { id: 'synth', type: 'synthesizer', model: 'provider/synth' },
    ],
    connections: [],
  };
  const result = await runTeam(team, 'Research two independent questions', {
    settings: { teamMaxDelegates: 4 },
    models: [{ id: 'provider/leader' }, { id: 'provider/worker' }, { id: 'provider/synth' }],
    modelQueue: [],
    onEvent: (event) => events.push(event),
    callModel: async (modelId, prompt, options) => {
      if (options.role === 'planner') {
        const toolMessages = options.messages.filter((message) => message.role === 'tool');
        if (toolMessages.length >= 2) {
          assert.ok(toolMessages.some((message) => /Result A/.test(message.content)));
          assert.ok(toolMessages.some((message) => /Result B/.test(message.content)));
          return { text: 'Both independent workers returned their results.' };
        }
        plannerToolCalls += 1;
        return {
          text: '',
          toolCalls: [
            { id: 'spawn-a', type: 'function', function: { name: 'spawn_subagent', arguments: JSON.stringify({ task: 'Investigate question A', specialty: 'research' }) } },
            { id: 'spawn-b', type: 'function', function: { name: 'spawn_subagent', arguments: JSON.stringify({ task: 'Investigate question B', specialty: 'research' }) } },
          ],
        };
      }
      if (options.role === 'worker') {
        activeWorkers += 1;
        maximumActiveWorkers = Math.max(maximumActiveWorkers, activeWorkers);
        await new Promise((resolve) => setTimeout(resolve, 30));
        activeWorkers -= 1;
        return { text: prompt.includes('question A') ? 'Result A' : 'Result B' };
      }
      if (options.role === 'synthesizer') {
        assert.match(prompt, /Result A/);
        assert.match(prompt, /Result B/);
        return { text: 'Combined answer: Result A and Result B.' };
      }
      return { text: 'Unexpected role' };
    },
  });
  assert.strictEqual(plannerToolCalls, 1);
  assert.strictEqual(maximumActiveWorkers, 2);
  assert.strictEqual(result.nodes.length, 2);
  assert.deepStrictEqual(result.nodes.map((node) => node.taskIndex), [1, 2]);
  assert.match(result.final, /Result A and Result B/);
  assert.strictEqual(events.filter((event) => event.type === 'delegate.started' && /Investigate question/.test(event.task || '')).length, 2);
});
