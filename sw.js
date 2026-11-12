'use strict';
const CACHE='terminal-notes-offline-v5';
const SHELL=['./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const urls=SHELL.map(path=>new URL(path,self.location).href);
async function valid(response,url){
  if(!response.ok||response.redirected)return false;
  const path=new URL(url).pathname;
  const mime=response.headers.get('content-type')||'';
  if(path.endsWith('.html'))return /html/.test(mime)&&(await response.clone().text()).includes('<title>Terminal Notes</title>');
  if(path.endsWith('.png'))return /image\/png/.test(mime);
  if(path.endsWith('.svg'))return /svg/.test(mime);
  return /json|manifest/.test(mime);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const responses=await Promise.all(urls.map(async url=>{
    const response=await fetch(url,{cache:'reload',credentials:'same-origin',redirect:'error'});
    if(!await valid(response,url))throw Error('Incomplete Terminal Notes update');
    return response;
  }));
  const cache=await caches.open(CACHE);
  await Promise.all(urls.map((url,i)=>cache.put(url,responses[i])));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('terminal-notes-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),base=new URL('./',self.location);
  if(request.method!=='GET'||url.origin!==base.origin)return;
  if(request.mode==='navigate'&&(url.pathname===base.pathname||url.pathname===base.pathname+'index.html')){
    event.respondWith((async()=>{
      try{const response=await fetch(request,{cache:'no-store'});if(response.ok)return response;throw Error('Offline');}
      catch{const saved=await caches.match(new URL('./index.html',self.location).href,{cacheName:CACHE});return saved||Response.error();}
    })());return;
  }
  if(urls.includes(url.href))event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    return (await cache.match(request))||fetch(request);
  })());
});
