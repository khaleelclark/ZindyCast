import { z } from 'zod';
import { ReanalysisQuerySchema, type ReanalysisQuery } from './history';
const coordinates = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) };
const values = {
  temperatureC: z.number().finite().min(-150).max(80).nullable(),
  humidityPercent: z.number().finite().min(0).max(100).nullable(),
  precipitationMm: z.number().finite().min(0).max(3000).nullable(),
  windSpeedMs: z.number().finite().min(0).max(200).nullable(),
  dewPointC: z.number().finite().min(-150).max(80).nullable(),
  wetBulbTemperatureC: z.number().finite().min(-150).max(80).nullable(),
  sunshineDurationSeconds: z.number().finite().min(0).max(3600).nullable(),
  cloudCoverPercent: z.number().finite().min(0).max(100).nullable(),
  // Preserve unknown integer codes; consumers must not classify them as clear.
  weatherCode: z.number().int().min(0).max(99).nullable(),
};
export const comparisonWeatherFields = [
  ['temperature_2m', 'temperatureC', '°C'], ['relative_humidity_2m', 'humidityPercent', '%'],
  ['precipitation', 'precipitationMm', 'mm'], ['wind_speed_10m', 'windSpeedMs', 'm/s'],
  ['dew_point_2m', 'dewPointC', '°C'],
  ['wet_bulb_temperature_2m', 'wetBulbTemperatureC', '°C'],
  ['sunshine_duration', 'sunshineDurationSeconds', 's'],
  ['cloud_cover', 'cloudCoverPercent', '%'],
  ['weather_code', 'weatherCode', 'wmo code'],
] as const;
export const comparisonWeatherFieldNames = ['temperatureC', 'humidityPercent', 'precipitationMm', 'windSpeedMs', 'dewPointC', 'wetBulbTemperatureC', 'sunshineDurationSeconds', 'cloudCoverPercent', 'weatherCode'] as const;
export type ComparisonWeatherField = typeof comparisonWeatherFieldNames[number];
export const ComparisonWeatherHourSchema = z.object({ time: z.iso.datetime(), ...values,
  sourceHourPresent: z.boolean(), missingFields: z.array(z.enum(comparisonWeatherFieldNames)).max(9) }).superRefine((hour, context) => {
  if ((!hour.sourceHourPresent && comparisonWeatherFieldNames.some(field => hour[field] !== null)) ||
      hour.missingFields.join(',') !== comparisonWeatherFieldNames.filter(field => hour[field] === null).join(',')) {
    context.addIssue({ code: 'custom', message: 'Missing fields must exactly describe nullable source values.' });
  }
});
export type ComparisonWeatherHour = z.infer<typeof ComparisonWeatherHourSchema>;
const count = z.number().int().min(0).max(744);
export const ComparisonWeatherDataSchema = z.object({
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
    calculationVersion: z.literal('comparison-weather-adapter-v2'),
  }),
  units: z.object({ temperatureC: z.literal('°C'), humidityPercent: z.literal('%'), precipitationMm: z.literal('mm'),
    windSpeedMs: z.literal('m/s'), dewPointC: z.literal('°C'), wetBulbTemperatureC: z.literal('°C'), sunshineDurationSeconds: z.literal('s'), cloudCoverPercent: z.literal('%'), weatherCode: z.literal('wmo code') }),
  intervalSemantics: z.literal('instant meteorology; precipitation and sunshine duration sums over preceding hour ending at time'),
  hours: z.array(ComparisonWeatherHourSchema).min(24).max(744),
  completeness: z.object({ status: z.enum(['complete', 'partial', 'no_data']), expectedHours: count,
    sourceHours: count, completeHours: count, missingHours: count,
    validCounts: z.object({ temperatureC: count, humidityPercent: count, precipitationMm: count, windSpeedMs: count, dewPointC: count, wetBulbTemperatureC: count, sunshineDurationSeconds: count, cloudCoverPercent: count, weatherCode: count }) }),
}).superRefine((data, context) => {
  const expected = (Date.parse(data.query.endDate) - Date.parse(data.query.startDate)) / 3600000 + 24;
  const complete = data.hours.filter(h => h.missingFields.length === 0).length;
  const source = data.hours.filter(h => h.sourceHourPresent).length;
  const anyValue = data.hours.some(h => comparisonWeatherFieldNames.some(field => h[field] !== null));
  const status = complete === expected ? 'complete' : anyValue ? 'partial' : 'no_data';
  if (!ReanalysisQuerySchema.safeParse(data.query).success) return;
  if (data.provenance.requestUrl !== comparisonWeatherRequestUrl(data.query) || data.hours.length !== expected || data.completeness.expectedHours !== expected ||
    data.completeness.completeHours !== complete || data.completeness.sourceHours !== source ||
    data.completeness.missingHours !== expected - source || data.completeness.status !== status ||
    comparisonWeatherFieldNames.some(field => data.completeness.validCounts[field] !== data.hours.filter(h => h[field] !== null).length) ||
    data.hours.some((h, i) => Date.parse(h.time) !== Date.parse(data.query.startDate) + i * 3600000 ||
      (!h.sourceHourPresent && comparisonWeatherFieldNames.some(field => h[field] !== null)) ||
      h.missingFields.join(',') !== comparisonWeatherFieldNames.filter(field => h[field] === null).join(','))) {
    context.addIssue({ code: 'custom', message: 'Hourly timeline, missingness and completeness must match the selection.' });
  }
});
export type ComparisonWeatherData = z.infer<typeof ComparisonWeatherDataSchema>;

/** Canonical fixed-provider identity shared by adapter and cached snapshot validation. */
export function comparisonWeatherRequestUrl(query: ReanalysisQuery): string {
  const requested = ReanalysisQuerySchema.parse(query);
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({ latitude: String(requested.latitude), longitude: String(requested.longitude),
    start_date: requested.startDate, end_date: requested.endDate, models: 'era5', hourly: comparisonWeatherFields.map(f => f[0]).join(','),
    timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm', cell_selection: 'land' }).toString();
  return url.toString();
}
