import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ForecastRadarCatalogResponseSchema } from '@zindycast/contracts';
import { forecastRegionAllowed, forecastTilePath, forecastTileSession as createTileSession, ForecastTileClient, futureFrames, forecastPlaybackFrames } from './forecast-map';
const forecastTileSession: typeof createTileSession = (frame, changed, fetcher, client = new ForecastTileClient(() => now)) => createTileSession(frame, changed, fetcher, client);
const run = '2026-09-11T14:00:00Z';
const tileHeaders = (f: { id: string; modelRunTime: string; validTime: string }) => ({ 'Content-Type': 'image/png', 'X-Forecast-Product': 'forecast-hrrr-conus', 'X-Forecast-Frame': f.id, 'X-Forecast-Model-Run': f.modelRunTime, 'X-Forecast-Valid-Time': f.validTime, 'X-Forecast-Source-Time-Status': 'pinned_model_run_requested' });
const now = Date.parse('2026-09-11T16:15:00Z');
const frames = Array.from({ length: 12 }, (_, i) => ({ id: `hrrr-202609111400-f${String(150 + i * 15).padStart(4, '0')}`, modelRunTime: run, forecastLeadMinutes: 150 + i * 15, validTime: new Date(Date.parse(run) + (150 + i * 15) * 60000).toISOString() }));
const raw = { status: 'success', freshness: 'fresh', data: { provider: 'Iowa Environmental Mesonet', sourceModel: 'NOAA/NCEP HRRR', version: 'iem-hrrr-refd-v1', productId: 'forecast-hrrr-conus', classification: 'modeled', temporalKind: 'forecast', quantity: 'simulated_reflectivity_1000m_agl', units: 'dBZ', region: 'CONUS', coverageState: 'unknown', retrievedAt: '2026-09-11T16:00:00Z', evaluatedAt: new Date(now).toISOString(), modelRunTime: run, horizonEnd: '2026-09-12T08:00:00Z', frames, defaultFrameId: frames[0]!.id, sourceUrl: 'https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json', attribution: 'NOAA/NCEP HRRR; Iowa Environmental Mesonet', legend: { kind: 'illustrative', explanation: 'Simulated reflectivity; quantitative palette not independently verified. Blank pixels do not establish no precipitation or model coverage.' }, sourceTimeStatus: 'pinned_model_run_requested', actualSourceTime: null } };
async function png() { const doc = await readFile('docs/decisions/future-radar.md', 'utf8'); return Buffer.from(doc.split('```base64\n')[1]!.split('\n```')[0]!, 'base64'); }
test('future eligibility preserves pinned run and rejects past/expired/mismatched catalogs', () => {
  const parsed = ForecastRadarCatalogResponseSchema.parse(raw); assert.equal(parsed.status, 'success'); if (parsed.status !== 'success') return;
  assert.equal(futureFrames(parsed, now).length, 12);
  assert.equal(futureFrames(parsed, Date.parse(frames[0]!.validTime)).length, 11);
  assert.equal(futureFrames(parsed, Date.parse(run) + 4 * 3600000 + 1).length, 0);
  assert.throws(() => ForecastRadarCatalogResponseSchema.parse({ ...raw, data: { ...raw.data, frames: [{ ...frames[0], modelRunTime: '2026-09-11T15:00:00Z' }] } }));
  assert.equal(forecastTilePath(frames[0]!.id, 4, 3, 6), `/api/v1/maps/forecast/tiles/${frames[0]!.id}/4/3/6.png`);
  for (const coords of [[8, 1, 1], [4, 16, 1], [4, 1, -1], [4, 1.5, 2]]) assert.throws(() => forecastTilePath(frames[0]!.id, coords[0]!, coords[1]!, coords[2]!));
  assert.throws(() => forecastTilePath('https://evil.invalid/x', 4, 3, 6));
  for (const [latitude, longitude] of [[61, -149], [21, -157], [51, -100], [25, -130]]) assert.equal(forecastRegionAllowed({ id: 'test', name: 'Test', country: 'US', timezone: 'UTC', latitude: latitude!, longitude: longitude! }), false);
});
test('playback spans advertised horizon within six-frame and 32-tile bounds, including sparse times', () => {
  for (const tiles of [1, 4, 5, 6, 8, 10, 16, 17, 32]) {
    const sampled = forecastPlaybackFrames(frames, tiles);
    assert.ok(sampled.length <= 6 && sampled.length * tiles <= 32);
    if (tiles > 16) { assert.deepEqual(sampled, []); continue; }
    assert.equal(sampled[0], frames[0]); assert.equal(sampled.at(-1), frames.at(-1));
    assert.ok(sampled.every((f, i) => frames.includes(f) && (!i || f.validTime > sampled[i - 1]!.validTime)));
  }
  assert.deepEqual(forecastPlaybackFrames(frames, 8).map(f => frames.indexOf(f)), [0, 4, 7, 11]);
  assert.deepEqual(forecastPlaybackFrames(frames, 4).map(f => frames.indexOf(f)), [0, 2, 4, 7, 9, 11]);
  const sparse = frames.filter((_, i) => ![2, 3, 8].includes(i));
  assert.ok(forecastPlaybackFrames(sparse, 4).every(f => sparse.includes(f)));
  assert.deepEqual(forecastPlaybackFrames([], 1), []);
  assert.deepEqual(forecastPlaybackFrames(frames.slice(0, 1), 1), []);
});
test('tile session serializes selected visible work, no-store XYZ, disposal fences queued requests', async () => {
  const image = await png(); const paths: string[] = []; const options: RequestInit[] = []; let active = 0; let max = 0;
  const session = forecastTileSession(frames[0]!, () => {}, (async (path, init) => { paths.push(String(path)); options.push(init!); max = Math.max(max, ++active); await new Promise(r => setTimeout(r, 10)); active--; return new Response(image, { headers: tileHeaders(frames[0]!) }); }) as typeof fetch);
  await Promise.all([session.load(4, 3, 6, new AbortController().signal), session.load(4, 4, 6, new AbortController().signal)]);
  assert.equal(max, 1); assert.equal(paths.length, 2); assert.ok(paths[0]!.endsWith('/4/3/6.png')); assert.equal(options[0]!.cache, 'no-store'); assert.equal(options[0]!.redirect, 'error'); assert.equal(options[0]!.credentials, 'omit');
  session.dispose(); await assert.rejects(session.load(4, 3, 6, new AbortController().signal), /ended/); assert.equal(paths.length, 2);
});
test('429 stops whole session and queued work; malformed/bounded PNG rejected; abort signals propagated', async () => {
  let requests = 0; const statuses: string[] = [];
  const limited = forecastTileSession(frames[0]!, status => statuses.push(status.error), (async () => { requests++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); }) as typeof fetch);
  const results = await Promise.allSettled([limited.load(4, 3, 6, new AbortController().signal), limited.load(4, 4, 6, new AbortController().signal)]);
  assert.ok(results.every(r => r.status === 'rejected')); assert.equal(requests, 1); assert.ok(statuses.some(s => /Wait 60 seconds/.test(s)));
  for (const response of [new Response(await png(), { headers: tileHeaders(frames[1]!) }), new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), new Response(new Uint8Array(1048577), { headers: tileHeaders(frames[0]!) }), new Response(new Uint8Array(30), { headers: tileHeaders(frames[0]!) })]) {
    const bad = forecastTileSession(frames[0]!, () => {}, (async () => response) as typeof fetch); await assert.rejects(bad.load(4, 3, 6, new AbortController().signal));
  }
  let signal: AbortSignal | null = null;
  const cancellable = forecastTileSession(frames[0]!, () => {}, (async (_url, init) => { signal = init!.signal!; return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); }) as typeof fetch);
  const pending = cancellable.load(4, 3, 6, new AbortController().signal); await new Promise(r => setTimeout(r, 0)); cancellable.dispose(); await assert.rejects(pending); assert.equal((signal as unknown as AbortSignal).aborted, true);
});

test('decoded tile cache is exact-run/frame/XYZ bounded, copied, expired and shared across sessions; cooldown cannot be bypassed', async () => {
  let clock = now; const client = new ForecastTileClient(() => clock); let count = 0;
  const image = await png(); const fetcher = (async () => { count++; return new Response(image, { headers: tileHeaders(frames[0]!) }); }) as typeof fetch;
  const load = () => forecastTileSession(frames[0]!, () => {}, fetcher, client).load(7, 20, 49, new AbortController().signal);
  const first = await load(); const second = await load(); assert.equal(count, 1); assert.notEqual(first.data, second.data);
  for (let i = 0; i < 40; i++) await client.put(String(i), new Uint8Array(600000).buffer, frames[0]!);
  assert.ok(client.entries.size <= 32); assert.ok([...client.entries.values()].reduce((n, v) => n + v.bytes, 0) <= 16 * 1024 * 1024);
  client.clear(); await load(); assert.equal(count, 2); clock += 300001; await load(); assert.equal(count, 3);
  client.clear(); let limited = 0;
  const fail = (async () => { limited++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); }) as typeof fetch;
  await assert.rejects(forecastTileSession(frames[0]!, () => {}, fail, client).load(7, 20, 49, new AbortController().signal));
  await assert.rejects(forecastTileSession(frames[1]!, () => {}, fail, client).load(7, 20, 49, new AbortController().signal));
  assert.equal(limited, 1); assert.equal(client.retryAt, clock + 120000);
  clock += 120000; await load(); assert.equal(count, 4); client.clear(); assert.equal(client.entries.size, 0);
});

test('expired forecasts are removed and slow responses cannot repopulate or display them', async () => {
  let clock = now; const client = new ForecastTileClient(() => clock);
  const image = await png(); let requests = 0;
  const fetcher = (async () => {
    requests++; clock = Date.parse(frames[0]!.validTime);
    return new Response(image, { headers: tileHeaders(frames[0]!) });
  }) as typeof fetch;
  await assert.rejects(forecastTileSession(frames[0]!, () => {}, fetcher, client).load(7, 20, 49, new AbortController().signal), /expired/);
  assert.equal(client.entries.size, 0); assert.equal(client.retryAt, 0);
  await assert.rejects(forecastTileSession(frames[0]!, () => {}, fetcher, client).load(7, 20, 49, new AbortController().signal), /expired/);
  assert.equal(requests, 1);
  clock = now; await client.put('valid', image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer, frames[0]!);
  clock = now + 300000; client.prune(); assert.equal(client.entries.size, 0);
});

// Actual Chrome, isolated distribution, fixture-only APIs and blocked external tiles.
test('browser forecast XYZ, pinned times, same canvas, keyboard, stale, quota and regional gating', { skip: !process.env.FORECAST_MAP_DIST }, async () => {
  const { spawn } = await import('node:child_process');
  const script = String.raw`
const { chromium, expect } = await import('@playwright/test');
const { createServer } = await import('node:http');
const { readFile, writeFile } = await import('node:fs/promises');
const { resolve, extname } = await import('node:path');
const raw = JSON.parse(process.env.FORECAST_FIXTURE);
const root = process.env.FORECAST_MAP_DIST;
const catalog=JSON.parse(await readFile('docs/verification/map-fix/catalog.json'));
const observed=JSON.parse(await readFile('docs/verification/map-fix/frame.json'));
const doc=await readFile('docs/decisions/future-radar.md','utf8');
const png=Buffer.from(doc.split('base64\n')[1].split('\n' + String.fromCharCode(96).repeat(3))[0],'base64');
const requests=[],errors=[],catalogRequests=[],observedCatalogRequests=[]; let fail=false,active=0,maxActive=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(u.pathname==='/api/v1/maps'){observedCatalogRequests.push(Date.now());return res.end(JSON.stringify(catalog));}if(u.pathname==='/api/v1/maps/frame'){const f=structuredClone(observed);Object.assign(f.data,{projection:'EPSG:3857',productId:u.searchParams.get('product'),requestedTime:u.searchParams.get('time')});return res.end(JSON.stringify(f));}if(u.pathname==='/api/v1/maps/forecast/catalog'){catalogRequests.push(Date.now());return res.end(JSON.stringify(raw));}if(u.pathname.startsWith('/api/v1/maps/forecast/tiles/')){requests.push(u.pathname);maxActive=Math.max(maxActive,++active);await new Promise(r=>setTimeout(r,50));active--;if(fail){res.statusCode=429;res.setHeader('Retry-After','60');return res.end('{}');}const f=raw.data.frames.find(f=>u.pathname.includes('/'+f.id+'/'));for(const [k,v] of Object.entries({'Content-Type':'image/png','X-Forecast-Product':'forecast-hrrr-conus','X-Forecast-Frame':f.id,'X-Forecast-Model-Run':f.modelRunTime,'X-Forecast-Valid-Time':f.validTime,'X-Forecast-Source-Time-Status':'pinned_model_run_requested'}))res.setHeader(k,v);return res.end(png);}res.statusCode=503;return res.end(JSON.stringify({status:'error',code:'provider_error',message:'Explicit fixture unavailable'}));}const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch(e){res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let outcome;
try{
 const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await c.route('https://**/*',r=>r.abort());
 const locations=[{id:'roseville',name:'Roseville',country:'US',latitude:38.75,longitude:-121.29,timezone:'America/Los_Angeles'},{id:'anchorage',name:'Anchorage',country:'US',latitude:61.2,longitude:-149.9,timezone:'America/Anchorage'},{id:'honolulu',name:'Honolulu',country:'US',latitude:21.3,longitude:-157.8,timezone:'Pacific/Honolulu'}];
 await c.addInitScript(()=>{window.bitmapCopies=0;const bitmap=createImageBitmap.bind(window);window.createImageBitmap=(...args)=>{window.bitmapCopies++;return bitmap(...args);};const NativeRO=ResizeObserver;window.mapResizeCallbacks=[];window.ResizeObserver=class extends NativeRO{constructor(callback){super((entries,observer)=>{if(entries.some(e=>e.target.classList.contains('interactive-map')))window.mapResizeCallbacks.push(()=>callback(entries,observer));callback(entries,observer);});}};});
 await c.addInitScript(locations=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:locations,selected:locations[0]})),locations);
 const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-09-11T16:15:00Z')});
 await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.evaluate(()=>window.originalCanvas=document.querySelector('.maplibregl-canvas'));
 await p.getByRole('button',{name:'Future radar',exact:true}).click();const slider=p.getByRole('slider',{name:'Future forecast time',exact:true});await expect(slider).toHaveAttribute('max','11');await expect(p.getByText('Forecast · simulated radar · coarse model grid',{exact:true})).toBeVisible();await expect.poll(()=>requests.length).toBeGreaterThan(0);await expect(p.getByRole('button',{name:'Play',exact:true})).toBeEnabled();await p.waitForTimeout(800);expect(maxActive).toBe(1);expect(requests.some(x=>x.endsWith('/7/20/49.png'))).toBe(true);expect(new Set(requests.map(x=>x.split('/')[6])).size).toBe(1);expect(await p.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas'))).toBe(true);await expect(p.getByText('Forecast catalog is stale',{exact:false})).toBeVisible();await expect(p.getByLabel('Forecast legend')).not.toBeVisible();await p.getByText('Map info/settings',{exact:true}).click();await expect(p.getByLabel('Forecast legend')).toContainText('Illustrative');await expect(p.getByText(/^Model run /)).toContainText('7:00');await p.getByText('Map info/settings',{exact:true}).click();await expect(p.locator('.forecast-timeline strong')).toContainText('9:30');
 const initial=requests.length;const idleCopies=await p.evaluate(()=>window.bitmapCopies);for(let i=0;i<10;i++){await p.evaluate(()=>window.mapResizeCallbacks.forEach(cb=>cb()));await p.waitForTimeout(80);}await p.getByRole('button',{name:'Recenter',exact:true}).click();await p.clock.fastForward(61000);await p.waitForTimeout(1000);expect(requests.length).toBe(initial);expect(await p.evaluate(()=>window.bitmapCopies)).toBe(idleCopies);await slider.focus();await slider.press('ArrowRight');await expect(slider).toHaveValue('1');await expect.poll(()=>requests.length).toBeGreaterThan(initial);await p.waitForTimeout(1200);expect(requests.some(x=>x.includes(raw.data.frames[1].id))).toBe(true);expect(requests.every(x=>/^\/api\/v1\/maps\/forecast\/tiles\/hrrr-202609111400-f\d{4}\/[0-7]\/\d+\/\d+\.png$/.test(x))).toBe(true);
 const beforeRapid=requests.length;
 await slider.evaluate(el=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(let i=0;i<12;i++){set.call(el,String(i));el.dispatchEvent(new Event('input',{bubbles:true}));}});
 await expect(slider).toHaveValue('11');await p.waitForTimeout(150);expect(requests.length).toBe(beforeRapid);await expect.poll(()=>requests.length).toBeGreaterThan(beforeRapid);await p.waitForTimeout(1400);expect(requests.slice(beforeRapid).every(x=>x.includes(raw.data.frames[11].id))).toBe(true);
 const beforeBack=requests.length;await slider.press('Home');await p.waitForTimeout(900);await slider.press('ArrowRight');await p.waitForTimeout(900);expect(requests.length).toBe(beforeBack);
 fail=true;await slider.press('ArrowRight');await expect(p.getByRole('alert').filter({hasText:'request limit reached'})).toBeVisible();const limited=requests.length;await p.waitForTimeout(500);expect(requests.length).toBe(limited);await expect(slider).toBeDisabled();await expect(p.getByRole('button',{name:'Retry future radar',exact:true})).toBeDisabled();fail=false;
 await p.clock.fastForward(58000);expect(requests.length).toBe(limited);await p.clock.fastForward(3000);await expect(slider).toBeEnabled();await expect.poll(()=>requests.length).toBeGreaterThan(limited);await p.waitForTimeout(1200);
 await slider.press('End');await p.waitForTimeout(1000);fail=true;await p.getByRole('button',{name:'Play',exact:true}).click();await expect(p.getByRole('alert').filter({hasText:'request limit reached'})).toBeVisible();await expect(p.getByRole('button',{name:'Pause',exact:true})).toBeEnabled();const playLimited=requests.length;await p.clock.fastForward(58000);expect(requests.length).toBe(playLimited);fail=false;await p.clock.fastForward(3000);await expect(p.getByRole('alert').filter({hasText:'request limit reached'})).not.toBeVisible();await expect(p.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await p.waitForTimeout(10000);const loopRequests=requests.length;const loopIndices=[];for(let i=0;i<65;i++){loopIndices.push(await slider.inputValue());await p.waitForTimeout(100);}expect(new Set(loopIndices).size).toBeGreaterThan(1);expect(new Set(loopIndices).size).toBeLessThanOrEqual(6);expect(requests.length).toBe(loopRequests);expect(maxActive).toBe(1);await p.getByRole('button',{name:'Pause',exact:true}).click();await p.waitForTimeout(300);const paused=requests.length;await p.waitForTimeout(1400);expect(requests.length).toBe(paused);
 const beforePoll=catalogRequests.length;await p.clock.fastForward(300000);await expect.poll(()=>catalogRequests.length).toBe(beforePoll+1);await p.waitForTimeout(300);expect(await p.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas'))).toBe(true);
 await p.getByRole('button',{name:'Play',exact:true}).click();await expect(p.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=requests.length,hiddenCatalog=catalogRequests.length;await p.clock.fastForward(360000);await p.waitForTimeout(300);expect(requests.length).toBe(hidden);expect(catalogRequests.length).toBe(hiddenCatalog);await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect(slider).toBeVisible();await expect(p.getByRole('button',{name:'Play',exact:true})).toBeVisible();await expect.poll(()=>catalogRequests.length).toBe(hiddenCatalog+1);await p.waitForTimeout(800);await c.setOffline(true);await expect(p.getByText('Offline — future radar unavailable.',{exact:true})).toBeVisible();const off=requests.length;await p.waitForTimeout(500);expect(requests.length).toBe(off);await c.setOffline(false);await expect(slider).toBeVisible();await p.waitForTimeout(800);
 await p.screenshot({path:'/tmp/zindycast-future-radar-mobile.png',fullPage:true});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.setViewportSize({width:1440,height:1000});await p.waitForTimeout(1200);expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.screenshot({path:'/tmp/zindycast-future-radar-desktop.png',fullPage:true});
 await p.getByRole('button',{name:'Radar',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');const beforeObserved=observedCatalogRequests.length;await p.clock.fastForward(121000);await expect.poll(()=>observedCatalogRequests.length).toBe(beforeObserved+1);await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');const switched=requests.length;await p.waitForTimeout(800);expect(requests.length).toBe(switched);
 for(const city of ['Anchorage','Honolulu']){await p.getByRole('button',{name:'Change location',exact:true}).click();await p.getByRole('button',{name:city,exact:true}).click();await p.getByRole('button',{name:'Future radar',exact:true}).click();await expect(p.getByText('Future radar is available only',{exact:false})).toBeVisible();await p.waitForTimeout(600);expect(requests.length).toBe(switched);}
 await p.getByRole('tab',{name:'Settings',exact:true}).click();await p.waitForTimeout(500);expect(requests.length).toBe(switched);expect(errors).toEqual([]);outcome={passed:true,requests,maxActive,errors,catalogRequests,observedCatalogRequests,futurePlayCachedLoop:true,playCooldownRecovery:true,rapidCommitOnly:true,cachedBacktracking:true,cooldownAutoRecovery:true,hiddenPollingPaused:true,limitations:'Synthetic catalog at fixed browser clock, retained PNG fixture, all external requests blocked; no live-provider or physical-device acceptance.'};
}catch(e){outcome={passed:false,error:e.stack,requests,errors};throw e;}finally{await writeFile('/tmp/zindycast-future-radar-results.json',JSON.stringify(outcome,null,2));await browser.close();await new Promise(r=>server.close(r));}
`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit', env: { ...process.env, FORECAST_FIXTURE: JSON.stringify(raw) } });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Forecast browser exited ${code}`)));
  });
});
