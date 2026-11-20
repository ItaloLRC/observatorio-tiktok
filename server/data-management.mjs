export function manageData(db,url,method,input={}){
 const match=url.pathname.match(/^\/api\/manage\/(channel|video)\/([^/]+)(?:\/(restore))?$/);
 if(url.pathname==='/api/trash'&&method==='GET')return {items:db.prepare(`SELECT 'channel' kind,id,'@'||handle label,deleted_at FROM channels WHERE deleted_at IS NOT NULL UNION ALL SELECT 'video',v.id,v.title,v.deleted_at FROM videos v WHERE v.deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all()};
 if(!match)return null;
 const [,kind,encoded,action]=match,id=decodeURIComponent(encoded),table=kind==='channel'?'channels':'videos',entity=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
 if(!entity)return {error:'Registro não encontrado.',status:404};
 const channelId=kind==='channel'?id:entity.channel_id;
 const counts=kind==='channel'?db.prepare(`SELECT COUNT(*) videos,(SELECT COUNT(*) FROM comments WHERE video_id IN (SELECT id FROM videos WHERE channel_id=?)) comments,(SELECT COUNT(*) FROM video_snapshots WHERE video_id IN (SELECT id FROM videos WHERE channel_id=?)) snapshots FROM videos WHERE channel_id=?`).get(id,id,id):db.prepare(`SELECT 1 videos,(SELECT COUNT(*) FROM comments WHERE video_id=?) comments,(SELECT COUNT(*) FROM video_snapshots WHERE video_id=?) snapshots`).get(id,id);
 if(method==='GET')return {kind,id,label:kind==='channel'?'@'+entity.handle:entity.title,deleted_at:entity.deleted_at,counts};
 if(method!=='POST')return {error:'Método não permitido.',status:405};
 if(action==='restore'){
  if(kind==='video'&&db.prepare('SELECT deleted_at FROM channels WHERE id=?').get(channelId)?.deleted_at)return {error:'Restaure primeiro o canal deste vídeo.',status:409};
  db.prepare(`UPDATE ${table} SET deleted_at=NULL WHERE id=?`).run(id);return {ok:true,restored:true};
 }
 if(input.confirm!==id)return {error:'Confirmação do registro ausente.',status:400};
 const time=new Date().toISOString();
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare(`UPDATE ${table} SET deleted_at=COALESCE(deleted_at,?) WHERE id=?`).run(time,id);
  // Cancel leases before hiding a channel or a video, so late crawler batches fail.
  db.prepare(`UPDATE crawl_jobs SET status='cancelled',lock_token=NULL,lock_until=NULL,finished_at=?,updated_at=?,message='Coleta interrompida: dados enviados à lixeira.' WHERE channel_id=? AND status IN ('queued','running')`).run(time,time,channelId);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return {ok:true,counts};
}
