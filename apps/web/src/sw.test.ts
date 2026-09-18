import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const origin = 'https://weather.test';
const worker = readFileSync('apps/web/public/sw.js', 'utf8');
function harness(build = '/static/js/new.123.js', html = '<script src="/static/js/new.123.js"></script>') {
  const events: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const removed: string[] = []; const fetched: string[] = [];
  let windows: unknown[] = []; let skipped = 0; let claims = 0; let failAssets = false; let networkType = 'text/javascript'; let networkStatus = 200;
  const registration: { installing: unknown; waiting: unknown } = { installing: null, waiting: null };
  const key = (request: any) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const current = 'zindycast-shell-v3-?build=' + encodeURIComponent(build);
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => { removed.push(name); return stores.delete(name); },
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return { match: async (request: any) => store.get(key(request))?.clone(), put: async (request: any, response: Response) => { store.set(key(request), response.clone()); }, addAll: async (paths: string[]) => { if (failAssets) throw new Error('asset failure'); for (const path of paths) store.set(key(path), new Response(path)); } };
    },
  };
  runInNewContext(worker, { URL, self: { location: { href: origin + '/sw.js?build=' + encodeURIComponent(build), origin }, registration, addEventListener: (name: string, fn: (event: any) => void) => { events[name] = fn; }, skipWaiting: async () => { skipped++; }, clients: { matchAll: async () => windows, claim: async () => { claims++; } } }, caches,
    fetch: async (request: any) => { const path = key(request); fetched.push(path); return path === origin + '/' ? new Response(html, { headers: { 'content-type': 'text/html' } }) : new Response('network', { status: networkStatus, headers: { 'content-type': networkType } }); },
  });
  async function dispatch(name: string, data?: unknown) { let result: Promise<unknown> | undefined; events[name]!({ data, waitUntil: (value: Promise<unknown>) => { result = value; } }); await result; }
  async function request(path: string, mode = 'cors') { let result: Promise<Response> | undefined; events.fetch!({ request: { url: new URL(path, origin).href, mode, method: 'GET' }, respondWith: (value: Promise<Response>) => { result = value; } }); return result; }
  async function seed(name: string, path: string, text: string) { await (await caches.open(name)).put(path, new Response(text)); }
  return { network: (type: string, status = 200) => { networkType = type; networkStatus = status; }, stores, current, removed, fetched, registration, dispatch, request, seed, windows: (value: unknown[]) => { windows = value; }, failAssets: () => { failAssets = true; }, skipped: () => skipped, claims: () => claims };
}
test('worker excludes all data and release-check requests', async () => {
  const h = harness();
  for (const path of ['/api/v1/forecast', '/api/v1/alerts', '/api/v1/location', '/weather/data', '/maps/tile.png', '/provider/data', '/?shell-release-check=1', 'https://provider.test/static/js/a.js']) assert.equal(await h.request(path, 'navigate'), undefined, path);
  assert.equal(h.fetched.length, 0);
});
test('production shell installation caches generated entry assets', async () => {
  const html = readFileSync('apps/web/dist/index.html', 'utf8');
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/static\/[^\"]+)"/g)].map(match => match[1]!))].sort();
  const h = harness(assets.join('|'), html);
  await h.dispatch('install');
  assert.equal(await (await h.request('/', 'navigate'))!.text(), html);
  for (const asset of assets) assert.ok(h.stores.get(h.current)!.has(origin + asset), asset);
  assert.ok(h.stores.get(h.current)!.has(origin + '/sky-boot.js'), 'appearance restore is available offline');
  assert.equal(h.stores.get(h.current)!.size, assets.length + 5);
});
test('three-release open tabs retain their assets; fallback never uses old HTML or icons', async () => {
  const h = harness();
  await h.seed('zindycast-shell-oldest', '/static/js/old.111.js', 'old bundle');
  await h.seed('zindycast-shell-previous', '/icon.svg', 'old icon');
  await h.seed('zindycast-shell-previous', '/', 'old html');
  await h.dispatch('install'); h.windows([{}, {}]); await h.dispatch('activate');
  assert.equal(h.removed.length, 0); assert.equal(h.claims(), 1);
  assert.equal(await (await h.request('/static/js/old.111.js'))!.text(), 'old bundle');
  assert.notEqual(await (await h.request('/icon.svg'))!.text(), 'old icon');
  assert.notEqual(await (await h.request('/', 'navigate'))!.text(), 'old html');
});
test('pruning waits for no windows and no competing install, preserving one prior shell', async () => {
  const h = harness(); await h.seed('zindycast-shell-one', '/', 'one'); await h.seed('zindycast-shell-two', '/', 'two'); await h.seed('unrelated', '/', 'other'); await h.dispatch('install');
  h.registration.installing = {}; await h.dispatch('activate'); assert.equal(h.removed.length, 0);
  h.registration.installing = null; await h.dispatch('activate');
  assert.deepEqual(h.removed, ['zindycast-shell-one']); assert.ok(h.stores.has('unrelated')); assert.ok(h.stores.has('zindycast-shell-two'));
});
test('release mismatch fails before cache writes and asset failure preserves active shell', async () => {
  const mismatch = harness('/static/js/old.111.js'); await mismatch.seed('zindycast-shell-active', '/', 'active');
  await assert.rejects(mismatch.dispatch('install'), /release changed/); assert.equal(mismatch.stores.size, 1);
  const failed = harness(); await failed.seed('zindycast-shell-active', '/', 'active'); failed.failAssets();
  await assert.rejects(failed.dispatch('install'), /asset failure/); assert.ok(failed.stores.has('zindycast-shell-active')); assert.ok(!failed.stores.has(failed.current));
});
test('installation waits for explicit activation and ignores unrelated messages', async () => {
  const h = harness(); await h.dispatch('install'); assert.equal(h.skipped(), 0);
  await h.dispatch('message', { type: 'OTHER' }); assert.equal(h.skipped(), 0);
  await h.dispatch('message', { type: 'ACTIVATE_UPDATE' }); assert.equal(h.skipped(), 1);
});
test('reinstalling the same shell identity does not overwrite or delete its active cache', async () => {
  const h = harness(); await h.dispatch('install');
  const before = await (await h.request('/', 'navigate'))!.text();
  h.failAssets(); await h.dispatch('install');
  assert.equal(await (await h.request('/', 'navigate'))!.text(), before);
  assert.equal(h.removed.length, 0);
});

 test('visited hashed lazy assets survive offline/old-release fallback but HTML/errors never cache', async () => {
  const h = harness(); await h.dispatch('install');
  const chunk = '/static/js/async/954.40b18df07d.js';
  assert.equal(await (await h.request(chunk))!.text(), 'network');
  assert.ok(h.stores.get(h.current)!.has(origin + chunk));
  const calls = h.fetched.length; await h.request(chunk); assert.equal(h.fetched.length, calls);
  h.network('text/html'); await h.request('/static/js/async/other.abcdef1234.js');
  assert.ok(!h.stores.get(h.current)!.has(origin + '/static/js/async/other.abcdef1234.js'));
  h.network('text/javascript', 503); await h.request('/static/js/async/failed.abcdef1234.js');
  assert.ok(!h.stores.get(h.current)!.has(origin + '/static/js/async/failed.abcdef1234.js'));
  await h.seed('zindycast-shell-old', '/static/css/async/old.abcdef1234.css', 'old lazy css');
  assert.equal(await (await h.request('/static/css/async/old.abcdef1234.css'))!.text(), 'old lazy css');
});
