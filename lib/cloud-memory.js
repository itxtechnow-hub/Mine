'use strict';
const crypto = require('crypto');
const MAX_RECORD_BYTES = 100 * 1024;
const MAX_RECORDS = 500;
const MAX_AUDIT = 1000;
function ensureCloudMemory(state) {
  if (!state.cloudMemory || typeof state.cloudMemory !== 'object') state.cloudMemory = { records: [], audit: [], pendingDeletes: [], permissions: { read: true, write: true, update: true, delete: false }, mcpServers: [] };
  const m = state.cloudMemory;
  if (!Array.isArray(m.records)) m.records = [];
  if (!Array.isArray(m.audit)) m.audit = [];
  if (!Array.isArray(m.pendingDeletes)) m.pendingDeletes = [];
  if (!Array.isArray(m.mcpServers)) m.mcpServers = [];
  m.permissions = { read: true, write: true, update: true, delete: false, ...(m.permissions || {}) };
  return m;
}
function cleanText(v, max, field) {
  const s = String(v == null ? '' : v).trim();
  if (!s) throw new Error(field + ' is required');
  if (s.length > max) throw new Error(field + ' is too long');
  return s;
}
function canAccess(r, modelId) { return r.scope !== 'private' || (!!modelId && r.owner === modelId); }
function audit(m, action, record, actor) {
  m.audit.unshift({ id: crypto.randomUUID(), action, recordId: record && record.id || null, title: record && record.title || null, actor: String(actor || 'unknown').slice(0, 120), at: new Date().toISOString() });
  m.audit = m.audit.slice(0, MAX_AUDIT);
}
function list(state, options) {
  const m = ensureCloudMemory(state), o = options || {}, modelId = String(o.modelId || '');
  return m.records.filter(r => (!o.scope || o.scope === 'all' || r.scope === o.scope) && canAccess(r, modelId))
    .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.min(200, Math.max(1, Number(o.limit) || 100)))
    .map(({content, ...r}) => ({...r, preview: String(content || '').slice(0,240)}));
}
function search(state, query, options) {
  const m = ensureCloudMemory(state), o = options || {}, q = String(query || '').trim().toLowerCase(), modelId = String(o.modelId || '');
  if (!q) return list(state, o);
  return m.records.filter(r => canAccess(r, modelId) && (!o.scope || o.scope === 'all' || r.scope === o.scope))
    .filter(r => [r.title, r.content, ...(r.tags || [])].join(' ').toLowerCase().includes(q))
    .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.min(50, Math.max(1, Number(o.limit) || 20)))
    .map(r => ({id:r.id,title:r.title,scope:r.scope,format:r.format,owner:r.owner,tags:r.tags,updatedAt:r.updatedAt,excerpt:String(r.content || '').slice(0,500)}));
}
function read(state, id, modelId) {
  const r = ensureCloudMemory(state).records.find(x => x.id === String(id));
  return !r || !canAccess(r, modelId) ? null : {...r};
}
function write(state, input, actor, mode) {
  const m = ensureCloudMemory(state), d = input || {}, modelId = String(d.modelId || actor || 'agent').slice(0,120), action = mode || 'write';
  if (m.permissions[action] === false) throw new Error('Cloud Memory ' + action + ' permission is disabled');
  const scope = d.scope === 'private' ? 'private' : 'shared', format = d.format === 'json' ? 'json' : 'markdown';
  const title = cleanText(d.title,180,'Title'), content = typeof d.content === 'string' ? d.content : JSON.stringify(d.content);
  if (!content || Buffer.byteLength(content,'utf8') > MAX_RECORD_BYTES) throw new Error('Memory content must be under 100 KB');
  if (format === 'json') { try { JSON.parse(content); } catch (_) { throw new Error('JSON memory must contain valid JSON'); } }
  const now = new Date().toISOString(), id = String(d.id || '');
  let r = id ? m.records.find(x => x.id === id) : null;
  if (r) {
    if (m.permissions.update === false) throw new Error('Cloud Memory update permission is disabled');
    if (!canAccess(r,modelId)) throw new Error('This private memory belongs to another model');
    Object.assign(r,{title,content,format,tags:Array.isArray(d.tags)?d.tags.map(x=>String(x).slice(0,40)).slice(0,20):r.tags,updatedAt:now,updatedBy:modelId});
    audit(m,'update',r,actor || modelId);
  } else {
    if (m.records.length >= MAX_RECORDS) m.records = m.records.slice(0,MAX_RECORDS-1);
    r = {id:crypto.randomUUID(),scope,owner:scope==='private'?modelId:null,title,format,content,tags:Array.isArray(d.tags)?d.tags.map(x=>String(x).slice(0,40)).slice(0,20):[],createdAt:now,updatedAt:now,createdBy:modelId,updatedBy:modelId};
    m.records.unshift(r); audit(m,'write',r,actor || modelId);
  }
  return {...r};
}
function requestDelete(state,id,actor) {
  const m=ensureCloudMemory(state), r=m.records.find(x=>x.id===String(id));
  if(!r) return {success:false,error:'Memory record not found'};
  if(m.permissions.delete===true) { m.records=m.records.filter(x=>x.id!==r.id); audit(m,'delete',r,actor); return {success:true,deleted:true}; }
  let p=m.pendingDeletes.find(x=>x.recordId===r.id && x.status==='pending');
  if(!p) { p={id:crypto.randomUUID(),recordId:r.id,title:r.title,requestedBy:String(actor||'agent'),requestedAt:new Date().toISOString(),status:'pending'}; m.pendingDeletes.unshift(p); audit(m,'delete-requested',r,actor); }
  return {success:true,approvalRequired:true,requestId:p.id};
}
function approveDelete(state,requestId,approve,actor) {
  const m=ensureCloudMemory(state), p=m.pendingDeletes.find(x=>x.id===String(requestId)&&x.status==='pending');
  if(!p) return {success:false,error:'Pending deletion request not found'};
  p.status=approve?'approved':'rejected'; p.reviewedAt=new Date().toISOString(); p.reviewedBy=String(actor||'admin');
  if(approve) { const r=m.records.find(x=>x.id===p.recordId); m.records=m.records.filter(x=>x.id!==p.recordId); audit(m,'delete-approved',r||{id:p.recordId,title:p.title},actor); }
  else audit(m,'delete-rejected',{id:p.recordId,title:p.title},actor);
  return {success:true,request:p};
}
function toolDefinitions() {
  return [
    {name:'memory.list',description:'List Mine Cloud Memory records available to this model.',inputSchema:{type:'object',properties:{scope:{type:'string',enum:['shared','private','all']},modelId:{type:'string'},limit:{type:'number'}}}},
    {name:'memory.search',description:'Search shared and this model private Mine Cloud Memory records.',inputSchema:{type:'object',properties:{query:{type:'string'},scope:{type:'string',enum:['shared','private','all']},modelId:{type:'string'},limit:{type:'number'}},required:['query']}},
    {name:'memory.read',description:'Read a memory record by ID.',inputSchema:{type:'object',properties:{id:{type:'string'},modelId:{type:'string'}},required:['id']}},
    {name:'memory.write',description:'Create a shared or private Markdown/JSON memory record.',inputSchema:{type:'object',properties:{title:{type:'string'},content:{},format:{type:'string',enum:['markdown','json']},scope:{type:'string',enum:['shared','private']},tags:{type:'array',items:{type:'string'}},modelId:{type:'string'}},required:['title','content']}},
    {name:'memory.update',description:'Update a memory record by ID.',inputSchema:{type:'object',properties:{id:{type:'string'},title:{type:'string'},content:{},format:{type:'string',enum:['markdown','json']},tags:{type:'array',items:{type:'string'}},modelId:{type:'string'}},required:['id','title','content']}},
    {name:'memory.delete',description:'Request deletion of a memory record. Mine requires owner approval before deletion.',inputSchema:{type:'object',properties:{id:{type:'string'},modelId:{type:'string'}},required:['id']}}
  ];
}
function callTool(state,name,args) {
  const a=args||{}, actor=a.modelId||'mcp-client';
  switch(name) {
    case 'memory.list': return list(state,a);
    case 'memory.search': return search(state,a.query,a);
    case 'memory.read': { const r=read(state,a.id,a.modelId); if(!r) throw new Error('Memory record not found or access denied'); return r; }
    case 'memory.write': return write(state,a,actor,'write');
    case 'memory.update': return write(state,a,actor,'update');
    case 'memory.delete': return requestDelete(state,a.id,actor);
    default: throw new Error('Unknown Mine Memory tool: '+name);
  }
}
module.exports={ensureCloudMemory,list,search,read,write,requestDelete,approveDelete,toolDefinitions,callTool};
