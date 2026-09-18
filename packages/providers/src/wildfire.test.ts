import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getWildfires, WildfireDataSchema } from './wildfire.js';
import { ProviderError } from './index.js';
const bbox = { west: -151, south: 63, east: -147, north: 66 };
const load = (kind: string) => JSON.parse(readFileSync(new URL(`../../../docs/research/maps/nifc-${kind}-sample.json`, import.meta.url), 'utf8'));
const incident = (i = 0) => ({ ...load('incidents').features[i], geometry: { x: -149, y: 64 } });
const perimeter = (i = 2) => ({ ...load('perimeters').features[i], geometry: { rings: [[[-150, 64], [-149, 64], [-149, 65], [-150, 64]]] } });
const page = (kind: string, features: unknown[] = [], exceededTransferLimit?: boolean) => ({
  geometryType: kind === 'incidents' ? 'esriGeometryPoint' : 'esriGeometryPolygon',
  spatialReference: { wkid: 4326 }, features, ...(exceededTransferLimit === undefined ? {} : { exceededTransferLimit }),
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const fails = (promise: Promise<unknown>, code = 'provider_error') => assert.rejects(promise, (e: unknown) => e instanceof ProviderError && e.code === code);

test('research attributes retain RX/WF, source IDs and independent older perimeter timestamps; source geometry mocks only', async t => {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    requests.push(new URL(input)); assert.equal(options.redirect, 'error');
    return json(requests.length === 1 ? page('incidents', [incident()]) : page('perimeters', [perimeter()]));
  });
  const d = await getWildfires(bbox);
  assert.equal(d.incidents[0].category, 'RX'); assert.equal(d.perimeters[0].category, 'WF');
  assert.equal(d.perimeters[0].polygonCapturedAt.epochMs, 1781905334000);
  assert.equal(d.perimeters[0].incidentUpdatedAt.epochMs, 1789058884433);
  assert.equal(d.perimeters[0].polygonUpdatedAt.epochMs, 1785175795000);
  assert.equal(d.perimeters[0].normalizedIrwinId, '2b964609-cd9a-49ca-9cfd-7f619752086e');
  assert.match(d.perimeters[0].polygonSourceGlobalId!, /19A34403/);
  assert.equal(d.geometryFormat, 'esri_json'); assert.equal(d.coverage, 'unknown');
  assert.equal(d.sources.perimeters.snapshotConsistency, 'not_atomic');
  assert.ok(WildfireDataSchema.safeParse(d).success);
  for (const u of requests) {
    assert.equal(u.origin, 'https://services3.arcgis.com'); assert.equal(u.searchParams.get('outSR'), '4326');
    assert.equal(u.searchParams.get('geometry'), '-151,63,-147,66');
    assert.equal(u.searchParams.get('resultRecordCount'), '500'); assert.equal(u.searchParams.get('where'), 'OBJECTID>-1');
    assert.equal(u.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
    assert.equal(u.searchParams.get('outFields')?.includes('*'), false);
  }
});

test('pagination continues short transfer-limited pages with increasing object IDs; missing perimeter and CX survive', async t => {
  const a = incident(), b = incident(1); b.attributes.IncidentTypeCategory = 'CX'; b.geometry = null;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    calls++;
    if (calls === 1) return json(page('incidents', [a], true));
    if (calls === 2) { assert.equal(input.searchParams.get('where'), `OBJECTID>${a.attributes.OBJECTID}`); return json(page('incidents', [b], false)); }
    return json(page('perimeters'));
  });
  const d = await getWildfires(bbox);
  assert.equal(d.incidents.length, 2); assert.equal(d.incidents[1].category, 'CX');
  assert.equal(d.incidents[1].geometry, null); assert.deepEqual(d.perimeters, []);
  assert.equal(d.sources.incidents.pages, 2); assert.equal(d.sources.perimeters.availability, 'no_published_records');
});

test('empty is successful; null geometry/IDs/times preserved without synthesized joins', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => json(page(++calls % 2 ? 'incidents' : 'perimeters')));
  const empty = await getWildfires(bbox);
  assert.deepEqual(empty.incidents, []); assert.deepEqual(empty.perimeters, []);
  const p = perimeter(); p.geometry = null;
  for (const k of ['poly_IRWINID', 'attr_IrwinID', 'poly_PolygonDateTime', 'poly_DateCurrent', 'attr_ModifiedOnDateTime_dt']) p.attributes[k] = null;
  t.mock.method(globalThis, 'fetch', async () => json(++calls % 2 ? page('incidents') : page('perimeters', [p])));
  const d = await getWildfires(bbox);
  assert.equal(d.perimeters[0].normalizedIrwinId, null); assert.equal(d.perimeters[0].geometry, null);
  assert.deepEqual(d.perimeters[0].polygonCapturedAt, { epochMs: null, utc: null });
});

test('malformed geometry, fields, conflicting identity, CRS and pagination fail whole retrieval', async t => {
  const badIncident = incident(); badIncident.attributes.IncidentTypeCategory = 'EV';
  const unclosed = perimeter(); unclosed.geometry.rings[0].pop();
  const wrongJoin = perimeter(); wrongJoin.attributes.attr_IrwinID = incident().attributes.IrwinID;
  const wrongPoint = incident(); wrongPoint.geometry.x = 200;
  const missing = incident(); delete missing.attributes.ModifiedOnDateTime_dt;
  const cases = [page('incidents', [badIncident]), page('incidents', [wrongPoint]), page('incidents', [missing]),
    { ...page('incidents'), spatialReference: { wkid: 4269 } }, page('incidents', [], true),
    { error: { code: 400, message: 'bad query' } }, { ...page('incidents'), exceededTransferLimit: 'false' }];
  for (const value of cases) {
    t.mock.method(globalThis, 'fetch', async () => json(value)); await fails(getWildfires(bbox));
  }
  for (const p of [unclosed, wrongJoin]) {
    let calls = 0; t.mock.method(globalThis, 'fetch', async () => json(++calls === 1 ? page('incidents') : page('perimeters', [p])));
    await fails(getWildfires(bbox));
  }
  const duplicate = incident(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(page('incidents', [duplicate], true)); });
  await fails(getWildfires(bbox)); assert.equal(calls, 2);
});

test('page ceiling and full-page omitted flag cannot silently truncate', async t => {
  let calls = 0;
  const make = (n: number) => { const f = incident(); f.attributes.OBJECTID = n; f.attributes.GlobalID = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`; return f; };
  t.mock.method(globalThis, 'fetch', async () => json(page('incidents', [make(++calls)], true)));
  await fails(getWildfires(bbox)); assert.equal(calls, 4);
  calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return json(page('incidents', Array.from({ length: 500 }, (_, i) => make(i))));
    return json(page(calls === 2 ? 'incidents' : 'perimeters'));
  });
  const d = await getWildfires(bbox); assert.equal(d.incidents.length, 500); assert.equal(calls, 3);
});

test('invalid bbox before network; caller query mutation cannot change perimeter request', async t => {
  let calls = 0;
  const input = { ...bbox };
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    calls++; input.east = -140;
    assert.equal(url.searchParams.get('geometry'), '-151,63,-147,66');
    return json(page(calls === 1 ? 'incidents' : 'perimeters'));
  });
  for (const b of [{ ...bbox, east: 180 }, { ...bbox, west: 175, east: -175 }, { ...bbox, south: 91 },
    { ...bbox, east: bbox.west }, { ...bbox, west: NaN }, { ...bbox, url: 'https://bad.invalid' }]) await fails(getWildfires(b), 'invalid_request');
  assert.equal(calls, 0); const d = await getWildfires(input); assert.deepEqual(d.bbox, bbox);
});

test('HTTP errors, 429 retry delay, redirects, body size and bad JSON remain unavailable', async t => {
  for (const response of [new Response('x', { status: 503 }), new Response('', { status: 302, headers: { location: 'https://bad.invalid' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }), new Response('{}'),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '8000001' } }),
    new Response(' '.repeat(8_000_001), { headers: { 'content-type': 'application/json' } })]) {
    t.mock.method(globalThis, 'fetch', async () => response); await fails(getWildfires(bbox));
  }
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429, headers: { 'retry-after': '37' } }));
  await assert.rejects(getWildfires(bbox), (e: unknown) => e instanceof ProviderError && e.code === 'rate_limited' && e.retryAfterSeconds === 37);
});

test('pre-abort and in-flight caller reasons preserved; timeout bounds even stalled fetch and body', async t => {
  const controller = new AbortController(); const reason = new Error('leave viewport'); controller.abort(reason);
  await assert.rejects(getWildfires(bbox, controller.signal), e => e === reason);
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  const active = new AbortController(); const pending = getWildfires(bbox, active.signal); active.abort(reason);
  await assert.rejects(pending, e => e === reason);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timed = getWildfires(bbox); const checked = fails(timed); t.mock.timers.tick(10_000); await checked;
  let opened!: () => void; const bodyReady = new Promise<void>(r => { opened = r; });
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start() { opened(); } }), { headers: { 'content-type': 'application/json' } }));
  const body = getWildfires(bbox); const bodyChecked = fails(body); await bodyReady;
  await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(10_000); await bodyChecked;
});

test('runtime result rejects tampered timestamps, normalized IDs, record counts and too many vertices', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => json(++calls === 1 ? page('incidents', [incident()]) : page('perimeters', [perimeter()])));
  const original = await getWildfires(bbox);
  for (const change of [
    (d: typeof original) => { d.perimeters[0].polygonCapturedAt.utc = d.retrievedAt; },
    (d: typeof original) => { d.incidents[0].normalizedIrwinId = null; },
    (d: typeof original) => { d.perimeters[0].geometry!.rings = [[]]; },
    (d: typeof original) => { d.perimeters[0].polygonCapturedAt.epochMs = 9e20; },
    (d: typeof original) => { d.sources.incidents.publishedRecords = 0; },
    (d: typeof original) => { d.perimeters[0].geometry!.rings = Array.from({ length: 1000 }, () => Array.from({ length: 101 }, (_, i) => (i % 3 === 0 || i === 100 ? [-150, 64] : i % 3 === 1 ? [-149, 64] : [-149, 65]) as [number, number])); },
  ]) { const d = structuredClone(original); change(d); assert.equal(WildfireDataSchema.safeParse(d).success, false); }
});

// REST integration uses only mocks and an isolated in-memory cache.
import Fastify from 'fastify';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { WildfireDataSchema as SharedWildfireSchema, WildfireResponseSchema } from '@zindycast/contracts';
import { CachedRequests } from '../../../apps/api/src/cache.js';
import { registerWildfires } from '../../../apps/api/src/wildfire.js';
import type { TestContext } from 'node:test';
const routeUrl = '/api/v1/wildfires?west=-151&south=63&east=-147&north=66';
const cacheKey = `wildfires:wfigs-current-v1:4326:esri-json:${JSON.stringify(bbox)}`;
function routeSetup(t: TestContext, storage = new SharedStorage({ path: ':memory:', providers: APP_PROVIDER_LIMITS })) {
  const app = Fastify(); registerWildfires(app, new CachedRequests(storage));
  t.after(async () => { await app.close(); storage.close(); }); return { app, storage };
}
function emptyFetch(input: URL) { return Promise.resolve(json(page(input.pathname.includes('Incident_Locations') ? 'incidents' : 'perimeters'))); }
test('REST shared schema identity, strict bbox, fresh response, cache TTL and eight-call reservation', async t => {
  assert.equal(SharedWildfireSchema, WildfireDataSchema);
  const storage = new SharedStorage({ path: ':memory:', providers: { noaa: { minute: 8, hour: 8, day: 8, month: 8 } } });
  const { app } = routeSetup(t, storage);
  const mock = t.mock.method(globalThis, 'fetch', emptyFetch);
  for (const q of ['west=&south=0&east=1&north=1', 'west=0&south=0&east=11&north=1',
    'west=0&west=1&south=0&east=2&north=1', 'west=0&south=0&east=1&north=1&url=x', 'west=NaN&south=0&east=1&north=1'])
    assert.equal((await app.inject('/api/v1/wildfires?' + q)).statusCode, 400);
  assert.equal(mock.mock.callCount(), 0);
  const first = await app.inject(routeUrl); assert.equal(first.statusCode, 200);
  assert.equal(WildfireResponseSchema.parse(first.json()).freshness, 'fresh');
  assert.equal((await app.inject(routeUrl)).statusCode, 200); assert.equal(mock.mock.callCount(), 2);
  const entry = storage.get(cacheKey)!;
  assert.equal(entry.expiresAt - entry.retrievedAt, 300000); assert.equal(entry.expiresAt, entry.staleUntil);
  assert.equal((await app.inject(routeUrl.replace('east=-147', 'east=-148'))).statusCode, 429);
  assert.equal(mock.mock.callCount(), 2);
});
test('REST quota rejects before fetch; upstream retry and malformed responses map correctly', async t => {
  const { app } = routeSetup(t, new SharedStorage({ path: ':memory:', providers: { noaa: { minute: 7, hour: 7, day: 7, month: 7 } } }));
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429, headers: { 'retry-after': '19' } }));
  assert.equal((await app.inject(routeUrl)).statusCode, 429); assert.equal(mock.mock.callCount(), 0);
  const other = routeSetup(t).app;
  const limited = await other.inject(routeUrl); assert.equal(limited.statusCode, 429); assert.equal(limited.headers['retry-after'], '19');
  mock.mock.mockImplementation(async () => json({ error: 'failed' }));
  assert.equal((await other.inject(routeUrl)).statusCode, 502);
});
test('REST rejects wrong cached bbox, stale fallback and oversized complete geometry without partial success', async t => {
  const { app, storage } = routeSetup(t); const now = Date.now();
  const mock = t.mock.method(globalThis, 'fetch', emptyFetch);
  const original = await getWildfires(bbox);
  storage.set(cacheKey, { ...original, bbox: { ...bbox, east: -148 } }, { retrievedAt: now, expiresAt: now + 300000, staleUntil: now + 300000 });
  assert.equal((await app.inject(routeUrl)).statusCode, 200); assert.equal(mock.mock.callCount(), 4);
  const stale = routeSetup(t);
  stale.storage.set(cacheKey, JSON.parse(JSON.stringify(original)), { retrievedAt: now - 2000, expiresAt: now - 1000, staleUntil: now + 300000 });
  mock.mock.mockImplementation(async () => { throw new Error('offline'); });
  assert.equal((await stale.app.inject(routeUrl)).statusCode, 502);
  const huge = perimeter();
  const ring = Array.from({ length: 80000 }, (_, i) => [-149.1234567890123 + (i % 2) * 0.00001, 64.1234567890123 + (i % 3) * 0.00001]);
  ring.push(ring[0]); huge.geometry = { rings: [ring] };
  mock.mock.mockImplementation(async (input: URL) => json(input.pathname.includes('Incident_Locations') ? page('incidents') : page('perimeters', [huge])));
  const oversized = routeSetup(t); const response = await oversized.app.inject(routeUrl);
  assert.equal(response.statusCode, 502); assert.match(response.json().message, /smaller viewport/);
  assert.equal(oversized.storage.get(cacheKey), null);
});
test('REST 10-second outer abort precedes 15-second cache lease', async t => {
  const { app, storage } = routeSetup(t); await app.ready();
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_url: unknown, init?: RequestInit) => { signal = init?.signal ?? undefined; began(); return new Promise<Response>(() => {}); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = app.inject(routeUrl); await started; t.mock.timers.tick(10000);
  assert.equal((await pending).statusCode, 502); assert.equal(signal?.aborted, true); assert.equal(storage.get(cacheKey), null);
});
