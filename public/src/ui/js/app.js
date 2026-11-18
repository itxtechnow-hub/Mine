'use strict';

/**
 * Mine renderer bootstrap.
 *
 * Owns the page router, the action registry, event wiring, and the startup
 * and lock lifecycle. View modules attach themselves to `window.V` before
 * this file runs.
 */

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * The view registry. Each view module assigns its renderer onto this object
 * when it loads, so `V[page]()` always resolves to the current implementation.
 */
const V = {};

const PAGE_TITLES = {
  overview: 'Dashboard',
  keys: 'API Keys',
  providers: 'Providers',
  models: 'Models',
  queue: 'Model Queue',
  settings: 'Settings',
  teams: 'Teams',
};

const PAGE_SUBTITLES = {
  overview: 'Your gateway at a glance',
  keys: 'Credentials for every provider you connect',
  providers: 'Built-in and custom AI endpoints',
  models: 'Models discovered from your API keys',
  queue: 'Routing order and fallback chain',
  settings: 'Gateway configuration and preferences',
  teams: 'Orchestrate multiple models as one team',
};

function render() {
  document.querySelectorAll('#nav button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.p === S.page));
  });

  const nk = document.getElementById('nk');
  if (nk) nk.textContent = S.keys.length || '0';

  const blockedSet = new Set(S.blockedModels || []);
  const nm = document.getElementById('nm');
  if (nm) nm.textContent = (S.modelQueue || []).filter((m) => m && !blockedSet.has(m.id)).length || '0';

  const nq = document.getElementById('nq');
  if (nq) nq.textContent = (S.modelQueue || []).filter((m) => m && m.enabled !== false && !blockedSet.has(m.id)).length || '0';
  const nt = document.getElementById('nt'); if (nt) nt.textContent = (S.teams || []).length || '0';

  const view = document.getElementById('view');
  if (view) {
    const page = V[S.page] || V.overview;
    view.innerHTML = page();
  }

  const title = document.getElementById('pageTitle');
  if (title) title.textContent = PAGE_TITLES[S.page] || 'Mine';
  const sub = document.getElementById('pageSub');
  if (sub) sub.textContent = PAGE_SUBTITLES[S.page] || '';

  updateGatewayPill();
  restoreFileInputBinding();
}

function updateGatewayPill() {
  const dot = document.getElementById('gw-dot');
  const state = document.getElementById('gw-state-text');
  const url = document.getElementById('nav-gw-url');
  if (dot) dot.classList.toggle('off', !S.gatewayRunning);
  if (state) state.textContent = S.gatewayRunning ? 'Gateway Online' : 'Gateway Offline';
  if (url) {
    const cfg = S.gatewayConfig || {};
    url.textContent = cfg.baseUrl ? cfg.baseUrl.replace(/^https?:\/\//, '').replace(/\/v1$/, '') : location.host;
  }
  const toggle = document.getElementById('gw-toggle-btn');
  if (toggle) {
    toggle.textContent = S.gatewayRunning ? 'Stop Gateway' : 'Start Gateway';
    toggle.classList.toggle('p', !S.gatewayRunning);
    toggle.classList.toggle('d', S.gatewayRunning);
  }
  const lock = document.getElementById('btn-lock');
  if (lock) lock.style.display = S.auth && S.auth.enabled ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function applyTheme() {
  if (typeof window !== 'undefined' && typeof window.syncThemeState === 'function') {
    return window.syncThemeState();
  }
  const pref = S.settings.theme || 'light';
  const resolved = pref === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.setAttribute('data-theme', resolved);
}

// ---------------------------------------------------------------------------
// Action registry
// ---------------------------------------------------------------------------

const A = {
  // ── API keys ──────────────────────────────────────────────────────────────
  'open-add-key': () => {
    const form = document.getElementById('mk-form');
    if (form) form.reset();
    populateManualProviderSelect();
    const dlg = document.getElementById('dlg-add-key');
    if (dlg) dlg.showModal();
  },

  'close-add-key': () => {
    const dlg = document.getElementById('dlg-add-key');
    if (dlg) dlg.close();
  },

  'submit-manual-key': async () => {
    const raw = (document.getElementById('mk-keys') || {}).value || '';
    const provider = (document.getElementById('manual-provider-select') || {}).value;
    const label = ((document.getElementById('mk-label') || {}).value || '').trim();

    const lines = raw
      .split(/[\n\r]+/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const entries = [];
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq > 0 && !line.startsWith('sk') && !line.startsWith('AIza') && !line.startsWith('gsk_')) {
        entries.push({ key: line.slice(eq + 1).trim(), provider: line.slice(0, eq).trim(), label });
      } else {
        entries.push({ key: line, provider, label });
      }
    }

    if (!entries.length) {
      toast('Paste at least one API key');
      return;
    }

    await window.vault.keys.add(entries);
    document.getElementById('dlg-add-key').close();
    toast(entries.length + ' key' + (entries.length > 1 ? 's' : '') + ' added');
    await hydrateUnlockedState();
    render();
  },

  'toggle-key': async (el) => {
    const id = el.dataset.id;
    const key = S.keys.find((k) => k.id === id);
    if (!key) return;
    const enabled = el.checked;
    await window.vault.keys.setEnabled(id, enabled);
    key.enabled = enabled;
    await hydrateUnlockedState();
    render();
  },

  'rmkey': async (el) => {
    const id = el.dataset.id;
    if (!confirm('Remove this API key? It will be deleted from the encrypted vault.')) return;
    await window.vault.keys.remove(id);
    toast('Key removed');
    await hydrateUnlockedState();
    render();
  },

  'prune': async () => {
    const res = await window.vault.keys.prune();
    toast(res.pruned + ' invalid key' + (res.pruned === 1 ? '' : 's') + ' removed');
    await hydrateUnlockedState();
    render();
  },

  'copy-key': async (el) => {
    const key = S.keys.find((k) => k.id === el.dataset.id);
    if (!key) return;
    await copy(key.key, 'API key copied');
  },

  'testkey': async (el) => {
    const id = el.dataset.id;
    const key = S.keys.find((k) => k.id === id);
    if (!key) return;
    const res = await window.vault.gateway.testKey({ key: key.key, provider: key.provider });
    if (res.success) {
      key.status = 'ACTIVE';
      key.lastError = null;
      key.lastLatency = res.latency;
      toast('Key works · ' + res.latency + ' ms');
    } else {
      key.status = 'DEAD';
      key.lastError = res.error;
      toast('Key failed: ' + res.error);
    }
    await window.vault.store.set('keys', S.keys);
    render();
  },

  'testall': async () => {
    toast('Testing all keys…');
    const results = await window.vault.gateway.testAllKeys();
    let ok = 0;
    for (const r of results) {
      const key = S.keys.find((k) => k.id === r.keyId);
      if (!key) continue;
      if (r.result.success) {
        key.status = 'ACTIVE';
        key.lastError = null;
        ok++;
      } else {
        key.status = 'DEAD';
        key.lastError = r.result.error;
      }
    }
    await window.vault.store.set('keys', S.keys);
    toast(ok + '/' + results.length + ' keys working');
    render();
  },

  // ── Providers ─────────────────────────────────────────────────────────────
  'open-custom-provider': () => {
    const form = document.getElementById('cp-form');
    if (form) form.reset();
    const dlg = document.getElementById('dlg-custom-provider');
    if (dlg) dlg.showModal();
  },

  'close-custom-provider': () => {
    const dlg = document.getElementById('dlg-custom-provider');
    if (dlg) dlg.close();
  },

  'submit-custom-provider': async () => {
    const name = ((document.getElementById('cp-name') || {}).value || '').trim();
    const url = ((document.getElementById('cp-url') || {}).value || '').trim();
    if (!name || !url) {
      toast('A name and base URL are required');
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await window.vault.providers.addCustom({
      id,
      name,
      url: url.replace(/\/+$/, ''),
      cat: 'Custom',
      custom: true,
      free: 0,
      reset: 'None',
    });
    document.getElementById('dlg-custom-provider').close();
    toast('Provider added');
    await hydrateUnlockedState();
    render();
  },

  'rm-custom-provider': async (el) => {
    const id = el.dataset.id;
    if (!confirm('Delete this custom provider? Existing keys stay but will not route.')) return;
    await window.vault.providers.removeCustom(id);
    toast('Provider removed');
    await hydrateUnlockedState();
    render();
  },

  'open-edit-provider': (el) => {
    const id = el.dataset.id;
    const p = getProvider(id);
    if (!p) return;
    const nameEl = document.getElementById('ep-name');
    const urlEl = document.getElementById('ep-url');
    const catEl = document.getElementById('ep-cat');
    const resetEl = document.getElementById('ep-reset');
    if (nameEl) nameEl.value = p.name || '';
    if (urlEl) urlEl.value = p.url || '';
    if (catEl) catEl.value = p.cat || 'Custom';
    if (resetEl) resetEl.value = p.reset || 'None';
    const dlg = document.getElementById('dlg-edit-provider');
    if (dlg) dlg.showModal();
  },

  'close-edit-provider': () => {
    const dlg = document.getElementById('dlg-edit-provider');
    if (dlg) dlg.close();
  },

  'submit-edit-provider': async () => {
    const name = ((document.getElementById('ep-name') || {}).value || '').trim();
    const url = ((document.getElementById('ep-url') || {}).value || '').trim();
    const cat = (document.getElementById('ep-cat') || {}).value || 'Custom';
    const reset = (document.getElementById('ep-reset') || {}).value || 'None';
    if (!name || !url) {
      toast('A name and base URL are required');
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await window.vault.providers.update({ id, name, url: url.replace(/\/+$/, ''), cat, reset, custom: true });
    document.getElementById('dlg-edit-provider').close();
    toast('Provider updated');
    await hydrateUnlockedState();
    render();
  },

  // ── Models ────────────────────────────────────────────────────────────────
  'fetch-models': async () => {
    const btn = document.getElementById('btn-fetch-models');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Scanning…';
    }
    const res = await window.vault.models.fetchFromKeys();
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Scan Enabled APIs';
    }
    if (!res.success && !res.count) {
      toast(res.error || 'Nothing to scan');
      return;
    }
    if (res.errors && res.errors.length) {
      toast('Failed providers: ' + res.errors.map((e) => e.provider + ' (' + (e.error || 'unknown') + ')').join(', '));
    }
    const savedPinned = await window.vault.store.get('pinnedModels', []);
    const favoriteIds = new Set([
      ...(Array.isArray(savedPinned) ? savedPinned : []),
      ...(S.models || []).filter((m) => m.pin).map((m) => m.id),
    ]);
    S.models = (res.models || []).map((m) => ({ ...m, pin: favoriteIds.has(m.id) ? 1 : 0 }));
    await window.vault.store.set('pinnedModels', S.models.filter((m) => m.pin).map((m) => m.id));
    await syncModelQueue();
    toast(res.count + ' models discovered');
    render();
  },

  'select-all-models': async () => {
    const blocked = new Set(S.blockedModels || []);
    for (const m of S.models || []) {
      if (!m || !m.id || blocked.has(m.id)) continue;
      if (S.modelFreeOnly && !m.free) continue;
      const _pq = (S.modelProviderQuery || '').toLowerCase();
      const _mq = (S.modelQuery || '').toLowerCase();
      const _pid = m.provider || m.id.split('/')[0] || 'unknown';
      if (_pq && !(_pid).toLowerCase().includes(_pq)) continue;
      if (_mq && !(m.id + ' ' + (m.rawId || '')).toLowerCase().includes(_mq)) continue;
      m.pin = 1;
      m.selected = true;
      if (!(S.modelQueue || []).some((q) => q && q.id === m.id)) {
        const entry = { id: m.id, provider: m.provider, rawId: m.rawId, ctx: m.ctx, free: !!m.free, enabled: true };
        const firstPaid = (S.modelQueue || []).findIndex((q) => q && !q.free);
        if (m.free && firstPaid >= 0) S.modelQueue.splice(firstPaid, 0, entry);
        else S.modelQueue.push(entry);
      }
    }
    await persistPins();
    render();
  },

  'deselect-all-models': async () => {
    for (const m of S.models || []) if (m) { m.pin = 0; m.selected = false; }
    S.modelQueue = [];
    await persistPins();
    render();
  },

  'select-provider-models': async (el) => {
    const providerId = el.dataset.provider;
    const mode = el.dataset.mode;
    const blocked = new Set(S.blockedModels || []);
    for (const m of S.models || []) {
      if (!m || !m.id) continue;
      if ((m.provider || '') !== providerId) continue;
      if (blocked.has(m.id)) continue;
      if (S.modelFreeOnly && !m.free) continue;
      m.pin = mode === 'select' ? 1 : 0;
      m.selected = mode === 'select';
      if (mode === 'select') {
        if (!(S.modelQueue || []).some((q) => q && q.id === m.id)) {
          const entry = { id: m.id, provider: m.provider, rawId: m.rawId, ctx: m.ctx, free: !!m.free, enabled: true };
          const firstPaid = (S.modelQueue || []).findIndex((q) => q && !q.free);
          if (m.free && firstPaid >= 0) S.modelQueue.splice(firstPaid, 0, entry);
          else S.modelQueue.push(entry);
        }
      } else {
        S.modelQueue = (S.modelQueue || []).filter((q) => q && q.id !== m.id);
      }
    }
    await persistPins();
    render();
  },

  'collapse-all-providers': () => {
    for (const m of S.models || []) {
      if (m && m.provider) S.collapsedProviders[m.provider] = true;
    }
    render();
  },

  'expand-all-providers': () => {
    for (const m of S.models || []) {
      if (m && m.provider) S.collapsedProviders[m.provider] = false;
    }
    render();
  },

  'toggle-provider-collapse': (el) => {
    const providerId = el.dataset.provider;
    const current = S.collapsedProviders[providerId];
    const count = (S.models || []).filter((m) => m && m.provider === providerId).length;
    S.collapsedProviders[providerId] = current === undefined ? count > 10 : !current;
    render();
  },

  'copy-model': (el) => {
    const model = (S.models || []).find((m) => m.id === el.dataset.id);
    if (!model) {
      toast('Model is unavailable');
      return;
    }
    copy(model.id, 'Model ID copied');
  },

  'block-model': async (el) => {
    const id = el.dataset.id;
    if (!Array.isArray(S.blockedModels)) S.blockedModels = [];
    if (!S.blockedModels.includes(id)) S.blockedModels.push(id);
    const m = (S.models || []).find((x) => x.id === id);
    if (m) {
      m.pin = 0;
      m.selected = false;
    }
    S.modelQueue = (S.modelQueue || []).filter((x) => x && x.id !== id);
    await window.vault.store.set('blockedModels', S.blockedModels);
    await persistPins();
    toast('Model blocked');
    render();
  },

  'unblock-model': async (el) => {
    const id = el.dataset.id;
    S.blockedModels = (S.blockedModels || []).filter((mId) => mId !== id);
    await window.vault.store.set('blockedModels', S.blockedModels);
    toast('Model unblocked');
    render();
  },

  pin: async (el) => {
    const id = el.dataset.id;
    const blocked = new Set(S.blockedModels || []);
    if (blocked.has(id)) return;
    const m = (S.models || []).find((x) => x.id === id);
    if (!m) return;
    m.pin = el.checked ? 1 : 0;
    m.selected = !!el.checked;
    if (el.checked) {
      if (!(S.modelQueue || []).some((q) => q && q.id === id)) {
        const entry = { id, provider: m.provider, rawId: m.rawId, ctx: m.ctx, free: !!m.free, enabled: true };
        const firstPaid = (S.modelQueue || []).findIndex((q) => q && !q.free);
        if (m.free && firstPaid >= 0) S.modelQueue.splice(firstPaid, 0, entry);
        else S.modelQueue.push(entry);
      }
    } else {
      S.modelQueue = (S.modelQueue || []).filter((q) => q && q.id !== id);
    }
    await persistPins();
    render();
  },

  // ── Queue ─────────────────────────────────────────────────────────────────
  'queue-select-model': async (el) => {
    const id = el.dataset.id;
    const m = (S.models || []).find((x) => x.id === id);
    if (!m) return;
    m.pin = 1;
    m.selected = true;
    if (!(S.modelQueue || []).some((q) => q && q.id === id)) {
      const entry = { id, provider: m.provider, rawId: m.rawId, ctx: m.ctx, free: !!m.free, enabled: true };
      const firstPaid = S.modelQueue.findIndex((q) => q && !q.free);
      if (m.free && firstPaid >= 0) S.modelQueue.splice(firstPaid, 0, entry);
      else S.modelQueue.push(entry);
    }
    await persistPins();
  },

  'queue-disable': async (el) => {
    const id = el.dataset.id;
    S.modelQueue = (S.modelQueue || []).filter((q) => q && q.id !== id);
    const m = (S.models || []).find((x) => x.id === id);
    if (m) {
      m.pin = 0;
      m.selected = false;
    }
    await persistPins();
  },

  'queue-make-first': async (el) => {
    const id = el.dataset.id;
    const idx = S.modelQueue.findIndex((q) => q && q.id === id);
    if (idx < 0) return;
    const entry = S.modelQueue.splice(idx, 1)[0];
    S.modelQueue.unshift(entry);
    await persistPins();
  },

  'queue-move-up': async (el) => {
    const id = el.dataset.id;
    const idx = S.modelQueue.findIndex((q) => q && q.id === id);
    if (idx <= 0) return;
    const tmp = S.modelQueue[idx - 1];
    S.modelQueue[idx - 1] = S.modelQueue[idx];
    S.modelQueue[idx] = tmp;
    await persistPins();
  },

  'queue-move-down': async (el) => {
    const id = el.dataset.id;
    const idx = S.modelQueue.findIndex((q) => q && q.id === id);
    if (idx < 0 || idx >= S.modelQueue.length - 1) return;
    const tmp = S.modelQueue[idx + 1];
    S.modelQueue[idx + 1] = S.modelQueue[idx];
    S.modelQueue[idx] = tmp;
    await persistPins();
  },

  'queue-prioritize-free': async () => {
    S.modelQueue = [
      ...S.modelQueue.filter((q) => q && q.free),
      ...S.modelQueue.filter((q) => q && !q.free),
    ];
    await persistPins();
  },

  'queue-add-all-discovered': async () => {
    const blocked = new Set(S.blockedModels || []);
    const all = (S.models || []).filter((m) => m && m.id && !blocked.has(m.id));
    S.modelQueue = all.map((m) => ({
      id: m.id,
      provider: m.provider,
      rawId: m.rawId,
      ctx: m.ctx,
      free: !!m.free,
      enabled: true,
    }));
    for (const m of all) m.pin = 1;
    await persistPins();
  },

  'queue-clear-all': async () => {
    if (!confirm('Clear the entire routing queue?')) return;
    S.modelQueue = [];
    for (const m of S.models || []) {
      m.pin = 0;
      m.selected = false;
    }
    await persistPins();
  },

  // ── Gateway ───────────────────────────────────────────────────────────────
  togglegw: async () => {
    if (S.gatewayRunning) {
      await window.vault.gateway.stop();
      S.gatewayRunning = false;
      toast('Gateway stopped');
    } else {
      const res = await window.vault.gateway.start(getAllProviders());
      if (res.success) {
        S.gatewayRunning = true;
        toast('Gateway online at ' + (res.url || res.host));
      } else {
        S.gatewayRunning = false;
        toast(res.error || 'Could not start the gateway');
      }
    }
    // Refresh the endpoint details, but keep the running flag we just set:
    // the status query can still report the pre-toggle state.
    try {
      S.gatewayConfig = await window.vault.gateway.clientConfig();
    } catch (_) {
      /* keep the current config */
    }
    render();
  },

  'copy-gateway': (el) => {
    const field = el.dataset.field;
    const cfg = S.gatewayConfig || {};
    if (field === 'autoModel') {
      copy('mine/auto', 'Model name copied');
      return;
    }
    const value = cfg[field];
    if (!value) {
      toast('Nothing to copy');
      return;
    }
    copy(value, 'Copied to clipboard');
  },

  'rotate-gateway-key': async () => {
    if (!confirm('Issue a new gateway key? Clients using the current key will stop working until you update them.')) return;
    const res = await window.vault.gateway.rotateKey();
    if (res && res.success) {
      const copied = await window.vault.gateway.copyKey();
      toast(copied.success ? 'New gateway key copied to clipboard' : 'Gateway key rotated');
    } else {
      toast((res && res.error) || 'Could not rotate the key');
    }
  },

  'copy-gateway-key': async () => {
    const res = await window.vault.gateway.copyKey();
    toast(res.success ? 'Gateway key copied to clipboard' : res.error || 'Could not copy the key');
    return res;
  },

  'refresh-gateway-config': async () => {
    await refreshGatewayConfig();
    render();
  },

  // ── Security ──────────────────────────────────────────────────────────────
  'set-password': async () => {
    const pw = (document.getElementById('new-pwd') || {}).value || '';
    const confirmPw = (document.getElementById('confirm-pwd') || {}).value || '';
    if (pw.length < 8) {
      toast('Password must be at least 8 characters');
      return;
    }
    if (pw !== confirmPw) {
      toast('Passwords do not match');
      return;
    }
    const res = await window.vault.auth.setPassword({ newPassword: pw });
    if (res.success) {
      toast('Password protection enabled');
      S.auth = await window.vault.auth.getStatus();
      render();
    } else {
      toast(res.error || 'Could not set the password');
    }
  },

  'change-password': async () => {
    const cur = (document.getElementById('cur-pwd') || {}).value || '';
    const username = (document.getElementById('account-username') || {}).value.trim();
    const np = (document.getElementById('change-pwd') || {}).value || '';
    const confirmPw = (document.getElementById('change-confirm-pwd') || {}).value || '';
    if (!np) {
      const res = await window.vault.auth.setPassword({ username, currentPassword: cur });
      if (res.success) {
        toast('Username updated');
        S.auth = await window.vault.auth.getStatus();
        render();
      } else {
        toast(res.error || 'Could not update the username');
      }
      return;
    }
    if (np.length < 8) {
      toast('Password must be at least 8 characters');
      return;
    }
    if (np !== confirmPw) {
      toast('Passwords do not match');
      return;
    }
    const res = await window.vault.auth.setPassword({ username, currentPassword: cur, newPassword: np });
    if (res.success) {
      toast('Password updated');
      S.auth = await window.vault.auth.getStatus();
      render();
    } else {
      toast(res.error || 'Could not update the password');
    }
  },

  'disable-password': async () => {
    const cur = (document.getElementById('cur-pwd') || {}).value || '';
    const res = await window.vault.auth.disable(cur);
    if (res.success) {
      toast('Password protection turned off');
      S.auth = await window.vault.auth.getStatus();
      render();
    } else {
      toast(res.error || 'Could not turn off the password');
    }
  },

  lockapp: async () => {
    S.unlocked = false;
    // Signing out of the hosted console never stops the gateway.
    if (window.vault && window.vault._stopPolling) window.vault._stopPolling();
    if (window.vault && window.vault.auth && window.vault.auth.logout) await window.vault.auth.logout();
    const pwInput = document.getElementById('lock-password-input');
    if (pwInput) pwInput.value = '';
    S.keys = [];
    S.customProviders = [];
    S.models = [];
    S.blockedModels = [];
    S.collapsedProviders = {};
    S.logs = [];
    S.modelQueue = [];
    render();
    showStartupScreen(true);
  },

  'reset-data': async () => {
    if (!confirm('Reset all local data? API keys, models, providers, and settings will be deleted.')) return;
    await window.vault.store.reset();
    location.reload();
  },

  // ── Backup ────────────────────────────────────────────────────────────────
  expjson: () => {
    const dlg = document.getElementById('dlg-export-backup');
    if (dlg) dlg.showModal();
  },

  'close-export-dlg': () => {
    const dlg = document.getElementById('dlg-export-backup');
    if (dlg) dlg.close();
  },

  'confirm-export-backup': async () => {
    const password = (document.getElementById('exp-pw') || {}).value || '';
    const encryptIt = (document.getElementById('exp-encrypt') || {}).checked;
    const payload = {
      app: 'mine',
      version: 1,
      exportedAt: new Date().toISOString(),
      keys: S.keys,
      customProviders: S.customProviders,
      models: S.models,
      modelQueue: S.modelQueue,
      settings: S.settings,
    };
    const text = JSON.stringify(payload, null, 2);

    if (encryptIt) {
      if (password.length < 8) {
        toast('Set a backup password of at least 8 characters');
        return;
      }
      const res = await window.vault.crypto.encryptBackup(text, password);
      if (!res.success) {
        toast(res.error || 'Encryption failed');
        return;
      }
      dl('mine-backup-encrypted.json', JSON.stringify(res.data, null, 2));
    } else {
      dl('mine-backup.json', text);
    }
    document.getElementById('dlg-export-backup').close();
    toast('Backup exported');
  },

  'close-decrypt-dlg': () => {
    const dlg = document.getElementById('dlg-decrypt-backup');
    if (dlg) dlg.close();
    window._pendingEncryptedBackup = null;
  },

  'confirm-decrypt-restore': async () => {
    const password = (document.getElementById('dec-pw') || {}).value || '';
    if (!window._pendingEncryptedBackup) return;
    const res = await window.vault.crypto.decryptBackup(window._pendingEncryptedBackup, password);
    if (!res.success) {
      toast(res.error || 'Could not decrypt the backup');
      return;
    }
    try {
      const data = JSON.parse(res.text);
      if (data.keys) await window.vault.store.set('keys', data.keys);
      if (data.customProviders) await window.vault.store.set('customProviders', data.customProviders);
      if (data.models) await window.vault.store.set('fetchedModels', data.models);
      if (data.modelQueue) await window.vault.store.set('modelQueue', data.modelQueue);
      if (data.settings) await window.vault.store.set('settings', data.settings);
      document.getElementById('dlg-decrypt-backup').close();
      toast('Backup restored');
      location.reload();
    } catch (_) {
      toast('The decrypted backup is not valid');
    }
  },

  expenv: () => {
    const lines = S.keys
      .filter((k) => k.status !== 'DEAD')
      .map((k) => {
        const p = getProvider(k.provider || k.providerId);
        const name = (p && p.env) || (k.provider || 'PROVIDER') + '_API_KEY';
        return name + '=' + k.key;
      });
    dl('mine.env', lines.join('\n'), 'text/plain');
    toast('Environment file exported');
  },

  // ── Storage cleanup ───────────────────────────────────────────────────────
  'clear-traffic-logs': async () => {
    if (!confirm('Clear all traffic logs and analytics?')) return;
    await window.vault.store.clean('trafficLogs');
    S.logs = [];
    S.analytics = { daily: {}, weekly: {}, monthly: {}, yearly: {}, allTime: { requests: 0, tokens: 0, totalLatency: 0 } };
    toast('Traffic logs cleared');
    render();
  },

  'clear-app-cache': async () => {
    if (!confirm('Clear the cached model list?')) return;
    await window.vault.store.clean('cache');
    toast('Cache cleared');
  },

  'refresh-storage-size': async () => {
    const res = await window.vault.store.getMetrics();
    const el = document.getElementById('storage-details');
    if (el && res.success) {
      el.textContent = res.sizeMB + ' MB across ' + res.count + ' file' + (res.count === 1 ? '' : 's');
    }
    toast(res.success ? res.sizeMB + ' MB used' : 'Could not read the storage size');
  },

  // ── Misc ──────────────────────────────────────────────────────────────────
  'toggle-theme': () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    S.settings.theme = current === 'dark' ? 'light' : 'dark';
    syncThemeState();
    if (window.vault && window.vault.store) {
      window.vault.store.set('settings', S.settings);
    }
  },

  cpgw: () => copy(gwUrl(), 'Gateway URL copied'),

  'open-external': (el) => {
    const url = el.dataset.url || el.getAttribute('href');
    if (!url) return;
    if (url.startsWith('mailto:')) {
      location.href = url;
      return;
    }
    window.vault.openExternal(url);
  },

  'set-period': (el) => {
    S.period = el.dataset.v;
    render();
  },
};

A['open-time-settings'] = async () => {
  const mode = S.settings.timeMode || 'system';
  const server = S.settings.timeServer || 'http://worldtimeapi.org/api/timezone/Etc/UTC';
  const choice = prompt('Time mode: system / internet / manual', mode);
  if (choice === null) return;
  S.settings.timeMode = choice.trim() || 'system';
  if (S.settings.timeMode === 'internet') {
    const srv = prompt('Internet time server URL', server);
    if (srv) S.settings.timeServer = srv.trim();
    try {
      const res = await window.vault.time.fetch(S.settings.timeServer);
      if (res && res.success) S.timeOffset = res.offset;
    } catch (_) {}
  } else if (S.settings.timeMode === 'manual') {
    const off = prompt('Manual offset in minutes (can be negative)', String((S.settings.manualOffsetMs || 0) / 60000));
    if (off !== null) S.settings.manualOffsetMs = (parseFloat(off) || 0) * 60000;
  } else {
    S.timeOffset = 0;
  }
  await window.vault.store.set('settings', S.settings);
  updateClock();
  render();
};

function currentTime() {
  const mode = S.settings.timeMode || 'system';
  let offset = 0;
  if (mode === 'internet') offset = S.timeOffset || 0;
  else if (mode === 'manual') offset = S.settings.manualOffsetMs || 0;
  return new Date(Date.now() + offset);
}

function updateClock() {
  const btn = document.getElementById('clockBtn');
  if (!btn) return;
  const d = currentTime();
  btn.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  btn.title = 'Time mode: ' + (S.settings.timeMode || 'system') + ' - ' + d.toLocaleString();
}

A['copy-model-name'] = (el) => { const m = el.dataset.model; if (m) copy(m, 'Model name copied'); };
A['ping-model'] = async (el) => {
  const id = el.dataset.id;
  toast('Pinging ' + id + '...');
  try {
    const res = await window.vault.models.ping(id);
    if (res && res.success) toast(id + ' OK (' + res.latency + 'ms)');
    else toast(id + ' FAILED: ' + (res.error || res.status));
  } catch (e) { toast(id + ' ERROR: ' + e.message); }
};
async function persistPins() {
  const blocked = new Set(S.blockedModels || []);
  await window.vault.store.set('pinnedModels', (S.models || []).filter((m) => m.pin && !blocked.has(m.id)).map((m) => m.id));
  await window.vault.store.set('modelQueue', S.modelQueue);
  try {
    await window.vault.gateway.syncConfig({ modelQueue: S.modelQueue });
  } catch (_) {
    /* the gateway may not be running */
  }
  render();
}

async function syncModelQueue() {
  await window.vault.store.set('modelQueue', S.modelQueue);
  try {
    await window.vault.gateway.syncConfig({ modelQueue: S.modelQueue });
  } catch (_) {
    /* the gateway may not be running */
  }
}

// ---------------------------------------------------------------------------
// Provider combobox
// ---------------------------------------------------------------------------

function populateManualProviderSelect() {
  const hidden = document.getElementById('manual-provider-select');
  if (!hidden) return;
  hidden.value = 'anthropic';
  updateSelectedProviderDisplay('anthropic');
}

function updateSelectedProviderDisplay(id) {
  const nameEl = document.getElementById('selected-provider-name');
  const catEl = document.getElementById('selected-provider-cat');
  const p = getProvider(id);
  if (nameEl) nameEl.textContent = p ? p.name : id;
  if (catEl) {
    catEl.textContent = p ? p.cat || 'Custom' : 'Custom';
    catEl.className = 'chip ' + (p && p.free ? 'ok' : '');
  }
}

function initSearchableProviderCombobox() {
  const box = document.getElementById('provider-search-box');
  const dropdown = document.getElementById('provider-dropdown');
  const hidden = document.getElementById('manual-provider-select');
  if (!box || !dropdown || !hidden) return;

  const renderOptions = (query) => {
    const q = (query || '').toLowerCase();
    const matches = getAllProviders()
      .filter((p) => (p.name + ' ' + p.id).toLowerCase().includes(q))
      .slice(0, 40);

    if (!matches.length) {
      dropdown.innerHTML = '<div class="provider-option mute">No providers match</div>';
      return;
    }

    dropdown.innerHTML = matches
      .map(
        (p) =>
          `<div class="provider-option" data-provider="${esc(p.id)}"><b>${esc(p.name)}</b> <span class="mute">${esc(p.id)}</span></div>`
      )
      .join('');

    dropdown.querySelectorAll('.provider-option[data-provider]').forEach((el) => {
      el.onclick = () => {
        hidden.value = el.dataset.provider;
        box.value = getProvider(el.dataset.provider)?.name || el.dataset.provider;
        updateSelectedProviderDisplay(el.dataset.provider);
        dropdown.innerHTML = '';
      };
    });
  };

  box.oninput = () => renderOptions(box.value);
  box.onfocus = () => renderOptions(box.value);
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== box) dropdown.innerHTML = '';
  });
}

// ---------------------------------------------------------------------------
// Global event wiring
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('#nav button');
  if (navBtn && navBtn.dataset.p) {
    S.page = navBtn.dataset.p;
    render();
    return;
  }

  const btn = e.target.closest('[data-a]');
  if (btn && btn.type !== 'checkbox' && A[btn.dataset.a]) {
    // A <select> fires its action on change, not click. Handling it here too
    // would re-render the view while the dropdown is still open, which makes
    // the native menu snap shut the moment you click it.
    const tag = btn.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (btn.tagName === 'A') e.preventDefault();
    A[btn.dataset.a](btn);
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;

  if (t.dataset.a === 'pin') {
    A.pin(t);
    return;
  }
  if (t.dataset.a === 'toggle-key') {
    A['toggle-key'](t);
    return;
  }

  if (t.id === 'kf') {
    S.kf = t.value;
    render();
    return;
  }
  if (t.id === 'pf') {
    if (typeof A.pf === 'function') A.pf({ dataset: { v: t.value } });
    else {
      S.pf = t.value;
      render();
    }
    return;
  }
  if (t.id === 'mf-free') {
    S.modelFreeOnly = t.checked;
    render();
    return;
  }
  if (t.id === 'mf-blocked') {
    S.showBlocked = t.checked;
    render();
    return;
  }
  if (t.id === 'mps') {
    S.modelProviderQuery = t.value;
    render();
    return;
  }
  if (t.id === 'ms') {
    S.modelQuery = t.value;
    render();
    return;
  }
  if (t.id === 'pps') {
    S.providerQuery = t.value;
    render();
    return;
  }

  if (t.dataset.s) {
    const k = t.dataset.s;
    let v = t.type === 'checkbox' ? (t.checked ? 1 : 0) : t.value;
    if (['port', 'retries', 'cd', 'timeout'].includes(k)) v = Number(v);
    S.settings[k] = v;
    if (k === 'theme') applyTheme();
    await window.vault.store.set('settings', S.settings);
    try {
      await window.vault.gateway.syncConfig({ settings: S.settings });
    } catch (_) {
      /* gateway may not be running */
    }
    render();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'provider-search-box') return;
});

function handleRestoreFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const content = JSON.parse(ev.target.result);
      if (content && content.mineEncrypted) {
        window._pendingEncryptedBackup = content;
        const dlg = document.getElementById('dlg-decrypt-backup');
        if (dlg) dlg.showModal();
        return;
      }
      const data = content.data || content;
      if (data.keys) await window.vault.store.set('keys', data.keys);
      if (data.customProviders) await window.vault.store.set('customProviders', data.customProviders);
      if (data.models) await window.vault.store.set('fetchedModels', data.models);
      if (data.modelQueue) await window.vault.store.set('modelQueue', data.modelQueue);
      if (data.settings) await window.vault.store.set('settings', data.settings);
      toast('Backup restored');
      setTimeout(() => location.reload(), 400);
    } catch (err) {
      toast('Could not read the backup file');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

function restoreFileInputBinding() {
  const input = document.getElementById('rf');
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1';
    input.onchange = handleRestoreFile;
  }
}

// ---------------------------------------------------------------------------
// Startup, lock, and unlock
// ---------------------------------------------------------------------------

let failedAttempts = 0;
let lockoutSeconds = 0;
let lockoutInterval = null;

function triggerLockout(seconds) {
  lockoutSeconds = seconds;
  const input = document.getElementById('lock-password-input');
  const button = document.getElementById('btn-unlock');
  const box = document.getElementById('lock-timer-box');
  const countdown = document.getElementById('lock-countdown');

  if (input) input.disabled = true;
  if (button) button.disabled = true;
  if (box) box.style.display = 'flex';

  lockoutInterval = setInterval(() => {
    lockoutSeconds -= 1;
    if (countdown) countdown.textContent = String(Math.max(0, lockoutSeconds));
    if (lockoutSeconds <= 0) {
      clearInterval(lockoutInterval);
      failedAttempts = 2;
      if (input) input.disabled = false;
      if (button) button.disabled = false;
      if (box) box.style.display = 'none';
      const err = document.getElementById('lock-error-msg');
      if (err) err.textContent = 'Lockout expired. You can try again.';
    }
  }, 1000);
}

function showStartupScreen(requireAuthOnly) {
  const screen = document.getElementById('startup-screen');
  const frame = document.getElementById('startup-loading-frame');
  const authBox = document.getElementById('startup-auth-box');
  if (!screen) return;

  if (requireAuthOnly) {
    screen.classList.remove('hidden');
    screen.classList.add('auth-mode');
    if (frame) frame.style.display = 'none';
    if (authBox) authBox.style.display = 'block';
    const input = document.getElementById('lock-username-input') || document.getElementById('lock-password-input');
    if (input) setTimeout(() => input.focus(), 80);
    return;
  }

  screen.classList.remove('hidden');
  screen.classList.remove('auth-mode');
  if (frame) frame.style.display = '';
  if (authBox) authBox.style.display = 'none';

  const status = document.getElementById('startup-status-text');
  const fill = document.getElementById('startup-progress-fill');
  const steps = [
    [250, 35, 'Connecting to the gateway…'],
    [600, 75, 'Verifying encrypted key vault…'],
    [950, 100, 'Ready'],
  ];
  for (const [delay, pct, label] of steps) {
    setTimeout(() => {
      if (fill) fill.style.width = pct + '%';
      if (status) status.textContent = label;
    }, delay);
  }
  setTimeout(() => screen.classList.add('hidden'), 1150);
}

let isHandlingUnlock = false;
async function handleUnlock() {
  if (lockoutSeconds > 0) return;
  if (isHandlingUnlock) return;
  isHandlingUnlock = true;

  try {
    const input = document.getElementById('lock-password-input');
    const usernameInput = document.getElementById('lock-username-input');
    const username = usernameInput ? usernameInput.value.trim() : '';
    const errBox = document.getElementById('lock-error-msg');
    const value = input ? input.value : '';
    const showErr = (msg) => {
      if (errBox) {
        errBox.textContent = msg;
        errBox.hidden = false;
        errBox.style.display = 'block';
      }
    };

    if (window.vault && window.vault.auth) {
      let res;
      if (S.auth && S.auth.needsSetup) {
        if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
          showErr('Choose a username with 3–32 letters, numbers, dots, underscores, or hyphens.');
          if (usernameInput) usernameInput.focus();
          return;
        }
        if (value.length < 8) {
          showErr('Use at least 8 characters.');
          return;
        }
        res = await window.vault.auth.setPassword({ username, newPassword: value });
        if (res && res.success) {
          S.auth = await window.vault.auth.getStatus();
          if (typeof window.applyLoginMode === 'function') window.applyLoginMode();
        }
      } else {
        res = await window.vault.auth.verify({ username, password: value });
      }
      if (res && res.retryAfter) {
        if (input) input.value = '';
        triggerLockout(res.retryAfter);
        showErr(res.error);
        return;
      }
      if (res && res.success) {
        if (errBox) { errBox.textContent = ''; errBox.hidden = true; }
        if (input) input.value = '';
        if (usernameInput) usernameInput.value = '';
        S.auth = await window.vault.auth.getStatus();
        failedAttempts = 0;
        clearInterval(lockoutInterval);
        S.unlocked = true;
        await hydrateUnlockedState();
        const screen = document.getElementById('startup-screen');
        if (screen) screen.classList.add('hidden');
        toast('Mine unlocked');
        if (window.vault._startPolling) window.vault._startPolling();
        warnIfStorageNotDurable();
        if (S.settings.autoStart) {
          const status = await window.vault.gateway.status();
          if (!status || !status.running) {
            const startResult = await window.vault.gateway.start(getAllProviders());
            if (startResult && startResult.success) S.gatewayRunning = true;
          }
        }
        if (S.keys.some((k) => k.enabled !== false) && !(S.models || []).length) {
          setTimeout(() => A['fetch-models'](), 250);
        }
      } else if (res && res.needsSetup) {
        S.auth = await window.vault.auth.getStatus();
        if (typeof window.applyLoginMode === 'function') window.applyLoginMode();
        showErr('Create a console password first.');
      } else if (S.auth && S.auth.needsSetup) {
        showErr((res && res.error) || 'Could not create the password.');
      } else {
        failedAttempts++;
        if (input) input.value = '';
        if (failedAttempts >= 3) {
          triggerLockout(30);
        } else {
          const remaining = 3 - failedAttempts;
          showErr(
            (res && res.error && res.error !== 'Incorrect password' ? res.error + ' ' : 'Incorrect password. ') +
              remaining + ' attempt' + (remaining > 1 ? 's' : '') + ' remaining before lockout.'
          );
          if (input) input.focus();
        }
      }
    } else {
      await hydrateUnlockedState();
      S.unlocked = true;
    }
  } finally {
    setTimeout(() => {
      isHandlingUnlock = false;
    }, 300);
  }
}

// ---------------------------------------------------------------------------
// State hydration
// ---------------------------------------------------------------------------

async function refreshGatewayConfig() {
  try {
    S.gatewayConfig = await window.vault.gateway.clientConfig();
    const status = await window.vault.gateway.status();
    if (status && typeof status.running === 'boolean') {
      S.gatewayRunning = status.running;
    }
  } catch (_) {
    /* keep the current state */
  }
}

async function hydrateUnlockedState() {
  S.keys = (await window.vault.store.get('keys', [])) || [];
  S.settings = { ...S.settings, ...((await window.vault.store.get('settings', {})) || {}) };
  if (!S.settings.timeMode) S.settings.timeMode = 'system';
  if (!S.settings.timeServer) S.settings.timeServer = 'http://worldtimeapi.org/api/timezone/Etc/UTC';
  S.timeOffset = 0;
  S.customProviders = (await window.vault.store.get('customProviders', [])) || [];
  S.modelQueue = (await window.vault.store.get('modelQueue', [])) || [];
  S.activeTeamId = (await window.vault.store.get('activeTeamId', null)) || null;
  S.teams = (await window.vault.store.get('teams', [])) || [];
  S.blockedModels = (await window.vault.store.get('blockedModels', [])) || [];
  S.analytics = (await window.vault.analytics.get()) || S.analytics;

  const fetched = (await window.vault.store.get('fetchedModels', [])) || [];
  const savedPinned = (await window.vault.store.get('pinnedModels', [])) || [];
  const favoriteIds = new Set(savedPinned);
  S.models = fetched.map((m) => ({ ...m, pin: favoriteIds.has(m.id) ? 1 : 0 }));

  await refreshGatewayConfig();
  render();
}

function warnIfStorageNotDurable() {
  const st = S.auth && S.auth.storage;
  if (st && st.durable === false) {
    setTimeout(
      () => toast('No storage connected: changes will be lost. Connect Vercel Blob or Upstash Redis to this project.'),
      1800
    );
  }
}

async function init() {
  if (window.vault) {
    try {
      if (window.vault.auth) {
        S.auth = await window.vault.auth.getStatus();
        S.unlocked = !!(S.auth && S.auth.authenticated);
        if (typeof window.applyLoginMode === 'function') window.applyLoginMode();
      }
      if (S.unlocked) await hydrateUnlockedState();
    } catch (e) {
      console.error('Init error:', e);
    }
  }

  // The startup screen must always come down, even if a view throws while
  // rendering. Otherwise the app is stuck behind the loader forever.
  try {
    applyTheme();
    initSearchableProviderCombobox();
    populateManualProviderSelect();
    render();
  } catch (e) {
    console.error('Render error:', e);
  }

  showStartupScreen(!S.unlocked);

  if (S.unlocked && window.vault && window.vault._startPolling) window.vault._startPolling();
  if (S.unlocked) warnIfStorageNotDurable();

  if (
    S.unlocked &&
    window.vault &&
    window.vault.models &&
    S.keys.some((k) => k.enabled !== false) &&
    !(S.models || []).length
  ) {
    setTimeout(() => A['fetch-models'](), 300);
  }
}

window.addEventListener('DOMContentLoaded', init);

// Exposed so the login module can trigger the unlock routine.
window.handleUnlock = handleUnlock;
window.showStartupScreen = showStartupScreen;
window.A = A;
window.V = V;
setTimeout(() => { try { updateClock(); } catch (_) {} }, 500);
window.render = render;
window.updateGatewayPill = updateGatewayPill;
