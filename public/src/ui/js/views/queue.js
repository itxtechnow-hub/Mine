'use strict';

/**
 * Model Queue view.
 *
 * The queue is the gateway's routing order. Position 0 is the "use first"
 * model: every `mine/auto` request resolves to it while it has a working
 * key. Everything below it is a fallback, tried in order when the model
 * above it is rate-limited, dead, or out of credits.
 */

function renderQueueView() {
  const blockedSet = new Set(S.blockedModels || []);
  const activeList = (S.modelQueue || []).filter((m) => m && m.enabled !== false && !blockedSet.has(m.id));
  const activeIdSet = new Set(activeList.map((m) => m.id));

  const unselected = (S.models || []).filter(
    (m) => m && m.id && !activeIdSet.has(m.id) && !blockedSet.has(m.id)
  );

  const primary = activeList[0] || null;

  return `
    <div class="view-head">
      <div>
        <h2>Routing Order</h2>
        <p class="sub">
          Requests for <code>mine/auto</code> use the <b>first</b> model below.
          When it fails, Mine falls through to the next one automatically.
        </p>
      </div>
      <div class="head-actions">
        <button class="btn sm" data-a="queue-prioritize-free">Prioritize Free</button>
        <button class="btn sm" data-a="queue-add-all-discovered">Add All Discovered</button>
        <button class="btn sm d" data-a="queue-clear-all">Clear Queue</button>
      </div>
    </div>

    ${primary ? `
      <div class="primary-model-banner">
        <div class="primary-model-mark">★</div>
        <div class="primary-model-copy">
          <span class="kicker">Currently used first</span>
          <b class="mono">${esc(primary.rawId || primary.id)}</b>
          <span class="mute">${esc(primary.provider || '')} · ${primary.ctx ? fmt(primary.ctx) + ' tokens' : 'standard context'}</span>
        </div>
        <button class="btn sm" data-a="copy-model" data-id="${esc(primary.id)}">Copy ID</button>
      </div>` : ''}

    <section class="card queue-section">
      <div class="panel-head">
        <h3>Active Routing Queue <span class="mute">(${activeList.length})</span></h3>
        <span class="mute">Drag to reorder, or use the arrows</span>
      </div>

      ${activeList.length ? `
        <div class="queue-list" id="queue-active-list">
          ${activeList.map((m, idx) => renderQueueCard(m, idx, activeList.length)).join('')}
        </div>` : `
        <div class="queue-empty-box">
          <div class="queue-empty-icon">◈</div>
          <h4>The queue is empty</h4>
          <p class="mute">Add models from the Models tab, or select everything you have discovered.</p>
          <button class="btn p" data-a="queue-add-all-discovered">Add All Discovered Models</button>
        </div>`}
    </section>

    ${unselected.length ? `
      <details class="card queue-section">
        <summary>
          <span>Unselected models (${unselected.length})</span>
          <span class="chip">Click to expand</span>
        </summary>
        <p class="mute">Models discovered from your API keys that are not in the routing queue.</p>
        <div class="queue-list">
          ${unselected.slice(0, 100).map((m) => `
            <div class="queue-card inactive-card">
              <div class="queue-card-left">
                <span class="chip">Unselected</span>
                <div class="queue-model-info">
                  <div class="queue-model-title mono"><b>${esc(m.rawId || m.id)}</b></div>
                  <div class="queue-model-meta">${esc(m.provider || '')} · ${m.ctx ? fmt(m.ctx) + ' tokens' : 'standard context'}</div>
                </div>
              </div>
              <div class="queue-card-actions">
                <button class="btn sm p" data-a="queue-select-model" data-id="${esc(m.id)}">+ Add to Queue</button>
                <button class="btn sm d" data-a="block-model" data-id="${esc(m.id)}">Block</button>
              </div>
            </div>`).join('')}
        </div>
        ${unselected.length > 100 ? `<p class="mute">Showing 100 of ${unselected.length}. Browse the rest in the Models tab.</p>` : ''}
      </details>` : ''}`;
}

function renderQueueCard(m, idx, total) {
  const isPrimary = idx === 0;
  const label = isPrimary ? 'Use First' : 'Priority ' + (idx + 1);

  return `
    <div class="queue-card ${isPrimary ? 'primary-active' : ''}" draggable="true" data-id="${esc(m.id)}" data-index="${idx}">
      <div class="queue-card-left">
        <span class="queue-drag-handle" aria-hidden="true">⠿</span>
        <span class="queue-badge ${isPrimary ? 'primary' : 'fallback'}">${label}</span>
        <div class="queue-model-info">
          <div class="queue-model-title mono">
            <b>${esc(m.rawId || m.id)}</b>
            ${m.free ? '<span class="chip ok">Free</span>' : '<span class="chip">Paid</span>'}
          </div>
          <div class="queue-model-meta">
            Provider <b>${esc(m.provider || '')}</b> ·
            Context <b>${m.ctx ? fmt(m.ctx) + ' tokens' : 'standard'}</b>
          </div>
        </div>
      </div>
      <div class="queue-card-actions">
        ${isPrimary
          ? '<button class="btn sm p" disabled>★ Use First</button>'
          : `<button class="btn sm" data-a="queue-make-first" data-id="${esc(m.id)}">★ Make First</button>`}
        <button class="btn sm" data-a="queue-move-up" data-id="${esc(m.id)}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn sm" data-a="queue-move-down" data-id="${esc(m.id)}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn sm d" data-a="queue-disable" data-id="${esc(m.id)}">Remove</button>
      </div>
    </div>`;
}

window.V = window.V || {};
window.V.queue = renderQueueView;
window.renderQueueCard = renderQueueCard;
