import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {startLocalServer} from '../server/local-server.mjs';import {d1} from '../runtime/local-db.mjs';import {saveVideo,saveComment} from '../runtime/repository.mjs';import {exportCsv,csvCell} from '../server/csv-worker.mjs';

test('CSV completo conserva IDs, Unicode, aspas, NULL, texto vazio, relações e mais de 1000 linhas',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rtr-csv-')),server=await startLocalServer({dataDir:dir});
 try{
  const registered=await(await fetch(server.origin+'/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'@csv_teste',provider:'browser'})})).json();
  const DB=d1(server.db),id='7708005068741594386';await saveVideo(DB,registered.channel,registered.job.id,{id,desc:'vídeo, "ação"\nsegunda linha #teste',views:0,likes:null,duration_s:12.5});await saveComment(DB,registered.job.id,id,{cid:'9876543210987654321',text:''});
  server.db.prepare('UPDATE videos SET title=?,description=? WHERE id=?').run('vídeo, "ação"\nsegunda linha','',id);
  const insert=server.db.prepare('INSERT INTO videos(id,channel_id,canonical_url,first_seen_at,last_seen_at) VALUES(?,?,?,?,?)');server.db.exec('BEGIN');for(let i=0;i<1005;i++)insert.run(String(7708005068741600000n+BigInt(i)),registered.channel.id,'https://www.tiktok.com/@csv_teste/video/'+i,'2026-01-01','2026-01-01');server.db.exec('COMMIT');
  server.db.prepare('UPDATE crawl_jobs SET lock_token=? WHERE id=?').run('secret-lease',registered.job.id);
  const out=path.join(dir,'manual'),m=exportCsv(server.databasePath,out);assert.equal(m.datasets.length,15);assert.equal(m.datasets.find(d=>d.name==='videos').rows,1006);assert.equal(m.datasets.find(d=>d.name==='active_video_metrics').rows,1006);
  const raw=fs.readFileSync(path.join(out,'videos.csv'),'utf8');assert.match(raw,/"7708005068741594386"/);assert.match(raw,/"vídeo, ""ação""\nsegunda linha"/);assert.match(raw,/"",/);assert.ok(raw.includes(m.null_value));
  assert.equal(m.datasets.find(d=>d.name==='videos').columns.find(c=>c.name==='id').pandas_dtype,'string');
  assert.ok(m.datasets.find(d=>d.name==='videos').foreign_keys.some(f=>f.table==='channels'));
  const jobs=fs.readFileSync(path.join(out,'crawl_jobs.csv'),'utf8');assert.ok(!jobs.includes('lock_token'));assert.ok(!jobs.includes('secret-lease'));
  assert.match(fs.readFileSync(path.join(out,'comments.csv'),'utf8'),/"9876543210987654321"/);
  assert.equal(fs.readFileSync(path.join(out,'hashtags.csv'),'utf8'),fs.readFileSync(path.join(out,m.datasets.find(d=>d.name==='hashtags').path),'utf8'));
  assert.equal(csvCell('a,"b"\nç','NULL'),'"a,""b""\nç"');assert.equal(csvCell(null,'NULL'),'NULL');assert.equal(csvCell('','NULL'),'""');assert.throws(()=>csvCell('NULL','NULL'),/colidiu/);
 }finally{await server.close();fs.rmSync(dir,{force:true,recursive:true});}
});

test('arquivos são atualizados por API e por edição externa, com download completo e snapshots consistentes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rtr-auto-csv-')),server=await startLocalServer({dataDir:dir});
 const request=async(route,body)=>{const r=await fetch(server.origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json()};};
 const waitFor=async predicate=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const {data}=await request('/api/exports/status');if(data.error)throw Error(data.error);if(predicate(data))return data;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('CSV não atualizou no prazo.');};
 try{
  const first=await waitFor(s=>s.manifest&&!s.pending&&!s.running);assert.equal(first.manifest.datasets.find(d=>d.name==='channels').rows,0);
  const registered=(await request('/api/channels',{url:'@automatico',provider:'browser'})).data;
  await saveVideo(d1(server.db),registered.channel,registered.job.id,{id:'7708005068741594386',views:123});
  const second=await waitFor(s=>s.manifest?.generation!==first.manifest.generation&&s.manifest?.datasets.find(d=>d.name==='channels').rows===1&&s.manifest?.datasets.find(d=>d.name==='active_video_metrics').rows===1);
  const external=new DatabaseSync(server.databasePath);external.prepare('UPDATE channels SET display_name=? WHERE id=?').run('Mudança externa ç',registered.channel.id);external.close();
  const third=await waitFor(s=>s.manifest?.generation!==second.manifest.generation&&fs.readFileSync(path.join(dir,'exports','channels.csv'),'utf8').includes('Mudança externa ç'));
  const res=await fetch(server.origin+'/api/exports/file?name=channels.csv&generation='+third.manifest.generation);assert.equal(res.status,200);assert.match(await res.text(),/Mudança externa ç/);assert.match(res.headers.get('content-disposition'),/attachment/);
  assert.equal((await fetch(server.origin+'/api/exports/file?name=..%2F..%2Frtr.sqlite')).status,404);
  assert.ok(fs.existsSync(path.join(dir,'exports',first.manifest.datasets[0].path)));
  await request('/api/manage/channel/'+registered.channel.id,{confirm:registered.channel.id});
  const fourth=await waitFor(s=>s.manifest?.generation!==third.manifest.generation&&s.manifest?.datasets.find(d=>d.name==='active_video_metrics').rows===0&&s.manifest?.datasets.find(d=>d.name==='video_metrics').rows===1);
  assert.ok(fourth.manifest.includes_trash);const m=JSON.parse(fs.readFileSync(path.join(dir,'exports','latest.json'),'utf8'));assert.equal(m.generation,fourth.manifest.generation);
 }finally{await server.close();fs.rmSync(dir,{force:true,recursive:true});}
});
