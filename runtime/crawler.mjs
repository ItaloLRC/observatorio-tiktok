import {now,uid,parseLossless,extractState,extractProfile,sourceGet,SourceError} from './lib.mjs';
import {sql,rows,enqueue,event,saveVideo,saveComment,saveProfile} from './repository.mjs';
const active=['queued','running'];
export async function createJob(db,channelId,{include_comments=true,provider='public'}={},env={}){
 const channel=await sql(db,'SELECT * FROM channels WHERE id=?',channelId).first();if(!channel)throw new Error('Canal não encontrado.');
 if(!['public','research','browser'].includes(provider))throw new Error('Fonte inválida.');
 if(provider==='research'&&!env.TIKTOK_RESEARCH_TOKEN)throw new Error('A API oficial precisa de um token de pesquisa aprovado, configurado no servidor.');
 const existing=await sql(db,"SELECT * FROM crawl_jobs WHERE channel_id=? AND status IN ('queued','running')",channelId).first();if(existing)return {job:existing,duplicate:true};
 const id=uid(),t=now();
 try{await sql(db,"INSERT INTO crawl_jobs(id,channel_id,provider,status,created_at,updated_at,include_comments,message) VALUES(?,?,?,'queued',?,?,?,?)",id,channelId,provider,t,t,include_comments?1:0,'Na fila; aguardando a fonte de dados.').run();}catch(error){const duplicate=await sql(db,"SELECT * FROM crawl_jobs WHERE channel_id=? AND status IN ('queued','running')",channelId).first();if(duplicate)return {job:duplicate,duplicate:true};throw error;}
 if(provider==='research'){const end=new Date();const begin=new Date(+end-29*864e5);await enqueue(db,id,'research_videos',begin.toISOString().slice(0,10), '0',{start:begin.toISOString().slice(0,10),end:end.toISOString().slice(0,10)});}else if(provider==='public')await enqueue(db,id,'profile');
 await event(db,id,'job_created','Coleta criada. O histórico é percorrido até esgotar a paginação da fonte. Campos não expostos ficam nulos.');return {job:await sql(db,'SELECT * FROM crawl_jobs WHERE id=?',id).first(),duplicate:false};
}
function pagination(data){const more=data.hasMore??data.has_more;const cursor=data.cursor??data.maxCursor??data.max_cursor; if(more!==false&&more!==0&&more!==true&&more!==1)throw new SourceError('A fonte não confirmou o fim da paginação. A cobertura não será marcada como completa.','pagination_unknown');return {more:more===true||more===1,cursor:cursor==null?null:String(cursor)};}
async function jsonSource(url,options,fetcher){const text=await sourceGet(url,options,fetcher);try{return parseLossless(text);}catch(e){if(e instanceof SourceError)throw e;throw new SourceError('A fonte não retornou JSON válido. Pode ser necessário um navegador ou acesso autorizado.','invalid_source_response');}}
async function queueVideo(db,channel,job,raw,fetcher){
 const v=await saveVideo(db,channel,job.id,raw,job.provider==='research'?'tiktok_research':'public_web');
 if(job.include_comments)await enqueue(db,job.id,job.provider==='research'?'research_comments':'comments',v.id);
 if(job.provider==='public'&&(v.duration_seconds==null||v.views==null||v.likes==null))await enqueue(db,job.id,'detail',v.id);
 return v;
}
async function processTask(db,channel,job,task,env,fetcher){
 const payload=JSON.parse(task.payload_json);
 if(task.kind==='profile'){
  const html=await sourceGet(channel.canonical_url,{},fetcher),profile=extractProfile(extractState(html),channel.handle);
  if(!profile.user&&!profile.posts.length)throw new SourceError('O perfil não expôs metadados públicos legíveis. Pode ser privado, inexistente ou bloqueado para coleta.','profile_unavailable');
  await saveProfile(db,channel,job.id,profile.user,profile.stats);
  for(const post of profile.posts)await queueVideo(db,channel,job,post,fetcher);
  const secUid=profile.user?.secUid;if(!secUid){await event(db,job.id,'pagination_unavailable','A página inicial foi salva, mas não foi possível obter a chave pública de paginação.','warning');throw new SourceError('A fonte não disponibilizou paginação do perfil.','pagination_unavailable');}
  await enqueue(db,job.id,'videos_page',secUid,'0');
  await event(db,job.id,'profile_saved',`${profile.posts.length} vídeos encontrados na página inicial. A paginação continua para buscar o restante.`);
 }else if(task.kind==='videos_page'){
  const url=new URL('https://www.tiktok.com/api/post/item_list/');url.search=new URLSearchParams({aid:'1988',secUid:task.target_id,cursor:task.cursor,count:'30'});
  const data=await jsonSource(url.toString(),{},fetcher);if(data.statusCode&&Number(data.statusCode)!==0)throw new SourceError('O TikTok não autorizou a listagem paginada.','video_page_blocked');
  const list=data.itemList??data.item_list;if(!Array.isArray(list))throw new SourceError('Listagem de vídeos ausente na resposta.','video_page_blocked');
  for(const post of list)await queueVideo(db,channel,job,post,fetcher);
  const p=pagination(data);if(p.more){if(!p.cursor||p.cursor===task.cursor)throw new SourceError('A fonte repetiu o cursor; a paginação foi interrompida para evitar um loop.','cursor_repeated');const seen=await sql(db,'SELECT id FROM crawl_tasks WHERE job_id=? AND kind=? AND target_id=? AND cursor=?',job.id,task.kind,task.target_id,p.cursor).first();if(seen)throw new SourceError('O cursor já foi processado; cobertura não confirmada.','cursor_repeated');await enqueue(db,job.id,task.kind,task.target_id,p.cursor);}else await sql(db,'UPDATE crawl_jobs SET videos_complete=1 WHERE id=?',job.id).run();
 }else if(task.kind==='detail'){
  const html=await sourceGet(`${channel.canonical_url}/video/${task.target_id}`,{},fetcher),profile=extractProfile(extractState(html),channel.handle),video=profile.posts.find(v=>String(v.id)===task.target_id);if(!video)throw new SourceError('Detalhes do vídeo não foram expostos pela fonte.','video_detail_unavailable');await saveVideo(db,channel,job.id,video,'public_web');
 }else if(task.kind==='comments'||task.kind==='replies'){
  const replies=task.kind==='replies',url=new URL('https://www.tiktok.com/api/comment/list/'+(replies?'reply/':''));
  url.search=new URLSearchParams(replies?{aid:'1988',item_id:payload.video_id,comment_id:task.target_id,cursor:task.cursor,count:'50'}:{aid:'1988',aweme_id:task.target_id,cursor:task.cursor,count:'50'});
  const data=await jsonSource(url.toString(),{},fetcher);if(!Array.isArray(data.comments)||Number(data.status_code??data.statusCode??0)!==0)throw new SourceError('O TikTok não disponibilizou os comentários nesta fonte.','comments_unavailable');
  for(const raw of data.comments){const c=await saveComment(db,job.id,replies?payload.video_id:task.target_id,raw,replies?task.target_id:null);if(!replies&&c.reply_count>0)await enqueue(db,job.id,'replies',c.id,'0',{video_id:task.target_id});}
  const p=pagination(data);if(p.more){if(!p.cursor||p.cursor===task.cursor)throw new SourceError('Cursor de comentários repetido.','cursor_repeated');const exists=await sql(db,'SELECT id FROM crawl_tasks WHERE job_id=? AND kind=? AND target_id=? AND cursor=?',job.id,task.kind,task.target_id,p.cursor).first();if(exists)throw new SourceError('Cursor de comentários já visitado.','cursor_repeated');await enqueue(db,job.id,task.kind,task.target_id,p.cursor,payload);}
 }else if(task.kind.startsWith('research')){
  if(!env.TIKTOK_RESEARCH_TOKEN)throw new SourceError('Token da API de pesquisa ausente.','research_token_missing');
  const headers={Authorization:'Bearer '+env.TIKTOK_RESEARCH_TOKEN,'Content-Type':'application/json'};
  if(task.kind==='research_videos'){
   const fields='id,video_description,create_time,username,region_code,share_count,view_count,like_count,comment_count,music_id,hashtag_names,favorites_count,video_duration';
   const body={query:{and:[{operation:'EQ',field_name:'username',field_values:[channel.handle]}]},start_date:payload.start.replaceAll('-',''),end_date:payload.end.replaceAll('-',''),max_count:100,cursor:Number(task.cursor),...(payload.search_id?{search_id:payload.search_id}:{})};
   const result=await jsonSource('https://open.tiktokapis.com/v2/research/video/query/?fields='+fields,{method:'POST',headers,body:JSON.stringify(body)},fetcher);
   if(result.error?.code&&result.error.code!=='ok')throw new SourceError('A API oficial rejeitou a consulta: '+result.error.code,'research_api_error',result.error.code==='rate_limit_exceeded');
   const data=result.data;if(!Array.isArray(data?.videos))throw new SourceError('Resposta oficial sem lista de vídeos.','research_api_error');
   for(const raw of data.videos)await queueVideo(db,channel,job,raw,fetcher);
   const p=pagination(data);
   if(p.more){if(!p.cursor||p.cursor===task.cursor)throw new SourceError('Cursor oficial repetido.','cursor_repeated');const seen=await sql(db,'SELECT id FROM crawl_tasks WHERE job_id=? AND kind=? AND target_id=? AND cursor=?',job.id,task.kind,task.target_id,p.cursor).first();if(seen)throw new SourceError('Cursor oficial já visitado.','cursor_repeated');await enqueue(db,job.id,'research_videos',task.target_id,p.cursor,{...payload,search_id:data.search_id??payload.search_id});}
   else {const end=new Date(Date.parse(payload.start+'T00:00:00Z')-864e5);if(end>=new Date('2016-01-01T00:00:00Z')){const start=new Date(Math.max(Date.parse('2016-01-01T00:00:00Z'),+end-29*864e5));const next={start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};await enqueue(db,job.id,'research_videos',next.start,'0',next);}else await sql(db,'UPDATE crawl_jobs SET videos_complete=1 WHERE id=?',job.id).run();}
  }else{
   const reply=task.kind==='research_replies',video=reply?payload.video_id:task.target_id;
   const body={...(reply?{comment_id:task.target_id}:{video_id:task.target_id}),max_count:100,cursor:Number(task.cursor)};
   const result=await jsonSource('https://open.tiktokapis.com/v2/research/video/comment/list/?fields=id,video_id,text,like_count,reply_count,parent_comment_id,create_time',{method:'POST',headers,body:JSON.stringify(body)},fetcher);
   if(result.error?.code&&result.error.code!=='ok')throw new SourceError('A API oficial rejeitou os comentários: '+result.error.code,'research_api_error');
   if(!Array.isArray(result.data?.comments))throw new SourceError('Comentários ausentes na resposta oficial.','comments_unavailable');
   for(const raw of result.data.comments){const c=await saveComment(db,job.id,video,raw,reply?task.target_id:null);if(!reply&&c.reply_count>0)await enqueue(db,job.id,'research_replies',c.id,'0',{video_id:video});}
   const p=pagination(result.data);if(p.more){if(!p.cursor||p.cursor===task.cursor)throw new SourceError('Cursor oficial de comentários repetido.','cursor_repeated');await enqueue(db,job.id,task.kind,task.target_id,p.cursor,payload);}
  }
 }else throw new Error('Tipo de tarefa desconhecido.');
}
export async function processJob(db,jobId,env={},fetcher=fetch){
 const type=await sql(db,'SELECT provider FROM crawl_jobs WHERE id=?',jobId).first();if(type?.provider==='browser')return {waiting_for_browser:true};
 const token=uid(),t=now(),lease=new Date(Date.now()+90000).toISOString();
 const job=await sql(db,"UPDATE crawl_jobs SET status='running',lock_token=?,lock_until=?,updated_at=? WHERE id=? AND status IN ('queued','running') AND (lock_until IS NULL OR lock_until<?) RETURNING *",token,lease,t,jobId,t).first();if(!job)return {busy:true};
 try{
  const channel=await sql(db,'SELECT * FROM channels WHERE id=?',job.channel_id).first();
  const task=await sql(db,"SELECT * FROM crawl_tasks WHERE job_id=? AND status='pending' AND (retry_at IS NULL OR retry_at<=?) ORDER BY CASE WHEN kind IN ('videos_page','research_videos') THEN 0 WHEN kind='profile' THEN 0 WHEN kind='detail' THEN 1 ELSE 2 END,rowid LIMIT 1",jobId,now()).first();
  if(task){await sql(db,'UPDATE crawl_tasks SET attempts=attempts+1 WHERE id=?',task.id).run();
   try{await processTask(db,channel,job,task,env,fetcher);await sql(db,"UPDATE crawl_tasks SET status='done',completed_at=?,error=NULL WHERE id=?",now(),task.id).run();}
   catch(error){const message=String(error.message||error).slice(0,2000);if((error.retryable||error.name==='TimeoutError'||error.name==='AbortError'||error instanceof TypeError)&&task.attempts<2){await sql(db,'UPDATE crawl_tasks SET retry_at=?,error=? WHERE id=?',new Date(Date.now()+5000*2**task.attempts).toISOString(),message,task.id).run();await event(db,jobId,'retry_scheduled',message,'warning');}
    else{await sql(db,"UPDATE crawl_tasks SET status='failed',completed_at=?,error=? WHERE id=?",now(),message,task.id).run();await event(db,jobId,error.code||'task_error',message,'warning');
     if(['verification_required','comments_unavailable','invalid_source_response','source_blocked'].includes(error.code)&&['comments','replies'].includes(task.kind)){await sql(db,"UPDATE crawl_tasks SET status='failed',error=?,completed_at=? WHERE job_id=? AND status='pending' AND kind IN ('comments','replies')",'Fonte de comentários indisponível; chamadas restantes suspensas.',now(),jobId).run();}
     if(task.kind==='profile'&&!await sql(db,'SELECT id FROM video_snapshots WHERE job_id=? LIMIT 1',jobId).first())await sql(db,"UPDATE crawl_jobs SET status='blocked',message=?,finished_at=? WHERE id=?",message,now(),jobId).run();
    }
   }
  }
  const counts=await sql(db,"SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done FROM crawl_tasks WHERE job_id=?",jobId).first();
  await sql(db,'UPDATE crawl_jobs SET discovered_videos=(SELECT COUNT(*) FROM video_snapshots WHERE job_id=?),saved_comments=(SELECT COUNT(*) FROM comment_snapshots WHERE job_id=?),processed_tasks=?,updated_at=? WHERE id=?',jobId,jobId,counts.done||0,now(),jobId).run();
  const current=await sql(db,'SELECT * FROM crawl_jobs WHERE id=?',jobId).first();
  if(!counts.pending&&active.includes(current.status)){
   const complete=!!current.videos_complete&&!counts.failed,status=complete?'completed':current.discovered_videos?'partial':'blocked',commentsComplete=complete&&current.include_comments?1:0;
   await db.batch([sql(db,'UPDATE crawl_jobs SET status=?,comments_complete=?,finished_at=?,message=?,updated_at=? WHERE id=?',status,commentsComplete,now(),complete?'Paginação da fonte esgotada. Cobertura limitada ao conteúdo público que ela disponibiliza.':'Coleta parcial ou bloqueada. Consulte os eventos para ver o que a fonte não disponibilizou.',now(),jobId),sql(db,'UPDATE channels SET last_crawled_at=?,coverage=?,updated_at=? WHERE id=?',now(),complete?'source_exhausted':'partial',now(),channel.id)]);
   await event(db,jobId,'job_finished',complete?'Fim da paginação pública da fonte.':'A fonte não permitiu confirmar uma coleta completa.',complete?'info':'warning');
  }
  return {job:await sql(db,'SELECT * FROM crawl_jobs WHERE id=?',jobId).first()};
 }finally{await sql(db,'UPDATE crawl_jobs SET lock_token=NULL,lock_until=NULL WHERE id=? AND lock_token=?',jobId,token).run();}
}
