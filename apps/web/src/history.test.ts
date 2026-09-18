import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReanalysisDataSchema, renderReanalysisCsv } from '@zindycast/contracts';
import { historySelection, monthRange, latestHistoryDate, sameSelection, parseHistory, historyUrl, HistoryResult } from './history';
const now = Date.parse('2026-09-11T00:01:00Z');
const query = { latitude: 28, longitude: -81, startDate: '2020-03-08', endDate: '2020-03-08' };
function fixture() {
  return ReanalysisDataSchema.parse({ query, timezone: 'UTC', provenance: { provider: 'Open-Meteo', dataset: 'ERA5 (requested)', requestedModel: 'era5', constituent: null, classification: 'modeled_reanalysis', sourceCoordinates: { latitude: 28.1, longitude: -81.1 }, sourceElevationM: null, retrievedAt: '2026-09-11T00:00:00Z', sourceIssuedAt: null, sourceUpdatedAt: null, requestUrl: 'https://archive-api.open-meteo.com/v1/archive', sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api', attribution: 'Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF', cellSelection: 'land', downscaling: 'provider default elevation adjustment', calculationVersion: 'reanalysis-adapter-v1' }, units: { temperatureC: '°C', humidityPercent: '%', precipitationMm: 'mm', windSpeedMs: 'm/s', dewPointC: '°C' }, intervalSemantics: 'instant meteorology; precipitation sum over preceding hour ending at time', hours: Array.from({ length: 24 }, (_, i) => ({ time: new Date(Date.parse(query.startDate) + i * 3600000).toISOString(), temperatureC: i === 0 ? 0 : null, humidityPercent: null, precipitationMm: i === 0 ? 0 : null, windSpeedMs: null, dewPointC: null, sourceHourPresent: i === 0, missingFields: i === 0 ? ['humidityPercent', 'windSpeedMs', 'dewPointC'] : ['temperatureC', 'humidityPercent', 'precipitationMm', 'windSpeedMs', 'dewPointC'] })), completeness: { status: 'partial', expectedHours: 24, sourceHours: 1, completeHours: 0, missingHours: 23, validCounts: { temperatureC: 1, humidityPercent: 0, precipitationMm: 1, windSpeedMs: 0, dewPointC: 0 } } });
}
test('UTC dates enforce leap months, 31-day bound and availability lag independently of DST', () => {
  assert.equal(latestHistoryDate(now), '2026-09-06');
  assert.deepEqual(monthRange('2020-02'), { startDate: '2020-02-01', endDate: '2020-02-29' });
  assert.equal(monthRange('2021-02').endDate, '2021-02-28');
  assert.equal(monthRange('2020-13').startDate, '');
  assert.deepEqual(historySelection(query, query.startDate, query.endDate, now), query);
  for (const [start, end] of [['2020-02-30','2020-03-01'], ['2020-01-01','2020-02-01'], ['1939-12-31','1940-01-01'], ['2026-09-06','2026-09-07']]) assert.throws(() => historySelection(query, start!, end!, now));
});
test('response identity and export stay tied to successful coordinates/dates, with safe label', () => {
  const data = fixture(); const response = { status: 'success', freshness: 'fresh', data };
  assert.equal(parseHistory(response, query).data.hours.length, 24);
  for (const change of [{ latitude: 29 }, { longitude: -82 }, { startDate: '2020-03-09' }, { endDate: '2020-03-09' }]) {
    assert.equal(sameSelection(query, { ...query, ...change }), false);
    assert.throws(() => parseHistory(response, { ...query, ...change }), /does not match/);
  }
  const url = new URL(historyUrl(data.query, '\t=HYPERLINK("x")', 'csv'), 'https://example.test');
  assert.equal(url.searchParams.get('name'), '\'=HYPERLINK("x")');
  assert.equal(url.searchParams.get('startDate'), query.startDate);
  assert.equal(url.searchParams.get('format'), 'csv');
  data.completeness.completeHours = 24;
  assert.throws(() => parseHistory({ ...response, data }, query));
});
test('partial history renders nullable units, source differences, UTC rain semantics and chart gaps', () => {
  const html = renderToStaticMarkup(createElement(HistoryResult, { data: fixture(), units: 'us' }));
  for (const text of ['Partial returned series', '0/24 hours', '23 missing source hours', '32°', '0.00 in', 'Missing source hour', 'prior UTC date', '28.1', 'Source elevation: unavailable', 'modeled reanalysis', 'Historical hourly values in UTC']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const data = fixture(); data.hours[0]!.temperatureC = null;
  const missing = renderToStaticMarkup(createElement(HistoryResult, { data, units: 'metric' }));
  assert.match(missing, /no temperature values/); assert.doesNotMatch(missing, /<svg/);
});

test('displayed normalized snapshot exports without fetch, with identical metadata, zeros and nulls', t => {
  const calls = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No export request permitted'); });
  const data = fixture(); const original = structuredClone(data);
  const csv = renderReanalysisCsv(data, '=Fixture city');
  assert.equal(calls.mock.callCount(), 0);
  assert.deepEqual(data, original);
  assert.ok(csv.includes(`"'=Fixture city"`));
  assert.ok(csv.includes('"2020-03-08T00:00:00.000Z",0,,0,,,'));
  assert.ok(csv.includes('false,"temperatureC;humidityPercent;precipitationMm;windSpeedMs;dewPointC"'));
  assert.ok(csv.includes(data.provenance.retrievedAt));
  assert.ok(csv.includes('source_elevation_m'));
  assert.equal(csv.split('\r\n').length, 26);
  assert.equal(csv, renderReanalysisCsv(original, '=Fixture city'));
});
