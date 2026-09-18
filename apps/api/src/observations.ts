import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ProviderError } from '@zindycast/providers';
import { fetchNearbyObservations } from '../../../packages/providers/src/observations.js';
import {
  ObservationsDataSchema, ObservationsResponseSchema, type ObservationQuery, type ObservationsData,
} from '../../../packages/contracts/src/observations.js';
import type { CachedRequests } from './cache.js';

const coordinate = z.string().trim().min(1).regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/)
  .pipe(z.coerce.number<string>().finite());
const QuerySchema = z.strictObject({ latitude: coordinate, longitude: coordinate, refresh: z.literal('1').optional() })
  .refine(query => query.latitude >= -90 && query.latitude <= 90 && query.longitude >= -180 && query.longitude <= 180);
const WINDOW_MS = 3 * 60 * 60_000;
const STATION_LIMIT = 3;

export type ObservationFetcher = (query: ObservationQuery, signal?: AbortSignal) => Promise<ObservationsData>;
export function observationsCacheKey(latitude: number, longitude: number): string {
  return `observations:nws-madis:v1:3h:3stations:500perstation:${JSON.stringify({ latitude, longitude })}`;
}

/** Registers an observed-data resource. It does not replace or splice the modeled forecast. */
export function registerObservations(
  app: FastifyInstance,
  cached: CachedRequests,
  fetcher: ObservationFetcher = fetchNearbyObservations,
  clock: () => number = Date.now,
): void {
  app.get('/api/v1/observations', async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({
      status: 'error', code: 'invalid_request', message: 'Use valid latitude and longitude, with optional refresh=1.',
    });
    const { refresh, ...coordinates } = parsed.data;
    const key = observationsCacheKey(coordinates.latitude, coordinates.longitude);
    const schema = ObservationsDataSchema.refine(data =>
      data.query.latitude === coordinates.latitude && data.query.longitude === coordinates.longitude &&
      data.query.stationLimit === STATION_LIMIT && Date.parse(data.query.until) - Date.parse(data.query.since) === WINDOW_MS,
    'Cached observations must match the requested point and fixed current window.').refine(data =>
      Date.parse(data.retrievedAt) <= clock() + 1_000,
    'Observation retrieval time cannot be in the future.').refine(data =>
      Buffer.byteLength(JSON.stringify(data)) + Buffer.byteLength(key) <= 2 * 1024 ** 2,
    'Observation result exceeds the cache entry bound.');
    try {
      // One point lookup, one bounded station list, and at most three station histories.
      const result = await cached.get(key, schema, 5, 300_000, 600_000, async () => {
        const until = new Date(clock()).toISOString();
        const query = { ...coordinates, since: new Date(Date.parse(until) - WINDOW_MS).toISOString(), until,
          stationLimit: STATION_LIMIT } as const;
        return schema.parse(await fetcher(query, AbortSignal.timeout(10_000)));
      }, 'nws', refresh === '1' ? 10_000 : 300_000);
      return ObservationsResponseSchema.parse({ status: 'success', ...result });
    } catch (error) {
      const limited = error instanceof ProviderError && error.code === 'rate_limited';
      const noData = error instanceof ProviderError && error.code === 'no_data';
      if (limited && error.retryAfterSeconds !== undefined) reply.header('Retry-After', error.retryAfterSeconds);
      return reply.code(limited ? 429 : noData ? 503 : 502).send({
        status: 'error', code: limited ? 'rate_limited' : noData ? 'no_data' : 'provider_error',
        message: limited ? 'Observation provider budget is busy. Try again later.' : noData ?
          'No nearby NWS station observations were published.' : 'Station observations are temporarily unavailable.',
      });
    }
  });
}
