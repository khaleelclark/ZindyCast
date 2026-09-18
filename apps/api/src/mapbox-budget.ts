import type { FastifyInstance } from 'fastify';
import type { SharedStorage } from '@zindycast/storage';
/** No proxy or credential. The browser reserves one unit before its own tile fetch. */
export function registerMapboxBudget(app: FastifyInstance, storage: Pick<SharedStorage, 'reserveMapboxRequest'>) {
 app.post('/api/v1/maps/mapbox/admission', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  if (request.headers['sec-fetch-site'] === 'cross-site' || Object.keys(request.query as object).length || request.body != null) return reply.code(400).send({allowed:false,reason:'unavailable',limit:190000});
  try {
   const result=storage.reserveMapboxRequest();
   if (!result.allowed) return reply.code(429).send({...result,reason:'limit'});
   return result;
  } catch {return reply.code(503).send({allowed:false,reason:'unavailable',limit:190000});}
 });
}
