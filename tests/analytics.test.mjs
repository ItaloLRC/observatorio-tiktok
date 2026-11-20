import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {startLocalServer} from '../server/local-server.mjs';import {d1,openDatabase} from '../runtime/local-db.mjs';import {saveVideo,saveComment,channelData} from '../runtime/repository.mjs';import {regression,correlation} from '../web/statistics.js';
test('Todos agrega vídeos, mantém origem e paginação; lixeira preserva histórico, cancela leases e restaura sem reativar coleta',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rtr-analytics-')),server=await startLocalServer({dataDir:dir}),db=server.db,DB=d1(db);
 const req=async(url,body)=>{const r=await fetch(server.origin+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 try{
  const a=(await req('/api/channels',{url:'@canal_a',provider:'browser'})).data,b=(await req('/api/channels',{url:'@canal_b',provider:'browser'})).data;
  const ids=['7708005068741594386','7708005068741594387','7708005068741594388'];
  await saveVideo(DB,a.channel,a.job.id,{id:ids[0],views:100,desc:'#a',duration_s:10});await saveVideo(DB,a.channel,a.job.id,{id:ids[1],views:200,desc:'#b',duration_s:20});await saveVideo(DB,b.channel,b.job.id,{id:ids[2],views:900,desc:'#c',duration_s:30});await saveComment(DB,a.job.id,ids[0],{cid:'1234567890123456789',text:'Preservar',digg_count:3});
  let data=(await req('/api/data?channel_id=all')).data;assert.equal(data.total,3);assert.equal(data.records.reduce((s,r)=>s+r.views,0)/data.total,400);assert.equal(data.records[2].channel_handle,'canal_b');
  const page=await channelData(DB,'all',1,1);assert.equal(page.records.length,1);assert.deepEqual(page.records[0].tags,['#b']);assert.equal(page.next_offset,2);
  assert.equal((await req('/api/manage/video/'+ids[0],{})).status,400);
  await req('/api/manage/video/'+ids[0],{confirm:ids[0]});assert.equal((await req('/api/data?channel_id=all')).data.total,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM comments').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM video_snapshots').get().n,3);assert.equal(db.prepare('SELECT status FROM crawl_jobs WHERE id=?').get(a.job.id).status,'cancelled');
  await req('/api/manage/channel/'+a.channel.id,{confirm:a.channel.id});assert.equal((await req('/api/channels')).data.channels.length,1);assert.equal((await req('/api/data?channel_id=all')).data.total,1);assert.equal((await req('/api/jobs/'+a.job.id+'/resume',{})).status,409);
  assert.equal((await req('/api/manage/video/'+ids[0]+'/restore',{})).status,409);
  await req('/api/manage/channel/'+a.channel.id+'/restore',{});assert.equal((await req('/api/data?channel_id=all')).data.total,2);assert.equal((await req('/api/trash')).data.items.length,1);
  await req('/api/manage/video/'+ids[0]+'/restore',{});assert.equal((await req('/api/data?channel_id=all')).data.total,3);assert.equal(db.prepare('SELECT status FROM crawl_jobs WHERE id=?').get(a.job.id).status,'cancelled');
  const schema=(await req('/api/sql/schema')).data.objects;assert.ok(schema.find(t=>t.name==='videos').foreign_keys.some(f=>f.table==='channels'));assert.equal(schema.find(t=>t.name==='active_video_metrics').count,3);
  const second=openDatabase(server.databasePath,fs.readFileSync(new URL('../runtime/schema.sql',import.meta.url),'utf8'));assert.equal(second.db.prepare('PRAGMA user_version').get().user_version,1);second.db.close();
 }finally{await server.close();fs.rmSync(dir,{force:true,recursive:true});}
});
test('regressão simples e múltipla recuperam coeficientes conhecidos, rejeitam redundância e tratam ausência e Y constante',()=>{
 const x=Array.from({length:20},(_,i)=>[i]),y=x.map(([v])=>3+2*v),m=regression(x,y);assert.ok(Math.abs(m.intercept-3)<1e-9);assert.ok(Math.abs(m.coefficients[0]-2)<1e-9);assert.equal(m.r2,1);
 const X=Array.from({length:40},(_,i)=>[i,Math.sin(i)]),Y=X.map(([a,b])=>7+4*a-2*b),mm=regression(X,Y);assert.ok(Math.abs(mm.intercept-7)<1e-9);assert.ok(Math.abs(mm.coefficients[1]+2)<1e-9);assert.ok(mm.rmse<1e-9);
 assert.throws(()=>regression(x.map(([v])=>[v,2*v]),y),/redundantes/);assert.throws(()=>regression([[1],[1],[1]],[1,2,3]),/constante/);assert.throws(()=>regression([[1],[2]],[3,5]),/mais vídeos/);
 assert.equal(regression(x,Array(20).fill(8)).r2,null);assert.deepEqual(correlation([[1,2],[2,4],[null,7]]),{n:2,r:1});assert.equal(correlation([[1,2],[1,3]]).r,null);
});
