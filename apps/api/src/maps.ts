import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {getMapCatalog,fetchMapImage,buildMapRequest,MapError,type MapCatalog} from '@zindycast/maps';
import {MapCatalogSchema,MapFrameSchema} from '@zindycast/contracts';
import {ProviderError} from '@zindycast/providers';
import {CachedRequests} from './cache.js';
function rateLimit(error: unknown, reply: FastifyReply): boolean {
 if (!(error instanceof ProviderError || error instanceof MapError) || error.code !== 'rate_limited') return false;
 reply.header('Retry-After', error.retryAfterSeconds ?? 60).code(429);
 return true;
}
export function registerMaps(app:FastifyInstance,cached:CachedRequests) {
 const catalog=()=>cached.get('noaa:catalog:v2',MapCatalogSchema,1,120000,0,async()=>MapCatalogSchema.parse(await getMapCatalog()),'noaa');
 app.get('/api/v1/maps',async(_request,reply)=>{
  try{return {status:'success',...await catalog()};}
  catch(error){if(rateLimit(error,reply))return reply.send({status:'error',code:'rate_limited',message:'Map provider budget is busy. Try again later.'});return reply.code(502).send({status:'error',code:'provider_error',message:'Map catalog is temporarily unavailable.'});}
 });
 app.get('/api/v1/maps/frame',async(request,reply)=>{
  const q=z.object({product:z.string().max(60),west:z.coerce.number().finite(),south:z.coerce.number().finite(),east:z.coerce.number().finite(),north:z.coerce.number().finite(),width:z.coerce.number().int().min(1).max(800).default(800),height:z.coerce.number().int().min(1).max(600).default(500),time:z.iso.datetime(),projection:z.enum(['CRS:84','EPSG:3857']).default('CRS:84')}).safeParse(request.query);
  if(!q.success)return reply.code(400).send({status:'error',code:'invalid_request',message:'Valid map bounds, size, product and advertised time are required.'});
  try {
   const c=(await catalog()).data;
   const {product,west,south,east,north,width,height,time,projection}=q.data;const bbox=[west,south,east,north] as const;
   buildMapRequest(product,bbox,width,height,time,c,projection);
   const frameSchema=MapFrameSchema.refine(frame=>frame.projection===projection && frame.productId===product && frame.requestedTime===time,'Cached frame must match requested projection/product/time');
   const result=await cached.get(`noaa:frame:v2:${JSON.stringify(q.data)}`,frameSchema,1,300000,0,async()=>{
    const image=await fetchMapImage(product,bbox,width,height,time,c,undefined,projection);
    return frameSchema.parse({...image,imageBase64:image.bytes.toString('base64')});
   },'noaa');
   return {status:'success',...result};
  }catch(error){if(rateLimit(error,reply))return reply.send({status:'error',code:'rate_limited',message:'Map provider budget is busy. Try again later.'});const invalid=error instanceof MapError && ['invalid_request','outside_extent','unavailable'].includes(error.code);return reply.code(invalid?400:502).send({status:'error',code:invalid?'invalid_request':'provider_error',message:invalid?'Map selection is outside the available product or timeline.':'Map frame is temporarily unavailable.'});}
 });
}
