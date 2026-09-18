import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StationDataSchema, stationCell, stationCoverage } from '@zindycast/contracts';
import { stationSelection, sameStationSelection, parseStationResponse, stationUrl, StationCell, StationResult, StationPanel } from './stations';
import { HistoryPanel } from './history';

const now = Date.parse('2026-09-11T01:00:00Z');
const query = { stationId: 'USC00021282', startDate: '2020-02-28', endDate: '2020-03-01' };
// Synthetic contract fixture, isolated to tests; no server-only module or live station retrieval.
function fixture() {
  const days = [
    { date: '2020-02-28', TMAX: stationCell(111, ' ', 'I', '0'), TMIN: stationCell(0, ' ', ' ', '7'), PRCP: stationCell(0, 'T', ' ', '7') },
    { date: '2020-02-29', TMAX: stationCell(222, ' ', 'J', 'W'), TMIN: stationCell(-9999, ' ', ' ', '7'), PRCP: stationCell(0, 'P', ' ', '0') },
    { date: '2020-03-01', TMAX: stationCell(null, null, null, null), TMIN: stationCell(null, null, null, null), PRCP: stationCell(15, 'J', ' ', 'j') },
  ];
  return StationDataSchema.parse({ query, station: { id: query.stationId, name: null, coordinates: null, elevationM: null, metadataStatus: 'not_retrieved' },
    timeContext: { basis: 'source daily calendar labels', timezone: null, observationTime: null, intervalStart: null, intervalEnd: null },
    units: { TMAX: '°C', TMIN: '°C', PRCP: 'mm' }, rawUnits: { TMAX: 'tenths °C', TMIN: 'tenths °C', PRCP: 'tenths mm' },
    provenance: { provider: 'NOAA NCEI', dataset: 'GHCN-Daily', datasetVersion: null, classification: 'station_daily_summary', requestUrl: `https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/${query.stationId}.dly`, sourceUrl: 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt', retrievedAt: '2026-09-11T00:00:00Z', sourceIssuedAt: null, sourceUpdatedAt: null, adapterVersion: 'ghcnd-daily-v1' }, days, coverage: stationCoverage(days) });
}
test('explicit station and source calendar selection validates IDs, leap days, future and inclusive 366-day bounds', () => {
  assert.deepEqual(stationSelection(' usc00021282 ', query.startDate, query.endDate, now), query);
  assert.equal(stationSelection(query.stationId, '2020-01-01', '2020-12-31', now).endDate, '2020-12-31');
  assert.equal(stationSelection(query.stationId, '0001-01-01', '0001-01-01', now).startDate, '0001-01-01');
  for (const [id, start, end] of [['../anything', query.startDate, query.endDate], [query.stationId, '2021-02-29', '2021-03-01'], [query.stationId, '2020-01-01', '2021-01-01'], [query.stationId, '2020-03-01', '2020-02-29'], [query.stationId, '2026-09-11', '2026-09-12']]) assert.throws(() => stationSelection(id!, start!, end!, now));
  const url = new URL(stationUrl(query), 'https://example.test');
  assert.equal(url.pathname, '/api/v1/stations/history');
  assert.deepEqual(Object.fromEntries(url.searchParams), query);
});
test('response guard rejects wrong station/date and malformed counts, quality, timeline or source link', () => {
  const response = { status: 'success', freshness: 'fresh', data: fixture() };
  assert.equal(parseStationResponse(response, query).data.days.length, 3);
  for (const change of [{ stationId: 'USW00026451' }, { startDate: '2020-02-29' }, { endDate: '2020-03-02' }]) {
    assert.equal(sameStationSelection(query, { ...query, ...change }), false);
    assert.throws(() => parseStationResponse(response, { ...query, ...change }), /does not match/);
  }
  for (const edit of [(d: ReturnType<typeof fixture>) => { d.coverage.TMAX.unflagged = 3; }, (d: ReturnType<typeof fixture>) => { d.days[0]!.TMAX.qcStatus = 'unflagged'; }, (d: ReturnType<typeof fixture>) => { d.days[1]!.date = '2020-03-01'; }, (d: ReturnType<typeof fixture>) => { d.provenance.requestUrl = 'https://example.test'; }]) {
    const data = fixture(); edit(data); assert.throws(() => parseStationResponse({ ...response, data }, query));
  }
});
test('station markup preserves flags, unaccepted numeric values, null/zero, coverage and unknown observation intervals', () => {
  const html = renderToStaticMarkup(createElement(StationResult, { data: fixture(), units: 'us' }));
  for (const text of ['52°', '32°', '0.00 in', 'QC flagged — not accepted quality', 'Unknown quality code — not accepted quality', 'Trace (T)', 'Missing presumed zero (P)', 'Unknown flag meaning: measurement, source', 'Source missing value (-9999)', 'Absent source month/element', 'Raw value: 111', 'quality: I', '2020-02-29', '0/3 source dates', 'Eligibility is not assessed', 'observation time, timezone and interval endpoints unknown', 'Station name, coordinates and elevation: not retrieved', 'No period totals are computed', 'NOAA NCEI', 'not been converted to UTC instants']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const metric = renderToStaticMarkup(createElement(StationResult, { data: fixture(), units: 'metric' }));
  assert.match(metric, /1.5 mm/); assert.match(metric, /0°/);
  const missingPresumed = renderToStaticMarkup(createElement(StationCell, { value: stationCell(-9999, 'P', ' ', '0'), element: 'PRCP', units: 'us' }));
  assert.match(missingPresumed, /—/); assert.match(missingPresumed, /Missing presumed zero/); assert.doesNotMatch(missingPresumed, /0.00 in/);
});
test('History retains reanalysis by default and station entry works independently without city or automatic loading', () => {
  const history = renderToStaticMarkup(createElement(HistoryPanel, { location: null, online: true, units: 'us', now }));
  assert.match(history, /Modeled reanalysis · city coordinates/); assert.match(history, /Station daily summaries · explicit station ID/); assert.match(history, /ERA5 requested via Open-Meteo/);
  const station = renderToStaticMarkup(createElement(StationPanel, { online: false, units: 'us', now }));
  assert.match(station, /Offline — station history unavailable/); assert.match(station, /station WBGT are not available/); assert.match(station, /value=""/); assert.match(station, /disabled=""/); assert.doesNotMatch(station, /USC00021282|Loading requested/);
});
