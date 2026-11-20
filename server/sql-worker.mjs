import {DatabaseSync} from 'node:sqlite';
let input='';for await(const chunk of process.stdin)input+=chunk;const workerData=JSON.parse(input);
let db;
try{
 const sql=String(workerData.sql||'').trim(),head=sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/,'');
 if(!/^(SELECT|WITH|EXPLAIN)\b/i.test(head))throw new Error('Este console aceita SELECT, WITH e EXPLAIN. O banco é aberto somente para leitura.');
 db=new DatabaseSync(workerData.database,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
 const statement=db.prepare(sql);statement.setReadBigInts(true);
 const rows=[];let truncated=false;
 for(const row of statement.iterate()){if(rows.length>=1000){truncated=true;break;}rows.push(Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?v.toString():v instanceof Uint8Array?'[BLOB '+v.length+' bytes]':v])));}
 process.stdout.write(JSON.stringify({rows,columns:statement.columns?.().map(c=>c.name)||Object.keys(rows[0]||{}),truncated}));
}catch(e){process.stdout.write(JSON.stringify({error:e.message}));}finally{db?.close();}
