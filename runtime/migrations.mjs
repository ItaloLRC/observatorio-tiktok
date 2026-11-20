// Idempotent local migration. Existing rows and snapshot history are retained.
export function migrate(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const table of ['channels','videos'])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='deleted_at'))db.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at TEXT`);
  db.exec(`CREATE VIEW IF NOT EXISTS active_video_metrics AS SELECT v.* FROM latest_video_metrics v JOIN channels c ON c.id=v.channel_id WHERE v.deleted_at IS NULL AND c.deleted_at IS NULL; PRAGMA user_version=1; COMMIT;`);
 }catch(e){db.exec('ROLLBACK');throw e;}
}
