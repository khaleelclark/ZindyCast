import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { ProviderError } from '@zindycast/providers';
import { CachedRequests } from './cache.js';
import { observationsCacheKey, registerObservations, type ObservationFetcher } from './observations.js';
import {
  ObservationsDataSchema, ObservationsResponseSchema, observationDistanceKm,
  observationFieldNames, observationFields, type ObservationQuery, type ObservationsData,
} from '../../../packages/contracts/src/observations.js';

const now = Date.parse('2026-09-14T12:00:00.000Z');
const coordinates = { latitude: 28.9, longitude: -81.25 };
const url = '/api/v1/observations?latitude=28.9&longitude=-81.25';
function data(query: ObservationQuery, changes: Record<string, unknown> = {}): ObservationsData {
  const stationCoordinates = { latitude: 28.78, longitude: -81.24 };
  const measurements = Object.fromEntries(observationFields.map(([, local]) => [local, {
    value: local === 'windGustMs' ? null : 0, qualityControl: 'V', qualityMeaning: 'verified_pass_levels_1_2_3',
  }]));
  return ObservationsDataSchema.parse({
    query, stations: [{ stationId: 'KSFB', name: 'Orlando Sanford International Airport',
      coordinates: stationCoordinates, elevationM: 16, distanceKm: observationDistanceKm(query, stationCoordinates),
      sourceUrl: 'https://api.weather.gov/stations/KSFB', latestObservationTime: query.until,
      observations: [{ sourceId: `https://api.weather.gov/stations/KSFB/observations/${encodeURIComponent(query.until)}`,
        time: query.until, textDescription: 'Fair', measurements, missingFields: ['windGustMs'] }] }],
    candidateCount: 3, candidateSetTruncated: true, provider: 'NWS',
    dataset: 'NWS API station observations (MADIS ingest)', classification: 'observed', retrievedAt: new Date(now).toISOString(),
    stationListSourceUrl: 'https://api.weather.gov/gridpoints/MLB/26,68/stations?limit=5',
    selectionPolicy: 'distance-ranked candidates only; no automatic representativeness selection',
    stationContinuity: 'observations remain grouped by station; no cross-station splice',
    intervalSemantics: 'station instants; precipitationLastHourMm is the reported preceding-hour accumulation ending at observation time',
    units: Object.fromEntries(observationFields.map(([, local, unit]) => [local, unit])),
    qualityControlSourceUrl: 'https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml',
    attribution: 'NWS and MADIS', ...changes,
  });
}
function setup(t: TestContext, fetcher: ObservationFetcher, storage = new SharedStorage({ path: ':memory:', providers: APP_PROVIDER_LIMITS }), clock = () => now) {
  const app = Fastify(); registerObservations(app, new CachedRequests(storage), fetcher, clock);
  t.after(async () => { await app.close(); storage.close(); });
  return { app, storage };
}

test('strict current route uses fixed three-hour/three-station contract and coalesces a five-call reservation', async t => {
  let calls = 0;
  const fetcher: ObservationFetcher = async query => {
    calls++;
    assert.deepEqual(query, { ...coordinates, since: '2026-09-14T09:00:00.000Z',
      until: '2026-09-14T12:00:00.000Z', stationLimit: 3 });
    await Promise.resolve();
    return data(query);
  };
  const { app } = setup(t, fetcher);
  const responses = await Promise.all([app.inject(url), app.inject(url)]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], undefined);
    const parsed = ObservationsResponseSchema.parse(response.json());
    assert.equal(parsed.freshness, 'fresh'); assert.equal(parsed.data.stations[0].stationId, 'KSFB');
    assert.equal(parsed.data.stations[0].observations[0].measurements.precipitationLastHourMm.value, 0);
  }
  assert.equal(calls, 1);
});

test('invalid, duplicate, blank and unknown query values never call the observation provider', async t => {
  let calls = 0;
  const { app } = setup(t, async query => { calls++; return data(query); });
  for (const query of ['latitude=&longitude=0', 'latitude=91&longitude=0', 'latitude=0&longitude=181',
    'latitude=NaN&longitude=0', 'latitude=0&latitude=1&longitude=0', 'latitude=0&longitude=0&station=KSFB',
    ...['', '0', 'true', '2', '1&refresh=1'].map(value => `latitude=0&longitude=0&refresh=${value}`)]) {
    assert.equal((await app.inject('/api/v1/observations?' + query)).statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('manual refresh revalidates the same cache after ten seconds, coalesces, and preserves observation time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  let calls = 0;
  const { app, storage } = setup(t, async query => {
    calls++;
    assert.deepEqual(Object.keys(query).sort(), ['latitude', 'longitude', 'since', 'stationLimit', 'until']);
    assert.equal(query.latitude, coordinates.latitude);
    assert.equal(query.longitude, coordinates.longitude);
    const result = data(query, { retrievedAt: new Date().toISOString() });
    // An upstream recheck may legitimately return the same latest report.
    result.stations[0].latestObservationTime = new Date(now).toISOString();
    result.stations[0].observations[0].time = new Date(now).toISOString();
    await new Promise(resolve => setImmediate(resolve));
    return ObservationsDataSchema.parse(result);
  }, undefined, Date.now);
  assert.equal((await app.inject(url)).statusCode, 200);
  t.mock.timers.tick(20_000);
  assert.equal((await app.inject(url)).statusCode, 200);
  assert.equal(calls, 1);
  const responses = await Promise.all([app.inject(url + '&refresh=1'), app.inject(url + '&refresh=1')]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    const parsed = ObservationsResponseSchema.parse(response.json());
    assert.equal(parsed.freshness, 'fresh');
    assert.equal(parsed.data.retrievedAt, new Date(now + 20_000).toISOString());
    assert.equal(parsed.data.stations[0].observations[0].time, new Date(now).toISOString());
  }
  assert.equal(calls, 2);
  const cached = storage.get(observationsCacheKey(coordinates.latitude, coordinates.longitude))!;
  assert.equal(cached.expiresAt - cached.retrievedAt, 300_000);
  t.mock.timers.tick(9_999);
  assert.equal((await app.inject(url + '&refresh=1')).statusCode, 200);
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  assert.equal((await app.inject(url + '&refresh=1')).statusCode, 200);
  assert.equal(calls, 3);
});

test('manual refresh preserves quota enforcement and marks retained reports stale on denial or outage', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const limits = { minute: 5, hour: 5, day: 5, month: 5 };
  const storage = new SharedStorage({ path: ':memory:', providers: { nws: limits } });
  let calls = 0;
  const { app } = setup(t, async query => { calls++; return data(query); }, storage, Date.now);
  assert.equal((await app.inject(url)).statusCode, 200);
  t.mock.timers.tick(20_000);
  const denied = await app.inject(url + '&refresh=1');
  assert.equal(denied.statusCode, 200);
  assert.equal(denied.json().freshness, 'stale');
  assert.equal(denied.json().data.retrievedAt, new Date(now).toISOString());
  assert.equal(calls, 1);
  let offline = false;
  const outage = setup(t, async query => {
    if (offline) throw new Error('private outage');
    return data(query, { retrievedAt: new Date().toISOString() });
  }, undefined, Date.now).app;
  assert.equal((await outage.inject(url)).statusCode, 200);
  offline = true;
  t.mock.timers.tick(20_000);
  const retained = await outage.inject(url + '&refresh=1');
  assert.equal(retained.statusCode, 200);
  assert.equal(retained.json().freshness, 'stale');
  assert.equal(retained.json().data.retrievedAt, new Date(now + 20_000).toISOString());
  assert.ok(!retained.body.includes('private'));
});

test('stale cache is explicit during outage, but wrong geography is never a fallback', async t => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const storage = new SharedStorage({ path: ':memory:', providers: APP_PROVIDER_LIMITS, clock: () => now });
  const key = observationsCacheKey(coordinates.latitude, coordinates.longitude);
  const historicalQuery = { ...coordinates, since: '2026-09-14T08:54:00.000Z',
    until: '2026-09-14T11:54:00.000Z', stationLimit: 3 } as const;
  storage.set(key, JSON.parse(JSON.stringify(data(historicalQuery))), {
    retrievedAt: now - 360_000, expiresAt: now - 60_000, staleUntil: now + 540_000,
  });
  const { app } = setup(t, async () => { throw new Error('private upstream outage'); }, storage);
  const stale = await app.inject(url);
  assert.equal(stale.statusCode, 200); assert.equal(stale.json().freshness, 'stale'); assert.ok(!stale.body.includes('private'));

  const wrongStorage = new SharedStorage({ path: ':memory:', providers: APP_PROVIDER_LIMITS, clock: () => now });
  const wrongQuery = { ...historicalQuery, latitude: 0, longitude: 0 };
  wrongStorage.set(key, JSON.parse(JSON.stringify(data(wrongQuery))), {
    retrievedAt: now - 360_000, expiresAt: now - 60_000, staleUntil: now + 540_000,
  });
  const wrong = setup(t, async () => { throw new Error('offline'); }, wrongStorage).app;
  assert.equal((await wrong.inject(url)).statusCode, 502);
});

test('malformed quality metadata and future retrievals fail at the API binding', async t => {
  const query = { ...coordinates, since: '2026-09-14T09:00:00.000Z', until: '2026-09-14T12:00:00.000Z', stationLimit: 3 } as const;
  const valid = data(query);
  const badQc = structuredClone(valid) as unknown as Record<string, any>;
  badQc.stations[0].observations[0].measurements.temperatureC.qualityMeaning = 'questioned_failed_level_2_or_3';
  let current: unknown = badQc;
  const { app } = setup(t, async () => current as ObservationsData);
  assert.equal((await app.inject(url)).statusCode, 502);
  current = { ...valid, retrievedAt: '2026-09-14T12:00:02.000Z' };
  assert.equal((await app.inject(url)).statusCode, 502);
  assert.deepEqual(observationFieldNames.length, 9);
});

test('NWS quota denial happens before fetch; provider rate and no-data errors map without private details', async t => {
  const limits = { minute: 4, hour: 4, day: 4, month: 4 };
  const storage = new SharedStorage({ path: ':memory:', providers: { nws: limits }, clock: () => now });
  let calls = 0;
  const denied = setup(t, async query => { calls++; return data(query); }, storage).app;
  const response = await denied.inject(url);
  assert.equal(response.statusCode, 429); assert.equal(calls, 0);

  let error = new ProviderError('rate_limited', 'private provider detail', 429, 23);
  const mapped = setup(t, async () => { throw error; }).app;
  let result = await mapped.inject(url);
  assert.equal(result.statusCode, 429); assert.equal(result.headers['retry-after'], '23'); assert.ok(!result.body.includes('private'));
  error = new ProviderError('no_data', 'private geography detail', 404);
  result = await mapped.inject(url);
  assert.equal(result.statusCode, 503); assert.equal(result.json().code, 'no_data'); assert.ok(!result.body.includes('private'));
});
