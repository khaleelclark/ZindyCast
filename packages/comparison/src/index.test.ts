import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReanalysisDataSchema, type ReanalysisData, type ReanalysisHour } from '@zindycast/contracts';
import { aggregateComparison, createComparisonPlan, ComparisonError, ComparisonPlanSchema, comparisonFields,
  type ComparisonPlan, type ComparisonChunk, type ComparisonChunkResult } from './index.js';

// Retained adapter evidence supplies ONLY metadata to mocked deterministic test data.
// No runtime fixtures and no network requests.
const template = JSON.parse(readFileSync(new URL('../../../docs/verification/history-runtime/new-york-march-2020.json', import.meta.url), 'utf8')) as ReanalysisData;
const locations = [{ id: 'new-york', name: 'New York', latitude: 40.7128, longitude: -74.006 },
  { id: 'honolulu', name: 'Honolulu', latitude: 21.3069, longitude: -157.8583 }];
const dayPlan = () => createComparisonPlan({ locations, startDate: '2020-03-08', endDate: '2020-03-08' });
function fixture(chunk: ComparisonChunk, edit?: (row: ReanalysisHour, index: number) => void): ReanalysisData {
  const data = structuredClone(template);
  data.query = { ...chunk.query };
  const start = Date.parse(chunk.query.startDate);
  const length = (Date.parse(chunk.query.endDate) - start) / 3600000 + 24;
  data.hours = Array.from({ length }, (_, i) => {
    const row: ReanalysisHour = { time: new Date(start + i * 3600000).toISOString(), temperatureC: 10,
      humidityPercent: 50, precipitationMm: 1, windSpeedMs: 2, dewPointC: 0, sourceHourPresent: true, missingFields: [] };
    edit?.(row, i);
    row.missingFields = comparisonFields.filter(field => row[field] === null);
    return row;
  });
  data.completeness = { expectedHours: length, sourceHours: data.hours.filter(h => h.sourceHourPresent).length,
    completeHours: data.hours.filter(h => !h.missingFields.length).length,
    missingHours: data.hours.filter(h => !h.sourceHourPresent).length,
    validCounts: Object.fromEntries(comparisonFields.map(field => [field, data.hours.filter(h => h[field] !== null).length])) as ReanalysisData['completeness']['validCounts'],
    status: data.hours.every(h => !h.missingFields.length) ? 'complete' : data.hours.some(h => h.missingFields.length < 5) ? 'partial' : 'no_data' };
  data.provenance.sourceCoordinates = { latitude: chunk.query.latitude, longitude: chunk.query.longitude };
  const url = new URL(data.provenance.requestUrl);
  url.searchParams.set('latitude', String(chunk.query.latitude)); url.searchParams.set('longitude', String(chunk.query.longitude));
  url.searchParams.set('start_date', chunk.query.startDate); url.searchParams.set('end_date', chunk.query.endDate);
  data.provenance.requestUrl = url.toString();
  return ReanalysisDataSchema.parse(data);
}
const resultsFor = (plan: ComparisonPlan): ComparisonChunkResult[] => plan.chunks.map(chunk => ({ chunkId: chunk.id, data: fixture(chunk) }));
function invalid(action: () => unknown, code?: ComparisonError['code']): void {
  assert.throws(action, (error: unknown) => error instanceof ComparisonError && (!code || error.code === code));
}

test('366-day leap-year plan is deterministic, bounded and contains contiguous max31-day queries plus closing date', () => {
  const query = { locations, startDate: '2020-01-01', endDate: '2020-12-31' };
  const plan = createComparisonPlan(query);
  assert.deepEqual(createComparisonPlan(query), plan);
  assert.equal(plan.window.expectedHours, 8784);
  assert.equal(plan.fetchEndDate, '2021-01-01');
  assert.equal(plan.chunks.length, 24);
  for (const location of locations) {
    const chunks = plan.chunks.filter(c => c.locationId === location.id);
    assert.equal(chunks[0].query.startDate, '2020-01-01');
    assert.equal(chunks.at(-1)!.query.endDate, '2021-01-01');
    chunks.forEach((chunk, i) => {
      assert.ok(Date.parse(chunk.query.endDate) - Date.parse(chunk.query.startDate) <= 30 * 86400000);
      if (i) assert.equal(Date.parse(chunk.query.startDate), Date.parse(chunks[i - 1].query.endDate) + 86400000);
    });
  }
  assert.ok(ComparisonPlanSchema.safeParse(plan).success);
  const five = createComparisonPlan({ ...query, locations: Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: String(i), latitude: i, longitude: i })) });
  assert.equal(five.chunks.length, 60);
  const original = structuredClone(plan);
  query.locations[0] = { ...locations[0], name: 'Changed after planning' };
  assert.deepEqual(plan, original);
  locations[0] = { id: 'new-york', name: 'New York', latitude: 40.7128, longitude: -74.006 };
});

test('reject invalid dates, >366days, coordinates, duplicate identity/coordinates and nonbounded locations', () => {
  const base = { locations, startDate: '2020-01-01', endDate: '2020-01-01' };
  for (const query of [{ ...base, startDate: '1939-12-31' }, { ...base, endDate: '2021-01-01' },
    { ...base, startDate: '2020-02-30' }, { ...base, endDate: '2019-12-31' },
    { ...base, startDate: '9999-12-31', endDate: '9999-12-31' },
    { ...base, locations: locations.slice(0, 1) }, { ...base, locations: [...locations, ...locations, ...locations] },
    { ...base, locations: [locations[0], { ...locations[1], id: locations[0].id }] },
    { ...base, locations: [locations[0], { ...locations[0], id: 'other' }] },
    { ...base, locations: [locations[0], { ...locations[1], latitude: NaN }] }]) {
    invalid(() => createComparisonPlan(query), 'invalid_request');
  }
});

test('midnight precipitation includes closing midnight, excludes initial overlap and unused padding; instant range differs', () => {
  const plan = dayPlan();
  const results = plan.chunks.map(chunk => ({ chunkId: chunk.id, data: fixture(chunk, (h, i) => {
    h.precipitationMm = i === 0 ? 100 : i <= 24 ? i : 1000;
    h.temperatureC = i < 24 ? i : 70;
  }) }));
  const output = aggregateComparison(plan, results);
  assert.deepEqual(output, aggregateComparison(plan, [...results].reverse()));
  const values = output.locations[0].variables;
  assert.equal(values.temperatureC.mean, 11.5); assert.equal(values.temperatureC.max, 23);
  assert.equal(values.precipitationMm.totalMm, 300); assert.equal(values.precipitationMm.mean, 12.5);
  assert.equal(values.precipitationMm.min, 1); assert.equal(values.precipitationMm.max, 24);
  assert.equal(values.precipitationMm.expectedCount, 24);
  assert.equal(output.commonValidCounts.precipitationMm, 24);
  assert.equal(output.locations[0].sources.length, 1);
});

test('internal chunk midnight included exactly once and leap/DST UTC slots retain equal weights', () => {
  for (const [startDate, endDate, expected] of [['2020-02-01', '2020-03-31', 1440], ['2020-11-01', '2020-11-01', 24],
    ['1940-01-01', '1940-01-01', 24]] as const) {
    const plan = createComparisonPlan({ locations, startDate, endDate });
    const results = resultsFor(plan);
    const output = aggregateComparison(plan, results);
    assert.equal(output.locations[0].variables.precipitationMm.totalMm, expected);
    assert.equal(output.locations[0].variables.temperatureC.validCount, expected);
    assert.equal(output.locations[0].variables.temperatureC.mean, 10);
  }
});

test('missing denominators separate absent timestamps and null cells; zero survives and no complete rainfall total is invented', () => {
  const plan = dayPlan();
  const results = plan.chunks.map((chunk, city) => ({ chunkId: chunk.id, data: fixture(chunk, (h, i) => {
    if (i === 1) { h.sourceHourPresent = false; for (const field of comparisonFields) h[field] = null; }
    if (i === 2 + city) h.temperatureC = null;
    if (i === 3) h.precipitationMm = null;
    if (i === 4) h.precipitationMm = 0;
  }) }));
  const output = aggregateComparison(plan, results);
  const t = output.locations[0].variables.temperatureC, rain = output.locations[0].variables.precipitationMm;
  assert.equal(t.expectedCount, 24); assert.equal(t.validCount, 22); assert.equal(t.missingCount, 2);
  assert.equal(t.absentSourceCount, 1); assert.equal(t.nullValueCount, 1); assert.equal(t.mean, 10);
  assert.equal(rain.totalMm, null); assert.equal(rain.sumAvailableMm, 21); assert.equal(rain.min, 0);
  assert.equal(rain.validCount, 22); assert.equal(rain.status, 'partial');
  assert.equal(output.commonValidCounts.temperatureC, 21);
  const empty = plan.chunks.map(chunk => ({ chunkId: chunk.id, data: fixture(chunk, h => {
    h.sourceHourPresent = false; for (const field of comparisonFields) h[field] = null;
  }) }));
  const none = aggregateComparison(plan, empty).locations[0].variables;
  assert.equal(none.precipitationMm.sumAvailableMm, null); assert.equal(none.temperatureC.mean, null);
  assert.equal(none.temperatureC.min, null); assert.equal(none.temperatureC.max, null);
  assert.equal(none.temperatureC.absentSourceCount, 24); assert.equal(none.temperatureC.status, 'no_data');
  const zeros = plan.chunks.map(chunk => ({ chunkId: chunk.id, data: fixture(chunk, h => {
    for (const field of comparisonFields) h[field] = 0;
  }) }));
  assert.equal(aggregateComparison(plan, zeros).locations[0].variables.precipitationMm.totalMm, 0);
});

test('missing closing rainfall makes total unavailable; missing excluded overlap/padding does not damage selected completeness', () => {
  const plan = dayPlan();
  const missingClosing = plan.chunks.map(chunk => ({ chunkId: chunk.id, data: fixture(chunk, (h, i) => { if (i === 24) h.precipitationMm = null; }) }));
  const rain = aggregateComparison(plan, missingClosing).locations[0].variables.precipitationMm;
  assert.equal(rain.totalMm, null); assert.equal(rain.validCount, 23); assert.equal(rain.missingCount, 1);
  const outside = plan.chunks.map(chunk => ({ chunkId: chunk.id, data: fixture(chunk, (h, i) => {
    if (i === 0 || i > 24) h.precipitationMm = null;
    if (i >= 24) h.temperatureC = null;
  }) }));
  assert.equal(aggregateComparison(plan, outside).locations[0].variables.precipitationMm.totalMm, 24);
  assert.equal(aggregateComparison(plan, outside).locations[0].variables.temperatureC.status, 'complete');
});

test('merge rejects missing, duplicate, unknown, overlapping, noncommon window and corrupted chunks/plans', () => {
  const plan = createComparisonPlan({ locations, startDate: '2020-01-01', endDate: '2020-02-15' });
  const original = resultsFor(plan);
  invalid(() => aggregateComparison(plan, original.slice(1)));
  invalid(() => aggregateComparison(plan, [...original, original[0]]));
  for (const change of [(r: ComparisonChunkResult[]) => { r[1] = r[0]; },
    (r: ComparisonChunkResult[]) => { r[0].chunkId = 'unknown'; },
    (r: ComparisonChunkResult[]) => { r[0].data.query.latitude = 0; },
    (r: ComparisonChunkResult[]) => { r[0].data.query.startDate = '2020-01-02'; },
    (r: ComparisonChunkResult[]) => { r[0].data.hours[1].time = r[0].data.hours[0].time; },
    (r: ComparisonChunkResult[]) => { r[0].data.hours.splice(1, 1); },
    (r: ComparisonChunkResult[]) => { r[0].data.completeness.validCounts.temperatureC--; }]) {
    const changed = structuredClone(original); change(changed); invalid(() => aggregateComparison(plan, changed), 'invalid_data');
  }
  for (const change of [(p: ComparisonPlan) => { p.chunks[1].query.startDate = p.chunks[0].query.endDate; },
    (p: ComparisonPlan) => { p.chunks.pop(); }, (p: ComparisonPlan) => { p.window.expectedHours--; },
    (p: ComparisonPlan) => { p.query.endDate = '2022-01-01'; }]) {
    const changed = structuredClone(plan); change(changed); invalid(() => aggregateComparison(changed, original), 'invalid_request');
  }
});

test('mixed grid/elevation/model/units/downscaling/request source rejected; individual retrieval times retained', () => {
  const plan = createComparisonPlan({ locations, startDate: '2020-01-01', endDate: '2020-02-15' });
  const original = resultsFor(plan);
  for (const change of [(d: ReanalysisData) => { d.provenance.sourceCoordinates.latitude++; },
    (d: ReanalysisData) => { d.provenance.sourceElevationM = null; },
    (d: ReanalysisData) => { Object.assign(d.provenance, { requestedModel: 'era5_seamless' }); },
    (d: ReanalysisData) => { Object.assign(d.provenance, { downscaling: 'disabled' }); },
    (d: ReanalysisData) => { Object.assign(d.units, { temperatureC: '°F' }); },
    (d: ReanalysisData) => { d.provenance.requestUrl = d.provenance.requestUrl.replace('models=era5', 'models=best_match'); },
    (d: ReanalysisData) => { d.provenance.requestUrl += '&elevation=nan'; },
    (d: ReanalysisData) => { d.provenance.requestUrl += '&models=era5'; }]) {
    const changed = structuredClone(original); change(changed[1].data); invalid(() => aggregateComparison(plan, changed), 'invalid_data');
  }
  original[1].data.provenance.retrievedAt = '2026-09-11T01:00:00.000Z';
  const before = structuredClone(original);
  const output = aggregateComparison(plan, original);
  assert.deepEqual(original, before);
  assert.equal(output.locations[0].sources[1].provenance.retrievedAt, '2026-09-11T01:00:00.000Z');
  assert.equal(output.locations[0].sources[0].provenance.sourceUpdatedAt, null);
  assert.equal(output.constituent, null);
});
