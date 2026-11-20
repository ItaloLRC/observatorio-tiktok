import {createCsvExporter} from './csv-exports.mjs';
import {manageData} from './data-management.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../runtime/local-db.mjs';
import worker from '../runtime/index.mjs';
import {queryDatabase} from './sql-query.mjs';

const here=fileURLToPath(new URL('../',import.meta.url));
const tables=['channels','channel_snapshots','videos','video_snapshots','hashtags','video_hashtags','video_snapshot_hashtags','comments','comment_snapshots','crawl_jobs','crawl_tasks','crawl_events','imports'];

export async function startLocalServer({dataDir=path.join(here,'.local'),port=0}={}){
 fs.mkdirSync(dataDir,{recursive:true});
 const databasePath=path.join(dataDir,'rtr.sqlite');
 const {db,DB}=openDatabase(databasePath,fs.readFileSync(path.join(here,'runtime/schema.sql'),'utf8'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 const csv=createCsvExporter(databasePath,path.join(dataDir,'exports'));
 const observe=()=>{const changes=db.prepare('SELECT total_changes() n').get().n,version=db.prepare('PRAGMA data_version').get().data_version;csv.observe(changes+':'+version);};
 observe();
 // Serialize requests because the SQLite adapter uses transactions across await boundaries.
 let queue=Promise.resolve();
 const pending=new Set();
 let origin,extensionSeen=0,extensionVersion=null;
 const server=http.createServer((req,res)=>{
  queue=queue.then(async()=>{
   try{
    if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end('Host não autorizado.');return;}
    if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Origem não autorizada.');return;}
    if(req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Origem não autorizada.');return;}
    let body='',size=0;
    for await(const chunk of req){size+=chunk.length;if(size>2100000){res.writeHead(413);res.end('Requisição muito grande.');return;}body+=chunk;}
    const url=new URL(req.url,origin);
    if(req.method==='GET'&&url.pathname==='/api/exports/status'){
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(csv.status()));return;
    }
    if(req.method==='POST'&&url.pathname==='/api/exports/refresh'){
     csv.refresh();res.writeHead(202,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return;
    }
    if(req.method==='GET'&&url.pathname==='/api/exports/file'){
     const name=url.searchParams.get('name')||'',file=csv.file(name,url.searchParams.get('generation'));
     if(!file){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Exportação indisponível ou versão expirada. Atualize a lista.'}));return;}
     res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'no-store'});
     await new Promise(resolve=>{const stream=fs.createReadStream(file);stream.on('error',()=>{res.destroy();resolve();});res.on('close',()=>{stream.destroy();resolve();});stream.pipe(res);});return;
    }
    const managed=manageData(db,url,req.method,body?JSON.parse(body):{});
    if(managed){res.writeHead(managed.status||200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(managed));return;}
    if(req.method==='POST'&&url.pathname==='/api/jobs'){
     const input=JSON.parse(body||'{}');if(db.prepare('SELECT deleted_at FROM channels WHERE id=?').get(input.channel_id)?.deleted_at){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Restaure o canal na lixeira antes de coletar.'}));return;}
    }
    const resume=url.pathname.match(/^\/api\/jobs\/([^/]+)\/resume$/);
    if(req.method==='POST'&&resume&&db.prepare('SELECT c.deleted_at FROM channels c JOIN crawl_jobs j ON j.channel_id=c.id WHERE j.id=?').get(decodeURIComponent(resume[1]))?.deleted_at){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Restaure o canal na lixeira antes de retomar.'}));return;}
    if(req.method==='POST'&&url.pathname==='/api/crawler/stop'){
     const active=db.prepare("SELECT id FROM crawl_jobs WHERE provider='browser' AND status IN ('queued','running')").all(),time=new Date().toISOString();
     db.exec('BEGIN IMMEDIATE');try{
      for(const job of active){db.prepare("UPDATE crawl_jobs SET status='cancelled',finished_at=?,updated_at=?,lock_token=NULL,lock_until=NULL,message='Coleta interrompida pelo usuário; dados já salvos preservados.' WHERE id=?").run(time,time,job.id);db.prepare('INSERT INTO crawl_events(id,job_id,level,code,message,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),job.id,'info','user_stop','Coleta interrompida pelo usuário; a extensão deve cancelar navegações e rolagens pendentes.',time);}
      db.exec('COMMIT');
     }catch(e){db.exec('ROLLBACK');throw e;}
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,stopped:active.length}));return;
    }
    if(req.method==='GET'&&url.pathname==='/api/sql/schema'){
     const objects=db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
     const schema=objects.map(object=>({...object,columns:db.prepare('PRAGMA table_info("'+object.name.replaceAll('"','""')+'")').all().map(c=>({name:c.name,type:c.type,primary_key:!!c.pk,nullable:!c.notnull})),foreign_keys:db.prepare('PRAGMA foreign_key_list("'+object.name.replaceAll('"','""')+'")').all(),count:db.prepare('SELECT COUNT(*) n FROM "'+object.name.replaceAll('"','""')+'"').get().n}));
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({database:databasePath,objects:schema,read_only:true}));return;
    }
    if(req.method==='POST'&&url.pathname==='/api/sql/query'){
     try{const input=JSON.parse(body||'{}'),result=await queryDatabase(databasePath,input.sql);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));}
     catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;
    }
    if(req.method==='GET'&&url.pathname==='/api/local'){
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
     res.end(JSON.stringify({mode:'local',database:databasePath,authentication:false,extension:{connected:Date.now()-extensionSeen<10000,version:extensionVersion}}));return;
    }
    if(req.method==='POST'&&url.pathname==='/api/extension/ping'){
     const input=JSON.parse(body||'{}');extensionSeen=Date.now();extensionVersion=String(input.version||'').slice(0,30);
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return;
    }
    if(req.method==='GET'&&url.pathname==='/api/export'){
     const data={format:'rtr-sqlite-export-v1',exported_at:new Date().toISOString(),tables:{}};
     for(const table of tables){data.tables[table]=db.prepare('SELECT * FROM '+table).all().map(row=>{
      const copy={...row};if(table==='crawl_jobs'){delete copy.lock_token;delete copy.lock_until;}return copy;
     });}
     res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="rtr-dados-locais.json"','Cache-Control':'no-store'});
     res.end(JSON.stringify(data,null,2));return;
    }
    // A local collector starts with its own empty database, never the hosted seed.
    if(url.pathname==='/api/bootstrap'){
     const channel=db.prepare('SELECT id FROM channels WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1').get();
     res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({imported:false,local:true,channel_id:channel?.id??null}));return;
    }
    if(req.method==='POST'&&['/api/channels','/api/jobs'].includes(url.pathname)){
     const data=JSON.parse(body||'{}');if(data.provider!=='browser'){
      res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Este coletor usa o navegador local. Escolha provider browser.'}));return;
     }
    }
    const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}:{})});
    const response=await worker.fetch(request,{DB},{waitUntil:p=>{pending.add(p);p.catch(e=>console.error(e.message)).finally(()=>pending.delete(p));}});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   }catch(e){if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}finally{observe();}
  }).catch(e=>console.error(e.message));
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
 catch(e){await csv.close();db.close();throw e;}
 origin='http://127.0.0.1:'+server.address().port;
 const exportTimer=setInterval(()=>{queue=queue.then(observe).catch(e=>console.error(e.message));},2000);exportTimer.unref();
 return {origin,databasePath,db,async close(){clearInterval(exportTimer);await new Promise(resolve=>server.close(resolve));await queue;await Promise.allSettled([...pending]);await csv.close();db.close();}};
}
