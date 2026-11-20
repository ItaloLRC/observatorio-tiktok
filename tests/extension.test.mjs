import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {startLocalServer} from '../server/local-server.mjs';
import {localOrigin,profileUrl,videoUrl,jobRoute} from '../extension/protocol.mjs';

test('extensão preserva IDs longos e combina tags mesmo com textExtra vazio',()=>{
 const context=vm.createContext({crypto});vm.runInContext(fs.readFileSync(new URL('../extension/core.js',import.meta.url),'utf8')+'\nthis.core=RTRCore;',context);
 const raw=context.core.parseLossless('{"id":7708005068741594386,"desc":"#bíblia #fé","textExtra":[]}');
 assert.equal(raw.id,'7708005068741594386');assert.equal(JSON.stringify(context.core.extractHashtags(raw)),JSON.stringify(['bíblia','fé']));
});
test('ponte recusa servidor externo, rotas arbitrárias e URLs de vídeo inválidas',()=>{
 assert.equal(localOrigin('http://127.0.0.1:8766'),'http://127.0.0.1:8766');
 assert.throws(()=>localOrigin('https://evil.example'));assert.throws(()=>localOrigin('http://user:secret@localhost'));
 assert.throws(()=>jobRoute('/api/export'));assert.throws(()=>videoUrl('example','../bad'));
 assert.equal(profileUrl('Example'),'https://www.tiktok.com/@example');
});
test('fila → extensão na mesma sessão → vídeos e comentários no SQLite, sem outro processo de navegador',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'rtr-extension-')),server=await startLocalServer({dataDir});
 let listener,stored={},created=0,removedListener;const tabs=new Map([[1,{id:1,url:server.origin}],[2,{id:2,url:'https://www.tiktok.com/@example'}]]),navigations=[],tasks=[];
 const request=async(route,method='GET',body,lease)=>{const r=await fetch(server.origin+route,{method,headers:{'Content-Type':'application/json',...(lease?{'X-RTR-Lease':lease}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
 globalThis.chrome={runtime:{id:'test-extension',onMessage:{addListener(fn){listener=fn;}}},storage:{session:{async get(){return structuredClone(stored);},async set(value){stored={...stored,...structuredClone(value)};}}},tabs:{async query(){return [tabs.get(2)];},async create(){created++;throw new Error('Não deve abrir outra aba neste teste.');},async get(id){return tabs.get(id);},async update(id,data){tabs.set(id,{...tabs.get(id),...data});navigations.push(data.url);},async reload(id){navigations.push(tabs.get(id).url);},async sendMessage(id,m){if(id===1){try{return {data:await request(m.route,m.method,m.body,m.lease)};}catch(e){return {error:e.message};}}tasks.push(m);return {accepted:true};},onRemoved:{addListener(fn){removedListener=fn;}}}};
 const rpc=(message,tab=1)=>new Promise((resolve,reject)=>listener(message,{id:'test-extension',tab:tabs.get(tab)},reply=>reply.error?reject(new Error(reply.error)):resolve(reply.data)));
 try{
  await import('../extension/background.mjs?test='+crypto.randomUUID());
  const {channel,job}=await request('/api/channels','POST',{url:profileUrl('example'),provider:'browser',include_comments:true});
  assert.equal((await rpc({type:'RTR_CONNECT',origin:server.origin})).active,false);
  await rpc({type:'RTR_START',jobId:job.id});assert.equal(created,0);
  await rpc({type:'RTR_SOURCE_READY'},2);assert.equal(tasks.at(-1).phase,'profile');
  const source=(suffix,body)=>rpc({type:'RTR_SOURCE_API',jobId:job.id,route:'/api/jobs/'+job.id+'/browser-'+suffix,method:body===undefined?'GET':'POST',body},2);
  const video={id:'7708005068741594386',desc:'Teste #bíblia #fé',textExtra:[],video:{duration:120},stats:{playCount:1000,diggCount:50,commentCount:1}};
  await source('batch',{profile:{user:{uniqueId:'example'},stats:{videoCount:1}},videos:[video]});
  const beforeNavigation=navigations.length,realNow=Date.now;
  await rpc({type:'RTR_PROFILE_DONE',jobId:job.id,complete:true,expected:1},2);assert.equal(navigations.length,beforeNavigation);assert.ok(stored.rtr.active.pending.dueAt-realNow()>=29000);
  try{Date.now=()=>realNow()+31000;await rpc({type:'RTR_CONNECT',origin:server.origin});}finally{Date.now=realNow;}
  assert.equal(navigations.at(-1),videoUrl('example',video.id));
  await rpc({type:'RTR_SOURCE_READY'},2);assert.equal(tasks.at(-1).phase,'video');
  await source('batch',{comments:[{video_id:video.id,raw:{cid:'7708005068741594400',text:'Exemplo de teste',digg_count:3,reply_comment_total:0}}],processed_video:video.id,comments_complete:true});
  await assert.rejects(()=>rpc({type:'RTR_SOURCE_API',jobId:job.id,route:'/api/export'},2));
  await rpc({type:'RTR_VIDEO_DONE',jobId:job.id,videoId:video.id,commentsComplete:true},2);
  const list=await request('/api/jobs');assert.equal(list.jobs[0].status,'completed');assert.equal(list.jobs[0].saved_comments,1);
  const data=await request('/api/data?channel_id='+channel.id);assert.equal(data.records.length,1);assert.deepEqual(data.records[0].tags.sort(),['#bíblia','#fé']);assert.equal((await rpc({type:'RTR_CONNECT',origin:server.origin})).active,false);
  const second=await request('/api/jobs','POST',{channel_id:channel.id,provider:'browser',include_comments:false});
  await rpc({type:'RTR_START',jobId:second.job.id});
  await rpc({type:'RTR_SOURCE_API',jobId:second.job.id,route:'/api/jobs/'+second.job.id+'/browser-batch',method:'POST',body:{videos:[video]}},2);
  await rpc({type:'RTR_PROFILE_DONE',jobId:second.job.id,complete:true,expected:1},2);
  const beforeStop=navigations.length;await rpc({type:'RTR_STOP'});assert.equal(stored.rtr.active,null);assert.equal(tasks.at(-1).type,'RTR_STOP');
  try{Date.now=()=>realNow()+60000;await rpc({type:'RTR_CONNECT',origin:server.origin});}finally{Date.now=realNow;}
  assert.equal(navigations.length,beforeStop,'não navega após interromper uma espera');assert.equal((await request('/api/jobs')).jobs.find(j=>j.id===second.job.id).status,'cancelled');assert.equal((await request('/api/data?channel_id='+channel.id)).records.length,1);
 }finally{await server.close();fs.rmSync(dataDir,{recursive:true,force:true});delete globalThis.chrome;}
});
