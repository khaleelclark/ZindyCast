import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STATION_DISCOVERY_SOURCE, stationDistanceKm } from '@zindycast/contracts';
import { nearbyStationUrl, parseStationDiscovery, StationCandidates, StationDiscovery } from './station-discovery';
const query = { latitude: 36.154, longitude: -95.993 };
function fixture() {
  const coordinates = { latitude: 36.16, longitude: -95.98 };
  return { status: 'success', freshness: 'fresh', data: { query, candidates: [{ id: 'USW00013968', name: null, coordinates, elevationM: null, distanceKm: stationDistanceKm(query, coordinates) }], radiusKm: 150, limit: 10, countryScope: 'US', ordering: 'distance_then_id', metadataRetrievedAt: '2026-09-11T08:00:00Z', sourceUrl: STATION_DISCOVERY_SOURCE, provider: 'NOAA NCEI', dataset: 'GHCN-Daily station metadata', adapterVersion: 'ghcnd-discovery-v1', sourceUpdatedAt: null, completeness: 'not_assessed', timeHistory: 'not_assessed', eligibility: 'not_assessed', proximityMeaning: 'not_a_scientific_recommendation' } };
}
test('nearby response identity, radius, candidate IDs and computed distance are validated', () => {
  const response = fixture();
  assert.equal(parseStationDiscovery(response, query).data.candidates[0]!.id, 'USW00013968');
  assert.throws(() => parseStationDiscovery(response, { ...query, latitude: 36 }), /do not match/);
  assert.throws(() => parseStationDiscovery({ ...response, data: { ...response.data, candidates: Array(11).fill(response.data.candidates[0]) } }, query));
  assert.throws(() => parseStationDiscovery({ ...response, data: { ...response.data, candidates: [{ ...response.data.candidates[0], distanceKm: 0 }] } }, query));
  const url = new URL(nearbyStationUrl(query), 'http://local.test');
  assert.equal(url.pathname, '/api/v1/stations/nearby');
  assert.deepEqual(Object.fromEntries(url.searchParams), { latitude: '36.154', longitude: '-95.993' });
});
test('candidate metadata distinguishes nulls, city/station positions, eligibility and explicit load', () => {
  const data = parseStationDiscovery(fixture(), query).data;
  const html = renderToStaticMarkup(createElement(StationCandidates, { data, onChoose: () => {} }));
  for (const text of ['Unnamed station', 'USW00013968', 'elevation unavailable', 'station coordinates 36.16', 'Selecting fills the station ID', 'not verified historical locations', 'not assessed', 'NOAA station catalog', '2026-09-11T08:00:00Z']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const empty = renderToStaticMarkup(createElement(StationCandidates, { data: { ...data, candidates: [] }, onChoose: () => {} }));
  assert.match(empty, /No metadata candidates found within 150 km/);
  const offline = renderToStaticMarkup(createElement(StationDiscovery, { online: false, onChoose: () => {} }));
  assert.match(offline, /Search city for nearby stations/); assert.match(offline, /disabled=""/); assert.doesNotMatch(offline, /Finding station metadata/);
});
