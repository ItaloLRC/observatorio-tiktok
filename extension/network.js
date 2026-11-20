(()=>{
 const relevant=path=>/\/api\/(?:post\/item_list|item\/detail|comment\/list)/.test(path);
 function failure(input,status){try{const u=new URL(input,location.href);if(u.origin===location.origin&&relevant(u.pathname)&&[403,429].includes(status))window.postMessage({source:'RTR_HTTP_FAILURE',status},location.origin);}catch{}}
 function send(input,text){try{const u=new URL(input,location.href);if(u.origin!==location.origin||!relevant(u.pathname)||text.length>4000000)return;const params={};for(const name of ['aweme_id','item_id','comment_id'])if(u.searchParams.has(name))params[name]=u.searchParams.get(name);window.postMessage({source:'RTR_PUBLIC_RESPONSE',path:u.pathname,params,text},location.origin);}catch{}}
 const original=window.fetch;
 window.fetch=function(...args){const result=original.apply(this,args);result.then(r=>{try{failure(r.url,r.status);if(r.ok&&relevant(new URL(r.url).pathname))r.clone().text().then(text=>send(r.url,text)).catch(()=>{});}catch{}}).catch(()=>{});return result;};
 const open=XMLHttpRequest.prototype.open,urls=new WeakMap();
 XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,url);return open.call(this,method,url,...rest);};
 const xhrSend=XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.send=function(...args){this.addEventListener('load',()=>{try{failure(urls.get(this),this.status);if(this.status===200&&(!this.responseType||this.responseType==='text'))send(urls.get(this),this.responseText);}catch{}});return xhrSend.apply(this,args);};
})();
