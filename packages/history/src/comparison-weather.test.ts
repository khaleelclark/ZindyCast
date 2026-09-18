import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HistoryError, type ReanalysisQuery } from './index.js';
import { fetchComparisonWeather, comparisonWeatherRequestUrl } from './comparison-weather.js';
import { ComparisonWeatherDataSchema, comparisonWeatherFields } from '../../contracts/src/comparison-weather.js';
import { readFileSync } from 'node:fs';

const query: ReanalysisQuery = { latitude: 40.7, longitude: -74, startDate: '2020-03-08', endDate: '2020-03-08' };
function payload(q = query) {
  const n = (Date.parse(q.endDate) - Date.parse(q.startDate)) / 3600000 + 24;
  return { latitude: 40.75, longitude: -74.0, elevation: 10, utc_offset_seconds: 0,
    hourly_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', precipitation: 'mm', wind_speed_10m: 'm/s', dew_point_2m: '°C', wet_bulb_temperature_2m: '°C', sunshine_duration: 's', cloud_cover: '%', weather_code: 'wmo code' },
    hourly: { time: Array.from({ length: n }, (_, i) => Date.parse(q.startDate) / 1000 + i * 3600),
      temperature_2m: Array<number | null>(n).fill(-5), relative_humidity_2m: Array<number | null>(n).fill(50),
      precipitation: Array<number | null>(n).fill(0), wind_speed_10m: Array<number | null>(n).fill(0), dew_point_2m: Array<number | null>(n).fill(-10), wet_bulb_temperature_2m: Array<number | null>(n).fill(-7), sunshine_duration: Array<number | null>(n).fill(0), cloud_cover: Array<number | null>(n).fill(0), weather_code: Array<number | null>(n).fill(0) } };
}
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const isCode = (code: HistoryError['code']) => (error: unknown) => error instanceof HistoryError && error.code === code;

test('explicit ERA5 query, SI data, UTC DST timeline and independent provenance', async t => {
  let seen: URL | undefined;
  t.mock.method(globalThis, 'fetch', async (input: URL, options: RequestInit) => {
    seen = input; assert.equal(options.redirect, 'error'); return json(payload());
  });
  const result = await fetchComparisonWeather(query);
  assert.equal(seen?.origin, 'https://archive-api.open-meteo.com');
  assert.equal(seen?.searchParams.get('models'), 'era5');
  assert.equal(seen?.searchParams.get('timezone'), 'GMT');
  assert.equal(seen?.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(result.hours.length, 24);
  assert.equal(result.hours[0].time, '2020-03-08T00:00:00.000Z');
  assert.equal(result.hours[23].time, '2020-03-08T23:00:00.000Z');
  assert.equal(result.query.latitude, 40.7);
  assert.equal(result.provenance.sourceCoordinates.latitude, 40.75);
  assert.equal(result.provenance.constituent, null);
  assert.equal(result.provenance.sourceIssuedAt, null);
  assert.equal(result.provenance.classification, 'modeled_reanalysis');
  assert.equal(result.completeness.completeHours, 24);
  assert.equal(result.hours[0].precipitationMm, 0);
  assert.equal(result.hours[0].temperatureC, -5);
  for (const dates of [['2020-11-01', '2020-11-02'], ['1940-01-01', '1940-01-31'], ['2020-02-29', '2020-02-29']]) {
    const q = { ...query, startDate: dates[0], endDate: dates[1] };
    t.mock.method(globalThis, 'fetch', async () => json(payload(q)));
    const d = await fetchComparisonWeather(q);
    assert.equal(d.hours.length, payload(q).hourly.time.length);
    assert.ok(d.hours.every((h, i) => i === 0 || Date.parse(h.time) - Date.parse(d.hours[i - 1].time) === 3600000));
  }
});

test('null fields, absent variable, and omitted timestamp preserve distinct missingness', async t => {
  const p = payload(); p.hourly.temperature_2m[0] = null;
  delete (p.hourly as Partial<typeof p.hourly>).dew_point_2m;
  for (const a of Object.values(p.hourly)) a.splice(2, 1);
  t.mock.method(globalThis, 'fetch', async () => json(p));
  const d = await fetchComparisonWeather(query);
  assert.equal(d.hours.length, 24);
  assert.equal(d.hours[2].sourceHourPresent, false);
  assert.equal(d.hours[2].missingFields.length, 9);
  assert.equal(d.hours[0].sourceHourPresent, true);
  assert.equal(d.hours[0].temperatureC, null);
  assert.equal(d.hours[1].precipitationMm, 0);
  assert.deepEqual(d.completeness, { status: 'partial', expectedHours: 24, sourceHours: 23, completeHours: 0,
    missingHours: 1, validCounts: { temperatureC: 22, humidityPercent: 23, precipitationMm: 23, windSpeedMs: 23, dewPointC: 0, wetBulbTemperatureC: 23, sunshineDurationSeconds: 23, cloudCoverPercent: 23, weatherCode: 23 } });
});

test('empty and all-null responses return no_data completeness without invented measurements', async t => {
  const p = payload();
  for (const array of Object.values(p.hourly)) array.length = 0;
  t.mock.method(globalThis, 'fetch', async () => json(p));
  const empty = await fetchComparisonWeather(query);
  assert.equal(empty.completeness.status, 'no_data'); assert.equal(empty.completeness.missingHours, 24);
  assert.equal(empty.hours[0].precipitationMm, null);
  const p2 = payload();
  for (const key of ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m', 'dew_point_2m', 'wet_bulb_temperature_2m', 'sunshine_duration', 'cloud_cover', 'weather_code'] as const) p2.hourly[key].fill(null);
  t.mock.method(globalThis, 'fetch', async () => json(p2));
  const allNull = await fetchComparisonWeather(query);
  assert.equal(allNull.completeness.status, 'no_data'); assert.equal(allNull.completeness.missingHours, 0);
});

test('invalid dates/coordinates, 32-day spans, future and recent domain rejected without network', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  for (const q of [ { ...query, latitude: NaN }, { ...query, longitude: 181 },
    { ...query, startDate: '1939-12-31' }, { ...query, startDate: '2020-02-30' },
    { ...query, startDate: '2020-03-09' }, { ...query, endDate: '2020-04-08' },
    { ...query, startDate: '9999-01-01', endDate: '9999-01-01' },
    { ...query, startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) } ]) {
    await assert.rejects(fetchComparisonWeather(q), isCode('invalid_request'));
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('malformed schema, values, units, lengths and non-hourly/duplicate/outside times fail', async t => {
  const mutations: Array<(p: ReturnType<typeof payload>) => void> = [
    p => { p.latitude = 100; }, p => { p.utc_offset_seconds = 3600; },
    p => { p.hourly_units.wind_speed_10m = 'km/h'; }, p => { p.hourly.temperature_2m.pop(); },
    p => { p.hourly.time[1] = p.hourly.time[0]; }, p => { p.hourly.time[0]--; },
    p => { p.hourly.time[1]++; }, p => { p.hourly.time[23] += 3600; },
    p => { p.hourly.relative_humidity_2m[0] = 101; }, p => { p.hourly.precipitation[0] = -1; },
    p => { p.hourly.wind_speed_10m[0] = -1; }, p => { p.hourly.temperature_2m[0] = 100; },
  ];
  for (const mutate of mutations) {
    const p = payload(); mutate(p); t.mock.method(globalThis, 'fetch', async () => json(p));
    await assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
  }
  for (const value of [{}, { error: true, reason: 'bad parameter' }, [payload()], { ...payload(), hourly: null }]) {
    t.mock.method(globalThis, 'fetch', async () => json(value));
    await assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
  }
});

test('HTTP errors, Retry-After, malformed JSON/content and decompressed size are bounded', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({}, 429, { 'retry-after': '60' }));
  await assert.rejects(fetchComparisonWeather(query), (e: unknown) => e instanceof HistoryError && e.code === 'rate_limited' && e.retryAfterSeconds === 60 && e.httpStatus === 429);
  for (const response of [json({}, 503), new Response('oops', { headers: { 'content-type': 'application/json' } }),
    new Response('<html>'), new Response(' '.repeat(1_000_001), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1000001' } })]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
  }
});

test('pre-abort and in-flight abort preserve reason; query identity is snapshotted', async t => {
  const controller = new AbortController(); const reason = new Error('selection changed'); controller.abort(reason);
  const mock = t.mock.method(globalThis, 'fetch', async () => json(payload()));
  await assert.rejects(fetchComparisonWeather(query, controller.signal), e => e === reason);
  assert.equal(mock.mock.callCount(), 0);
  const next = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { next.abort(reason); return json(payload()); });
  await assert.rejects(fetchComparisonWeather(query, next.signal), e => e === reason);
  const mutable = { ...query };
  t.mock.method(globalThis, 'fetch', async () => { mutable.latitude = 60; return json(payload()); });
  assert.equal((await fetchComparisonWeather(mutable)).query.latitude, 40.7);
});

test('timeout covers stalled fetch and response stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(() => {}));
  const pending = assert.rejects(fetchComparisonWeather(query), (e: unknown) => e instanceof HistoryError && /timed out/.test(e.message));
  t.mock.timers.tick(8001); await pending;
  let started!: () => void; const streamStarted = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull() { started(); return new Promise(() => {}); } }),
    { headers: { 'content-type': 'application/json' } }));
  const stalled = assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
  await streamStarted; t.mock.timers.tick(8001); await stalled;
});


test('retained ERA5 live probe replays nine fields without new network', async t => {
  const retained = JSON.parse(readFileSync(new URL('../../../docs/verification/comparison-expanded-provider/live-response.json', import.meta.url), 'utf8'));
  const q = { latitude: 28.858, longitude: -81.17, startDate: '2025-07-15', endDate: '2025-07-15' };
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.toString(), comparisonWeatherRequestUrl(q));
    assert.equal(url.searchParams.get('hourly')?.split(',').length, 9);
    return json({ ...retained, hourly: Object.fromEntries(['time', ...comparisonWeatherFields.map(f => f[0])].map(k => [k, retained.hourly[k]])) });
  });
  const data = await fetchComparisonWeather(q);
  assert.equal(data.completeness.completeHours, 24);
  assert.equal(data.provenance.calculationVersion, 'comparison-weather-adapter-v2');
  assert.equal(data.provenance.sourceCoordinates.latitude, 28.75);
  for (const [remote, local] of comparisonWeatherFields) assert.deepEqual(data.hours.map(h => h[local]), retained.hourly[remote]);
});

test('new fields retain null, absent variables, zero and unknown codes without invented events', async t => {
  const p = payload();
  delete (p.hourly as Partial<typeof p.hourly>).wet_bulb_temperature_2m;
  p.hourly.sunshine_duration[0] = null;
  p.hourly.weather_code[0] = 4;
  t.mock.method(globalThis, 'fetch', async () => json(p));
  const data = await fetchComparisonWeather(query);
  assert.equal(data.hours[0].weatherCode, 4);
  assert.equal(data.hours[1].weatherCode, 0);
  assert.equal(data.hours[1].sunshineDurationSeconds, 0);
  assert.deepEqual(data.hours[0].missingFields, ['wetBulbTemperatureC', 'sunshineDurationSeconds']);
  assert.equal(data.completeness.validCounts.wetBulbTemperatureC, 0);
  assert.equal(data.completeness.validCounts.sunshineDurationSeconds, 23);
});

test('new fields reject wrong units, lengths and range violations', async t => {
  for (const [remote] of comparisonWeatherFields.slice(5)) {
    const p = payload(); p.hourly_units[remote] = 'wrong';
    t.mock.method(globalThis, 'fetch', async () => json(p));
    await assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
  }
  for (const [remote, value] of [['wet_bulb_temperature_2m', 81], ['sunshine_duration', 3601], ['sunshine_duration', -1], ['cloud_cover', 101], ['weather_code', 1.5], ['weather_code', 100]] as const) {
    const p = payload(); p.hourly[remote][0] = value;
    t.mock.method(globalThis, 'fetch', async () => json(p));
    await assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
  }
  const p = payload(); p.hourly.sunshine_duration.pop();
  t.mock.method(globalThis, 'fetch', async () => json(p));
  await assert.rejects(fetchComparisonWeather(query), isCode('provider_error'));
});

test('canonical snapshot rejects tampered identity, timeline, missingness and counts', async t => {
  t.mock.method(globalThis, 'fetch', async () => json(payload()));
  const data = await fetchComparisonWeather(query);
  const mutations: Array<(d: typeof data) => void> = [
    d => { d.provenance.requestUrl += '&models=best_match'; },
    d => { d.query.latitude++; },
    d => { d.query.startDate = '2020-02-30'; },
    d => { d.hours[0].time = d.hours[1].time; },
    d => { d.hours[0].sourceHourPresent = false; },
    d => { d.hours[0].missingFields = ['weatherCode']; },
    d => { d.hours[0].weatherCode = null; },
    d => { d.completeness.validCounts.sunshineDurationSeconds--; },
    d => { d.completeness.completeHours--; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(data); mutate(changed);
    assert.equal(ComparisonWeatherDataSchema.safeParse(changed).success, false);
  }
});
