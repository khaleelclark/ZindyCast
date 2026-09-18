import { z } from 'zod';
import { CoordinatesSchema, LocationSchema } from './location';

const iso = z.iso.datetime();
const count = z.number().int().nonnegative().max(10_000_000);
const finiteNullable = z.number().finite().nullable();
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const Coordinates = CoordinatesSchema.strict();

/** Import the shared location leaf directly so barrel re-exports cannot introduce
 * an ESM initialization cycle. Verification adds a bounded normalized identifier. */
export const VerificationLocationSchema = LocationSchema.extend({
  id,
  name: z.string().trim().min(1).max(160),
  admin1: z.string().max(100).optional(),
  admin2: z.string().max(100).optional(),
  country: z.string().max(100),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return !/^[+-]/.test(value); }
    catch { return false; }
  }, 'Unknown IANA time zone'),
}).strict();
export type VerificationLocation = z.infer<typeof VerificationLocationSchema>;

export const VerificationStationSchema = z.object({
  id: z.string().min(1).max(32).regex(/^[A-Z0-9-]+$/),
  name: z.string().min(1).max(200),
  coordinates: Coordinates,
  elevationM: z.number().finite().min(-1000).max(10000).nullable(),
  distanceKm: z.number().finite().nonnegative().max(1000),
  elevationDifferenceM: z.number().finite().min(-11000).max(11000).nullable(),
  selectionVersion: z.string().min(1).max(80),
}).strict();
export type VerificationStation = z.infer<typeof VerificationStationSchema>;

export const VerificationModelSchema = z.object({
  id: id.max(80),
  role: z.enum(['baseline', 'candidate']),
  provider: z.string().min(1).max(80),
  requestedModel: z.string().min(1).max(120),
  constituentModel: z.string().min(1).max(160).nullable(),
}).strict();
export type VerificationModel = z.infer<typeof VerificationModelSchema>;

export const VerificationPlaceInputSchema = z.object({
  placeId: id,
  optedIn: z.literal(true),
  location: VerificationLocationSchema,
  station: VerificationStationSchema,
}).strict();
export type VerificationPlaceInput = z.infer<typeof VerificationPlaceInputSchema>;

export const VerificationPlaceSchema = VerificationPlaceInputSchema.extend({
  targetKey: z.string().length(64).regex(/^[a-f0-9]+$/),
  createdAt: z.number().int().nonnegative(),
  nextCaptureAt: z.number().int().nonnegative(),
}).strict();
export type VerificationPlace = z.infer<typeof VerificationPlaceSchema>;

export const ForecastVerificationPointSchema = z.object({
  validTime: iso,
  temperatureC: z.number().finite().min(-150).max(80).nullable(),
  dewPointC: z.number().finite().min(-150).max(80).nullable(),
  windSpeedMs: z.number().finite().min(0).max(200).nullable(),
  precipitationProbabilityPercent: z.number().finite().min(0).max(100).nullable(),
}).strict();
export type ForecastVerificationPoint = z.infer<typeof ForecastVerificationPointSchema>;

export const ForecastVerificationSnapshotSchema = z.object({
  schemaVersion: z.literal('forecast-verification-snapshot-v1'),
  targetKey: z.string().length(64).regex(/^[a-f0-9]+$/),
  location: VerificationLocationSchema,
  requestLocation: LocationSchema.strict(),
  model: VerificationModelSchema,
  retrievedAt: iso,
  sourceIssuedAt: iso.nullable(),
  dataset: z.string().min(1).max(200),
  sourceVersion: z.string().min(1).max(160).nullable(),
  providerRequestVersion: z.string().min(1).max(120),
  grid: z.object({ coordinates: Coordinates, elevationM: z.number().finite().min(-1000).max(10000).nullable() }).strict(),
  units: z.object({ temperature: z.literal('°C'), dewPoint: z.literal('°C'), windSpeed: z.literal('m/s'), precipitationProbability: z.literal('%') }).strict(),
  intervalSemantics: z.literal('temperature, dew point and wind are valid-time instants; precipitation probability is the preceding hour ending at validTime'),
  points: z.array(ForecastVerificationPointSchema).min(1).max(384),
}).strict().superRefine((snapshot, context) => {
  const retrieved = Date.parse(snapshot.retrievedAt);
  if (snapshot.sourceIssuedAt && Date.parse(snapshot.sourceIssuedAt) > retrieved) {
    context.addIssue({ code: 'custom', message: 'Source issue time cannot follow retrieval.' });
  }
  if (snapshot.points.some((point, index) => Date.parse(point.validTime) <= retrieved ||
      (index > 0 && Date.parse(point.validTime) <= Date.parse(snapshot.points[index - 1]!.validTime)))) {
    context.addIssue({ code: 'custom', message: 'Forecast points must be strictly ordered and received before valid time.' });
  }
});
export type ForecastVerificationSnapshot = z.infer<typeof ForecastVerificationSnapshotSchema>;

export const ObservationQualitySchema = z.object({
  value: finiteNullable,
  status: z.enum(['accepted', 'suspect', 'rejected', 'missing']),
  flags: z.array(z.string().max(80)).max(16),
}).strict().superRefine((cell, context) => {
  if ((cell.status === 'accepted' && cell.value === null) || (cell.status === 'missing' && cell.value !== null)) {
    context.addIssue({ code: 'custom', message: 'Observation value and quality status disagree.' });
  }
});
export type ObservationQuality = z.infer<typeof ObservationQualitySchema>;

export const ObservationVerificationPointSchema = z.object({
  validTime: iso,
  sourceTime: iso.nullable(),
  sourceId: z.url().max(1000).nullable(),
  temperatureC: ObservationQualitySchema.safeExtend({ value: z.number().finite().min(-150).max(80).nullable() }),
  dewPointC: ObservationQualitySchema.safeExtend({ value: z.number().finite().min(-150).max(80).nullable() }),
  windSpeedMs: ObservationQualitySchema.safeExtend({ value: z.number().finite().min(0).max(200).nullable() }),
  precipitationMm: ObservationQualitySchema.safeExtend({ value: z.number().finite().min(0).max(3000).nullable() }),
  precipitationInterval: z.object({ start: iso, end: iso, completeness: z.enum(['complete', 'partial', 'unknown']) }).strict().nullable(),
}).strict().superRefine((point, context) => {
  const interval = point.precipitationInterval;
  if ((point.sourceTime === null) !== (point.sourceId === null) ||
      (point.precipitationMm.value !== null && interval === null) ||
      (interval && (interval.end !== point.sourceTime || Date.parse(interval.start) >= Date.parse(interval.end)))) {
    context.addIssue({ code: 'custom', message: 'Observation source identity and actual precipitation interval must agree.' });
  }
});
export type ObservationVerificationPoint = z.infer<typeof ObservationVerificationPointSchema>;

export const ObservationVerificationSnapshotSchema = z.object({
  schemaVersion: z.literal('observation-verification-snapshot-v1'),
  targetKey: z.string().length(64).regex(/^[a-f0-9]+$/),
  station: VerificationStationSchema,
  provider: z.string().min(1).max(80),
  dataset: z.string().min(1).max(120),
  retrievedAt: iso,
  sourceIssuedAt: iso.nullable(),
  sourceVersion: z.string().min(1).max(160).nullable(),
  adapterVersion: z.string().min(1).max(120),
  units: z.object({ temperature: z.literal('°C'), dewPoint: z.literal('°C'), windSpeed: z.literal('m/s'), precipitation: z.literal('mm') }).strict(),
  timeSemantics: z.string().min(1).max(300),
  points: z.array(ObservationVerificationPointSchema).min(1).max(744),
}).strict().superRefine((snapshot, context) => {
  const retrieved = Date.parse(snapshot.retrievedAt);
  if (snapshot.sourceIssuedAt && Date.parse(snapshot.sourceIssuedAt) > retrieved) {
    context.addIssue({ code: 'custom', message: 'Source issue time cannot follow retrieval.' });
  }
  if (snapshot.points.some((point, index) => Date.parse(point.validTime) > retrieved ||
      (index > 0 && Date.parse(point.validTime) <= Date.parse(snapshot.points[index - 1]!.validTime)))) {
    context.addIssue({ code: 'custom', message: 'Observation points must be ordered and available no later than retrieval.' });
  }
  const sourceIds = new Set<string>();
  for (const point of snapshot.points) {
    const source = point.sourceTime === null ? null : Date.parse(point.sourceTime);
    const valid = Date.parse(point.validTime);
    if ((source !== null && (source > retrieved || Math.abs(source - valid) > 30 * 60_000)) ||
        (point.sourceId !== null && sourceIds.has(point.sourceId)) ||
        (source === null && (point.temperatureC.value !== null || point.dewPointC.value !== null || point.windSpeedMs.value !== null || point.precipitationMm.value !== null || point.precipitationInterval !== null)) ||
        (point.precipitationInterval && Date.parse(point.precipitationInterval.end) - Date.parse(point.precipitationInterval.start) !== 3_600_000)) {
      context.addIssue({ code: 'custom', message: 'Observation source matching and one-hour accumulation semantics are inconsistent.' });
      break;
    }
    if (point.sourceId !== null) sourceIds.add(point.sourceId);
  }
});
export type ObservationVerificationSnapshot = z.infer<typeof ObservationVerificationSnapshotSchema>;

export const VerificationErrorMetricSchema = z.object({
  eligibleForecasts: count,
  paired: count,
  missingObservation: count,
  excludedQuality: count,
  mae: finiteNullable,
  bias: finiteNullable,
}).strict();
export const VerificationRainMetricSchema = z.object({
  eligibleForecasts: count,
  paired: count,
  missingObservation: count,
  excludedQuality: count,
  incompatibleInterval: count,
  brierScore: finiteNullable,
  misses: count,
  falseAlarms: count,
  observedEvents: count,
  forecastEvents: count,
  reliability: z.array(z.object({ lowerPercent: z.number().int().min(0).max(100), upperPercent: z.number().int().min(0).max(100), forecasts: count, observedEvents: count, observedFrequency: z.number().min(0).max(1).nullable() }).strict()).length(10),
}).strict();
export const VerificationSampleMetricsSchema = z.object({
  timestamps: count,
  temperature: VerificationErrorMetricSchema,
  dewPoint: VerificationErrorMetricSchema,
  windSpeed: VerificationErrorMetricSchema,
  rain: VerificationRainMetricSchema,
}).strict();
export const VerificationHorizonScoreSchema = z.object({
  horizon: z.enum(['0-6h', '6-24h', '24-72h', '72-168h', '168-384h']),
  targetLeadHours: z.number().positive(),
  all: VerificationSampleMetricsSchema,
  holdout: VerificationSampleMetricsSchema,
}).strict();
export const VerificationModelScoreSchema = z.object({
  model: VerificationModelSchema,
  horizons: z.array(VerificationHorizonScoreSchema).length(5),
  pairedWithBaselineTimestamps: count,
  pairedWithBaseline: z.object({
    policy: z.literal('candidate and baseline scored on identical valid-time and horizon cases; nullable forecast fields remain visible as ineligible'),
    horizons: z.array(z.object({
      horizon: VerificationHorizonScoreSchema.shape.horizon,
      allCases: count,
      holdoutCases: count,
      baseline: VerificationSampleMetricsSchema,
      candidate: VerificationSampleMetricsSchema,
      baselineHoldout: VerificationSampleMetricsSchema,
      candidateHoldout: VerificationSampleMetricsSchema,
    }).strict()).length(5),
  }).strict().nullable(),
}).strict();
export const VerificationScorecardSchema = z.object({
  status: z.enum(['pending', 'insufficient_evidence', 'preliminary']),
  reason: z.string().min(1).max(300),
  place: VerificationPlaceSchema,
  generatedAt: iso,
  units: z.object({ temperatureError: z.literal('°C'), dewPointError: z.literal('°C'), windSpeedError: z.literal('m/s'), brierScore: z.literal('unitless') }).strict(),
  thresholds: z.object({ preliminaryMinimumPairs: z.literal(30), preliminaryMinimumDistinctDays: z.literal(7),
    rainEventThresholdMm: z.literal(0.1), rainEventComparison: z.literal('strictly_greater_than'), rainDecisionPercent: z.literal(50) }).strict(),
  evidence: z.object({
    archivedSnapshots: count,
    observationSnapshots: count,
    storedForecastPoints: count,
    storedObservationPoints: count,
    reportRowLimit: z.number().int().min(1).max(50_000),
    reportRowsLoaded: count.max(50_000),
    reportOverflow: z.boolean(),
    deduplicatedForecastPoints: count,
    distinctValidDays: count,
    holdoutPercent: z.literal(20),
    holdoutPolicy: z.literal('sha256(targetKey + validTime) first-byte modulo 5 equals 0; identical across models'),
    dedupePolicy: z.literal('one forecast per model, valid time and horizon bucket; closest retrieval lead to fixed target, then earliest retrieval and snapshot id'),
    observationPolicy: z.literal('latest archived station snapshot per forecast valid time; nearest station instant within 30 minutes, one-to-one; only accepted QC values score; precipitation requires the exact complete forecast-hour interval'),
    selectionPolicy: z.literal('baseline retained; no candidate winner or weighting selected by this scorecard'),
  }).strict(),
  models: z.array(VerificationModelScoreSchema).max(3),
}).strict();
export type VerificationScorecard = z.infer<typeof VerificationScorecardSchema>;

export const VerificationPlacesResponseSchema = z.object({ status: z.literal('success'), places: z.array(VerificationPlaceSchema).max(5) }).strict();
export const VerificationPlaceResponseSchema = z.object({ status: z.literal('success'), place: VerificationPlaceSchema }).strict();
export const VerificationScorecardResponseSchema = z.object({ status: z.literal('success'), scorecard: VerificationScorecardSchema }).strict();
export const VerificationRemoveResponseSchema = z.object({ status: z.literal('success') }).strict();
