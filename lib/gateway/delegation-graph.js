'use strict';

/**
 * Bounded dynamic fan-out using LangGraph Send.
 *
 * Every Send carries only one task envelope. The worker executor receives the
 * task-scoped prompt and returns a compact result; no parent conversation or
 * sibling worker transcript is placed in the graph state.
 */
let graphRuntimePromise = null;

async function loadGraphRuntime() {
  if (!graphRuntimePromise) {
    graphRuntimePromise = import('@langchain/langgraph').then((mod) => {
      const { Annotation, StateGraph, START, END, Send } = mod;
      if (!Annotation || !StateGraph || !Send || !START || !END) {
        throw new Error('Installed LangGraph package does not expose the required graph API');
      }
      return { Annotation, StateGraph, START, END, Send };
    }).catch((error) => {
      graphRuntimePromise = null;
      throw error;
    });
  }
  return graphRuntimePromise;
}

async function runDelegationGraph(tasks, execute, concurrency) {
  const input = Array.isArray(tasks) ? tasks : [];
  if (!input.length) return [];
  if (typeof execute !== 'function') throw new TypeError('A worker executor is required');
  const limit = Math.max(1, Math.min(32, Number(concurrency) || 4));
  const { Annotation, StateGraph, START, END, Send } = await loadGraphRuntime();
  const State = Annotation.Root({
    tasks: Annotation(),
    task: Annotation(),
    results: Annotation({
      reducer: (left, right) => (left || []).concat(right || []),
      default: () => [],
    }),
  });
  const graph = new StateGraph(State)
    .addNode('isolated_worker', async (state) => ({
      results: [await execute(state.task)],
    }))
    .addConditionalEdges(START, (state) =>
      (state.tasks || []).map((task) => new Send('isolated_worker', { task }))
    )
    .addEdge('isolated_worker', END)
    .compile();

  const results = [];
  for (let offset = 0; offset < input.length; offset += limit) {
    const batch = input.slice(offset, offset + limit);
    const state = await graph.invoke({ tasks: batch, results: [] });
    results.push(...(state.results || []));
  }
  return results.sort((a, b) => (Number(a && a.taskIndex) || 0) - (Number(b && b.taskIndex) || 0));
}

module.exports = { runDelegationGraph };
