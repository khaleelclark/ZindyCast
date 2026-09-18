import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { InstallationRepository } from '@zindycast/installations';
import { VerificationRepository, VERIFICATION_BASELINE_MODEL, sanitizeForecast } from '@zindycast/verification';
import { registerVerification, archiveReceivedForecast } from './verification.js';
import { observationDistanceKm, type ObservationQuery, type ObservationsData } from '../../../packages/contracts/src/observations.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-14T12:00:00Z');
const station = { id: 'USW00000001', name: 'Fixture station', coordinates: { latitude: 38.7, longitude: -121.3 }, elevationM: 40,
  distanceKm: 4.2, elevationDifferenceM: -8, selectionVersion: 'station-selection-v1' };
const input = (placeId = 'roseville') => ({ placeId, optedIn: true as const,
  location: { id: `place:${placeId}`, name: placeId, admin1: 'California', country: 'US', timezone: 'America/Los_Angeles', latitude: 38.75, longitude: -121.29 }, station });
const forecast = (retrievedAt = NOW) => ({
  location: input().location,
  provenance: { provider: 'Open-Meteo', dataset: 'Forecast API (best match; constituent models not supplied)', classification: 'modeled' as const,
    retrievedAt: new Date(retrievedAt).toISOString(), sourceIssuedAt: null, sourceCoordinates: { latitude: 38.8, longitude: -121.25 }, attribution: 'fixture' },
  intervalSemantics: 'instant meteorology; precipitation and probability preceding hour; gust preceding-hour maximum' as const,
  missingFields: [],
  hours: [1, 2].map(offset => ({ time: new Date(retrievedAt + offset * 3_600_000).toISOString(), temperatureC: 20, apparentTemperatureC: 20,
    humidityPercent: 40, precipitationMm: 0, precipitationProbability: 10, windSpeedMs: 2, windGustMs: 3, windDirectionDeg: 180,
    weatherCode: 0, ordinaryWetBulbC: 10, dewPointC: 5, surfacePressureHpa: 1000, cloudCoverPercent: 0, visibilityM: 10000, uvIndex: 0 })),
});

function observationCandidates(query: ObservationQuery): ObservationsData {
  const coordinates = station.coordinates;
  return {
    query, stations: [{ stationId: station.id, name: 'Provider-verified station', coordinates, elevationM: station.elevationM,
      distanceKm: observationDistanceKm(query, coordinates), sourceUrl: `https://api.weather.gov/stations/${station.id}`,
      latestObservationTime: null, observationHistoryTruncated: false, observations: [] }],
    candidateCount: 1, candidateSetTruncated: false, provider: 'NWS', dataset: 'NWS API station observations (MADIS ingest)',
    classification: 'observed', retrievedAt: new Date(NOW).toISOString(),
    stationListSourceUrl: 'https://api.weather.gov/gridpoints/STO/1,2/stations?limit=5',
    selectionPolicy: 'distance-ranked candidates only; no automatic representativeness selection',
    stationContinuity: 'observations remain grouped by station; no cross-station splice',
    intervalSemantics: 'station instants; precipitationLastHourMm is the reported preceding-hour accumulation ending at observation time',
    units: { temperatureC: 'wmoUnit:degC', dewPointC: 'wmoUnit:degC', humidityPercent: 'wmoUnit:percent',
      windSpeedMs: 'wmoUnit:m_s-1', windGustMs: 'wmoUnit:m_s-1', windDirectionDeg: 'wmoUnit:degree_(angle)',
      barometricPressurePa: 'wmoUnit:Pa', visibilityM: 'wmoUnit:m', precipitationLastHourMm: 'wmoUnit:mm' },
    qualityControlSourceUrl: 'https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml', attribution: 'Fixture NWS metadata',
  };
}

function setup(maxTrackedPlaces = 20) {
  const verification = new VerificationRepository({ path: ':memory:', clock: () => NOW, maxTrackedPlaces });
  const installations = new InstallationRepository({ path: ':memory:', clock: () => NOW });
  const app = Fastify(); registerVerification(app, { verification, installations, clock: () => NOW,
    fetchStationCandidates: async query => observationCandidates(query) });
  const a = installations.register(30 * DAY), b = installations.register(30 * DAY);
  const headers = (bearer: string) => ({ authorization: `Bearer ${bearer}`, 'x-zindycast-request': '1' });
  return { app, verification, installations, a, b, headers, close: async () => { await app.close(); verification.close(); installations.close(); } };
}

test('authenticated opt-in registration is owner scoped, idempotent and mutable only by removal', async () => {
  const s = setup(); try {
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', payload: input() })).statusCode, 403);
    const created = await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.a.bearer), payload: input() });
    assert.equal(created.statusCode, 201); assert.equal(created.json().place.station.id, station.id);
    assert.equal(created.json().place.station.name, 'Provider-verified station');
    assert.equal(created.json().place.station.elevationDifferenceM, null);
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.a.bearer), payload: input() })).statusCode, 201);
    assert.equal((await s.app.inject({ url: '/api/v1/verification/places', headers: { authorization: `Bearer ${s.b.bearer}` } })).json().places.length, 0);
    const unavailable = structuredClone(input()); unavailable.station.id = 'USW00000002';
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.a.bearer), payload: unavailable })).statusCode, 400);
    const changed = structuredClone(input()); changed.location.name = 'Changed Roseville';
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.a.bearer), payload: changed })).statusCode, 409);
    assert.equal((await s.app.inject({ method: 'DELETE', url: '/api/v1/verification/places/roseville', headers: s.headers(s.b.bearer) })).statusCode, 404);
    const removed = await s.app.inject({ method: 'POST', url: '/api/v1/verification/places/roseville/remove', headers: s.headers(s.a.bearer) });
    assert.equal(removed.statusCode, 200); assert.deepEqual(removed.json(), { status: 'success' });
  } finally { await s.close(); }
});

test('five-place installation and global capacity are enforced', async () => {
  const s = setup(6); try {
    for (let index = 0; index < 5; index++) assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.a.bearer), payload: input(`place${index}`) })).statusCode, 201);
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.a.bearer), payload: input('sixth') })).statusCode, 429);
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.b.bearer), payload: input('other') })).statusCode, 201);
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/v1/verification/places', headers: s.headers(s.b.bearer), payload: input('global-full') })).statusCode, 429);
  } finally { await s.close(); }
});

test('forecast hook archives only opted-in exact locations and excludes unrelated/WBGT fields', async () => {
  const s = setup(); try {
    s.verification.registerPlace(s.a.id, input());
    const result = archiveReceivedForecast(s.verification, forecast() as never, 'forecast-route-v6');
    assert.deepEqual(result, { matchedTargets: 1, insertedSnapshots: 1, failedTargets: 0 });
    const again = archiveReceivedForecast(s.verification, forecast() as never, 'forecast-route-v6');
    assert.deepEqual(again, { matchedTargets: 1, insertedSnapshots: 0, failedTargets: 0 });
    assert.equal(s.verification.usage().forecastPoints, 2);
    const other = forecast() as never as ReturnType<typeof forecast>; other.location = { ...other.location, latitude: 1 };
    assert.equal(archiveReceivedForecast(s.verification, other as never, 'forecast-route-v6').matchedTargets, 0);
    const target = s.verification.place(s.a.id, 'roseville')!;
    assert.equal(sanitizeForecast(target, VERIFICATION_BASELINE_MODEL, forecast(), 'v').points.length, 2);
  } finally { await s.close(); }
});

test('scorecard endpoint never authorizes by public place or target id', async () => {
  const s = setup(); try {
    const place = s.verification.registerPlace(s.a.id, input());
    assert.equal((await s.app.inject({ url: '/api/v1/verification/scorecards/roseville', headers: { authorization: `Bearer ${s.b.bearer}` } })).statusCode, 404);
    assert.equal((await s.app.inject({ url: `/api/v1/verification/scorecards/${place.targetKey}`, headers: { authorization: `Bearer ${s.a.bearer}` } })).statusCode, 404);
    const response = await s.app.inject({ url: '/api/v1/verification/scorecards/roseville', headers: { authorization: `Bearer ${s.a.bearer}` } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().scorecard.status, 'pending');
  } finally { await s.close(); }
});


test('station registration validates freshness after a delayed provider response', async () => {
  let now = NOW;
  const verification = new VerificationRepository({ path: ':memory:', clock: () => now });
  const installations = new InstallationRepository({ path: ':memory:', clock: () => now });
  const owner = installations.register(30 * DAY);
  const app = Fastify();
  registerVerification(app, { verification, installations, clock: () => now,
    fetchStationCandidates: async query => {
      now += 2_000;
      return { ...observationCandidates(query), retrievedAt: new Date(now).toISOString() };
    } });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/v1/verification/places',
      headers: { authorization: `Bearer ${owner.bearer}`, 'x-zindycast-request': '1' }, payload: input() });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().place.station.name, 'Provider-verified station');
  } finally { await app.close(); verification.close(); installations.close(); }
});
