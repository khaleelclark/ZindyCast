import { z } from 'zod';
const DAY = 86_400_000;
const MAX_BYTES = 1_000_000;
const coordinates = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
});
export const ReanalysisQuerySchema = z.object({ ...coordinates, startDate: date, endDate: date }).strict()
  .refine(q => q.startDate >= '1940-01-01' && q.endDate >= q.startDate &&
    Date.parse(q.endDate) - Date.parse(q.startDate) < 31 * DAY,
  'Select 1–31 inclusive UTC days from 1940 onward.');
export type ReanalysisQuery = z.infer<typeof ReanalysisQuerySchema>;
const values = {
  temperatureC: z.number().finite().min(-150).max(80).nullable(),
  humidityPercent: z.number().finite().min(0).max(100).nullable(),
  precipitationMm: z.number().finite().min(0).max(3000).nullable(),
  windSpeedMs: z.number().finite().min(0).max(200).nullable(),
  dewPointC: z.number().finite().min(-150).max(80).nullable(),
};
const fields = [
  ['temperature_2m', 'temperatureC', '°C'], ['relative_humidity_2m', 'humidityPercent', '%'],
  ['precipitation', 'precipitationMm', 'mm'], ['wind_speed_10m', 'windSpeedMs', 'm/s'],
  ['dew_point_2m', 'dewPointC', '°C'],
] as const;
const fieldNames = ['temperatureC', 'humidityPercent', 'precipitationMm', 'windSpeedMs', 'dewPointC'] as const;
export type ReanalysisField = typeof fieldNames[number];
export const ReanalysisHourSchema = z.object({ time: z.iso.datetime(), ...values,
  sourceHourPresent: z.boolean(), missingFields: z.array(z.enum(fieldNames)).max(5) });
export type ReanalysisHour = z.infer<typeof ReanalysisHourSchema>;
const count = z.number().int().min(0).max(744);
export const ReanalysisDataSchema = z.object({
  query: ReanalysisQuerySchema,
  timezone: z.literal('UTC'),
  provenance: z.object({
    provider: z.literal('Open-Meteo'), dataset: z.literal('ERA5 (requested)'), requestedModel: z.literal('era5'),
    constituent: z.null(), classification: z.literal('modeled_reanalysis'),
    sourceCoordinates: z.object(coordinates), sourceElevationM: z.number().finite().min(-1000).max(10000).nullable(),
    retrievedAt: z.iso.datetime(), sourceIssuedAt: z.null(), sourceUpdatedAt: z.null(),
    requestUrl: z.url().max(2000), sourceUrl: z.literal('https://open-meteo.com/en/docs/historical-weather-api'),
    attribution: z.literal('Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF'),
    cellSelection: z.literal('land'), downscaling: z.literal('provider default elevation adjustment'),
    calculationVersion: z.literal('reanalysis-adapter-v1'),
  }),
  units: z.object({ temperatureC: z.literal('°C'), humidityPercent: z.literal('%'), precipitationMm: z.literal('mm'),
    windSpeedMs: z.literal('m/s'), dewPointC: z.literal('°C') }),
  intervalSemantics: z.literal('instant meteorology; precipitation sum over preceding hour ending at time'),
  hours: z.array(ReanalysisHourSchema).min(24).max(744),
  completeness: z.object({ status: z.enum(['complete', 'partial', 'no_data']), expectedHours: count,
    sourceHours: count, completeHours: count, missingHours: count,
    validCounts: z.object({ temperatureC: count, humidityPercent: count, precipitationMm: count, windSpeedMs: count, dewPointC: count }) }),
}).superRefine((data, context) => {
  const expected = (Date.parse(data.query.endDate) - Date.parse(data.query.startDate)) / 3600000 + 24;
  const complete = data.hours.filter(h => h.missingFields.length === 0).length;
  const source = data.hours.filter(h => h.sourceHourPresent).length;
  const anyValue = data.hours.some(h => fieldNames.some(field => h[field] !== null));
  const status = complete === expected ? 'complete' : anyValue ? 'partial' : 'no_data';
  if (data.hours.length !== expected || data.completeness.expectedHours !== expected ||
    data.completeness.completeHours !== complete || data.completeness.sourceHours !== source ||
    data.completeness.missingHours !== expected - source || data.completeness.status !== status ||
    fieldNames.some(field => data.completeness.validCounts[field] !== data.hours.filter(h => h[field] !== null).length) ||
    data.hours.some((h, i) => Date.parse(h.time) !== Date.parse(data.query.startDate) + i * 3600000 ||
      (!h.sourceHourPresent && fieldNames.some(field => h[field] !== null)) ||
      h.missingFields.join(',') !== fieldNames.filter(field => h[field] === null).join(','))) {
    context.addIssue({ code: 'custom', message: 'Hourly timeline, missingness and completeness must match the selection.' });
  }
});
export type ReanalysisData = z.infer<typeof ReanalysisDataSchema>;

export const ReanalysisResponseSchema=z.object({status:z.literal('success'),freshness:z.enum(['fresh','stale']),data:ReanalysisDataSchema});
