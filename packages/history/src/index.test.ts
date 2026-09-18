import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getReanalysis, HistoryError, renderReanalysisCsv, type ReanalysisQuery } from './index.js';

const query: ReanalysisQuery = { latitude: 40.7, longitude: -74, startDate: '2020-03-08', endDate: '2020-03-08' };
function payload(q = query) {
  const n = (Date.parse(q.endDate) - Date.parse(q.startDate)) / 3600000 + 24;
  return { latitude: 40.75, longitude: -74.0, elevation: 10, utc_offset_seconds: 0,
    hourly_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', precipitation: 'mm', wind_speed_10m: 'm/s', dew_point_2m: '°C' },
    hourly: { time: Array.from({ length: n }, (_, i) => Date.parse(q.startDate) / 1000 + i * 3600),
      temperature_2m: Array<number | null>(n).fill(-5), relative_humidity_2m: Array<number | null>(n).fill(50),
      precipitation: Array<number | null>(n).fill(0), wind_speed_10m: Array<number | null>(n).fill(0), dew_point_2m: Array<number | null>(n).fill(-10) } };
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
  const result = await getReanalysis(query);
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
    const d = await getReanalysis(q);
    assert.equal(d.hours.length, payload(q).hourly.time.length);
    assert.ok(d.hours.every((h, i) => i === 0 || Date.parse(h.time) - Date.parse(d.hours[i - 1].time) === 3600000));
  }
});

test('null fields, absent variable, and omitted timestamp preserve distinct missingness', async t => {
  const p = payload(); p.hourly.temperature_2m[0] = null;
  delete (p.hourly as Partial<typeof p.hourly>).dew_point_2m;
  for (const a of Object.values(p.hourly)) a.splice(2, 1);
  t.mock.method(globalThis, 'fetch', async () => json(p));
  const d = await getReanalysis(query);
  assert.equal(d.hours.length, 24);
  assert.equal(d.hours[2].sourceHourPresent, false);
  assert.equal(d.hours[2].missingFields.length, 5);
  assert.equal(d.hours[0].sourceHourPresent, true);
  assert.equal(d.hours[0].temperatureC, null);
  assert.equal(d.hours[1].precipitationMm, 0);
  assert.deepEqual(d.completeness, { status: 'partial', expectedHours: 24, sourceHours: 23, completeHours: 0,
    missingHours: 1, validCounts: { temperatureC: 22, humidityPercent: 23, precipitationMm: 23, windSpeedMs: 23, dewPointC: 0 } });
});

test('empty and all-null responses return no_data completeness without invented measurements', async t => {
  const p = payload();
  for (const array of Object.values(p.hourly)) array.length = 0;
  t.mock.method(globalThis, 'fetch', async () => json(p));
  const empty = await getReanalysis(query);
  assert.equal(empty.completeness.status, 'no_data'); assert.equal(empty.completeness.missingHours, 24);
  assert.equal(empty.hours[0].precipitationMm, null);
  const p2 = payload();
  for (const key of ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m', 'dew_point_2m'] as const) p2.hourly[key].fill(null);
  t.mock.method(globalThis, 'fetch', async () => json(p2));
  const allNull = await getReanalysis(query);
  assert.equal(allNull.completeness.status, 'no_data'); assert.equal(allNull.completeness.missingHours, 0);
});

test('invalid dates/coordinates, 32-day spans, future and recent domain rejected without network', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  for (const q of [ { ...query, latitude: NaN }, { ...query, longitude: 181 },
    { ...query, startDate: '1939-12-31' }, { ...query, startDate: '2020-02-30' },
    { ...query, startDate: '2020-03-09' }, { ...query, endDate: '2020-04-08' },
    { ...query, startDate: '9999-01-01', endDate: '9999-01-01' },
    { ...query, startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10) } ]) {
    await assert.rejects(getReanalysis(q), isCode('invalid_request'));
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
    await assert.rejects(getReanalysis(query), isCode('provider_error'));
  }
  for (const value of [{}, { error: true, reason: 'bad parameter' }, [payload()], { ...payload(), hourly: null }]) {
    t.mock.method(globalThis, 'fetch', async () => json(value));
    await assert.rejects(getReanalysis(query), isCode('provider_error'));
  }
});

test('HTTP errors, Retry-After, malformed JSON/content and decompressed size are bounded', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({}, 429, { 'retry-after': '60' }));
  await assert.rejects(getReanalysis(query), (e: unknown) => e instanceof HistoryError && e.code === 'rate_limited' && e.retryAfterSeconds === 60 && e.httpStatus === 429);
  for (const response of [json({}, 503), new Response('oops', { headers: { 'content-type': 'application/json' } }),
    new Response('<html>'), new Response(' '.repeat(1_000_001), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1000001' } })]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(getReanalysis(query), isCode('provider_error'));
  }
});

test('pre-abort and in-flight abort preserve reason; query identity is snapshotted', async t => {
  const controller = new AbortController(); const reason = new Error('selection changed'); controller.abort(reason);
  const mock = t.mock.method(globalThis, 'fetch', async () => json(payload()));
  await assert.rejects(getReanalysis(query, controller.signal), e => e === reason);
  assert.equal(mock.mock.callCount(), 0);
  const next = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { next.abort(reason); return json(payload()); });
  await assert.rejects(getReanalysis(query, next.signal), e => e === reason);
  const mutable = { ...query };
  t.mock.method(globalThis, 'fetch', async () => { mutable.latitude = 60; return json(payload()); });
  assert.equal((await getReanalysis(mutable)).query.latitude, 40.7);
});

test('timeout covers stalled fetch and response stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(() => {}));
  const pending = assert.rejects(getReanalysis(query), (e: unknown) => e instanceof HistoryError && /timed out/.test(e.message));
  t.mock.timers.tick(8001); await pending;
  let started!: () => void; const streamStarted = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull() { started(); return new Promise(() => {}); } }),
    { headers: { 'content-type': 'application/json' } }));
  const stalled = assert.rejects(getReanalysis(query), isCode('provider_error'));
  await streamStarted; t.mock.timers.tick(8001); await stalled;
});

test('CSV deterministic SI rows, original metadata, nulls and spreadsheet text escaping', async t => {
  const p = payload(); p.hourly.temperature_2m[1] = null;
  t.mock.method(globalThis, 'fetch', async () => json(p));
  const d = await getReanalysis(query);
  const csv = renderReanalysisCsv(d, 'City, "example"');
  assert.equal(csv, renderReanalysisCsv(d, 'City, "example"'));
  assert.equal(csv.split('\r\n').length, 26);
  assert.ok(csv.includes('"City, ""example"""'));
  assert.ok(csv.includes('"2020-03-08T00:00:00.000Z",-5,50,0,0,-10'));
  assert.ok(csv.includes('"2020-03-08T01:00:00.000Z",,50,0,0,-10'));
  assert.ok(csv.includes('"2020-03-07T23:00:00.000Z"'));
  assert.ok(csv.includes('"ERA5 (requested)","era5",,"modeled_reanalysis"'));
  assert.ok(csv.includes(d.provenance.retrievedAt));
  for (const label of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', ' \t=1+1', '\ttext', '\n=1']) {
    const output = renderReanalysisCsv(d, label);
    assert.ok(output.includes(`"'${label}"`));
  }
  assert.throws(() => renderReanalysisCsv(d, 'x'.repeat(201)), isCode('invalid_request'));
  const wrongSelection = structuredClone(d); wrongSelection.query.endDate = '2020-03-09';
  assert.throws(() => renderReanalysisCsv(wrongSelection), isCode('invalid_request'));
  const wrongCounts = structuredClone(d); wrongCounts.completeness.completeHours = 24;
  assert.throws(() => renderReanalysisCsv(wrongCounts), isCode('invalid_request'));
  const wrongMissingness = structuredClone(d); wrongMissingness.hours[1].missingFields = [];
  assert.throws(() => renderReanalysisCsv(wrongMissingness), isCode('invalid_request'));
});
