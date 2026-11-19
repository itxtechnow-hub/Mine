'use strict';

const path = require('path');

const WORKSPACE = '/vercel/sandbox/workspace';
const MAX_COMMAND_CHARS = 4000;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARS = 12000;
const COMMAND_TIMEOUT_MS = 30000;
const SANDBOX_TIMEOUT_MS = 120000;

function safeRelativePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 240 || raw.includes('\0') || path.posix.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('Use a non-empty relative workspace path.');
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Workspace path escapes the isolated workspace.');
  }
  return normalized;
}

function truncate(value, limit) {
  const text = String(value || '');
  return text.length > limit ? text.slice(0, limit) + '\n…[truncated]' : text;
}

function createSandboxToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'sandbox_run_command',
        description: 'Run a command in this worker’s isolated, temporary Vercel Sandbox. The sandbox has no inherited MineBot API keys or gateway secrets and network access is disabled.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Shell command to run in the isolated workspace.' } },
          required: ['command'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sandbox_read_file',
        description: 'Read a UTF-8 file from this worker’s isolated workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Relative file path inside the workspace.' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'sandbox_write_file',
        description: 'Write a UTF-8 file into this worker’s isolated workspace. Maximum file size is 64 KB.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path inside the workspace.' },
            content: { type: 'string', description: 'UTF-8 file content.' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    },
  ];
}

function createSandboxToolExecutor() {
  let sandboxPromise = null;
  let closed = false;

  async function getSandbox() {
    if (closed) throw new Error('This worker sandbox has already been closed.');
    if (!sandboxPromise) {
      sandboxPromise = (async () => {
        const { Sandbox } = await import('@vercel/sandbox');
        const sandbox = await Sandbox.create({
          image: 'vercel/sandbox/node:24',
          timeout: SANDBOX_TIMEOUT_MS,
          networkPolicy: { mode: 'deny-all' },
        });
        await sandbox.runCommand('mkdir', ['-p', WORKSPACE], { timeoutMs: 5000 });
        return sandbox;
      })().catch((error) => {
        sandboxPromise = null;
        throw error;
      });
    }
    return sandboxPromise;
  }

  async function execute(name, args) {
    const a = args || {};
    const sandbox = await getSandbox();
    if (name === 'sandbox_run_command') {
      const command = String(a.command || '').trim();
      if (!command || command.length > MAX_COMMAND_CHARS) throw new Error('Command must be between 1 and 4000 characters.');
      const result = await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', command],
        cwd: WORKSPACE,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      return {
        exitCode: result.exitCode,
        stdout: truncate(await result.stdout(), MAX_OUTPUT_CHARS),
        stderr: truncate(await result.stderr(), MAX_OUTPUT_CHARS),
      };
    }
    if (name === 'sandbox_read_file') {
      const relative = safeRelativePath(a.path);
      const stream = await sandbox.readFile({ path: relative, cwd: WORKSPACE });
      if (!stream) throw new Error('File not found in this worker workspace.');
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) throw new Error('File exceeds the 64 KB read limit.');
        chunks.push(Buffer.from(chunk));
      }
      return { path: relative, content: Buffer.concat(chunks).toString('utf8') };
    }
    if (name === 'sandbox_write_file') {
      const relative = safeRelativePath(a.path);
      const content = String(a.content == null ? '' : a.content);
      if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('File exceeds the 64 KB write limit.');
      const parent = path.posix.dirname(relative);
      if (parent !== '.') await sandbox.runCommand('mkdir', ['-p', parent], { cwd: WORKSPACE, timeoutMs: 5000 });
      await sandbox.fs.writeFile(path.posix.join(WORKSPACE, relative), content);
      return { success: true, path: relative, bytes: Buffer.byteLength(content, 'utf8') };
    }
    throw new Error('Sandbox tool is not enabled for this worker.');
  }

  async function close() {
    closed = true;
    if (!sandboxPromise) return;
    try {
      const sandbox = await sandboxPromise;
      await sandbox.stop();
    } catch (_) {}
  }

  return { definitions: createSandboxToolDefinitions(), execute, close };
}

module.exports = { safeRelativePath, createSandboxToolDefinitions, createSandboxToolExecutor };
