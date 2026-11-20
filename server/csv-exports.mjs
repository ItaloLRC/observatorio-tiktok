import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';

export function createCsvExporter(databasePath,directory){
 let dirty=true,running=null,timer=null,closed=false,lastSignature='',lastStarted=0,error=null;
 const manifest=()=>{try{return JSON.parse(fs.readFileSync(path.join(directory,'latest.json'),'utf8'));}catch{return null;}};
 function schedule(){if(closed||running||timer)return;timer=setTimeout(()=>{timer=null;run();},Math.max(200,2000-(Date.now()-lastStarted)));timer.unref();}
 function run(force=false){
  if(running||!dirty||(closed&&!force))return running||Promise.resolve();dirty=false;lastStarted=Date.now();error=null;
  running=new Promise(resolve=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('./csv-worker.mjs',import.meta.url))],{stdio:['pipe','ignore','pipe'],windowsHide:true});let errors='';const timeout=setTimeout(()=>{error='Exportação excedeu 2 minutos.';child.kill();},120000);timeout.unref();
   child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-8000);});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({databasePath,directory}));
   child.on('error',e=>{error=e.message;});child.on('close',code=>{clearTimeout(timeout);if(code!==0&&!error)error=errors||'Não foi possível exportar os dados.';running=null;if(dirty)schedule();resolve();});
  });return running;
 }
 return {
  observe(signature){if(signature!==lastSignature||(error&&Date.now()-lastStarted>30000)){lastSignature=signature;dirty=true;schedule();}},
  refresh(){dirty=true;schedule();},
  status(){return {directory,running:!!running,pending:dirty,error,auto_update:true,poll_seconds:2,manifest:manifest()};},
  file(name,generation){
   const latest=manifest();if(!latest)return null;
   const id=generation||latest.generation;if(!/^[a-f0-9-]{36}$/.test(id)||!latest.datasets.some(d=>d.file===name))return null;
   const file=path.join(directory,'snapshots',id,name);return fs.existsSync(file)?file:null;
  },
  async close(){closed=true;clearTimeout(timer);if(running)await running;if(dirty)await run(true);},
 };
}
