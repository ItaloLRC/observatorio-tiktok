(()=>{
 const $=id=>document.getElementById(id),esc=v=>String(v??'NULL').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let last=null;
 const examples={counts:`SELECT 'Canais' AS tipo, COUNT(*) AS total FROM channels
UNION ALL SELECT 'Vídeos', COUNT(*) FROM videos
UNION ALL SELECT 'Comentários obtidos', COUNT(*) FROM comments WHERE raw_json IS NOT NULL
UNION ALL SELECT 'Hashtags', COUNT(*) FROM hashtags;`,videos:`SELECT id, title, published_brt, duration_seconds,
       views, likes, comment_count, shares, reposts,
       hashtag_count, like_view_ratio, captured_at
FROM active_video_metrics
ORDER BY published_at DESC LIMIT 100;`,hours:`SELECT hour_brt AS hora, COUNT(views) AS videos_com_views,
       ROUND(AVG(views), 2) AS media_views, MIN(views) AS minimo,
       MAX(views) AS maximo
FROM active_video_metrics
GROUP BY hour_brt ORDER BY hour_brt;`,tags:`SELECT h.name AS tag, COUNT(*) AS videos
FROM video_hashtags vh JOIN hashtags h ON h.id = vh.hashtag_id
WHERE vh.active = 1
GROUP BY h.id ORDER BY videos DESC, h.name;`,comments:`SELECT c.video_id, c.author_handle, c.text, s.likes, s.reply_count
FROM comments c LEFT JOIN comment_snapshots s
  ON s.id = (SELECT ss.id FROM comment_snapshots ss
             WHERE ss.comment_id = c.id ORDER BY ss.captured_at DESC, ss.rowid DESC LIMIT 1)
WHERE c.raw_json IS NOT NULL
ORDER BY s.likes DESC LIMIT 100;`,jobs:`SELECT id, status, discovered_videos, saved_comments,
       processed_tasks, message, created_at, updated_at
FROM crawl_jobs ORDER BY created_at DESC;`};
 $('query').value=examples.counts;
 $('load-example').onclick=()=>{$('query').value=examples[$('example').value];};
 async function run(){const button=$('run');button.disabled=true;$('status').className='notice';$('status').textContent='Executando…';try{const r=await fetch('/api/sql/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:$('query').value})}),data=await r.json();if(!r.ok)throw new Error(data.error);last=data;$('csv').disabled=!data.rows.length;$('status').textContent=data.rows.length+' linhas'+(data.truncated?' · resultado limitado às primeiras 1.000':'');$('result').innerHTML=data.columns.length?'<table><thead><tr>'+data.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(row=>'<tr>'+data.columns.map(c=>'<td>'+esc(row[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table>':'<p>Nenhuma linha retornada.</p>';}catch(e){$('status').className='notice error';$('status').textContent=e.message;}finally{button.disabled=false;}}
 $('run').onclick=run;$('query').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(!$('run').disabled)run();}};
 $('csv').onclick=()=>{if(!last)return;const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"',csv='\ufeff'+[last.columns.map(quote).join(';'),...last.rows.map(row=>last.columns.map(c=>quote(row[c])).join(';'))].join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='rtr-consulta.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 fetch('/api/sql/schema').then(r=>r.json()).then(data=>{$('database').textContent='Arquivo: '+data.database;$('schema').innerHTML=data.objects.map(o=>'<details><summary>'+esc(o.name)+(o.type==='view'?' · view':'')+'</summary><button data-table="'+esc(o.name)+'">Consultar</button><ul>'+o.columns.map(c=>'<li>'+esc(c.name)+' · '+esc(c.type)+(c.primary_key?' · chave':'')+'</li>').join('')+'</ul></details>').join('');const requested=new URLSearchParams(location.search).get('table');if(data.objects.some(o=>o.name===requested))$('query').value='SELECT * FROM "'+requested.replaceAll('"','""')+'" LIMIT 100;';$('schema').onclick=e=>{const table=e.target.dataset.table;if(table)$('query').value='SELECT * FROM "'+table.replaceAll('"','""')+'" LIMIT 100;';};}).catch(e=>{$('status').textContent=e.message;});
})();
