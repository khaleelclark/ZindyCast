// Isolated lifecycle fixtures only: no live APIs, tiles, user profile, or server mutations.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('apps/web/dist');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const sw = await readFile(resolve(root, 'sw.js'), 'utf8');
const signature = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]).filter(p=>/^\/static\/(js|css)\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(p)).sort().join('|');
const oldHtml = '<!doctype html><html><body><h1>MOCK OLD RELEASE — static beige map</h1><svg width="500" height="200" style="background:beige"></svg><button hidden id="update">Update and reload</button><script src="/static/js/mock-old.js"></script></body></html>';
const oldJs = `let waiting, applying=false; navigator.serviceWorker.addEventListener('controllerchange',()=>{if(applying)location.reload()}); const observe=reg=>{const inspect=()=>{waiting=reg.waiting;document.querySelector('#update').hidden=!waiting};inspect();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',inspect))};navigator.serviceWorker.register('/sw.js?build='+encodeURIComponent('/static/js/mock-old.js')).then(observe);document.querySelector('#update').onclick=()=>{localStorage.setItem('zindycast.preferences.v1',localStorage.getItem('zindycast.preferences.v1'));applying=true;waiting.postMessage({type:'ACTIVATE_UPDATE'})};`;
const oldSw = `const C='zindycast-shell-mock-old';self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/static/js/mock-old.js']))));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('message',e=>{if(e.data?.type==='ACTIVATE_UPDATE')e.waitUntil(self.skipWaiting())});self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(!u.search&&(u.pathname==='/'||u.pathname==='/static/js/mock-old.js'))e.respondWith(caches.open(C).then(async c=>await c.match(e.request)||fetch(e.request)))})`;
const catalog = JSON.parse(await readFile('docs/verification/map-fix/catalog.json','utf8'));
const frame = JSON.parse(await readFile('docs/verification/map-fix/frame.json','utf8'));
let release='old', currentHtml=html; const requests=[];
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);res.setHeader('Cache-Control','no-cache');
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(url.pathname==='/api/v1/maps')return res.end(JSON.stringify(catalog));if(url.pathname==='/api/v1/maps/frame'){const result=structuredClone(frame);Object.assign(result.data,{projection:'EPSG:3857',productId:url.searchParams.get('product'),requestedTime:url.searchParams.get('time'),bbox:['west','south','east','north'].map(k=>Number(url.searchParams.get(k)))});return res.end(JSON.stringify(result));}res.statusCode=503;return res.end(JSON.stringify({status:'error',code:'provider_error',message:'Isolated lifecycle fixture: provider intentionally unavailable'}));}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(release==='old'?oldHtml:currentHtml);}
 if(url.pathname==='/sw.js'){res.setHeader('Content-Type','application/javascript');return res.end(release==='old'?oldSw:sw);}
 if(url.pathname==='/static/js/mock-next.js'){res.setHeader('Content-Type','application/javascript');return res.end('window.mockNextRelease=true;');}
 if(url.pathname==='/static/js/mock-old.js'){res.setHeader('Content-Type','application/javascript');return res.end(oldJs);}
 const path=resolve(root,'.'+url.pathname);if(!path.startsWith(root+'/'))throw Error('path');res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results=[], workers=[], errors=[];let failure;
try{
 const context=await browser.newContext();await context.route('https://**/*',route=>route.abort());
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('worker',w=>workers.push(w.url()));page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();expect(await page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 const preferences={units:'metric',activity:'strenuous',saved:[{id:'audit-city',name:'Audit City',latitude:38.75,longitude:-121.28,country:'US',timezone:'America/Los_Angeles'}],selected:null};
 await page.evaluate(p=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify(p)),preferences);
 release='current';await page.reload();await expect(page.getByRole('heading',{name:/MOCK OLD RELEASE/})).toBeVisible();results.push('Ordinary online reload retains installed old shell (synthetic old release).');
 // Reproduce old registration requesting old document identity against new strict worker.
 const oldIdentityUpdate=await page.evaluate(async()=>{try{await (await navigator.serviceWorker.getRegistration()).update();await new Promise(r=>setTimeout(r,600));return {waiting:!!(await navigator.serviceWorker.getRegistration()).waiting};}catch(e){return {error:e.message};}});
 results.push({oldIdentityUpdate,meaning:'Synthetic old registration cannot discover new asset signature; not proof of exact historical app behavior.'});
 // Supply the known current release as if an old UI had discovered it: test real browser activation.
 await page.evaluate(async build=>{await navigator.serviceWorker.register('/sw.js?build='+encodeURIComponent(build),{updateViaCache:'none'});},signature);
 await expect(page.getByRole('button',{name:'Update and reload'})).toBeVisible();await page.evaluate(()=>{history.replaceState(history.state,'','#daily');window.scrollTo(0,document.body.scrollHeight);});
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Update and reload'}).click()]);
 await expect.poll(()=>page.evaluate(()=>({hash:location.hash,y:scrollY}))).toEqual({hash:'',y:0});
 await expect(page.getByRole('tab',{name:'Today',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'°C',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zindycast.preferences.v1')))).toEqual(preferences);results.push('Mock old waiting-update click activates actual current worker and React app; all preferences preserved.');
 await page.getByRole('tab',{name:'Maps',exact:true}).click();await expect(page.locator('.maplibregl-canvas')).toBeVisible();await expect(page.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');expect(workers.some(url=>url.endsWith('/vendor/maplibre-6.9.0/maplibre-gl-worker.mjs'))).toBe(true);
 await page.screenshot({path:'docs/verification/update-migration/current-map.png'});results.push('Actual current interactive MapLibre canvas, separate worker and mocked Mercator overlay reached after migration. External basemap intentionally blocked.');
 // Existing current React UI must discover a new HTML identity, not reuse its own.
 currentHtml=html.replace('</head>','<script defer src="/static/js/mock-next.js"></script></head>');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Update and reload'})).toBeVisible();
 await expect(page.locator('.maplibregl-canvas')).toBeVisible();
 expect(await page.evaluate(()=>window.mockNextRelease)).toBeUndefined();
 await page.evaluate(()=>{history.replaceState(history.state,'','#daily');window.scrollTo(0,document.body.scrollHeight);});
 await Promise.all([page.waitForNavigation(),page.getByRole('button',{name:'Update and reload'}).click()]);
 await expect.poll(()=>page.evaluate(()=>({hash:location.hash,y:scrollY}))).toEqual({hash:'',y:0});
 await expect(page.getByRole('tab',{name:'Today',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.mockNextRelease)).toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zindycast.preferences.v1')))).toEqual(preferences);
 results.push('Actual current React PWA discovers changed network HTML on focus, shows waiting update without replacing open map, then Update and reload activates new identity and preserves all preferences. Only an inert marker script simulates next release.');
 const caches=await page.evaluate(async()=>{const result=[];for(const name of await window.caches.keys())for(const request of await(await window.caches.open(name)).keys())result.push(new URL(request.url).pathname);return result;});expect(caches.some(p=>p.startsWith('/api/'))).toBe(false);results.push('No API fixture response cached by service worker.');
 await context.setOffline(true);await page.reload();await expect(page.getByRole('tab',{name:'Today',exact:true})).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('zindycast.preferences.v1')))).toEqual(preferences);results.push('Current installed shell reloads offline with saved preferences.');
 // Independent legacy profile verifies a non-destructive bootstrap path.
 release='old';const recovery=await browser.newContext();await recovery.route('https://**/*',route=>route.abort());const recovered=await recovery.newPage();recovered.setDefaultTimeout(20000);
 await recovered.goto(origin);await recovered.evaluate(()=>navigator.serviceWorker.ready);await recovered.reload();
 await recovered.evaluate(p=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify(p)),preferences);
 release='current';await recovered.goto(origin+'/?update-recovery=1');
 await expect(recovered.getByRole('tab',{name:'Today',exact:true})).toBeVisible();
 await expect(recovered.getByRole('button',{name:'Update and reload'})).toBeVisible();
 await Promise.all([recovered.waitForNavigation(),recovered.getByRole('button',{name:'Update and reload'}).click()]);
 await recovered.goto(origin);await expect(recovered.getByRole('tab',{name:'Today',exact:true})).toBeVisible();
 expect(await recovered.evaluate(()=>JSON.parse(localStorage.getItem('zindycast.preferences.v1')))).toEqual(preferences);
 results.push('Independent synthetic legacy profile recovers through query-bearing root navigation and actual current update button; bare-root navigation subsequently serves current app with preferences intact, without clearing site data.');
 await recovery.close();expect(errors).toEqual([]);
}catch(e){failure=e.stack;throw e;}finally{await writeFile('docs/verification/update-migration/results.json',JSON.stringify({at:new Date().toISOString(),browser:browser.version(),results,workers,errors,failure,requests,limits:'Synthetic old HTML/JS/worker; actual current dist. Ephemeral localhost origin and disposable profile. APIs use saved evidence with query-adapted fixture metadata, not live measurements; all external requests blocked. No physical-device or exact original-build claim.'},null,2));await browser.close();await new Promise(r=>server.close(r));}
console.log(results);
