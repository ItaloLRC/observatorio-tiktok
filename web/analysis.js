import {parseMinimumViews,selectRecords} from './filters.js';
import {$,esc,fmt,api,records,navigation} from './shared.js';
import {features,finite,correlation,regression} from './statistics.js';
navigation();
try { $('min-views').value=String(parseMinimumViews(localStorage.getItem('rtr-minimum-views'))??0); } catch {}
let all=[],chosen=[],model=null,points=[],loadId=0;const colors=['#39754f','#bb7739','#5b76ad','#a4577b','#498e94','#8866a8','#718326','#98412d','#427ba1','#a78127','#464f76','#ad5b59'];
const feature=k=>features.find(f=>f.key===k),label=k=>feature(k).label;
for(const id of ['x','y'])$(id).innerHTML=features.map(f=>`<option value="${f.key}">${f.label}</option>`).join('');$('x').value='duration_s';$('y').value='views';
for(const [id,defaults] of [['predictors',['duration_s','age_days']],['matrix-features',['duration_s','views','likes','comments']]])$(id).innerHTML=features.map(f=>`<label><input type="checkbox" value="${f.key}" ${defaults.includes(f.key)?'checked':''}>${f.label}</label>`).join('');
function value(r,k){let v=feature(k).get(r);if(!finite(v))return null;if($('scale').value==='log')return v>=0?Math.log1p(v):null;return v;}
const checked=id=>[...$(id).querySelectorAll('input:checked')].map(el=>el.value);
function update(){
 const from=$('from').value,to=$('to').value;if(from&&to&&from>to){$('scope-info').textContent='O início deve ser anterior ao fim.';return;}
 const input=$('min-views'), minimumViews=parseMinimumViews(input.value),invalid=minimumViews===null||input.validity.badInput;
 input.setCustomValidity(invalid?'Use um número inteiro maior ou igual a zero.':'');input.setAttribute('aria-invalid',String(invalid));$('filter-error').hidden=!invalid;
 if(invalid){$('filter-error').textContent='Views mínimas: use um inteiro maior ou igual a zero. Os resultados mantêm os últimos filtros válidos.';return;}
 try{localStorage.setItem('rtr-minimum-views',String(minimumViews));}catch{}
 chosen=selectRecords(all,{from:from||'0000-01-01',to:to||'9999-12-31',minimumViews});$('scope-info').textContent=`${chosen.length} de ${all.length} vídeos ativos · ${new Set(chosen.map(r=>r.channel_id)).size} canais · datas em Brasília · métricas mais recentes por vídeo${minimumViews?' · mínimo de '+fmt(minimumViews,0)+' views':' · sem corte de views'}`;
 $('multiple').hidden=$('mode').value!=='multiple';$('x').disabled=$('mode').value==='multiple';
 for(const input of $('predictors').querySelectorAll('input'))input.disabled=input.value===$('y').value;
 const xs=$('mode').value==='simple'?[$('x').value]:checked('predictors').filter(k=>k!==$('y').value),yk=$('y').value;
 points=chosen.map(r=>({r,x:xs.map(k=>value(r,k)),y:value(r,yk)})).filter(p=>p.x.every(finite)&&finite(p.y));model=null;
 try{
  if(xs.includes(yk))throw Error('Escolha variáveis diferentes para X e Y.');
  model=regression(points.map(p=>p.x),points.map(p=>p.y));
  const pair=xs.length===1?correlation(points.map(p=>[p.x[0],p.y])):null;
  $('model-note').textContent=`${points.length} vídeos no ajuste · ${chosen.length-points.length} excluídos por dados ausentes ou escala incompatível. ${$('scale').value==='log'?'X e Y transformados em log(1 + valor).':'Valores nas unidades originais.'}`;
  $('model-metrics').innerHTML=[['Vídeos no ajuste',fmt(model.n,0)],['R²',fmt(model.r2,4)],['R² ajustado',fmt(model.adjustedR2,4)],['Erro RMSE',fmt(model.rmse)]].map(([l,v])=>`<div class="metric"><span>${l}</span><strong>${v}</strong></div>`).join('');
  $('coefficients').innerHTML=[['Intercepto',model.intercept],...xs.map((k,i)=>[label(k),model.coefficients[i]])].map(([l,v])=>`<tr><td>${l}</td><td>${fmt(v,6)}</td></tr>`).join('');
  $('equation').textContent=($('scale').value==='log'?'log(1 + Y)':'Y')+' = '+fmt(model.intercept,6)+model.coefficients.map((b,i)=>(b<0?' − ':' + ')+fmt(Math.abs(b),6)+' × '+($('scale').value==='log'?'log(1 + '+label(xs[i])+')':label(xs[i]))).join('');
  $('fit-info').textContent=(pair?'Pearson r: '+fmt(pair.r,4)+' · ':'')+'Y: '+label(yk)+'. RMSE na escala do modelo.';draw(xs,yk);
 }catch(e){$('model-note').textContent=e.message+` ${points.length} vídeos completos de ${chosen.length}.`;$('model-metrics').innerHTML='';$('coefficients').innerHTML='';$('equation').textContent='Ajuste indisponível';$('fit-info').textContent='';$('plot').innerHTML='<p class="empty">Escolha variáveis com dados e variação suficientes.</p>';$('legend').innerHTML='';}
 $('export-points').disabled=$('export-chart').disabled=!model;matrix();
}
function draw(xs,yk){
 const simple=$('mode').value==='simple',W=850,H=470,P={l:88,r:825,t:25,b:400},xx=points.map(p=>simple?p.x[0]:p.y),yy=points.map((p,i)=>simple?p.y:model.predicted[i]);
 const range=a=>{const lo=Math.min(...a),hi=Math.max(...a),pad=(hi-lo||Math.abs(lo)||1)*.07;return [lo-pad,hi+pad];};const [xmin,xmax]=range(xx),[ymin,ymax]=range(yy),sx=x=>P.l+(x-xmin)/(xmax-xmin)*(P.r-P.l),sy=y=>P.b-(y-ymin)/(ymax-ymin)*(P.b-P.t);
 const channels=[...new Set(points.map(p=>p.r.channel_handle))],color=h=>colors[channels.indexOf(h)]||('hsl('+((channels.indexOf(h)*137.508)%360)+' 45% 40%)');let svg='';
 for(let i=0;i<=5;i++){const x=xmin+i/5*(xmax-xmin),y=ymin+i/5*(ymax-ymin);svg+=`<line x1="${P.l}" x2="${P.r}" y1="${sy(y)}" y2="${sy(y)}" stroke="#e2e8db"/><text x="${P.l-9}" y="${sy(y)+4}" text-anchor="end">${fmt(y,1)}</text><text x="${sx(x)}" y="${P.b+24}" text-anchor="middle">${fmt(x,1)}</text>`;}
 const transform=$('scale').value==='log'?' · log(1 + valor)':'';
 const lineY=x=>simple?model.intercept+model.coefficients[0]*x:x;
 svg+=`<defs><clipPath id="plot-area"><rect x="${P.l}" y="${P.t}" width="${P.r-P.l}" height="${P.b-P.t}"/></clipPath></defs><g clip-path="url(#plot-area)"><line x1="${sx(xmin)}" x2="${sx(xmax)}" y1="${sy(lineY(xmin))}" y2="${sy(lineY(xmax))}" stroke="#b66c32" stroke-width="2" ${simple?'':'stroke-dasharray="7 5"'}/>`;
 for(let i=0;i<points.length;i++){const p=points[i];svg+=`<a href="${esc(p.r.url)}" target="_blank" rel="noopener"><circle cx="${sx(xx[i])}" cy="${sy(yy[i])}" r="4.7" fill="${color(p.r.channel_handle)}" fill-opacity=".68" stroke="white" stroke-width=".7"><title>${esc('@'+p.r.channel_handle+' · '+p.r.title+'\nX: '+fmt(xx[i],4)+' · Y: '+fmt(yy[i],4)+'\nPublicado: '+p.r.date)}</title></circle></a>`;}
 svg+=`</g><text x="${(P.l+P.r)/2}" y="455" text-anchor="middle">${esc(simple?label(xs[0])+transform:'Observado · '+label(yk)+transform)}</text><text transform="translate(18 215) rotate(-90)" text-anchor="middle">${esc(simple?label(yk)+transform:'Previsto · '+label(yk)+transform)}</text>`;
 $('plot').innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de dispersão dos vídeos e regressão linear">${svg}</svg>`;$('legend').innerHTML=channels.map(h=>`<span><i style="background:${color(h)}"></i>@${esc(h)}</span>`).join('')+`<span>${simple?'― Regressão ajustada':'┄ Referência: previsto = observado'}</span>`;
}
function matrix(){const keys=checked('matrix-features');$('matrix-note').textContent=keys.length+' variáveis · r de −1 a +1 · verde: associação positiva; laranja: negativa; traço: sem variação ou amostra insuficiente.';
 $('matrix').innerHTML=keys.length?'<table class="matrix"><thead><tr><th>Feature</th>'+keys.map(k=>'<th>'+label(k)+'</th>').join('')+'</tr></thead><tbody>'+keys.map(a=>'<tr><th>'+label(a)+'</th>'+keys.map(b=>{const {r,n}=correlation(chosen.map(row=>[value(row,a),value(row,b)]));const bg=r==null?'#f1f3ee':r>=0?`rgba(79,139,78,${.08+.55*Math.abs(r)})`:`rgba(201,125,65,${.08+.55*Math.abs(r)})`;return `<td><button data-x="${a}" data-y="${b}" style="background:${bg}" title="${label(a)} × ${label(b)}; ${n} pares">${fmt(r,3)}<small>n = ${n}</small></button></td>`;}).join('')+'</tr>').join('')+'</tbody></table>':'<p class="empty">Selecione pelo menos uma variável.</p>';
 $('matrix').querySelectorAll('[data-x]').forEach(el=>el.onclick=()=>{if(el.dataset.x===el.dataset.y)return;$('mode').value='simple';$('x').value=el.dataset.x;$('y').value=el.dataset.y;update();$('model-note').scrollIntoView({behavior:'smooth',block:'center'});});}
async function load(){const id=++loadId;$('scope-info').textContent='Carregando vídeos do banco…';try{const data=await records($('scope').value);if(id!==loadId)return;all=data;const dates=all.map(r=>r.date).filter(Boolean).sort();$('from').value=dates[0]||'';$('to').value=dates.at(-1)||'';update();}catch(e){$('scope-info').textContent=e.message;}}
for(const id of ['from','to','mode','x','y','scale','predictors','matrix-features'])$(id).addEventListener('change',update);$('scope').onchange=load;$('reload').onclick=load;
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-chart').onclick=()=>{const svg=$('plot').querySelector('svg').cloneNode(true);svg.insertAdjacentHTML('afterbegin','<style>text{font:12px system-ui;fill:#425b49}svg{background:white}</style>');download(new XMLSerializer().serializeToString(svg),'rtr-regressao.svg','image/svg+xml');};
$('export-points').onclick=()=>{const xs=$('mode').value==='simple'?[$('x').value]:checked('predictors').filter(k=>k!==$('y').value),quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const rows=[['canal','video_id','titulo',...xs,$('y').value,'previsto','residuo','escala'],...points.map((p,i)=>[p.r.channel_handle,p.r.id,p.r.title,...p.x,p.y,model.predicted[i],model.residuals[i],$('scale').value])];download('\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n'),'rtr-modelo.csv','text/csv;charset=utf-8');};
try{const data=await api('/api/channels');$('scope').insertAdjacentHTML('beforeend',data.channels.map(c=>`<option value="${c.id}">@${esc(c.handle)}</option>`).join(''));await load();}catch(e){$('scope-info').textContent=e.message;}


$('min-views').addEventListener('input',update);
$('min-views').addEventListener('change',()=>{if($('min-views').value===''&&!$('min-views').validity.badInput)$('min-views').value='0';update();});
