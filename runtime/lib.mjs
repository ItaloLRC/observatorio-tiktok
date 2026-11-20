export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const integer = v => v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0 ? null : Math.round(Number(v));
export function normalizeChannel(input) {
 let value=String(input||'').trim();
 if(/^@?[a-zA-Z0-9_.]{2,24}$/.test(value))value='https://www.tiktok.com/@'+value.replace(/^@/,'');
 let u;try{u=new URL(value);}catch{throw new Error('Informe um link de perfil TikTok válido.');}
 if(u.protocol!=='https:'||!['www.tiktok.com','tiktok.com','m.tiktok.com'].includes(u.hostname.toLowerCase())||u.username||u.password||u.port)throw new Error('Use um perfil em https://www.tiktok.com/@usuario.');
 const match=u.pathname.match(/^\/@([a-zA-Z0-9_.]{2,24})\/?$/);if(!match)throw new Error('Use o link do canal, não um vídeo ou link encurtado.');
 const handle=match[1].toLowerCase();return {handle,url:'https://www.tiktok.com/@'+handle};
}
export function parseLossless(input){
 let out='',quoted=false,escape=false;
 for(let i=0;i<input.length;){const c=input[i];if(quoted){out+=c;i++;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;out+=c;i++;continue;}if(c==='-'||/\d/.test(c)){const match=input.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(match){const n=match[0];out+=/^-?\d{16,}$/.test(n)?'"'+n+'"':n;i+=n.length;continue;}}out+=c;i++;}return JSON.parse(out);
}
export function timeFields(id,epoch,source){
 let t=Number(epoch);if(!(t>0)){try{t=Number(BigInt(id)>>32n);source='id_estimate';}catch{return {published_at:null,published_brt:null,hour_brt:null,weekday_brt:null,day_of_month_brt:null,month_brt:null,year_brt:null,timestamp_source:'unknown'};}}
 const utc=new Date(t*1000);if(Number.isNaN(+utc))throw new Error('Timestamp inválido.');
 const local=new Date(+utc-10800000);return {published_at:utc.toISOString(),published_brt:local.toISOString().slice(0,19),hour_brt:local.getUTCHours(),weekday_brt:local.getUTCDay(),day_of_month_brt:local.getUTCDate(),month_brt:local.getUTCMonth()+1,year_brt:local.getUTCFullYear(),timestamp_source:source||'platform_create_time'};
}
export function extractHashtags(raw){
 const description=raw.desc??raw.video_description??raw.text??'';
 const values=[...(raw.hashtag_names||[]),...(raw.hashtags||[]).map(h=>typeof h==='string'?h:h.name??h.title),...(raw.textExtra||raw.text_extra||[]).map(h=>h.hashtagName??h.hashtag_name),...(raw.challenges||[]).map(h=>h.title??h.cha_name),...(description.match(/#[\p{L}\p{N}_]+/gu)||[])];
 return [...new Set(values.filter(Boolean).map(t=>String(t).replace(/^#/,'').normalize('NFC').toLowerCase()).filter(t=>t.length<=120&&!/^\d+$/.test(t)))];
}
export function normalizeVideo(raw,handle){
 const id=String(raw.id||raw.aweme_id||'');if(!/^\d{15,24}$/.test(id))throw new Error('Vídeo sem identificador válido.');
 const s=raw.stats||raw.statistics||raw,description=raw.desc??raw.video_description??raw.text??null;
 const tags=extractHashtags(raw);
 return {id,url:`https://www.tiktok.com/@${handle}/video/${id}`,title:raw.title||description?.slice(0,160)||'Vídeo '+id,description,series:raw.series||'Sem série',...timeFields(id,raw.createTime??raw.create_time,raw.timestamp_source),duration_seconds:integer(raw.video?.duration??raw.videoMeta?.duration??raw.video_duration??raw.duration_s),width:integer(raw.video?.width??raw.videoMeta?.width),height:integer(raw.video?.height??raw.videoMeta?.height),music_id:raw.music?.id?String(raw.music.id):null,music_title:raw.music?.title??null,music_author:raw.music?.authorName??null,language:raw.textLanguage??raw.language??null,region:raw.region_code??null,is_ad:raw.isAd==null?null:Number(!!raw.isAd),is_ai_generated:raw.is_aigc==null?null:Number(!!raw.is_aigc),tags:[...new Set(tags)],tags_known:description!==null||raw.hashtag_names!=null||raw.hashtags!=null||raw.textExtra!=null,views:integer(s.playCount??s.view_count??raw.views),likes:integer(s.diggCount??s.like_count??raw.likes),comment_count:integer(s.commentCount??s.comment_count),shares:integer(s.shareCount??s.share_count??raw.shares),reposts:integer(s.repostCount??s.repost_count),saves:integer(s.collectCount??s.collect_count??s.favorites_count),downloads:integer(s.downloadCount),raw};
}
export function normalizeComment(raw,videoId,parent=null){
 const id=String(raw.cid??raw.id??'');if(!/^\d{10,24}$/.test(id))throw new Error('Comentário sem ID válido.');
 const created=Number(raw.create_time);return {id,video_id:String(videoId),parent_comment_id:parent?String(parent):raw.parent_comment_id&&String(raw.parent_comment_id)!=='0'?String(raw.parent_comment_id):null,author_platform_id:raw.user?.uid?String(raw.user.uid):null,author_handle:raw.user?.unique_id??raw.user?.uniqueId??null,text:raw.text??null,created_at:created>0?new Date(created*1000).toISOString():null,language:raw.comment_language??null,likes:integer(raw.digg_count??raw.like_count),reply_count:integer(raw.reply_comment_total??raw.reply_count),raw};
}
export function extractState(html){
 const values=[];for(const match of html.matchAll(/<script\b[^>]*\bid=["'](?:__UNIVERSAL_DATA_FOR_REHYDRATION__|SIGI_STATE|__NEXT_DATA__)["'][^>]*>([\s\S]*?)<\/script>/g)){try{values.push(parseLossless(match[1]));}catch{}}
 return values;
}
export function extractProfile(states,handle){
 const posts=new Map();let user=null,stats=null;const walk=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>18)return;if((v.id||v.aweme_id)&&(v.video||v.videoMeta||v.stats)&&(v.desc!=null||v.video_description!=null||v.text!=null)){const author=v.author?.uniqueId??v.author?.unique_id??v.authorMeta?.name;if(!author||author.toLowerCase()===handle)posts.set(String(v.id||v.aweme_id),v);}if((v.uniqueId||v.unique_id)?.toLowerCase()===handle&&(!user||v.secUid||!user.secUid&&Object.keys(v).length>Object.keys(user).length)){user=v;}if(v.user?.uniqueId?.toLowerCase()===handle&&v.stats){if(!user||v.user.secUid||!user.secUid)user=v.user;stats=v.stats;}for(const child of Object.values(v))if(child&&typeof child==='object')walk(child,depth+1);};states.forEach(v=>walk(v));return {user,stats,posts:[...posts.values()]};
}
export class SourceError extends Error{constructor(message,code='source_blocked',retryable=false){super(message);this.code=code;this.retryable=retryable;}}
export async function sourceGet(url,options={},fetcher=fetch){
 const response=await fetcher(url,{...options,signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0 (compatible; RTR-Observatorio/1.0; public-data research)','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.5',...options.headers},redirect:'follow'});
 if(!response.ok)throw new SourceError(`A fonte retornou HTTP ${response.status}.`,response.status===429?'rate_limited':'source_http',response.status===429||response.status>=500);
 const body=await response.text();if(!body.trim())throw new SourceError('O TikTok retornou uma resposta vazia. A coleta precisa de uma fonte autorizada ou navegador.');
 if(/captcha|verify to continue|security verification|\/captcha\//i.test(body)&&!body.includes('__UNIVERSAL_DATA_FOR_REHYDRATION__'))throw new SourceError('A fonte exige verificação humana. A coleta foi interrompida; nenhum bloqueio será contornado.','verification_required');
 return body;
}
