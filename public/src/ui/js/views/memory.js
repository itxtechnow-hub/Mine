'use strict';
window.V = window.V || {};
window.A = window.A || {};

(function () {
  let data = null;
  let query = '';
  let selected = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function toast(message) {
    if (typeof window.toast === 'function') window.toast(message);
    else console.info('[Mine Memory]', message);
  }
  async function load(force) {
    if (data && !force) return data;
    const result = await window.vault.cloudMemory.get();
    if (result && result.success === false) throw new Error(result.error || 'Could not load Cloud Memory');
    data = result || {records:[],audit:[],pendingDeletes:[],permissions:{},endpoint:'/mcp'};
    if (typeof window.render === 'function' && window.S && window.S.page === 'memory') window.render();
    return data;
  }
  function recordCard(r) {
    return '<details class="card memory-record" style="padding:10px;margin:0 0 8px">' +
      '<summary style="display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;list-style:none">' +
      '<span style="min-width:0;flex:1"><b>'+esc(r.title)+'</b><span class="mute" style="display:block;font-size:10px;margin-top:3px">'+esc(r.scope)+' · '+esc(r.format)+' · '+esc(new Date(r.updatedAt).toLocaleDateString())+'</span></span>' +
      '<span class="chip">'+esc((r.tags||[]).slice(0,2).join(', ') || 'Memory')+'</span></summary>' +
      '<div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px"><button class="btn sm" data-a="memory-edit" data-id="'+esc(r.id)+'">Edit</button><button class="btn sm danger" data-a="memory-delete" data-id="'+esc(r.id)+'">Delete</button></div>' +
      '<p class="mute" style="font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0">'+esc(r.content || '').slice(0,500)+'</p>' +
      '<div class="mute mono" style="font-size:10px;margin-top:8px">ID: '+esc(r.id)+'</div></details>';
  }
  function render() {
    if (!data) {
      setTimeout(() => load(false).catch(e => { toast(e.message); }), 0);
      return '<div class="view"><div class="card"><h2>Cloud Memory</h2><p class="mute">Loading your encrypted memory vault…</p></div></div>';
    }
    const records = (data.records || []).filter(r => !query || [r.title,r.content,(r.tags||[]).join(' ')].join(' ').toLowerCase().includes(query.toLowerCase()));
    const p = data.permissions || {};
    const modelIds = [...new Set((window.S && window.S.models || []).map(m => m && m.id).filter(Boolean))].slice(0, 80);
    const selectedModel = window.S && window.S.cloudMemorySelectedModel || modelIds[0] || '';
    const modelPerm = (data.modelPermissions || {})[selectedModel] || {};
    const pending = (data.pendingDeletes || []).filter(x => x.status === 'pending');
    const edit = selected || { title:'',content:'',format:'markdown',scope:'shared',tags:[] };
    return '<div class="view">' +
      '<div class="view-head"><div><h2>Mine Cloud Memory</h2><p class="sub">Encrypted persistent memory shared by your Mine workspace and connected MCP clients.</p></div><button class="btn primary" data-a="memory-new">+ New memory</button></div>' +
      '<details class="card" style="margin-bottom:14px" open><summary style="cursor:pointer;font-weight:700">Installed MCP servers ('+(data.mcpServers||[]).length+') <span class="mute" style="font-weight:400">· manage availability</span></summary>' +
      ((data.mcpServers||[]).length ? (data.mcpServers||[]).map(server=>'<label class="set"><span><b>'+esc(server.name||server.serverName||server.id)+'</b><br><span class="mute">'+esc(server.teamName||server.teamId||'Mine Team')+' · '+esc(server.tools||'MCP tools')+'</span></span><input type="checkbox" data-a="memory-server-toggle" data-id="'+esc(server.id)+'" '+(server.enabled!==false?'checked':'')+'></label>').join('') : '<p class="mute">No MCP servers have been added through a Team flow yet. Add an MCP node in the Team editor and save it to register it here.</p>') +
      '</details>' +
      '<details class="card" style="margin-bottom:14px"><summary style="cursor:pointer;font-weight:700">Detected MCP clients ('+(data.mcpClients||[]).length+')</summary>' +
      ((data.mcpClients||[]).length ? (data.mcpClients||[]).map(client=>'<div class="set"><span><b>'+esc(client.name)+'</b><br><span class="mute">'+esc(client.version||'Version not reported')+' · '+esc(new Date(client.connectedAt).toLocaleString())+'</span></span><span class="chip ok">Detected</span></div>').join('') : '<p class="mute">No MCP client has initialized this endpoint yet. The first initialize request identifies the client and returns setup instructions with supported and unsupported features.</p>') +
      '</details>' +
      '<section class="card" style="margin-bottom:14px"><h3>Per-model permissions</h3><p class="mute">Override workspace defaults for each discovered model. Private memory is still isolated by model ID.</p>' +
      '<div class="field-row"><label>Model</label><select class="input" id="memory-model-select">'+(modelIds.length?modelIds.map(id=>'<option value="'+esc(id)+'" '+(id===selectedModel?'selected':'')+'>'+esc(id)+'</option>').join(''):'<option value="">No discovered models yet</option>')+'</select></div>' +
      (selectedModel ? ['read','write','update'].map(k=>'<label class="set"><span><b>'+k[0].toUpperCase()+k.slice(1)+'</b><br><span class="mute">Override default for '+esc(selectedModel)+'</span></span><input type="checkbox" data-a="memory-model-permission" data-perm="'+k+'" '+((modelPerm[k]===undefined?p[k]!==false:modelPerm[k]!==false)?'checked':'')+'></label>').join('') : '<p class="mute">Add API keys and refresh Models to configure per-model access.</p>') +
      '</section>' +
      '<div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:14px">' +
      '<section class="card"><h3>Memory MCP Server</h3><p class="mute">Connect an MCP-compatible client to read and edit Mine memory with your gateway key.</p>' +
      '<div class="field-row"><label>Streamable HTTP endpoint</label><div class="row"><input class="input mono" id="memory-endpoint" readonly value="'+esc(data.endpoint || location.origin+'/mcp')+'"><button class="btn sm" data-a="memory-copy-endpoint">Copy</button></div></div>' +
      '<div class="row-actions"><button class="btn sm" data-a="memory-copy-key">Copy gateway key</button><button class="btn sm" data-a="memory-refresh">Refresh</button></div>' +
      '<p class="mute" style="font-size:11px;margin-top:10px">Tools: memory.list, memory.search, memory.read, memory.write, memory.update, memory.delete. Deletion requests wait for your approval.</p></section>' +
      '<section class="card"><h3>Model permissions</h3><p class="mute">Default permissions for agents and MCP tool calls.</p>' +
      ['read','write','update'].map(k=>'<label class="set"><span><b>'+k[0].toUpperCase()+k.slice(1)+'</b><br><span class="mute">Allow models to '+k+' memory</span></span><input type="checkbox" data-a="memory-permission" data-perm="'+k+'" '+(p[k]!==false?'checked':'')+'></label>').join('') +
      '<div class="set"><span><b>Delete</b><br><span class="mute">Always requires owner approval</span></span><span class="chip ok">Approval required</span></div></section></div>' +
      (pending.length ? '<section class="card" style="margin-bottom:14px"><h3>Deletion approvals <span class="chip warn">'+pending.length+' pending</span></h3>'+pending.map(x=>'<div class="set"><span><b>'+esc(x.title)+'</b><br><span class="mute">Requested by '+esc(x.requestedBy)+' · '+esc(new Date(x.requestedAt).toLocaleString())+'</span></span><div class="row"><button class="btn sm danger" data-a="memory-approve-delete" data-id="'+esc(x.id)+'">Approve</button><button class="btn sm" data-a="memory-reject-delete" data-id="'+esc(x.id)+'">Reject</button></div></div>').join('')+'</section>' : '') +
      '<div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">' +
      '<section class="card"><div class="row" style="justify-content:space-between"><h3>Saved memories ('+(data.records||[]).length+')</h3><input class="input" id="memory-search" placeholder="Search memory…" value="'+esc(query)+'" style="max-width:180px"></div>' +
      (records.length ? records.map(recordCard).join('') : '<div class="empty">No memory records found. Create one or let a team save useful work.</div>')+'</section>' +
      '<section class="card"><h3>'+(edit.id?'Edit memory':'Create memory')+'</h3><div class="field-row"><label>Title</label><input class="input" id="memory-title" value="'+esc(edit.title)+'" placeholder="Project decisions, preferences, notes…"></div>' +
      '<div class="field-row"><label>Scope</label><select class="input" id="memory-scope"><option value="shared" '+(edit.scope!=='private'?'selected':'')+'>Shared with all agents</option><option value="private" '+(edit.scope==='private'?'selected':'')+'>Private to model</option></select></div>' +
      '<div class="field-row"><label>Format</label><select class="input" id="memory-format"><option value="markdown" '+(edit.format!=='json'?'selected':'')+'>Markdown</option><option value="json" '+(edit.format==='json'?'selected':'')+'>JSON</option></select></div>' +
      '<div class="field-row"><label>Tags (comma separated)</label><input class="input" id="memory-tags" value="'+esc((edit.tags||[]).join(', '))+'" placeholder="project, decisions, notes"></div>' +
      '<div class="field-row"><label>Content</label><textarea class="input" id="memory-content" rows="12" style="width:100%;resize:vertical" placeholder="Write durable information for your agents…">'+esc(edit.content)+'</textarea></div>' +
      '<div class="row-actions"><button class="btn primary" data-a="memory-save">'+(edit.id?'Save changes':'Save memory')+'</button>'+(edit.id?'<button class="btn" data-a="memory-cancel">Cancel</button>':'')+'</div>' +
      '<p class="mute" style="font-size:11px;margin-top:10px">Private memories are visible only when a model supplies its matching model ID. Keep passwords and API keys out of model-readable memory.</p></section></div>' +
      '<section class="card" style="margin-top:14px"><h3>Activity history</h3>'+(data.audit||[]).slice(0,12).map(x=>'<div class="set"><span><b>'+esc(x.action)+' · '+esc(x.title||x.recordId||'')+'</b><br><span class="mute">'+esc(x.actor)+' · '+esc(new Date(x.at).toLocaleString())+'</span></span></div>').join('')+'</section>' +
      '</div>';
  }

  window.V.memory = render;
  window.A['memory-new'] = () => { selected=null; render(); window.render(); };
  window.A['memory-edit'] = (el) => { const r=(data.records||[]).find(x=>x.id===el.dataset.id); selected=r?{...r}:null; window.render(); };
  window.A['memory-cancel'] = () => { selected=null; window.render(); };
  window.A['memory-refresh'] = async () => { await load(true); toast('Cloud Memory refreshed'); };
  window.A['memory-copy-endpoint'] = async () => { const v=document.getElementById('memory-endpoint')?.value || location.origin+'/mcp'; try { await navigator.clipboard.writeText(v); toast('MCP endpoint copied'); } catch(_) { prompt('Copy MCP endpoint',v); } };
  window.A['memory-copy-key'] = async () => { const r=await window.vault.gateway.revealKey(); if(!r||!r.key) return toast('Could not read gateway key'); try { await navigator.clipboard.writeText(r.key); toast('Gateway key copied'); } catch(_) { prompt('Copy gateway key',r.key); } };
  window.A['memory-save'] = async () => {
    const title=document.getElementById('memory-title')?.value || '';
    const content=document.getElementById('memory-content')?.value || '';
    const format=document.getElementById('memory-format')?.value || 'markdown';
    const scope=document.getElementById('memory-scope')?.value || 'shared';
    const tags=(document.getElementById('memory-tags')?.value || '').split(',').map(x=>x.trim()).filter(Boolean);
    if(!title.trim()||!content.trim()) return toast('Add a title and content first');
    if(format==='json') { try { JSON.parse(content); } catch(_) { return toast('Enter valid JSON content'); } }
    const payload={title,content,format,scope,tags,...(selected&&selected.id?{id:selected.id}:{})};
    const r=await window.vault.cloudMemory.save(payload,selected?'update':'write');
    if(!r||!r.success) return toast((r&&r.error)||'Could not save memory');
    selected=null; await load(true); toast('Memory saved');
  };
  window.A['memory-delete'] = async (el) => {
    if(!confirm('Request deletion of this memory? Deletion requires approval.')) return;
    const r=await window.vault.cloudMemory.delete(el.dataset.id);
    if(r&&r.success) { await load(true); toast(r.approvalRequired?'Deletion request added for approval':'Memory deleted'); }
    else toast((r&&r.error)||'Could not request deletion');
  };
  window.A['memory-approve-delete'] = async (el) => { const r=await window.vault.cloudMemory.approveDelete(el.dataset.id,true); if(r&&r.success) await load(true); else toast(r.error||'Approval failed'); };
  window.A['memory-reject-delete'] = async (el) => { const r=await window.vault.cloudMemory.approveDelete(el.dataset.id,false); if(r&&r.success) await load(true); else toast(r.error||'Reject failed'); };
  window.A['memory-permission'] = async (el) => {
    const p={...(data.permissions||{}),[el.dataset.perm]:el.checked};
    const r=await window.vault.cloudMemory.setPermissions(p);
    if(r&&r.success) { data.permissions=r.permissions; toast('Memory permissions updated'); }
    else toast((r&&r.error)||'Could not update permissions');
  };
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'memory-model-select') {
      window.S.cloudMemorySelectedModel = e.target.value;
      window.render();
    }
  });
  window.A['memory-server-toggle'] = async (el) => {
    const servers=(data.mcpServers||[]).map(server=>server.id===el.dataset.id?{...server,enabled:el.checked}:server);
    const r=await window.vault.cloudMemory.setServers(servers);
    if(r&&r.success){data.mcpServers=r.mcpServers||servers;toast(el.checked?'MCP server enabled':'MCP server disabled');}
    else {el.checked=!el.checked;toast((r&&r.error)||'Could not update MCP server');}
  };
  window.A['memory-model-permission'] = async (el) => {
    const modelId = window.S && window.S.cloudMemorySelectedModel || '';
    if (!modelId) return;
    const current = {...((data.modelPermissions || {})[modelId] || {})};
    current[el.dataset.perm] = el.checked;
    const r = await window.vault.cloudMemory.setModelPermissions({modelId,permissions:current});
    if (r && r.success) { data.modelPermissions = data.modelPermissions || {}; data.modelPermissions[modelId] = r.permissions; toast('Model permissions updated'); }
    else toast((r && r.error) || 'Could not update model permissions');
  };
  document.addEventListener('input', e => {
    if(e.target && e.target.id==='memory-search') { query=e.target.value; const pos=e.target.selectionStart; window.render(); const next=document.getElementById('memory-search'); if(next){next.focus();next.setSelectionRange(pos,pos);} }
  });
})();
