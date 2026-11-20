import {ASSETS} from './assets.mjs';
import {now,uid,normalizeChannel} from './lib.mjs';
import {sql,rows,registerChannel,bootstrap,channelData,event,saveVideo,saveComment,saveProfile,enqueue} from './repository.mjs';
import {createJob,processJob} from './crawler.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const limit=(v,max=100)=>Math.min(max,Math.max(1,Number(v)||50));
async function body(request,max=20000){const text=await request.text();if(text.length>max)throw new Error('Requisição muito grande.');try{return JSON.parse(text||'{}');}catch{throw new Error('JSON inválido.');}}
async function api(request,env,ctx,url){
 const db=env.DB;if(!db)return json({error:'O banco de dados ainda não está conectado.'},503);
 if(!['GET','HEAD'].includes(request.method)){const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({error:'Origem não autorizada.'},403);if(request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Requisição externa não autorizada.'},403);}
 const p=url.pathname,method=request.method;
 if(p==='/api/bootstrap'&&method==='POST')return json(await bootstrap(db,{records:[]}));
 if(p==='/api/status'&&method==='GET'){
  const counts=await sql(db,`SELECT (SELECT COUNT(*) FROM channels) channels,(SELECT COUNT(*) FROM videos) videos,(SELECT COUNT(*) FROM video_snapshots) snapshots,(SELECT COUNT(*) FROM comments WHERE raw_json IS NOT NULL) comments,(SELECT COUNT(*) FROM hashtags) hashtags,(SELECT COUNT(*) FROM crawl_jobs) jobs,(SELECT COUNT(*) FROM comment_snapshots) comment_snapshots`).first();
  return json({counts,providers:{public:{available:true,label:'Web pública'},browser:{available:true,label:'Navegador local · sem API paga'},research:{available:!!env.TIKTOK_RESEARCH_TOKEN,label:'API oficial de pesquisa'}},storage:'Cloudflare D1 / SQLite',timezone:'America/Sao_Paulo',execution:'resumable',limitations:['reposts_only_if_source_exposes','public_access_only','comments_may_require_authorized_source']});
 }
 if(p==='/api/channels'&&method==='GET')return json({channels:await rows(db,`SELECT c.*,(SELECT COUNT(*) FROM videos v WHERE v.channel_id=c.id AND v.deleted_at IS NULL) video_count,(SELECT cs.video_count FROM channel_snapshots cs WHERE cs.channel_id=c.id AND cs.video_count IS NOT NULL ORDER BY cs.captured_at DESC,cs.rowid DESC LIMIT 1) public_video_count,(SELECT COUNT(*) FROM comments cm JOIN videos v ON v.id=cm.video_id WHERE v.channel_id=c.id AND cm.raw_json IS NOT NULL) comments_loaded FROM channels c WHERE c.deleted_at IS NULL ORDER BY c.created_at,c.handle`)});
 if(p==='/api/channels'&&method==='POST'){
  const b=await body(request),registered=await registerChannel(db,b.url);
  if(registered.channel.deleted_at)return json({error:'Este canal está na lixeira. Restaure-o em Gerenciar dados.'},409);
  if(registered.duplicate)return json({...registered,skipped:true,message:'Canal já cadastrado. Nenhuma nova coleta foi iniciada.'});
  const result=await createJob(db,registered.channel.id,{provider:b.provider||'public',include_comments:b.include_comments!==false},env);
  ctx.waitUntil(processJob(db,result.job.id,env).catch(()=>{}));return json({...registered,...result,skipped:false},201);
 }
 if(p==='/api/data'&&method==='GET')return json(await channelData(db,url.searchParams.get('channel_id'),Math.max(0,Math.min(1e7,Number(url.searchParams.get('offset'))||0)),1000));
 if(p==='/api/jobs'&&method==='GET'){
  const channel=url.searchParams.get('channel_id');const list=await rows(db,`SELECT j.*,c.handle,(SELECT COUNT(*) FROM crawl_tasks t WHERE t.job_id=j.id AND t.status='pending') pending_tasks,(SELECT COUNT(*) FROM crawl_tasks t WHERE t.job_id=j.id AND t.status='failed') failed_tasks FROM crawl_jobs j JOIN channels c ON c.id=j.channel_id ${channel?'WHERE j.channel_id=?':''} ORDER BY j.created_at DESC LIMIT 100`,...(channel?[channel]:[]));return json({jobs:list});
 }
 if(p==='/api/jobs'&&method==='POST'){
  const b=await body(request),result=await createJob(db,b.channel_id,{provider:b.provider||'public',include_comments:b.include_comments!==false},env);ctx.waitUntil(processJob(db,result.job.id,env).catch(()=>{}));return json(result,result.duplicate?200:201);
 }
 const jobMatch=p.match(/^\/api\/jobs\/([^/]+)\/(advance|events|cancel|resume)$/);
 if(jobMatch){const id=decodeURIComponent(jobMatch[1]),op=jobMatch[2];
  if(op==='events'&&method==='GET')return json({events:await rows(db,'SELECT id,level,code,message,created_at FROM crawl_events WHERE job_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',id),tasks:await rows(db,'SELECT kind,status,COUNT(*) count FROM crawl_tasks WHERE job_id=? GROUP BY kind,status',id)});
  if(op==='advance'&&method==='POST')return json(await processJob(db,id,env));
  if(op==='cancel'&&method==='POST'){await sql(db,"UPDATE crawl_jobs SET status='cancelled',finished_at=?,updated_at=?,lock_token=NULL,lock_until=NULL,message='Coleta interrompida pelo usuário; os dados já salvos foram preservados.' WHERE id=? AND status IN ('queued','running')",now(),now(),id).run();return json({ok:true});}
  if(op==='resume'&&method==='POST'){
   const job=await sql(db,"SELECT * FROM crawl_jobs WHERE id=? AND provider='browser'",id).first();if(!job)return json({error:'Coleta não encontrada.'},404);
   if(job.status==='running'&&job.lock_until&&job.lock_until>now())return json({error:'Interrompa a coleta ativa antes de retomar.'},409);
   if(['completed','imported'].includes(job.status))return json({error:'Use Atualizar para uma nova leitura de uma coleta concluída.'},409);
   const other=await sql(db,"SELECT id FROM crawl_jobs WHERE channel_id=? AND id<>? AND status IN ('queued','running')",job.channel_id,id).first();if(other)return json({error:'Já existe outra coleta ativa neste canal.'},409);
   await sql(db,"UPDATE crawl_jobs SET status='queued',finished_at=NULL,lock_token=NULL,lock_until=NULL,updated_at=?,message='Retomada manual solicitada; dados e tarefas salvos preservados.' WHERE id=?",now(),id).run();await event(db,id,'manual_resume','Retomada solicitada pelo usuário.');return json({ok:true});
  }
 }
 const browserMatch=p.match(/^\/api\/jobs\/([^/]+)\/browser-(start|batch|finish|checkpoint|heartbeat)$/);
 if(browserMatch){const id=decodeURIComponent(browserMatch[1]),op=browserMatch[2],job=await sql(db,"SELECT * FROM crawl_jobs WHERE id=? AND provider='browser'",id).first();if(!job)return json({error:'Coleta de navegador não encontrada.'},404);
  const channel=await sql(db,'SELECT * FROM channels WHERE id=?',job.channel_id).first();
  if(op==='start'&&method==='POST'){const token=uid();const claimed=await sql(db,"UPDATE crawl_jobs SET status='running',lock_token=?,lock_until=?,updated_at=?,message='Navegador conectado; percorrendo conteúdo público.' WHERE id=? AND status IN ('queued','running') AND (lock_until IS NULL OR lock_until<?) RETURNING id",token,new Date(Date.now()+90000).toISOString(),now(),id,now()).first();return claimed?json({lease:token,channel,include_comments:!!job.include_comments}):json({error:'Esta coleta já está em execução ou foi encerrada.'},409);}
  if(!['queued','running'].includes(job.status))return json({error:'Coleta encerrada.'},409);
  if(!job.lock_token||request.headers.get('X-RTR-Lease')!==job.lock_token||job.lock_until<now())return json({error:'Conexão do coletor expirou. Reconecte o navegador.'},409);
  if(op==='checkpoint'&&method==='GET')return json({done:await rows(db,"SELECT target_id FROM crawl_tasks WHERE job_id=? AND kind='browser_video' AND status='done'",id),videos:await rows(db,'SELECT v.id FROM videos v JOIN video_snapshots s ON s.video_id=v.id WHERE s.job_id=? ORDER BY v.published_at,v.id',id)});
  if(op==='heartbeat'&&method==='POST'){await sql(db,'UPDATE crawl_jobs SET lock_until=? WHERE id=?',new Date(Date.now()+90000).toISOString(),id).run();return json({ok:true});}
  if(op==='batch'&&method==='POST'){
   const b=await body(request,2000000);if((b.videos?.length||0)>30||(b.comments?.length||0)>100)throw new Error('Divida a coleta em lotes menores.');
   if(b.discovery){const options={...JSON.parse(job.options_json||'{}'),discovery:b.discovery};await sql(db,'UPDATE crawl_jobs SET options_json=? WHERE id=?',JSON.stringify(options),id).run();}
   if(b.profile)await saveProfile(db,channel,id,b.profile.user,b.profile.stats);
   for(const raw of b.videos||[]){const author=raw.author?.uniqueId??raw.author?.unique_id;if(author&&author.toLowerCase()!==channel.handle)throw new Error('Vídeo de outro canal.');await saveVideo(db,channel,id,raw,'browser_observed',raw._approximate?1:0);}
   for(const item of b.comments||[]){const v=await sql(db,'SELECT channel_id FROM videos WHERE id=?',String(item.video_id)).first();if(!v||v.channel_id!==channel.id)throw new Error('Comentário de um vídeo fora deste canal.');await saveComment(db,id,String(item.video_id),item.raw,item.parent_comment_id||null);}
   if(b.processed_video){await enqueue(db,id,'browser_video',String(b.processed_video));await sql(db,"UPDATE crawl_tasks SET status=?,completed_at=? WHERE job_id=? AND kind='browser_video' AND target_id=?",b.comments_complete?'done':'failed',now(),id,String(b.processed_video)).run();}
   if(b.message){await event(db,id,'browser_progress',String(b.message).slice(0,1000));await sql(db,'UPDATE crawl_jobs SET message=? WHERE id=?',String(b.message).slice(0,1000),id).run();}
   await sql(db,'UPDATE crawl_jobs SET discovered_videos=(SELECT COUNT(*) FROM video_snapshots WHERE job_id=?),saved_comments=(SELECT COUNT(*) FROM comment_snapshots WHERE job_id=?),processed_tasks=(SELECT COUNT(*) FROM crawl_tasks WHERE job_id=? AND kind=?),updated_at=?,lock_until=? WHERE id=?',id,id,id,'browser_video',now(),new Date(Date.now()+90000).toISOString(),id).run();return json({ok:true});
  }
  if(op==='finish'&&method==='POST'){const b=await body(request),complete=b.blocked!==true&&b.videos_complete===true&&(!job.include_comments||b.comments_complete===true);const status=b.blocked===true?'blocked':complete?'completed':'partial';await db.batch([sql(db,'UPDATE crawl_jobs SET status=?,videos_complete=?,comments_complete=?,finished_at=?,updated_at=?,lock_token=NULL,lock_until=NULL,message=? WHERE id=?',status,b.videos_complete===true?1:0,b.comments_complete===true?1:0,now(),now(),String(b.message||'Coleta do navegador encerrada.').slice(0,2000),id),sql(db,'UPDATE channels SET last_crawled_at=?,updated_at=?,coverage=? WHERE id=?',now(),now(),complete?'source_exhausted':'partial',channel.id)]);return json({ok:true,status});}
 }
 const video=p.match(/^\/api\/videos\/(\d+)\/(history|comments)$/);
 if(video&&method==='GET'){
  if(video[2]==='history')return json({history:await rows(db,'SELECT s.*,j.provider,j.status FROM video_snapshots s JOIN crawl_jobs j ON j.id=s.job_id WHERE s.video_id=? ORDER BY s.captured_at DESC,s.rowid DESC LIMIT 100',video[1])});
  const offset=Math.max(0,Math.min(1e6,Number(url.searchParams.get('offset'))||0)),pageSize=limit(url.searchParams.get('limit'));
  const count=await sql(db,'SELECT COUNT(*) total FROM comments WHERE video_id=? AND raw_json IS NOT NULL',video[1]).first();
  const stats=await sql(db,'SELECT COUNT(s.likes) likes_observed,AVG(s.likes) mean_likes,SUM(s.likes) total_likes FROM comments c LEFT JOIN comment_snapshots s ON s.id=(SELECT ss.id FROM comment_snapshots ss WHERE ss.comment_id=c.id ORDER BY ss.captured_at DESC,ss.rowid DESC LIMIT 1) WHERE c.video_id=? AND c.raw_json IS NOT NULL',video[1]).first();
  const comments=await rows(db,'SELECT c.id,c.video_id,c.parent_comment_id,c.author_handle,c.text,c.created_at,s.likes,s.reply_count,s.captured_at FROM comments c LEFT JOIN comment_snapshots s ON s.id=(SELECT ss.id FROM comment_snapshots ss WHERE ss.comment_id=c.id ORDER BY ss.captured_at DESC,ss.rowid DESC LIMIT 1) WHERE c.video_id=? AND c.raw_json IS NOT NULL ORDER BY COALESCE(s.likes,-1) DESC,c.id LIMIT ? OFFSET ?',video[1],pageSize,offset);
  return json({comments,total:count.total,statistics:stats,offset,next_offset:offset+comments.length<count.total?offset+comments.length:null});
 }
 return json({error:'Rota não encontrada.'},404);
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 try{if(url.pathname.startsWith('/api/'))return await api(request,env,ctx,url);
  const key=url.pathname==='/'?'/index.html':url.pathname,asset=ASSETS[key];
  if(!asset)return new Response('Página não encontrada.',{status:404});
  return new Response(request.method==='HEAD'?null:asset.binary?Uint8Array.from(atob(asset.content),c=>c.charCodeAt(0)):asset.content,{headers:{'Content-Type':asset.type,'Cache-Control':key==='/index.html'?'no-store':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
 }catch(error){console.error('RTR request error:',error.message);return json({error:error.message||'Erro ao processar a solicitação.'},/não encontrado/.test(error.message)?404:400);}
}};
