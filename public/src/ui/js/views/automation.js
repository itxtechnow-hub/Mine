'use strict';
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function renderAutomation() {
    const S = window.S || {};
    const cfg = S.automationConfig || { enabled:false, frequency:'daily', day:0, modelId:'' };
    const history = Array.isArray(S.automationHistory) ? S.automationHistory : [];
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const models = (S.models || []).filter((m) => m && m.id);
    const options = models.map((m) => '<option value="' + esc(m.id) + '" ' + (m.id === cfg.modelId ? 'selected' : '') + '>' + esc(m.displayName || m.id) + ' · ' + esc(m.provider || 'provider') + '</option>').join('');
    const latest = history[0];
    return '<section class="card" style="padding:20px;margin-bottom:16px"><h3>Provider health & maintenance</h3><p class="mute">The selected model reviews provider connectivity and produces repair recommendations. It never changes provider URLs, keys, or credentials without your approval.</p>' +
      '<div class="form-group"><label>Maintenance model</label><select class="input" id="automation-model"><option value="">Select a model…</option>' + options + '</select><span class="mute" style="font-size:11px">Inference runs through your Mine gateway and may consume provider quota.</span></div>' +
      '<button class="btn p" data-a="automation-run" id="automation-run">Run health check now</button>' +
      (latest ? '<p class="mute">Last run: ' + esc(new Date(latest.timestamp).toLocaleString()) + ' · ' + latest.working + '/' + latest.tested + ' keys working</p>' : '') + '</section>' +
      '<section class="card" style="padding:20px;margin-bottom:16px"><h3>Maintenance schedule</h3><p class="mute">Production runs daily at approximately 03:00 UTC. Vercel Hobby timing can drift within the hour. Choose daily or one weekly day. Custom run times are not available on this free-plan schedule.</p>' +
      '<label class="set"><span><b>Enable scheduled maintenance</b><br><span class="mute">Uses the selected model and latest saved provider state.</span></span><input id="automation-enabled" type="checkbox" ' + (cfg.enabled ? 'checked' : '') + '></label>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:14px"><div class="form-group"><label>Frequency</label><select class="input" id="automation-frequency"><option value="daily" ' + (cfg.frequency === 'daily' ? 'selected' : '') + '>Daily</option><option value="weekly" ' + (cfg.frequency === 'weekly' ? 'selected' : '') + '>Weekly</option></select></div>' +
      '<div class="form-group"><label>Day (weekly)</label><select class="input" id="automation-day">' + days.map((d,i) => '<option value="' + i + '" ' + (Number(cfg.day) === i ? 'selected' : '') + '>' + d + '</option>').join('') + '</select></div></div>' +
      '<button class="btn" data-a="automation-save" style="margin-top:14px">Save schedule</button></section>' +
      '<section class="card" style="padding:20px"><h3>Model of the Day</h3><p class="mute">Only models explicitly marked free in their own metadata qualify. A provider having a free tier does not make every model free.</p>' + models.filter((m) => m.free === 1).length + ' explicitly free model(s) discovered.</section><section id="automation-report" style="margin-top:16px"></section>';
  }
  function renderReport(report) {
    const root = document.getElementById('automation-report');
    if (!root || !report) return;
    const rows = (report.providers || []).map((p) => '<div style="padding:9px 0;border-top:1px solid var(--line)"><b>' + esc(p.provider) + '</b> <span class="mute">' + p.working + '/' + p.tested + ' working</span>' + ((p.errors || []).length ? '<div class="mute" style="font-size:12px">' + esc(p.errors.join(' · ')) + '</div>' : '') + '</div>').join('');
    const analysis = report.analysis;
    const recommendations = analysis && Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
    const fixes = recommendations.map((x) => '<p style="font-size:13px"><b>' + esc(x.provider) + '</b> · ' + esc(x.severity) + ': ' + esc(x.issue) + '<br><span class="mute">' + esc(x.action) + ' · Owner approval required</span></p>').join('');
    root.innerHTML = '<section class="card" style="padding:18px"><h3>Maintenance report</h3><p>' + report.working + ' working · ' + report.failed + ' failed · ' + report.tested + ' checked</p>' + rows +
      (analysis ? '<h4>Model analysis</h4><p>' + esc(analysis.summary) + '</p>' + (fixes || '<p class="mute">No additional repairs recommended.</p>') : '') +
      (report.analysisError ? '<p class="mute">Model analysis unavailable: ' + esc(report.analysisError) + '</p>' : '') +
      (!report.failed && !recommendations.length ? '<p class="mute">No provider errors found.</p>' : '') + '</section>';
  }
  async function runCheck() {
    const btn = document.getElementById('automation-run');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking providers…'; }
    try {
      const modelId = document.getElementById('automation-model').value;
      const res = await window.vault.automation.run({ modelId });
      if (!res || !res.success) throw new Error(res && res.error || 'Health check failed');
      const report = res.report;
      window.S.automationHistory = [report].concat(window.S.automationHistory || []).slice(0,30);
      renderReport(report);
      if (window.toast) window.toast('Provider health check completed');
    } catch (e) { if (window.toast) window.toast(e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Run health check now'; } }
  }
  async function saveSchedule() {
    const input = { enabled: !!document.getElementById('automation-enabled').checked, frequency: document.getElementById('automation-frequency').value, day: Number(document.getElementById('automation-day').value || 0), modelId: document.getElementById('automation-model').value || '' };
    const res = await window.vault.automation.save(input);
    if (!res || !res.success) { if (window.toast) window.toast(res && res.error || 'Could not save schedule'); return; }
    window.S.automationConfig = res.config;
    if (window.toast) window.toast('Schedule saved. Production runs at approximately 03:00 UTC.');
  }
  window.V = window.V || {}; window.V.automation = renderAutomation;
  window.A = window.A || {}; window.A['automation-run'] = runCheck; window.A['automation-save'] = saveSchedule;
})();
