'use strict';

const crypto = require('crypto');
const { loadState, saveState } = require('./storage');
const MAX_SKILL_BYTES = 64 * 1024;

function resolveSkillUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch (_) { throw new Error('Enter a valid GitHub SKILL.md URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Skills must use a public HTTPS GitHub URL.');
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || parts[2] !== 'blob') throw new Error('Use a GitHub file link ending in /blob/branch/path/SKILL.md.');
    const [owner, repo, , branch, ...path] = parts;
    if (!path.length || !/skill\.md$/i.test(path[path.length - 1])) throw new Error('The link must point directly to a SKILL.md file.');
    return new URL('https://raw.githubusercontent.com/' + [owner, repo, branch, ...path].map(encodeURIComponent).join('/'));
  }
  if (url.hostname !== 'raw.githubusercontent.com') throw new Error('Only github.com and raw.githubusercontent.com skill links are supported.');
  if (!/\/SKILL\.md$/i.test(url.pathname)) throw new Error('The link must point directly to a SKILL.md file.');
  return url;
}
function parseSkill(content, sourceUrl) {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  const header = frontmatter ? frontmatter[1] : '';
  const field = (key) => {
    const line = header.split(/\r?\n/).find((item) => item.trim().toLowerCase().startsWith(key.toLowerCase() + ':'));
    return line ? line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const pathName = new URL(sourceUrl).pathname.split('/').filter(Boolean).slice(-2, -1)[0] || 'installed-skill';
  const name = (field('name') || pathName.replace(/[-_]/g, ' ')).slice(0, 100);
  const description = (field('description') || 'Installed skill instructions').slice(0, 400);
  return { name, description, content, sourceUrl, trustLevel: 'untrusted-reference' };
}
async function installSkillFromUrl(input) {
  const url = resolveSkillUrl(input);
  const response = await fetch(url.toString(), { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.1' } });
  if (!response.ok) throw new Error('GitHub returned HTTP ' + response.status + ' for this skill.');
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_SKILL_BYTES) throw new Error('Skill file is larger than 64 KB.');
  const content = await response.text();
  if (!content || Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) throw new Error('Skill file is empty or larger than 64 KB.');
  if (/^\s*<!doctype html|^\s*<html/i.test(content)) throw new Error('The link returned an HTML page, not SKILL.md.');
  const parsed = parseSkill(content, url.toString());
  const state = await loadState();
  const skills = Array.isArray(state.skills) ? state.skills : [];
  const existing = skills.find((item) => item && item.sourceUrl === url.toString());
  const skill = { id: existing ? existing.id : 'skill-' + crypto.randomUUID(), ...parsed, enabled: true, installedAt: new Date().toISOString() };
  state.skills = [...skills.filter((item) => item && item.id !== skill.id), skill].slice(-100);
  await saveState(state);
  return { success: true, skill: { id: skill.id, name: skill.name, description: skill.description, sourceUrl: skill.sourceUrl, enabled: skill.enabled, installedAt: skill.installedAt } };
}
async function listSkills() {
  const state = await loadState();
  return (Array.isArray(state.skills) ? state.skills : []).map(({ content, ...skill }) => skill);
}
async function readSkill(skillId) {
  const state = await loadState();
  const skill = (Array.isArray(state.skills) ? state.skills : []).find((item) => item && item.id === skillId);
  if (!skill) throw new Error('Skill not found.');
  return { id: skill.id, name: skill.name, description: skill.description, content: skill.content, sourceUrl: skill.sourceUrl, trustLevel: skill.trustLevel };
}
async function setSkillEnabled(skillId, enabled) {
  const state = await loadState();
  const skill = (Array.isArray(state.skills) ? state.skills : []).find((item) => item && item.id === skillId);
  if (!skill) throw new Error('Skill not found.');
  skill.enabled = enabled === true;
  await saveState(state);
  return { success: true, skill: { id: skill.id, name: skill.name, enabled: skill.enabled } };
}
async function removeSkill(skillId) {
  const state = await loadState();
  state.skills = (Array.isArray(state.skills) ? state.skills : []).filter((item) => item && item.id !== skillId);
  for (const team of (Array.isArray(state.teams) ? state.teams : [])) {
    const removedNodeIds = (Array.isArray(team.nodes) ? team.nodes : []).filter((node) => node && node.type === 'skill' && node.skillId === skillId).map((node) => node.id);
    team.nodes = (Array.isArray(team.nodes) ? team.nodes : []).filter((node) => !(node && node.type === 'skill' && node.skillId === skillId));
    team.connections = (Array.isArray(team.connections) ? team.connections : []).filter((edge) => !edge || !removedNodeIds.includes(edge.from) && !removedNodeIds.includes(edge.to));
  }
  await saveState(state);
  return { success: true, removed: skillId };
}
module.exports = { resolveSkillUrl, parseSkill, installSkillFromUrl, listSkills, readSkill, setSkillEnabled, removeSkill };
