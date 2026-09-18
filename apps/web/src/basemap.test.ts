import test from 'node:test';
import assert from 'node:assert/strict';
import { installBasemap, initialBasemap, mapboxTileUrl, BASEMAP_PREFERENCE_KEY, admitMapboxTile } from './basemap';

test('basemap failure is source-scoped and sticky; explicit selection preserves weather and tolerates denied storage', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
  assert.equal(initialBasemap(''), 'standard');
  assert.equal(initialBasemap('pk.fixture'), 'mapbox');
  const sources = new Map<string, unknown>([['weather', {}], ['forecast-9', {}]]);
  const layers = new Map<string, unknown>([['weather', {}], ['forecast-9', {}]]);
  const listeners = new Map<string, Set<Function>>();
  const protocols = new Map<string, unknown>();
  const status: any[] = [];
  const map = {
    on(event: string, callback: Function) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
    off(event: string, callback: Function) { listeners.get(event)?.delete(callback); },
    getLayer: (id: string) => layers.get(id), getSource: (id: string) => sources.get(id),
    removeLayer(id: string) { assert.ok(id.startsWith('base-')); layers.delete(id); },
    removeSource(id: string) { assert.ok(id.startsWith('base-')); sources.delete(id); },
    addSource(id: string, source: unknown) { sources.set(id, source); },
    getStyle: () => ({ layers: [...layers.keys()].map(id => ({ id })) }),
    addLayer(layer: { id: string }, before: string) { assert.equal(before, 'weather'); layers.set(layer.id, layer); },
    isSourceLoaded: () => true,
  } as unknown as import('maplibre-gl').Map;
  const lib = { addProtocol(id: string, fn: unknown) { protocols.set(id, fn); }, removeProtocol(id: string) { protocols.delete(id); } } as any;
  const controller = installBasemap(map, lib, 'pk.fixture', value => status.push(value));
  const emitError = (sourceId: string) => listeners.get('error')?.forEach(fn => fn({ type: 'error', sourceId }));
  const first = [...protocols.keys()][0]!;
  emitError('forecast-9'); emitError('weather');
  assert.equal(status.at(-1).kind, 'mapbox');
  emitError(first);
  assert.equal(status.at(-1).kind, 'standard'); assert.equal(initialBasemap('pk.fixture'), 'standard');
  const n = status.length; emitError(first); assert.equal(status.length, n);
  controller.dispose();
  const second = installBasemap(map, lib, 'pk.fixture', value => status.push(value));
  assert.equal(status.at(-1).kind, 'standard'); assert.equal(protocols.size, 0);
  second.select('mapbox'); assert.equal(initialBasemap('pk.fixture'), 'mapbox');
  second.dispose(); assert.deepEqual([...sources.keys()], ['weather', 'forecast-9']);
  assert.deepEqual([...layers.keys()], ['weather', 'forecast-9']);
  assert.equal(protocols.size, 0);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => key === BASEMAP_PREFERENCE_KEY ? 'true' : null } });
  assert.equal(initialBasemap('pk.fixture'), 'standard');
  delete (globalThis as any).localStorage;
});

test('static tile URLs stay pinned to Streets v12, 512 @2x and valid XYZ', () => {
  assert.equal(mapboxTileUrl('pk.fixture', 7, 20, 49), 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/7/20/49@2x?access_token=pk.fixture');
  for (const coords of [[7, 128, 1], [7, -1, 1], [7, 1, 128], [1.5, 0, 0], [23, 0, 0]]) assert.throws(() => mapboxTileUrl('pk.fixture', ...coords as [number, number, number]));
  assert.throws(() => mapboxTileUrl('', 0, 0, 0));
});

test('actual Chrome basemap transitions and failure fixtures', { skip: !process.env.BASEMAP_DIST }, async () => {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['docs/verification/mapbox-fallback/browser.mjs'], { stdio: 'inherit', env: process.env });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Basemap browser audit exited ${code}`)));
  });
});


test('admission validates status/count, never caches permits, and aborts before requesting', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let status = 200;
  let body: unknown = { allowed: true, used: 1, limit: 190000 };
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, '/api/v1/maps/mapbox/admission');
    assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error'); assert.equal(init?.body, undefined);
    return new Response(JSON.stringify(body), { status });
  };
  try {
    await admitMapboxTile(new AbortController().signal); await admitMapboxTile(new AbortController().signal);
    assert.equal(calls, 2);
    body={allowed:true,used:190000,limit:190000};await admitMapboxTile(new AbortController().signal);
    for (const used of [0, -1, 190001, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
      body = {allowed:true,used,limit:190000}; await assert.rejects(admitMapboxTile(new AbortController().signal), /counting unavailable/);
    }
    for (const value of [null, [], {}, {allowed:1,used:1,limit:190000}, {allowed:true,used:1,limit:200000}]) {
      body=value; await assert.rejects(admitMapboxTile(new AbortController().signal), /counting unavailable/);
    }
    body={allowed:false,reason:'limit',limit:190000};status=429;
    await assert.rejects(admitMapboxTile(new AbortController().signal), /budget reached/);
    status=503;await assert.rejects(admitMapboxTile(new AbortController().signal), /counting unavailable/);
    const before=calls, abort=new AbortController();abort.abort();
    await assert.rejects(admitMapboxTile(abort.signal));assert.equal(calls,before);
    globalThis.fetch=async()=>new Response('broken',{status:200});
    await assert.rejects(admitMapboxTile(new AbortController().signal), /counting unavailable/);
  } finally { globalThis.fetch=original; }
});

test('actual Chrome shared quota admission fixtures', { skip: !process.env.BASEMAP_QUOTA_DIST }, async () => {
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['docs/verification/mapbox-quota/browser.mjs'], { stdio: 'inherit', env: process.env });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Quota browser audit exited ${code}`)));
  });
});
