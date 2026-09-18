import { z } from 'zod';

/** Separate modeled current instant; shares the containing forecast's grid/provenance.
 * intervalSeconds is the provider aggregation interval, not a model issue cadence.
 * Hourly heat calculations must keep their own coherent hourly inputs.
 */
export const CurrentWeatherSchema = z.object({
  time: z.iso.datetime(),
  intervalSeconds: z.number().int().positive().max(3600),
  temperatureC: z.number().finite().nullable(),
  apparentTemperatureC: z.number().finite().nullable(),
  humidityPercent: z.number().min(0).max(100).nullable(),
  windSpeedMs: z.number().finite().nonnegative().nullable(),
  windDirectionDeg: z.number().min(0).max(360).nullable(),
  weatherCode: z.number().int().nullable(),
  isDay: z.union([z.literal(0), z.literal(1)]).nullable(),
  cloudCoverPercent: z.number().min(0).max(100).nullable(),
});
export type CurrentWeather = z.infer<typeof CurrentWeatherSchema>;
