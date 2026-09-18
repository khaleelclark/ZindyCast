import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { comparisonSelection, installationKey, installationStore, latestComparisonDate, parseComparison, sameComparison } from './comparison-model';
import { ComparisonResults, comparisonValue } from './comparison';
import { comparisonCsv, comparisonCsvCell } from './comparison-export';
import type { Location } from '@zindycast/contracts';
const places: Location[] = [{ id: 'a', name: 'Alpha', country: 'US', latitude: 30, longitude: -100, timezone: 'America/Chicago' }, { id: 'b', name: 'Beta', country: 'US', latitude: 31, longitude: -101, timezone: 'America/Chicago' }];
const query = comparisonSelection(places, '2020-01-01', '2020-01-01', Date.parse('2026-09-11'));
const id = '00000000-0000-0000-0000-000000000001';
function fixture() {
  const summary = (unit: string) => ({ unit, expectedCount: 24, validCount: 23, missingCount: 1, absentSourceCount: 0, nullValueCount: 1, status: 'partial', mean: 0, min: 0, max: 0 });
  const chunks = query.locations.map(l => ({ id: l.id, locationId: l.id, query: { latitude: l.latitude, longitude: l.longitude, startDate: query.startDate, endDate: '2020-01-02' } }));
  return { id, state: 'completed', progress: 1, attempt: 1, createdAt: 1, expiresAt: Date.now() + 60000, error: null, query, result: {
    plan: { version: 'era5-comparison-v1', query, timezone: 'UTC', requestedModel: 'era5', window: { startInclusive: '2020-01-01T00:00:00.000Z', endExclusive: '2020-01-02T00:00:00.000Z', expectedHours: 24 }, fetchEndDate: '2020-01-02', chunks },
    calculationVersion: 'era5-comparison-v1', classification: 'modeled_reanalysis', dataset: 'ERA5 (requested)', constituent: null, weighting: 'equal hourly slots; leap day retained; available values only', intervalSemantics: 'instant samples start-inclusive/end-exclusive; precipitation intervals fully contained in window',
    commonValidCounts: { temperatureC: 22, dewPointC: 22, humidityPercent: 22, precipitationMm: 22, windSpeedMs: 22 },
    locations: query.locations.map((l, i) => ({ location: l, variables: { temperatureC: summary('°C'), dewPointC: summary('°C'), humidityPercent: summary('%'), windSpeedMs: summary('m/s'), precipitationMm: { ...summary('mm'), sumAvailableMm: 0, totalMm: null } }, sources: [{ chunkId: chunks[i]!.id, query: chunks[i]!.query, provenance: { provider: 'Open-Meteo', dataset: 'ERA5 (requested)', requestedModel: 'era5', constituent: null, classification: 'modeled_reanalysis', sourceCoordinates: { latitude: l.latitude, longitude: l.longitude }, sourceElevationM: null, retrievedAt: '2026-09-11T00:00:00Z', sourceIssuedAt: null, sourceUpdatedAt: null, requestUrl: 'https://archive-api.open-meteo.com/v1/archive', sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api', attribution: 'Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF', cellSelection: 'land', downscaling: 'provider default elevation adjustment', calculationVersion: 'reanalysis-adapter-v1' } }] }))
  } };
}
test('comparison bounds use shared UTC dates, six-day lag, distinct coordinates and leap years', () => {
  const now = Date.parse('2026-09-11T23:59:00Z'); assert.equal(latestComparisonDate(now), '2026-09-05');
  assert.doesNotThrow(() => comparisonSelection(places, '2020-01-01', '2020-12-31', now));
  for (const [start, end] of [['2020-01-01', '2021-01-01'], ['2020-02-30', '2020-03-01'], ['2026-09-05', '2026-09-06']]) assert.throws(() => comparisonSelection(places, start!, end!, now));
  assert.throws(() => comparisonSelection([places[0]!, places[0]!], '2020-01-01', '2020-01-01', now));
  assert.equal(sameComparison(query, { ...query, endDate: '2020-01-02' }), false);
  assert.equal(sameComparison(query, { ...query, locations: [...query.locations].reverse() }), false);
});
test('job identity, selection, units and completeness mismatch rejected before display', () => {
  assert.ok(parseComparison(fixture(), query, id).result);
  assert.throws(() => parseComparison(fixture(), query, 'different'));
  const altered = fixture(); altered.result.locations[0]!.variables.temperatureC.validCount = 24; assert.throws(() => parseComparison(altered, query));
  const unit = fixture(); unit.result.locations[0]!.variables.temperatureC.unit = 'F'; assert.throws(() => parseComparison(unit, query));
  const rain = fixture(); rain.result.locations[0]!.variables.precipitationMm.totalMm = 0 as never; assert.throws(() => parseComparison(rain, query));
  const wrong = fixture(); wrong.query = { ...query, endDate: '2020-01-02' }; assert.throws(() => parseComparison(wrong, query));
});
test('partial summaries retain zero, null totals, units and common-hours caveat in accessible table', () => {
  const html = renderToStaticMarkup(React.createElement(ComparisonResults, { result: parseComparison(fixture(), query).result!, units: 'us' }));
  for (const text of ['Partial', '23/24', '22/24', 'Complete-window total:', '0.00 in', 'not recalculated', 'scope="col"', '32.0°F']) assert.ok(html.includes(text), text);
  assert.equal(comparisonValue('temperatureC', null, 'us'), '—'); assert.equal(comparisonValue('windSpeedMs', 0, 'metric'), '0.0 km/h');
});
function storage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; }
const credential = () => ({ id: 'installation', bearer: 'test-secret-never-rendered', createdAt: Date.now(), expiresAt: Date.now() + 60000 });
test('registration is lazy, coalesced, persisted and recovered without repeat registration', async () => {
  const s = storage(); let calls = 0; const register = async () => { calls++; return credential(); }; const access = installationStore(s, register);
  assert.equal(calls, 0); const tokens = await Promise.all([access.ensure(new AbortController().signal), access.ensure(new AbortController().signal)]);
  assert.equal(calls, 1); assert.equal(tokens[0], tokens[1]);
  await installationStore(s, register).ensure(new AbortController().signal); assert.equal(calls, 1);
});
test('storage failure before registration prevents mutation; failure after registration preserves credential for save retry', async () => {
  let calls = 0; const register = async () => { calls++; return credential(); };
  await assert.rejects(installationStore({ getItem: () => null, setItem: () => { throw new Error(); } }, register).ensure(new AbortController().signal), /storage/); assert.equal(calls, 0);
  const s = storage(); let fail = true; const access = installationStore({ getItem: s.getItem, setItem: (k, v) => { if (fail && v.includes('bearer')) throw new Error(); s.setItem(k, v); } }, register);
  await assert.rejects(access.ensure(new AbortController().signal), /storage/); assert.equal(calls, 1); fail = false;
  await access.ensure(new AbortController().signal); assert.equal(calls, 1);
});
test('uncertain registration response and expired credentials never trigger automatic duplicate registration', async () => {
  const s = storage(); let calls = 0; const register = async () => { calls++; throw new Error('timeout'); };
  await assert.rejects(installationStore(s, register).ensure(new AbortController().signal), /could not be confirmed/);
  await assert.rejects(installationStore(s, register).ensure(new AbortController().signal), /avoid duplicates/); assert.equal(calls, 1);
  s.setItem(installationKey, JSON.stringify({ ...credential(), expiresAt: 1 })); await assert.rejects(installationStore(s, register).ensure(new AbortController().signal), /expired/); assert.equal(calls, 1);
});

test('comparison CSV quotes labels, neutralizes formulas and controls, and preserves numeric negatives', () => {
  for (const label of ['=SUM(1,2)', '+cmd', '-cmd', '@SUM(A1)', '\t\r\n=1', '\u0000=1', ' \u200b=1', '＝1']) assert.ok(comparisonCsvCell(label).startsWith('"\''), label);
  assert.equal(comparisonCsvCell('Town, "East"\r\nHill'), '"Town, ""East""  Hill"');
  assert.equal(comparisonCsvCell(-12), '"-12"');
  assert.equal(comparisonCsvCell(null), '""'); assert.equal(comparisonCsvCell(0), '"0"');
});
function csvRows(csv: string) {
  const lines = csv.trimEnd().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1]!.replace(/""/g, '"')));
  const headers = lines.shift()!;
  return lines.map(line => { assert.equal(line.length, headers.length); return Object.fromEntries(headers.map((key, i) => [key, line[i]])); });
}
test('export uses displayed validated snapshot with SI summaries, exact counts, nulls and every source chunk', () => {
  const raw = fixture(); raw.query = structuredClone(query); raw.result.plan.query = raw.query;
  raw.query.locations[0]!.name = '=HYPERLINK("bad"),\r\nTown';
  raw.result.locations[0]!.location = raw.query.locations[0]!;
  // No-data variable is distinct from numeric zero, including all expected missing slots.
  raw.result.locations[1]!.variables.temperatureC = { unit: '°C', expectedCount: 24, validCount: 0, missingCount: 24, absentSourceCount: 20, nullValueCount: 4, status: 'no_data', mean: null, min: null, max: null } as never;
  raw.result.commonValidCounts.temperatureC = 0;
  raw.result.locations[0]!.sources[0]!.provenance.requestUrl = 'https://archive-api.open-meteo.com/v1/archive?token=should-not-export';
  const displayed = parseComparison(raw, raw.query).result!;
  const csv = comparisonCsv(displayed);
  const changedForm = { ...raw.query, endDate: '2020-02-01' };
  assert.equal(sameComparison(changedForm, displayed.plan.query), false);
  assert.equal(comparisonCsv(displayed), csv);
  assert.ok(!csv.includes('should-not-export')); assert.ok(!csv.includes(id)); assert.ok(!csv.includes('bearer'));
  const rows = csvRows(csv); assert.equal(rows.length, 13);
  assert.ok(rows.every(row => row.start_date_utc === '2020-01-01' && row.end_date_utc_inclusive === '2020-01-01'));
  const summaries = rows.filter(row => row.record_type === 'variable_summary'); assert.equal(summaries.length, 10);
  const rain = summaries.find(row => row.variable === 'precipitationMm')!;
  assert.equal(rain.unit, 'mm'); assert.equal(rain.sum_available_mm, '0'); assert.equal(rain.complete_window_total_mm, ''); assert.equal(rain.status, 'partial');
  assert.equal(rain.valid_count, '23'); assert.equal(rain.missing_count, '1'); assert.equal(rain.shared_valid_count, '22');
  const missing = summaries.find(row => row.status === 'no_data')!;
  assert.equal(missing.mean, ''); assert.equal(missing.absent_source_count, '20'); assert.equal(missing.null_value_count, '4');
  const sources = rows.filter(row => row.record_type === 'source_chunk'); assert.equal(sources.length, 2);
  assert.equal(sources[0]!.source_latitude, '30'); assert.equal(sources[0]!.source_elevation_m, ''); assert.equal(sources[0]!.source_issued_at, '');
  assert.equal(sources[0]!.adapter_method, 'reanalysis-adapter-v1'); assert.equal(sources[0]!.chunk_end_date_utc_inclusive, '2020-01-02');
  assert.ok(rows[0]!.notes!.includes('not original hourly source values'));
  const html = renderToStaticMarkup(React.createElement(ComparisonResults, { result: displayed, units: 'us' }));
  assert.ok(html.includes('Download displayed comparison CSV (SI)')); assert.ok(html.includes('even if form inputs change'));
});
test('CSV rejects malformed results and excessive chunk exports', () => {
  const result = parseComparison(fixture(), query).result!;
  const malformed = structuredClone(result); malformed.dataset = 'station' as never; assert.throws(() => comparisonCsv(malformed));
  const excessive = structuredClone(result); excessive.locations[0]!.sources = Array(61).fill(excessive.locations[0]!.sources[0]);
  assert.throws(() => comparisonCsv(excessive), /Too many/);
});

test('visual overview precedes closed detail table and explicitly distinguishes missing and unequal coverage', () => {
  const raw = fixture();
  raw.result.locations[1]!.variables.temperatureC = { unit: '°C', expectedCount: 24, validCount: 0, missingCount: 24, absentSourceCount: 20, nullValueCount: 4, status: 'no_data', mean: null, min: null, max: null } as never;
  raw.result.commonValidCounts.temperatureC = 0;
  const html = renderToStaticMarkup(React.createElement(ComparisonResults, { result: parseComparison(raw, query).result!, units: 'metric' }));
  for (const text of ['Compare variable', '0/24 shared valid', 'Unequal city coverage', 'Unavailable', 'No data', '0.0°C', 'Lowest air temperature over available hours', 'Highest air temperature over available hours']) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf('comparison-visuals') < html.indexOf('<table'));
  assert.ok(html.includes('<details><summary>Detailed values and comparison method</summary>'));
});
