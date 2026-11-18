'use strict';

/**
 * Providers view.
 *
 * Lists every built-in and custom provider with its base URL, quota
 * behaviour, category, and how many API keys are attached to it.
 */

function renderProvidersView() {
  return `
    <div class="view-head">
      <div>
        <h2>Provider Directory</h2>
        <p class="sub">Built-in and custom AI endpoints, with the number of keys attached to each.</p>
      </div>
      <button class="btn p" data-a="open-custom-provider">+ Custom Provider</button>
    </div>

    <div class="bar">
      <select id="pf" aria-label="Filter category">
        <option value="ALL" ${S.pf === 'ALL' ? 'selected' : ''}>All Categories</option>
        <option value="Free" ${S.pf === 'Free' ? 'selected' : ''}>Free Tier</option>
        <option value="Paid" ${S.pf === 'Paid' ? 'selected' : ''}>Paid</option>
        <option value="Custom" ${S.pf === 'Custom' ? 'selected' : ''}>Custom</option>
      </select>
      <div class="searchbox"><input id="pps" type="search" placeholder="Search providers..." value="${esc(S.providerQuery || '')}"></div>
      <span class="sp"></span>
      <span class="mute">${getAllProviders().length} providers</span>
    </div>

    <div class="tw">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Base URL</th>
            <th>Quota</th>
            <th>Category</th>
            <th class="r">Keys</th>
            <th class="r">Actions</th>
          </tr>
        </thead>
        <tbody>${renderProviderRows(S.providerQuery || '')}</tbody>
      </table>
    </div>`;
}

function renderProviderRows(q) {
  q = (q || '').toLowerCase();
  const all = getAllProviders();

  const filtered = all.filter((p) => {
    let matchesCat = S.pf === 'ALL';
    if (S.pf === 'Custom') matchesCat = !!p.custom;
    else if (S.pf !== 'ALL') matchesCat = p.cat === S.pf;

    const matchesQuery = (p.name + ' ' + p.id + ' ' + (p.url || '')).toLowerCase().includes(q);
    return matchesCat && matchesQuery;
  });

  if (!filtered.length) {
    return '<tr><td colspan="6" class="mute" style="text-align:center;padding:24px">No providers found.</td></tr>';
  }

  return filtered
    .map((p) => {
      const count = S.keys.filter((k) => (k.provider || k.providerId) === p.id).length;
      return `
        <tr>
          <td>
            <b>${esc(p.name)}</b>
            ${p.custom ? '<span class="chip custom" style="margin-left:6px">Custom</span>' : ''}
            ${p.free && !p.custom ? '<span class="chip ok" style="margin-left:6px">Free tier</span>' : ''}
          </td>
          <td class="mono mute">${esc((p.url || '').replace(/^https?:\/\//, ''))}</td>
          <td>${esc(p.reset || 'None')}</td>
          <td><span class="chip">${esc(p.cat || 'Custom')}</span></td>
          <td class="r mono">${count ? '<b>' + count + '</b>' : '<span class="mute">0</span>'}</td>
          <td class="r">
            <div class="row-actions" style="justify-content:flex-end">
              <button class="btn sm" data-a="open-edit-provider" data-id="${esc(p.id)}">Edit</button>
              ${p.custom ? `<button class="btn sm d" data-a="rm-custom-provider" data-id="${esc(p.id)}">Delete</button>` : ''}
            </div>
          </td>
        </tr>`;
    })
    .join('');
}

window.V = window.V || {};
window.V.providers = renderProvidersView;
window.V.providerRows = renderProviderRows;
