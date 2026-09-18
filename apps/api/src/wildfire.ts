import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { WildfireBboxSchema, WildfireDataSchema, WildfireResponseSchema } from '@zindycast/contracts';
import { getWildfires, ProviderError } from '@zindycast/providers';
import type { CachedRequests } from './cache.js';

// Reject blank strings/arrays/unknown keys before numeric coercion.
const coordinate = z.string().trim().min(1).pipe(z.coerce.number<string>().finite());
const QuerySchema = z.strictObject({ west: coordinate, south: coordinate, east: coordinate, north: coordinate }).pipe(WildfireBboxSchema);
export function registerWildfires(app: FastifyInstance, cached: CachedRequests) {
  app.get('/api/v1/wildfires', async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: 'error', code: 'invalid_request',
      message: 'Select a non-wrapping viewport no larger than 10 degrees on either axis.' });
    const bbox = parsed.data;
    // v1 fixes both authoritative layers, selected fields, EPSG:4326 and Esri JSON geometry.
    const key = `wildfires:wfigs-current-v1:4326:esri-json:${JSON.stringify(bbox)}`;
    const schema = WildfireDataSchema.refine(data =>
      Object.keys(bbox).every(k => data.bbox[k as keyof typeof bbox] === bbox[k as keyof typeof bbox]),
    'Cached wildfire viewport must match the request.').refine(data =>
      Buffer.byteLength(JSON.stringify(data)) + Buffer.byteLength(key) <= 2 * 1024 ** 2,
    'Wildfire result exceeds the 2 MiB cache entry limit; select a smaller viewport.');
    try {
      const result = await cached.get(key, schema, 8, 300000, 0, async () => {
        const controller = new AbortController();
        const started = performance.now();
        const timer = setTimeout(() => controller.abort(new DOMException('Wildfire route deadline exceeded', 'TimeoutError')), 10000);
        try {
          const data = await getWildfires(bbox, controller.signal);
          if (performance.now() - started >= 10000) throw new ProviderError('provider_error', 'Wildfire route deadline exceeded.');
          controller.signal.throwIfAborted();
          return schema.parse(data);
        } finally { clearTimeout(timer); }
      }, 'noaa');
      return WildfireResponseSchema.parse({ status: 'success', ...result });
    } catch (error) {
      const limited = error instanceof ProviderError && error.code === 'rate_limited';
      if (limited && error.retryAfterSeconds !== undefined) reply.header('Retry-After', error.retryAfterSeconds);
      return reply.code(limited ? 429 : 502).send({ status: 'error', code: limited ? 'rate_limited' : 'provider_error',
        message: limited ? 'Wildfire provider budget is busy. Try again later.' : 'Wildfire data unavailable or viewport too large. Try a smaller viewport.' });
    }
  });
}
