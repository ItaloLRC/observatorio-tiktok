import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function queryDatabase(database,sql,{timeout=5000}={}){
 if(typeof sql!=='string'||!sql.trim()||sql.length>20000)throw new Error('Informe uma consulta de até 20 mil caracteres.');
 return new Promise((resolve,reject)=>{
  const worker=spawn(process.execPath,['--max-old-space-size=64',fileURLToPath(new URL('./sql-worker.mjs',import.meta.url))],{stdio:['pipe','pipe','ignore'],windowsHide:true});
  let settled=false,output='';
  const done=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);const deliver=()=>error?reject(error):resolve(data);if(worker.exitCode!==null||worker.signalCode!==null)deliver();else{worker.once('close',deliver);worker.kill();}};
  const timer=setTimeout(()=>done(new Error('A consulta excedeu 5 segundos. Reduza o volume ou use LIMIT.')),timeout);
  worker.stdout.on('data',chunk=>{output+=chunk;if(output.length>12000000)done(new Error('Resultado muito grande. Selecione menos colunas ou reduza LIMIT.'));});
  worker.once('error',error=>done(error));worker.once('close',code=>{if(settled)return;try{const data=JSON.parse(output);done(data.error?new Error(data.error):null,data);}catch{done(new Error('A consulta foi encerrada antes de terminar (código '+code+').'));}});
  worker.stdin.on('error',()=>{});worker.stdin.end(JSON.stringify({database,sql}));
 });
}
