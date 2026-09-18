import { z } from 'zod';
import { ComparisonLocationSchema } from './comparison';
import { ReanalysisQuerySchema } from './history';
import { ComparisonWeatherDataSchema } from './comparison-weather';

export const climateVersion = 'era5-local-comparison-v2' as const;
export const climateFields = ['temperatureC', 'dewPointC', 'wetBulbTemperatureC', 'humidityPercent', 'windSpeedMs', 'precipitationMm', 'sunshineDurationSeconds', 'cloudCoverPercent'] as const;
export type ClimateField = typeof climateFields[number];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
const count = z.number().int().nonnegative().max(100_000);
const nullable = z.number().finite().nullable();
export const ClimateLocationSchema = ComparisonLocationSchema.extend({ timezone: z.string().min(1).max(100).refine(zone => {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return !/^[+-]/.test(zone); } catch { return false; }
}) }).strict();
export const ClimateQuerySchema = z.object({ locations: z.array(ClimateLocationSchema).min(2).max(5), startDate: date, endDate: date, mode: z.enum(['period', 'climatology']) }).strict().superRefine((q, c) => {
  const years = Number(q.endDate.slice(0, 4)) - Number(q.startDate.slice(0, 4)) + 1;
  if (q.startDate < '1940-01-01' || q.endDate > '9999-12-30' || q.endDate < q.startDate ||
      new Set(q.locations.map(l => l.id)).size !== q.locations.length || new Set(q.locations.map(l => `${l.latitude},${l.longitude}`)).size !== q.locations.length ||
      (q.mode === 'period' ? Date.parse(q.endDate) - Date.parse(q.startDate) >= 366 * 86400000 : years < 2 || years > 5 || !q.startDate.endsWith('-01-01') || !q.endDate.endsWith('-12-31'))) {
    c.addIssue({ code: 'custom', message: 'Select 2–5 distinct locations, 1–366 local dates, or 2–5 full calendar years.' });
  }
});
export type ClimateQuery = z.infer<typeof ClimateQuerySchema>;
export type ClimateLocation = z.infer<typeof ClimateLocationSchema>;
export const ClimatePlanDataSchema = z.object({ version: z.literal(climateVersion), query: ClimateQuerySchema,
  calendarPolicy: z.literal('location-local-v1'), requestedModel: z.literal('era5'),
  windows: z.array(z.object({ locationId: z.string(), timezone: z.string(), startInclusive: z.iso.datetime(), endExclusive: z.iso.datetime(), expectedDays: count })).min(2).max(5),
  fetchEndDate: date,
  chunks: z.array(z.object({ id: z.string(), locationId: z.string(), query: ReanalysisQuerySchema }).strict()).min(2).max(305),
}).strict();
export type ClimatePlan = z.infer<typeof ClimatePlanDataSchema>;
export type ClimateChunk = ClimatePlan['chunks'][number];
export const ClimateExtremeSchema = z.object({ value: z.number().finite(), time: z.iso.datetime(), localDate: date, tieCount: count });
export type ClimateExtreme = z.infer<typeof ClimateExtremeSchema>;
export const ClimateDailyMetricSchema = z.object({ expectedSlots: count, validSlots: count, absentSourceSlots: count, nullSlots: count,
  intervalAligned: z.boolean(), complete: z.boolean(), mean: nullable, min: nullable, max: nullable,
  sumAvailable: nullable, total: nullable, availableMin: ClimateExtremeSchema.nullable(), availableMax: ClimateExtremeSchema.nullable() });
export type ClimateDailyMetric = z.infer<typeof ClimateDailyMetricSchema>;
export const ClimateDaySchema = z.object({ date, timezone: z.string(), startInclusive: z.iso.datetime(), endExclusive: z.iso.datetime(),
  metrics: z.record(z.enum(climateFields), ClimateDailyMetricSchema), precipitationDay: z.boolean().nullable(), cloudBin: z.number().int().min(0).max(5).nullable() });
export type ClimateDay = z.infer<typeof ClimateDaySchema>;
/** mean: equal-day mean of instantaneous daily means, or average daily amount for mm/s.
 * min/max are hourly-sample extremes. validYears counts fully complete selected year
 * groups (year-month groups within a monthly summary), not climatological normals. */
export const ClimateMetricSummarySchema = z.object({ unit: z.enum(['°C', '%', 'm/s', 'mm', 's']), expectedDays: count, validDays: count, validYears: count,
  expectedSlots: count, validSlots: count, absentSourceSlots: count, nullSlots: count, unsupportedDays: count,
  status: z.enum(['complete', 'partial', 'no_data']), mean: nullable, avgDailyHigh: nullable, avgDailyLow: nullable,
  min: ClimateExtremeSchema.nullable(), max: ClimateExtremeSchema.nullable(),
  availableCompleteDays: z.object({ mean: nullable, avgDailyHigh: nullable, avgDailyLow: nullable }),
  availableMin: ClimateExtremeSchema.nullable(), availableMax: ClimateExtremeSchema.nullable(), sumAvailable: nullable, total: nullable });
export type ClimateMetricSummary = z.infer<typeof ClimateMetricSummarySchema>;
export const ClimateSummarySchema = z.object({ key: z.string().max(20), startDate: date, endDate: date, expectedDays: count, years: z.array(z.number().int()).max(5),
  metrics: z.record(z.enum(climateFields), ClimateMetricSummarySchema),
  precipitationDays: z.object({ thresholdMm: z.literal(1), qualifying: count, belowThreshold: count, unknown: count }),
  cloudDays: z.object({ boundariesPercent: z.tuple([z.literal(5),z.literal(25),z.literal(50),z.literal(69),z.literal(87)]), counts: z.array(count).length(6), unknown: count }),
  wetBulbDistribution: z.object({ method: z.literal('nearest-rank-v1'), support: z.literal('available-hourly-samples'), validSlots: count, p50: nullable, p90: nullable, p95: nullable }),
});
export type ClimateSummary = z.infer<typeof ClimateSummarySchema>;
export const ClimateResultSchema = z.object({ plan: ClimatePlanDataSchema, calculationVersion: z.literal(climateVersion),
  classification: z.literal('modeled_reanalysis'), dataset: z.literal('ERA5 (requested)'), constituent: z.null(),
  coveragePolicy: z.literal('complete-days-v1'), weighting: z.literal('equal complete local days; leap days retained; climatology pools underlying days'),
  intervalSemantics: z.literal('instant samples start-inclusive/end-exclusive; precipitation and sunshine preceding-hour intervals'),
  locations: z.array(z.object({ location: ClimateLocationSchema, overview: ClimateSummarySchema, monthly: z.array(ClimateSummarySchema).max(13),
    source: ComparisonWeatherDataSchema.shape.provenance.omit({ retrievedAt: true, requestUrl: true }),
    sources: z.array(z.object({ chunkId: z.string(), retrievedAt: z.iso.datetime(), requestUrl: z.url().max(2000) })).max(61),
  })).min(2).max(5),
}).strict();
export type ClimateResult = z.infer<typeof ClimateResultSchema>;

export const ClimateJobSchema = z.object({id:z.string(),state:z.enum(['queued','running','completed','failed','cancelled']),progress:z.number().min(0).max(1),attempt:z.number().int(),expiresAt:z.number(),createdAt:z.number(),error:z.string().nullable(),query:ClimateQuerySchema,result:ClimateResultSchema.nullable()});
export type ClimateJob = z.infer<typeof ClimateJobSchema>;
export const ClimateDetailSchema = z.object({status:z.literal('success'),location:ClimateLocationSchema,startDate:date,endDate:date,days:z.array(ClimateDaySchema).max(31),hours:z.array(ComparisonWeatherDataSchema.shape.hours.element).max(770),sources:z.array(ComparisonWeatherDataSchema.shape.provenance).max(3)});
export type ClimateDetail = z.infer<typeof ClimateDetailSchema>;
