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

function safeToolResult(value, maxBytes) {
  let text;
  try { text = JSON.stringify(value); } catch (_) { text = String(value); }
  const limit = Math.max(1000, Number(maxBytes) || 12000);
  return text.length > limit ? text.slice(0, limit) + '…[truncated]' : text;
}

module.exports = { calculator, buildTeamToolDefinitions, executeTeamTool, safeToolResult };
