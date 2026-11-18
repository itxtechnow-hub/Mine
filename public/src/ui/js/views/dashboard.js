/**
 * Mine Console Gateway - Dashboard Overview UI Module
 * Enhanced Dashboard overview renderer with independent masonry provider
 * columns and dynamic dense layout,
 * selectable density views, key drag-and-drop priority reordering,
 * and dedicated recent gateway traffic audit view.
 */

'use strict';

const DENSITY_STYLES = `
/* Dashboard Density & Dense Grid Optimization */
.provider-groups-grid {
  display: block;
  column-count: 3;
  column-gap: 16px;
  margin-bottom: 26px;
  transition: all .2s ease;
}

/* Each provider owns its column space; a tall key list cannot stretch
   neighboring provider cards as it would in a row-based grid. */
.provider-groups-grid > .provider-group-card,
.provider-groups-grid > .card {
  display: inline-block;
  width: 100%;
  margin: 0 0 16px;
  vertical-align: top;
  break-inside: avoid;
  page-break-inside: avoid;
}

/* Density 1: Comfortable (Standard Spacing & Padding) */
.provider-groups-grid.density-comfortable {
  column-count: 3;
  column-gap: 16px;
}
.density-comfortable .provider-group-card {
  padding: 18px 20px;
}
.density-comfortable .pg-header {
  margin-bottom: 12px;
  padding-bottom: 10px;
}
.density-comfortable .pg-title {
  font-size: 15px;
}
.density-comfortable .pg-stats {
  font-size: 12px;
  gap: 10px;
}
.density-comfortable .key-item {
  padding: 12px 14px;
  gap: 6px;
}
.density-comfortable .key-item-header b {
  font-size: 13.5px;
}
.density-comfortable .key-item-metrics {
  font-size: 12px;
  margin-top: 4px;
}

/* Density 2: Compact (Tighter Padding) */
.provider-groups-grid.density-compact {
  column-count: 4;
  column-gap: 12px;
}
.density-compact .provider-group-card {
  padding: 12px 14px;
  border-radius: 12px;
}
.density-compact .pg-header {
  margin-bottom: 8px;
  padding-bottom: 8px;
}
.density-compact .pg-title {
  font-size: 13.5px;
}
.density-compact .pg-stats {
  font-size: 11.5px;
  gap: 8px;
}
.density-compact .key-item {
  padding: 8px 10px;
  gap: 4px;
  border-radius: 8px;
}
.density-compact .key-item-header b {
  font-size: 12.5px;
}
.density-compact .key-item-metrics {
  font-size: 11px;
  margin-top: 2px;
}

/* Density 3: Ultra Small (Ultra-Condensed Mini Cards) */
.provider-groups-grid.density-ultra {
  column-count: 5;
  column-gap: 8px;
}
.density-ultra .provider-group-card {
  padding: 8px 10px;
  border-radius: 10px;
}
.density-ultra .pg-header {
  margin-bottom: 6px;
  padding-bottom: 4px;
}
.density-ultra .pg-title {
  font-size: 12px;
  gap: 4px;
}
.density-ultra .pg-stats {
  font-size: 10px;
  gap: 4px;
}
.density-ultra .key-item {
  padding: 5px 7px;
  gap: 2px;
  border-radius: 6px;
}
.density-ultra .key-item-header b {
  font-size: 11px;
}
.density-ultra .key-item-header .mono {
  font-size: 9.5px;
}
.density-ultra .key-item-metrics {
  font-size: 10px;
  margin-top: 1px;
}
.density-ultra .key-item.rotating-active::before {
  font-size: 8px;
  padding: 1px 4px;
  top: 4px;
  right: 6px;
}
.density-ultra .chip {
  padding: 1px 5px;
  font-size: 9.5px;
  gap: 3px;
}
.density-ultra .btn-reorder {
  padding: 1px 3px;
  font-size: 8px;
}

/* Density Dropdown Selector */
.density-control-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--sf);
  border: 1px solid var(--line);
  padding: 4px 10px;
  border-radius: 10px;
}
.density-control-wrap label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mute);
  text-transform: uppercase;
  letter-spacing: .04em;
}
#cluster-density-select {
  background: transparent;
  border: 0;
  padding: 2px 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  outline: none;
}
#cluster-density-select option {
  background: var(--bg);
  color: var(--ink);
}

/* Key Drag & Priority Reorder */
.key-item[draggable="true"] {
  cursor: grab;
  user-select: none;
}
.key-item.dragging {
  opacity: 0.35;
  border-style: dashed;
  border-color: var(--accent);
}
.key-item.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 40%, transparent);
  transform: translateY(-2px);
}
.key-reorder-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
}
.btn-reorder {
  background: var(--chip);
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--mute);
  padding: 2px 5px;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  transition: all .12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn-reorder:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--sf));
  transform: scale(1.06);
}
.btn-reorder:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}
.drag-grip {
  display: inline-flex;
  color: var(--mute);
  font-size: 11px;
  cursor: grab;
  margin-right: 4px;
  opacity: 0.5;
  transition: opacity .15s ease;
}
.key-item:hover .drag-grip {
  opacity: 1;
}

.paid-tier-chip {
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent, #8b83ff) 22%, transparent), color-mix(in srgb, var(--accent2, #42d1ae) 22%, transparent));
  color: var(--ink, #f4f6fb);
  border: 1px solid color-mix(in srgb, var(--accent, #8b83ff) 45%, transparent);
}

/* Dedicated Recent Gateway Traffic Box */
.traffic-card {
  max-width: 100% !important;
  margin-top: 24px !important;
  padding: 20px 22px !important;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--sf);
  box-shadow: var(--shadow);
}
.traffic-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 10px;
}
.traffic-header h3 {
  margin: 0 0 3px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.02em;
}
.traffic-scroll-wrap {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 380px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
}
.traffic-scroll-wrap table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}
.traffic-scroll-wrap thead th {
  position: sticky;
  top: 0;
  background: var(--sf);
  z-index: 2;
  box-shadow: 0 1px 0 var(--line);
}

@media (max-width: 1180px) {
  .provider-groups-grid,
  .provider-groups-grid.density-comfortable { column-count: 2; }
  .provider-groups-grid.density-compact,
  .provider-groups-grid.density-ultra { column-count: 3; }
}

@media (max-width: 760px) {
  .provider-groups-grid,
  .provider-groups-grid.density-comfortable,
  .provider-groups-grid.density-compact,
  .provider-groups-grid.density-ultra { column-count: 1; }
}
`;

/**
 * Injects required dynamic CSS styles into the document head.
 */
function injectDensityStyles() {
  if (typeof document === 'undefined') return;
  let styleEl = document.getElementById('dashboard-density-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dashboard-density-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = DENSITY_STYLES;
}

/**
 * Fallback helpers when running standalone or in browser.
 */
function getAppContext() {
  const S = (typeof window !== 'undefined' && window.S) ? window.S : { keys: [], logs: [], settings: {} };
  const esc = (typeof window !== 'undefined' && window.esc)
    ? window.esc
    : s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (typeof window !== 'undefined' && window.fmt)
    ? window.fmt
    : n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n || 0);
  const maskKey = (typeof window !== 'undefined' && window.maskKey)
    ? window.maskKey
    : k => {
        if (!k) return '–';
        if (k.length <= 12) return k.slice(0, 4) + '…';
        return k.slice(0, 8) + '…' + k.slice(-4);
      };
  const getProvider = (typeof window !== 'undefined' && window.getProvider)
    ? window.getProvider
    : id => ({ id, name: id, url: '' });
  const gwUrl = (typeof window !== 'undefined' && window.gwUrl)
    ? window.gwUrl
    : () => 'http://127.0.0.1:4000/v1';
  const STL = (typeof window !== 'undefined' && window.STL)
    ? window.STL
    : {
        ACTIVE: ['Active', 'ok'],
        COOLDOWN: ['Rate-limited', 'warn'],
        DEAD: ['Invalid', 'bad'],
        CREDIT_EMPTY: ['No credit', 'warn'],
        UNKNOWN: ['Active', 'ok'],
        UNTESTED: ['Active', 'ok']
      };

  const getKeyTierBadge = (typeof window !== 'undefined' && window.getKeyTierBadge)
    ? window.getKeyTierBadge
    : (k, p) => {
        if (!k) return '';
        const errStr = String(k.lastError || '').toLowerCase();
        const statusStr = String(k.status || '').toUpperCase();
        const isCreditExhausted = statusStr === 'CREDIT_EMPTY' ||
          errStr.includes('402') ||
          errStr.includes('credit') ||
          errStr.includes('insufficient_quota') ||
          errStr.includes('quota') ||
          errStr.includes('balance') ||
          errStr.includes('payment');

        if (isCreditExhausted) {
          return '<span class="chip warn" style="font-size:10px;font-weight:700" title="Credit limit reached or quota exhausted">⚡ Credit Exhausted</span>';
        }

        const pid = String(k.provider || k.providerId || (p && p.id) || '').toLowerCase();
        const isKnownFree = ['groq', 'cerebras', 'google', 'gemini', 'chutes', 'pollinations', 'ollama', 'lmstudio', 'vllm'].includes(pid) ||
          (k.key && (k.key.startsWith('gsk_') || k.key.startsWith('csk-') || k.key.startsWith('AIza')));

        const hasFreeDiscovered = ((S && S.models) || []).some(m => m.sourceKeyId === k.id && m.free);

        if (isKnownFree || hasFreeDiscovered || k.tier === 'free') {
          return '<span class="chip ok" style="font-size:10px;font-weight:700" title="Free Tier API Key Active">🟢 Free Tier Active</span>';
        }

        return '<span class="chip paid-tier-chip" style="font-size:10px;font-weight:700" title="Paid Tier API Key">💎 Paid Tier</span>';
      };

  return { S, esc, fmt, maskKey, getProvider, gwUrl, STL, getKeyTierBadge };
}

/**
 * Reorders a key's priority within its provider cluster.
 * @param {string|HTMLElement} keyIdOrEl Key identifier or triggering element
 * @param {'up'|'down'} [direction] Direction to shift priority
 */
async function reorderKeyPriority(keyIdOrEl, direction) {
  let keyId = keyIdOrEl;
  let dir = direction;

  if (keyIdOrEl && typeof keyIdOrEl === 'object') {
    if (keyIdOrEl.target) keyIdOrEl = keyIdOrEl.target;
    if (keyIdOrEl.dataset) {
      keyId = keyIdOrEl.dataset.id;
      dir = keyIdOrEl.dataset.dir || direction;
    }
  }

  const { S } = getAppContext();
  if (!S || !Array.isArray(S.keys) || !keyId || !dir) return;

  const keyIndex = S.keys.findIndex(k => k.id === keyId);
  if (keyIndex === -1) return;

  const currentKey = S.keys[keyIndex];
  const pid = currentKey.provider || currentKey.providerId || 'unknown';

  if (dir === 'up') {
    let prevIndex = -1;
    for (let i = keyIndex - 1; i >= 0; i--) {
      const p = S.keys[i].provider || S.keys[i].providerId || 'unknown';
      if (p === pid) {
        prevIndex = i;
        break;
      }
    }
    if (prevIndex !== -1) {
      const temp = S.keys[keyIndex];
      S.keys[keyIndex] = S.keys[prevIndex];
      S.keys[prevIndex] = temp;
    } else {
      return;
    }
  } else if (dir === 'down') {
    let nextIndex = -1;
    for (let i = keyIndex + 1; i < S.keys.length; i++) {
      const p = S.keys[i].provider || S.keys[i].providerId || 'unknown';
      if (p === pid) {
        nextIndex = i;
        break;
      }
    }
    if (nextIndex !== -1) {
      const temp = S.keys[keyIndex];
      S.keys[keyIndex] = S.keys[nextIndex];
      S.keys[nextIndex] = temp;
    } else {
      return;
    }
  }

  // Persist updated key priorities
  if (typeof window !== 'undefined' && window.vault) {
    if (window.vault.store) {
      await window.vault.store.set('keys', S.keys);
    }
    if (window.vault.gateway && window.vault.gateway.syncConfig) {
      await window.vault.gateway.syncConfig({ keys: S.keys });
    }
  }

  if (typeof window !== 'undefined' && typeof window.toast === 'function') {
    window.toast(`Priority updated for ${currentKey.label || pid}`);
  }

  if (typeof window !== 'undefined' && typeof window.render === 'function') {
    window.render();
  }
}

/**
 * Updates cluster density setting and re-renders the UI.
 * @param {string|HTMLSelectElement} valueOrEl Chosen density value or select element
 */
async function setClusterDensity(valueOrEl) {
  let value = valueOrEl;
  if (valueOrEl && typeof valueOrEl === 'object') {
    if (valueOrEl.target) valueOrEl = valueOrEl.target;
    value = valueOrEl.value || (valueOrEl.dataset && valueOrEl.dataset.v);
  }
  if (!value) return;

  const { S } = getAppContext();
  S.settings = S.settings || {};
  S.settings.clusterDensity = value;

  if (typeof window !== 'undefined' && window.vault && window.vault.store) {
    await window.vault.store.set('settings', S.settings);
    if (window.vault.gateway && window.vault.gateway.syncConfig) {
      await window.vault.gateway.syncConfig({ settings: S.settings });
    }
  }

  if (typeof window !== 'undefined' && typeof window.toast === 'function') {
    const label = (value === 'ultra' || value === 'ultra-small') ? 'Ultra Small' : (value === 'compact' ? 'Compact' : 'Comfortable');
    window.toast(`Display density set to ${label}`);
  }

  // Update the grid in place. A full render() would tear down the <select>
  // that is currently open, which closes the native dropdown mid-interaction.
  const grid = document.querySelector('.provider-groups-grid');
  if (grid) {
    const normalised = value === 'ultra-small' ? 'ultra' : value;
    grid.className = 'provider-groups-grid density-' + normalised;
  }
}

/**
 * Initializes drag-and-drop key priority reordering events.
 */
function initDragAndDrop() {
  if (typeof document === 'undefined') return;
  if (window._dashboardDnDInitialized) return;
  window._dashboardDnDInitialized = true;

  let draggedKeyId = null;
  let draggedProvider = null;

  document.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.key-item[draggable="true"]');
    if (!item) return;
    draggedKeyId = item.dataset.keyId;
    draggedProvider = item.dataset.provider;
    item.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedKeyId);
    }
  });

  document.addEventListener('dragend', (e) => {
    const item = e.target.closest('.key-item');
    if (item) item.classList.remove('dragging');
    document.querySelectorAll('.key-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedKeyId = null;
    draggedProvider = null;
  });

  document.addEventListener('dragover', (e) => {
    if (!draggedKeyId) return;
    const item = e.target.closest('.key-item[draggable="true"]');
    if (!item) return;
    if (item.dataset.provider !== draggedProvider) return;
    if (item.dataset.keyId === draggedKeyId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    item.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    const item = e.target.closest('.key-item');
    if (item) item.classList.remove('drag-over');
  });

  document.addEventListener('drop', async (e) => {
    if (!draggedKeyId) return;
    const targetItem = e.target.closest('.key-item[draggable="true"]');
    if (!targetItem) return;
    if (targetItem.dataset.provider !== draggedProvider) return;
    const targetKeyId = targetItem.dataset.keyId;
    if (!targetKeyId || targetKeyId === draggedKeyId) return;

    e.preventDefault();
    targetItem.classList.remove('drag-over');

    const { S } = getAppContext();
    if (!S || !Array.isArray(S.keys)) return;

    const sourceIdx = S.keys.findIndex(k => k.id === draggedKeyId);
    const targetIdx = S.keys.findIndex(k => k.id === targetKeyId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const [moved] = S.keys.splice(sourceIdx, 1);
    S.keys.splice(targetIdx, 0, moved);

    if (window.vault) {
      if (window.vault.store) await window.vault.store.set('keys', S.keys);
      if (window.vault.gateway && window.vault.gateway.syncConfig) {
        await window.vault.gateway.syncConfig({ keys: S.keys });
      }
    }

    if (typeof window.toast === 'function') {
      window.toast('Key priority updated');
    }
    if (typeof window.render === 'function') {
      window.render();
    }
  });
}

/**
 * Enhanced Dashboard Overview renderer.
 * Produces an optimized dense grid layout, density controls, priority reordering,
 * and a dedicated recent traffic audit table.
 */
function renderOverview() {
  injectDensityStyles();
  initDragAndDrop();

  const { S, esc, fmt, maskKey, getProvider, gwUrl, STL } = getAppContext();

  let density = (S.settings && S.settings.clusterDensity) || 'comfortable';
  if (density === 'ultra-small') density = 'ultra';
  const period = S.period || 'today';
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  const yearKey = String(now.getFullYear());
  const oneJan = new Date(now.getFullYear(), 0, 1);
  const numberOfDays = Math.floor((now - oneJan) / (24 * 60 * 60 * 1000));
  const weekKey = `${now.getFullYear()}-W${Math.ceil((now.getDay() + 1 + numberOfDays) / 7)}`;

  const aData = S.analytics || {};
  let activeBucket = null;
  let periodTitle = 'Today';

  if (period === 'today') {
    activeBucket = (aData.daily && aData.daily[dayKey]) || null;
    periodTitle = 'Today';
  } else if (period === 'weekly') {
    activeBucket = (aData.weekly && aData.weekly[weekKey]) || null;
    periodTitle = 'This Week';
  } else if (period === 'monthly') {
    activeBucket = (aData.monthly && aData.monthly[monthKey]) || null;
    periodTitle = 'This Month';
  } else if (period === 'yearly') {
    activeBucket = (aData.yearly && aData.yearly[yearKey]) || null;
    periodTitle = 'This Year';
  } else if (period === 'allTime') {
    activeBucket = aData.allTime || null;
    periodTitle = 'All Time';
  }

  const todayReq = (S.keys || []).reduce((acc, k) => acc + (k.usageToday || 0), 0);
  const todayTok = (S.keys || []).reduce((acc, k) => acc + (k.totalTokens || 0), 0);

  const totalReq = activeBucket ? activeBucket.requests : todayReq;
  const totalTok = activeBucket ? activeBucket.tokens : todayTok;
  const activeKeys = (S.keys || []).filter(k => k.enabled !== false && k.status !== 'DEAD').length;
  const latencies = (S.keys || []).filter(k => k.lastLatency > 0).map(k => k.lastLatency);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  // Group keys by provider maintaining user-defined priority order
  const providerGroups = {};
  (S.keys || []).forEach(k => {
    const pid = k.provider || k.providerId || 'unknown';
    if (!providerGroups[pid]) providerGroups[pid] = [];
    providerGroups[pid].push(k);
  });

  let groupsHtml = '';
  const providerEntries = Object.entries(providerGroups);

  if (providerEntries.length === 0) {
    groupsHtml = `
      <div class="card" style="grid-column:1/-1;text-align:center;padding:44px 24px">
        <p class="mute" style="margin:0 0 16px;font-size:14px">
          No API keys added yet. Add your Anthropic, OpenAI, Gemini, or Groq keys to start using the gateway.
        </p>
        <button class="btn p" data-a="open-add-key">+ Add Your First API Key</button>
      </div>
    `;
  } else {
    groupsHtml = providerEntries.map(([pid, keysList]) => {
      const p = getProvider(pid);
      const groupReq = keysList.reduce((acc, x) => acc + (x.usageToday || 0), 0);
      const groupTok = keysList.reduce((acc, x) => acc + (x.totalTokens || 0), 0);
      const isMulti = keysList.length > 1;

      const keysItemsHtml = keysList.map((k, idx) => {
        const isActiveRotating = (k.id === S.activeRotatingKeyId);
        const [statusLabel, statusClass] = STL[k.status] || ['Active', 'ok'];
        const priorityBadge = idx === 0
          ? '<span class="chip ok sm" style="font-size:10px">Priority #1 (Next Active)</span>'
          : `<span class="chip sm" style="font-size:10px">Priority #${idx + 1}</span>`;

        return `
          <div class="key-item ${isActiveRotating ? 'rotating-active' : ''}"
               draggable="true"
               data-key-id="${esc(k.id)}"
               data-provider="${esc(pid)}">
            <div class="key-item-header">
              <div class="key-item-id">
                <span class="drag-grip" title="Drag to reorder priority">⠿</span>
                <div class="key-item-label">
                  <b>${esc(k.label || p.name)}</b>
                  <div class="mono mute">${maskKey(k.key)}</div>
                </div>
              </div>
              <div class="key-item-badges">
                <span class="chip ${statusClass}">${statusLabel}</span>
                ${getKeyTierBadge(k, p)}
                ${priorityBadge}
                ${isMulti ? `
                  <div class="key-reorder-actions">
                    <button class="btn-reorder" data-a="reorder-key-priority" data-id="${esc(k.id)}" data-dir="up" title="Move Up in Priority" aria-label="Move ${esc(k.label || p.name)} up in priority" ${idx === 0 ? 'disabled' : ''}>▲</button>
                    <button class="btn-reorder" data-a="reorder-key-priority" data-id="${esc(k.id)}" data-dir="down" title="Move Down in Priority" aria-label="Move ${esc(k.label || p.name)} down in priority" ${idx === keysList.length - 1 ? 'disabled' : ''}>▼</button>
                  </div>
                ` : ''}
              </div>
            </div>
            <div class="key-item-metrics">
              <div><b>${fmt(k.usageToday || 0)}</b> reqs today</div>
              <div><b>${fmt(k.totalTokens || 0)}</b> tokens</div>
              <div class="mono"><b>${k.lastLatency ? k.lastLatency + ' ms' : '–'}</b></div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="provider-group-card">
          <div class="pg-header">
            <div>
              <div class="pg-title">
                <span>${esc(p.name)}</span>
                ${p.custom ? '<span class="chip custom" style="font-size:10.5px">Custom</span>' : ''}
              </div>
              <div class="pg-stats">
                <span>${fmt(groupReq)} reqs today</span> · <span>${fmt(groupTok)} tokens</span>
              </div>
            </div>
            <div>
              ${isMulti ? `<span class="chip ok" style="font-size:11.5px">🔄 ${keysList.length} Keys Auto-Rotating</span>` : `<span class="chip" style="font-size:11.5px">1 Key</span>`}
            </div>
          </div>
          <div class="pg-keys-list">${keysItemsHtml}</div>
        </div>
      `;
    }).join('');
  }

  return `
    <div class="gw-banner">
      <div>
        <div style="font-weight:650;font-size:15px;display:flex;align-items:center;gap:8px">
          <span class="live-dot ${S.gatewayRunning ? '' : 'off'}"></span>
          ${S.gatewayRunning ? 'Cloud AI Gateway Active' : 'Gateway Stopped'}
        </div>
        <div class="mute" style="font-size:13px">OpenAI-compatible unified proxy endpoint</div>
      </div>
      <div class="sp"></div>
      <div class="endpoint">
        <code class="mono">${gwUrl()}</code>
        <button class="btn sm" data-a="cpgw" title="Copy endpoint">Copy</button>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 14px;flex-wrap:wrap;gap:10px">
      <div>
        <span style="font-size:12px;font-weight:700;color:var(--mute);text-transform:uppercase;letter-spacing:.06em">Analytics Time Horizon</span>
      </div>
      <div class="seg">
        ${[['today', 'Today'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly'], ['allTime', 'All Time']].map(([k, l]) =>
          `<button data-a="set-period" data-v="${k}" aria-pressed="${(S.period || 'today') === k}">${l}</button>`
        ).join('')}
      </div>
    </div>

    <div class="stats">
      <div><b>${fmt(totalReq)}</b><span>Requests (${periodTitle})</span></div>
      <div><b>${fmt(totalTok)}</b><span>Tokens Generated (${periodTitle})</span></div>
      <div><b>${activeKeys} / ${(S.keys || []).length}</b><span>Active Key Pool</span></div>
      <div><b>${avgLatency ? avgLatency + ' ms' : '–'}</b><span>Avg Response Latency</span></div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 14px;flex-wrap:wrap;gap:10px">
      <div>
        <h3 style="margin:0;font-size:16px;font-weight:700">Provider Rotation Clusters</h3>
        <div class="mute" style="font-size:12.5px">Multiple keys of the same provider are grouped together for load balancing and rate-limit failover</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="density-control-wrap">
          <label for="cluster-density-select">Density:</label>
          <select id="cluster-density-select" data-a="set-density">
            <option value="comfortable" ${density === 'comfortable' ? 'selected' : ''}>Comfortable</option>
            <option value="compact" ${density === 'compact' ? 'selected' : ''}>Compact</option>
            <option value="ultra" ${density === 'ultra' ? 'selected' : ''}>Ultra Small</option>
          </select>
        </div>
        <button class="btn sm p" data-a="open-add-key">+ Add Key</button>
        <button class="btn sm" data-a="testall">Test All</button>
      </div>
    </div>

    <div class="provider-groups-grid density-${esc(density)}">${groupsHtml}</div>

    <div class="card traffic-card">
      <div class="traffic-header">
        <div>
          <h3>Recent Gateway Traffic</h3>
          <div class="mute" style="font-size:12.5px">Real-time audit log of proxied AI requests, model routing, and token metrics</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="chip ${S.logs && S.logs.length ? 'ok' : ''}">
            <span class="live-dot ${S.gatewayRunning ? '' : 'off'}" style="width:6px;height:6px"></span>
            ${(S.logs && S.logs.length) || 0} Request${(S.logs && S.logs.length === 1) ? '' : 's'} Logged
          </span>
        </div>
      </div>
      <div class="traffic-scroll-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Agent</th>
              <th>Model</th>
              <th>Key Selected</th>
              <th class="r">Tokens</th>
              <th class="r">Latency</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            ${(!S.logs || S.logs.length === 0) ?
              `<tr><td colspan="7" class="mute" style="text-align:center;padding:28px">No requests processed yet. Point your coding agent to ${gwUrl()} to start.</td></tr>` :
              S.logs.map(l => `<tr>
                <td class="mono mute">${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '–'}</td>
                <td><span class="chip">${esc(l.agent || 'Agent')}</span></td>
                <td class="mono"><b>${esc(l.model)}</b></td>
                <td class="mono mute">${esc(l.keyLabel || maskKey(l.keyId))}</td>
                <td class="r mono">${fmt(l.tokens || 0)}</td>
                <td class="r mono">${l.latency ? l.latency + ' ms' : '–'}</td>
                <td>${l.status >= 200 && l.status < 300 ? '<span class="chip ok">200 OK</span>' : '<span class="chip bad">' + esc(l.error || 'HTTP ' + l.status) + '</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Initializes and binds the dashboard extension into the global application runtime.
 */
function initDashboard() {
  injectDensityStyles();
  initDragAndDrop();

  if (typeof window !== 'undefined') {
    if (window.A) {
      window.A['reorder-key-priority'] = reorderKeyPriority;
      window.A['set-density'] = setClusterDensity;
    }

    if (window.V) {
      window.V.overview = renderOverview;
    }

    if (!window._dashboardChangeHandlerAttached) {
      window._dashboardChangeHandlerAttached = true;
      document.addEventListener('change', async (e) => {
        if (window.A && window.A['set-density']) return;
        if (e.target && (e.target.id === 'cluster-density-select' || e.target.dataset.a === 'set-density')) {
          await setClusterDensity(e.target.value);
        }
      });
    }
  }
}

// Auto-initialize when running in browser / renderer environment
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
}

// Node.js CommonJS export support for testing and verification
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderOverview,
    reorderKeyPriority,
    setClusterDensity,
    injectDensityStyles,
    initDashboard,
    DENSITY_STYLES,
  };
}
