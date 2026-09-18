import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {getReanalysis,renderReanalysisCsv,HistoryError} from '@zindycast/history';
import {ReanalysisQuerySchema,ReanalysisDataSchema} from '@zindycast/contracts';
import {ProviderError} from '@zindycast/providers';
import {CachedRequests} from './cache.js';
export function registerHistory(app:FastifyInstance,cached:CachedRequests) {
 app.get('/api/v1/history',async(request,reply)=>{
  const parsed=z.object({latitude:z.coerce.number().finite(),longitude:z.coerce.number().finite(),startDate:z.string(),endDate:z.string(),format:z.enum(['json','csv']).default('json'),name:z.string().max(160).default('')}).safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({status:'error',code:'invalid_request',message:'Select coordinates and 1–31 UTC dates.'});
  const {format,name,...raw}=parsed.data;const q=ReanalysisQuerySchema.safeParse(raw);
  const latest=new Date(Math.floor(Date.now()/86400000)*86400000-5*86400000).toISOString().slice(0,10);
  if(!q.success || q.data.endDate>latest)return reply.code(400).send({status:'error',code:'invalid_request',message:`Select 1–31 UTC days from 1940-01-01 through ${latest}.`});
  try{
   const days=(Date.parse(q.data.endDate)-Date.parse(q.data.startDate))/86400000+1;
   const result=await cached.get(`history:era5:5fields:utc:v1:${JSON.stringify(q.data)}`,ReanalysisDataSchema,Math.max(1,Math.ceil(days/14)),86400000,0,()=>getReanalysis(q.data,AbortSignal.timeout(10000)));
   if(format==='csv')return reply.type('text/csv; charset=utf-8').header('Content-Disposition',`attachment; filename="zindycast-era5-${q.data.startDate}-${q.data.endDate}.csv"`).send(renderReanalysisCsv(result.data,name));
   return {status:'success',...result};
  }catch(error){const limit=(error instanceof HistoryError || error instanceof ProviderError)&&error.code==='rate_limited';if(limit && error.retryAfterSeconds!==undefined)reply.header('Retry-After',error.retryAfterSeconds);return reply.code(limit?429:502).send({status:'error',code:limit?'rate_limited':'provider_error',message:limit?'Historical provider budget is busy. Try again later.':'Historical data are temporarily unavailable.'});}
 });
}
