import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startLocalServer} from '../server/local-server.mjs';

test('coleta local sem autenticação: cadastro, métricas, comentários, duplicação, exportação e reabertura',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'rtr-local-test-'));
 let server=await startLocalServer({dataDir});
 try{
  const request=async(route,body,lease)=>{
   const r=await fetch(server.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(lease?{'X-RTR-Lease':lease}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   assert.equal(r.status<400,true,await r.clone().text());return r.json();
  };
  const page=await fetch(server.origin);
  assert.equal(page.status,200);
  const markup=await page.text();
  assert.match(markup,/<title>Observatório TikTok<\/title>/);
  assert.doesNotMatch(markup,/@historiasdertr/);
  const method=await fetch(server.origin+'/metodologia.md');
  assert.equal(method.status,200);
  assert.match(await method.text(),/^# Metodologia de análise/);
  const redirect=await fetch(server.origin+'/coletor-local.html');
  assert.equal(redirect.status,200);
  assert.match(await redirect.text(),/url=\/#coletor/);
  assert.equal((await request('/api/local')).authentication,false);
  assert.equal((await request('/api/status')).counts.channels,0);
  const created=await request('/api/channels',{url:'https://www.tiktok.com/@example',provider:'browser',include_comments:true});
  const id=created.job.id,channel=created.channel;
  const duplicate=await request('/api/channels',{url:'https://www.tiktok.com/@EXAMPLE/?lang=pt',provider:'browser'});
  assert.equal(duplicate.skipped,true);assert.equal((await request('/api/jobs')).jobs.length,1);
  const start=await request('/api/jobs/'+id+'/browser-start',{});
  const batch={videos:[{id:'7708005068741594399',desc:'Teste local #historia #teste',createTime:1794643200,video:{duration:120},stats:{playCount:1000,diggCount:100,commentCount:1,shareCount:2}}],comments:[{video_id:'7708005068741594399',raw:{cid:'7708005068741594400',text:'Comentário de teste',digg_count:0,reply_comment_total:0}}],processed_video:'7708005068741594399',comments_complete:true};
  await request('/api/jobs/'+id+'/browser-batch',batch,start.lease);
  await request('/api/jobs/'+id+'/browser-batch',batch,start.lease);
  const end=await request('/api/jobs/'+id+'/browser-finish',{videos_complete:false,comments_complete:true},start.lease);assert.equal(end.status,'partial');
  const data=await request('/api/data?channel_id='+channel.id);assert.equal(data.records.length,1);assert.equal(data.records[0].views,1000);assert.equal(data.records[0].like_view_pct,10);assert.equal(data.records[0].reposts,null);
  const exported=await request('/api/export');assert.equal(exported.tables.comments.length,1);assert.equal(exported.tables.video_snapshots.length,1);assert.equal(exported.tables.comments[0].id,'7708005068741594400');assert.equal(exported.tables.comment_snapshots[0].likes,0);assert.equal('lock_token' in exported.tables.crawl_jobs[0],false);
  const foreign=await fetch(server.origin+'/api/channels',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'});assert.equal(foreign.status,403);
  const badHost=await new Promise((resolve,reject)=>{http.get(server.origin,{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);});assert.equal(badHost,403);
  await server.close();server=await startLocalServer({dataDir});assert.equal((await request('/api/status')).counts.videos,1);assert.equal((await request('/api/status')).counts.comments,1);
 }finally{await server.close();fs.rmSync(dataDir,{recursive:true,force:true});}
});
