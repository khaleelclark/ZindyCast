import test from 'node:test';
import assert from 'node:assert/strict';
import { getForecast, getModelForecast, ProviderError, resolveLocation, searchLocations } from './index.js';
import { WbgtEstimateSchema, type Location } from '@zindycast/contracts';

const place: Location = { id: 'manual:honolulu', name: 'Honolulu', latitude: 21.31, longitude: -157.86, country: 'US', timezone: 'Pacific/Honolulu' };
const variables = {
  temperature_2m: ['°C', 30], apparent_temperature: ['°C', 33], relative_humidity_2m: ['%', 65],
  precipitation: ['mm', 0], precipitation_probability: ['%', 20], wind_speed_10m: ['m/s', 3],
  wind_gusts_10m: ['m/s', 5], wind_direction_10m: ['°', 270], weather_code: ['wmo code', 1],
  wet_bulb_temperature_2m: ['°C', 24],
  dew_point_2m: ['°C', 22], surface_pressure: ['hPa', 1012], cloud_cover: ['%', 35],
  visibility: ['m', 24000], uv_index: ['', 8.2],
  is_day: ['', 1],
  shortwave_radiation_instant: ['W/m²', 600], shortwave_radiation: ['W/m²', 550],
} as const;
function currentFixture() {
  const names = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'wind_speed_10m',
    'wind_direction_10m', 'weather_code', 'is_day', 'cloud_cover'] as const;
  const current: Record<string, number | null> = { time: Date.parse('2026-10-25T00:15:00Z') / 1000, interval: 900 };
  const current_units: Record<string, string> = { time: 'unixtime', interval: 'seconds' };
  for (const name of names) { current[name] = variables[name][1]; current_units[name] = variables[name][0]; }
  return { current, current_units };
}
function fixture() {
  const hourly: Record<string, (number | null)[]> & { time: number[] } = {
    time: Array.from({ length: 360 }, (_, i) => Date.UTC(2026, 9, 25) / 1000 + i * 3600),
  };
  const hourly_units: Record<string, string> = { time: 'unixtime' };
  for (const [name, [unit, value]] of Object.entries(variables)) {
    hourly[name] = Array(360).fill(value); hourly_units[name] = unit;
  }
  return { latitude: 21.335676, longitude: -157.88991, elevation: 8, utc_offset_seconds: 0, hourly_units, hourly, ...currentFixture() };
}
function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...extra } });
}
function code(expected: string) { return (error: unknown) => error instanceof ProviderError && error.code === expected; }

test('one requested prior day plus 14-day SI/UTC timeline retains identity, grid provenance and missingness', async t => {
  const data = fixture();
  delete data.hourly.wet_bulb_temperature_2m;
  data.hourly.precipitation_probability[12] = null;
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    assert.equal(input.searchParams.get('forecast_days'), '14');
    assert.equal(input.searchParams.get('past_days'), '1');
    assert.equal(input.searchParams.get('timezone'), 'GMT');
    assert.equal(input.searchParams.get('timeformat'), 'unixtime');
    assert.equal(input.searchParams.get('wind_speed_unit'), 'ms');
    assert.equal(input.searchParams.get('precipitation_unit'), 'mm');
    assert.equal(input.searchParams.get('temperature_unit'), 'celsius');
    assert.equal(input.searchParams.get('hourly')?.split(',').length, 18)
    assert.equal(input.searchParams.get('daily'), 'sunrise,sunset');
    assert.equal(input.searchParams.has('models'), false);
    return json(data);
  });
  const result = await getForecast(place);
  assert.deepEqual(result.location, place);
  assert.equal(result.hours.length, 360);
  assert.equal(result.hours[0].time, '2026-10-25T00:00:00.000Z');
  assert.equal(result.hours[359].time, '2026-11-08T23:00:00.000Z');
  assert.equal(result.hours[0].windSpeedMs, 3);
  assert.equal(result.hours[0].ordinaryWetBulbC, null);
  assert.equal(result.hours[12].precipitationProbability, null);
  assert.deepEqual(result.missingFields, ['precipitationProbability', 'ordinaryWetBulbC']);
  assert.notDeepEqual(result.provenance.sourceCoordinates, { latitude: place.latitude, longitude: place.longitude });
  assert.equal(result.provenance.sourceElevationM, 8);
  assert.equal(result.provenance.sourceIssuedAt, null);
  assert.equal(result.provenance.classification, 'modeled');
  assert.equal(result.provenance.dataset, 'Forecast API (best match; constituent models not supplied)');
});

test('explicit model candidates use exact provider model IDs and retain nullable fields and model provenance', async t => {
  const candidates = [
    ['gfs_seamless', 'ncep_gfs_seamless', 'Forecast API (explicit NCEP GFS Seamless)'],
    ['ecmwf_ifs025', 'ecmwf_ifs025', 'Forecast API (explicit ECMWF IFS 0.25°)'],
  ] as const;
  let expected: (typeof candidates)[number] = candidates[0];
  t.mock.method(globalThis, 'fetch', async (input: URL) => {
    assert.equal(input.searchParams.get('models'), expected[1]);
    assert.equal(input.searchParams.get('forecast_days'), '14');
    assert.equal(input.searchParams.get('past_days'), '1');
    assert.equal(input.searchParams.get('timezone'), 'GMT');
    assert.equal(input.searchParams.get('hourly')?.split(',').length, 18);
    const data = fixture();
    delete data.hourly.precipitation_probability;
    data.hourly.wet_bulb_temperature_2m[0] = null;
    return json(data);
  });
  for (expected of candidates) {
    const result = await getModelForecast(place, expected[0]);
    assert.equal(result.provenance.dataset, expected[2]);
    assert.equal(result.provenance.classification, 'modeled');
    assert.equal(result.provenance.sourceIssuedAt, null);
    assert.deepEqual(result.provenance.sourceCoordinates, { latitude: 21.335676, longitude: -157.88991 });
    assert.equal(result.provenance.sourceElevationM, 8);
    assert.equal(result.hours.length, 360);
    assert.equal(result.hours[0].precipitationProbability, null);
    assert.equal(result.hours[0].ordinaryWetBulbC, null);
    assert.deepEqual(result.missingFields, ['precipitationProbability', 'ordinaryWetBulbC']);
  }
});

test('unsupported explicit model is rejected before fetch', async t => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => json(fixture()));
  await assert.rejects(
    getModelForecast(place, 'unsupported' as 'gfs_seamless'),
    code('invalid_request'),
  );
  assert.equal(mocked.mock.callCount(), 0);
});

test('malformed values, units and timeline never become silently missing/shifted weather', async t => {
  const corruptions: ((data: ReturnType<typeof fixture>) => void)[] = [
    data => { data.hourly_units.wind_speed_10m = 'km/h'; },
    data => { data.hourly.time[5] = data.hourly.time[4]; },
    data => { data.hourly.time = data.hourly.time.slice(1); },
    data => { data.hourly.temperature_2m.pop(); },
    data => { data.hourly.relative_humidity_2m[0] = 101; },
    data => { data.hourly.precipitation[0] = -1; },
    data => { data.utc_offset_seconds = -36000; },
    data => { data.latitude = 91; },
    data => { data.elevation = 10001; },
    data => { data.hourly.cloud_cover[0] = 101; },
    data => { data.hourly.surface_pressure[0] = 0; },
    data => { data.hourly.visibility[0] = -1; },
    data => { data.hourly.uv_index[0] = -1; },
    data => { data.hourly_units.surface_pressure = 'Pa'; },
    data => { data.hourly_units.visibility = 'km'; },
    data => { data.hourly_units.dew_point_2m = '°F'; },
    data => { data.hourly_units.uv_index = 'W/m²'; },
    data => { data.hourly_units.shortwave_radiation_instant = 'J/m²'; },
    data => { data.hourly_units.shortwave_radiation = 'kW/m²'; },
    data => { data.hourly.shortwave_radiation_instant[0] = -1; },
    data => { data.hourly.shortwave_radiation.pop(); },
    data => { data.hourly.time[0] = 253402300800; },
  ];
  let current = fixture();
  t.mock.method(globalThis, 'fetch', async () => json(current));
  for (const mutate of corruptions) { current = fixture(); mutate(current); await assert.rejects(getForecast(place), code('provider_error')); }
});

test('empty/all-null forecasts distinguish no data from successful zero precipitation', async t => {
  let data = fixture();
  t.mock.method(globalThis, 'fetch', async () => json(data));
  for (const name of Object.keys(variables)) data.hourly[name].fill(null);
  await assert.rejects(getForecast(place), code('no_data'));
  data = fixture(); data.hourly.time = [];
  await assert.rejects(getForecast(place), code('no_data'));
});

test('HTTP rate limits preserve Retry-After; other errors and invalid JSON are sanitized', async t => {
  let response = json({ reason: 'provider internal details' }, 429, { 'retry-after': '120' });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(getForecast(place), (error: unknown) => error instanceof ProviderError && error.code === 'rate_limited' && error.retryAfterSeconds === 120 && error.httpStatus === 429);
  response = json({}, 503);
  await assert.rejects(getForecast(place), code('provider_error'));
  response = new Response('<html>broken</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(getForecast(place), code('provider_error'));
  response = new Response('{', { headers: { 'content-type': 'application/json' } });
  await assert.rejects(getForecast(place), code('provider_error'));
  response = json({ error: true, reason: 'do not expose' });
  await assert.rejects(getForecast(place), code('provider_error'));
});

test('response body has a bounded size and network errors map safely', async t => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(' '.repeat(1_000_001), { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(getForecast(place), code('provider_error'));
  mocked.mock.mockImplementation(async () => { throw new Error('internal connection details'); });
  await assert.rejects(searchLocations('Camas'), (error: unknown) => error instanceof ProviderError && error.message === 'Open-Meteo request failed.');
});

test('cancellation retains caller reason and snapshots location before fetch', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  }));
  const request = getForecast(place, controller.signal);
  controller.abort(new DOMException('City changed', 'AbortError'));
  await assert.rejects(request, { name: 'AbortError', message: 'City changed' });
  await assert.rejects(searchLocations('Camas', controller.signal), { name: 'AbortError' });
});

test('eight-second deadline includes response body streaming', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true });
    } });
    return new Response(stream, { headers: { 'content-type': 'application/json' } });
  });
  const promise = getForecast(place);
  const assertion = assert.rejects(promise, (error: unknown) => error instanceof ProviderError && error.message.includes('timed out'));
  await Promise.resolve();
  t.mock.timers.tick(8_000);
  await assertion;
});

test('geocoding preserves disambiguation; empty search/results and malformed are separate', async t => {
  let payload: unknown = { results: [
    { id: 1, name: 'Roseville', latitude: 38.75, longitude: -121.28, timezone: 'America/Los_Angeles', admin1: 'California', admin2: 'Placer', country: 'United States' },
    { id: 2, name: 'Roseville', latitude: 45, longitude: -93.16, timezone: 'America/Chicago', admin1: 'Minnesota', country_code: 'US' },
  ] };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL) => { calls++; assert.equal(url.searchParams.get('name'), 'Roseville'); return json(payload); });
  const results = await searchLocations(' Roseville ');
  assert.equal(results[0].admin2, 'Placer'); assert.equal(results[1].country, 'US');
  assert.notEqual(results[0].id, results[1].id);
  assert.deepEqual(await searchLocations('a'), []); assert.equal(calls, 1);
  payload = { generationtime_ms: 0.25 };
  assert.deepEqual(await searchLocations('Roseville'), []);
  payload = { results: [] };
  assert.deepEqual(await searchLocations('Roseville'), []);
  payload = {};
  await assert.rejects(searchLocations('Roseville'), code('provider_error'));
  payload = { results: [{ id: 1, name: 'bad', latitude: 0, longitude: 0, timezone: 'not/a/zone' }] };
  await assert.rejects(searchLocations('Roseville'), code('provider_error'));
});

test('invalid input never calls provider and identity cannot change while awaiting', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(fixture()); });
  await assert.rejects(getForecast({ ...place, latitude: NaN }), code('invalid_request'));
  await assert.rejects(getForecast({ ...place, timezone: 'bad-zone' }), code('invalid_request'));
  await assert.rejects(searchLocations('x'.repeat(201)), code('invalid_request'));
  assert.equal(calls, 0);
  const mutable = { ...place };
  const pending = getForecast(mutable);
  mutable.name = 'Different city'; mutable.latitude = 0;
  assert.deepEqual((await pending).location, place);
});

test('extended detail fields retain values, explicit nulls and absent arrays without fabricating zeros', async t => {
  const data = fixture();
  delete data.hourly.visibility;
  data.hourly.uv_index[1] = null;
  data.hourly.uv_index[0] = 0;
  t.mock.method(globalThis, 'fetch', async () => json(data));
  const result = await getForecast(place);
  assert.equal(result.hours[0].dewPointC, 22);
  assert.equal(result.hours[0].surfacePressureHpa, 1012);
  assert.equal(result.hours[0].cloudCoverPercent, 35);
  assert.equal(result.hours[0].visibilityM, null);
  assert.equal(result.hours[0].uvIndex, 0);
  assert.equal(result.hours[1].uvIndex, null);
  assert.deepEqual(result.missingFields, ['visibilityM', 'uvIndex']);
});

test('forecast WBGT retains independent radiation and uses source grid, FAO wind and component weighting', async t => {
  const data = fixture();
  t.mock.method(globalThis, 'fetch', async () => json(data));
  const result = await getForecast(place);
  const hour = result.hours[0]; // Honolulu afternoon, with synthetic radiation.
  const estimate = WbgtEstimateSchema.parse(hour.wbgt);
  assert.equal(estimate.status, 'success');
  assert.equal(hour.shortwaveInstantWm2, 600);
  assert.equal(hour.shortwaveMeanWm2, 550);
  assert.equal(estimate.wind10mMs, 3);
  assert.ok(Math.abs(estimate.wind2mMs! - 3 * 4.87 / Math.log(67.8 * 10 - 5.42)) < 1e-12);
  const diagnostics = estimate.diagnostics!;
  assert.equal(diagnostics.input.latitude, data.latitude);
  assert.equal(diagnostics.input.longitude, data.longitude);
  assert.equal(diagnostics.input.time, hour.time);
  assert.equal(diagnostics.input.ghiWm2, 600);
  assert.match(diagnostics.input.source, /Open-Meteo.*best match/);
  assert.ok(Math.abs(estimate.valueC! - (0.7 * diagnostics.naturalWetBulb.temperatureC! +
    0.2 * diagnostics.globe.temperatureC! + 0.1 * hour.temperatureC!)) < 1e-12);
  data.hourly.wet_bulb_temperature_2m.fill(null);
  data.hourly.shortwave_radiation.fill(900);
  const changed = await getForecast(place);
  assert.deepEqual(changed.hours[0].wbgt, estimate);
  assert.equal(changed.hours[0].ordinaryWetBulbC, null);
  assert.equal(changed.hours[0].shortwaveMeanWm2, 900);
});

test('absent/null instantaneous radiation preserves forecast with unavailable WBGT and never substitutes mean', async t => {
  const data = fixture();
  delete data.hourly.shortwave_radiation_instant;
  t.mock.method(globalThis, 'fetch', async () => json(data));
  let result = await getForecast(place);
  assert.equal(result.hours.length, 360);
  assert.deepEqual(result.missingFields, ['shortwaveInstantWm2']);
  for (const hour of result.hours) {
    assert.equal(hour.temperatureC, 30);
    assert.equal(hour.shortwaveInstantWm2, null);
    assert.equal(hour.shortwaveMeanWm2, 550);
    assert.equal(hour.wbgt?.status, 'unavailable');
    assert.equal(hour.wbgt?.valueC, null);
    assert.ok(hour.wbgt?.reason);
  }
  data.hourly.shortwave_radiation_instant = Array(360).fill(600);
  data.hourly.shortwave_radiation_instant[0] = null;
  delete data.hourly.shortwave_radiation;
  result = await getForecast(place);
  assert.equal(result.hours[0].wbgt?.status, 'unavailable');
  assert.equal(result.hours[1].wbgt?.status, 'success');
  assert.equal(result.hours[1].shortwaveMeanWm2, null);
  assert.deepEqual(result.missingFields, ['shortwaveInstantWm2', 'shortwaveMeanWm2']);
});

test('real zero nighttime radiation and calm wind remain numeric, while missing pressure affects heat only', async t => {
  const data = fixture();
  data.hourly.shortwave_radiation_instant[12] = 0; // 02:00 Honolulu.
  data.hourly.wind_speed_10m[12] = 0;
  data.hourly.surface_pressure[13] = null;
  t.mock.method(globalThis, 'fetch', async () => json(data));
  const result = await getForecast(place);
  const night = result.hours[12].wbgt!;
  assert.equal(night.status, 'success');
  assert.equal(night.wind2mMs, 0);
  assert.equal(night.diagnostics?.input.ghiWm2, 0);
  assert.equal(night.diagnostics?.windFloored, true);
  assert.equal(result.hours[13].temperatureC, 30);
  assert.equal(result.hours[13].wbgt?.status, 'unavailable');
});

test('coordinate resolution preserves requested point and actual AK/HI/DST zones, never a fixed offset', async t => {
  const cases = [
    { latitude: 61.2181, longitude: -149.9003, timezone: 'America/Anchorage', januaryHour: '03', julyHour: '04' },
    { latitude: 21.31, longitude: -157.86, timezone: 'Pacific/Honolulu', januaryHour: '02', julyHour: '02' },
    { latitude: 40.71, longitude: -74, timezone: 'America/New_York', januaryHour: '07', julyHour: '08' },
    { latitude: 33.45, longitude: -112.07, timezone: 'America/Phoenix', januaryHour: '05', julyHour: '05' },
  ];
  let current = cases[0];
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
    assert.equal(url.searchParams.get('latitude'), String(current.latitude));
    assert.equal(url.searchParams.get('longitude'), String(current.longitude));
    assert.equal(url.searchParams.get('timezone'), 'auto');
    assert.equal(url.searchParams.get('forecast_days'), '1');
    assert.equal(url.searchParams.has('hourly'), false);
    return json({ latitude: current.latitude + 0.01, longitude: current.longitude + 0.01, timezone: current.timezone });
  });
  for (const item of cases) {
    current = item;
    const location = await resolveLocation(item.latitude, item.longitude);
    assert.equal(location.latitude, item.latitude); assert.equal(location.longitude, item.longitude);
    assert.equal(location.timezone, item.timezone); assert.equal(location.country, '');
    assert.equal(location.name, 'Current location');
    assert.equal((await resolveLocation(item.latitude, item.longitude)).id, location.id);
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: location.timezone, hour: '2-digit', hourCycle: 'h23' });
    assert.equal(formatter.format(new Date('2026-01-15T12:00:00Z')), item.januaryHour);
    assert.equal(formatter.format(new Date('2026-07-15T12:00:00Z')), item.julyHour);
  }
});

test('coordinate resolution rejects invalid inputs before fetching and malformed provider zones', async t => {
  let calls = 0;
  let payload: unknown = {};
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(payload); });
  for (const [latitude, longitude] of [[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity]]) {
    await assert.rejects(resolveLocation(latitude, longitude), code('invalid_request'));
  }
  const controller = new AbortController(); controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(resolveLocation(0, 0, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 0);
  for (const bad of [{}, { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0, timezone: 'bad/zone' }, { latitude: 91, longitude: 0, timezone: 'Pacific/Honolulu' }]) {
    payload = bad;
    await assert.rejects(resolveLocation(21.31, -157.86), code('provider_error'));
  }
});

function astronomyFixture() {
  const data = fixture();
  const time = Array.from({ length: 15 }, (_, i) => data.hourly.time[i * 24]);
  return { ...data, daily_units: { time: 'unixtime', sunrise: 'unixtime', sunset: 'unixtime' },
    daily: { time, sunrise: time.map(t => t + 16 * 3600) as (number | null)[],
      sunset: time.map(t => t + 28 * 3600) as (number | null)[] } };
}

test('astronomy retains UTC calendar and adjacent-date event epochs, including DST local display', async t => {
  const data = astronomyFixture();
  // Synthetic NY sunrise around the November 1 fall-back; UTC instants are not offset twice.
  data.daily.sunrise[6] = Date.parse('2026-10-31T11:30:00Z') / 1000;
  data.daily.sunrise[7] = Date.parse('2026-11-01T11:31:00Z') / 1000;
  t.mock.method(globalThis, 'fetch', async () => json(data));
  const result = await getForecast({ ...place, timezone: 'America/New_York' });
  assert.equal(result.astronomy?.length, 15);
  assert.deepEqual(result.astronomy?.[0], { date: '2026-10-25', sunrise: '2026-10-25T16:00:00.000Z', sunset: '2026-10-26T04:00:00.000Z' });
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  assert.equal(format.format(new Date(result.astronomy![6].sunrise!)), '07:30');
  assert.equal(format.format(new Date(result.astronomy![7].sunrise!)), '06:31');
  assert.equal(result.hours[0].wbgt?.status, 'success');
});

test('missing astronomy and absent event arrays preserve weather without invented events', async t => {
  let data: unknown = fixture();
  t.mock.method(globalThis, 'fetch', async () => json(data));
  assert.equal((await getForecast(place)).astronomy, undefined);
  data = { ...fixture(), daily: null };
  assert.equal((await getForecast(place)).astronomy, undefined);
  const sample = astronomyFixture();
  data = { ...sample, daily: { time: sample.daily.time } };
  const result = await getForecast(place);
  assert.equal(result.hours.length, 360);
  assert.ok(result.astronomy!.every(day => day.sunrise === null && day.sunset === null));
});

test('day/night is provider supplied even at noon or midnight; polar missing events do not infer night', async t => {
  const data = astronomyFixture();
  data.daily.sunrise.fill(null); data.daily.sunset.fill(0);
  data.hourly.is_day.fill(1); // Synthetic polar midnight sun.
  t.mock.method(globalThis, 'fetch', async () => json(data));
  let result = await getForecast(place);
  assert.equal(result.hours[0].isDay, 1);
  assert.equal(result.hours[12].isDay, 1);
  assert.ok(result.astronomy!.every(day => day.sunrise === null && day.sunset === null));
  data.hourly.is_day.fill(0); // Synthetic polar night, including noon.
  result = await getForecast(place);
  assert.equal(result.hours[12].isDay, 0);
  data.hourly.is_day[0] = null;
  result = await getForecast(place);
  assert.equal(result.hours[0].isDay, null);
  assert.ok(result.missingFields.includes('isDay'));
  delete data.hourly.is_day;
  result = await getForecast(place);
  assert.ok(result.hours.every(hour => hour.isDay === null));
  assert.ok(result.missingFields.includes('isDay'));
  // An astronomical flag alone cannot turn absent weather into a usable forecast.
  for (const name of Object.keys(variables)) data.hourly[name] = Array(360).fill(null);
  data.hourly.is_day.fill(1);
  await assert.rejects(getForecast(place), code('no_data'));
});

test('malformed day/night and astronomy units, arrays, UTC calendar and event epochs reject', async t => {
  let data = astronomyFixture();
  t.mock.method(globalThis, 'fetch', async () => json(data));
  const corruptions: ((sample: ReturnType<typeof astronomyFixture>) => void)[] = [
    d => { d.hourly.is_day[0] = 2; }, d => { d.hourly.is_day[0] = 0.5; },
    d => { d.hourly.is_day.pop(); }, d => { d.hourly_units.is_day = 'boolean'; },
    d => { d.daily_units.time = 'iso8601'; }, d => { d.daily_units.sunrise = 'iso8601'; },
    d => { d.daily_units.sunset = 'seconds'; }, d => { d.daily.sunrise.pop(); },
    d => { d.daily.time.pop(); }, d => { d.daily.time[1] = d.daily.time[0]; },
    d => { d.daily.time[0] += 3600; }, d => { d.daily.sunset[0] = -1; },
    d => { d.daily.sunrise[0] = 253402300800; }, d => { d.daily.sunrise[0] = 1.5; },
    d => { d.daily.sunrise[0] = Date.parse('2026-02-28T12:00:00Z') / 1000; },
  ];
  for (const corrupt of corruptions) {
    data = astronomyFixture(); corrupt(data);
    await assert.rejects(getForecast(place), code('provider_error'));
  }
});


test('current uses one shared request, exact SI values, source grid and independent valid instant', async t => {
  const data = fixture();
  data.current.temperature_2m = 27.6; data.current.apparent_temperature = 32.2;
  data.current.wind_speed_10m = 0; data.current.wind_direction_10m = 0; data.current.is_day = 0;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    calls++;
    assert.deepEqual(new Set(url.searchParams.get('current')!.split(',')), new Set(Object.keys(data.current).filter(k => !['time', 'interval'].includes(k))));
    assert.equal(url.searchParams.get('hourly')!.split(',').length, 18);
    assert.equal(url.searchParams.get('daily'), 'sunrise,sunset');
    return json(data);
  });
  const result = await getForecast(place);
  assert.equal(calls, 1);
  assert.deepEqual(result.current, { time: '2026-10-25T00:15:00.000Z', intervalSeconds: 900,
    temperatureC: 27.6, apparentTemperatureC: 32.2, humidityPercent: 65,
    windSpeedMs: 0, windDirectionDeg: 0, weatherCode: 1, isDay: 0, cloudCoverPercent: 35 });
  assert.equal(result.hours[0].temperatureC, 30);
  assert.equal(result.hours[0].wbgt?.diagnostics?.input.time, result.hours[0].time);
  assert.notEqual(result.current!.time, result.hours[0].time);
  assert.deepEqual(result.provenance.sourceCoordinates, { latitude: data.latitude, longitude: data.longitude });
  assert.equal(result.provenance.sourceIssuedAt, null);
});

test('missing or malformed current and units preserve hourly forecast and report current missingness', async t => {
  let data: Record<string, unknown> = fixture();
  t.mock.method(globalThis, 'fetch', async () => json(data));
  const invalid = [undefined, null, {}, [], 'invalid'];
  for (const current of invalid) {
    data = { ...fixture(), current };
    const result = await getForecast(place);
    assert.equal(result.current, undefined); assert.equal(result.hours.length, 360);
    assert.deepEqual(result.missingFields, ['current']);
  }
  const mutations: ((d: ReturnType<typeof fixture>) => void)[] = [
    d => { delete d.current.temperature_2m; },
    d => { d.current.interval = 0; }, d => { d.current.interval = 3601; }, d => { d.current.interval = 1.5; },
    d => { d.current.time = -1; }, d => { d.current.time = 253402300800; }, d => { d.current.time = 1.5; },
    d => { d.current.relative_humidity_2m = 101; }, d => { d.current.cloud_cover = -1; },
    d => { d.current.wind_speed_10m = -1; }, d => { d.current.wind_direction_10m = 361; },
    d => { d.current.is_day = 2; }, d => { d.current.weather_code = 1.5; },
    ...Object.keys(currentFixture().current_units).map(name => (d: ReturnType<typeof fixture>) => { d.current_units[name] = 'wrong'; }),
  ];
  for (const mutate of mutations) {
    const sample = fixture(); mutate(sample); data = sample;
    const result = await getForecast(place);
    assert.equal(result.current, undefined); assert.equal(result.hours[0].temperatureC, 30);
    assert.deepEqual(result.missingFields, ['current']);
  }
  for (const current_units of invalid) {
    data = { ...fixture(), current_units };
    assert.equal((await getForecast(place)).current, undefined);
  }
});

test('current nulls stay missing and future or old valid times remain unchanged for consumer freshness checks', async t => {
  const data = fixture();
  data.current.apparent_temperature = null;
  t.mock.method(globalThis, 'fetch', async () => json(data));
  for (const time of ['2000-01-01T00:00:00.000Z', '2099-12-31T23:45:00.000Z']) {
    data.current.time = Date.parse(time) / 1000;
    const result = await getForecast(place);
    assert.equal(result.current?.time, time);
    assert.equal(result.current?.apparentTemperatureC, null);
    assert.deepEqual(result.missingFields, ['current.apparentTemperatureC']);
  }
  for (const key of Object.keys(data.current)) if (!['time', 'interval'].includes(key)) data.current[key] = null;
  const result = await getForecast(place);
  assert.ok(result.current);
  assert.equal(result.current.temperatureC, null);
  assert.equal(result.missingFields.length, 8);
  assert.equal(result.hours[0].temperatureC, 30);
});

function localDate(time: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}

test('prior UTC day retains full local-day extremes and sun events before/after UTC rollover and DST', async t => {
  const cases = [
    { timezone: 'America/New_York', now: '2026-09-12T23:59:00Z', day: '2026-09-12', count: 24, rise: 10, set: 23 },
    { timezone: 'America/New_York', now: '2026-09-13T00:01:00Z', day: '2026-09-12', count: 24, rise: 10, set: 23 },
    { timezone: 'America/Los_Angeles', now: '2026-09-13T03:00:00Z', day: '2026-09-12', count: 24, rise: 13, set: 26 },
    { timezone: 'Pacific/Honolulu', now: '2026-09-13T06:00:00Z', day: '2026-09-12', count: 24, rise: 16, set: 28 },
    { timezone: 'Asia/Tokyo', now: '2026-09-13T01:00:00Z', day: '2026-09-13', count: 24, rise: -3, set: 9 },
    { timezone: 'Pacific/Kiritimati', now: '2026-09-13T01:00:00Z', day: '2026-09-13', count: 24, rise: -8, set: 4 },
    { timezone: 'America/New_York', now: '2026-03-09T00:30:00Z', day: '2026-03-08', count: 23, rise: 11, set: 23 },
    { timezone: 'America/New_York', now: '2026-11-02T00:30:00Z', day: '2026-11-01', count: 25, rise: 12, set: 22 },
  ];
  let data = astronomyFixture();
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.searchParams.get('past_days'), '1');
    assert.equal(url.searchParams.get('timezone'), 'GMT');
    return json(data);
  });
  for (const sample of cases) {
    data = astronomyFixture();
    const start = Date.parse(sample.now.slice(0, 10)) / 1000 - 86400;
    data.hourly.time = Array.from({ length: 360 }, (_, i) => start + i * 3600);
    const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: sample.timezone, hour: '2-digit', hourCycle: 'h23' });
    data.hourly.temperature_2m = data.hourly.time.map(time => {
      const hour = Number(hourFormat.format(new Date(time * 1000)));
      return hour === 6 ? 10 : hour === 14 ? 35 : 20;
    });
    data.daily.time = Array.from({ length: 15 }, (_, i) => start + i * 86400);
    data.daily.sunrise = data.daily.time.map(time => time + sample.rise * 3600);
    data.daily.sunset = data.daily.time.map(time => time + sample.set * 3600);
    const result = await getForecast({ ...place, timezone: sample.timezone });
    assert.equal(localDate(sample.now, sample.timezone), sample.day);
    const today = result.hours.filter(hour => localDate(hour.time, sample.timezone) === sample.day);
    assert.equal(today.length, sample.count, sample.timezone + sample.now);
    assert.equal(Math.min(...today.map(hour => hour.temperatureC!)), 10);
    assert.equal(Math.max(...today.map(hour => hour.temperatureC!)), 35);
    for (const event of ['sunrise', 'sunset'] as const) {
      const matches = result.astronomy!.flatMap(day => day[event] ? [day[event]!] : [])
        .filter(time => localDate(time, sample.timezone) === sample.day);
      assert.equal(matches.length, 1, sample.timezone + ' ' + event);
    }
    assert.ok(result.hours.every((hour, i) => i === 0 || Date.parse(hour.time) - Date.parse(result.hours[i - 1].time) === 3600000));
  }
});

test('old 336-hour response cannot silently satisfy the prior-day request', async t => {
  const data = astronomyFixture();
  for (const name of Object.keys(data.hourly)) data.hourly[name] = data.hourly[name].slice(24);
  t.mock.method(globalThis, 'fetch', async () => json(data));
  await assert.rejects(getForecast(place), code('provider_error'));
});
