'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
const { resolveSkillUrl, parseSkill } = require('../lib/skills');

const originalLoad = storage.loadState;
const originalSave = storage.saveState;
const originalFetch = global.fetch;
let state;

test('skill URL validation only accepts direct public GitHub SKILL.md files', () => {
  const url = resolveSkillUrl('https://github.com/example/tools/blob/main/skills/research/SKILL.md');
  assert.equal(url.hostname, 'raw.githubusercontent.com');
  assert.equal(url.pathname, '/example/tools/main/skills/research/SKILL.md');
  assert.throws(() => resolveSkillUrl('http://127.0.0.1/SKILL.md'), /public HTTPS GitHub/);
  assert.throws(() => resolveSkillUrl('https://example.com/SKILL.md'), /Only github.com/);
  assert.throws(() => resolveSkillUrl('https://github.com/example/tools'), /GitHub file link/);
});

test('skill frontmatter is parsed without executing its contents', () => {
  const parsed = parseSkill('---\nname: Research Helper\ndescription: Helps with careful research\n---\n\n# Instructions\nDo research.', 'https://raw.githubusercontent.com/example/tools/main/SKILL.md');
  assert.equal(parsed.name, 'Research Helper');
  assert.equal(parsed.description, 'Helps with careful research');
  assert.match(parsed.content, /Do research/);
  assert.equal(parsed.trustLevel, 'untrusted-reference');
});

test('skill install stores markdown only and removal cleans only its flow node', async () => {
  state = { skills: [], teams: [{ id: 'team-1', nodes: [
    { id: 'skillnode_skill-1', type: 'skill', skillId: 'skill-1' },
    { id: 'skillnode_skill-2', type: 'skill', skillId: 'skill-2' },
  ], connections: [
    { id: 'edge-1', from: 'planner', to: 'skillnode_skill-1' },
    { id: 'edge-2', from: 'planner', to: 'skillnode_skill-2' },
  ] }] };
  storage.loadState = async () => structuredClone(state);
  storage.saveState = async (next) => { state = structuredClone(next); };
  global.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    return { ok: true, headers: { get: () => '80' }, text: async () => '---\nname: Installed Helper\ndescription: Safe reference\n---\n\nDo not execute this.' };
  };
  delete require.cache[require.resolve('../lib/skills')];
  const skills = require('../lib/skills');
  const installed = await skills.installSkillFromUrl('https://raw.githubusercontent.com/example/repo/main/SKILL.md');
  assert.equal(installed.success, true);
  assert.equal(state.skills.length, 1);
  assert.match(state.skills[0].content, /Do not execute/);
  assert.equal((await skills.listSkills())[0].content, undefined);
  const read = await skills.readSkill(installed.skill.id);
  assert.match(read.content, /Do not execute/);
  await skills.removeSkill('skill-1');
  assert.equal(state.teams[0].nodes.some((node) => node.skillId === 'skill-1'), false);
  assert.equal(state.teams[0].nodes.some((node) => node.skillId === 'skill-2'), true);
  assert.equal(state.teams[0].connections.length, 1);
});

test.after(() => {
  storage.loadState = originalLoad;
  storage.saveState = originalSave;
  global.fetch = originalFetch;
});
