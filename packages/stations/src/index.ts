import { StationQuerySchema, StationDataSchema, stationElements, stationCell as cell, stationCoverage as coverage,
  type StationQuery, type StationData, type StationValue } from '@zindycast/contracts';
export { StationQuerySchema, StationDataSchema, StationValueSchema, StationDaySchema, StationQueryJsonSchema,
  StationDataJsonSchema, stationElements, type StationQuery, type StationData, type StationValue } from '@zindycast/contracts';

const DAY = 86400000;
export const STATION_MAX_BYTES = 15 * 1024 * 1024;
const BASE = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/';
const DOC = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt';
type Element = typeof stationElements[number];
export class StationError extends Error {
  constructor(public readonly code: 'invalid_request' | 'provider_error' | 'rate_limited', message: string,
    public readonly httpStatus?: number, public readonly retryAfterSeconds?: number) {
    super(message); this.name = 'StationError';
  }
}
function bad(): StationError { return new StationError('provider_error', 'NOAA returned invalid or oversized daily station data.'); }
function queryInput(query: StationQuery): StationQuery {
  const parsed = StationQuerySchema.safeParse(query);
  if (!parsed.success) throw new StationError('invalid_request', 'Use an explicit US station ID and 1–366 valid inclusive calendar dates.');
  return parsed.data;
}
/** Pure complete-file parser; raw QC-flagged numeric values remain visible, NOT accepted observations. */
export function parseStationDaily(text: string, query: StationQuery, retrievedAt: string): StationData {
  const requested = queryInput(query);
  if (typeof text !== 'string' || text.length > STATION_MAX_BYTES || !/^[\x20-\x7e\r\n]*$/.test(text) || !text.length) throw bad();
  const lines = text.split('\n'); if (lines.at(-1) === '') lines.pop();
  const months = new Map<string, StationValue[]>(); const seen = new Set<string>();
  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length !== 269 || line.slice(0, 11) !== requested.stationId || !/^\d{6}[A-Z0-9]{4}$/.test(line.slice(11, 21))) throw bad();
    const year = Number(line.slice(11,15)), month = Number(line.slice(15,17)), element = line.slice(17,21);
    if (year < 1 || month < 1 || month > 12) throw bad();
    const prefix = `${line.slice(11,15)}-${line.slice(15,17)}`; const key = prefix + element;
    if (seen.has(key)) throw bad(); seen.add(key);
    const monthStart = Date.parse(prefix + '-01');
    const next = new Date(monthStart); next.setUTCMonth(next.getUTCMonth() + 1);
    const dayCount = (next.getTime() - monthStart) / DAY;
    const values: StationValue[] = [];
    for (let i = 0; i < 31; i++) {
      const slot = line.slice(21 + i * 8, 29 + i * 8);
      if (!/^ *-?\d+$/.test(slot.slice(0,5)) || !/^[ A-Za-z0-9]{3}$/.test(slot.slice(5))) throw bad();
      const n = Number(slot.slice(0,5));
      if (i >= dayCount && slot !== '-9999   ') throw bad();
      values.push(cell(n, slot[5], slot[6], slot[7]));
    }
    if ((stationElements as readonly string[]).includes(element) && prefix >= requested.startDate.slice(0,7) && prefix <= requested.endDate.slice(0,7)) months.set(key, values);
  }
  const days: StationData['days'] = [];
  for (let t = Date.parse(requested.startDate); t <= Date.parse(requested.endDate); t += DAY) {
    const label = new Date(t).toISOString().slice(0,10), i = Number(label.slice(8)) - 1;
    const value = (e: Element) => months.get(label.slice(0,7) + e)?.[i] ?? cell(null,null,null,null);
    days.push({ date: label, TMAX: value('TMAX'), TMIN: value('TMIN'), PRCP: value('PRCP') });
  }
  const result = StationDataSchema.safeParse({ query: requested, station: { id: requested.stationId, name: null, coordinates: null, elevationM: null, metadataStatus: 'not_retrieved' },
    timeContext: { basis: 'source daily calendar labels', timezone: null, observationTime: null, intervalStart: null, intervalEnd: null },
    units: { TMAX: '°C', TMIN: '°C', PRCP: 'mm' }, rawUnits: { TMAX: 'tenths °C', TMIN: 'tenths °C', PRCP: 'tenths mm' },
    provenance: { provider: 'NOAA NCEI', dataset: 'GHCN-Daily', datasetVersion: null, classification: 'station_daily_summary',
      requestUrl: BASE + requested.stationId + '.dly', sourceUrl: DOC, retrievedAt, sourceIssuedAt: null, sourceUpdatedAt: null, adapterVersion: 'ghcnd-daily-v1' },
    days, coverage: coverage(days) });
  if (!result.success) throw bad(); return result.data;
}

export async function getStationHistory(query: StationQuery, signal?: AbortSignal): Promise<StationData> {
  signal?.throwIfAborted(); const requested = queryInput(query);
  if (requested.endDate > new Date().toISOString().slice(0,10)) throw new StationError('invalid_request', 'Future station dates are not supported.');
  const controller = new AbortController(); const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Station request timed out', 'TimeoutError')), 15000);
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason); controller.signal.addEventListener('abort', onAbort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([fetch(BASE + requested.stationId + '.dly', { signal: controller.signal, redirect: 'error', headers: { Accept: 'text/plain' } }), aborted]);
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); controller.signal.throwIfAborted(); }
    if (!response.ok || response.status !== 200) {
      void response.body?.cancel().catch(() => {});
      const retry = response.headers.get('retry-after');
      const seconds = retry === null ? NaN : /^\d+$/.test(retry) ? Number(retry) : Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000));
      throw new StationError(response.status === 429 ? 'rate_limited' : 'provider_error', 'NOAA station request failed.', response.status,
        Number.isSafeInteger(seconds) ? seconds : undefined);
    }
    if (Number(response.headers.get('content-length')) > STATION_MAX_BYTES || response.headers.has('content-range') ||
      !response.headers.get('content-type')?.toLowerCase().startsWith('text/plain')) { void response.body?.cancel().catch(() => {}); throw bad(); }
    reader = response.body?.getReader(); if (!reader) throw bad();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]); controller.signal.throwIfAborted();
      if (done) break; size += value.byteLength; if (size > STATION_MAX_BYTES) throw bad(); chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = parseStationDaily(new TextDecoder('utf-8', { fatal: true }).decode(bytes), requested, new Date().toISOString());
    signal?.throwIfAborted(); return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof StationError) throw error;
    throw new StationError('provider_error', controller.signal.aborted ? 'NOAA station request timed out.' : 'NOAA station request failed.');
  } finally {
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort);
  }
}

export { getStationDiscovery, parseStationDiscovery, STATION_DISCOVERY_MAX_BYTES } from './discovery.js';
