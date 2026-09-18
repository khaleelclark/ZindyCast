import { z } from 'zod';

/** Server-only, bounded historical estimates. Not station observations or ground truth.
 * Source definitions: https://open-meteo.com/en/docs/historical-weather-api
 */
export class HistoryError extends Error {
  constructor(public readonly code: 'invalid_request' | 'provider_error' | 'rate_limited', message: string,
    public readonly httpStatus?: number, public readonly retryAfterSeconds?: number) {
    super(message); this.name = 'HistoryError';
  }
}
import { ReanalysisQuerySchema, ReanalysisHourSchema, ReanalysisDataSchema, type ReanalysisQuery, type ReanalysisHour, type ReanalysisData } from '@zindycast/contracts';
export { ReanalysisQuerySchema, ReanalysisHourSchema, ReanalysisDataSchema, type ReanalysisQuery, type ReanalysisHour, type ReanalysisData, type ReanalysisField } from '@zindycast/contracts';
const DAY=86400000;
const MAX_BYTES=1000000;
const coordinates = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) };
const fields = [
  ['temperature_2m', 'temperatureC', '°C'], ['relative_humidity_2m', 'humidityPercent', '%'],
  ['precipitation', 'precipitationMm', 'mm'], ['wind_speed_10m', 'windSpeedMs', 'm/s'],
  ['dew_point_2m', 'dewPointC', '°C'],
] as const;
const fieldNames = ['temperatureC', 'humidityPercent', 'precipitationMm', 'windSpeedMs', 'dewPointC'] as const;
const upstreamSchema = z.object({ ...coordinates, elevation: z.number().finite().min(-1000).max(10000).nullable().optional(),
  utc_offset_seconds: z.literal(0), hourly_units: z.record(z.string(), z.string()),
  hourly: z.object({ time: z.array(z.number().int()).max(744) })
    .catchall(z.array(z.number().finite().nullable()).max(744)),
});
function malformed(): HistoryError { return new HistoryError('provider_error', 'Open-Meteo returned invalid historical data.'); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw malformed();
  return parsed.data;
}
function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) { const n = Number(value); return Number.isSafeInteger(n) ? n : undefined; }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.max(0, Math.ceil((ms - Date.now()) / 1000)) : undefined;
}
async function requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('History request timed out', 'TimeoutError')), 8000);
  // Race fetch and each read as well as aborting the network: stalled/custom streams remain bounded.
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([fetch(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } }), aborted]);
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); controller.signal.throwIfAborted(); }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new HistoryError(response.status === 429 ? 'rate_limited' : 'provider_error', 'Historical provider request failed.',
        response.status, retryAfter(response.headers.get('retry-after')));
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
        Number(response.headers.get('content-length')) > MAX_BYTES) {
      void response.body?.cancel().catch(() => {}); throw malformed();
    }
    reader = response.body?.getReader();
    if (!reader) throw malformed();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      controller.signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw malformed();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof HistoryError) throw error;
    throw new HistoryError('provider_error', controller.signal.aborted ? 'Historical provider request timed out.' : 'Historical provider request failed.');
  } finally {
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

/** Inclusive UTC dates, 1940-01-01 through UTC today minus five days, at most 31 days.
 * Five-day availability is a conservative request bound, not a guarantee of populated/final data.
 * Missing timestamps are expanded to null rows; malformed, duplicate or off-grid times fail.
 */
export async function getReanalysis(query: ReanalysisQuery, signal?: AbortSignal): Promise<ReanalysisData> {
  signal?.throwIfAborted();
  const input = ReanalysisQuerySchema.safeParse(query);
  const latestDate = new Date(Math.floor(Date.now() / DAY) * DAY - 5 * DAY).toISOString().slice(0, 10);
  if (!input.success || input.data.endDate > latestDate) {
    throw new HistoryError('invalid_request', `Select 1–31 inclusive UTC days from 1940-01-01 through ${latestDate}.`);
  }
  const requested = input.data;
  const start = Date.parse(requested.startDate) / 1000;
  const expectedHours = (Date.parse(requested.endDate) / 1000 - start) / 3600 + 24;
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({ latitude: String(requested.latitude), longitude: String(requested.longitude),
    start_date: requested.startDate, end_date: requested.endDate, models: 'era5', hourly: fields.map(f => f[0]).join(','),
    timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm', cell_selection: 'land' }).toString();
  const upstream = parse(upstreamSchema, await requestJson(url, signal));
  const times = upstream.hourly.time;
  if (upstream.hourly_units.time !== 'unixtime' || times.some((t, i) =>
    t < start || t >= start + expectedHours * 3600 || (t - start) % 3600 !== 0 || (i > 0 && t <= times[i - 1]))) throw malformed();
  for (const [remote, , unit] of fields) {
    const array = upstream.hourly[remote];
    if (array !== undefined && (array.length !== times.length || upstream.hourly_units[remote] !== unit)) throw malformed();
  }
  const index = new Map(times.map((time, i) => [time, i]));
  const validCounts = { temperatureC: 0, humidityPercent: 0, precipitationMm: 0, windSpeedMs: 0, dewPointC: 0 };
  const hours: ReanalysisHour[] = Array.from({ length: expectedHours }, (_, hourIndex) => {
    const time = start + hourIndex * 3600;
    const sourceIndex = index.get(time);
    const row = Object.fromEntries(fields.map(([remote, local]) => [local,
      sourceIndex === undefined ? null : upstream.hourly[remote]?.[sourceIndex] ?? null]));
    const missingFields = fieldNames.filter(field => row[field] === null);
    const hour = parse(ReanalysisHourSchema, { ...row, time: new Date(time * 1000).toISOString(), sourceHourPresent: sourceIndex !== undefined, missingFields });
    for (const field of fieldNames) if (hour[field] !== null) validCounts[field]++;
    return hour;
  });
  const completeHours = hours.filter(h => h.missingFields.length === 0).length;
  return parse(ReanalysisDataSchema, { query: requested, timezone: 'UTC',
    provenance: { provider: 'Open-Meteo', dataset: 'ERA5 (requested)', requestedModel: 'era5', constituent: null,
      classification: 'modeled_reanalysis', sourceCoordinates: { latitude: upstream.latitude, longitude: upstream.longitude },
      sourceElevationM: upstream.elevation ?? null, retrievedAt: new Date().toISOString(), sourceIssuedAt: null, sourceUpdatedAt: null,
      requestUrl: url.toString(), sourceUrl: 'https://open-meteo.com/en/docs/historical-weather-api',
      attribution: 'Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF',
      cellSelection: 'land', downscaling: 'provider default elevation adjustment', calculationVersion: 'reanalysis-adapter-v1' },
    units: Object.fromEntries(fields.map(([, local, unit]) => [local, unit])),
    intervalSemantics: 'instant meteorology; precipitation sum over preceding hour ending at time', hours,
    completeness: { status: completeHours === expectedHours ? 'complete' : Object.values(validCounts).some(n => n > 0) ? 'partial' : 'no_data',
      expectedHours, sourceHours: times.length, missingHours: expectedHours - times.length, completeHours, validCounts },
  });
}

/** Preserve the server API error type while sharing the exact browser-safe renderer. */
export function renderReanalysisCsv(data: ReanalysisData, locationName = ''): string {
  try { return renderSnapshotCsv(data, locationName); }
  catch (cause) { throw new HistoryError('invalid_request', cause instanceof Error ? cause.message : 'Invalid history export.'); }
}
import { renderReanalysisCsv as renderSnapshotCsv } from '@zindycast/contracts';
export {fetchComparisonWeather,comparisonWeatherRequestUrl} from './comparison-weather';
