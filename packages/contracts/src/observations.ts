import { z } from 'zod';
import { CoordinatesSchema } from './location';

const utcInstant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());

export const ObservationQuerySchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  since: utcInstant,
  until: utcInstant,
  stationLimit: z.number().int().min(1).max(3),
}).superRefine((query, context) => {
  const since = Date.parse(query.since), until = Date.parse(query.until);
  if (since > until || until - since > 7 * 86_400_000) {
    context.addIssue({ code: 'custom', message: 'Observation windows must span zero to seven days.' });
  }
});
export type ObservationQuery = z.infer<typeof ObservationQuerySchema>;

export const ObservationQualityControlSchema = z.enum(['Z', 'C', 'S', 'V', 'X', 'Q', 'G', 'B', 'T']);
export type ObservationQualityControl = z.infer<typeof ObservationQualityControlSchema>;
export const observationQualityMeanings = Object.freeze({
  Z: 'preliminary_no_qc',
  C: 'coarse_pass_level_1',
  S: 'screened_pass_levels_1_2',
  V: 'verified_pass_levels_1_2_3',
  X: 'rejected_failed_level_1',
  Q: 'questioned_failed_level_2_or_3',
  G: 'subjective_good',
  B: 'subjective_bad',
  T: 'air_temperature_returned_when_virtual_temperature_unavailable',
} as const satisfies Record<ObservationQualityControl, string>);

export const ObservationQualityMeaningSchema = z.enum(Object.values(observationQualityMeanings));
export const ObservationValueSchema = z.strictObject({
  value: z.number().finite().nullable(),
  qualityControl: ObservationQualityControlSchema.nullable(),
  qualityMeaning: ObservationQualityMeaningSchema.nullable(),
}).superRefine((measurement, context) => {
  if (measurement.qualityControl === null ? measurement.qualityMeaning !== null :
      observationQualityMeanings[measurement.qualityControl] !== measurement.qualityMeaning) {
    context.addIssue({ code: 'custom', message: 'Quality code and meaning must agree.' });
  }
});
export type ObservationValue = z.infer<typeof ObservationValueSchema>;

export const observationFields = [
  ['temperature', 'temperatureC', 'wmoUnit:degC'],
  ['dewpoint', 'dewPointC', 'wmoUnit:degC'],
  ['relativeHumidity', 'humidityPercent', 'wmoUnit:percent'],
  ['windSpeed', 'windSpeedMs', 'wmoUnit:m_s-1'],
  ['windGust', 'windGustMs', 'wmoUnit:m_s-1'],
  ['windDirection', 'windDirectionDeg', 'wmoUnit:degree_(angle)'],
  ['barometricPressure', 'barometricPressurePa', 'wmoUnit:Pa'],
  ['visibility', 'visibilityM', 'wmoUnit:m'],
  ['precipitationLastHour', 'precipitationLastHourMm', 'wmoUnit:mm'],
] as const;
export type ObservationField = typeof observationFields[number][1];
export const observationFieldNames = observationFields.map(([, local]) => local) as readonly ObservationField[];
const measurements = Object.fromEntries(observationFieldNames.map(field => [field, ObservationValueSchema])) as
  Record<ObservationField, typeof ObservationValueSchema>;

export const StationObservationSchema = z.strictObject({
  sourceId: z.url().refine(value => new URL(value).origin === 'https://api.weather.gov'),
  time: utcInstant,
  textDescription: z.string().max(500).nullable(),
  measurements: z.strictObject(measurements),
  missingFields: z.array(z.enum(observationFieldNames)).max(observationFieldNames.length),
}).superRefine((observation, context) => {
  const missing = observationFieldNames.filter(field => observation.measurements[field].value === null);
  if (JSON.stringify(missing) !== JSON.stringify(observation.missingFields)) {
    context.addIssue({ code: 'custom', message: 'Observation missing fields must match null measurements.' });
  }
});
export type StationObservation = z.infer<typeof StationObservationSchema>;

export function observationDistanceKm(a: z.infer<typeof CoordinatesSchema>, b: z.infer<typeof CoordinatesSchema>): number {
  const radians = Math.PI / 180;
  const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2 +
    Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) *
    Math.sin((b.longitude - a.longitude) * radians / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export const ObservationStationSchema = z.strictObject({
  stationId: z.string().regex(/^[A-Za-z0-9]{1,16}$/),
  name: z.string().min(1).max(200),
  coordinates: CoordinatesSchema,
  elevationM: z.number().finite().min(-1000).max(10_000).nullable(),
  distanceKm: z.number().finite().min(0).max(20_050),
  sourceUrl: z.url().refine(value => new URL(value).origin === 'https://api.weather.gov'),
  latestObservationTime: utcInstant.nullable(),
  observationHistoryTruncated: z.boolean().default(false),
  observations: z.array(StationObservationSchema).max(500),
}).superRefine((station, context) => {
  if (station.latestObservationTime !== (station.observations[0]?.time ?? null) ||
      station.observations.some((observation, index) => index > 0 && observation.time >= station.observations[index - 1].time)) {
    context.addIssue({ code: 'custom', message: 'Station observations must be unique and newest first.' });
  }
});
export type ObservationStation = z.infer<typeof ObservationStationSchema>;

export const ObservationsDataSchema = z.strictObject({
  query: ObservationQuerySchema,
  stations: z.array(ObservationStationSchema).max(3),
  candidateCount: z.number().int().min(0).max(5),
  candidateSetTruncated: z.boolean(),
  provider: z.literal('NWS'),
  dataset: z.literal('NWS API station observations (MADIS ingest)'),
  classification: z.literal('observed'),
  retrievedAt: utcInstant,
  stationListSourceUrl: z.url().refine(value => new URL(value).origin === 'https://api.weather.gov'),
  selectionPolicy: z.literal('distance-ranked candidates only; no automatic representativeness selection'),
  stationContinuity: z.literal('observations remain grouped by station; no cross-station splice'),
  intervalSemantics: z.literal('station instants; precipitationLastHourMm is the reported preceding-hour accumulation ending at observation time'),
  units: z.strictObject(Object.fromEntries(observationFields.map(([, local, unit]) => [local, z.literal(unit)])) as
    Record<ObservationField, z.ZodLiteral<string>>),
  qualityControlSourceUrl: z.literal('https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml'),
  attribution: z.string().min(1),
}).superRefine((data, context) => {
  const requested = { latitude: data.query.latitude, longitude: data.query.longitude };
  const stationListUrl = new URL(data.stationListSourceUrl);
  if (!/^\/gridpoints\/[A-Z0-9]+\/\d+,\d+\/stations$/.test(stationListUrl.pathname) ||
      stationListUrl.searchParams.get('limit') !== '5' || [...stationListUrl.searchParams.keys()].some(key => key !== 'limit') ||
      (data.candidateCount === 5 && !data.candidateSetTruncated)) {
    context.addIssue({ code: 'custom', message: 'Station candidate source or bounded completeness is inconsistent.' });
  }
  const seen = new Set<string>();
  data.stations.forEach((station, index) => {
    const previous = data.stations[index - 1];
    if (seen.has(station.stationId) || Math.abs(station.distanceKm - observationDistanceKm(requested, station.coordinates)) > 1e-8 ||
        (previous && (previous.distanceKm > station.distanceKm ||
          (previous.distanceKm === station.distanceKm && previous.stationId >= station.stationId)))) {
      context.addIssue({ code: 'custom', message: 'Station identity, distance, or ordering is inconsistent.' });
    }
    for (const observation of station.observations) {
      if (!new URL(observation.sourceId).pathname.startsWith(`/stations/${station.stationId}/observations/`) ||
          observation.time < data.query.since || observation.time > data.query.until) {
        context.addIssue({ code: 'custom', message: 'Observation time falls outside the requested window.' });
      }
    }
    if (new URL(station.sourceUrl).pathname !== `/stations/${station.stationId}`) {
      context.addIssue({ code: 'custom', message: 'Station source URL does not match its identity.' });
    }
    seen.add(station.stationId);
  });
  if (data.stations.length > data.query.stationLimit || data.stations.length > data.candidateCount) {
    context.addIssue({ code: 'custom', message: 'Station result exceeds the bounded candidate set.' });
  }
});
export type ObservationsData = z.infer<typeof ObservationsDataSchema>;

export const ObservationsResponseSchema = z.strictObject({
  status: z.literal('success'), freshness: z.enum(['fresh', 'stale']), data: ObservationsDataSchema,
});
export type ObservationsResponse = z.infer<typeof ObservationsResponseSchema>;
