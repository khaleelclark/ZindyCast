import { createHash } from 'node:crypto';
import {
  VerificationScorecardSchema,
  type VerificationModel,
  type VerificationPlace,
  type VerificationScorecard,
} from '../../contracts/src/verification.js';

export interface StoredForecastPoint {
  snapshotId: string;
  model: VerificationModel;
  retrievedAt: number;
  validTime: number;
  temperatureC: number | null;
  dewPointC: number | null;
  windSpeedMs: number | null;
  precipitationProbabilityPercent: number | null;
}

export interface StoredObservationPoint {
  snapshotId: string;
  retrievedAt: number;
  validTime: number;
  temperatureC: number | null;
  temperatureStatus: 'accepted' | 'suspect' | 'rejected' | 'missing';
  dewPointC: number | null;
  dewPointStatus: 'accepted' | 'suspect' | 'rejected' | 'missing';
  windSpeedMs: number | null;
  windStatus: 'accepted' | 'suspect' | 'rejected' | 'missing';
  precipitationMm: number | null;
  precipitationStatus: 'accepted' | 'suspect' | 'rejected' | 'missing';
  precipitationStart: number | null;
  precipitationEnd: number | null;
  precipitationCompleteness: 'complete' | 'partial' | 'unknown' | null;
}

interface Horizon { name: '0-6h' | '6-24h' | '24-72h' | '72-168h' | '168-384h'; minimum: number; maximum: number; target: number }
const HORIZONS: readonly Horizon[] = [
  { name: '0-6h', minimum: 0, maximum: 6, target: 3 },
  { name: '6-24h', minimum: 6, maximum: 24, target: 12 },
  { name: '24-72h', minimum: 24, maximum: 72, target: 48 },
  { name: '72-168h', minimum: 72, maximum: 168, target: 120 },
  { name: '168-384h', minimum: 168, maximum: 384, target: 240 },
] as const;

function horizonFor(leadHours: number): Horizon | null {
  return HORIZONS.find((h, index) => leadHours > h.minimum && (index === 0 ? leadHours <= h.maximum : leadHours <= h.maximum)) ?? null;
}

function holdout(targetKey: string, validTime: number): boolean {
  return createHash('sha256').update(`${targetKey}${new Date(validTime).toISOString()}`).digest()[0]! % 5 === 0;
}

function reliability() {
  return Array.from({ length: 10 }, (_, index) => ({
    lowerPercent: index * 10,
    upperPercent: (index + 1) * 10,
    forecasts: 0,
    observedEvents: 0,
    observedFrequency: null as number | null,
  }));
}

function emptyError() {
  return { eligibleForecasts: 0, paired: 0, missingObservation: 0, excludedQuality: 0, mae: null as number | null, bias: null as number | null };
}
function emptyRain() {
  return { eligibleForecasts: 0, paired: 0, missingObservation: 0, excludedQuality: 0, incompatibleInterval: 0,
    brierScore: null as number | null, misses: 0, falseAlarms: 0, observedEvents: 0, forecastEvents: 0, reliability: reliability() };
}

type Selected = StoredForecastPoint & { horizon: Horizon };
function selectForecasts(points: readonly StoredForecastPoint[]): Selected[] {
  const selected = new Map<string, Selected>();
  for (const point of points) {
    const lead = (point.validTime - point.retrievedAt) / 3_600_000;
    const horizon = horizonFor(lead);
    if (!horizon || point.validTime <= point.retrievedAt) continue;
    const key = `${point.model.id}\0${point.validTime}\0${horizon.name}`;
    const candidate = { ...point, horizon };
    const current = selected.get(key);
    const delta = Math.abs(lead - horizon.target);
    const currentLead = current ? (current.validTime - current.retrievedAt) / 3_600_000 : 0;
    const currentDelta = current ? Math.abs(currentLead - horizon.target) : Infinity;
    if (!current || delta < currentDelta || (delta === currentDelta && (point.retrievedAt < current.retrievedAt ||
      (point.retrievedAt === current.retrievedAt && point.snapshotId < current.snapshotId)))) selected.set(key, candidate);
  }
  return [...selected.values()].sort((a, b) => a.validTime - b.validTime || a.model.id.localeCompare(b.model.id));
}

function newestObservations(points: readonly StoredObservationPoint[]): Map<number, StoredObservationPoint> {
  const result = new Map<number, StoredObservationPoint>();
  for (const point of points) {
    const current = result.get(point.validTime);
    if (!current || point.retrievedAt > current.retrievedAt || (point.retrievedAt === current.retrievedAt && point.snapshotId > current.snapshotId)) {
      result.set(point.validTime, point);
    }
  }
  return result;
}

function sampleMetrics(points: readonly Selected[], observations: ReadonlyMap<number, StoredObservationPoint>) {
  const temperature = emptyError(), dewPoint = emptyError(), windSpeed = emptyError(), rain = emptyRain();
  const sums = { temperatureAbs: 0, temperature: 0, dewPointAbs: 0, dewPoint: 0, windSpeedAbs: 0, windSpeed: 0, brier: 0 };
  const error = (forecast: number | null, observation: StoredObservationPoint | undefined, value: keyof Pick<StoredObservationPoint, 'temperatureC' | 'dewPointC' | 'windSpeedMs'>,
    status: keyof Pick<StoredObservationPoint, 'temperatureStatus' | 'dewPointStatus' | 'windStatus'>,
    metric: ReturnType<typeof emptyError>, abs: 'temperatureAbs' | 'dewPointAbs' | 'windSpeedAbs', bias: 'temperature' | 'dewPoint' | 'windSpeed') => {
    if (forecast === null) return;
    metric.eligibleForecasts++;
    if (!observation || observation[value] === null || observation[status] === 'missing') { metric.missingObservation++; return; }
    if (observation[status] !== 'accepted') { metric.excludedQuality++; return; }
    const difference = forecast - (observation[value] as number);
    metric.paired++; sums[abs] += Math.abs(difference); sums[bias] += difference;
  };
  for (const point of points) {
    const observation = observations.get(point.validTime);
    error(point.temperatureC, observation, 'temperatureC', 'temperatureStatus', temperature, 'temperatureAbs', 'temperature');
    error(point.dewPointC, observation, 'dewPointC', 'dewPointStatus', dewPoint, 'dewPointAbs', 'dewPoint');
    error(point.windSpeedMs, observation, 'windSpeedMs', 'windStatus', windSpeed, 'windSpeedAbs', 'windSpeed');
    if (point.precipitationProbabilityPercent !== null) {
      rain.eligibleForecasts++;
      if (!observation || observation.precipitationMm === null || observation.precipitationStatus === 'missing') rain.missingObservation++;
      else if (observation.precipitationStatus !== 'accepted') rain.excludedQuality++;
      else if (observation.precipitationCompleteness !== 'complete' || observation.precipitationStart !== point.validTime - 3_600_000 || observation.precipitationEnd !== point.validTime) rain.incompatibleInterval++;
      else {
        const probability = point.precipitationProbabilityPercent / 100;
        // Open-Meteo defines hourly precipitation_probability as the chance of
        // more than 0.1 mm during the preceding hour (not the 1 mm climate
        // wet-day threshold): https://open-meteo.com/en/docs
        const event = observation.precipitationMm > 0.1 ? 1 : 0;
        const forecastEvent = point.precipitationProbabilityPercent >= 50;
        rain.paired++; sums.brier += (probability - event) ** 2;
        rain.observedEvents += event;
        rain.forecastEvents += forecastEvent ? 1 : 0;
        if (event && !forecastEvent) rain.misses++;
        if (!event && forecastEvent) rain.falseAlarms++;
        const bin = Math.min(9, Math.floor(point.precipitationProbabilityPercent / 10));
        rain.reliability[bin]!.forecasts++;
        rain.reliability[bin]!.observedEvents += event;
      }
    }
  }
  for (const [metric, abs, bias] of [
    [temperature, sums.temperatureAbs, sums.temperature],
    [dewPoint, sums.dewPointAbs, sums.dewPoint],
    [windSpeed, sums.windSpeedAbs, sums.windSpeed],
  ] as const) {
    if (metric.paired) { metric.mae = abs / metric.paired; metric.bias = bias / metric.paired; }
  }
  if (rain.paired) rain.brierScore = sums.brier / rain.paired;
  for (const bin of rain.reliability) if (bin.forecasts) bin.observedFrequency = bin.observedEvents / bin.forecasts;
  return { timestamps: new Set(points.map(point => point.validTime)).size, temperature, dewPoint, windSpeed, rain };
}

export interface ScorecardInput {
  place: VerificationPlace;
  generatedAt: number;
  archivedSnapshots: number;
  observationSnapshots: number;
  forecasts: readonly StoredForecastPoint[];
  observations: readonly StoredObservationPoint[];
  storedForecastPoints?: number;
  storedObservationPoints?: number;
  reportOverflow?: boolean;
  reportRowLimit?: number;
}

export function calculateScorecard(input: ScorecardInput): VerificationScorecard {
  const reportRowLimit = input.reportRowLimit ?? 50_000;
  const selected = selectForecasts(input.forecasts);
  const observations = newestObservations(input.observations);
  const models = new Map<string, VerificationModel>();
  for (const point of selected) models.set(point.model.id, point.model);
  const baseline = [...models.values()].find(model => model.role === 'baseline');
  const baselinePoints = selected.filter(point => point.model.id === baseline?.id);
  const scores = [...models.values()].sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id)).map(model => {
    const modelPoints = selected.filter(point => point.model.id === model.id);
    const pairedHorizons = model.role === 'baseline' || !baseline ? null : HORIZONS.map(horizon => {
      const candidateByTime = new Map(modelPoints.filter(point => point.horizon.name === horizon.name).map(point => [point.validTime, point]));
      const baselineByTime = new Map(baselinePoints.filter(point => point.horizon.name === horizon.name).map(point => [point.validTime, point]));
      const times = [...candidateByTime.keys()].filter(time => baselineByTime.has(time)).sort((a, b) => a - b);
      const baselineCases = times.map(time => baselineByTime.get(time)!);
      const candidateCases = times.map(time => candidateByTime.get(time)!);
      const holdoutTimes = new Set(times.filter(time => holdout(input.place.targetKey, time)));
      return {
        horizon: horizon.name,
        allCases: times.length,
        holdoutCases: holdoutTimes.size,
        baseline: sampleMetrics(baselineCases, observations),
        candidate: sampleMetrics(candidateCases, observations),
        baselineHoldout: sampleMetrics(baselineCases.filter(point => holdoutTimes.has(point.validTime)), observations),
        candidateHoldout: sampleMetrics(candidateCases.filter(point => holdoutTimes.has(point.validTime)), observations),
      };
    });
    return {
      model,
      horizons: HORIZONS.map(horizon => {
        const points = modelPoints.filter(point => point.horizon.name === horizon.name);
        return { horizon: horizon.name, targetLeadHours: horizon.target, all: sampleMetrics(points, observations),
          holdout: sampleMetrics(points.filter(point => holdout(input.place.targetKey, point.validTime)), observations) };
      }),
      pairedWithBaselineTimestamps: pairedHorizons === null ? 0 : new Set(pairedHorizons.flatMap((paired, index) => {
        const horizon = HORIZONS[index]!;
        const baselineTimes = new Set(baselinePoints.filter(point => point.horizon.name === horizon.name).map(point => point.validTime));
        return modelPoints.filter(point => point.horizon.name === horizon.name && baselineTimes.has(point.validTime)).map(point => point.validTime);
      })).size,
      pairedWithBaseline: pairedHorizons === null ? null : {
        policy: 'candidate and baseline scored on identical valid-time and horizon cases; nullable forecast fields remain visible as ineligible' as const,
        horizons: pairedHorizons,
      },
    };
  });
  const baselineScore = scores.find(score => score.model.role === 'baseline');
  const baselineTemperaturePairs = baselineScore?.horizons.reduce((sum, horizon) => sum + horizon.all.temperature.paired, 0) ?? 0;
  const pairedTimes = new Set(selected.filter(point => {
    const observation = observations.get(point.validTime);
    return point.model.role === 'baseline' && observation?.temperatureStatus === 'accepted' && observation.temperatureC !== null;
  }).map(point => point.validTime));
  const days = new Set([...pairedTimes].map(time => new Date(time).toISOString().slice(0, 10))).size;
  const status = input.reportOverflow ? 'insufficient_evidence' : input.archivedSnapshots === 0 || input.observationSnapshots === 0 ? 'pending' :
    baselineTemperaturePairs >= 30 && days >= 7 ? 'preliminary' : 'insufficient_evidence';
  const reason = input.reportOverflow ? `Stored evidence exceeds the ${reportRowLimit.toLocaleString('en-US')}-row scorecard memory bound; no silent sampling or accuracy claim was produced.` :
    status === 'pending' ? 'Forecast or observation snapshots are not yet available.' :
    status === 'preliminary' ? 'The minimum preliminary evidence gate is met; this is not a confidence or superiority claim.' :
    'Fewer than 30 quality-controlled baseline temperature pairs or seven distinct valid days are available.';
  return VerificationScorecardSchema.parse({
    status, reason, place: input.place, generatedAt: new Date(input.generatedAt).toISOString(),
    units: { temperatureError: '°C', dewPointError: '°C', windSpeedError: 'm/s', brierScore: 'unitless' },
    thresholds: { preliminaryMinimumPairs: 30, preliminaryMinimumDistinctDays: 7,
      rainEventThresholdMm: 0.1, rainEventComparison: 'strictly_greater_than', rainDecisionPercent: 50 },
    evidence: {
      archivedSnapshots: input.archivedSnapshots,
      observationSnapshots: input.observationSnapshots,
      storedForecastPoints: input.storedForecastPoints ?? input.forecasts.length,
      storedObservationPoints: input.storedObservationPoints ?? input.observations.length,
      reportRowLimit,
      reportRowsLoaded: input.reportOverflow ? 0 : input.forecasts.length + input.observations.length,
      reportOverflow: input.reportOverflow ?? false,
      deduplicatedForecastPoints: selected.length,
      distinctValidDays: days,
      holdoutPercent: 20,
      holdoutPolicy: 'sha256(targetKey + validTime) first-byte modulo 5 equals 0; identical across models',
      dedupePolicy: 'one forecast per model, valid time and horizon bucket; closest retrieval lead to fixed target, then earliest retrieval and snapshot id',
      observationPolicy: 'latest archived station snapshot per forecast valid time; nearest station instant within 30 minutes, one-to-one; only accepted QC values score; precipitation requires the exact complete forecast-hour interval',
      selectionPolicy: 'baseline retained; no candidate winner or weighting selected by this scorecard',
    },
    models: scores,
  });
}
