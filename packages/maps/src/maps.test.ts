import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { parseMapCatalog, buildMapRequest, fetchMapImage, getMapCatalog, extentRelation, PRODUCT_IDS, MAP_LIMITS, type Bbox } from './index.js';
const xml = readFileSync(new URL('../../../docs/research/maps/followup-nowcoast-capabilities.xml', import.meta.url), 'utf8');
const retrievedAt = '2026-09-10T23:40:00.000Z';
const catalog = () => parseMapCatalog(xml, retrievedAt);
const bbox: Bbox = [-125,24,-66,50];
function sourceTime() { return catalog().products[0].times.at(-1)!; }
const png = readFileSync(new URL('../../../docs/research/maps/conus-radar.png', import.meta.url));
test('preserved independent NOAA regional and infrared timelines and extents', () => {
  const c = catalog(); assert.equal(c.products.length,5);
  for (const p of c.products) { assert.equal(p.status,'available', p.unavailableReason ?? ''); assert.equal(p.coverageState,'unknown'); assert.equal(p.coverageEvidence,'none'); assert.ok(p.times.length > 1); assert.ok(p.times.includes(p.defaultTime!)); }
  assert.deepEqual(c.products.map(p => p.id),PRODUCT_IDS);
  assert.notDeepEqual(c.products[0].times,c.products[1].times);
  assert.notDeepEqual(c.products[1].times,c.products[2].times);
  const goes = c.products[3]; const global = c.products[4];
  assert.equal(extentRelation([-150,60,-149,62],goes.extent!), 'outside');
  assert.equal(extentRelation([-150,60,-149,62],global.extent!), 'inside');
  assert.equal(global.approximateCadenceMinutes,60); assert.deepEqual(global.documentedLatencyMinutes,[120,180]);
  assert.ok(goes.title.includes('East & West')); assert.equal(global.legend.units,null); assert.equal(c.products[0].legend.units,'dBZ');
});
test('malformed/DTD/deep/oversized XML fails closed', () => {
  for (const bad of ['<broken>', '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a/>', '<a>'.repeat(65) + '</a>'.repeat(65), 'x'.repeat(MAP_LIMITS.metadataBytes+1)]) assert.throws(() => parseMapCatalog(bad,retrievedAt));
  assert.throws(() => parseMapCatalog(xml,'2026-02-30T00:00:00Z'));
});
test('missing layer and interval times fail independently without fabricating frames', () => {
  const missing = parseMapCatalog(xml.replaceAll('weather_radar:conus_base_reflectivity_mosaic','weather_radar:unapproved'),retrievedAt);
  assert.equal(missing.products[0].status,'unavailable'); assert.equal(missing.products[1].status,'available');
  const firstTime = catalog().products[0].times[0];
  const interval = parseMapCatalog(xml.replace(firstTime, '2026-09-10T00:00:00Z/2026-09-10T01:00:00Z/PT4M'),retrievedAt);
  assert.equal(interval.products[0].status,'unavailable'); assert.deepEqual(interval.products[0].times,[]); assert.equal(interval.products[1].status,'available');
});
test('builder fixes origin, layer, styles, CRS84 and exact source time', () => {
  const c = catalog(); c.products[0].layer = 'https://evil.invalid/'; c.sourceUrl = 'http://localhost/';
  const url = buildMapRequest('radar-conus',bbox,800,500,sourceTime(),c);
  assert.equal(url.origin,'https://nowcoast.noaa.gov'); assert.equal(url.pathname,'/geoserver/ows');
  assert.equal(url.searchParams.get('layers'),'weather_radar:conus_base_reflectivity_mosaic');
  assert.equal(url.searchParams.get('crs'),'CRS:84'); assert.equal(url.searchParams.get('bbox'),bbox.join(','));
  assert.equal(url.searchParams.get('time'),sourceTime()); assert.equal(url.searchParams.get('styles'),'');
  for (const id of ['http://localhost','__proto__','radar-conus&layers=evil']) assert.throws(() => buildMapRequest(id,bbox,800,500,sourceTime(),c));
  for (const bad of [[170,20,-170,30],[-181,20,-100,30],[0,40,1,40],[0,0,NaN,1]]) assert.throws(() => buildMapRequest('radar-conus',bad as unknown as Bbox,800,500,sourceTime(),c));
  for (const size of [0,-1,1.5,1025,NaN]) assert.throws(() => buildMapRequest('radar-conus',bbox,size,500,sourceTime(),c));
  assert.throws(() => buildMapRequest('radar-conus',bbox,800,500,'current',c));
  assert.throws(() => buildMapRequest('radar-conus',bbox,800,500,'2026-09-10T00:00:00.000Z',c));
  assert.throws(() => buildMapRequest('satellite-goes-infrared',[-150,60,-149,62],800,500,c.products[3].times[0],c));
  assert.equal(extentRelation([-135,24,-66,50],c.products[0].extent!), 'partial');
});
test('mocked bounded metadata/image fetch preserves Warning without inventing actual time', async t => {
  let seen: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => { seen = init; return new Response(xml,{headers:{'Content-Type':'text/xml; charset=UTF-8'}}); });
  const c = await getMapCatalog(); assert.equal(c.products[0].status,'available'); assert.equal(seen?.redirect,'error');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(png,{headers:{'Content-Type':'image/png','Warning':'99 Nearest value used','Cache-Control':'max-age=600'}}));
  const image = await fetchMapImage('radar-conus',bbox,800,500,sourceTime(),catalog());
  assert.equal(image.actualSourceTime,null); assert.equal(image.requestedTime,sourceTime()); assert.equal(image.sourceTimeStatus,'provider_warning_actual_time_unknown'); assert.equal(image.warning,'99 Nearest value used'); assert.equal(image.cacheControl,'max-age=600');
  assert.equal(image.coverageState,'unknown'); assert.ok(image.bytes.equals(png));
});
test('provider HTTP/XML masquerading as image/oversize/invalid PNG are rejected', async t => {
  for (const response of [
    () => new Response('no',{status:429,headers:{'Content-Type':'image/png'}}),
    () => new Response('<ServiceException/>',{headers:{'Content-Type':'text/xml'}}),
    () => new Response('<ServiceException/>',{headers:{'Content-Type':'image/png'}}),
    () => new Response(png,{headers:{'Content-Type':'image/png','Content-Length':String(MAP_LIMITS.imageBytes+1)}}),
    () => new Response(new Uint8Array(MAP_LIMITS.imageBytes+1),{headers:{'Content-Type':'image/png'}}),
  ]) {
    t.mock.method(globalThis, 'fetch', async () => response());
    await assert.rejects(fetchMapImage('radar-conus',bbox,800,500,sourceTime(),catalog())); t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(png,{headers:{'Content-Type':'image/png'}}));
  await assert.rejects(fetchMapImage('radar-conus',bbox,400,300,sourceTime(),catalog()));
});
test('cancellation signal reaches fetch and no retry occurs', async t => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  t.mock.method(globalThis,'fetch', async (_url: unknown, init: RequestInit) => { calls++; init.signal!.throwIfAborted(); return new Response(); });
  await assert.rejects(getMapCatalog(controller.signal)); assert.equal(calls,1);
});
test('Mercator meters match independent known corners and reject polar/wrapping bounds', async t => {
  const {projectWebMercatorBbox,WEB_MERCATOR_MAX_LATITUDE}=await import('./index.js');
  const corners=projectWebMercatorBbox([-180,-45,180,45]);
  [-20037508.342789244,-5621521.486192066,20037508.342789244,5621521.486192066].forEach((expected,i)=>assert.ok(Math.abs(corners[i]!-expected)<1e-6));
  assert.deepEqual(projectWebMercatorBbox([0,0,90,45]).slice(0,2),[0,0]);
  assert.ok(Math.abs(projectWebMercatorBbox([-180,-WEB_MERCATOR_MAX_LATITUDE,180,WEB_MERCATOR_MAX_LATITUDE])[3]-20037508.34303882)<1e-5);
  for(const bad of [[-180,-86,180,80],[-180,0,180,86],[170,0,-170,20]])assert.throws(()=>projectWebMercatorBbox(bad as unknown as Bbox));
  const c=catalog();
  const url=buildMapRequest('radar-conus',bbox,800,500,sourceTime(),c,'EPSG:3857');
  assert.equal(url.searchParams.get('crs'),'EPSG:3857');assert.deepEqual(url.searchParams.get('bbox')!.split(',').map(Number),projectWebMercatorBbox(bbox));
  const noMercator=parseMapCatalog(xml.replaceAll('<CRS>EPSG:3857</CRS>',''),retrievedAt);
  assert.throws(()=>buildMapRequest('radar-conus',bbox,800,500,sourceTime(),noMercator,'EPSG:3857'));
  assert.equal(buildMapRequest('radar-conus',bbox,800,500,sourceTime(),noMercator).searchParams.get('crs'),'CRS:84');
  assert.throws(()=>buildMapRequest('radar-conus',bbox,800,500,sourceTime(),c,'EPSG:4326' as never));
  t.mock.method(globalThis,'fetch',async()=>new Response(png,{headers:{'content-type':'image/png'}}));
  assert.equal((await fetchMapImage('radar-conus',bbox,800,500,sourceTime(),c,undefined,'EPSG:3857')).projection,'EPSG:3857');
});
