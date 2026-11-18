'use strict';

/**
 * API Keys view.
 *
 * Lists every stored credential with its status, usage, and latency. Multiple
 * keys for the same provider are load-balanced and fail over automatically.
 */

function renderKeysView() {
  const bad = S.keys.filter((k) => k.status === 'DEAD').length;

  return `
    <div class="view-head">
      <div>
        <h2>Key Pool</h2>
        <p class="sub">Credentials for every provider you connect. Add several keys for the same provider to enable automatic load balancing and 429 rotation.</p>
      </div>
      <button class="btn p" data-a="open-add-key">+ Add API Key</button>
    </div>

    <div class="bar">
      <button class="btn" data-a="testall">Test All</button>
      <button class="btn d" data-a="prune" ${bad ? '' : 'disabled'}>Remove Invalid (${bad})</button>
      <span class="sp"></span>
      <select id="kf" aria-label="Filter status">
        <option value="ALL" ${!S.kf || S.kf === 'ALL' ? 'selected' : ''}>All Statuses</option>
        <option value="ACTIVE" ${S.kf === 'ACTIVE' ? 'selected' : ''}>Active</option>
        <option value="COOLDOWN" ${S.kf === 'COOLDOWN' ? 'selected' : ''}>Rate-limited</option>
        <option value="DEAD" ${S.kf === 'DEAD' ? 'selected' : ''}>Invalid</option>
      </select>
    </div>

    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Key Label & Hint</th>
            <th>Status</th>
            <th>Requests Today</th>
            <th>Total Tokens</th>
            <th class="r">Latency</th>
            <th class="r">Actions</th>
          </tr>
        </thead>
        <tbody>${renderKeyRows()}</tbody>
      </table>
    </div>`;
}

function renderKeyRows() {
  const list = S.keys.filter((k) => !S.kf || S.kf === 'ALL' || k.status === S.kf);

  if (!list.length) {
    return '<tr><td colspan="7" class="mute" style="text-align:center;padding:28px">No keys yet. Click <b>+ Add API Key</b> to connect your first provider.</td></tr>';
  }

  return list
    .map((k) => {
      const p = getProvider(k.provider || k.providerId) || { name: k.provider || 'Unknown' };
      const st = STL[k.status] || STL.UNKNOWN;
      const enabled = k.enabled !== false;

      return `
        <tr>
          <td>
            <b>${esc(p.name)}</b>
            ${p.custom ? '<span class="chip custom" style="margin-left:6px;font-size:10px">Custom</span>' : ''}
          </td>
          <td>
            <div>${esc(k.label || p.name)}</div>
            <span class="k mute">${maskKey(k.key)}</span>
          </td>
          <td>
            <div class="row-actions">
              <span class="chip ${enabled ? st[1] : 'warn'}">${enabled ? st[0] : 'Disabled'}</span>
              ${getKeyTierBadge(k, p)}
            </div>
            ${k.lastError ? `<div class="mute" style="font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;margin-top:4px">${esc(k.lastError)}</div>` : ''}
          </td>
          <td class="mono">${fmt(k.usageToday || 0)}</td>
          <td class="mono">${fmt(k.totalTokens || 0)}</td>
          <td class="r mono">${k.lastLatency ? k.lastLatency + ' ms' : '-'}</td>
          <td class="r">
            <div class="row-actions" style="justify-content:flex-end">
              <label class="chip" style="cursor:pointer" title="${enabled ? 'Disable this key' : 'Enable this key'}">
                <input type="checkbox" data-a="toggle-key" data-id="${esc(k.id)}" ${enabled ? 'checked' : ''} style="margin-right:4px">
                ${enabled ? 'Enabled' : 'Off'}
              </label>
              <button class="btn sm" data-a="copy-key" data-id="${esc(k.id)}">Copy</button>
              ${k.status === 'DEAD' ? '<button class="btn sm p" data-a="replace-key" data-id="' + esc(k.id) + '">Replace Key</button>' : ''}
              <button class="btn sm" data-a="testkey" data-id="${esc(k.id)}">Test</button>
              <button class="btn sm d" data-a="rmkey" data-id="${esc(k.id)}">Delete</button>
            </div>
          </td>
        </tr>`;
    })
    .join('');
}

window.V = window.V || {};
window.V.keys = renderKeysView;
window.V.keyRows = renderKeyRows;
