import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startLocalServer} from './server/local-server.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const here=path.dirname(fileURLToPath(import.meta.url)),port=Number(option('--port',8766));
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Porta inválida.');
let server;
try{server=await startLocalServer({port,dataDir:path.resolve(option('--data-dir',path.join(here,'.local')))});}
catch(e){if(e.code==='EADDRINUSE'){console.error('A porta '+port+' já está em uso. Abra o servidor existente ou use: npm run server -- --port 8767');process.exit(1);}throw e;}
console.log('\nObservatório TikTok — servidor local');
console.log('Abra no seu navegador habitual: '+server.origin);
console.log('Banco: '+server.databasePath);
console.log('Ctrl+C encerra o servidor.');
console.log('O crawler usa a extensão da pasta extension no Chrome ou Edge.');
console.log('Abra o painel, cadastre o canal e mantenha as abas abertas. Nenhum outro navegador será iniciado.\n');
let closing=false;async function close(){if(closing)return;closing=true;await server.close();}
process.on('SIGINT',close);process.on('SIGTERM',close);
