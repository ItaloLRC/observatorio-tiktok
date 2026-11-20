(()=>{
 let connected=false,busy=false;
 async function api(route,method='GET',body,lease){const r=await fetch(route,{method,headers:{'Content-Type':'application/json',...(lease?{'X-RTR-Lease':lease}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Falha no banco local.');return data;}
 function status(data){window.postMessage({source:'RTR_EXTENSION_STATUS',...data},location.origin);}
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||message.type!=='RTR_API')return;
  if(!/^\/api\/jobs(?:\/[a-zA-Z0-9-]+\/(?:browser-(?:start|batch|checkpoint|heartbeat|finish)|cancel))?$/.test(message.route)){respond({error:'Rota recusada.'});return;}
  api(message.route,message.method,message.body,message.lease).then(data=>respond({data})).catch(e=>respond({error:e.message}));return true;
 });
 async function tick(){if(busy)return;busy=true;try{
  const local=await fetch('/api/local').then(r=>r.ok?r.json():null);if(!local||local.mode!=='local'){connected=false;return;}
  const {jobs}=await api('/api/jobs');
  const reply=await chrome.runtime.sendMessage({type:'RTR_CONNECT',origin:location.origin,jobs:jobs.map(j=>({id:j.id,status:j.status}))});if(reply?.error)throw new Error(reply.error);const info=reply.data||{};connected=true;status({connected:true,version:chrome.runtime.getManifest().version,active:info.active});
  await api('/api/extension/ping','POST',{version:chrome.runtime.getManifest().version});
  const job=jobs.find(j=>j.provider==='browser'&&j.status==='queued'&&(!j.lock_until||j.lock_until<new Date().toISOString()));
  if(job&&!info.active){const start=await chrome.runtime.sendMessage({type:'RTR_START',jobId:job.id});if(start?.error)throw new Error(start.error);}
 }catch(e){status({connected:false,error:e.message});}finally{busy=false;}}
 window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.type==='RTR_EXTENSION_PING')status({connected,version:chrome.runtime.getManifest().version});});
 window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.type==='RTR_STOP_REQUEST')chrome.runtime.sendMessage({type:'RTR_STOP'}).catch(()=>{});});
 tick();setInterval(tick,3000);
})();
