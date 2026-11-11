import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'mineroute-data')
  : path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const WORKSPACE_DIR = path.join(DATA_DIR, 'skills', 'workspaces');
const MEMORY_FILE = path.join(DATA_DIR, 'skills', 'memory.json');

const ENCRYPTION_SECRET = crypto
  .createHash('sha256')
  .update(process.env.MINEROUTE_SECRET || 'mineroute-local-aes-256-gcm-master-key')
  .digest();

declare global {
  // eslint-disable-next-line no-var
  var __MINEROUTE_MEMORY_STORE__: any;
  // eslint-disable-next-line no-var
  var __MINEROUTE_KV_MEMORIES__: Record<string, any>;
  // eslint-disable-next-line no-var
  var __MINEROUTE_WORKSPACE_FILES__: Record<string, string>;
}

export function ensureDataDirs() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify({}, null, 2), 'utf-8');
    }
  } catch {
    // Fallback to in-memory globalThis store if filesystem is restricted
  }
}

export function encryptSecret(plainText: string): string {
  if (!plainText || plainText.startsWith('enc:v1:')) return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith('enc:v1:')) return cipherText;
  try {
    const parts = cipherText.split(':');
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const encrypted = Buffer.from(parts[4], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_SECRET, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export const INITIAL_STATE: Record<string, any> = {
  page: 'overview',
  providers: [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', tier: 'API Key', authType: 'API Key', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', tier: 'Subscription / API', authType: 'API Key / OAuth', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', tier: 'Free / API', authType: 'API Key / CLI', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', tier: 'Free Tier', authType: 'API Key', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', tier: 'Cheap API', authType: 'API Key', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', tier: 'Free Tier', authType: 'API Key', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', tier: 'Cheap / Free', authType: 'API Key', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'pollinations', name: 'Pollinations (Keyless)', baseUrl: 'https://text.pollinations.ai/openai', tier: 'Free Forever', authType: 'No Auth', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 },
    { id: 'ollama', name: 'Ollama (Local)', baseUrl: 'http://127.0.0.1:11434/v1', tier: 'Local Runtime', authType: 'Local', enabled: true, status: 'Ready', latencyMs: null, breaker: 'CLOSED', cooldownUntil: 0 }
  ],
  models: [
    { id: 'MineRoute/team/Mine', name: 'Mine Agent Team Pipeline', provider: 'team', context: 'Dynamic', tier: 'team', pinned: true },
    { id: 'auto', name: 'MineRoute Auto (15-Factor Smart Router)', provider: 'mineroute', context: 'Dynamic', tier: 'auto', pinned: true },
    { id: 'auto/coding', name: 'MineRoute Coding (Quality + Tool First)', provider: 'mineroute', context: '200k', tier: 'auto', pinned: false },
    { id: 'auto/fast', name: 'MineRoute Fast (Lowest Latency First)', provider: 'mineroute', context: '128k', tier: 'auto', pinned: false },
    { id: 'auto/cheap', name: 'MineRoute Cheap ($0 Free-Tier First)', provider: 'mineroute', context: '128k', tier: 'auto', pinned: false },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini', context: '1M', tier: 'free', pinned: false },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', context: '2M', tier: 'api', pinned: false },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', context: '128k', tier: 'api', pinned: false },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', context: '128k', tier: 'cheap', pinned: false },
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'anthropic', context: '200k', tier: 'subscription', pinned: false },
    { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', provider: 'anthropic', context: '200k', tier: 'cheap', pinned: false },
    { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'deepseek', context: '64k', tier: 'cheap', pinned: false },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'deepseek', context: '64k', tier: 'cheap', pinned: false },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', context: '128k', tier: 'free', pinned: false },
    { id: 'openai-large', name: 'Pollinations Keyless GPT', provider: 'pollinations', context: '64k', tier: 'free', pinned: false }
  ],
  pinnedModels: ['MineRoute/team/Mine', 'auto'],
  combos: [
    { id: 'combo:fast', name: 'Speed Optimizer', strategy: 'priority', models: ['gemini-2.5-flash', 'llama-3.3-70b-versatile', 'gpt-4o-mini', 'openai-large'] },
    { id: 'combo:smart', name: 'Reasoning Trio', strategy: 'priority', models: ['claude-3-7-sonnet', 'gpt-4o', 'deepseek-reasoner', 'gemini-2.5-pro'] },
    { id: 'combo:round-robin', name: 'Load Balancer', strategy: 'round_robin', models: ['gemini-2.5-flash', 'llama-3.3-70b-versatile', 'openai-large'] },
    { id: 'combo:cost-zero', name: 'Zero-Cost Free Drain', strategy: 'cost_optimized', models: ['openai-large', 'gemini-2.5-flash', 'llama-3.3-70b-versatile'] }
  ],
  keys: [],
  teams: [
    {
      id: 'default-team',
      name: 'Mine Agent Team',
      slug: 'Mine',
      description: 'Autonomous multi-node team with peer communication bus & built-in tool execution (Agent -> Boss -> Workers -> Reviewer -> Memory -> Synthesis)',
      rules: '1. Lead Agent checks Context Memory and frames clear acceptance criteria.\n2. Boss Planner decomposes work into explicit tasks with tool assignments.\n3. Workers execute assigned built-in tools (file_read, file_write, code_eval, web_fetch, memory_store) and post findings to the shared Team Blackboard.\n4. Reviewer Worker audits peer worker artifacts and verifies tool outputs.\n5. Context Memory persists key takeaways, and Lead Agent delivers a unified, clean final output.',
      nodes: [
        { id: 'node-1', type: 'agent', name: 'Lead Agent', command: '/agent', model: 'gemini-2.5-flash', tools: ['memory_read', 'file_list'], rolePrompt: 'Intake coordinator and final deliverable synthesizer.', x: 40, y: 185 },
        { id: 'node-2', type: 'planner', name: 'Boss Planner', command: '/boss', model: 'claude-3-7-sonnet', tools: ['list_models', 'get_gateway_status'], rolePrompt: 'Decomposes mission into worker work-packages and assigns tools.', x: 270, y: 185 },
        { id: 'node-3', type: 'worker', name: 'Coder Worker', command: '/worker', model: 'gpt-4o', tools: ['file_read', 'file_write', 'code_eval'], rolePrompt: 'Implements code, writes workspace files, and runs verification.', x: 520, y: 75 },
        { id: 'node-4', type: 'worker', name: 'Reviewer Worker', command: '/worker', model: 'deepseek-reasoner', tools: ['file_read', 'code_eval', 'compress_prompt'], rolePrompt: 'Reviews Coder Worker output, tests edge cases, and signs off.', x: 520, y: 295 },
        { id: 'node-5', type: 'memory', name: 'Context Memory', command: '/memory', model: 'gemini-2.5-flash', tools: ['memory_store', 'memory_read'], rolePrompt: 'Indexes verified team artifacts and decisions for future runs.', x: 780, y: 185 }
      ],
      connections: [
        { from: 'node-1', to: 'node-2' },
        { from: 'node-2', to: 'node-3' },
        { from: 'node-2', to: 'node-4' },
        { from: 'node-3', to: 'node-4' },
        { from: 'node-3', to: 'node-5' },
        { from: 'node-4', to: 'node-5' },
        { from: 'node-5', to: 'node-1' }
      ]
    }
  ],
  logs: [],
  compression: {
    profile: 'standard',
    engines: {
      sessionDedup: true,
      ccr: true,
      lite: true,
      rtk: true,
      responsesTool: true,
      headroom: true,
      relevance: true,
      caveman: true,
      aggressive: false,
      llmlingua2: false,
      ultra: false,
      mineglyph: false
    }
  },
  settings: {
    port: 20128,
    requireAuth: false,
    defaultStrategy: 'auto',
    compressionProfile: 'standard',
    enableSemanticCache: true,
    enableGuardrails: true,
    breakerThreshold: 3,
    cooldownSeconds: 45,
    proxyScope: 'per-provider',
    tlsProfile: 'wreq-js-ja3-ja4'
  }
};

export function readStore(): Record<string, any> {
  ensureDataDirs();
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = Object.assign({}, INITIAL_STATE, JSON.parse(raw));
      globalThis.__MINEROUTE_MEMORY_STORE__ = parsed;
      return parsed;
    }
  } catch {
    // Ignore file read errors on restricted serverless containers
  }
  if (globalThis.__MINEROUTE_MEMORY_STORE__) {
    return globalThis.__MINEROUTE_MEMORY_STORE__;
  }
  const initialCopy = JSON.parse(JSON.stringify(INITIAL_STATE));
  globalThis.__MINEROUTE_MEMORY_STORE__ = initialCopy;
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(initialCopy, null, 2), 'utf-8');
  } catch {}
  return initialCopy;
}

export function writeStore(nextState: any): Record<string, any> {
  ensureDataDirs();
  const current = readStore();
  const merged = Object.assign({}, current, nextState);
  if (Array.isArray(merged.keys)) {
    merged.keys = merged.keys.map((k: any) => ({
      ...k,
      encryptedKey: k.key ? encryptSecret(k.key) : k.encryptedKey
    }));
  }
  globalThis.__MINEROUTE_MEMORY_STORE__ = merged;
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  } catch {}
  return merged;
}

export function appendAuditLog(entry: any) {
  const store = readStore();
  store.logs = store.logs || [];
  store.logs.unshift({
    id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (store.logs.length > 250) store.logs = store.logs.slice(0, 250);
  writeStore(store);
}

export { WORKSPACE_DIR, MEMORY_FILE };
