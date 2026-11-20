export const finite=v=>typeof v==='number'&&Number.isFinite(v);
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
export function correlation(pairs){
 const a=pairs.filter(p=>p.every(finite));if(a.length<2)return {n:a.length,r:null};
 const mx=mean(a.map(p=>p[0])),my=mean(a.map(p=>p[1]));let xx=0,yy=0,xy=0;
 for(const [x,y]of a){xx+=(x-mx)**2;yy+=(y-my)**2;xy+=(x-mx)*(y-my);}
 return {n:a.length,r:xx&&yy?Math.max(-1,Math.min(1,xy/Math.sqrt(xx*yy))):null};
}
export function regression(X,y){
 const n=y.length,p=X[0]?.length||0;if(!p||n<=p+1)throw Error('Use mais vídeos completos que o número de variáveis + 1.');
 if(X.length!==n||X.some(r=>r.length!==p||!r.every(finite))||!y.every(finite))throw Error('Dados numéricos incompletos.');
 const means=Array.from({length:p},(_,j)=>mean(X.map(r=>r[j]))),scales=means.map((m,j)=>Math.sqrt(mean(X.map(r=>(r[j]-m)**2))));
 if(scales.some(s=>!s))throw Error('Uma variável explicativa é constante nesta seleção.');
 const cols=[Array(n).fill(1),...means.map((m,j)=>X.map(r=>(r[j]-m)/scales[j]))],q=[],R=cols.map(()=>cols.map(()=>0));
 // Twice reorthogonalized modified Gram-Schmidt on standardized columns.
 for(let j=0;j<cols.length;j++){
  let v=[...cols[j]];for(let pass=0;pass<2;pass++)for(let i=0;i<j;i++){const dot=q[i].reduce((s,z,k)=>s+z*v[k],0);R[i][j]+=dot;v=v.map((z,k)=>z-dot*q[i][k]);}
  R[j][j]=Math.sqrt(v.reduce((s,z)=>s+z*z,0));if(R[j][j]<1e-8*Math.sqrt(n))throw Error('Variáveis redundantes ou quase colineares. Remova uma delas.');q.push(v.map(z=>z/R[j][j]));
 }
 const b=q.map(c=>c.reduce((s,z,k)=>s+z*y[k],0));for(let i=b.length-1;i>=0;i--){for(let j=i+1;j<b.length;j++)b[i]-=R[i][j]*b[j];b[i]/=R[i][i];}
 const coefficients=b.slice(1).map((v,j)=>v/scales[j]),intercept=b[0]-coefficients.reduce((s,v,j)=>s+v*means[j],0),predicted=X.map(r=>intercept+r.reduce((s,v,j)=>s+v*coefficients[j],0));
 const residuals=y.map((v,i)=>v-predicted[i]),sse=residuals.reduce((s,v)=>s+v*v,0),my=mean(y),sst=y.reduce((s,v)=>s+(v-my)**2,0),r2=sst?1-sse/sst:null;
 return {n,p,intercept,coefficients,predicted,residuals,r2,adjustedR2:r2==null?null:1-(1-r2)*(n-1)/(n-p-1),rmse:Math.sqrt(sse/n)};
}
export const features=[
 ['views','Visualizações'],['likes','Curtidas'],['duration_s','Duração (s)'],['comments','Comentários do vídeo'],['shares','Compartilhamentos'],['reposts','Reposts'],['saves','Salvamentos'],['downloads','Downloads'],['tag_count','Quantidade de tags'],['hour','Hora BRT (0–23)'],['weekday','Dia da semana (dom=0)'],['day_of_month','Dia do mês'],['like_view_pct','Curtidas / views (%)'],['likes_per_comment','Curtidas do vídeo / comentário'],['comments_loaded','Comentários coletados'],['age_days','Idade na coleta (dias)'],['width','Largura (px)'],['height','Altura (px)']
].map(([key,label])=>({key,label,get:r=>key==='tag_count'?r.tags?.length??null:key==='age_days'?(r.time_estimated_brt&&r.captured_at?Math.max(0,(Date.parse(r.captured_at)-Date.parse(r.time_estimated_brt+'-03:00'))/864e5):null):r[key]}));
