'use strict';
const { loadState, saveState } = require('../lib/storage');
const { ensureGatewayKey } = require('../lib/gateway-runtime');
const { ensureCloudMemory, toolDefinitions, callTool } = require('../lib/cloud-memory');
const { rawBody } = require('./_body');
const crypto = require('crypto');

function send(res,status,body) {
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(body));
}
function safeEqual(a,b) {
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
module.exports=async function mcp(req,res) {
  if(req.method!=='POST') return send(res,405,{error:'POST only'});
  let state;
  try { state=await loadState(); } catch(err) { return send(res,500,{error:'Memory vault unavailable: '+err.message}); }
  if(ensureGatewayKey(state)) await saveState(state).catch(()=>{});
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token || !safeEqual(token,state.settings.gatewayApiKey)) return send(res,401,{error:'Valid Mine gateway bearer key required.'});
  let body;
  try { const buf=await rawBody(req,1024*1024); body=buf.length?JSON.parse(buf.toString('utf8')):{}; }
  catch(_) { return send(res,400,{error:'Invalid JSON-RPC request'}); }
  const id=body.id===undefined?null:body.id;
  const reply=result=>send(res,200,{jsonrpc:'2.0',id,result});
  const fail=(code,message)=>send(res,200,{jsonrpc:'2.0',id,error:{code,message}});
  if(body.jsonrpc!=='2.0' || typeof body.method!=='string') return fail(-32600,'Invalid JSON-RPC request');
  ensureCloudMemory(state);
  try {
    let result;
    if(body.method==='initialize') {
      result={protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'mine-cloud-memory',version:'1.0.0'}};
    } else if(body.method==='notifications/initialized') {
      return res.end();
    } else if(body.method==='ping') {
      result={};
    } else if(body.method==='tools/list') {
      result={tools:toolDefinitions()};
    } else if(body.method==='tools/call') {
      const p=body.params||{};
      const output=callTool(state,p.name,p.arguments||{});
      result={content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output,isError:false};
    } else {
      return fail(-32601,'Method not found: '+body.method);
    }
    await saveState(state);
    return reply(result);
  } catch(err) {
    return reply({content:[{type:'text',text:err.message}],isError:true});
  }
};
