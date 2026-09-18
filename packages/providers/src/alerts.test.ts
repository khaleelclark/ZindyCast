import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlerts, ProviderError } from './index.js';
const now = new Date('2026-09-11T12:00:00Z');
function feature(id = 'urn:oid:example-1', changes: Record<string, unknown> = {}) {
  return { type: 'Feature', id: `https://api.weather.gov/alerts/${id}`, geometry: null as unknown, properties: {
    id, event: 'Flood Watch', headline: 'Official headline', severity: 'Severe', urgency: 'Future', certainty: 'Possible',
    sent: '2026-09-11T06:00:00-04:00', effective: '2026-09-11T06:00:00-04:00',
    onset: '2026-09-11T18:00:00Z', expires: '2026-09-12T12:00:00Z', ends: null,
    status: 'Actual', messageType: 'Alert', description: 'Official text.\nKeep exactly as issued.',
    instruction: 'Follow local officials.', areaDesc: 'County and forecast zone', senderName: 'NWS Example',
    affectedZones: ['https://api.weather.gov/zones/forecast/MDZ013'], references: [], ...changes,
  } };
}
function json(features: unknown[] = [], extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ type: 'FeatureCollection', features, ...extra }), { headers: { 'content-type': 'application/geo+json' } });
}
const errorCode = (code: string) => (error: unknown) => error instanceof ProviderError && error.code === code;

test('point query retains upcoming official alerts without polygons, requested identity, UTC and exact text', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.origin + url.pathname, 'https://api.weather.gov/alerts/active');
    assert.equal(url.searchParams.get('point'), '61.2181,-149.9003');
    assert.equal(new Headers(init.headers).get('accept'), 'application/geo+json');
    assert.match(new Headers(init.headers).get('user-agent')!, /^ZindyCast\//);
    return json([feature()]);
  });
  const result = await getAlerts(61.2181, -149.9003);
  assert.deepEqual(result.coordinates, { latitude: 61.2181, longitude: -149.9003 });
  assert.equal(result.retrievedAt, now.toISOString());
  assert.equal(result.alerts.length, 1);
  const alert = result.alerts[0];
  assert.equal(alert.sent, '2026-09-11T10:00:00.000Z');
  assert.equal(alert.onset, '2026-09-11T18:00:00.000Z');
  assert.equal(alert.geometry, null);
  assert.deepEqual(alert.affectedZones, feature().properties.affectedZones);
  assert.equal(alert.description, feature().properties.description);
  assert.equal(alert.web, feature().id);
});

test('expired information and ended events independently disappear; future onset is retained', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(globalThis, 'fetch', async () => json([
    feature('expired', { expires: now.toISOString(), ends: '2026-09-13T00:00:00Z' }),
    feature('ended', { ends: now.toISOString() }), feature('future-onset'),
    feature('future-effective', { effective: '2026-09-11T15:00:00Z' }),
    feature('future-sent', { sent: '2026-09-11T15:00:00Z' }),
    ...['Test', 'Exercise', 'System', 'Draft'].map(status => feature(status, { status })),
    ...['Cancel', 'Ack', 'Error'].map(messageType => feature(messageType, { messageType })),
  ]));
  assert.deepEqual((await getAlerts(21.31, -157.86)).alerts.map(a => a.id), ['future-onset']);
});

test('updates and cancellations suppress referenced messages, never unrelated events or real alerts via tests', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const reference = (id: string) => ({ identifier: id, sender: 'official', sent: '2026-09-11T10:00:00Z' });
  t.mock.method(globalThis, 'fetch', async () => json([
    feature('old'), feature('new', { messageType: 'Update', sent: '2026-09-11T11:00:00Z', references: [reference('old')] }),
    feature('cancelled'), feature('cancel', { messageType: 'Cancel', references: [reference('cancelled')] }),
    feature('unrelated'), feature('test-cancel', { status: 'Test', messageType: 'Cancel', references: [reference('unrelated')] }),
    feature('new', { headline: 'Older duplicate' }),
  ]));
  const alerts = (await getAlerts(38.98, -76.93)).alerts;
  assert.deepEqual(alerts.map(a => a.id), ['new', 'unrelated']);
  assert.equal(alerts[0].headline, 'Official headline');
});

test('official polygons and links survive; empty success is distinct from errors', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const item = feature('shape', { web: 'https://www.weather.gov/example', instruction: null, headline: null });
  item.geometry = { type: 'Polygon', coordinates: [[[-77, 38], [-76, 38], [-76, 39], [-77, 38]]] };
  let response = json([item]);
  t.mock.method(globalThis, 'fetch', async () => response);
  const alert = (await getAlerts(38.5, -76.5)).alerts[0];
  assert.deepEqual(alert.geometry, item.geometry);
  assert.equal(alert.web, 'https://www.weather.gov/example');
  assert.equal(alert.instruction, null);
  response = json();
  assert.deepEqual((await getAlerts(21.31, -157.86)).alerts, []);
});

test('malformed fields, geometry, payloads and pagination fail the entire snapshot', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  let response = json();
  t.mock.method(globalThis, 'fetch', async () => response);
  for (const change of [{ expires: null }, { sent: 'yesterday' }, { status: 'real' }, { severity: 'Danger' },
    { description: null }, { affectedZones: ['javascript:alert(1)'] }, { web: 'javascript:alert(1)' }, { references: [{}] }]) {
    response = json([feature('bad', change)]);
    await assert.rejects(getAlerts(0, 0), errorCode('provider_error'));
  }
  const item = feature(); item.geometry = { type: 'Point', coordinates: [0, 0] };
  response = json([item]); await assert.rejects(getAlerts(0, 0), errorCode('provider_error'));
  response = json([], { pagination: { next: 'https://api.weather.gov/alerts?cursor=next' } });
  await assert.rejects(getAlerts(0, 0), errorCode('provider_error'));
  for (const body of ['{}', '{', ' '.repeat(2_000_001)]) {
    response = new Response(body, { headers: { 'content-type': 'application/json' } });
    await assert.rejects(getAlerts(0, 0), errorCode('provider_error'));
  }
  response = new Response('<html/>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(getAlerts(0, 0), errorCode('provider_error'));
});

test('rate limits preserve delay, errors are sanitized, invalid coordinates never fetch', async t => {
  let calls = 0;
  let response = new Response('private details', { status: 429, headers: { 'retry-after': '60' } });
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response; });
  for (const [lat, lon] of [[91, 0], [0, 181], [NaN, 0], [0, Infinity]]) await assert.rejects(getAlerts(lat, lon), errorCode('invalid_request'));
  assert.equal(calls, 0);
  await assert.rejects(getAlerts(0, 0), (error: unknown) => error instanceof ProviderError && error.code === 'rate_limited' && error.retryAfterSeconds === 60 && error.httpStatus === 429);
  response = new Response('private details', { status: 503 });
  await assert.rejects(getAlerts(0, 0), { message: 'NWS alerts are unavailable.' });
});

test('eight-second timeout includes streaming response body; caller cancellation retains reason', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => new Response(new ReadableStream({
    start(controller) { init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true }); },
  }), { headers: { 'content-type': 'application/geo+json' } }));
  const assertion = assert.rejects(getAlerts(0, 0), { message: 'NWS alerts request timed out.' });
  await Promise.resolve(); t.mock.timers.tick(8_000); await assertion;
  const controller = new AbortController();
  const pending = getAlerts(0, 0, controller.signal);
  controller.abort(new DOMException('City changed', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError', message: 'City changed' });
  await assert.rejects(getAlerts(0, 0, controller.signal), { name: 'AbortError' });
});

test('documented same-origin active redirects work, unsafe or geographically changed redirects fail', async t => {
  let destination = 'https://api.weather.gov/alerts?active=true&point=0,0';
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.pathname === '/alerts/active'
    ? new Response(null, { status: 301, headers: { location: destination } }) : json());
  assert.deepEqual((await getAlerts(0, 0)).alerts, []);
  for (const unsafe of ['https://example.com/alerts?point=0,0', '/alerts?active=true&point=1,1', '/alerts?point=0,0']) {
    destination = unsafe; await assert.rejects(getAlerts(0, 0), errorCode('provider_error'));
  }
});
