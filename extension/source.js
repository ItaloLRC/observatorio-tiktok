(()=>{
 const core=RTRCore;
 let task=null,running=false,responses=[],controller=null,stopped=false,sourceFailure=null;
 function check(){if(sourceFailure)throw sourceFailure;if(stopped||controller?.signal.aborted)throw new DOMException('Coleta interrompida pelo usuário.','AbortError');}
 const sleep=ms=>new Promise((resolve,reject)=>{try{check();}catch(e){reject(e);return;}const signal=controller?.signal,timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);function abort(){clearTimeout(timer);reject(sourceFailure||new DOMException('Coleta interrompida pelo usuário.','AbortError'));}signal?.addEventListener('abort',abort,{once:true});});
 const visible=e=>!!e&&!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const number=text=>{if(text==null)return null;const m=String(text).replaceAll(',','.').match(/([\d.]+)\s*(K|M|mil|mi)?/i);return m?Number(m[1])*({k:1000,m:1e6,mil:1000,mi:1e6}[m[2]?.toLowerCase()]||1):null;};
 window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin)return;if(e.data?.source==='RTR_HTTP_FAILURE'&&running&&[403,429].includes(e.data.status)){sourceFailure=new Error('O TikTok retornou HTTP '+e.data.status+'. Coleta parada; nenhuma tentativa automática será feita.');sourceFailure.blocked=true;controller?.abort();return;}if(e.data?.source!=='RTR_PUBLIC_RESPONSE')return;if(typeof e.data.text!=='string'||e.data.text.length>4000000)return;responses.push(e.data);if(responses.length>40)responses.shift();});
 async function send(data){const r=await chrome.runtime.sendMessage(data);if(r?.error)throw new Error(r.error);return r?.data;}
 const api=async(suffix,body)=>{check();const result=await send({type:'RTR_SOURCE_API',jobId:task.jobId,route:'/api/jobs/'+task.jobId+'/browser-'+suffix,method:body===undefined?'GET':'POST',body});check();return result;};
 function banner(text){let el=document.querySelector('#rtr-collector-indicator');if(!el&&document.body){el=document.createElement('div');el.id='rtr-collector-indicator';el.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483646;max-width:330px;background:#164e3b;color:white;padding:13px 17px;border-radius:12px;font:13px system-ui;box-shadow:0 3px 20px #0004;pointer-events:none';document.body.append(el);}if(el)el.textContent='RTR · '+text;}
 function blocked(){if([...document.querySelectorAll('[data-e2e="login-modal"],#loginModalContentContainer')].some(visible)||location.pathname.startsWith('/login'))return 'O TikTok pede login neste navegador. Entre na sua conta para continuar.';if([...document.querySelectorAll('iframe[src*="captcha"],[id*="captcha"],[class*="captcha-verify"],[data-e2e="captcha"]')].some(visible))return 'O TikTok pede uma verificação. Conclua manualmente para continuar.';return null;}
 async function waitAccess(){check();let last=0;while(blocked()){const message=blocked();banner(message);if(Date.now()-last>5000){last=Date.now();await api('batch',{message});}await sleep(task.pace?.scrollDelayMs||5000);}}
 function hydration(){return core.extractProfile(core.extractState(document.documentElement.outerHTML),task.channel.handle);}
 function scrollOwner(last){let el=last?.parentElement;while(el&&el!==document.body){if(el.scrollHeight>el.clientHeight+20&&/(auto|scroll)/.test(getComputedStyle(el).overflowY))return el;el=el.parentElement;}return document.scrollingElement;}
 function scrollGrid(){check();const links=[...document.querySelectorAll('a[href*="/video/"]')].filter(a=>a.pathname.startsWith('/@'+task.channel.handle+'/video/')),last=links.at(-1),owner=scrollOwner(last);last?.scrollIntoView({block:'end',behavior:'instant'});owner?.scrollBy({top:Math.max(owner.clientHeight*.85,500),behavior:'instant'});}
 function takeResponses(){const current=responses;responses=[];return current.map(item=>{try{return {...item,data:core.parseLossless(item.text),text:undefined};}catch{return null;}}).filter(Boolean);}
 function ownVideo(v){const author=v.author?.uniqueId??v.author?.unique_id;return !author||author.toLowerCase()===task.channel.handle;}
 async function saveVideos(values){for(let i=0;i<values.length;i+=10)await api('batch',{videos:values.slice(i,i+10)});}
 async function profile(){
  const checkpoint=await api('checkpoint'),ids=new Set(checkpoint.videos.map(v=>v.id));
  let expected=null,ended=false,pages=0,lastProgress=Date.now(),lastReport=0,lastProfile='',lastSize=-1;
  while(true){
   check();
   const batch=new Map(),add=v=>{const id=String(v.id||v.aweme_id||'');if(!/^\d{15,24}$/.test(id)||!ownVideo(v))return;batch.set(id,{...batch.get(id),...v});ids.add(id);};
   const p=hydration(),profileJSON=JSON.stringify([p.user,p.stats]);
   if(p.stats?.videoCount!=null)expected=Number(p.stats.videoCount);
   if(profileJSON!==lastProfile&&(p.user||p.stats)){await api('batch',{profile:{user:p.user,stats:p.stats}});lastProfile=profileJSON;}
   for(const raw of p.posts)add({...raw,_approximate:0});
   for(const response of takeResponses())if(response.path.includes('/post/item_list')){
    const list=response.data.itemList??response.data.item_list;if(!Array.isArray(list)||Number(response.data.statusCode??response.data.status_code??0)!==0)continue;
    let accepted=0;for(const raw of list)if(ownVideo(raw)){add({...raw,_approximate:0});accepted++;}
    if(accepted||!list.length){pages++;if([false,0].includes(response.data.hasMore??response.data.has_more))ended=true;}
   }
   for(const a of document.querySelectorAll('a[href*="/video/"]')){if(!a.pathname.startsWith('/@'+task.channel.handle+'/video/'))continue;const id=a.pathname.match(/\/video\/(\d+)/)?.[1];if(!id||ids.has(id))continue;add({id,desc:(a.querySelector('img')?.alt||a.getAttribute('aria-label')||'').split(/ criado por | created by /)[0]||null,views:number(a.innerText),_approximate:1});}
   if(batch.size)await saveVideos([...batch.values()]);
   if(ids.size!==lastSize){lastSize=ids.size;lastProgress=Date.now();}
   const message=blocked(),complete=expected!==null&&ids.size>=expected,state=message?'login_or_verification':Date.now()-lastProgress>60000?'waiting':'discovering';
   if(Date.now()-lastReport>5000||complete||ended){lastReport=Date.now();const text=`${message||state==='waiting'&&'Listagem sem progresso; aguardando a fonte'||'Descobrindo vídeos'} · ${ids.size}/${expected??'?'} encontrados.`;banner(text);await api('batch',{discovery:{found:ids.size,expected,state,pages},message:text});}
   if(complete||ended){await send({type:'RTR_PROFILE_DONE',jobId:task.jobId,complete:complete||(ended&&expected===null),expected});return;}
   if(!message)scrollGrid();await sleep(task.pace?.scrollDelayMs||5000);
  }
 }
 function videoFromDOM(id){const desc=document.querySelector('[data-e2e="browse-video-desc"],[data-e2e="video-desc"]')?.innerText;const tagLinks=[...document.querySelectorAll('[data-e2e="browse-video-desc"] a[href*="/tag/"],[data-e2e="video-desc"] a[href*="/tag/"]')].map(a=>a.innerText);const observed={id,desc:desc??null,_approximate:1};if(tagLinks.length)observed.hashtag_names=tagLinks;for(const [key,selector] of Object.entries({likes:'[data-e2e="like-count"]',comment_count:'[data-e2e="comment-count"]',shares:'[data-e2e="share-count"]',saves:'[data-e2e="undefined-count"],[data-e2e="collect-count"]'})){const el=document.querySelector(selector);if(el)observed[key]=number(el.innerText);}const media=document.querySelector('video');if(Number.isFinite(media?.duration)&&media.duration>0)observed.duration_s=media.duration;return observed;}
 async function video(){
  const id=task.videoId,comments=new Map(),rootEnds=new Set(),replyEnds=new Set(),loaded=new Set();let raw=null;
  function consume(){
   const p=hydration(),found=p.posts.find(v=>String(v.id||v.aweme_id)===id);if(found)raw={...raw,...found,_approximate:0};
   for(const r of takeResponses()){
    if(r.path.includes('/item/detail')){const v=r.data.itemInfo?.itemStruct??r.data.itemStruct??r.data.item_info?.item_struct;if(v&&String(v.id||v.aweme_id)===id)raw={...raw,...v,_approximate:0};}
    if(r.path.includes('/comment/list')){
     const videoId=String(r.params.aweme_id||r.params.item_id||id);if(videoId!==id)continue;
     const parent=r.path.includes('/reply')?r.params.comment_id:null;
     for(const c of r.data.comments||[]){const cid=String(c.cid??c.id);if(/^\d{10,24}$/.test(cid))comments.set(cid,{video_id:id,parent_comment_id:parent||null,raw:c});}
     if([false,0].includes(r.data.has_more??r.data.hasMore)){if(parent)replyEnds.add(String(parent));else rootEnds.add(id);}
    }
   }
  }
  async function persistComments(){const pending=[...comments].filter(([id])=>!loaded.has(id));for(let i=0;i<pending.length;i+=75){const part=pending.slice(i,i+75);await api('batch',{comments:part.map(([,c])=>c)});for(const [id] of part)loaded.add(id);}}
  await waitAccess();
  for(let i=0;i<8;i++){consume();if(raw?.stats||raw?.statistics)break;await sleep(1000);await waitAccess();}
  raw={...videoFromDOM(id),...raw,id};await saveVideos([raw]);
  let complete=!task.includeComments,stagnant=0,last=comments.size;
  if(task.includeComments)while(stagnant<12){
   await waitAccess();consume();await persistComments();
   const roots=[...comments.values()].filter(c=>!c.parent_comment_id),counts=new Map();for(const c of comments.values())if(c.parent_comment_id)counts.set(c.parent_comment_id,(counts.get(c.parent_comment_id)||0)+1);
   const expected=raw.stats?.commentCount??raw.comment_count,repliesKnown=roots.every(c=>(c.raw.reply_comment_total??c.raw.reply_count)!=null),repliesDone=roots.every(c=>{const n=Number(c.raw.reply_comment_total??c.raw.reply_count??0),cid=String(c.raw.cid??c.raw.id);return n===0||replyEnds.has(cid)||(counts.get(cid)||0)>=n;});
   if((rootEnds.has(id)||expected===0)&&repliesKnown&&repliesDone){complete=true;break;}
   check();for(const el of [...document.querySelectorAll('button,[role="button"],p,span')].filter(e=>visible(e)&&/^(?:Ver|View) (?:mais |more )?(?:\d+ )?(?:respostas?|repl(?:y|ies))/i.test(e.innerText?.trim()||'')&&e.children.length===0).slice(0,task.pace?.replyBatchSize||1))el.click();
   const list=document.querySelector('[data-e2e="comment-list"]');if(list){const owner=scrollOwner(list.lastElementChild||list);owner?.scrollBy({top:Math.max(owner.clientHeight*.9,500),behavior:'instant'});}else document.scrollingElement?.scrollBy({top:700,behavior:'instant'});
   await sleep(task.pace?.scrollDelayMs||5000);consume();if(comments.size===last)stagnant++;else{stagnant=0;last=comments.size;}banner('Vídeo '+id+' · '+comments.size+' comentários/respostas salvos');
  }
  consume();await saveVideos([raw]);await persistComments();await api('batch',{processed_video:id,comments_complete:complete,message:`Vídeo ${id}: ${comments.size} comentários/respostas obtidos; ${complete?'fim confirmado ou comentários não solicitados':'comentários parcialmente disponíveis'}.`});
  await send({type:'RTR_VIDEO_DONE',jobId:task.jobId,videoId:id,commentsComplete:complete});
 }
 async function run(next){
  if(running)return;task=next;running=true;stopped=false;sourceFailure=null;controller=new AbortController();let heartbeat;
  try{while(document.readyState==='loading')await sleep(100);await sleep(1000);heartbeat=setInterval(()=>api('heartbeat',{}).catch(()=>{}),15000);if(task.phase==='profile')await profile();else await video();}
  catch(e){banner(e.message);if(e.name!=='AbortError')await send({type:'RTR_SOURCE_ERROR',jobId:task.jobId,error:e.message,blocked:e.blocked===true}).catch(()=>{});}
  finally{clearInterval(heartbeat);running=false;}
 }
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{if(sender.id!==chrome.runtime.id)return;if(message.type==='RTR_STOP'&&message.jobId===task?.jobId){stopped=true;controller?.abort();banner('Coleta interrompida. Os dados salvos foram preservados.');respond({stopped:true});return;}if(message.type!=='RTR_TASK')return;respond({accepted:true});run(message);});
 send({type:'RTR_SOURCE_READY'}).catch(()=>{});
})();
