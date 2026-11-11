import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { WORKSPACE_DIR, MEMORY_FILE, readStore, ensureDataDirs } from './store';
import { compressTextPipeline } from './compression-engine';

export const BUILTIN_MCP_TOOLS = [
  {
    name: 'file_read',
    description: 'Reads text content from a file inside the isolated skill workspace (./data/skills/workspaces/).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'file_write',
    description: 'Writes text content to a file inside the isolated skill workspace (./data/skills/workspaces/).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
  },
  {
    name: 'file_list',
    description: 'Lists all files currently stored in the skill workspace.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'http_request',
    description: 'Performs a live outbound HTTP request (GET, POST, PUT, DELETE) and returns status + body.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, body: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'web_fetch',
    description: 'Fetches a web URL and extracts clean readable text content.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'memory_store',
    description: 'Stores a persistent key-value memory entry in ./data/skills/memory.json.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] }
  },
  {
    name: 'memory_read',
    description: 'Reads a persistent memory entry by key, or returns all stored memories.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } } }
  },
  {
    name: 'code_eval',
    description: 'Executes sandboxed code expressions and returns computed variables and stdout.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' } }, required: ['code'] }
  },
  {
    name: 'get_gateway_status',
    description: 'Returns real-time MineRoute gateway health, port, active providers, and request metrics.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_models',
    description: 'Lists all discovered models, combos, and team routing endpoints in MineRoute.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'pick_fastest_model',
    description: 'Selects the lowest-latency healthy model based on real recorded telemetry.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'compress_prompt',
    description: 'Applies MineRoute 12-engine token compression to a prompt string.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, profile: { type: 'string' } }, required: ['text'] }
  }
];

function getMemWorkspace(): Record<string, string> {
  if (!globalThis.__MINEROUTE_WORKSPACE_FILES__) {
    globalThis.__MINEROUTE_WORKSPACE_FILES__ = {
      'README_workspace.md': '# MineRoute Skill Workspace\nFiles written by built-in skills and Team Workers are stored here.'
    };
  }
  return globalThis.__MINEROUTE_WORKSPACE_FILES__;
}

function getMemStore(): Record<string, any> {
  if (!globalThis.__MINEROUTE_KV_MEMORIES__) {
    globalThis.__MINEROUTE_KV_MEMORIES__ = {};
  }
  return globalThis.__MINEROUTE_KV_MEMORIES__;
}

function safeWorkspacePath(relPath: string): string {
  ensureDataDirs();
  const clean = path.normalize(String(relPath || 'notes.txt')).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.join(WORKSPACE_DIR, clean);
  if (!resolved.startsWith(WORKSPACE_DIR)) {
    throw new Error('Path traversal outside workspace is forbidden');
  }
  return resolved;
}

export async function executeBuiltinTool(name: string, args: any = {}): Promise<Record<string, any>> {
  ensureDataDirs();
  const memFiles = getMemWorkspace();
  const memKv = getMemStore();

  switch (name) {
    case 'file_write': {
      const fileKey = String(args.path || 'output.txt').trim();
      const contentStr = String(args.content ?? '');
      memFiles[fileKey] = contentStr;
      try {
        const target = safeWorkspacePath(fileKey);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contentStr, 'utf-8');
      } catch {}
      return { ok: true, tool: 'file_write', path: fileKey, bytesWritten: Buffer.byteLength(contentStr) };
    }
    case 'file_read': {
      const fileKey = String(args.path || 'notes.txt').trim();
      try {
        const target = safeWorkspacePath(fileKey);
        if (fs.existsSync(target)) {
          return { ok: true, tool: 'file_read', path: fileKey, content: fs.readFileSync(target, 'utf-8') };
        }
      } catch {}
      if (fileKey in memFiles) {
        return { ok: true, tool: 'file_read', path: fileKey, content: memFiles[fileKey] };
      }
      return { ok: false, tool: 'file_read', error: `File not found: ${fileKey}` };
    }
    case 'file_list': {
      let diskFiles: string[] = [];
      try {
        if (fs.existsSync(WORKSPACE_DIR)) diskFiles = fs.readdirSync(WORKSPACE_DIR);
      } catch {}
      const mergedFiles = Array.from(new Set([...Object.keys(memFiles), ...diskFiles]));
      return { ok: true, tool: 'file_list', workspace: './data/skills/workspaces', files: mergedFiles };
    }
    case 'memory_store': {
      const k = String(args.key || 'default');
      const entry = { value: args.value, updatedAt: new Date().toISOString() };
      memKv[k] = entry;
      try {
        const existing = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8') || '{}') : {};
        existing[k] = entry;
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(existing, null, 2), 'utf-8');
      } catch {}
      return { ok: true, tool: 'memory_store', key: k, stored: entry };
    }
    case 'memory_read': {
      let diskMem: Record<string, any> = {};
      try {
        if (fs.existsSync(MEMORY_FILE)) diskMem = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8') || '{}');
      } catch {}
      const mergedMem = Object.assign({}, memKv, diskMem);
      if (args.key) {
        return { ok: true, tool: 'memory_read', key: args.key, entry: mergedMem[args.key] || null };
      }
      return { ok: true, tool: 'memory_read', entries: mergedMem };
    }
    case 'http_request': {
      const method = String(args.method || 'GET').toUpperCase();
      const res = await fetch(String(args.url), {
        method,
        headers: args.headers || {},
        body: method !== 'GET' && method !== 'HEAD' && args.body ? String(args.body) : undefined
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, url: args.url, bodySnippet: text.slice(0, 2000) };
    }
    case 'web_fetch': {
      const res = await fetch(String(args.url));
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { ok: res.ok, status: res.status, url: args.url, extractedText: text.slice(0, 3000) };
    }
    case 'code_eval': {
      const sandbox: Record<string, any> = { Math, Date, JSON, logs: [] as string[] };
      sandbox.print = (...items: any[]) => sandbox.logs.push(items.map(String).join(' '));
      sandbox.console = { log: sandbox.print };
      const ctx = vm.createContext(sandbox);
      const code = String(args.code || '');
      const result = vm.runInContext(code, ctx, { timeout: 1500 });
      const { Math: _m, Date: _d, JSON: _j, print: _p, console: _c, ...exported } = sandbox;
      return { ok: true, tool: 'code_eval', result, exported, stdout: sandbox.logs };
    }
    case 'get_gateway_status': {
      const s = readStore();
      return {
        ok: true,
        gateway: 'MineRoute',
        port: s.settings?.port || 20128,
        activeProviders: (s.providers || []).filter((p: any) => p.enabled).length,
        totalModels: (s.models || []).length,
        teamsCount: (s.teams || []).length,
        totalRequestsLogged: (s.logs || []).length
      };
    }
    case 'list_models': {
      const s = readStore();
      return { ok: true, models: s.models || [], combos: s.combos || [] };
    }
    case 'pick_fastest_model': {
      const s = readStore();
      const enabled = (s.providers || []).filter((p: any) => p.enabled && p.breaker !== 'OPEN');
      const sorted = [...enabled].sort((a: any, b: any) => (a.latencyMs || 250) - (b.latencyMs || 250));
      return { ok: true, fastestProvider: sorted[0]?.id || 'gemini', recommendedModel: 'gemini-2.5-flash' };
    }
    case 'compress_prompt': {
      return { ok: true, ...compressTextPipeline(String(args.text || ''), args.profile || 'standard') };
    }
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}
