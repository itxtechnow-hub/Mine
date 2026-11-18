'use strict';

/**
 * Settings view.
 *
 * Everything the operator can configure lives here: the gateway server, key
 * rotation and failover, the connection guide, password protection, storage
 * cleanup, appearance, and the data reset.
 */

function renderSettingsView() {
  const s = S.settings;
  const cfg = S.gatewayConfig || {};
  const authEnabled = S.auth && S.auth.enabled;

  // Refresh the storage readout in the background after the view paints.
  setTimeout(() => refreshStorageReadout(), 0);

  return `
    <div class="view-head">
      <div>
        <h2>Configuration</h2>
        <p class="sub">Gateway configuration, connection guide, security, storage, and appearance.</p>
      </div>
    </div>

    <div class="settings-grid">
      <!-- Gateway Server -->
      <section class="card">
        <div class="panel-head"><h3>Gateway Server</h3></div>
        <div class="set">
          <span><b>Gateway status</b><br><span class="mute">${S.gatewayRunning ? 'Serving requests at the endpoint below' : 'Stopped — clients get HTTP 503 until you start it'}</span></span>
          <button class="btn sm ${S.gatewayRunning ? 'd' : 'p'}" data-a="togglegw">${S.gatewayRunning ? 'Stop' : 'Start'}</button>
        </div>
        <div class="set">
          <span><b>Endpoint</b><br><span class="mute mono">${esc(cfg.baseUrl || '')}</span></span>
          <button class="btn sm" data-a="copy-gateway" data-field="baseUrl">Copy</button>
        </div>
        <div class="set">
          <span><b>Require API Key</b><br><span class="mute">Always on for a hosted gateway — clients send <code>Authorization: Bearer &lt;key&gt;</code></span></span>
          <span class="chip ok">Enforced</span>
        </div>
        <div class="set">
          <span><b>Rotate gateway key</b><br><span class="mute">Issue a new key; every client using the old one stops working</span></span>
          <button class="btn sm" data-a="rotate-gateway-key">Rotate</button>
        </div>
        <label class="set">
          <span><b>Tell the model its name</b><br><span class="mute">Add a short system note naming the resolved model</span></span>
          <input type="checkbox" data-s="injectIdentity" ${s.injectIdentity === false || s.injectIdentity === 0 ? '' : 'checked'}>
        </label>
      </section>

      <!-- Rotation & Failover -->
      <section class="card">
        <div class="panel-head"><h3>Rotation & Failover</h3></div>
        <label class="set">
          <span><b>Auto-Rotate on Rate Limits</b><br><span class="mute">Switch to another key for the same provider on 429</span></span>
          <input type="checkbox" data-s="rotate" ${s.rotate ? 'checked' : ''}>
        </label>
        <label class="set">
          <span><b>Max Retries per Request</b><br><span class="mute">How many alternate keys to try before giving up</span></span>
          <input type="number" data-s="retries" value="${s.retries || 3}" min="0" max="10" style="width:90px">
        </label>
        <label class="set">
          <span><b>Cooldown Duration (seconds)</b><br><span class="mute">How long a rate-limited key is paused</span></span>
          <input type="number" data-s="cd" value="${s.cd || 60}" min="5" max="3600" style="width:90px">
        </label>
        <div class="set">
          <span><b>Upstream Timeout (seconds)</b><br><span class="mute">How long to wait on a provider before failing over</span></span>
          <input type="number" data-s="timeout" value="${s.timeout || 30}" min="5" max="300" style="width:90px">
        </div>
      </section>

      <!-- Connection guide -->
      <section class="card guide-card">
        <div class="panel-head"><h3>Connect Your Client</h3></div>
        <p class="mute">Point any OpenAI-compatible client at the gateway. Use <code>mine/auto</code> as the model to follow your queue.</p>

        <div class="set">
          <span><b>Base URL</b><br><span class="mute">Your client's API base</span></span>
          <button class="btn sm" data-a="copy-gateway" data-field="baseUrl">Copy</button>
        </div>
        <div class="set">
          <span><b>Models endpoint</b><br><span class="mute mono">${esc(cfg.modelsUrl || '')}</span></span>
          <button class="btn sm" data-a="copy-gateway" data-field="modelsUrl">Copy</button>
        </div>
        <div class="set">
          <span><b>Health endpoint</b><br><span class="mute mono">${esc(cfg.healthUrl || '')}</span></span>
          <button class="btn sm" data-a="copy-gateway" data-field="healthUrl">Copy</button>
        </div>
        <div class="set">
          <span><b>Gateway API key</b><br><span class="mute">${cfg.requiresApiKey ? 'Clients must send this as a Bearer token' : 'Not required'}</span></span>
          <button class="btn sm" data-a="copy-gateway-key">Copy key</button>
        </div>
        <div class="set">
          <span><b>Available models</b><br><span class="mute">Copy any name into your client model field</span></span>
          <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">
            <button class="btn sm" data-a="copy-model-name" data-model="mine/auto">mine/auto</button>
            ${(S.teams || []).map((t) => `<button class="btn sm" data-a="copy-model-name" data-model="mine/agent/${t.slug || t.id}">mine/agent/${escapeHtml(t.slug || t.id)}</button>`).join('')}
          </div>
        </div>

        <h3 style="margin:20px 0 8px">Quick check</h3>
        <pre class="mono">${esc(buildCurlExample(cfg))}</pre>
      </section>

      <!-- Security -->
      <section class="card">
        <div class="panel-head"><h3>Password Protection</h3></div>
        <div class="set">
          <span>
            <b>Startup lock</b><br>
            <span class="mute">Required on a hosted console — sessions last 7 days per browser</span>
          </span>
          <span class="chip ${authEnabled ? 'ok' : 'warn'}">${authEnabled ? 'Protected' : 'No Password'}</span>
        </div>

        ${!authEnabled ? `
          <div class="set-block">
            <div class="field-row"><label>New password (min 8 characters)</label><input type="password" id="new-pwd" placeholder="New password"></div>
            <div class="field-row"><label>Confirm password</label><input type="password" id="confirm-pwd" placeholder="Confirm password"></div>
            <button class="btn p sm" data-a="set-password">Enable Password Protection</button>
          </div>` : `
          <div class="set-block">
            <div class="field-row"><label>Current password</label><input type="password" id="cur-pwd" placeholder="Current password"></div>
            <div class="field-row"><label>New password (min 8 characters)</label><input type="password" id="change-pwd" placeholder="New password"></div>
            <div class="field-row"><label>Confirm new password</label><input type="password" id="change-confirm-pwd" placeholder="Confirm new password"></div>
            <div class="row-actions">
              <button class="btn p sm" data-a="change-password">Update Password</button>
              <button class="btn sm" data-a="lockapp">Sign Out</button>
            </div>
          </div>`}
      </section>

      <!-- Storage -->
      <section class="card" id="card-storage-management">
        <div class="panel-head"><h3>Storage & Data</h3></div>
        <div class="set">
          <span><b>Vault storage</b><br><span class="mute" id="storage-details">Calculating…</span></span>
          <button class="btn sm" data-a="refresh-storage-size">Refresh</button>
        </div>
        <div class="row-actions">
          <button class="btn sm" data-a="clear-traffic-logs">Clear Traffic Logs</button>
          <button class="btn sm" data-a="clear-app-cache">Clear Cache</button>
        </div>
      </section>

      <!-- Appearance -->
      <section class="card">
        <div class="panel-head"><h3>Appearance</h3></div>
        <label class="set">
          <span><b>Color scheme</b><br><span class="mute">Light, dark, or follow the system</span></span>
          <select data-s="theme">
            <option value="light" ${(s.theme || 'light') === 'light' ? 'selected' : ''}>Light Mode</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark Mode</option>
            <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Match System</option>
          </select>
        </label>
        <label class="set">
          <span><b>Density</b><br><span class="mute">How tightly the model cards are packed</span></span>
          <select data-s="clusterDensity">
            <option value="comfortable" ${s.clusterDensity === 'comfortable' ? 'selected' : ''}>Comfortable</option>
            <option value="compact" ${s.clusterDensity === 'compact' ? 'selected' : ''}>Compact</option>
            <option value="ultra" ${s.clusterDensity === 'ultra' ? 'selected' : ''}>Ultra</option>
          </select>
        </label>
      </section>

      <!-- Backup -->
      <section class="card">
        <div class="panel-head"><h3>Backup & Portability</h3></div>
        <p class="mute">Export your key ring, providers, and settings, or restore them from a backup.</p>
        <div class="row-actions">
          <button class="btn p sm" data-a="expjson">Export Backup</button>
          <button class="btn sm" data-a="expenv">Export .env</button>
        </div>
        <div class="field-row" style="margin-top:12px">
          <label>Restore from a backup file</label>
          <input type="file" id="rf" accept=".json,.vault">
        </div>
      </section>

      <!-- Danger zone -->
      <section class="card danger-card">
        <div class="panel-head"><h3>Reset Data</h3></div>
        <p class="mute">Deletes saved API keys, discovered models, providers, teams, analytics, and settings. Your console password and gateway key are kept. This cannot be undone.</p>
        <button class="btn d" data-a="reset-data">Reset Mine Data</button>
      </section>
    </div>`;
}

function buildCurlExample(cfg) {
  const auth = cfg.requiresApiKey ? ' -H "Authorization: Bearer <your-gateway-key>"' : '';
  return 'curl ' + (cfg.modelsUrl || 'http://127.0.0.1:4000/v1/models') + auth;
}

async function refreshStorageReadout() {
  const el = document.getElementById('storage-details');
  if (!el || !window.vault || !window.vault.store) return;
  try {
    const res = await window.vault.store.getMetrics();
    if (res.success) {
      const kb = Math.max(1, Math.round((res.sizeBytes || 0) / 1024));
      el.textContent = (res.backend || 'Storage') + ' · ' + kb + ' KB encrypted' + (res.durable === false ? ' · ⚠ not durable — connect Vercel Blob or Upstash Redis' : '');
    }
  } catch (_) {
    el.textContent = 'Unavailable';
  }
}

window.V = window.V || {};
window.V.settings = renderSettingsView;
window.buildCurlExample = buildCurlExample;
window.refreshStorageReadout = refreshStorageReadout;
