import {localOrigin,jobRoute,profileUrl,videoUrl} from './protocol.mjs';
import {PACE,due} from './policy.mjs';
let starting=false,operations=Promise.resolve();
async function state(){return (await chrome.storage.session.get('rtr')).rtr||{panelId:null,origin:null,active:null};}
async function save(value){await chrome.storage.session.set({rtr:value});return value;}
async function api(s,route,method='GET',body){jobRoute(route);if(!s.panelId)throw new Error('Mantenha o painel RTR aberto.');const r=await chrome.tabs.sendMessage(s.panelId,{type:'RTR_API',route,method,body,lease:s.active?.lease});if(r?.error)throw new Error(r.error);if(!r||!('data' in r))throw new Error('Painel RTR desconectado.');return r.data;}
async function dispatch(s){if(!s.active||s.active.pending)return;await chrome.tabs.sendMessage(s.active.tabId,{type:'RTR_TASK',jobId:s.active.id,phase:s.active.phase,channel:s.active.channel,includeComments:s.active.includeComments,videoId:s.active.ids?.[s.active.index]||null,pace:PACE});}
async function navigate(s,url){const tab=await chrome.tabs.get(s.active.tabId);if(tab.url===url)await dispatch(s);else await chrome.tabs.update(tab.id,{url});}
async function navigateAfterReply(s,url){s.active.pending={url,dueAt:Date.now()+PACE.navigationDelayMs,heartbeatAt:Date.now()+15000};await save(s);await api(s,'/api/jobs/'+s.active.id+'/browser-batch','POST',{message:'Ritmo lento: aguardando 30 segundos antes de abrir o próximo vídeo.'});}
async function stop(s,cancel=false){const a=s.active;if(!a)return {stopped:true};s.active=null;await save(s);await chrome.tabs.sendMessage(a.tabId,{type:'RTR_STOP',jobId:a.id}).catch(()=>{});if(cancel)await api({...s,active:a},'/api/jobs/'+a.id+'/cancel','POST',{}).catch(()=>{});return {stopped:true};}
async function finish(s,error=null,blocked=false){
 const a=s.active;if(!a)return;
 try{await api(s,'/api/jobs/'+a.id+'/browser-finish','POST',{blocked,videos_complete:!error&&a.videosComplete===true,comments_complete:!error&&a.includeComments&&a.commentsComplete===true,message:error||'Coleta encerrada na sessão deste navegador. Cobertura completa somente quando a fonte confirmou todas as listas.'});}catch{}
 s.active=null;await save(s);
}
async function handle(m,sender){
 if(sender.id!==chrome.runtime.id)throw new Error('Origem de mensagem recusada.');
 let s=await state();
 if(m.type==='RTR_POPUP')return {origin:s.origin,active:s.active?{handle:s.active.channel.handle,phase:s.active.phase,waitingUntil:s.active.pending?.dueAt}:null};
 if(m.type==='RTR_STOP'){if(sender.tab&&sender.tab.id!==s.panelId)throw new Error('Interrompa pelo painel RTR.');return stop(s,true);}
 if(m.type==='RTR_CONNECT'){
  const origin=localOrigin(sender.tab?.url||'');if(origin!==m.origin)throw new Error('Origem local divergente.');
  if(s.active&&s.origin!==origin)throw new Error('Já há uma coleta conectada a outro RTR local.');
  s.panelId=sender.tab.id;s.origin=origin;await save(s);
  const current=m.jobs?.find(j=>j.id===s.active?.id);
  if(s.active&&current&&current.status!=='running')await stop(s);
  if(s.active?.pending){try{
   if(Date.now()>=s.active.pending.heartbeatAt){await api(s,'/api/jobs/'+s.active.id+'/browser-heartbeat','POST',{});s.active.pending.heartbeatAt=Date.now()+15000;await save(s);}
   if(due(s.active.pending)){const url=s.active.pending.url;s.active.pending=null;await save(s);await navigate(s,url);}
  }catch(e){await stop(s);}}
  return {active:!!s.active,waitingUntil:s.active?.pending?.dueAt};
 }
 if(m.type==='RTR_START'){
  if(sender.tab?.id!==s.panelId)throw new Error('Abra a coleta pelo painel RTR.');
  if(s.active||starting)return {active:true};starting=true;
  try{
   if(!/^[a-zA-Z0-9-]+$/.test(m.jobId))throw new Error('Coleta inválida.');
   const claim=await api(s,'/api/jobs/'+m.jobId+'/browser-start','POST',{});
   const url=profileUrl(claim.channel.handle),tabs=await chrome.tabs.query({url:'https://www.tiktok.com/*'});
   const tab=tabs.find(t=>t.url?.startsWith(url))||await chrome.tabs.create({url:'about:blank',active:false});
   s.active={id:m.jobId,lease:claim.lease,channel:claim.channel,includeComments:claim.include_comments,tabId:tab.id,phase:'profile',ids:[],index:0,videosComplete:false,commentsComplete:true};
   await save(s);await navigate(s,url);return {active:true};
  }catch(e){if(s.active)await finish(s,e.message);throw e;}finally{starting=false;}
 }
 if(!s.active||sender.tab?.id!==s.active.tabId)throw new Error('Esta aba não pertence à coleta ativa.');
 if(m.type==='RTR_SOURCE_READY'){await dispatch(s);return {ok:true};}
 if(m.jobId!==s.active.id)throw new Error('Coleta encerrada ou substituída.');
 if(m.type==='RTR_SOURCE_API'){
  if(!m.route?.startsWith('/api/jobs/'+s.active.id+'/browser-')||/browser-start$/.test(m.route))throw new Error('Rota de outra coleta.');
  return api(s,m.route,m.method,m.body);
 }
 if(m.type==='RTR_PROFILE_DONE'){
  if(s.active.phase!=='profile')return {ignored:true};
  const checkpoint=await api(s,'/api/jobs/'+s.active.id+'/browser-checkpoint');
  const done=new Set(checkpoint.done.map(x=>x.target_id));
  s.active.ids=checkpoint.videos.map(x=>x.id).filter(id=>!done.has(id));s.active.index=0;
  s.active.videosComplete=m.complete===true&&(m.expected==null||checkpoint.videos.length>=m.expected);
  s.active.phase='video';await save(s);
  if(!s.active.ids.length){await finish(s);return {ok:true};}
  await navigateAfterReply(s,videoUrl(s.active.channel.handle,s.active.ids[0]));return {ok:true};
 }
 if(m.type==='RTR_VIDEO_DONE'){
  if(m.videoId!==s.active.ids[s.active.index])throw new Error('Resposta de vídeo fora de ordem.');
  s.active.commentsComplete=s.active.commentsComplete&&m.commentsComplete===true;s.active.index++;await save(s);
  if(s.active.index>=s.active.ids.length){await finish(s);return {ok:true};}
  await navigateAfterReply(s,videoUrl(s.active.channel.handle,s.active.ids[s.active.index]));return {ok:true};
 }
 if(m.type==='RTR_SOURCE_ERROR'){await finish(s,String(m.error||'Coleta interrompida.').slice(0,1000),m.blocked===true);return {ok:true};}
 throw new Error('Mensagem desconhecida.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{const pending=operations.then(()=>handle(message,sender));operations=pending.catch(()=>{});pending.then(data=>respond({data})).catch(e=>respond({error:e.message}));return true;});
chrome.tabs.onRemoved.addListener(tabId=>{operations=operations.then(async()=>{const s=await state();if(s.active?.tabId===tabId)await finish(s,'A aba de coleta do TikTok foi fechada antes de terminar.');}).catch(()=>{});});
