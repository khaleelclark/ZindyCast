import type { FastifyInstance } from 'fastify';
import { StationDataSchema, StationQuerySchema, StationResponseSchema } from '@zindycast/contracts';
import { getStationHistory, StationError } from '@zindycast/stations';
import { ProviderError } from '@zindycast/providers';
import type { CachedRequests } from './cache.js';

/** One normalized selection per cache entry; NOAA still transfers the complete station file. */
export function registerStations(app: FastifyInstance, cached: CachedRequests) {
  app.get('/api/v1/stations/history', async (request, reply) => {
    const parsed = StationQuerySchema.safeParse(request.query);
    if (!parsed.success || parsed.data.endDate > new Date().toISOString().slice(0, 10)) {
      return reply.code(400).send({ status: 'error', code: 'invalid_request',
        message: 'Select an explicit US station ID and 1–366 valid calendar dates through today.' });
    }
    const query = parsed.data;
    const schema = StationDataSchema.refine(data => data.query.stationId === query.stationId &&
      data.query.startDate === query.startDate && data.query.endDate === query.endDate,
    'Cached station selection must match the request.');
    const key = `stations:ghcnd-daily-v1:TMAX,TMIN,PRCP:daily-labels:${JSON.stringify(query)}`;
    try {
      const result = await cached.get(key, schema, 1, 86400000, 0, async () => {
        const controller = new AbortController();
        const started = performance.now();
        const timer = setTimeout(() => controller.abort(new DOMException('Station route deadline exceeded', 'TimeoutError')), 12000);
        try {
          const data = await getStationHistory(query, controller.signal);
          // Parsing is synchronous: elapsed time also catches a deadline crossed while JS was busy.
          if (performance.now() - started >= 12000) throw new StationError('provider_error', 'Station route deadline exceeded.');
          controller.signal.throwIfAborted();
          return data;
        } finally { clearTimeout(timer); }
      }, 'noaa');
      // Never expose an old stale entry, including entries created by another cache policy.
      return StationResponseSchema.parse({ status: 'success', ...result });
    } catch (error) {
      const limited = (error instanceof StationError || error instanceof ProviderError) && error.code === 'rate_limited';
      if (limited && error.retryAfterSeconds !== undefined) reply.header('Retry-After', error.retryAfterSeconds);
      return reply.code(limited ? 429 : 502).send({ status: 'error', code: limited ? 'rate_limited' : 'provider_error',
        message: limited ? 'Station provider budget is busy. Try again later.' : 'Station history is temporarily unavailable.' });
    }
  });
}
