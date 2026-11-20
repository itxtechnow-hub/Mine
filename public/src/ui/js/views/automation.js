'use strict';
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>\"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  function renderAutomation() {
    const S = window.S || {};
    const cfg = S.automationConfig || { enabled:false, frequency:'daily', time:'03:00', day:0 };
    const history = Array.isArray(S.automationHistory) ? S.automationHistory : [];
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return '<section class="card" style="padding:20px;margin-bottom:16px"><h3>Provider health & maintenance</h3><p class="mute">Test enabled API keys, group failures by provider, and produce repair recommendations. Diagnostics never edit provider URLs, keys, or credentials.</p><button class="btn p" data-a="automation-run" id="automation-run">Run health check now</button>' +
      (history[0] ? '<p class="mute">Last run: ' + esc(new Date(history[0].timestamp).toLocaleString()) + ' · ' + history[0].working + '/' + history[0].tested + ' keys working</p>' : '') + '</section>' +
      '<section class="card" style="padding:20px;margin-bottom:16px"><h3>Maintenance schedule</h3><p class="mute">Schedule preferences can be saved, but automatic execution is not active yet. Vercel Hobby Cron runs at most once daily and may drift by up to 59 minutes. Precise custom-time or sub-daily execution needs a separate scheduler.</p>' +
      '<label class="set"><span><b>Enable schedule preference</b><br><span class="mute">Stores your preference; does not start background jobs.</span></span><input id="automation-enabled" type="checkbox" ' + (cfg.enabled ? 'checked' : '') + '></label>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:14px"><div class="form-group"><label>Frequency</label><select class="input" id="automation-frequency"><option value="daily" ' + (cfg.frequency === 'daily' ? 'selected' : '') + '>Daily</option><option value="weekly" ' + (cfg.frequency === 'weekly' ? 'selected' : '') + '>Weekly</option></select></div>' +
      '<div class="form-group"><label>Day (weekly)</label><select class="input" id="automation-day">' + days.map((d,i) => '<option value="' + i + '" ' + (Number(cfg.day) === i ? 'selected' : '') + '>' + d + '</option>').join('') + '</select></div>' +
      '<div class="form-group"><label>Preferred time (UTC)</label><input class="input" id="automation-time" type="time" value="' + esc(cfg.time || '03:00') + '"></div></div><button class="btn" data-a="automation-save" style="margin-top:14px">Save schedule preference</button></section>' +
      '<section class="card" style="padding:20px"><h3>Model of the Day</h3><p class="mute">Only models explicitly marked free in their own metadata qualify. A provider having a free tier does not make every model free.</p>' + (S.models || []).filter((m) => m && m.free === 1).length + ' explicitly free model(s) discovered.</section><section id="automation-report" style="margin-top:16px"></section>';
  }
  async function runCheck() {
    const btn = document.getElementById('automation-run'); if (btn) { btn.disabled = true; btn.textContent = 'Checking providers…'; }
    try {
      const res = await window.vault.automation.run(); if (!res || !res.success) throw new Error(res && res.error || 'Health check failed');
      const report = res.report; window.S.automationHistory = [report].concat(window.S.automationHistory || []).slice(0,30);
      const root = document.getElementById('automation-report');
      if (root) {
        const rows = report.providers.map((p) => '<div style="padding:9px 0;border-top:1px solid var(--line)"><b>' + esc(p.provider) + '</b> <span class="mute">' + p.working + '/' + p.tested + ' working</span>' + (p.errors.length ? '<div class="mute" style="font-size:12px">' + esc(p.errors.join(' · ')) + '</div>' : '') + '</div>').join('');
        const fixes = report.recommendations.map((x) => '<p style="font-size:13px"><b>' + esc(x.provider) + '</b>: ' + esc(x.reason) + '<br><span class="mute">' + esc(x.action) + '</span></p>').join('');
        root.innerHTML = '<section class="card" style="padding:18px"><h3>Maintenance report</h3><p>' + report.working + ' working · ' + report.failed + ' failed · ' + report.tested + ' checked</p>' + rows + (fixes ? '<h4>Recommended fixes</h4>' + fixes : '<p class="mute">No provider errors found.</p>') + '</section>';
      }
      if (window.toast) window.toast('Provider health check completed');
    } catch (e) { if (window.toast) window.toast(e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Run health check now'; } }
  }
  async function saveSchedule() {
    const input = { enabled: !!document.getElementById('automation-enabled').checked, frequency: document.getElementById('automation-frequency').value, day: Number(document.getElementById('automation-day').value || 0), time: document.getElementById('automation-time').value || '03:00' };
    const res = await window.vault.automation.save(input); if (!res || !res.success) { if (window.toast) window.toast(res && res.error || 'Could not save schedule'); return; }
    window.S.automationConfig = res.config; if (window.toast) window.toast('Schedule preference saved; automatic execution is not active yet.');
  }
  window.V = window.V || {}; window.V.automation = renderAutomation;
  window.A = window.A || {}; window.A['automation-run'] = runCheck; window.A['automation-save'] = saveSchedule;
})();
