import { z } from 'zod';
import { ProviderError } from './index.js';
import {
  ObservationQuerySchema, ObservationQualityControlSchema, ObservationsDataSchema,
  observationDistanceKm, observationFields, observationFieldNames, observationQualityMeanings,
  type ObservationQuery, type ObservationsData, type ObservationStation, type StationObservation,
} from '../../contracts/src/observations.js';

const DEADLINE_MS = 10_000;
const MAX_TOTAL_BYTES = 5_000_000;
const CANDIDATE_LIMIT = 5;
const OBSERVATION_LIMIT = 500;
const apiUrl = z.url().refine(value => new URL(value).origin === 'https://api.weather.gov');
const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const quantitative = z.object({
  value: z.number().finite().nullable(), unitCode: z.string(),
  qualityControl: ObservationQualityControlSchema.nullable().optional(),
});
const pointResponse = z.object({ properties: z.object({ observationStations: apiUrl }) });
const stationFeature = z.object({
  id: apiUrl.optional(),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.array(z.number().finite()).min(2).max(3),
  }),
  properties: z.object({
    '@id': apiUrl.optional(), stationIdentifier: z.string().regex(/^[A-Za-z0-9]{1,16}$/),
    name: z.string().min(1).max(200), elevation: quantitative.nullable().optional(),
  }),
});
const stationCollection = z.object({
  type: z.literal('FeatureCollection'), features: z.array(stationFeature).max(CANDIDATE_LIMIT),
  pagination: z.object({ next: apiUrl.nullable().optional() }).optional(),
});
const observationProperties = z.object({
  '@id': apiUrl.optional(), station: apiUrl.optional(), stationId: z.string().optional(),
  stationName: z.string().optional(), timestamp: instant, textDescription: z.string().max(500).optional(),
}).catchall(z.unknown());
const observationFeature = z.object({ id: apiUrl.optional(), properties: observationProperties });
const observationCollection = z.object({
  type: z.literal('FeatureCollection'), features: z.array(observationFeature).max(OBSERVATION_LIMIT),
  pagination: z.object({ next: apiUrl.nullable().optional() }).optional(),
});

function malformed(message = 'NWS returned malformed or incomplete station observations.'): ProviderError {
  return new ProviderError('provider_error', message);
}
function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 1000)) : undefined;
}

/** NWS station observations are free/open but rate-limited, require an identifying
 * User-Agent, and may lag MADIS ingestion. No station is selected as ground truth.
 * https://www.weather.gov/documentation/services-web-api
 */
export async function fetchNearbyObservations(query: ObservationQuery, signal?: AbortSignal): Promise<ObservationsData> {
  signal?.throwIfAborted();
  const parsed = ObservationQuerySchema.safeParse(query);
  if (!parsed.success) throw new ProviderError('invalid_request', 'Use a valid UTC observation window of at most seven days.');
  const requested = parsed.data;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('NWS observations deadline', 'TimeoutError')), DEADLINE_MS);
  let totalBytes = 0;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const requestJson = async (url: URL): Promise<unknown> => {
    controller.signal.throwIfAborted();
    const response = await Promise.race([fetch(url, { signal: controller.signal, redirect: 'error', headers: {
      Accept: 'application/geo+json', 'User-Agent': 'ZindyCast/0.1 (private family weather application)',
    } }), aborted]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderError(response.status === 429 ? 'rate_limited' : response.status === 404 ? 'no_data' : 'provider_error',
        response.status === 429 ? 'NWS observation request limit reached.' : response.status === 404 ?
          'NWS publishes no station observations for this location.' : 'NWS observations are unavailable.',
        response.status, retryAfter(response.headers.get('retry-after')));
    }
    if (!/^application\/(?:geo\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
        Number(response.headers.get('content-length')) > MAX_TOTAL_BYTES - totalBytes) {
      void response.body?.cancel().catch(() => {}); throw malformed();
    }
    const reader = response.body?.getReader();
    if (!reader) throw malformed();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        controller.signal.throwIfAborted();
        if (done) break;
        size += value.byteLength; totalBytes += value.byteLength;
        if (totalBytes > MAX_TOTAL_BYTES) throw malformed('NWS observation response exceeded the byte limit.');
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw malformed(); }
  };

  try {
    // NWS redirects coordinates beyond four decimals to this precision. Request
    // its canonical point directly; retain the original location for distances
    // and response binding rather than following arbitrary provider redirects.
    const pointLatitude = Number(requested.latitude.toFixed(4));
    const pointLongitude = Number(requested.longitude.toFixed(4));
    const pointUrl = new URL(`https://api.weather.gov/points/${pointLatitude},${pointLongitude}`);
    const point = pointResponse.safeParse(await requestJson(pointUrl));
    if (!point.success) throw malformed();
    const stationListUrl = new URL(point.data.properties.observationStations);
    if (!/^\/gridpoints\/[A-Z0-9]+\/\d+,\d+\/stations$/.test(stationListUrl.pathname)) throw malformed();
    stationListUrl.search = new URLSearchParams({ limit: String(CANDIDATE_LIMIT) }).toString();
    const collection = stationCollection.safeParse(await requestJson(stationListUrl));
    if (!collection.success) throw malformed();

    const candidateSet = collection.data.features.map(feature => {
      const [longitude, latitude] = feature.geometry.coordinates;
      const coordinates = { latitude, longitude };
      const sourceUrl = feature.id ?? feature.properties['@id'] ??
        `https://api.weather.gov/stations/${feature.properties.stationIdentifier}`;
      if (new URL(sourceUrl).pathname !== `/stations/${feature.properties.stationIdentifier}`) throw malformed();
      const elevation = feature.properties.elevation;
      if (elevation && elevation.unitCode !== 'wmoUnit:m') throw malformed();
      return {
        stationId: feature.properties.stationIdentifier, name: feature.properties.name, coordinates,
        elevationM: elevation?.value ?? null,
        distanceKm: observationDistanceKm(requested, coordinates), sourceUrl,
      };
    }).sort((a, b) => a.distanceKm - b.distanceKm || a.stationId.localeCompare(b.stationId));
    if (new Set(candidateSet.map(station => station.stationId)).size !== candidateSet.length) throw malformed();
    const selected = candidateSet.slice(0, requested.stationLimit);

    const readStation = async (station: typeof selected[number]): Promise<ObservationStation> => {
      const url = new URL(`https://api.weather.gov/stations/${encodeURIComponent(station.stationId)}/observations`);
      url.search = new URLSearchParams({ start: requested.since, end: requested.until, limit: String(OBSERVATION_LIMIT) }).toString();
      const parsedCollection = observationCollection.safeParse(await requestJson(url));
      if (!parsedCollection.success) {
        throw malformed('NWS observation window was malformed or exceeded the 500-record bound.');
      }
      const observations: StationObservation[] = parsedCollection.data.features.map(feature => {
        const properties = feature.properties;
        if ((properties.stationId && properties.stationId !== station.stationId) ||
            (properties.station && new URL(properties.station).pathname !== `/stations/${station.stationId}`)) throw malformed();
        const sourceId = feature.id ?? properties['@id'] ??
          `https://api.weather.gov/stations/${station.stationId}/observations/${encodeURIComponent(properties.timestamp)}`;
        if (!new URL(sourceId).pathname.startsWith(`/stations/${station.stationId}/observations/`)) throw malformed();
        const measurements = Object.fromEntries(observationFields.map(([remote, local, unit]) => {
          const value = quantitative.safeParse(properties[remote]);
          if (!value.success && properties[remote] !== undefined && properties[remote] !== null) throw malformed();
          // NWS observations publish wind in km/h as well as m/s. Normalize
          // only these wind fields; keep unknown/incompatible units fail-closed.
          const windKilometresPerHour = (remote === 'windSpeed' || remote === 'windGust') &&
            value.success && value.data.unitCode === 'wmoUnit:km_h-1';
          if (value.success && value.data.unitCode !== unit && !windKilometresPerHour) throw malformed();
          const qualityControl = value.success ? value.data.qualityControl ?? null : null;
          const sourceValue = value.success ? value.data.value : null;
          const normalizedValue = sourceValue !== null && windKilometresPerHour ? sourceValue / 3.6 : sourceValue;
          return [local, { value: normalizedValue, qualityControl,
            qualityMeaning: qualityControl === null ? null : observationQualityMeanings[qualityControl] }];
        }));
        const missingFields = observationFieldNames.filter(field => measurements[field].value === null);
        return {
          sourceId, time: properties.timestamp, textDescription: properties.textDescription?.trim() || null,
          measurements, missingFields,
        } as StationObservation;
      }).filter(observation => observation.time >= requested.since && observation.time <= requested.until)
        .sort((a, b) => b.time.localeCompare(a.time) || a.sourceId.localeCompare(b.sourceId));
      if (observations.some((observation, index) => index > 0 && observation.time === observations[index - 1].time)) {
        throw malformed('NWS returned duplicate observation timestamps for one station.');
      }
      return {
        ...station, latestObservationTime: observations[0]?.time ?? null,
        // NWS may emit a continuation even for a short time-window response.
        // Keep this first page explicitly partial; never follow it implicitly.
        observationHistoryTruncated: Boolean(parsedCollection.data.pagination?.next), observations,
      };
    };
    const stations = await Promise.all(selected.map(readStation));
    controller.signal.throwIfAborted();
    const units = Object.fromEntries(observationFields.map(([, local, unit]) => [local, unit]));
    return ObservationsDataSchema.parse({
      query: requested, stations, candidateCount: candidateSet.length,
      candidateSetTruncated: Boolean(collection.data.pagination?.next) || collection.data.features.length === CANDIDATE_LIMIT,
      provider: 'NWS', dataset: 'NWS API station observations (MADIS ingest)', classification: 'observed',
      retrievedAt: new Date().toISOString(), stationListSourceUrl: stationListUrl.toString(),
      selectionPolicy: 'distance-ranked candidates only; no automatic representativeness selection',
      stationContinuity: 'observations remain grouped by station; no cross-station splice',
      intervalSemantics: 'station instants; precipitationLastHourMm is the reported preceding-hour accumulation ending at observation time',
      units, qualityControlSourceUrl: 'https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml',
      attribution: 'Station observations from NOAA National Weather Service (https://www.weather.gov/); quality flags from MADIS.',
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const deadlineAborted = controller.signal.aborted;
    // Stop sibling station requests if one member of the bounded set fails.
    if (!controller.signal.aborted) controller.abort(error);
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('provider_error', deadlineAborted ?
      'NWS observations request timed out.' : 'NWS returned malformed or unavailable station observations.');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onCallerAbort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
