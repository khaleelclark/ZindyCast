import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapProductSchema } from '@zindycast/contracts';
import { advertisedAge, localFrameTime, recentTimes, reflectivityStops, advertisedTimes, FrameCache, markerPosition, parseFrame, pngBlob, productsFor, regionFor, regions } from './maps';
const time = '2026-09-11T00:00:00Z';
const response = { status: 'success', freshness: 'fresh', data: { imageBase64: 'iVBORw0KGgo=', productId: 'radar-conus', requestedTime: time, actualSourceTime: null, sourceTimeStatus: 'provider_warning_actual_time_unknown', warning: 'Nearest value used', retrievedAt: time, coverageState: 'unknown', attribution: 'NOAA', extentRelation: 'inside' } };
const product = MapProductSchema.parse({ layer: 'test', classification: 'observed', temporalKind: 'observed_history', extentMeaning: 'advertised_rectangle_not_coverage_mask', coverageEvidence: 'none', nearestValue: true, approximateCadenceMinutes: 4, documentedLatencyMinutes: null, id: 'radar-conus', title: 'Radar', description: 'Reflectivity', region: 'CONUS', kind: 'radar', status: 'available', unavailableReason: null, extent: regions.CONUS, coverageState: 'unknown', coverageMessage: 'Unknown', times: [time, '2026-09-10T23:56:00Z', time], defaultTime: time, legend: { url: 'https://nowcoast.noaa.gov/', kind: 'reflectivity', units: 'dBZ', explanation: 'Not rainfall' }, attribution: 'NOAA', sourceUrl: 'https://nowcoast.noaa.gov/' });
test('map selection keeps independent sorted advertised timelines and regional radar', () => {
  assert.deepEqual(advertisedTimes(product), ['2026-09-10T23:56:00Z', time]);
  assert.deepEqual(advertisedTimes(), []);
  const alaska = { ...product, id: 'radar-alaska' as const };
  const global = { ...product, id: 'satellite-global-infrared' as const, kind: 'infrared' as const };
  assert.deepEqual(productsFor([product, alaska, global], 'AK').map(p => p.id), ['radar-alaska', 'satellite-global-infrared']);
});
test('geographic marker uses CRS84 orientation and excludes outside bounds without wrapping antimeridian', () => {
  assert.deepEqual(markerPosition({ longitude: -125, latitude: 50 }, regions.CONUS), { x: 0, y: 0 });
  assert.deepEqual(markerPosition({ longitude: -66, latitude: 24 }, regions.CONUS), { x: 800, y: 500 });
  assert.equal(markerPosition({ longitude: 179, latitude: 55 }, regions.AK), null);
  assert.equal(markerPosition(null, regions.HI), null);
  const place = { id: 'test', name: 'Test', country: 'US', latitude: 61, longitude: -149, timezone: 'America/Anchorage' };
  assert.equal(regionFor(place), 'AK');
  assert.equal(regionFor({ ...place, latitude: 21, longitude: -157 }), 'HI');
});
test('frame validation rejects mismatched product/time and preserves unknown coverage/time warnings', () => {
  const frame = parseFrame(response, 'radar-conus', time);
  assert.equal(frame.data.actualSourceTime, null);
  assert.equal(frame.data.warning, 'Nearest value used');
  assert.equal(frame.data.coverageState, 'unknown');
  assert.throws(() => parseFrame(response, 'radar-hawaii', time), /match/);
  assert.throws(() => parseFrame(response, 'radar-conus', '2026-09-11T01:00:00Z'), /match/);
  assert.throws(() => parseFrame({ ...response, data: { ...response.data, actualSourceTime: time } }, 'radar-conus', time));
  assert.equal(pngBlob(response.data.imageBase64).type, 'image/png');
  assert.throws(() => pngBlob('PGh0bWw+'), /PNG/);
  assert.throws(() => pngBlob('bad!'), /encoding/);
});
test('bounded frame memory revokes least-recently-used URLs, replacement and disposal', () => {
  const revoked: string[] = [];
  const cache = new FrameCache(url => revoked.push(url));
  const frame = parseFrame(response, 'radar-conus', time);
  for (const key of ['a', 'b', 'c', 'e', 'f', 'g']) cache.put(key, { frame, url: key });
  cache.get('a'); cache.put('d', { frame, url: 'd' });
  assert.deepEqual(revoked, ['b']); assert.equal(cache.get('b'), undefined);
  cache.put('a', { frame, url: 'new-a' }); assert.deepEqual(revoked, ['b', 'a']);
  cache.clear(); assert.deepEqual(revoked, ['b', 'a', 'c', 'e', 'f', 'g', 'd', 'new-a']);
  cache.clear(); assert.equal(revoked.length, 8);
});

test('interactive overlay requires explicit Mercator and nonwrapping geographic corners', async () => {
  const { boundedView, imageCorners } = await import('./interactive-map');
  assert.throws(() => parseFrame(response, 'radar-conus', time, true), /Mercator/);
  assert.equal(parseFrame({ ...response, data: { ...response.data, projection: 'EPSG:3857' } }, 'radar-conus', time, true).data.projection, 'EPSG:3857');
  assert.deepEqual(boundedView([-190, -90, 190, 90]), [-180, -85, 180, 85]);
  assert.throws(() => boundedView([170, 20, -170, 30]), /bounds/);
  assert.throws(() => boundedView([NaN, 20, 30, 40]), /Invalid/);
  assert.deepEqual(imageCorners([-125, 24, -66, 50]), [[-125, 50], [-66, 50], [-66, 24], [-125, 24]]);
});

test('weather source identity survives loading, frame changes and failure without worker removal races', async () => {
  const { displayWeather, hideWeather, boundedView } = await import('./interactive-map');
  const sources = new Map<string, any>(); const layers = new Map<string, any>();
  const updates: any[] = []; const footprints: any[] = [];
  const instance = {
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => layers.get(id),
    addSource: (id: string) => { assert.ok(!sources.has(id)); sources.set(id, id === 'weather' ? { updateImage: (value: unknown) => updates.push(value) } : { setData: (value: unknown) => footprints.push(value) }); },
    addLayer: (layer: any) => { assert.ok(!layers.has(layer.id)); layers.set(layer.id, { ...layer, visibility: 'visible' }); },
    setLayoutProperty: (id: string, _key: string, value: string) => { layers.get(id).visibility = value; },
    setPaintProperty: () => {},
    removeSource: () => assert.fail('Source removal can race outstanding worker tasks'),
    removeLayer: () => assert.fail('Layer should remain stable'),
  } as unknown as import('maplibre-gl').Map;
  hideWeather(instance); // Loading before the first frame is harmless.
  const image = {} as HTMLImageElement;
  displayWeather(instance, image, [-100, 30, -95, 35], 0.5);
  const original = sources.get('weather');
  for (let i = 0; i < 20; i++) {
    hideWeather(instance);
    assert.equal(layers.get('weather').visibility, 'none');
    displayWeather(instance, image, [-100 + i, 30, -95 + i, 35], 0.5);
    assert.equal(sources.get('weather'), original);
    assert.equal(layers.get('weather').visibility, 'visible');
  }
  hideWeather(instance); // Failed request must leave old frame and footprint hidden.
  assert.equal(layers.get('footprint').visibility, 'none');
  assert.equal(sources.size, 2); assert.equal(updates.length, 21); assert.equal(footprints.length, 20);
  assert.deepEqual(updates.at(-1).coordinates, [[-81, 35], [-76, 35], [-76, 30], [-81, 30]]);
  assert.throws(() => boundedView([1, 1, 1.0000001, 2]), /bounds/);
});

test('recent playback timeline is capped, chronological and uses only advertised instants', () => {
  const times = Array.from({ length: 12 }, (_, i) => new Date(Date.parse(time) - i * 240_000).toISOString());
  assert.deepEqual(recentTimes({ ...product, times }), times.slice(0, 6).reverse());
  assert.deepEqual(recentTimes({ ...product, times }, Date.parse(time) - 240_000), times.slice(1, 7).reverse());
  assert.equal(advertisedAge(time, Date.parse(time) + 720_000), '12 min since advertised time');
  assert.match(localFrameTime(time, 'America/Los_Angeles'), /Sep 10.*5:00.*PDT/);
  assert.equal(advertisedAge(time, Date.parse(time) - 1), 'Advertised time is in the future');
});
test('persistent radar sample colors match retained NOAA style, not invented rainfall classes', async () => {
  const { readFile } = await import('node:fs/promises');
  const xml = await readFile('docs/research/maps/followup-radar-style.xml', 'utf8');
  for (const [quantity, color] of reflectivityStops) assert.ok(xml.includes(`color="${color}" opacity="1" quantity="${quantity}"`));
  const capabilities = await readFile('docs/research/maps/followup-nowcoast-capabilities.xml', 'utf8');
  for (const region of ['conus', 'alaska', 'hawaii']) {
    const layer = capabilities.split(`<Name>weather_radar:${region}_base_reflectivity_mosaic</Name>`)[1]!.split('</Layer>')[0]!;
    assert.match(layer, /<Name>weather_radar_base_reflectivity<\/Name>/);
  }
});

// Opt-in actual Chrome fixture audit. Build to an isolated directory first, then:
// RADAR_CONTROLS_DIST=/tmp/zindycast-radar-controls-dist npx tsx --test apps/web/src/maps.test.ts
// No live provider calls, real user preferences, service worker or deployment changes.
test('actual mobile browser playback, keyboard scrub, pause, quota and URL cleanup', { skip: !process.env.RADAR_CONTROLS_DIST }, async () => {
  const { spawn } = await import('node:child_process');
  const script = [
    "const { chromium, expect } = await import('@playwright/test');",
    "const { createServer } = await import('node:http');",
    "const {readFile,writeFile} = await import('node:fs/promises');",
    "const {resolve,extname} = await import('node:path');",
    "const root=process.env.RADAR_CONTROLS_DIST;",
    "const catalog=JSON.parse(await readFile('docs/verification/map-fix/catalog.json'));",
    "const frame=JSON.parse(await readFile('docs/verification/map-fix/frame.json'));",
    "const requests=[],errors=[],catalogRequests=[];let active=0,maxActive=0,fail=false;",
    "const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(u.pathname==='/api/v1/maps'){catalogRequests.push(Date.now());return res.end(JSON.stringify(catalog));}if(u.pathname==='/api/v1/maps/frame'){active++;maxActive=Math.max(maxActive,active);requests.push(u.searchParams.get('time'));await new Promise(r=>setTimeout(r,120));active--;if(fail){res.statusCode=429;res.setHeader('Retry-After','60');return res.end(JSON.stringify({status:'error',code:'rate_limited',message:'Fixture quota exhausted; wait before retrying.'}));}const f=structuredClone(frame);Object.assign(f.data,{projection:'EPSG:3857',productId:u.searchParams.get('product'),requestedTime:u.searchParams.get('time')});return res.end(JSON.stringify(f));}res.statusCode=503;return res.end(JSON.stringify({status:'error',code:'provider_error',message:'Fixture API unavailable'}));}const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});",
    "await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});",
    "let outcome;",
    "try{const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await c.route('https://**/*',r=>r.abort());await c.addInitScript(()=>{const NativeRO=ResizeObserver;window.mapResizeCallbacks=[];window.ResizeObserver=class extends NativeRO{constructor(callback){super((entries,observer)=>{if(entries.some(e=>e.target.classList.contains('interactive-map')))window.mapResizeCallbacks.push(()=>callback(entries,observer));callback(entries,observer);});}};window.imageLoads=0;const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){if(String(value).startsWith('blob:'))window.imageLoads++;src.set.call(this,value);}});const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.blobs=new Set();window.maxBlobs=0;URL.createObjectURL=(b)=>{const u=create(b);window.blobs.add(u);window.maxBlobs=Math.max(window.maxBlobs,window.blobs.size);return u;};URL.revokeObjectURL=u=>{window.blobs.delete(u);revoke(u);};});const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));await p.clock.install();await p.goto(`http://127.0.0.1:${server.address().port}`);await p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await expect(p.getByLabel('Weather legend')).not.toBeVisible();await expect(p.getByRole('button',{name:'Radar',exact:true})).toHaveAttribute('aria-pressed','true');await expect(p.getByLabel('Radar source',{exact:true})).toHaveValue('noaa');",
    "await p.waitForTimeout(800);const idleRequests=requests.length;const idleLoads=await p.evaluate(()=>window.imageLoads);await p.evaluate(()=>{window.idleCanvas=document.querySelector('.maplibregl-canvas');window.readyChanges=[];new MutationObserver(records=>window.readyChanges.push(...records.map(r=>r.target.getAttribute('data-weather-ready')))).observe(document.querySelector('.interactive-map'),{attributes:true,attributeFilter:['data-weather-ready']});});for(let i=0;i<10;i++){await p.evaluate(()=>window.mapResizeCallbacks.forEach(cb=>cb()));await p.waitForTimeout(80);}await p.clock.fastForward(61000);await p.waitForTimeout(800);expect(requests.length).toBe(idleRequests);expect(await p.evaluate(()=>window.imageLoads)).toBe(idleLoads);expect(await p.evaluate(()=>window.readyChanges)).toEqual([]);expect(await p.evaluate(()=>window.idleCanvas===document.querySelector('.maplibregl-canvas'))).toBe(true);",
    "await p.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>new Set(requests).size,{timeout:16000}).toBe(6);const bounded=requests.length;await expect(p.getByText('Loading animation',{exact:false})).not.toBeVisible();const samples=await p.evaluate(async()=>{const values=[];for(let i=0;i<45;i++){values.push({ready:document.querySelector('.interactive-map')?.getAttribute('data-weather-ready'),index:document.querySelector('.map-playback input')?.value});await new Promise(r=>setTimeout(r,100));}return values;});expect(samples.every(v=>v.ready==='true')).toBe(true);expect(new Set(samples.map(v=>v.index)).size).toBe(6);expect(requests.length).toBe(bounded);expect(maxActive).toBe(1);await p.getByRole('button',{name:'Pause',exact:true}).click();const slider=p.getByRole('slider',{name:'Recent frames',exact:true});await slider.focus();await slider.press('Home');await expect(slider).toHaveValue('0');await slider.press('ArrowRight');await expect(slider).toHaveValue('1');expect(requests.length).toBe(bounded);await expect(p.locator('.map-clock')).toContainText('since advertised time');",
    "const beforePoll=catalogRequests.length;await p.clock.fastForward(121000);await expect.poll(()=>catalogRequests.length).toBe(beforePoll+1);await expect(slider).toHaveValue('1');await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');expect(requests.length).toBe(bounded);await p.getByRole('button',{name:'Play',exact:true}).click();const playingCatalog=catalogRequests.length;await p.clock.fastForward(121000);await p.waitForTimeout(300);expect(catalogRequests.length).toBe(playingCatalog);await p.getByRole('button',{name:'Pause',exact:true}).click();",
    "await p.getByRole('button',{name:'Play',exact:true}).click();await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(p.getByRole('button',{name:'Play',exact:true})).toBeVisible();const hiddenCatalog=catalogRequests.length,hiddenFrames=requests.length;await p.clock.fastForward(121000);await p.waitForTimeout(300);expect(catalogRequests.length).toBe(hiddenCatalog);expect(requests.length).toBe(hiddenFrames);await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>catalogRequests.length).toBe(hiddenCatalog+1);",
    "await p.getByRole('button',{name:'Play',exact:true}).click();await p.getByText('Map info/settings',{exact:true}).click();await p.locator('.maplibregl-canvas').focus();await p.locator('.maplibregl-canvas').press('ArrowRight');await expect(p.getByRole('button',{name:'Play',exact:true})).toBeVisible();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');",
    "await p.getByText('Imagery details',{exact:true}).click();fail=true;await p.getByRole('button',{name:'Refresh imagery',exact:true}).click();await expect(p.getByRole('alert').filter({hasText:'Fixture quota'})).toBeVisible();const afterError=requests.length;await p.waitForTimeout(2200);expect(requests.length).toBe(afterError);await expect(p.getByRole('button',{name:'Play',exact:true})).toBeDisabled();fail=false;await p.getByRole('button',{name:'Refresh imagery',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.getByRole('button',{name:'Play',exact:true}).click();await c.setOffline(true);await expect(p.getByText('Offline — map imagery is unavailable.',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Play',exact:true})).toBeVisible();const offlineCount=requests.length;await p.waitForTimeout(1200);expect(requests.length).toBe(offlineCount);await c.setOffline(false);await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.screenshot({path:'/tmp/map-overflow-debug.png',fullPage:true});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await p.evaluate(()=>({width:innerWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && !(e.parentElement?.matches('.weather-backdrop[aria-hidden=true]') && getComputedStyle(e.parentElement).overflow==='hidden' && getComputedStyle(e.parentElement).position==='fixed')).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,100),parent:e.parentElement?.className,right:e.getBoundingClientRect().right})).slice(0,15)}))).toEqual({width:await p.evaluate(()=>innerWidth),overflow:[]});await p.setViewportSize({width:1440,height:1000});await p.waitForTimeout(800);await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.screenshot({path:'/tmp/map-overflow-debug.png',fullPage:true});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await p.evaluate(()=>({width:innerWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && !(e.parentElement?.matches('.weather-backdrop[aria-hidden=true]') && getComputedStyle(e.parentElement).overflow==='hidden' && getComputedStyle(e.parentElement).position==='fixed')).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,100),parent:e.parentElement?.className,right:e.getBoundingClientRect().right})).slice(0,15)}))).toEqual({width:await p.evaluate(()=>innerWidth),overflow:[]});await p.getByText('Map info/settings',{exact:true}).click();await p.screenshot({path:'/tmp/zindycast-radar-controls-desktop.png',fullPage:true});await p.setViewportSize({width:390,height:844});await p.waitForTimeout(800);await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.getByRole('button',{name:'Satellite',exact:true}).click();await expect(p.getByRole('button',{name:'Satellite',exact:true})).toHaveAttribute('aria-pressed','true');await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.getByRole('button',{name:'Radar',exact:true}).click();await expect(p.getByRole('button',{name:'Radar',exact:true})).toHaveAttribute('aria-pressed','true');await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.screenshot({path:'/tmp/zindycast-radar-controls-mobile.png',fullPage:true});await p.getByRole('tab',{name:'Settings',exact:true}).click();await expect.poll(()=>p.evaluate(()=>window.blobs.size)).toBe(0);expect(await p.evaluate(()=>window.maxBlobs)).toBeLessThanOrEqual(6);expect(errors).toEqual([]);outcome={passed:true,requests,maxActive,catalogRequests,historicalSelectionPreserved:true,noPlayingOrHiddenPoll:true,maxBlobs:await p.evaluate(()=>window.maxBlobs),errors,limitations:'All APIs are retained fixtures with request-adapted metadata; external tiles blocked. Visibility event simulated, no fabricated timestamps. Isolated Chrome mobile viewport, no physical-device claim.'};}catch(e){outcome={passed:false,error:e.stack,requests,errors};throw e;}finally{await writeFile('/tmp/zindycast-radar-controls-results.json',JSON.stringify(outcome,null,2));await browser.close();await new Promise(r=>server.close(r));}",
  ].join('\n');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Browser audit exited ${code}`)));
  });
});
