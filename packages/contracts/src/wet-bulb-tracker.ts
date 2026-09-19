import { z } from 'zod';
import { LocationSchema } from './location';

export const WetBulbTrackerRecordSchema = z.object({
  recordedAt: z.iso.datetime(), sourceValidTime: z.iso.datetime(), retrievedAt: z.iso.datetime(),
  ordinaryWetBulbC: z.number().finite().nullable(), wbgtC: z.number().finite().nullable(),
  temperatureC: z.number().finite().nullable(), dewPointC: z.number().finite().nullable(),
  humidityPercent: z.number().min(0).max(100).nullable(), apparentTemperatureC: z.number().finite().nullable(),
  windSpeedMs: z.number().nonnegative().nullable(), precipitationProbability: z.number().min(0).max(100).nullable(),
  weatherCode: z.number().int().min(0).max(99).nullable(), isDay: z.union([z.literal(0), z.literal(1)]).nullable(), provider: z.literal('Open-Meteo'), classification: z.literal('modeled'),
});
export type WetBulbTrackerRecord = z.infer<typeof WetBulbTrackerRecordSchema>;
export const WetBulbTrackerResponseSchema = z.object({ status: z.literal('success'), location: LocationSchema,
  cadenceMinutes: z.literal(30), retentionDays: z.number().int().positive(), records: z.array(WetBulbTrackerRecordSchema).max(5000) });
export type WetBulbTrackerResponse = z.infer<typeof WetBulbTrackerResponseSchema>;
