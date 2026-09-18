import { z } from 'zod';
import { ClimateQuerySchema, ClimatePlanDataSchema, ClimateResultSchema, climateVersion, climateFields,
  type ClimateQuery, type ClimatePlan, type ClimateResult, type ClimateDay, type ClimateDailyMetric,
  type ClimateMetricSummary, type ClimateExtreme, type ClimateField, type ClimateSummary } from '../../contracts/src/climate-comparison';
import { ComparisonWeatherDataSchema, ComparisonWeatherHourSchema, comparisonWeatherFieldNames,
  type ComparisonWeatherData, type ComparisonWeatherHour } from '../../contracts/src/comparison-weather';
import { localDayBounds, coveringUtcDates } from './local-calendar';

const DAY = 86400000, HOUR = 3600000;
const units = { temperatureC: '°C', dewPointC: '°C', wetBulbTemperatureC: '°C', humidityPercent: '%', windSpeedMs: 'm/s', precipitationMm: 'mm', sunshineDurationSeconds: 's', cloudCoverPercent: '%' } as const;
const amounts = (field: ClimateField) => field === 'precipitationMm' || field === 'sunshineDurationSeconds';
const temperatures = (field: ClimateField) => field === 'temperatureC' || field === 'dewPointC' || field === 'wetBulbTemperatureC';
const iso = (time: number) => new Date(time).toISOString();
const dateAt = (time: number) => iso(time).slice(0, 10);
export class ClimateError extends Error {
  constructor(public readonly code: 'invalid_request' | 'invalid_data' | 'unsupported_calendar' | 'result_too_large', message: string) { super(message); this.name = 'ClimateError'; }
}
function fail(message: string): never { throw new ClimateError('invalid_data', message); }
function dates(start: string, end: string): string[] {
  const a = Date.parse(start), b = Date.parse(end);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(a) || !Number.isFinite(b) || dateAt(a) !== start || dateAt(b) !== end || start < '1940-01-01' || end > '9999-12-30' || b < a || b - a >= 1827 * DAY) {
    throw new ClimateError('invalid_request', 'Invalid bounded local date range.');
  }
  return Array.from({ length: (b - a) / DAY + 1 }, (_, i) => dateAt(a + i * DAY));
}
function bounds(date: string, zone: string) {
  try { return localDayBounds(date, zone); } catch { throw new ClimateError('unsupported_calendar', `Unsupported local date ${date} in ${zone}.`); }
}
/** Pure planning: the caller must check fetchEndDate against actual archive availability.
 * UTC source dates include the final closing amount and cannot precede ERA5's 1940 bound.
 */
export function createClimatePlan(query: ClimateQuery): ClimatePlan {
  const parsed = ClimateQuerySchema.safeParse(query);
  if (!parsed.success) throw new ClimateError('invalid_request', 'Invalid bounded climate selection.');
  const q = parsed.data, selectedDates = dates(q.startDate, q.endDate);
  const chunks: ClimatePlan['chunks'] = [];
  let fetchEndDate = q.endDate;
  const windows = q.locations.map((location, locationIndex) => {
    // Examine every day so a skipped civil date never disappears from denominators.
    const days = selectedDates.map(date => bounds(date, location.timezone));
    for (let i = 1; i < days.length; i++) if (days[i].start !== days[i - 1].end) throw new ClimateError('unsupported_calendar', 'Local dates do not form a contiguous selection.');
    const start = days[0].start, end = days.at(-1)!.end;
    const utc = coveringUtcDates(start, end);
    if (utc.startDate < '1940-01-01') throw new ClimateError('invalid_request', 'Local selection requires source hours before ERA5 availability.');
    fetchEndDate = utc.endDate > fetchEndDate ? utc.endDate : fetchEndDate;
    for (let cursor = Date.parse(utc.startDate), index = 0; cursor <= Date.parse(utc.endDate); cursor += 31 * DAY, index++) {
      chunks.push({ id: `location-${locationIndex}:chunk-${index}`, locationId: location.id, query: {
        latitude: location.latitude, longitude: location.longitude, startDate: dateAt(cursor), endDate: dateAt(Math.min(cursor + 30 * DAY, Date.parse(utc.endDate))) } });
    }
    return { locationId: location.id, timezone: location.timezone, startInclusive: iso(start), endExclusive: iso(end), expectedDays: selectedDates.length };
  });
  return ClimatePlanDataSchema.parse({ version: climateVersion, query: q, calendarPolicy: 'location-local-v1', requestedModel: 'era5', windows, fetchEndDate, chunks });
}
export const ClimatePlanSchema = ClimatePlanDataSchema.superRefine((plan, context) => {
  try { if (JSON.stringify(plan) !== JSON.stringify(createClimatePlan(plan.query))) throw new Error('Mismatch'); }
  catch { context.addIssue({ code: 'custom', message: 'Plan must match canonical local windows and bounded non-overlapping source chunks.' }); }
});
export type ClimateChunkResult = { chunkId: string; data: ComparisonWeatherData };

function sum(values: readonly number[]): number {
  let total = 0, correction = 0;
  for (const value of values) { const adjusted = value - correction, next = total + adjusted; correction = (next - total) - adjusted; total = next; }
  return total;
}
function average(values: readonly number[]): number | null { return values.length ? sum(values) / values.length : null; }
function extreme(previous: ClimateExtreme | null, value: number, time: string, date: string, maximum: boolean): ClimateExtreme {
  if (previous === null || (maximum ? value > previous.value : value < previous.value)) return { value, time, localDate: date, tieCount: 1 };
  if (value !== previous.value) return previous;
  return { ...previous, ...(Date.parse(time) < Date.parse(previous.time) ? { time, localDate: date } : {}), tieCount: previous.tieCount + 1 };
}
function mergeExtreme(values: Array<ClimateExtreme | null>, maximum: boolean): ClimateExtreme | null {
  let result: ClimateExtreme | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!result || (maximum ? value.value > result.value : value.value < result.value)) result = { ...value };
    else if (value.value === result.value) result = { ...(Date.parse(value.time) < Date.parse(result.time) ? value : result), tieCount: result.tieCount + value.tieCount };
  }
  return result;
}
function hourMap(hours: readonly ComparisonWeatherHour[], validate: boolean): Map<number, ComparisonWeatherHour> {
  if (!Array.isArray(hours) || hours.length > 44000) fail('Hourly selection exceeds the five-year bound.');
  const map = new Map<number, ComparisonWeatherHour>();
  for (const input of hours) {
    const row = validate ? ComparisonWeatherHourSchema.parse(input) : input;
    const time = Date.parse(row.time);
    if (!Number.isFinite(time) || time % HOUR || map.has(time)) fail('Duplicate or non-hourly source instant.');
    if ((!row.sourceHourPresent && comparisonWeatherFieldNames.some(f => row[f] !== null)) || row.missingFields.join(',') !== comparisonWeatherFieldNames.filter(f => row[f] === null).join(',')) fail('Hourly missingness does not match values.');
    map.set(time, row);
  }
  return map;
}
function dailyMetric(map: Map<number, ComparisonWeatherHour>, date: string, start: number, end: number, field: ClimateField): ClimateDailyMetric {
  const interval = amounts(field), aligned = !interval || (start % HOUR === 0 && end % HOUR === 0);
  // For nonaligned totals only fully contained intervals are available; neither
  // boundary sliver is prorated. intervalAligned=false prevents a complete total.
  const first = interval ? Math.ceil((start + HOUR) / HOUR) * HOUR : Math.ceil(start / HOUR) * HOUR;
  const lastExclusive = interval ? Math.floor(end / HOUR) * HOUR + HOUR : end;
  let expectedSlots = 0, absentSourceSlots = 0, nullSlots = 0;
  const values: number[] = [];
  let availableMin: ClimateExtreme | null = null, availableMax: ClimateExtreme | null = null;
  for (let time = first; time < lastExclusive; time += HOUR) {
    expectedSlots++;
    const row = map.get(time);
    if (!row?.sourceHourPresent) { absentSourceSlots++; continue; }
    const value = row[field];
    if (value === null) { nullSlots++; continue; }
    values.push(value);
    availableMin = extreme(availableMin, value, row.time, date, false);
    availableMax = extreme(availableMax, value, row.time, date, true);
  }
  const complete = aligned && expectedSlots > 0 && values.length === expectedSlots;
  const availableSum = values.length ? sum(values) : null;
  return { expectedSlots, validSlots: values.length, absentSourceSlots, nullSlots, intervalAligned: aligned, complete,
    // Interval mean is the daily amount/duration; instantaneous mean is hourly.
    mean: complete ? (interval ? availableSum : average(values)) : null,
    min: complete ? availableMin!.value : null, max: complete ? availableMax!.value : null,
    sumAvailable: interval ? availableSum : null, total: interval && complete ? availableSum : null,
    availableMin, availableMax };
}
function summarizeDays(map: Map<number, ComparisonWeatherHour>, timezone: string, startDate: string, endDate: string): ClimateDay[] {
  return dates(startDate, endDate).map(date => {
    const { start, end } = bounds(date, timezone);
    const metrics = Object.fromEntries(climateFields.map(field => [field, dailyMetric(map, date, start, end, field)])) as ClimateDay['metrics'];
    const cloud = metrics.cloudCoverPercent.mean;
    return { date, timezone, startInclusive: iso(start), endExclusive: iso(end), metrics,
      precipitationDay: metrics.precipitationMm.complete ? metrics.precipitationMm.total! >= 1 : null,
      cloudBin: cloud === null ? null : [5,25,50,69,87,100].findIndex(boundary => cloud <= boundary) };
  });
}
/** For bounded API drilldown. Absent rows and explicit nulls stay distinct. */
export function summarizeClimateDays(hours: readonly ComparisonWeatherHour[], timezone: string, startDate: string, endDate: string): ClimateDay[] {
  return summarizeDays(hourMap(hours, true), timezone, startDate, endDate);
}
function metricSummary(days: ClimateDay[], field: ClimateField): ClimateMetricSummary {
  const all = days.map(day => day.metrics[field]), valid = all.filter(metric => metric.complete);
  const complete = valid.length === days.length, instantTemp = temperatures(field);
  const years = [...new Set(days.map(day => day.date.slice(0,4)))];
  const validYears = years.filter(year => days.filter(day => day.date.startsWith(year)).every(day => day.metrics[field].complete)).length;
  const available = { mean: average(valid.map(v => v.mean!)), avgDailyHigh: instantTemp ? average(valid.map(v => v.max!)) : null, avgDailyLow: instantTemp ? average(valid.map(v => v.min!)) : null };
  const availableMin = mergeExtreme(all.map(v => v.availableMin), false), availableMax = mergeExtreme(all.map(v => v.availableMax), true);
  const validSlots = sum(all.map(v => v.validSlots));
  const availableSums = all.flatMap(v => v.sumAvailable === null ? [] : [v.sumAvailable]);
  return { unit: units[field], expectedDays: days.length, validDays: valid.length, validYears,
    expectedSlots: sum(all.map(v => v.expectedSlots)), validSlots, absentSourceSlots: sum(all.map(v => v.absentSourceSlots)), nullSlots: sum(all.map(v => v.nullSlots)), unsupportedDays: all.filter(v => !v.intervalAligned).length,
    status: complete ? 'complete' : validSlots ? 'partial' : 'no_data',
    mean: complete ? available.mean : null, avgDailyHigh: complete ? available.avgDailyHigh : null, avgDailyLow: complete ? available.avgDailyLow : null,
    min: complete ? availableMin : null, max: complete ? availableMax : null, availableCompleteDays: available, availableMin, availableMax,
    sumAvailable: amounts(field) && availableSums.length ? sum(availableSums) : null,
    total: amounts(field) && complete ? sum(valid.map(v => v.total!)) : null };
}
function summary(key: string, days: ClimateDay[], map: Map<number, ComparisonWeatherHour>): ClimateSummary {
  const wetBulbs: number[] = [];
  for (const day of days) for (let time = Math.ceil(Date.parse(day.startInclusive) / HOUR) * HOUR; time < Date.parse(day.endExclusive); time += HOUR) {
    const value = map.get(time)?.wetBulbTemperatureC;
    if (value !== null && value !== undefined) wetBulbs.push(value);
  }
  wetBulbs.sort((a,b) => a-b);
  const quantile = (p: number) => wetBulbs.length ? wetBulbs[Math.ceil(p * wetBulbs.length) - 1] : null;
  return { key, startDate: days[0].date, endDate: days.at(-1)!.date, expectedDays: days.length,
    years: [...new Set(days.map(day => Number(day.date.slice(0,4))))],
    metrics: Object.fromEntries(climateFields.map(field => [field, metricSummary(days, field)])) as ClimateSummary['metrics'],
    precipitationDays: { thresholdMm: 1, qualifying: days.filter(d => d.precipitationDay === true).length, belowThreshold: days.filter(d => d.precipitationDay === false).length, unknown: days.filter(d => d.precipitationDay === null).length },
    cloudDays: { boundariesPercent: [5,25,50,69,87], counts: Array.from({ length: 6 }, (_, i) => days.filter(d => d.cloudBin === i).length), unknown: days.filter(d => d.cloudBin === null).length },
    wetBulbDistribution: { method: 'nearest-rank-v1', support: 'available-hourly-samples', validSlots: wetBulbs.length, p50: quantile(.5), p90: quantile(.9), p95: quantile(.95) } };
}
/** Reject malformed/missing/duplicate chunks, shifted selection, changed grid/method.
 * Stores overview/monthly summaries and provenance only, never raw hours/days.
 */
export function aggregateClimate(plan: ClimatePlan, results: readonly ClimateChunkResult[]): ClimateResult {
  const parsed = ClimatePlanSchema.safeParse(plan);
  if (!parsed.success) throw new ClimateError('invalid_request', 'Climate plan does not match its canonical local selection.');
  const p = parsed.data;
  if (!Array.isArray(results) || results.length !== p.chunks.length) fail('Every planned chunk is required exactly once.');
  const planned = new Map(p.chunks.map(c => [c.id,c])), validated = new Map<string, ComparisonWeatherData>();
  for (const result of results) {
    if (!result || !planned.has(result.chunkId) || validated.has(result.chunkId)) fail('Unknown or duplicate climate chunk.');
    const parsedData = ComparisonWeatherDataSchema.safeParse(result.data);
    if (!parsedData.success) fail('Invalid climate chunk values, timeline, units or provenance.');
    const data = parsedData.data, expected = planned.get(result.chunkId)!.query;
    if (Object.entries(expected).some(([key,value]) => data.query[key as keyof typeof expected] !== value)) fail('Climate source selection changed.');
    validated.set(result.chunkId, data);
  }
  const locations = p.query.locations.map(location => {
    const sources: ClimateResult['locations'][number]['sources'] = [], hours: ComparisonWeatherHour[] = [];
    let grid: string | undefined;
    let source: ClimateResult['locations'][number]['source'] | undefined;
    for (const chunk of p.chunks.filter(c => c.locationId === location.id)) {
      const data = validated.get(chunk.id)!;
      const { retrievedAt, requestUrl, ...fixedSource } = data.provenance;
      const identity = JSON.stringify(fixedSource);
      if (grid !== undefined && grid !== identity) fail('Source grid or elevation changed within a city.');
      grid = identity; source = fixedSource;
      sources.push({ chunkId: chunk.id, retrievedAt, requestUrl });
      hours.push(...data.hours);
    }
    const map = hourMap(hours, false), days = summarizeDays(map, location.timezone, p.query.startDate, p.query.endDate);
    const groups = new Map<string, ClimateDay[]>();
    for (const day of days) {
      const key = p.query.mode === 'period' ? day.date.slice(0,7) : day.date.slice(5,7);
      const group = groups.get(key) ?? []; group.push(day); groups.set(key,group);
    }
    return { location, overview: summary('overview', days, map), monthly: [...groups].sort(([a],[b]) => a.localeCompare(b)).map(([key,group]) => summary(key,group,map)), source: source!, sources };
  });
  const output = ClimateResultSchema.parse({ plan: p, calculationVersion: climateVersion, classification: 'modeled_reanalysis', dataset: 'ERA5 (requested)', constituent: null,
    coveragePolicy: 'complete-days-v1', weighting: 'equal complete local days; leap days retained; climatology pools underlying days',
    intervalSemantics: 'instant samples start-inclusive/end-exclusive; precipitation and sunshine preceding-hour intervals', locations });
  // Existing storage limits are retained. Count every JSON node conservatively.
  let nodes = 0;
  const visit = (value: unknown): void => { nodes++; if (value && typeof value === 'object') for (const item of Object.values(value)) visit(item); };
  visit(output);
  if (nodes > 100000 || new TextEncoder().encode(JSON.stringify(output)).byteLength > 1_000_000) throw new ClimateError('result_too_large', 'Climate summary exceeds the existing saved-result bound.');
  return output;
}
