import test from 'node:test';
import assert from 'node:assert/strict';
import { VerificationRepository, VERIFICATION_BASELINE_MODEL, sanitizeForecast, type ObservationNeed, type VerificationPlace } from '@zindycast/verification';
import { observationDistanceKm, observationQualityMeanings, type ObservationField, type ObservationQualityControl, type ObservationsData } from '../../../packages/contracts/src/observations.js';
import { VerificationWorker, observationSnapshotFromNws } from './verification-worker.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse('2026-09-14T00:00:00Z');
const station = { id: 'USW00000001', name: 'Fixture station', coordinates: { latitude: 38.7, longitude: -121.3 }, elevationM: 40,
  distanceKm: 4.2, elevationDifferenceM: -8, selectionVersion: 'station-selection-v1' };
const input = { placeId: 'roseville', optedIn: true as const,
  location: { id: 'place:roseville', name: 'Roseville', admin1: 'California', country: 'US', timezone: 'America/Los_Angeles', latitude: 38.75, longitude: -121.29 }, station };
const candidate = { id: 'open-meteo-gfs', role: 'candidate' as const, provider: 'Open-Meteo', requestedModel: 'gfs_seamless', constituentModel: null };

function forecast(target: VerificationPlace, retrievedAt: number, modelId = 'best_match') {
  return {
    location: target.location,
    provenance: { provider: 'Open-Meteo', dataset: `Forecast API (${modelId})`, classification: 'modeled' as const,
      retrievedAt: new Date(retrievedAt).toISOString(), sourceIssuedAt: null, sourceCoordinates: { latitude: 38.8, longitude: -121.25 }, attribution: 'fixture' },
    intervalSemantics: 'instant meteorology; precipitation and probability preceding hour; gust preceding-hour maximum' as const,
    missingFields: [],
    hours: Array.from({ length: 8 }, (_, index) => ({ time: new Date(retrievedAt + (index + 1) * HOUR).toISOString(), temperatureC: 20 + index,
      apparentTemperatureC: 20, humidityPercent: 50, precipitationMm: 0, precipitationProbability: index * 10, windSpeedMs: 2,
      windGustMs: 3, windDirectionDeg: 180, weatherCode: 0, ordinaryWetBulbC: 10, dewPointC: 10, surfacePressureHpa: 1000,
      cloudCoverPercent: 0, visibilityM: 10000, uvIndex: 0 })),
  };
}
function observations(target: VerificationPlace, need: ObservationNeed, retrievedAt: number) {
  const cell = (value: number) => ({ value, status: 'accepted' as const, flags: [] });
  return { schemaVersion: 'observation-verification-snapshot-v1' as const, targetKey: target.targetKey, station: target.station,
    provider: 'NOAA', dataset: 'bounded fixture', retrievedAt: new Date(retrievedAt).toISOString(), sourceIssuedAt: null, sourceVersion: 'fixture', adapterVersion: 'fixture-v1',
    units: { temperature: '°C' as const, dewPoint: '°C' as const, windSpeed: 'm/s' as const, precipitation: 'mm' as const },
    timeSemantics: 'hourly fixture; precipitation preceding hour',
    points: need.validTimes.map(time => ({ validTime: time, sourceTime: time,
      sourceId: `https://api.weather.gov/stations/${target.station.id}/observations/${encodeURIComponent(time)}`,
      temperatureC: cell(19), dewPointC: cell(9), windSpeedMs: cell(3), precipitationMm: cell(0),
      precipitationInterval: { start: new Date(Date.parse(time) - HOUR).toISOString(), end: time, completeness: 'complete' as const } })),
  };
}
function setup() {
  let now = START;
  const verification = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30 });
  const target = verification.registerPlace('installation', input);
  return { verification, target, clock: () => now, advance: (milliseconds: number) => { now += milliseconds; }, close: () => verification.close() };
}

test('captures baseline, budget-admitted candidate and schedules the target without live calls', async () => {
  const s = setup(); try {
    const calls: string[] = [];
    const worker = new VerificationWorker({ verification: s.verification, isInstallationActive: () => true, clock: s.clock, candidateModels: [candidate], reserveCandidateBudget: () => true,
      fetchForecast: async (target, model) => { calls.push(model.id); return forecast(target, s.clock(), model.requestedModel) as never; },
      fetchObservations: async () => { throw new Error('no past forecast yet'); } });
    assert.equal(await worker.runOnce(), 'handled');
    assert.deepEqual(calls, ['open-meteo-best-match', 'open-meteo-gfs']);
    assert.deepEqual(s.verification.usage(), { memberships: 1, targets: 1, forecastSnapshots: 2, forecastPoints: 16, observationSnapshots: 0, observationPoints: 0 });
    assert.equal(await worker.runOnce(), 'idle');
  } finally { s.close(); }
});

test('candidate is opt-in by explicit budget and daily cadence while baseline uses six hours', async () => {
  const s = setup(); try {
    const calls: string[] = [];
    const worker = new VerificationWorker({ verification: s.verification, isInstallationActive: () => true, clock: s.clock, candidateModels: [candidate], reserveCandidateBudget: () => false,
      fetchForecast: async (target, model) => { calls.push(model.id); return forecast(target, s.clock(), model.requestedModel) as never; },
      fetchObservations: async (target, need) => observations(target, need, s.clock()) });
    await worker.runOnce(); assert.deepEqual(calls, ['open-meteo-best-match']);
    s.advance(6 * HOUR); await worker.runOnce(); assert.deepEqual(calls, ['open-meteo-best-match', 'open-meteo-best-match']);
  } finally { s.close(); }
});

test('later cycle archives only requested QC observation times before capturing a new forecast', async () => {
  const s = setup(); try {
    let observationCalls = 0;
    const worker = new VerificationWorker({ verification: s.verification, isInstallationActive: () => true, clock: s.clock,
      fetchForecast: async target => forecast(target, s.clock()) as never,
      fetchObservations: async (target, need) => { observationCalls++; assert.ok(need.validTimes.every(time => Date.parse(time) <= s.clock() - 2 * HOUR)); return observations(target, need, s.clock()); } });
    await worker.runOnce(); s.advance(6 * HOUR); await worker.runOnce();
    assert.equal(observationCalls, 1); assert.equal(s.verification.usage().observationPoints, 4);
    assert.equal(s.verification.scorecard(s.target.targetKey).status, 'insufficient_evidence');
  } finally { s.close(); }
});

test('observation failure remains pending without suppressing a fresh forecast capture', async () => {
  const s = setup(); try {
    let forecastCalls = 0, observationCalls = 0;
    const worker = new VerificationWorker({ verification: s.verification, isInstallationActive: () => true, clock: s.clock,
      fetchForecast: async target => { forecastCalls++; return forecast(target, s.clock()) as never; },
      fetchObservations: async () => { observationCalls++; throw new Error('fixture observation outage'); } });
    await worker.runOnce();
    s.advance(6 * HOUR);
    assert.equal(await worker.runOnce(), 'handled');
    assert.equal(forecastCalls, 2); assert.equal(observationCalls, 1);
    assert.equal(s.verification.usage().forecastSnapshots, 2);
    assert.equal(s.verification.usage().observationSnapshots, 0);
    assert.notEqual(s.verification.observationNeed(s.target.targetKey, s.clock() - 2 * HOUR), null);
  } finally { s.close(); }
});

test('inactive installation is pruned before leasing and performs no provider work', async () => {
  const s = setup(); try {
    let calls = 0;
    const worker = new VerificationWorker({ verification: s.verification, isInstallationActive: id => id !== 'installation', clock: s.clock,
      fetchForecast: async target => { calls++; return forecast(target, s.clock()) as never; },
      fetchObservations: async () => { calls++; throw new Error('unused'); } });
    assert.equal(await worker.runOnce(), 'idle');
    assert.equal(calls, 0); assert.equal(s.verification.usage().memberships, 0);
  } finally { s.close(); }
});

test('provider failures back off durably and do not create partial forecast snapshots', async () => {
  const s = setup(); try {
    let calls = 0;
    const worker = new VerificationWorker({ verification: s.verification, isInstallationActive: () => true, clock: s.clock,
      fetchForecast: async () => { calls++; throw new Error('fixture failure'); }, fetchObservations: async () => { throw new Error('unused'); } });
    assert.equal(await worker.runOnce(), 'handled'); assert.equal(calls, 1); assert.equal(s.verification.usage().forecastSnapshots, 0);
    assert.equal(await worker.runOnce(), 'idle'); s.advance(15 * 60_000); assert.equal(await worker.runOnce(), 'handled'); assert.equal(calls, 2);
  } finally { s.close(); }
});

test('shutdown and same-instance concurrency abort provider work without publication', async () => {
  const s = setup(); try {
    const stop = new AbortController(); let worker: VerificationWorker;
    worker = new VerificationWorker({ verification: s.verification, isInstallationActive: () => true, clock: s.clock, requestTimeoutMs: 100,
      fetchForecast: async (_target, _model, signal) => {
        assert.equal(await worker.runOnce(), 'busy'); stop.abort(new Error('shutdown'));
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }, fetchObservations: async () => { throw new Error('unused'); } });
    assert.equal(await worker.runOnce(stop.signal), 'handled'); assert.equal(s.verification.usage().forecastSnapshots, 0);
  } finally { s.close(); }
});

test('NWS adapter preserves source time/QC and never treats shifted precipitation periods as forecast-hour truth', () => {
  const s = setup(); try {
    const validTimes = [new Date(START + HOUR).toISOString(), new Date(START + 2 * HOUR).toISOString()];
    const need: ObservationNeed = { targetKey: s.target.targetKey, stationId: station.id, startTime: validTimes[0]!, endTime: validTimes[1]!,
      requestStartTime: new Date(START + 30 * 60_000).toISOString(), requestEndTime: new Date(START + 2.5 * HOUR).toISOString(), validTimes };
    const measurement = (value: number | null, qualityControl: ObservationQualityControl | null = value === null ? null : 'V') => ({
      value, qualityControl, qualityMeaning: qualityControl === null ? null : observationQualityMeanings[qualityControl],
    });
    const missingFields: ObservationField[] = ['humidityPercent', 'windGustMs', 'windDirectionDeg', 'barometricPressurePa', 'visibilityM'];
    const row = (time: number, qc: ObservationQualityControl) => ({
      sourceId: `https://api.weather.gov/stations/${station.id}/observations/${encodeURIComponent(new Date(time).toISOString())}`,
      time: new Date(time).toISOString(), textDescription: null,
      measurements: { temperatureC: measurement(20, qc), dewPointC: measurement(10, qc), humidityPercent: measurement(null),
        windSpeedMs: measurement(3, qc), windGustMs: measurement(null), windDirectionDeg: measurement(null), barometricPressurePa: measurement(null),
        visibilityM: measurement(null), precipitationLastHourMm: measurement(0, qc) },
      missingFields,
    });
    const coordinates = station.coordinates;
    const data: ObservationsData = { query: { latitude: input.location.latitude, longitude: input.location.longitude, since: need.requestStartTime, until: need.requestEndTime, stationLimit: 3 },
      stations: [{ stationId: station.id, name: station.name, coordinates, elevationM: station.elevationM, observationHistoryTruncated: false,
        distanceKm: observationDistanceKm(input.location, coordinates), sourceUrl: `https://api.weather.gov/stations/${station.id}`,
        latestObservationTime: new Date(START + HOUR + 53 * 60_000).toISOString(),
        observations: [row(START + HOUR + 53 * 60_000, 'Q'), row(START + 53 * 60_000, 'V')] }],
      candidateCount: 1, candidateSetTruncated: false, provider: 'NWS' as const, dataset: 'NWS API station observations (MADIS ingest)' as const,
      classification: 'observed' as const, retrievedAt: new Date(START + 3 * HOUR).toISOString(),
      stationListSourceUrl: 'https://api.weather.gov/gridpoints/STO/1,2/stations?limit=5',
      selectionPolicy: 'distance-ranked candidates only; no automatic representativeness selection' as const,
      stationContinuity: 'observations remain grouped by station; no cross-station splice' as const,
      intervalSemantics: 'station instants; precipitationLastHourMm is the reported preceding-hour accumulation ending at observation time' as const,
      units: { temperatureC: 'wmoUnit:degC' as const, dewPointC: 'wmoUnit:degC' as const, humidityPercent: 'wmoUnit:percent' as const,
        windSpeedMs: 'wmoUnit:m_s-1' as const, windGustMs: 'wmoUnit:m_s-1' as const, windDirectionDeg: 'wmoUnit:degree_(angle)' as const,
        barometricPressurePa: 'wmoUnit:Pa' as const, visibilityM: 'wmoUnit:m' as const, precipitationLastHourMm: 'wmoUnit:mm' as const },
      qualityControlSourceUrl: 'https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml' as const, attribution: 'Fixture NWS observations' };
    s.advance(3 * HOUR);
    const snapshot = observationSnapshotFromNws(s.target, need, data);
    assert.equal(snapshot.points[0]!.sourceTime, new Date(START + 53 * 60_000).toISOString());
    assert.equal(snapshot.points[0]!.temperatureC.status, 'accepted');
    assert.deepEqual(snapshot.points[0]!.temperatureC.flags, ['V:verified_pass_levels_1_2_3']);
    assert.equal(snapshot.points[1]!.temperatureC.status, 'rejected');
    assert.equal(snapshot.points[1]!.precipitationInterval!.end, new Date(START + HOUR + 53 * 60_000).toISOString());
    const received = forecast(s.target, START);
    s.verification.addForecastSnapshot(sanitizeForecast(s.target, VERIFICATION_BASELINE_MODEL, { ...received, hours: received.hours.slice(0, 2) } as never, 'fixture-v1'));
    s.verification.addObservationSnapshot(snapshot);
    const rain = s.verification.scorecard(s.target.targetKey).models[0]!.horizons[0]!.all.rain;
    assert.equal(rain.incompatibleInterval, 1); assert.equal(rain.excludedQuality, 1); assert.equal(rain.paired, 0);
  } finally { s.close(); }
});
