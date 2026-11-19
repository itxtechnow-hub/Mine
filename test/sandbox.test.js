'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { safeRelativePath, createSandboxToolDefinitions } = require('../lib/gateway/sandbox');

test('sandbox workspace paths reject traversal and absolute paths', () => {
  assert.equal(safeRelativePath('src/index.js'), 'src/index.js');
  assert.throws(() => safeRelativePath('../secrets.txt'), /escapes/i);
  assert.throws(() => safeRelativePath('/etc/passwd'), /relative/i);
  assert.throws(() => safeRelativePath('C:\\Windows\\system.ini'), /relative/i);
});

test('sandbox exposes only bounded command and workspace file tools', () => {
  const names = createSandboxToolDefinitions().map((tool) => tool.function.name);
  assert.deepEqual(names, ['sandbox_run_command', 'sandbox_read_file', 'sandbox_write_file']);
});
