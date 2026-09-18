import type {FastifyInstance} from 'fastify';import {z} from 'zod';
import {ClimateNormalsSchema} from '../../../packages/contracts/src/climate-normals.js';
import {fetchClimateNormals} from '../../../packages/providers/src/climate-normals.js';
import {ProviderError} from '@zindycast/providers';import type {CachedRequests} from './cache.js';
export function registerClimateNormals(app:FastifyInstance,cached:CachedRequests,fetcher=fetchClimateNormals){
 app.get('/api/v1/climate-normals',async(r,reply)=>{const q=z.object({stationId:z.string().regex(/^US[A-Z0-9]{9}$/)}).strict().safeParse(r.query);if(!q.success)return reply.code(400).send({status:'error',code:'invalid_request',message:'Choose a US station.'});
 try{const data=await cached.get(`normals:1991-2020:v1:${q.data.stationId}`,ClimateNormalsSchema.refine(d=>d.stationId===q.data.stationId),1,86400000,0,()=>fetcher(q.data.stationId),'noaa');return {status:'success',...data};}
 catch(e){const absent=e instanceof ProviderError&&e.code==='no_data';return reply.code(absent?404:502).send({status:'error',code:absent?'no_data':'provider_error',message:absent?'NOAA has no monthly normals file for this station. Choose another station.':'Climate normals are temporarily unavailable.'});}});
}
