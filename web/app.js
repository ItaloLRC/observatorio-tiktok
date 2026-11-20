import { parseMinimumViews, selectRecords } from './filters.js';
'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const fmt = (v, d = 0) => v==null?'—':Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const short = n => n==null?'—':n >= 1e6 ? fmt(n / 1e6, 2) + ' mi' : n >= 1e3 ? fmt(n / 1e3, 1) + ' mil' : fmt(n);
  const pct = n => n==null?'—':fmt(n, 2) + '%';
  const duration = n => { const seconds = Math.round(n); return Math.floor(seconds / 60) + 'min' + String(seconds % 60).padStart(2, '0') + 's'; };
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateText = s => s.slice(8, 10) + '/' + s.slice(5, 7);
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const sum = (a, k) => a.reduce((s, r) => s + (typeof k === 'function' ? k(r) : r[k]), 0);
  function stats(a) {
    a=a.filter(v=>typeof v==='number'&&Number.isFinite(v));
    if (!a.length) return { n: 0, total: 0, mean: null, median: null, sd: null, variance: null, min: null, max: null };
    const z = [...a].sort((a, b) => a - b), n = z.length, total = z.reduce((s, v) => s + v, 0), mean = total / n;
    const variance = z.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return { n, total, mean, median: (z[Math.floor((n - 1) / 2)] + z[Math.ceil((n - 1) / 2)]) / 2, sd: Math.sqrt(variance), variance, min: z[0], max: z[n - 1] };
  }
  let all = [], selected = [], hours = [], minN = 3, selectedHour = null, hourSort = 'hour', hourDesc = false, page = 1, matching = [];
  let minimumViews = 0;
  let dayCount = 30, daily = [], series = [], tags = [], lastWidth = 0;
  let loadSequence=0,currentChannel=null,defaultFrom='',defaultTo='';
  const tooltip = $('#tooltip');
  function showTip(e, text) { tooltip.textContent = text; tooltip.hidden = false; tooltip.style.left = Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 10, e.clientX + 15)) + 'px'; tooltip.style.top = Math.max(8, Math.min(window.innerHeight - tooltip.offsetHeight - 10, e.clientY + 15)) + 'px'; }
  function hideTip() { tooltip.hidden = true; }
  function bindTips(container) {
    container.querySelectorAll('[data-tip]').forEach(el => {
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', el.dataset.tip);
      if (el.hasAttribute('data-hour')) {
        el.setAttribute('role', 'button');
        el.setAttribute('aria-pressed', String(Number(el.dataset.hour) === selectedHour));
        el.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.dispatchEvent(new MouseEvent('click')); }
        });
      }
      el.addEventListener('focus', () => { const rect = el.getBoundingClientRect(); showTip({ clientX: rect.x, clientY: rect.y }, el.dataset.tip); });
      el.addEventListener('pointermove', e => showTip(e, el.dataset.tip));
      el.addEventListener('pointerleave', hideTip);
      el.addEventListener('blur', hideTip);
    });
  }
  const metric = (name, value, bottom, icon) => `<article class="metric"><div class="metric-label">${name}<span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-bottom">${bottom}</div></article>`;
  const statLine = (name, value) => `<div class="stat-line"><span>${name}</span><strong>${value}</strong></div>`;
  function filtered() {
    const from = $('#from').value, to = $('#to').value;
    const input = $('#min-views'), parsed = parseMinimumViews(input.value);
    const invalid = parsed === null || input.validity.badInput;
    input.setCustomValidity(invalid ? 'Use um número inteiro maior ou igual a zero.' : '');
    input.setAttribute('aria-invalid', String(invalid));
    $('#filter-error').hidden = !invalid;
    if (invalid) {
      $('#filter-error').textContent = 'Views mínimas: use um inteiro maior ou igual a zero. Os resultados mantêm os últimos filtros válidos.';
      return false;
    }
    minimumViews = parsed;
    if (!from || !to || from > to || from < '2016-01-01' || to > new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())) { $('#filter-result').textContent = 'Escolha um intervalo válido, entre 2016 e hoje.'; $('#filter-result').setAttribute('role', 'alert'); return false; }
    $('#filter-result').removeAttribute('role');
    selected = selectRecords(all, { from, to, series: $('#series').value, minimumViews });
    try { localStorage.setItem('rtr-minimum-views', String(minimumViews)); } catch { /* Storage may be disabled. */ }
    $('#threshold-summary').textContent = minimumViews ? 'Views ≥ ' + fmt(minimumViews) : 'Sem corte de views';
    $('#threshold-summary').classList.toggle('is-active', minimumViews > 0);
    $('#selection-empty').hidden = selected.length > 0 || all.length === 0;
    $('#clear-min-views').hidden = minimumViews === 0;
    dayCount = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) + 1;
    const counts=new Map();for(const r of selected)counts.set(r.date,(counts.get(r.date)||0)+1);
    daily = Array.from({ length: dayCount }, (_, i) => { const d = new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5), date = d.toISOString().slice(0, 10); return { date, weekday: d.getUTCDay(), n: counts.get(date)||0 }; });
    hours = Array.from({ length: 24 }, (_, h) => { const rows = selected.filter(r => r.hour === h); return { hour: h, rows, ...stats(rows.map(r => r.views)) }; });
    series = [...new Set(selected.map(r => r.series))].map(name => { const rows = selected.filter(r => r.series === name), st = stats(rows.map(r => r.views)); return { name, rows, ...st, n:rows.length }; }).sort((a, b) => b.mean - a.mean);
    tags = [...new Set(selected.flatMap(r => r.tags))].map(name => { const rows = selected.filter(r => r.tags.includes(name)); return { name, rows, ...stats(rows.map(r => r.views)), n:rows.length }; }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    if (selectedHour !== null && !hours[selectedHour].n) selectedHour = null;
    page = 1;
    render();
    return true;
  }
  function render() {
    $('#channel-comparison tbody').innerHTML=[...new Set(selected.map(r=>r.channel_id))].map(id=>{const rows=selected.filter(r=>r.channel_id===id),v=stats(rows.map(r=>r.views)),l=stats(rows.map(r=>r.likes)),d=stats(rows.map(r=>r.duration_s)),pairs=rows.filter(r=>r.views>0&&r.likes!=null);return '<tr><td>@'+esc(rows[0].channel_handle)+'</td><td>'+rows.length+'</td><td>'+fmt(v.total)+'</td><td>'+fmt(v.mean,1)+'</td><td>'+fmt(v.median,1)+'</td><td>'+fmt(v.sd,1)+'</td><td>'+fmt(l.mean,1)+'</td><td>'+pct(pairs.length?100*sum(pairs,'likes')/sum(pairs,'views'):null)+'</td><td>'+fmt(d.mean,1)+' s</td></tr>';}).join('')||'<tr><td colspan="9" class="empty">Sem vídeos nesta seleção.</td></tr>';
    const views = stats(selected.map(r => r.views)), likes = stats(selected.map(r => r.likes)), dur = stats(selected.map(r => r.duration_s)), paired=selected.filter(r=>r.views>0&&r.likes!=null),rate=paired.length?100*sum(paired,'likes')/sum(paired,'views'):null;
    $('#filter-result').textContent = `${fmt(selected.length)} de ${fmt(all.length)} vídeos · ${dayCount} ${dayCount===1?'dia':'dias'} · ${fmt(views.n)} com views${minimumViews ? ' · mínimo de ' + fmt(minimumViews) + ' views' : ''}`;
    $('.period-pill').textContent=dateText($('#from').value)+' — '+dateText($('#to').value)+' / '+$('#to').value.slice(0,4);
    $('#metrics').innerHTML = metric('Visualizações acumuladas ≈', short(views.total), `<strong>${views.n?short(views.mean):'—'}</strong> em média por vídeo<br>Mediana: ${views.n?short(views.median):'—'}`, '↗') + metric('Curtidas acumuladas ≈', short(likes.total), `<strong>${views.n?pct(rate):'—'}</strong> curtidas / views`, '♡') + metric('Vídeos na seleção', fmt(selected.length), `<strong>${fmt(selected.length / dayCount, 2)}</strong> publicações por dia`, '▷') + metric('Duração média', dur.n ? duration(dur.mean) : '—', `<strong>${dur.n?fmt(dur.sd, 1)+' s':'—'}</strong> de desvio padrão`, '◷');
    $('#overall-table tbody').innerHTML = [['Visualizações','views'],['Curtidas','likes'],['Comentários','comments'],['Compartilhamentos','shares']].map(([label,key])=>{const st=stats(selected.map(r=>r[key]));return `<tr><td>${label}</td>${['total','mean','median','sd','min','max'].map(k=>`<td>${k==='sd'&&st.n<2?'—':fmt(st[k],k==='mean'||k==='median'||k==='sd'?1:0)}</td>`).join('')}</tr>`;}).join('');
    const active = daily.filter(d => d.n).length, max = Math.max(0, ...daily.map(d => d.n));
    $('#daily-foot').innerHTML = `<span><strong>${active} de ${dayCount}</strong> dias com postagens</span><span>Pico de <strong>${max} vídeos</strong> no mesmo dia</span>`;
    $('#reading-notes').innerHTML = `<div class="note-row"><span>01</span><p>A mediana é <strong>${short(views.median)} views</strong>. A média é ${short(views.mean)}.</p></div><div class="note-row"><span>02</span><p><strong>${selected.filter(r => r.views >= 1e6).length} vídeos</strong> chegaram a pelo menos 1 milhão de visualizações.</p></div><div class="note-row"><span>03</span><p>Compare a <strong>mediana e o tamanho da amostra</strong> antes de escolher um horário.</p></div>`;
    const individual = stats(selected.map(r => r.like_view_pct));
    const complete=selected.filter(r=>r.views>0&&r.likes!=null&&r.comments!=null&&r.shares!=null),ratioRows=selected.filter(r=>r.comments>0&&r.likes!=null);
    $('#engagement').innerHTML = `<div class="stat-list">${statLine('Curtidas / vídeo ≈', short(likes.mean))}${statLine('Curtidas / views · pares disponíveis ≈', pct(rate))}${statLine('Média das taxas individuais ≈', pct(individual.mean))}${statLine('Comentários / vídeo disponível', fmt(stats(selected.map(r=>r.comments)).mean))}${statLine('Compartilhamentos / vídeo disponível ≈', short(stats(selected.map(r=>r.shares)).mean))}${statLine('Curtidas do vídeo / comentário ≈',ratioRows.length?fmt(sum(ratioRows,'likes')/sum(ratioRows,'comments'),2):'—')}${statLine('Reposts / vídeo disponível',short(stats(selected.map(r=>r.reposts)).mean))}${statLine('Interações / views · pares completos ≈', pct(complete.length?100*sum(complete,r=>r.likes+r.comments+r.shares)/sum(complete,'views'):null))}</div>`;
    renderHours(); renderVideos(); renderTags();
    $('#duration-stats').innerHTML = `<div class="stat-list">${statLine('Média', fmt(dur.mean, 2) + ' s')}${statLine('Mediana', fmt(dur.median, 1) + ' s')}${statLine('Mínimo / máximo', dur.n ? duration(dur.min) + ' / ' + duration(dur.max) : '—')}${statLine('Desvio padrão populacional', fmt(dur.sd, 2) + ' s')}${statLine('Variância populacional', fmt(dur.variance, 2) + ' s²')}${statLine('Variância amostral', dur.n > 1 ? fmt(dur.variance * dur.n / (dur.n - 1), 2) + ' s²' : '—')}</div>`;
    drawCharts();
  }
  function renderHours() {
    const eligible = hours.filter(h => h.n >= minN);
    const sorted = [...eligible].sort((a, b) => (hourDesc ? -1 : 1) * (a[hourSort] - b[hourSort]));
    $('#hour-table tbody').innerHTML = sorted.length ? sorted.map(h => `<tr class="${h.hour === selectedHour ? 'selected-hour' : ''}"><td><button class="hour-select" data-select-hour="${h.hour}">${String(h.hour).padStart(2, '0')}h–${String(h.hour).padStart(2, '0')}h59 ↗</button></td><td><span class="sample-badge ${h.n < 3 ? 'low' : ''}">${h.n}</span></td><td><strong>${short(h.mean)}</strong></td><td>${short(h.median)}</td><td>${h.n > 1 ? short(h.sd) : '—'}</td><td>${short(h.min)}</td><td>${short(h.max)}</td><td>${fmt(h.n / dayCount, 3)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Nenhuma faixa atende ao mínimo de vídeos. Reduza o mínimo ou amplie a seleção.</td></tr>';
    $('#hour-table').querySelectorAll('[data-select-hour]').forEach(b => b.addEventListener('click', () => selectHour(Number(b.dataset.selectHour))));
    const detail = $('#hour-detail');
    detail.hidden = selectedHour === null;
    if (selectedHour !== null) {
      const h = hours[selectedHour];
      detail.innerHTML = `<div class="hour-detail-head"><h3>${String(h.hour).padStart(2, '0')}h–${String(h.hour).padStart(2, '0')}h59 · ${h.n} vídeos</h3><button class="text-button" id="close-hour">Fechar ×</button></div><ul>${[...h.rows].sort((a,b)=>b.views-a.views).map(r => `<li><a href="${r.url}" target="_blank" rel="noopener">${esc(r.title)} ↗</a><span>${short(r.views)} views</span></li>`).join('')}</ul>`;
      $('#close-hour').addEventListener('click', () => { selectedHour = null; renderHours(); drawHours(); });
    }
  }
  function selectHour(h) { selectedHour = selectedHour === h ? null : h; hideTip(); renderHours(); drawHours(); if (selectedHour !== null) $('#hour-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  function renderVideos() {
    const term = $('#search').value.trim().toLocaleLowerCase('pt-BR'), key = $('#video-sort').value;
    matching = selected.filter(r => (r.channel_handle + ' ' + r.title + ' ' + r.series + ' ' + r.tags.join(' ')).toLocaleLowerCase('pt-BR').includes(term)).sort((a, b) => typeof a[key] === 'string' ? b[key].localeCompare(a[key]) : b[key] - a[key]);
    const pages = Math.max(1, Math.ceil(matching.length / 10)); page = Math.min(page, pages);
    const visible = matching.slice((page - 1) * 10, page * 10);
    $('#video-table tbody').innerHTML = visible.length ? visible.map(r => `<tr><td><a class="video-title" href="${r.url}" target="_blank" rel="noopener">${esc(r.title)} ↗</a><span class="series-label">@${esc(r.channel_handle)} · ${esc(r.series)}</span></td><td>${dateText(r.date)} <span class="unit">${r.time_estimated_brt.slice(11,16)}</span></td><td>${r.duration_display}</td><td><strong>${short(r.views)}</strong></td><td>${short(r.likes)}</td><td>${pct(r.like_view_pct)}</td><td>${fmt(r.comments)}</td><td>${short(r.shares)}</td><td><button class="mini-button" data-detail="${r.id}">Detalhes</button></td></tr>`).join('') : '<tr><td colspan="9" class="empty">Nenhum vídeo encontrado nesta seleção.</td></tr>';
    $('#video-count').textContent = matching.length + (matching.length===1?' vídeo':' vídeos');
    $('#page-info').textContent = matching.length ? `${(page - 1) * 10 + 1}–${Math.min(page * 10, matching.length)} de ${matching.length} vídeos` : '0 vídeos';
    $('#prev').disabled = page <= 1; $('#next').disabled = page >= pages;
    $('#video-table').querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => openVideo(b.dataset.detail)));
  }
  async function openVideo(id) {
    const r = all.find(r => r.id === id); if (!r) return;
    $('#video-detail').innerHTML = `<span class="kicker">${esc(r.series)}</span><h2>${esc(r.title)}</h2><p>${r.date||'Data indisponível'} · ${r.time_estimated_brt?.slice(11)||'—'} BRT · ${r.timestamp_source==='id_estimate'?'estimado pelo ID':'informado pela fonte'} · ${duration(r.duration_s)}</p><div class="detail-metrics">${[['Visualizações ≈',short(r.views)],['Curtidas ≈',short(r.likes)],['Curtidas / views ≈',pct(r.like_view_pct)],['Comentários',fmt(r.comments)],['Compartilhamentos ≈',short(r.shares)],['Duração',r.duration_display]].map(([l,v])=>`<div><span>${l}</span><strong>${v}</strong></div>`).join('')}</div><h3>Hashtags da publicação</h3><div class="detail-tags">${r.tags.map(t=>`<span>${esc(t)}</span>`).join('')}</div><a href="${r.url}" class="button" target="_blank" rel="noopener">Abrir vídeo no TikTok ↗</a>`;
    const remove=document.createElement('button');remove.className='button danger';remove.textContent='Excluir vídeo';remove.onclick=()=>location.href='/manage.html?kind=video&id='+encodeURIComponent(id);$('#video-detail').append(remove);$('#video-dialog').showModal();
    const container=document.createElement('div');container.className='detail-history';$('#video-detail').append(container);
    let commentsOffset=0;
    async function loadComments(){try{const response=await fetch('/api/videos/'+id+'/comments?offset='+commentsOffset+'&limit=30');const data=await response.json();const html=data.comments.map(c=>`<div class="comment-entry ${c.parent_comment_id?'reply':''}"><strong>${esc(c.author_handle||'Autor não exposto')}</strong>${c.parent_comment_id?' · resposta':''}<p>${esc(c.text||'')}</p><small>♡ ${fmt(c.likes)} · ${fmt(c.reply_count)} respostas · ID ${c.id}</small></div>`).join('');container.querySelector('.detail-comments').insertAdjacentHTML('beforeend',html||'<p class="empty">Ainda não há comentários individuais coletados. A contagem do vídeo é uma métrica separada.</p>');const btn=container.querySelector('.more-comments');btn.hidden=data.next_offset==null;if(data.next_offset!=null)commentsOffset=data.next_offset;container.querySelector('.comment-coverage').textContent=data.total+' comentários/respostas salvos · média de curtidas dos comentários observados: '+fmt(data.statistics.mean_likes,2);}catch{container.querySelector('.detail-comments').textContent='Não foi possível carregar os comentários salvos.';}}
    try{const data=await(await fetch('/api/videos/'+id+'/history')).json();if(!container.isConnected)return;container.innerHTML=`<h3>Histórico de métricas</h3><div class="table-wrap"><table><thead><tr><th>Coletado em</th><th>Views</th><th>Curtidas</th><th>Comentários</th><th>Compart.</th><th>Reposts</th><th>Salvos</th></tr></thead><tbody>${data.history.map(s=>`<tr><td>${esc(s.captured_at.slice(0,19).replace('T',' '))}</td><td>${short(s.views)}</td><td>${short(s.likes)}</td><td>${fmt(s.comment_count)}</td><td>${fmt(s.shares)}</td><td>${fmt(s.reposts)}</td><td>${fmt(s.saves)}</td></tr>`).join('')}</tbody></table></div><h3>Comentários e respostas coletados</h3><p class="comment-coverage"></p><div class="detail-comments"></div><button class="button more-comments" hidden>Carregar mais comentários</button>`;container.querySelector('.more-comments').addEventListener('click',loadComments);await loadComments();}catch{container.textContent='Não foi possível carregar o histórico salvo.';}
  }
  function renderTags() {
    const occurrences = sum(selected, r => r.tags.length);
    $('#tag-summary').textContent = `${tags.length} tags · ${occurrences} usos`;
    $('#all-tags-count').textContent = '(' + tags.length + ')';
    const maxTag = tags[0]?.n || 1;
    $('#tag-bars').innerHTML = tags.length ? tags.slice(0, 15).map(t => `<div><div class="tag-row-head"><a href="#videos" data-tag="${esc(t.name)}">${esc(t.name)}</a><span>${t.n} vídeos · ${fmt(100*t.n/selected.length,1)}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${100*t.n/maxTag}%"></div></div></div>`).join('') : '<p class="empty">Sem hashtags nesta seleção.</p>';
    $('#tag-bars').querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => { $('#search').value = b.dataset.tag; page = 1; renderVideos(); }));
    const maxSeries = series[0]?.mean || 1;
    $('#series-bars').innerHTML = series.length ? series.map(s => `<div><div class="series-row-head"><div>${esc(s.name)}<span>${s.n} ${s.n===1?'vídeo':'vídeos'} · mediana ${short(s.median)}</span></div><strong>${short(s.mean)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${100*s.mean/maxSeries}%"></div></div></div>`).join('') : '<p class="empty">Sem séries nesta seleção.</p>';
    $('#tags-table tbody').innerHTML = tags.map(t => `<tr><td>${esc(t.name)}</td><td>${t.n}</td><td>${pct(100*t.n/selected.length)}</td><td>${short(t.mean)}</td><td>${short(t.median)}</td></tr>`).join('');
  }
  function chart(id, title, height = 225) {
    const el = $('#' + id), w = Math.max(240, el.clientWidth - (window.innerWidth <= 640 ? 18 : 34));
    const p = { left: w < 400 ? 51 : 62, top: 26, right: w - 16, bottom: height - 45 };
    return { el, w, h: height, p, title };
  }
  const text = (x, y, label, anchor = 'start', extra = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}" ${extra}>${esc(label)}</text>`;
  function grid(c, max, label = short) {
    let out = '';
    for (let i = 0; i <= 4; i++) { const y = c.p.bottom - i / 4 * (c.p.bottom - c.p.top); out += `<line class="grid" x1="${c.p.left}" x2="${c.p.right}" y1="${y}" y2="${y}"/>` + text(c.p.left - 8, y + 3, label(max*i/4), 'end'); }
    return out;
  }
  function put(c, svg, footer = '') { c.el.innerHTML = `<svg viewBox="0 0 ${c.w} ${c.h}" role="img" aria-label="${esc(c.title)}"><title>${esc(c.title)}</title>${svg}${footer}</svg>`; bindTips(c.el); }
  function drawDaily() {
    let plotted=daily;if(daily.length>120){const groups=new Map();for(const day of daily){const key=day.date.slice(0,7);if(!groups.has(key))groups.set(key,{date:day.date,n:0,weekday:day.weekday});groups.get(key).n+=day.n;}plotted=[...groups.values()];}else if(daily.length>45){plotted=[];for(let i=0;i<daily.length;i+=7)plotted.push({...daily[i],n:daily.slice(i,i+7).reduce((s,d)=>s+d.n,0)});}
    const c = chart('daily-chart', 'Quantidade de publicações agrupadas por período', 235), max = Math.max(1, ...plotted.map(d => d.n));
    const step = (c.p.right - c.p.left) / Math.max(1,plotted.length), base = c.p.bottom, ph = base-c.p.top;
    let out = grid(c, max, v => Number.isInteger(v)?fmt(v):fmt(v,1));
    plotted.forEach((d, i) => { const x = c.p.left + i * step + step*.2, y = base - d.n/max*ph;
      out += `<rect class="daily-bar ${d.n===max?'peak':''}" x="${x}" y="${y}" width="${step*.6}" height="${base-y}" rx="2"/><rect class="hit" x="${c.p.left+i*step}" y="${c.p.top}" width="${step}" height="${ph}" data-tip="${dateText(d.date)} · ${days[d.weekday]}: ${d.n} vídeos"/>`;
      const tickEvery = Math.max(1,Math.ceil(plotted.length/(c.w<480?4:6)));
      if (i%tickEvery===0) out += text(x+step*.3,base+19,daily.length>120?d.date.slice(5,7)+'/'+d.date.slice(2,4):dateText(d.date),'middle');
    }); put(c,out);
    $('#daily-chart').previousElementSibling.querySelector('.unit').textContent=daily.length>120?'vídeos / mês':daily.length>45?'vídeos / 7 dias':'vídeos / dia';
  }
  function drawHours() {
    const a = hours.filter(h=>h.n>=minN), c=chart('hour-chart','Média e mediana de visualizações por faixa de uma hora',275);
    if (!a.length) { c.el.innerHTML='<p class="empty">Nenhuma faixa atende ao mínimo selecionado.</p>';return; }
    const max=Math.max(1,...a.map(h=>Math.max(h.mean,h.median)))*1.12,step=(c.p.right-c.p.left)/a.length,ph=c.p.bottom-c.p.top;
    let out=grid(c,max,short);
    const tickEvery=Math.max(1,Math.ceil(a.length/(c.w<480?6:16)));
    a.forEach((h,i)=>{const x=c.p.left+i*step, bw=Math.min(22,step*.29),center=x+step/2;
      if(h.hour===selectedHour)out+=`<rect x="${x+1}" y="${c.p.top}" width="${step-2}" height="${ph}" fill="#edf4e7" rx="4"/>`;
      out+=`<rect class="mean-bar" x="${center-bw-1}" y="${c.p.bottom-h.mean/max*ph}" width="${bw}" height="${h.mean/max*ph}" rx="2"/><rect class="median-bar" x="${center+1}" y="${c.p.bottom-h.median/max*ph}" width="${bw}" height="${h.median/max*ph}" rx="2"/>`;
      const tip=`${String(h.hour).padStart(2,'0')}h–${String(h.hour).padStart(2,'0')}h59 · ${h.n} vídeos\nMédia: ${short(h.mean)} views\nMediana: ${short(h.median)}\nDesvio: ${h.n>1?short(h.sd):'—'}`;
      out+=`<rect class="hit" x="${x}" y="${c.p.top}" width="${step}" height="${ph+24}" data-hour="${h.hour}" data-tip="${esc(tip)}"/>`;
      if(i%tickEvery===0||i===a.length-1)out+=text(center,c.p.bottom+20,h.hour+'h','middle');
    });put(c,out);
    c.el.querySelectorAll('[data-hour]').forEach(el=>el.addEventListener('click',()=>selectHour(Number(el.dataset.hour))));
  }
  function drawWeekdays(){
    const c=chart('weekday-chart','Média de publicações por ocorrência de cada dia da semana',245),a=[1,2,3,4,5,6,0].map(day=>{const ds=daily.filter(d=>d.weekday===day);return {day,n:ds.reduce((s,d)=>s+d.n,0),count:ds.length,value:ds.length?ds.reduce((s,d)=>s+d.n,0)/ds.length:0};});
    const max=Math.max(1,...a.map(d=>d.value))*1.18,step=(c.p.right-c.p.left)/7,ph=c.p.bottom-c.p.top;let out=grid(c,max,v=>fmt(v,1));
    a.forEach((d,i)=>{const x=c.p.left+step*i+step*.24,y=c.p.bottom-d.value/max*ph;out+=`<rect class="daily-bar ${d.value===Math.max(...a.map(z=>z.value))?'peak':''}" x="${x}" y="${y}" width="${step*.52}" height="${c.p.bottom-y}" rx="3" data-tip="${days[d.day]}: ${fmt(d.value,2)} vídeos/dia · ${d.n} vídeos em ${d.count} dias"/>`+text(x+step*.26,y-7,fmt(d.value,2),'middle')+text(x+step*.26,c.p.bottom+20,days[d.day],'middle');});put(c,out);
  }
  function drawDuration(){
    const c=chart('duration-chart','Histograma de duração dos vídeos em segundos',280);if(!selected.length){c.el.innerHTML='<p class="empty">Sem vídeos nesta seleção.</p>';return;}
    const ds=selected.map(r=>r.duration_s).filter(v=>typeof v==='number');if(!ds.length){c.el.innerHTML='<p class="empty">Durações ainda não disponíveis.</p>';return;}const binSize=Math.max(30,Math.ceil((Math.max(...ds)-Math.min(...ds))/12/30)*30),lo=Math.floor(Math.min(...ds)/binSize)*binSize,hi=(Math.floor(Math.max(...ds)/binSize)+1)*binSize,a=Array.from({length:(hi-lo)/binSize},(_,i)=>{const lower=lo+i*binSize;return {lower,n:ds.filter(d=>d>=lower&&d<lower+binSize).length};});
    const max=Math.max(1,...a.map(d=>d.n))*1.18,step=(c.p.right-c.p.left)/a.length,ph=c.p.bottom-c.p.top;let out=grid(c,max,v=>fmt(v));a.forEach((d,i)=>{const x=c.p.left+i*step+2,y=c.p.bottom-d.n/max*ph;out+=`<rect class="daily-bar ${d.n===Math.max(...a.map(z=>z.n))?'peak':''}" x="${x}" y="${y}" width="${step-4}" height="${c.p.bottom-y}" rx="2" data-tip="${d.lower}–${d.lower+binSize-1} segundos: ${d.n} vídeos"/>`+text(x+(step-4)/2,y-8,d.n,'middle')+(i%Math.max(1,Math.ceil(a.length/(c.w<480?3:6)))===0?text(x+(step-4)/2,c.p.bottom+20,d.lower+'–'+(d.lower+binSize-1),'middle'):'');});put(c,out,text((c.p.left+c.p.right)/2,c.h-1,'Duração (segundos)','middle'));
  }
  function drawCharts(){drawDaily();drawHours();drawWeekdays();drawDuration();}
  function exportRows(){
    const keys=['channel_handle','title','series','time_estimated_brt','timestamp_source','duration_s','views','likes','like_view_pct','comments','shares','reposts','saves','likes_per_comment','comments_loaded','tags','url'],e=v=>'"'+String(v).replaceAll('"','""')+'"';
    const csv='\ufeff'+[keys.map(e).join(';'),...matching.map(r=>keys.map(k=>e(Array.isArray(r[k])?r[k].join(' '):r[k])).join(';'))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='rtr-videos-selecionados.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function loadChannel(id){const sequence=++loadSequence;const res=await fetch('/api/data?channel_id='+encodeURIComponent(id));const data=await res.json();if(!res.ok)throw new Error(data.error);if(sequence!==loadSequence)return;const loaded=data.records;let offset=data.next_offset;while(offset!=null){const pageResponse=await fetch('/api/data?channel_id='+encodeURIComponent(id)+'&offset='+offset);const page=await pageResponse.json();if(!pageResponse.ok)throw new Error(page.error);if(sequence!==loadSequence)return;loaded.push(...page.records);offset=page.next_offset;}all=loaded;currentChannel=data.channel;
    const dates=all.map(r=>r.date).filter(Boolean).sort();defaultFrom=dates[0]||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());defaultTo=dates.at(-1)||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
    for(const el of [$('#from'),$('#to')]){el.min='2016-01-01';el.max=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());}$('#from').value=defaultFrom;$('#to').value=defaultTo;
    $('#series').innerHTML='<option value="all">Todas as séries</option>'+[...new Set(all.map(r=>r.series))].sort().map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    $('.topbar strong').textContent=id==='all'?'Todos os canais':'@'+currentChannel.handle;$('.channel-mini strong').textContent=currentChannel.display_name||currentChannel.handle;$('.channel-mini div>span').textContent=id==='all'?'Visão conjunta':'@'+currentChannel.handle;$('#total-video-count').textContent=all.length;
    $('#analysis-channel').value=id;$('#analysis-coverage').textContent=id==='all'&&!all.length?'Nenhum vídeo na base. Cadastre ou atualize um canal no Coletor.':(id==='all'?'Todos os canais ativos · estatísticas calculadas por vídeo':currentChannel.coverage==='source_exhausted'?'Fim da fonte confirmado':'Cobertura parcial / não confirmada')+' · '+all.length+' vídeos no banco';
    $('#search').value='';selectedHour=null;page=1;filtered();window.dispatchEvent(new CustomEvent('rtr-channel-loaded',{detail:{channel:currentChannel}}));
  }
  window.RTR={loadChannel};
  async function init(){
    try{const saved = (() => { try { return parseMinimumViews(localStorage.getItem('rtr-minimum-views')); } catch { return 0; } })();
      $('#min-views').value = String(saved ?? 0);
      const boot=await(await fetch('/api/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();if(boot.error)throw new Error(boot.error);const channelData=await(await fetch('/api/channels')).json();$('#analysis-channel').innerHTML='<option value="all">Todos</option>'+channelData.channels.map(c=>`<option value="${c.id}">@${esc(c.handle)}</option>`).join('');await loadChannel('all');$('#analysis-channel').addEventListener('change',()=>loadChannel($('#analysis-channel').value).catch(console.error));
      for(const id of ['series','from','to'])$('#'+id).addEventListener('change',filtered);
      $('#min-views').addEventListener('input', filtered);
      $('#min-views').addEventListener('change', () => { if ($('#min-views').value === '' && !$('#min-views').validity.badInput) $('#min-views').value = '0'; filtered(); });
      $('#clear-min-views').addEventListener('click', () => { $('#min-views').value = '0'; filtered(); $('#min-views').focus(); });
      $('#reset').addEventListener('click',()=>{$('#min-views').value='0';$('#series').value='all';$('#from').value=defaultFrom;$('#to').value=defaultTo;$('#search').value='';$('#min-n').value='3';minN=3;selectedHour=null;filtered();});
      $('#min-n').addEventListener('change',()=>{minN=Number($('#min-n').value);selectedHour=null;renderHours();drawHours();});
      document.querySelectorAll('[data-hour-sort]').forEach(b=>b.addEventListener('click',()=>{if(hourSort===b.dataset.hourSort)hourDesc=!hourDesc;else{hourSort=b.dataset.hourSort;hourDesc=true;}renderHours();}));
      $('#search').addEventListener('input',()=>{page=1;renderVideos();});$('#video-sort').addEventListener('change',()=>{page=1;renderVideos();});
      $('#prev').addEventListener('click',()=>{page--;renderVideos();});$('#next').addEventListener('click',()=>{page++;renderVideos();});
      $('#export').addEventListener('click',exportRows);$('#close-dialog').addEventListener('click',()=>$('#video-dialog').close());
      $('#video-dialog').addEventListener('click',e=>{if(e.target===$('#video-dialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}});
      const nav=[...document.querySelectorAll('.sidebar nav a')];new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting)nav.forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));}},{rootMargin:'-10% 0px -65% 0px',threshold:0}).observe($('#visao-geral'));
      const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)nav.forEach(a=>a.classList.toggle('active',a.hash==='#'+e.target.id));},{rootMargin:'-15% 0px -70% 0px',threshold:0});document.querySelectorAll('section[id]').forEach(s=>observer.observe(s));
      document.querySelectorAll('.table-wrap').forEach((region,index)=>{region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label','Tabela de dados '+(index+1)+' · role para explorar as colunas');});
      filtered();new ResizeObserver(entries=>{const w=entries[0].contentRect.width;if(Math.abs(w-lastWidth)>1){lastWidth=w;drawCharts();}}).observe($('#main'));
      window.addEventListener('scroll',hideTip,{passive:true});
    }catch(e){$('#load-error').hidden=false;$('#load-error').textContent='Não foi possível carregar a análise. Recarregue a página para tentar novamente.';$('#filter-result').textContent='Dados não carregados';console.error(e);}
  }
  init();
})();
