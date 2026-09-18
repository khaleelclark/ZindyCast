import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ForecastRadarCatalogResponseSchema, ForecastRadarMetadataSchema } from '@zindycast/contracts';
import { buildForecastRadarCatalog, buildForecastRadarTileRequest, fetchForecastRadarTile, getForecastRadarMetadata, validateForecastRadarTile, validateForecastRadarPng, ForecastRadarError } from '@zindycast/maps';
import { ProviderError } from '@zindycast/providers';
import type { CachedRequests } from './cache.js';
const integer=z.string().regex(/^(?:0|[1-9]\d{0,2})$/).pipe(z.coerce.number<string>().int());
const paramsSchema=z.strictObject({frameId:z.string().regex(/^hrrr-\d{12}-f\d{4}$/),z:integer,x:integer,y:integer});
const tileSchema=z.object({frameId:z.string(),z:z.number().int(),x:z.number().int(),y:z.number().int(),retrievedAt:z.iso.datetime(),imageBase64:z.string().min(44).max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)});
const noQuery=z.strictObject({});
function failure(error:unknown,reply:FastifyReply){
 const code=error instanceof ForecastRadarError?error.code:error instanceof ProviderError&&error.code==='rate_limited'?'rate_limited':'provider_error';
 if(code==='rate_limited')reply.header('Retry-After',error instanceof ForecastRadarError||error instanceof ProviderError?error.retryAfterSeconds??60:60);
 const status=code==='rate_limited'?429:['invalid_request','outside_supported_region'].includes(code)?400:502;
 return reply.code(status).send({status:'error',code,message:code==='rate_limited'?'Forecast imagery budget is busy. Try again later.':code==='invalid_request'||code==='outside_supported_region'?'Select a current future frame and supported CONUS tile.':code==='model_run_too_old'?'The available HRRR run is too old.':'Forecast imagery is temporarily unavailable.'});
}
export function registerForecastRadar(app:FastifyInstance,cached:CachedRequests){
 const metadata=()=>cached.get('iem:hrrr:refd:v1:metadata',ForecastRadarMetadataSchema,1,300000,0,()=>getForecastRadarMetadata(),'noaa');
 app.get('/api/v1/maps/forecast/catalog',async(request,reply)=>{
  reply.header('Cache-Control','private, no-store');
  if(!noQuery.safeParse(request.query).success)return failure(new ForecastRadarError('invalid_request','No query accepted'),reply);
  try{const result=await metadata();return ForecastRadarCatalogResponseSchema.parse({status:'success',freshness:result.freshness,data:buildForecastRadarCatalog(result.data)});}catch(error){return failure(error,reply);}
 });
 app.get('/api/v1/maps/forecast/tiles/:frameId/:z/:x/:y.png',async(request,reply)=>{
  reply.header('Cache-Control','private, no-store');
  const p=paramsSchema.safeParse(request.params);
  if(!p.success||!noQuery.safeParse(request.query).success)return failure(new ForecastRadarError('invalid_request','Invalid tile'),reply);
  const {frameId,z,x,y}=p.data;
  try{
   validateForecastRadarTile(frameId,z,x,y);
   const m=(await metadata()).data;
   buildForecastRadarTileRequest(frameId,z,x,y,m);
   const schema=tileSchema.refine(t=>t.frameId===frameId&&t.z===z&&t.x===x&&t.y===y&&Date.parse(t.retrievedAt)<=Date.now(),'Cached tile identity must match request');
   const result=await cached.get(`iem:hrrr:refd:v1:tile:${frameId}:${z}:${x}:${y}`,schema,1,300000,0,async()=>{const image=await fetchForecastRadarTile(frameId,z,x,y,m);return {frameId,z,x,y,retrievedAt:image.retrievedAt,imageBase64:image.bytes.toString('base64')};},'noaa');
   // Recheck current eligibility even for server-cache hits or slow requests.
   buildForecastRadarTileRequest(frameId,z,x,y,m);
   const c=buildForecastRadarCatalog(m),frame=c.frames.find(f=>f.id===frameId)!;
   const bytes=Buffer.from(result.data.imageBase64,'base64');validateForecastRadarPng(bytes);
   reply.headers({'X-Content-Type-Options':'nosniff','X-Forecast-Product':c.productId,'X-Forecast-Frame':frameId,'X-Forecast-Model-Run':frame.modelRunTime,'X-Forecast-Valid-Time':frame.validTime,'X-Forecast-Lead-Minutes':String(frame.forecastLeadMinutes),'X-Forecast-Retrieved-At':result.data.retrievedAt,'X-Forecast-Metadata-Retrieved-At':m.retrievedAt,'X-Forecast-Evaluated-At':c.evaluatedAt,'X-Forecast-Source-Time-Status':c.sourceTimeStatus,'X-Forecast-Coverage':'unknown','X-Forecast-Attribution':c.attribution,'X-Forecast-Freshness':result.freshness});
   return reply.type('image/png').send(bytes);
  }catch(error){return failure(error,reply);}
 });
}
