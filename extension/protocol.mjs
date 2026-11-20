export function localOrigin(input){const u=new URL(input);if(u.protocol!=='http:'||!['127.0.0.1','localhost'].includes(u.hostname)||u.username||u.password)throw new Error('Use somente o RTR no servidor local.');return u.origin;}
export function jobRoute(route){if(!/^\/api\/jobs(?:\/[a-zA-Z0-9-]+\/(?:browser-(?:start|batch|checkpoint|heartbeat|finish)|cancel))?$/.test(route))throw new Error('Rota do coletor não autorizada.');return route;}
export function profileUrl(handle){if(!/^[a-z0-9_.]{2,24}$/i.test(handle))throw new Error('Canal inválido.');return 'https://www.tiktok.com/@'+handle.toLowerCase();}
export function videoUrl(handle,id){if(!/^\d{15,24}$/.test(String(id)))throw new Error('Vídeo inválido.');return profileUrl(handle)+'/video/'+id;}
