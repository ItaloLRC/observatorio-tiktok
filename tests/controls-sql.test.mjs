import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {startLocalServer} from '../server/local-server.mjs';
import {queryDatabase} from '../server/sql-query.mjs';

test('interrupção cancela fila, invalida gravações do coletor e permite retomada sem apagar registros; SQL consulta o mesmo banco',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'rtr-controls-')),server=await startLocalServer({dataDir});
 const req=async(route,body,lease)=>{const r=await fetch(server.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(lease?{'X-RTR-Lease':lease}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 try{
  const registered=await req('/api/channels',{url:'@example',provider:'browser',include_comments:false}),job=registered.data.job;
  const claimed=await req('/api/jobs/'+job.id+'/browser-start',{}),lease=claimed.data.lease;
  await req('/api/jobs/'+job.id+'/browser-batch',{videos:[{id:'7708005068741594386',desc:'#teste',views:100}]},lease);
  const stop=await req('/api/crawler/stop',{});assert.equal(stop.data.stopped,1);
  assert.equal((await req('/api/jobs/'+job.id+'/browser-batch',{videos:[{id:'7708005068741594387',desc:'Não pode gravar'}]},lease)).status,409);
  let q=await req('/api/sql/query',{sql:'SELECT id, views FROM latest_video_metrics'});assert.equal(q.status,200);assert.equal(q.data.rows[0].id,'7708005068741594386');assert.equal(q.data.rows[0].views,'100');
  assert.equal((await req('/api/sql/query',{sql:'DELETE FROM videos'})).status,400);
  assert.equal((await req('/api/sql/query',{sql:'WITH one AS (SELECT 1) DELETE FROM videos'})).status,400);
  assert.equal((await req('/api/sql/query',{sql:"ATTACH DATABASE 'other.sqlite' AS other"})).status,400);
  assert.equal((await req('/api/sql/schema')).data.objects.some(t=>t.name==='latest_video_metrics'),true);
  assert.equal((await req('/api/jobs/'+job.id+'/resume',{})).status,200);assert.equal((await req('/api/status')).data.counts.videos,1);
  await assert.rejects(()=>queryDatabase(server.databasePath,'WITH RECURSIVE t(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM t WHERE x<1000000000) SELECT SUM(x) FROM t',{timeout:100}),/excedeu/);
 }finally{await server.close();fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('content script aborta imediatamente ao interromper ou receber HTTP 403, antes de fazer nova ação',async()=>{
 for(const blocked of [false,true]){
  let listener;const events={},messages=[];const fakeWindow={addEventListener(name,fn){events[name]=fn;}};
  const context=vm.createContext({RTRCore:{},window:fakeWindow,location:{origin:'https://www.tiktok.com'},document:{readyState:'loading',body:null,querySelector(){return null;}},chrome:{runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},async sendMessage(m){messages.push(m);return {data:{}};}}},AbortController,DOMException,setTimeout,clearTimeout,setInterval,clearInterval,console});
  vm.runInContext(fs.readFileSync(new URL('../extension/source.js',import.meta.url),'utf8'),context);
  listener({type:'RTR_TASK',jobId:'job1',phase:'profile',channel:{handle:'example'}},{id:'test'},()=>{});
  if(blocked)events.message({source:fakeWindow,origin:'https://www.tiktok.com',data:{source:'RTR_HTTP_FAILURE',status:403}});
  else listener({type:'RTR_STOP',jobId:'job1'},{id:'test'},()=>{});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(messages.some(m=>m.type==='RTR_SOURCE_API'),false);
  assert.equal(messages.some(m=>m.type==='RTR_SOURCE_ERROR'&&m.blocked),blocked);
 }
});
