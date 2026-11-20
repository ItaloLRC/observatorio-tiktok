export const $=id=>document.getElementById(id);
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:d}):'—';
export async function api(url,body){const r=await fetch(url,{cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error||'Falha no banco.');return data;}
export async function records(id){const all=[];let offset=0;do{const data=await api('/api/data?channel_id='+encodeURIComponent(id)+'&offset='+offset);all.push(...data.records);offset=data.next_offset;}while(offset!=null);return all;}
export function navigation(){document.querySelector('nav').innerHTML='<a href="/">← Observatório</a><a href="/analysis.html">Correlações e regressão</a><a href="/manage.html">Gerenciar dados</a><a href="/database.html">Diagrama</a><a href="/sql.html">SQL</a><a href="/exports.html">Exportar</a>';}
