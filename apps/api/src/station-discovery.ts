import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { StationDiscoveryQuerySchema, StationDiscoveryDataSchema, StationDiscoveryResponseSchema } from '@zindycast/contracts';
import { getStationDiscovery, StationError } from '@zindycast/stations';
import { ProviderError } from '@zindycast/providers';
import type { CachedRequests } from './cache.js';
const coordinate=z.string().regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/).pipe(z.coerce.number<string>().finite());
const querySchema=z.strictObject({latitude:coordinate,longitude:coordinate}).pipe(StationDiscoveryQuerySchema);
export function registerStationDiscovery(app:FastifyInstance,cached:CachedRequests) {
  app.get('/api/v1/stations/nearby',async(request,reply)=>{
    const parsed=querySchema.safeParse(request.query);
    if(!parsed.success) return reply.code(400).send({status:'error',code:'invalid_request',message:'Use valid latitude and longitude only.'});
    const query=parsed.data;
    const schema=StationDiscoveryDataSchema.refine(d=>d.query.latitude===query.latitude && d.query.longitude===query.longitude,'Cached coordinates must match request.');
    const key=`stations:ghcnd-discovery-v1:US:150km:10:${JSON.stringify(query)}`;
    try {
      const result=await cached.get(key,schema,1,86400000,0,()=>getStationDiscovery(query),'noaa');
      return StationDiscoveryResponseSchema.parse({status:'success',...result});
    } catch(error) {
      const limited=(error instanceof StationError || error instanceof ProviderError) && error.code==='rate_limited';
      if(limited && error.retryAfterSeconds!==undefined) reply.header('Retry-After',error.retryAfterSeconds);
      return reply.code(limited?429:502).send({status:'error',code:limited?'rate_limited':'provider_error',
        message:limited?'Station metadata budget is busy. Try again later.':'Station discovery is temporarily unavailable.'});
    }
  });
}
