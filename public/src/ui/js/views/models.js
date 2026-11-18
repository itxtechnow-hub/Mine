'use strict';

/**
 * Models view.
 *
 * Lists every model discovered from the enabled API keys, grouped by
 * provider. Each model can be added to the routing queue, promoted to
 * "use first", copied, or blocked.
 */

function renderModelsView() {
  const blockedSet = new Set(S.blockedModels || []);
  const queueIds = new Set((S.modelQueue || []).map((m) => m && m.id));
  const primaryId = (S.modelQueue || [])[0] ? S.modelQueue[0].id : null;

  const providerQuery = (S.modelProviderQuery || '').toLowerCase();
  const modelQuery = (S.modelQuery || '').toLowerCase();

  const groups = {};
  for (const model of S.models || []) {
    if (!model || !model.id) continue;
    if (S.showBlocked) {
      if (!blockedSet.has(model.id)) continue;
    } else if (blockedSet.has(model.id)) {
      continue;
    }
    if (S.modelFreeOnly && !model.free) continue;

    const providerId = model.provider || model.id.split('/')[0] || 'unknown';
    const provider = getProvider(providerId);
    const providerName = provider ? provider.name : providerId;

    if (providerQuery && !(providerName + ' ' + providerId).toLowerCase().includes(providerQuery)) continue;
    if (modelQuery && !(model.id + ' ' + (model.rawId || '') + ' ' + (model.displayName || '')).toLowerCase().includes(modelQuery)) continue;

    if (!groups[providerId]) groups[providerId] = { provider, providerId, name: providerName, models: [] };
    groups[providerId].models.push(model);
  }

  const groupList = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
  const totalVisible = groupList.reduce((n, g) => n + g.models.length, 0);
  const inQueue = (S.modelQueue || []).length;

  if (!S.models || !S.models.length) {
    return `
      <div class="card empty-hero">
        <h3>No models discovered yet</h3>
        <p class="mute">Add API keys once, then use Refresh Models when you want to update the saved catalog. Your last discovered models stay available between visits.</p>
        <button class="btn p" data-a="fetch-models">Refresh Models</button>
      </div>`;
  }

  return `
    <div class="view-head">
      <div>
        <h2>${S.showBlocked ? 'Blocked Models' : 'Discovered Models'}</h2>
        <p class="sub">${S.showBlocked
          ? 'These models are hidden and excluded from routing.'
          : 'Saved model catalog. Models stay here until you manually refresh; providers that fail a refresh keep their last successful model list.'}</p>
      </div>
      <button class="btn p" data-a="fetch-models" id="btn-fetch-models">Scan Enabled APIs</button>
    </div>

    <div class="bar">
      <button class="btn sm" data-a="select-all-models" ${S.showBlocked ? 'disabled' : ''}>Select All Visible</button>
      <button class="btn sm" data-a="deselect-all-models" ${S.showBlocked ? 'disabled' : ''}>Deselect All Visible</button>
      <button class="btn sm" data-a="collapse-all-providers">Collapse All</button>
      <button class="btn sm" data-a="expand-all-providers">Expand All</button>
      <label class="set inline"><input type="checkbox" id="mf-free" ${S.modelFreeOnly ? 'checked' : ''}> Free only</label>
      <label class="set inline"><input type="checkbox" id="mf-blocked" ${S.showBlocked ? 'checked' : ''}> Show Blocked (${blockedSet.size})</label>
      <span class="sp"></span>
      <div class="searchbox"><input id="mps" type="search" placeholder="Search providers..." value="${esc(S.modelProviderQuery)}"></div>
      <div class="searchbox"><input id="ms" type="search" placeholder="Search models..." value="${esc(S.modelQuery)}"></div>
      <span class="mute">${inQueue} in queue · ${totalVisible} shown</span>
    </div>

    <div class="model-provider-groups">
      ${groupList.length ? groupList.map((g) => renderModelGroup(g, blockedSet, queueIds, primaryId)).join('') : `
        <div class="card"><div class="empty">No models match the current filters.</div></div>`}
    </div>`;
}

function renderModelGroup(group, blockedSet, queueIds, primaryId) {
  const collapsed = !!S.collapsedProviders[group.providerId];
  const selectedCount = group.models.filter((m) => queueIds.has(m.id)).length;

  return `
    <section class="card model-provider-card">
      <div class="pg-header">
        <div class="pg-header-clickable" data-a="toggle-provider-collapse" data-provider="${esc(group.providerId)}">
          <span class="pg-expand-icon">${collapsed ? '▶' : '▼'}</span>
          <div>
            <div class="pg-title"><b>${esc(group.name)}</b> <span class="mute">(${group.models.length} models)</span></div>
            <div class="pg-stats">${group.models.length} discovered · ${selectedCount} in queue</div>
          </div>
        </div>
        <div class="pg-actions">
          <button class="btn sm" data-a="toggle-provider-collapse" data-provider="${esc(group.providerId)}">${collapsed ? '▶ Expand' : '▼ Collapse'}</button>
          ${!S.showBlocked ? `
            <button class="btn sm" data-a="select-provider-models" data-provider="${esc(group.providerId)}" data-mode="select">Select all</button>
            <button class="btn sm" data-a="select-provider-models" data-provider="${esc(group.providerId)}" data-mode="deselect">Clear</button>` : ''}
        </div>
      </div>

      ${collapsed ? `
        <div class="pg-collapsed-summary" data-a="toggle-provider-collapse" data-provider="${esc(group.providerId)}">
          ${group.models.length} models · ${selectedCount} in queue
        </div>` : `
        <div class="tw">
          <table>
            <thead><tr>
              <th style="width:44px">Use</th>
              <th>Model</th>
              <th class="r">Context</th>
              <th class="r">Queue & Actions</th>
            </tr></thead>
            <tbody>
              ${group.models.map((m) => renderModelRow(m, blockedSet, queueIds, primaryId)).join('')}
            </tbody>
          </table>
        </div>`}
    </section>`;
}

function renderModelRow(m, blockedSet, queueIds, primaryId) {
  const isBlocked = blockedSet.has(m.id);
  const inQueue = queueIds.has(m.id);
  const isPrimary = primaryId === m.id;

  let statusChip = '';
  if (isBlocked) {
    statusChip = '<span class="chip bad">Blocked</span>';
  } else if (isPrimary) {
    statusChip = '<span class="chip ok">Use First</span>';
  } else if (inQueue) {
    statusChip = '<span class="chip">In Queue</span>';
  } else {
    statusChip = '<span class="chip">Available</span>';
  }

  return `
    <tr>
      <td>
        <input type="checkbox" data-a="pin" data-id="${esc(m.id)}" ${inQueue ? 'checked' : ''} ${isBlocked ? 'disabled' : ''}
               aria-label="Add ${esc(m.id)} to routing queue">
      </td>
      <td class="mono">
        <b>${esc(m.displayName || m.name || m.rawId || m.id)}</b>
        ${m.displayName && m.displayName !== m.rawId ? `<span class="mute" style="display:block;font-size:11px">${esc(m.rawId || m.id)}</span>` : ''}
        ${m.free ? '<span class="chip ok">Free</span>' : ''}
      </td>
      <td class="r mono">${m.ctx ? fmt(m.ctx) : '—'}</td>
      <td class="r">
        <div class="row-actions">
          ${statusChip}
          ${!isBlocked ? `
            <button class="btn sm" data-a="queue-select-model" data-id="${esc(m.id)}" title="Add to routing queue">+ Queue</button>
            ${!isPrimary ? `<button class="btn sm" data-a="queue-make-first" data-id="${esc(m.id)}" title="Use this model first">★ First</button>` : ''}
          ` : ''}
          <button class="btn sm" data-a="ping-model" data-id="${esc(m.id)}">Ping</button>
          <button class="btn sm" data-a="copy-model" data-id="${esc(m.id)}">Copy ID</button>
          ${isBlocked
            ? `<button class="btn sm p" data-a="unblock-model" data-id="${esc(m.id)}">Unblock</button>`
            : `<button class="btn sm d" data-a="block-model" data-id="${esc(m.id)}">Block</button>`}
        </div>
      </td>
    </tr>`;
}

window.V = window.V || {};
window.V.models = renderModelsView;
window.renderModelGroup = renderModelGroup;
window.renderModelRow = renderModelRow;
