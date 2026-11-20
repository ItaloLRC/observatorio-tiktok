import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const rawTables=['channels','channel_snapshots','videos','video_snapshots','hashtags','video_hashtags','video_snapshot_hashtags','comments','comment_snapshots','crawl_jobs','crawl_tasks','crawl_events','imports'];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
export const csvCell=(value,nullValue)=>{
 if(value==null)return nullValue;
 const text=String(value);if(text===nullValue)throw Error('Marcador de NULL colidiu com um valor. Tente exportar novamente.');
 return '"'+text.replaceAll('"','""')+'"';
};
const dtype=type=>/INT/i.test(type)?'Int64':/REAL|FLOAT|DOUBLE|NUM/i.test(type)?'Float64':/TEXT|CHAR|CLOB/i.test(type)?'string':null;

export function exportCsv(databasePath,directory){
 fs.mkdirSync(directory,{recursive:true});const snapshots=path.join(directory,'snapshots');fs.mkdirSync(snapshots,{recursive:true});
 const generation=randomUUID(),target=path.join(snapshots,generation);fs.mkdirSync(target);
 const nullValue='__RTR_NULL_'+randomUUID()+'__',db=new DatabaseSync(databasePath,{readOnly:true}),startedAt=new Date().toISOString(),datasets=[];
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000; BEGIN');db.prepare('SELECT COUNT(*) FROM channels').get();
  const definitions=rawTables.map(name=>({name,kind:'raw_table',query:'SELECT * FROM '+quote(name),columns:db.prepare('PRAGMA table_info('+quote(name)+')').all().filter(c=>name!=='crawl_jobs'||!['lock_token','lock_until'].includes(c.name))}));
  const metricColumns=db.prepare('PRAGMA table_info(latest_video_metrics)').all().filter(c=>c.name!=='raw_json');
  const extra=[{name:'channel_handle',type:'TEXT'},{name:'channel_display_name',type:'TEXT'},{name:'channel_deleted_at',type:'TEXT'},{name:'tags_json',type:'TEXT'}];
  const metricQuery=`SELECT ${metricColumns.map(c=>'v.'+quote(c.name)).join(',')},c.handle channel_handle,c.display_name channel_display_name,c.deleted_at channel_deleted_at,COALESCE((SELECT json_group_array(name) FROM (SELECT h.name FROM video_hashtags vh JOIN hashtags h ON h.id=vh.hashtag_id WHERE vh.video_id=v.id AND vh.active=1 ORDER BY h.name)),'[]') tags_json FROM latest_video_metrics v JOIN channels c ON c.id=v.channel_id`;
  definitions.push({name:'video_metrics',kind:'latest_metrics_including_trash',columns:[...metricColumns,...extra],query:metricQuery}, {name:'active_video_metrics',kind:'latest_metrics_active_only',columns:[...metricColumns,...extra],query:metricQuery+' WHERE v.deleted_at IS NULL AND c.deleted_at IS NULL'});
  for(const definition of definitions){
   const columns=definition.columns.map(c=>({name:c.name,sqlite_type:c.type,pandas_dtype:dtype(c.type)})),filename=definition.name+'.csv',file=path.join(target,filename),fd=fs.openSync(file,'wx');let count=0,buffer=columns.map(c=>csvCell(c.name,nullValue)).join(',')+'\r\n';
   try{
    const statement=db.prepare(definition.query);statement.setReadBigInts(true);
    for(const row of statement.iterate()){
     buffer+=columns.map(c=>csvCell(row[c.name],nullValue)).join(',')+'\r\n';count++;
     if(buffer.length>=65536){fs.writeFileSync(fd,buffer,'utf8');buffer='';}
    }
    if(buffer)fs.writeFileSync(fd,buffer,'utf8');fs.fsyncSync(fd);
   }finally{fs.closeSync(fd);}
   datasets.push({name:definition.name,file:filename,path:'snapshots/'+generation+'/'+filename,kind:definition.kind,rows:count,bytes:fs.statSync(file).size,columns,foreign_keys:definition.kind==='raw_table'?db.prepare('PRAGMA foreign_key_list('+quote(definition.name)+')').all():[]});
  }
  db.exec('COMMIT');
 }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
 const manifest={format:'rtr-csv-v1',generation,started_at:startedAt,exported_at:new Date().toISOString(),encoding:'utf-8',separator:',',null_value:nullValue,includes_trash:true,excluded_fields:['crawl_jobs.lock_token','crawl_jobs.lock_until'],datasets};
 // Readers pin this manifest to an immutable, consistent SQLite snapshot.
 fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');
 // Stable file paths are atomically replaced, one complete CSV at a time.
 for(const data of datasets){const temporary=path.join(directory,'.'+data.file+'.tmp');fs.copyFileSync(path.join(target,data.file),temporary);fs.renameSync(temporary,path.join(directory,data.file));}
 fs.writeFileSync(path.join(directory,'.latest.tmp'),JSON.stringify(manifest,null,2),'utf8');fs.renameSync(path.join(directory,'.latest.tmp'),path.join(directory,'latest.json'));
 // Keep recent generations for concurrent readers (at least 2 minutes).
 const old=fs.readdirSync(snapshots,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.isSymbolicLink()&&/^[a-f0-9-]{36}$/.test(d.name)).map(d=>({directory:path.resolve(snapshots,d.name),time:fs.statSync(path.join(snapshots,d.name)).mtimeMs})).sort((a,b)=>b.time-a.time);
 for(const entry of old.slice(3))if(Date.now()-entry.time>120000&&path.dirname(entry.directory)===path.resolve(snapshots))fs.rmSync(entry.directory,{recursive:true,force:true});
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let input='';for await(const chunk of process.stdin)input+=chunk;
 try{const options=JSON.parse(input);const manifest=exportCsv(options.databasePath,options.directory);process.stdout.write(JSON.stringify({generation:manifest.generation}));}catch(e){process.stderr.write(e.message);process.exitCode=1;}
}
