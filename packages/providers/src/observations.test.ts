import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError } from './index.js';
import { fetchNearbyObservations } from './observations.js';
import { observationDistanceKm, type ObservationQuery } from '../../contracts/src/observations.js';

const query: ObservationQuery = {
  latitude: 28.9, longitude: -81.25, since: '2026-09-14T09:00:00.000Z',
  until: '2026-09-14T12:00:00.000Z', stationLimit: 3,
};
const linkedStations = 'https://api.weather.gov/gridpoints/MLB/26,68/stations';
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/geo+json', ...headers } });
}
function point(link = linkedStations) { return { properties: { observationStations: link } }; }
function station(id: string, latitude: number, longitude: number, elevation = 10, name = `Station ${id}`) {
  return { type: 'Feature', id: `https://api.weather.gov/stations/${id}`,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { stationIdentifier: id, name, elevation: { value: elevation, unitCode: 'wmoUnit:m' } } };
}
function stationList(features = [station('KLEE', 28.82, -81.81), station('KDAB', 29.18, -81.05), station('KSFB', 28.78, -81.24)]) {
  return { type: 'FeatureCollection', features };
}
function q(value: number | null, unitCode: string, qualityControl: string | null = 'V') {
  return { value, unitCode, qualityControl };
}
function observation(id: string, time = '2026-09-14T11:53:00+00:00', changes: Record<string, unknown> = {}) {
  return { type: 'Feature', id: `https://api.weather.gov/stations/${id}/observations/${encodeURIComponent(time)}`,
    properties: { station: `https://api.weather.gov/stations/${id}`, stationId: id, stationName: `Station ${id}`,
      timestamp: time, textDescription: 'Light Rain',
      temperature: q(27.2, 'wmoUnit:degC', 'V'), dewpoint: q(24.1, 'wmoUnit:degC', 'S'),
      relativeHumidity: q(83, 'wmoUnit:percent', 'C'), windSpeed: q(3.6, 'wmoUnit:m_s-1', 'G'),
      windGust: q(null, 'wmoUnit:m_s-1', 'Z'), windDirection: q(90, 'wmoUnit:degree_(angle)', 'T'),
      barometricPressure: q(101_200, 'wmoUnit:Pa', 'Q'), visibility: q(16_093, 'wmoUnit:m', 'X'),
      precipitationLastHour: q(0, 'wmoUnit:mm', 'B'), ...changes } };
}
function observationList(features: unknown[] = []) { return { type: 'FeatureCollection', features }; }
function standardMock(t: TestContext, features = stationList().features) {
  return t.mock.method(globalThis, 'fetch', async (url: URL) => {
    if (url.pathname.startsWith('/points/')) return json(point());
    if (url.pathname.startsWith('/gridpoints/')) return json(stationList(features));
    const id = url.pathname.split('/')[2];
    return json(observationList([observation(id)]));
  });
}
const hasCode = (code: string) => (error: unknown) => error instanceof ProviderError && error.code === code;

test('bounded nearby histories retain station identity, distance, elevation, time, missingness and exact MADIS flags', async t => {
  const fetchMock = standardMock(t);
  const result = await fetchNearbyObservations(query);
  assert.equal(fetchMock.mock.callCount(), 5);
  const urls = fetchMock.mock.calls.map(call => call.arguments[0] as URL);
  assert.equal(urls[0].toString(), 'https://api.weather.gov/points/28.9,-81.25');
  assert.equal(urls[1].searchParams.get('limit'), '5');
  for (const url of urls.slice(2)) {
    assert.equal(url.searchParams.get('start'), query.since);
    assert.equal(url.searchParams.get('end'), query.until);
    assert.equal(url.searchParams.get('limit'), '500');
  }
  assert.deepEqual(result.stations.map(item => item.stationId), ['KSFB', 'KDAB', 'KLEE']);
  assert.equal(result.stations[0].elevationM, 10);
  assert.equal(result.stations[0].distanceKm, observationDistanceKm(query, { latitude: 28.78, longitude: -81.24 }));
  assert.equal(result.stations[0].latestObservationTime, '2026-09-14T11:53:00.000Z');
  assert.equal(result.stations[0].observationHistoryTruncated, false);
  const row = result.stations[0].observations[0];
  assert.deepEqual(row.measurements.temperatureC, { value: 27.2, qualityControl: 'V', qualityMeaning: 'verified_pass_levels_1_2_3' });
  assert.deepEqual(row.measurements.barometricPressurePa, { value: 101_200, qualityControl: 'Q', qualityMeaning: 'questioned_failed_level_2_or_3' });
  assert.deepEqual(row.measurements.precipitationLastHourMm, { value: 0, qualityControl: 'B', qualityMeaning: 'subjective_bad' });
  assert.deepEqual(row.missingFields, ['windGustMs']);
  assert.equal(result.selectionPolicy, 'distance-ranked candidates only; no automatic representativeness selection');
  assert.equal(result.stationContinuity, 'observations remain grouped by station; no cross-station splice');
  assert.equal(result.candidateSetTruncated, false);
});

test('historical records remain per-station, newest-first, bounded to since/until and never splice candidates', async t => {
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    if (url.pathname.startsWith('/points/')) return json(point());
    if (url.pathname.startsWith('/gridpoints/')) return json(stationList([station('ONE', 28.91, -81.24), station('TWO', 28.92, -81.23)]));
    const id = url.pathname.split('/')[2];
    return json(observationList([
      observation(id, '2026-09-14T10:00:00Z', { temperature: q(id === 'ONE' ? 20 : 30, 'wmoUnit:degC', 'V') }),
      observation(id, '2026-09-14T08:59:00Z'),
      observation(id, '2026-09-14T12:00:00Z', { temperature: q(id === 'ONE' ? 21 : 31, 'wmoUnit:degC', 'Z') }),
    ]));
  });
  const result = await fetchNearbyObservations({ ...query, stationLimit: 2 });
  assert.equal(result.stations.length, 2);
  for (const item of result.stations) assert.deepEqual(item.observations.map(row => row.time),
    ['2026-09-14T12:00:00.000Z', '2026-09-14T10:00:00.000Z']);
  assert.deepEqual(result.stations.map(item => item.observations.map(row => row.measurements.temperatureC.value)), [[21, 20], [31, 30]]);
});

test('NWS km/h wind normalizes to SI while retaining quality flags, nulls and calm zero', async t => {
  let changes: Record<string, unknown> = {
    windSpeed: q(25.92, 'wmoUnit:km_h-1', 'V'), windGust: q(33.48, 'wmoUnit:km_h-1', 'C'),
  };
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.pathname.startsWith('/points/') ? json(point()) :
    url.pathname.startsWith('/gridpoints/') ? json(stationList([station('KSFB', 28.78, -81.24)])) :
      json(observationList([observation('KSFB', undefined, changes)])));
  const read = () => fetchNearbyObservations({ ...query, stationLimit: 1 });
  const result = await read();
  const row = result.stations[0].observations[0];
  assert.equal(row.measurements.windSpeedMs.value, 7.2);
  assert.ok(Math.abs(row.measurements.windGustMs.value! - 9.3) < 1e-12);
  assert.equal(row.measurements.windSpeedMs.qualityControl, 'V');
  assert.equal(row.measurements.windGustMs.qualityMeaning, 'coarse_pass_level_1');
  assert.equal(result.units.windSpeedMs, 'wmoUnit:m_s-1');
  assert.equal(result.units.windGustMs, 'wmoUnit:m_s-1');
  changes = { windSpeed: q(0, 'wmoUnit:km_h-1'), windGust: q(null, 'wmoUnit:km_h-1', 'Z') };
  const calm = (await read()).stations[0].observations[0];
  assert.equal(calm.measurements.windSpeedMs.value, 0);
  assert.deepEqual(calm.measurements.windGustMs, { value: null, qualityControl: 'Z', qualityMeaning: 'preliminary_no_qc' });
  assert.deepEqual(calm.missingFields, ['windGustMs']);
  for (const invalid of [
    { windSpeed: q(10, 'wmoUnit:kn') },
    { temperature: q(10, 'wmoUnit:km_h-1') },
    { windGust: q(null, 'wmoUnit:unknown') },
    { windSpeed: q(10, 'wmoUnit:km_h-1', 'P') },
  ]) {
    changes = invalid;
    await assert.rejects(read(), hasCode('provider_error'));
  }
});

test('empty station or observation collections are explicit successful no-published-record states', async t => {
  let stations: ReturnType<typeof station>[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    if (url.pathname.startsWith('/points/')) return json(point());
    if (url.pathname.startsWith('/gridpoints/')) return json(stationList(stations));
    return json(observationList());
  });
  let result = await fetchNearbyObservations(query);
  assert.equal(result.candidateCount, 0); assert.deepEqual(result.stations, []);
  stations = [station('KLEE', 28.82, -81.81)];
  result = await fetchNearbyObservations(query);
  assert.equal(result.stations[0].latestObservationTime, null); assert.deepEqual(result.stations[0].observations, []);
});

test('documented optional feature IDs use canonical station/time endpoints without changing data identity', async t => {
  const candidate = station('KLEE', 28.82, -81.81); delete (candidate as { id?: string }).id;
  const row = observation('KLEE'); delete (row as { id?: string }).id;
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.pathname.startsWith('/points/') ? json(point()) :
    url.pathname.startsWith('/gridpoints/') ? json(stationList([candidate])) : json(observationList([row])));
  const result = await fetchNearbyObservations({ ...query, stationLimit: 1 });
  assert.equal(result.stations[0].sourceUrl, 'https://api.weather.gov/stations/KLEE');
  assert.match(result.stations[0].observations[0].sourceId, /^https:\/\/api\.weather\.gov\/stations\/KLEE\/observations\//);
});

test('a paginated first page stays explicitly partial without additional requests or out-of-window rows', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: URL) => url.pathname.startsWith('/points/') ? json(point()) :
    url.pathname.startsWith('/gridpoints/') ? json(stationList([station('KLEE', 28.82, -81.81)])) : json({
      ...observationList([observation('KLEE', '2026-09-14T10:00:00Z'), observation('KLEE'),
        observation('KLEE', '2026-09-14T08:00:00Z')]),
      pagination: { next: 'https://api.weather.gov/stations/KLEE/observations?cursor=x' },
    }));
  const result = await fetchNearbyObservations({ ...query, stationLimit: 1 });
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.equal(result.stations[0].observationHistoryTruncated, true);
  assert.equal(result.stations[0].latestObservationTime, '2026-09-14T11:53:00.000Z');
  assert.deepEqual(result.stations[0].observations.map(row => row.time),
    ['2026-09-14T11:53:00.000Z', '2026-09-14T10:00:00.000Z']);
});

test('malformed units, flags, linked origins, geography, identity, duplicates and oversized history fail closed', async t => {
  let pointPayload: unknown = point();
  let stationsPayload: unknown = stationList([station('KLEE', 28.82, -81.81)]);
  let observationsPayload: unknown = observationList([observation('KLEE')]);
  t.mock.method(globalThis, 'fetch', async (url: URL) => url.pathname.startsWith('/points/') ? json(pointPayload) :
    url.pathname.startsWith('/gridpoints/') ? json(stationsPayload) : json(observationsPayload));
  const one = { ...query, stationLimit: 1 };
  const resets = () => { pointPayload = point(); stationsPayload = stationList([station('KLEE', 28.82, -81.81)]); observationsPayload = observationList([observation('KLEE')]); };
  const cases: Array<() => void> = [
    () => { pointPayload = point('https://example.com/stations'); },
    () => { pointPayload = point('https://api.weather.gov/stations'); },
    () => { const bad = station('KLEE', 91, -81.81); stationsPayload = stationList([bad]); },
    () => { const bad = station('KLEE', 28.82, -81.81); bad.properties.elevation.unitCode = 'wmoUnit:ft'; stationsPayload = stationList([bad]); },
    () => { observationsPayload = observationList([observation('OTHER')]); },
    () => { const row = observation('KLEE'); row.id = row.id.replace('/KLEE/', '/OTHER/'); observationsPayload = observationList([row]); },
    () => { observationsPayload = observationList([observation('KLEE', undefined, { temperature: q(20, 'wmoUnit:degF') })]); },
    () => { observationsPayload = observationList([observation('KLEE', undefined, { temperature: q(20, 'wmoUnit:degC', 'P') })]); },
    () => { observationsPayload = observationList(Array.from({ length: 501 }, () => observation('KLEE'))); },
    () => { observationsPayload = { ...observationList(), pagination: { next: 'https://example.com/observations' } }; },
    () => { observationsPayload = observationList([observation('KLEE'), observation('KLEE')]); },
  ];
  for (const corrupt of cases) { resets(); corrupt(); await assert.rejects(fetchNearbyObservations(one), hasCode('provider_error')); }
});

test('invalid inputs never fetch; seven-day bound is inclusive', async t => {
  const fetchMock = standardMock(t, []);
  for (const bad of [
    { ...query, latitude: 91 }, { ...query, longitude: 181 }, { ...query, since: 'not-time' },
    { ...query, stationLimit: 4 }, { ...query, since: '2026-09-07T08:59:59.999Z' },
    { ...query, since: '2026-09-15T00:00:00.000Z' },
  ]) await assert.rejects(fetchNearbyObservations(bad), hasCode('invalid_request'));
  assert.equal(fetchMock.mock.callCount(), 0);
  await fetchNearbyObservations({ ...query, since: '2026-09-07T12:00:00.000Z' });
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('HTTP limits preserve Retry-After while other failures and content errors are sanitized', async t => {
  let response = new Response('private', { status: 429, headers: { 'retry-after': '17' } });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(fetchNearbyObservations(query), (error: unknown) => error instanceof ProviderError &&
    error.code === 'rate_limited' && error.httpStatus === 429 && error.retryAfterSeconds === 17);
  response = new Response('private', { status: 503 });
  await assert.rejects(fetchNearbyObservations(query), (error: unknown) => error instanceof ProviderError &&
    error.message === 'NWS observations are unavailable.' && !error.message.includes('private'));
  response = new Response('<html/>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(fetchNearbyObservations(query), hasCode('provider_error'));
  response = new Response('{', { headers: { 'content-type': 'application/geo+json' } });
  await assert.rejects(fetchNearbyObservations(query), hasCode('provider_error'));
});

test('caller cancellation is preserved and the ten-second deadline includes response streaming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => new Response(new ReadableStream({
    start(controller) { init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true }); },
  }), { headers: { 'content-type': 'application/geo+json' } }));
  let pending = fetchNearbyObservations(query);
  const timed = assert.rejects(pending, (error: unknown) => error instanceof ProviderError && error.message.includes('timed out'));
  await Promise.resolve(); t.mock.timers.tick(10_000); await timed;
  const controller = new AbortController();
  pending = fetchNearbyObservations(query, controller.signal);
  controller.abort(new DOMException('City changed', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError', message: 'City changed' });
  await assert.rejects(fetchNearbyObservations(query, controller.signal), { name: 'AbortError' });
});

test('precise city and GPS coordinates use canonical NWS point precision without changing requested identity', async t => {
  const mock = standardMock(t);
  const exact = { ...query, latitude: 28.90054, longitude: -81.26367 };
  const result = await fetchNearbyObservations(exact);
  assert.equal((mock.mock.calls[0].arguments[0] as URL).pathname, '/points/28.9005,-81.2637');
  assert.deepEqual(result.query, exact);
  assert.equal(result.stations[0].distanceKm, observationDistanceKm(exact, result.stations[0].coordinates));
  assert.equal(mock.mock.callCount(), 5);
});
