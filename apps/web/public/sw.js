/* Shell only. No API, map, weather, provider or cross-origin response enters this cache.
   Worker lifecycle reference: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers */
const PREFIX = 'zindycast-shell-';
const CACHE = PREFIX + 'v3-' + new URL(self.location.href).search;
const FIXED = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-maskable.svg', '/sky-boot.js'];
function shellAsset(url) {
  return url.origin === self.location.origin && !url.search &&
    (FIXED.includes(url.pathname) || /^\/static\/(js|css)\/(?:async\/)?[a-zA-Z0-9_.-]+\.(js|css)$/.test(url.pathname));
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const response = await fetch('/', { cache: 'reload' });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Shell unavailable');
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => new URL(match[1], self.location.origin)).filter(url => shellAsset(url) && url.pathname.startsWith('/static/'));
  if (!assets.some(url => url.pathname.endsWith('.js'))) throw new Error('No production shell scripts');
  const signature = [...new Set(assets.map(url => url.pathname))].sort().join('|');
  // A deployment may change between release discovery and installation. Never put
  // another release's HTML under this worker's immutable version/cache identity.
  if (signature !== new URL(self.location.href).searchParams.get('build')) throw new Error('Shell release changed during installation');
  const cache = await caches.open(CACHE);
  // Reinstalling this exact identity must not mutate/delete a completed cache
  // that an active worker can still be serving. Bump v3 for worker-only releases.
  if (await cache.match('/')) return;
  try {
    await cache.addAll([...FIXED.filter(path => path !== '/'), ...assets.map(url => url.href)]);
    await cache.put('/', response);
  } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Open tabs may span more than two releases. Keep their immutable assets until
  // an activation with no windows; do not guess a tab's build from its URL.
  // Do not prune while a different release is installing or waiting.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!windows.length && !self.registration.installing && !self.registration.waiting) {
    const names = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE);
    await Promise.all(names.slice(0, -1).map(name => caches.delete(name)));
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !shellAsset(url)) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => {
      // Serve the installed shell consistently; a waiting release is activated by the UI.
      const cached = await (await caches.open(CACHE)).match('/');
      return cached || fetch(event.request);
    })());
  } else {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE)).match(event.request);
      if (cached) return cached;
      // Only hashed scripts/styles may fall back across releases, never HTML or
      // mutable manifest/icons. Read-only fallback cannot cache a weather response.
      if (url.pathname.startsWith('/static/')) {
        const names = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE).reverse();
        for (const name of names) {
          const prior = await (await caches.open(name)).match(event.request);
          if (prior) return prior;
        }
      }
      const response = await fetch(event.request);
      // Retain visited, content-hashed lazy chunks for open tabs across releases.
      // Never cache errors or an HTML fallback returned for a missing script.
      const type = response.headers.get('content-type') || '';
      if (/^\/static\/(js|css)\/async\/[a-zA-Z0-9_-]+\.[a-f0-9]{8,}\.(js|css)$/.test(url.pathname) && response.ok &&
          (url.pathname.endsWith('.js') ? /(?:java|ecma)script/i.test(type) : type.toLowerCase().startsWith('text/css'))) {
        try { await (await caches.open(CACHE)).put(event.request, response.clone()); } catch { /* Storage pressure must not break online rendering. */ }
      }
      return response;
    })());
  }
});

// Only fresh, bounded official-warning payloads. Weather is never cached as live.
self.addEventListener('push', event => event.waitUntil((async () => {
  let p; try {p=event.data?.json();} catch {return;}
  const now=Date.now(),l=p?.location;
  if(!p||typeof p.title!=='string'||p.title.length>120||typeof p.body!=='string'||p.body.length>400||typeof p.tag!=='string'||!/^[A-Za-z0-9_-]{1,32}$/.test(p.tag)||
    !Number.isFinite(p.expiresAt)||p.expiresAt<=now||p.expiresAt>now+180000||!Number.isFinite(p.sentAt)||p.sentAt>now||now-p.sentAt>180000||
    !l||!Number.isFinite(l.latitude)||Math.abs(l.latitude)>90||!Number.isFinite(l.longitude)||Math.abs(l.longitude)>180||typeof l.name!=='string'||l.name.length>160||typeof l.timezone!=='string')return;
  await self.registration.showNotification(p.title,{body:p.body,tag:p.tag,icon:'/icon.svg',data:{location:l,expiresAt:p.expiresAt},requireInteraction:false});
})()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async()=>{
    // Same-origin fixed destination; never open a URL from an incoming payload.
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(w=>new URL(w.url).origin===self.location.origin);
    if(client){client.postMessage({type:'OPEN_WARNING',location:event.notification.data?.location});await client.focus();}
    else {
      const location=event.notification.data?.location;
      const url=new URL('/',self.location.origin);
      if(location)url.hash='warning='+encodeURIComponent(JSON.stringify(location));
      await self.clients.openWindow(url.href);
    }
  })());
});
