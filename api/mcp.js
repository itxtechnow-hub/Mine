'use strict';
const { loadState, saveState } = require('../lib/storage');
const { ensureGatewayKey, handleGatewayRequest } = require('../lib/gateway-runtime');
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
      const clientInfo = (body.params && body.params.clientInfo) || {};
      const clientName = String(clientInfo.name || req.headers['user-agent'] || 'Unknown MCP client').slice(0,120);
      const clientVersion = String(clientInfo.version || '').slice(0,80);
      const clientKey = (clientName + '|' + clientVersion).toLowerCase();
      const clients = state.cloudMemory.mcpClients || (state.cloudMemory.mcpClients = []);
      const previous = clients.findIndex(x => (x.name + '|' + (x.version || '')).toLowerCase() === clientKey);
      const clientRecord = { name: clientName, version: clientVersion, connectedAt: new Date().toISOString(), capabilities: body.params && body.params.capabilities || {} };
      if (previous >= 0) clients.splice(previous, 1);
      clients.unshift(clientRecord);
      state.cloudMemory.mcpClients = clients.slice(0, 30);
      result={
        protocolVersion:'2025-03-26',
        capabilities:{tools:{listChanged:false}},
        serverInfo:{name:'mine',version:'2.1.0'},
        instructions:'Mine MCP provides Cloud Memory tools plus mine_list_models, mine_list_teams, and mine_chat_completion. Use mine_chat_completion with model mine/team/<slug> to run a complete Mine Team Leader workflow. Authenticate with the Mine gateway API key.'
      };
    } else if(body.method==='notifications/initialized') {
      return res.end();
    } else if(body.method==='ping') {
      result={};
    } else if(body.method==='tools/list') {
      result={tools:[
        ...toolDefinitions(),
        {name:'mine_list_models',description:'List provider models and Mine team models available through this gateway.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
        {name:'mine_list_teams',description:'List enabled Mine teams and their model IDs.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
        {name:'mine_chat_completion',description:'Run a chat completion through Mine. Use mine/team/<slug> to invoke a Team Leader and its subagents.',inputSchema:{type:'object',properties:{model:{type:'string'},messages:{type:'array',items:{type:'object',properties:{role:{type:'string'},content:{}},required:['role','content'],additionalProperties:true}},max_tokens:{type:'integer',minimum:1,maximum:8192},temperature:{type:'number',minimum:0,maximum:2}},required:['model','messages'],additionalProperties:false}}
      ]};
    } else if(body.method==='tools/call') {
      const p=body.params||{};
      const args=p.arguments||{};
      let output;
      if(p.name==='mine_list_models') {
        output=[{id:'mine/auto',owned_by:'Mine'},...(state.teams||[]).filter(t=>t.enabled!==false).map(t=>({id:'mine/team/'+(t.slug||t.id),name:t.name||t.id,owned_by:'Mine'})),...(state.fetchedModels||[]).map(m=>({id:m.id,owned_by:m.providerId||m.provider||'provider'}))];
      } else if(p.name==='mine_list_teams') {
        output=(state.teams||[]).filter(t=>t.enabled!==false).map(t=>({id:t.id,name:t.name,slug:t.slug,model:'mine/team/'+(t.slug||t.id)}));
      } else if(p.name==='mine_chat_completion') {
        const chatBody={model:String(args.model||''),messages:Array.isArray(args.messages)?args.messages:[],max_tokens:Math.max(1,Math.min(8192,Number(args.max_tokens)||2048)),temperature:args.temperature==null?0.7:Number(args.temperature),stream:false};
        if(!chatBody.model||!chatBody.messages.length) throw new Error('model and non-empty messages are required');
        const fakeReq={method:'POST',url:'/v1/chat/completions',headers:{'content-type':'application/json',authorization:'Bearer '+state.settings.gatewayApiKey,'x-mine-agent':'mcp-client'},rawBody:Buffer.from(JSON.stringify(chatBody),'utf8')};
        const captured={statusCode:200,headers:{},chunks:[],headersSent:false,writableEnded:false,destroyed:false};
        const fakeRes={
          get headersSent(){return captured.headersSent;},get writableEnded(){return captured.writableEnded;},get destroyed(){return captured.destroyed;},
          setHeader(name,value){captured.headers[name]=value;},
          writeHead(status,headers){captured.statusCode=status;captured.headers={...captured.headers,...(headers||{})};captured.headersSent=true;},
          write(chunk){captured.chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)));return true;},
          end(chunk){if(chunk!=null)captured.chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)));captured.writableEnded=true;}
        };
        await handleGatewayRequest(fakeReq,fakeRes,'/v1/chat/completions');
        const raw=Buffer.concat(captured.chunks).toString('utf8');
        try{output=JSON.parse(raw);}catch(_){output={text:raw};}
        if(captured.statusCode>=400) throw new Error(output.error&&output.error.message||output.message||'Mine chat request failed');
      } else {
        output=callTool(state,p.name,args);
      }
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
