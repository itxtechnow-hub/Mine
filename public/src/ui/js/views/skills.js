'use strict';
(function () {
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
  function renderSkills() {
    const skills = Array.isArray(window.S && window.S.skills) ? window.S.skills : [];
    const cards = skills.map((skill) => `
      <article class="card" style="padding:16px;margin-bottom:10px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="min-width:0;flex:1"><b>${esc(skill.name)}</b><p class="mute" style="margin:5px 0 8px">${esc(skill.description || 'Installed skill instructions')}</p><div class="mute" style="font-size:11px;overflow-wrap:anywhere">${esc(skill.sourceUrl || '')}</div></div>
          <span class="chip ${skill.enabled ? 'ok' : ''}">${skill.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn sm" data-a="skills-read" data-id="${esc(skill.id)}">Read skill</button>
          <button class="btn sm" data-a="skills-toggle" data-id="${esc(skill.id)}" data-enabled="${skill.enabled ? 'false' : 'true'}">${skill.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn sm danger" data-a="skills-remove" data-id="${esc(skill.id)}">Remove</button>
        </div>
      </article>`).join('');
    return `
      <section class="card" style="padding:20px;margin-bottom:16px">
        <h3>Install a skill</h3>
        <p class="mute">Paste a direct GitHub link to a SKILL.md file. Mine stores the instructions as reference text; it does not run code from the skill.</p>
        <div class="form-group"><label for="skill-url">GitHub SKILL.md URL</label><input class="input" id="skill-url" type="url" placeholder="https://github.com/owner/repo/blob/main/SKILL.md" autocomplete="off"></div>
        <button class="btn p" data-a="skills-install" id="skills-install">Install skill</button>
      </section>
      <section><h3>Installed skills <span class="mute">(${skills.length})</span></h3>${cards || '<div class="card" style="padding:20px"><p class="mute">No skills installed yet. Install a GitHub SKILL.md file to make it available to your main agent.</p></div>'}</section>
      <section id="skill-content" style="margin-top:14px"></section>`;
  }
  async function refreshSkills() {
    const result = await window.vault.skills.get();
    window.S.skills = result && result.skills || [];
    if (typeof window.render === 'function') window.render();
  }
  async function installSkill() {
    const input = document.getElementById('skill-url');
    const button = document.getElementById('skills-install');
    const url = input && input.value.trim();
    if (!url) { if (window.toast) window.toast('Paste a GitHub SKILL.md link first'); return; }
    if (button) { button.disabled = true; button.textContent = 'Installing…'; }
    try {
      const result = await window.vault.skills.install({ url });
      if (!result || !result.success) throw new Error(result && result.error || 'Skill installation failed');
      await refreshSkills();
      if (window.toast) window.toast('Installed skill: ' + result.skill.name);
    } catch (error) { if (window.toast) window.toast(error.message); }
    finally { if (button) { button.disabled = false; button.textContent = 'Install skill'; } }
  }
  async function readSkill(button) {
    const result = await window.vault.skills.read(button.dataset.id);
    if (!result || !result.content) { if (window.toast) window.toast(result && result.error || 'Could not read skill'); return; }
    const root = document.getElementById('skill-content');
    if (root) root.innerHTML = '<section class="card" style="padding:16px"><h3>' + esc(result.name) + '</h3><p class="mute">Untrusted reference content. Instructions do not override Mine security or user approval.</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:520px;overflow:auto;font-size:12px">' + esc(result.content) + '</pre></section>';
  }
  async function toggleSkill(button) {
    const enabled = button.dataset.enabled === 'true';
    const result = await window.vault.skills.setEnabled(button.dataset.id, enabled);
    if (!result || !result.success) { if (window.toast) window.toast(result && result.error || 'Could not update skill'); return; }
    await refreshSkills();
  }
  async function removeSkill(button) {
    if (!window.confirm('Remove this skill from Mine?')) return;
    const result = await window.vault.skills.remove(button.dataset.id);
    if (!result || !result.success) { if (window.toast) window.toast(result && result.error || 'Could not remove skill'); return; }
    await refreshSkills();
    if (window.toast) window.toast('Skill removed');
  }
  window.V = window.V || {}; window.V.skills = renderSkills;
  window.A = window.A || {};
  window.A['skills-install'] = installSkill;
  window.A['skills-read'] = readSkill;
  window.A['skills-toggle'] = toggleSkill;
  window.A['skills-remove'] = removeSkill;
})();
