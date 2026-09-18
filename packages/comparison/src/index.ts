import { z } from 'zod';
import { ReanalysisDataSchema, type ReanalysisData, type ReanalysisField, type ReanalysisHour,
  type ReanalysisQuery } from '@zindycast/contracts';

/** Pure, bounded descriptive comparison of requested ERA5; never station observations.
 * Time/selection evidence: docs/research/station-history.md and
 * https://open-meteo.com/en/docs/historical-weather-api (previously audited).
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
export const comparisonFields = ['temperatureC', 'humidityPercent', 'precipitationMm', 'windSpeedMs', 'dewPointC'] as const;
const remoteFields = 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,dew_point_2m';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
import { ComparisonLocationSchema, ComparisonQuerySchema } from '@zindycast/contracts';
export { ComparisonLocationSchema, ComparisonQuerySchema } from '@zindycast/contracts';
export type ComparisonQuery = z.infer<typeof ComparisonQuerySchema>;
export type ComparisonLocation = z.infer<typeof ComparisonLocationSchema>;
export type ComparisonChunk = { id: string; locationId: string; query: ReanalysisQuery };
export type ComparisonPlan = {
  version: 'era5-comparison-v1'; query: ComparisonQuery; timezone: 'UTC'; requestedModel: 'era5';
  window: { startInclusive: string; endExclusive: string; expectedHours: number };
  fetchEndDate: string; chunks: ComparisonChunk[];
};
export class ComparisonError extends Error {
  constructor(public readonly code: 'invalid_request' | 'invalid_data', message: string) {
    super(message); this.name = 'ComparisonError';
  }
}
const dateAt = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** No clock/network access. Worker validates current archive availability and budget,
 * including the extra closing date. Input order determines stable plan/result order.
 */
export function createComparisonPlan(query: ComparisonQuery): ComparisonPlan {
  const parsed = ComparisonQuerySchema.safeParse(query);
  if (!parsed.success) throw new ComparisonError('invalid_request', 'Invalid bounded comparison selection.');
  const q = parsed.data;
  const start = Date.parse(q.startDate), end = Date.parse(q.endDate) + DAY;
  const chunks: ComparisonChunk[] = [];
  q.locations.forEach((location, locationIndex) => {
    for (let cursor = start, index = 0; cursor <= end; cursor += 31 * DAY, index++) {
      chunks.push({ id: `location-${locationIndex}:chunk-${index}`, locationId: location.id,
        query: { latitude: location.latitude, longitude: location.longitude,
          startDate: dateAt(cursor), endDate: dateAt(Math.min(cursor + 30 * DAY, end)) } });
    }
  });
  return { version: 'era5-comparison-v1', query: q, timezone: 'UTC', requestedModel: 'era5',
    window: { startInclusive: new Date(start).toISOString(), endExclusive: new Date(end).toISOString(),
      expectedHours: (end - start) / HOUR }, fetchEndDate: dateAt(end), chunks };
}

const ChunkSchema = z.object({ id: z.string(), locationId: z.string(),
  query: z.object({ latitude: z.number(), longitude: z.number(), startDate: date, endDate: date }).strict() }).strict();
export const ComparisonPlanSchema = z.object({
  version: z.literal('era5-comparison-v1'), query: ComparisonQuerySchema,
  timezone: z.literal('UTC'), requestedModel: z.literal('era5'),
  window: z.object({ startInclusive: z.iso.datetime(), endExclusive: z.iso.datetime(), expectedHours: z.number().int() }).strict(),
  fetchEndDate: date, chunks: z.array(ChunkSchema).min(2).max(60),
}).strict().superRefine((plan, context) => {
  if (!ComparisonQuerySchema.safeParse(plan.query).success) return;
  const canonical = createComparisonPlan(plan.query);
  if (JSON.stringify(plan) !== JSON.stringify(canonical)) {
    context.addIssue({ code: 'custom', message: 'Plan must match the canonical bounded selection and complete non-overlapping chunks.' });
  }
});

export type ComparisonChunkResult = { chunkId: string; data: ReanalysisData };
export type VariableSummary = {
  unit: string; expectedCount: number; validCount: number; missingCount: number;
  absentSourceCount: number; nullValueCount: number;
  status: 'complete' | 'partial' | 'no_data';
  /** Equal hourly weights over available values only; missing slots are never imputed. */
  mean: number | null; min: number | null; max: number | null;
};
export type PrecipitationSummary = VariableSummary & {
  /** Partial sum is descriptive only. Complete total requires every selected interval. */
  sumAvailableMm: number | null; totalMm: number | null;
};
export type LocationComparison = {
  location: ComparisonLocation;
  variables: Record<Exclude<ReanalysisField, 'precipitationMm'>, VariableSummary> & { precipitationMm: PrecipitationSummary };
  sources: Array<{ chunkId: string; query: ReanalysisQuery; provenance: ReanalysisData['provenance'] }>;
};
export type ComparisonResult = {
  plan: ComparisonPlan; calculationVersion: 'era5-comparison-v1';
  classification: 'modeled_reanalysis'; dataset: 'ERA5 (requested)'; constituent: null;
  weighting: 'equal hourly slots; leap day retained; available values only';
  intervalSemantics: 'instant samples start-inclusive/end-exclusive; precipitation intervals fully contained in window';
  /** Count of identical slots with non-null values at EVERY location, per field.
   * Individual means still use each location's own valid slots, not this intersection. */
  commonValidCounts: Record<ReanalysisField, number>;
  locations: LocationComparison[];
};

function fail(message: string): never { throw new ComparisonError('invalid_data', message); }
function validateRequestUrl(data: ReanalysisData): void {
  const url = new URL(data.provenance.requestUrl);
  const q = data.query;
  const expected: Record<string, string> = { latitude: String(q.latitude), longitude: String(q.longitude),
    start_date: q.startDate, end_date: q.endDate, models: 'era5', hourly: remoteFields,
    timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'ms',
    precipitation_unit: 'mm', cell_selection: 'land' };
  if (url.origin !== 'https://archive-api.open-meteo.com' || url.pathname !== '/v1/archive' ||
      url.username || url.password || url.hash || [...url.searchParams].length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) {
    fail('Chunk request URL does not match the fixed source, variables, units, coordinates and dates.');
  }
}

function summarize(rows: Array<ReanalysisHour | undefined>, field: ReanalysisField, unit: string): VariableSummary {
  let count = 0, sum = 0, correction = 0, min = Infinity, max = -Infinity, absent = 0;
  for (const row of rows) {
    if (!row?.sourceHourPresent) absent++;
    const value = row?.[field] ?? null;
    if (value === null) continue;
    count++; min = Math.min(min, value); max = Math.max(max, value);
    // Compensated summation; fixed chronological order is independent of chunk arrival.
    const adjusted = value - correction, next = sum + adjusted;
    correction = (next - sum) - adjusted; sum = next;
  }
  return { unit, expectedCount: rows.length, validCount: count, missingCount: rows.length - count,
    absentSourceCount: absent, nullValueCount: rows.length - count - absent,
    status: count === rows.length ? 'complete' : count ? 'partial' : 'no_data',
    mean: count ? sum / count : null, min: count ? min : null, max: count ? max : null };
}

/** All planned chunks are required, though their validated hours may be null.
 * Missing/duplicate/overlapping/extra/mismatched chunks fail, never partial job success.
 * Per-location grid/elevation must stay fixed across chunks; different cities may
 * legitimately map to different (or the same) grid cells. Retrieval times may differ.
 */
export function aggregateComparison(plan: ComparisonPlan, results: readonly ComparisonChunkResult[]): ComparisonResult {
  const parsed = ComparisonPlanSchema.safeParse(plan);
  if (!parsed.success) throw new ComparisonError('invalid_request', 'Comparison plan is inconsistent.');
  const p = parsed.data;
  if (!Array.isArray(results) || results.length !== p.chunks.length) fail('Every planned chunk is required exactly once.');
  const chunks = new Map(p.chunks.map(chunk => [chunk.id, chunk]));
  const validated = new Map<string, ReanalysisData>();
  for (const result of results) {
    if (!result || !chunks.has(result.chunkId) || validated.has(result.chunkId)) fail('Unknown or duplicate chunk.');
    const parsedData = ReanalysisDataSchema.safeParse(result.data);
    if (!parsedData.success) fail('Chunk contains invalid data, units, timeline or completeness.');
    const data = parsedData.data, expected = chunks.get(result.chunkId)!.query;
    if (Object.entries(expected).some(([key, value]) => data.query[key as keyof ReanalysisQuery] !== value)) {
      fail('Chunk selection differs from the common plan.');
    }
    validateRequestUrl(data);
    validated.set(result.chunkId, data);
  }
  const start = Date.parse(p.window.startInclusive), expected = p.window.expectedHours;
  const common = Object.fromEntries(comparisonFields.map(field => [field, new Array<boolean>(expected).fill(true)])) as Record<ReanalysisField, boolean[]>;
  const locations = p.query.locations.map(location => {
    const selected = p.chunks.filter(chunk => chunk.locationId === location.id);
    const sources: LocationComparison['sources'] = [];
    const hours = new Map<number, ReanalysisHour>();
    let grid: string | undefined;
    let units: ReanalysisData['units'] | undefined;
    for (const chunk of selected) {
      const data = validated.get(chunk.id)!;
      const identity = JSON.stringify([data.provenance.sourceCoordinates, data.provenance.sourceElevationM]);
      if (grid !== undefined && identity !== grid) fail('Source grid or elevation changed within one location.');
      grid = identity; units = data.units;
      sources.push({ chunkId: chunk.id, query: data.query, provenance: data.provenance });
      for (const hour of data.hours) {
        const time = Date.parse(hour.time);
        if (hours.has(time)) fail('Chunk timelines overlap.');
        hours.set(time, hour);
      }
    }
    const variables = {} as LocationComparison['variables'];
    for (const field of comparisonFields) {
      // Rain interval endpoints run start+1h … end, rather than start … end-1h.
      const rows = Array.from({ length: expected }, (_, i) => hours.get(start + (i + (field === 'precipitationMm' ? 1 : 0)) * HOUR));
      if (rows.some(row => row === undefined)) fail('Merged timeline has a gap.');
      rows.forEach((row, i) => { common[field][i] &&= row![field] !== null; });
      const summary = summarize(rows, field, units![field]);
      if (field === 'precipitationMm') {
        // Recover a compensated sum directly to avoid round-trip mean multiplication.
        let sum = 0, correction = 0;
        for (const row of rows) {
          if (row!.precipitationMm === null) continue;
          const adjusted = row!.precipitationMm - correction, next = sum + adjusted;
          correction = (next - sum) - adjusted; sum = next;
        }
        variables.precipitationMm = { ...summary, sumAvailableMm: summary.validCount ? sum : null,
          totalMm: summary.status === 'complete' ? sum : null };
      } else variables[field] = summary;
    }
    return { location, variables, sources };
  });
  return { plan: p, calculationVersion: 'era5-comparison-v1', classification: 'modeled_reanalysis',
    dataset: 'ERA5 (requested)', constituent: null,
    weighting: 'equal hourly slots; leap day retained; available values only',
    intervalSemantics: 'instant samples start-inclusive/end-exclusive; precipitation intervals fully contained in window',
    commonValidCounts: Object.fromEntries(comparisonFields.map(field => [field, common[field].filter(Boolean).length])) as Record<ReanalysisField, number>,
    locations };
}
export {createClimatePlan,aggregateClimate,summarizeClimateDays,ClimatePlanSchema,ClimateError} from './climate';
export {localDate,localDayBounds,coveringUtcDates} from './local-calendar';
