import test from 'node:test';
import assert from 'node:assert/strict';
import { VerificationRepository, VERIFICATION_BASELINE_MODEL, sanitizeForecast, type VerificationModel } from './index.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.parse('2026-01-01T00:00:00Z');
const input = { placeId: 'roseville', optedIn: true as const,
  location: { id: 'place:roseville', name: 'Roseville', admin1: 'California', country: 'US', timezone: 'America/Los_Angeles', latitude: 38.75, longitude: -121.29 },
  station: { id: 'USW00000001', name: 'Fixture station', coordinates: { latitude: 38.7, longitude: -121.3 }, elevationM: 40,
    distanceKm: 4.2, elevationDifferenceM: -8, selectionVersion: 'station-selection-v1' } };

function forecast(targetKey: string, retrievedAt: number, validTimes: number[], temperatureC = 20, model: VerificationModel = VERIFICATION_BASELINE_MODEL) {
  return { schemaVersion: 'forecast-verification-snapshot-v1' as const, targetKey, location: input.location, requestLocation: input.location, model,
    retrievedAt: new Date(retrievedAt).toISOString(), sourceIssuedAt: null, dataset: 'Fixture forecast', sourceVersion: 'fixture model run', providerRequestVersion: 'fixture-v1',
    grid: { coordinates: { latitude: 38.8, longitude: -121.25 }, elevationM: 35 },
    units: { temperature: '°C' as const, dewPoint: '°C' as const, windSpeed: 'm/s' as const, precipitationProbability: '%' as const },
    intervalSemantics: 'temperature, dew point and wind are valid-time instants; precipitation probability is the preceding hour ending at validTime' as const,
    points: validTimes.map(time => ({ validTime: new Date(time).toISOString(), temperatureC, dewPointC: 10, windSpeedMs: 3, precipitationProbabilityPercent: 60 })) };
}
const quality = (value: number | null, status: 'accepted' | 'suspect' | 'rejected' | 'missing' = value === null ? 'missing' : 'accepted') => ({ value, status, flags: status === 'accepted' || status === 'missing' ? [] : ['fixture-flag'] });
function observation(targetKey: string, retrievedAt: number, validTimes: number[], mutate?: (item: ReturnType<typeof point>, index: number) => void) {
  const points = validTimes.map((time, index) => { const value = point(time, index); mutate?.(value, index); return value; });
  return { schemaVersion: 'observation-verification-snapshot-v1' as const, targetKey, station: input.station, provider: 'NOAA', dataset: 'bounded fixture',
    retrievedAt: new Date(retrievedAt).toISOString(), sourceIssuedAt: null, sourceVersion: 'fixture', adapterVersion: 'fixture-v1',
    units: { temperature: '°C' as const, dewPoint: '°C' as const, windSpeed: 'm/s' as const, precipitation: 'mm' as const },
    timeSemantics: 'hourly values; precipitation preceding hour', points };
}
function point(time: number, index: number) {
  return { validTime: new Date(time).toISOString(), sourceTime: new Date(time).toISOString(), sourceId: `https://api.weather.gov/stations/USW00000001/observations/${time}`,
    temperatureC: quality(18), dewPointC: quality(9), windSpeedMs: quality(4),
    precipitationMm: quality(index % 2 ? 0 : 1), precipitationInterval: { start: new Date(time - HOUR).toISOString(), end: new Date(time).toISOString(), completeness: 'complete' as const } };
}

test('immutable archive deduplicates identical snapshots and never stores non-contract weather fields', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30 });
  try {
    const place = repository.registerPlace('installation', input);
    const snapshot = forecast(place.targetKey, now, [now + HOUR]);
    assert.equal(repository.addForecastSnapshot(snapshot).inserted, true);
    assert.equal(repository.addForecastSnapshot(structuredClone(snapshot)).inserted, false);
    assert.deepEqual(repository.usage(), { memberships: 1, targets: 1, forecastSnapshots: 1, forecastPoints: 1, observationSnapshots: 0, observationPoints: 0 });
    assert.throws(() => repository.addForecastSnapshot({ ...snapshot, points: [{ ...snapshot.points[0]!, wbgtC: 40 }] } as never));
    assert.throws(() => repository.addForecastSnapshot({ ...snapshot, retrievedAt: new Date(now + 2 * HOUR).toISOString() }));
  } finally { repository.close(); }
});

test('scorecard reports explicit preliminary gate, errors, rain skill and paired candidate evidence', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30 });
  try {
    const place = repository.registerPlace('installation', input);
    const times = Array.from({ length: 32 }, (_, index) => START + 3 * HOUR + index * 6 * HOUR);
    repository.addForecastSnapshot(forecast(place.targetKey, START, times));
    const candidate = { id: 'open-meteo-gfs', role: 'candidate' as const, provider: 'Open-Meteo', requestedModel: 'gfs_seamless', constituentModel: null };
    repository.addForecastSnapshot(forecast(place.targetKey, START, times, 19, candidate));
    now = times.at(-1)! + HOUR;
    repository.addObservationSnapshot(observation(place.targetKey, now, times));
    const scorecard = repository.scorecard(place.targetKey);
    assert.equal(scorecard.status, 'preliminary');
    assert.equal(scorecard.evidence.archivedSnapshots, 2); assert.equal(scorecard.evidence.observationSnapshots, 1);
    assert.equal(scorecard.evidence.distinctValidDays, 8); assert.equal(scorecard.models.length, 2);
    const baseline = scorecard.models.find(model => model.model.role === 'baseline')!;
    const all = baseline.horizons.flatMap(horizon => [horizon.all]);
    assert.equal(all.reduce((sum, metric) => sum + metric.temperature.paired, 0), 32);
    const temperature = all.find(metric => metric.temperature.paired)!.temperature;
    assert.equal(temperature.mae, 2); assert.equal(temperature.bias, 2);
    const rain = all.reduce((total, metric) => ({ paired: total.paired + metric.rain.paired, misses: total.misses + metric.rain.misses,
      falseAlarms: total.falseAlarms + metric.rain.falseAlarms }), { paired: 0, misses: 0, falseAlarms: 0 });
    assert.deepEqual(rain, { paired: 32, misses: 0, falseAlarms: 16 });
    const candidateScore = scorecard.models.find(model => model.model.role === 'candidate')!;
    assert.equal(candidateScore.pairedWithBaselineTimestamps, 32);
    assert.equal(candidateScore.pairedWithBaseline!.horizons.reduce((sum, horizon) => sum + horizon.allCases, 0), 32);
    assert.equal(candidateScore.pairedWithBaseline!.horizons.reduce((sum, horizon) => sum + horizon.baseline.temperature.paired, 0), 32);
    assert.equal(candidateScore.pairedWithBaseline!.horizons.reduce((sum, horizon) => sum + horizon.candidate.temperature.paired, 0), 32);
    assert.deepEqual(scorecard.thresholds, { preliminaryMinimumPairs: 30, preliminaryMinimumDistinctDays: 7,
      rainEventThresholdMm: 0.1, rainEventComparison: 'strictly_greater_than', rainDecisionPercent: 50 });
    assert.equal(scorecard.evidence.selectionPolicy.includes('no candidate winner'), true);
  } finally { repository.close(); }
});

test('rain events use the provider-defined strict more-than 0.1 mm preceding-hour threshold', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30 });
  try {
    const place = repository.registerPlace('installation', input);
    const times = [START + HOUR, START + 2 * HOUR];
    repository.addForecastSnapshot(forecast(place.targetKey, START, times));
    now = START + 3 * HOUR;
    repository.addObservationSnapshot(observation(place.targetKey, now, times, (value, index) => {
      value.precipitationMm = quality(index === 0 ? 0.1 : 0.100_001);
    }));
    const rain = repository.scorecard(place.targetKey).models[0]!.horizons[0]!.all.rain;
    assert.equal(rain.paired, 2); assert.equal(rain.observedEvents, 1);
    assert.equal(rain.falseAlarms, 1); assert.equal(rain.misses, 0);
  } finally { repository.close(); }
});

test('scorecard fails explicitly before loading more than its bounded deduplicated row budget', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30, maxScorecardRows: 3 });
  try {
    const place = repository.registerPlace('installation', input);
    const times = [START + HOUR, START + 2 * HOUR];
    repository.addForecastSnapshot(forecast(place.targetKey, START, times));
    now = START + 3 * HOUR;
    repository.addObservationSnapshot(observation(place.targetKey, now, times));
    const scorecard = repository.scorecard(place.targetKey);
    assert.equal(scorecard.status, 'insufficient_evidence');
    assert.equal(scorecard.evidence.reportOverflow, true);
    assert.equal(scorecard.evidence.reportRowLimit, 3);
    assert.equal(scorecard.evidence.reportRowsLoaded, 0);
    assert.equal(scorecard.evidence.storedForecastPoints, 2);
    assert.equal(scorecard.evidence.storedObservationPoints, 2);
    assert.equal(scorecard.models.length, 0);
    assert.match(scorecard.reason, /no silent sampling/i);
  } finally { repository.close(); }
});

test('scorecard ranks repeated forecast snapshots in SQL before loading compact rows', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30, maxScorecardRows: 2 });
  try {
    const place = repository.registerPlace('installation', input);
    const validTime = START + 5 * HOUR;
    repository.addForecastSnapshot(forecast(place.targetKey, START, [validTime], 30));
    now = START + 2 * HOUR;
    repository.addForecastSnapshot(forecast(place.targetKey, now, [validTime], 19));
    now = START + 6 * HOUR;
    repository.addObservationSnapshot(observation(place.targetKey, now, [validTime]));
    const scorecard = repository.scorecard(place.targetKey);
    assert.equal(scorecard.evidence.storedForecastPoints, 2);
    assert.equal(scorecard.evidence.deduplicatedForecastPoints, 1);
    assert.equal(scorecard.evidence.reportRowsLoaded, 2);
    assert.equal(scorecard.models[0]!.horizons[0]!.all.temperature.mae, 1);
  } finally { repository.close(); }
});

test('inactive installation membership stops scheduling and matching without unbounded archive cascade', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30 });
  try {
    const place = repository.registerPlace('expired-installation', input);
    repository.addForecastSnapshot(forecast(place.targetKey, now, [now + HOUR]));
    assert.deepEqual(repository.pruneInactiveInstallations(id => id !== 'expired-installation'), { checked: 1, removedMemberships: 1 });
    assert.equal(repository.acquireDueTarget('worker'), null);
    assert.equal(repository.targetsForLocation(input.location.latitude, input.location.longitude, input.location.timezone).length, 0);
    assert.deepEqual(repository.usage(), { memberships: 0, targets: 1, forecastSnapshots: 1, forecastPoints: 1, observationSnapshots: 0, observationPoints: 0 });
    now += 31 * DAY;
    const cleanup = repository.cleanup();
    assert.equal(cleanup.deleted.forecasts, 1); assert.equal(cleanup.deleted.orphanTargets, 1);
    assert.equal(repository.usage().targets, 0);
  } finally { repository.close(); }
});

test('forecast sanitizer binds normalized target identity and retains request identity and source elevation', () => {
  const repository = new VerificationRepository({ path: ':memory:', clock: () => START, retentionDays: 30 });
  try {
    const normalized = { ...input, location: { ...input.location, id: 'point:38.7500:-121.2900' } };
    const place = repository.registerPlace('installation', normalized);
    const requestLocation = { ...input.location, id: 'legacy,38.75,-121.29' };
    const raw = { location: requestLocation, provenance: { provider: 'Open-Meteo', dataset: 'Fixture forecast', retrievedAt: new Date(START).toISOString(),
      sourceIssuedAt: null, sourceCoordinates: { latitude: 38.8, longitude: -121.25 }, sourceElevationM: 73 },
      hours: [{ time: new Date(START + HOUR).toISOString(), temperatureC: 20, dewPointC: 10, windSpeedMs: 3, precipitationProbability: 20 }] };
    const snapshot = sanitizeForecast(place, VERIFICATION_BASELINE_MODEL, raw, 'fixture-v1');
    assert.equal(snapshot.location.id, normalized.location.id);
    assert.equal(snapshot.requestLocation.id, requestLocation.id);
    assert.equal(snapshot.grid.elevationM, 73);
    assert.throws(() => sanitizeForecast(place, VERIFICATION_BASELINE_MODEL, { ...raw,
      location: { ...raw.location, latitude: raw.location.latitude + 0.01 } }, 'fixture-v1'));
  } finally { repository.close(); }
});

test('quality flags, null values and mismatched precipitation periods are counted, never scored', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30 });
  try {
    const place = repository.registerPlace('installation', input);
    const times = [START + HOUR, START + 2 * HOUR, START + 3 * HOUR, START + 4 * HOUR];
    repository.addForecastSnapshot(forecast(place.targetKey, START, times));
    now = START + 5 * HOUR;
    repository.addObservationSnapshot(observation(place.targetKey, now, times, (value, index) => {
      if (index === 0) value.temperatureC = quality(18, 'suspect');
      if (index === 1) value.temperatureC = quality(null, 'missing');
      if (index === 2) {
        value.sourceTime = new Date(times[index]! - 30 * 60_000).toISOString();
        value.precipitationInterval = { ...value.precipitationInterval, start: new Date(times[index]! - 90 * 60_000).toISOString(), end: value.sourceTime };
      }
      if (index === 3) value.precipitationMm = quality(0, 'rejected');
    }));
    const metric = repository.scorecard(place.targetKey).models[0]!.horizons[0]!.all;
    assert.deepEqual(metric.temperature, { eligibleForecasts: 4, paired: 2, missingObservation: 1, excludedQuality: 1, mae: 2, bias: 2 });
    assert.equal(metric.rain.paired, 2); assert.equal(metric.rain.incompatibleInterval, 1); assert.equal(metric.rain.excludedQuality, 1);
  } finally { repository.close(); }
});

test('leases fence scheduling, installation limit is five and removing final member deletes its archive', () => {
  let now = START;
  const repository = new VerificationRepository({ path: ':memory:', clock: () => now, retentionDays: 30, maxTrackedPlaces: 10 });
  try {
    for (let index = 0; index < 5; index++) repository.registerPlace('installation', { ...input, placeId: `place${index}`, location: { ...input.location, id: `place:${index}` } });
    assert.throws(() => repository.registerPlace('installation', { ...input, placeId: 'sixth', location: { ...input.location, id: 'place:sixth' } }));
    const lease = repository.acquireDueTarget('worker', 1000)!;
    assert.equal(repository.acquireDueTarget('peer', 1000)?.target.targetKey === lease.target.targetKey, false);
    assert.equal(repository.leaseActive(lease), true);
    assert.equal(repository.finishTarget(lease, now + HOUR), true);
    const place = repository.place('installation', lease.target.placeId)!;
    repository.addForecastSnapshot(forecast(place.targetKey, now, [now + HOUR]));
    assert.equal(repository.removePlace('installation', place.placeId), true);
    assert.equal(repository.place('installation', place.placeId), null);
  } finally { repository.close(); }
});
