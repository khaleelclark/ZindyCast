import {z} from 'zod';
import {CachedRequests} from './cache.js';
import {ComparisonWeatherDataSchema,ClimateDetailSchema} from '@zindycast/contracts';
import {fetchComparisonWeather} from '@zindycast/history';
import {summarizeClimateDays,localDayBounds,coveringUtcDates} from '@zindycast/comparison';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {JobRepository,type Job} from '@zindycast/jobs';
import {InstallationRepository,parseBearerHeader} from '@zindycast/installations';
import {ClimateQuerySchema as ComparisonQuerySchema,ClimateJobSchema as ComparisonJobSchema,ClimateResultSchema as ComparisonResultSchema} from '@zindycast/contracts';
import {createClimatePlan} from '@zindycast/comparison';
export interface JobServices {jobs:JobRepository;installations:InstallationRepository}
export function registerClimateComparisons(app:FastifyInstance,{jobs,installations}:JobServices,cached:CachedRequests) {
 const registrationTimes:number[]=[];
 const error=(code:string,message:string)=>({status:'error',code,message});
 const mutationAllowed=(r:FastifyRequest)=>{
  if(r.headers['x-zindycast-request']!=='1')return false;
  const site=r.headers['sec-fetch-site'];
  if(site!==undefined && site!=='same-origin' && site!=='none')return false;
  if(!r.headers.origin)return true;
  try{
   const origin=new URL(r.headers.origin);
   // Only a serialized web origin: no opaque schemes, credentials, paths,
   // queries or fragments. Forwarded headers are not trusted here.
   return (origin.protocol==='https:'||origin.protocol==='http:') && origin.origin===r.headers.origin && origin.host===r.headers.host;
  }catch{return false;}
 };
 const publicJob=(job:Job)=>ComparisonJobSchema.parse({id:job.id,state:job.state,progress:job.progress,attempt:job.attempt,expiresAt:job.expiresAt,createdAt:job.createdAt,error:job.error,query:ComparisonQuerySchema.parse(job.payload),result:job.state==='completed'?ComparisonResultSchema.parse(job.result):null});
 app.post('/api/v1/climate-comparisons',async(request,reply)=>{
  if(!mutationAllowed(request))return reply.code(403).send(error('invalid_request','Same-origin application request required.'));
  const bearer=parseBearerHeader(request.headers.authorization);const identity=bearer?installations.authenticate(bearer):null;
  if(!bearer||!identity)return reply.code(401).send(error('unauthorized','Installation credential required.'));
  const q=ComparisonQuerySchema.safeParse(request.body);
  if(!q.success)return reply.code(400).send(error('invalid_request','Select 2–5 locations and valid local dates or full years.'));
  let plan;try{plan=createClimatePlan(q.data);}catch{return reply.code(400).send(error('invalid_request','These local calendar dates cannot be resolved.'));}const latest=new Date(Math.floor(Date.now()/86400000)*86400000-5*86400000).toISOString().slice(0,10);
  if(plan.fetchEndDate>latest)return reply.code(400).send(error('invalid_request','The closing precipitation interval is not yet available. Use a period ending at least six UTC days ago.'));
  const id=randomUUID(),expiresAt=Math.min(identity.expiresAt,Date.now()+7*86400000);
  try{
   if(!installations.reserveJob(bearer,id,expiresAt))return reply.code(429).send(error('rate_limited','This installation has reached its job limit.'));
   const job=jobs.enqueue({id,kind:'climate-comparison-v2',payload:q.data,expiresAt,maxAttempts:3});
   return reply.code(202).send(publicJob(job));
  }catch{ try{if(!jobs.get(id))installations.releaseJob(id);}catch{/* Ambiguous enqueue stays charged until expiry. */}return reply.code(503).send(error('provider_error','Comparison could not be queued.'));}
 });
 app.get<{Params:{id:string}}>('/api/v1/climate-comparisons/:id',async(request,reply)=>{
  const bearer=parseBearerHeader(request.headers.authorization),id=request.params.id;
  if(!/^[a-f0-9-]{36}$/.test(id)||!bearer||!installations.authorizeJob(bearer,id))return reply.code(404).send(error('not_found','Job unavailable for this installation.'));
  const job=jobs.get(id);if(!job || job.kind!=='climate-comparison-v2')return reply.code(404).send(error('not_found','Job expired or unavailable.'));
  return publicJob(job);
 });
 app.post<{Params:{id:string}}>('/api/v1/climate-comparisons/:id/cancel',async(request,reply)=>{
  if(!mutationAllowed(request))return reply.code(403).send(error('invalid_request','Same-origin application request required.'));
  const bearer=parseBearerHeader(request.headers.authorization),id=request.params.id;
  if(!/^[a-f0-9-]{36}$/.test(id)||!bearer||!installations.authorizeJob(bearer,id))return reply.code(404).send(error('not_found','Job unavailable for this installation.'));
  if(jobs.get(id)?.kind!=='climate-comparison-v2')return reply.code(404).send(error('not_found','Job unavailable'));
  jobs.cancel(id);const job=jobs.get(id);
  if(!job)return reply.code(404).send(error('not_found','Job expired or unavailable.'));
  if(jobs.closeTerminalAdmission(id))installations.releaseJob(id);
  return publicJob(job);
 });
 app.get<{Params:{id:string}}>('/api/v1/climate-comparisons/:id/detail',async(request,reply)=>{
  const bearer=parseBearerHeader(request.headers.authorization),id=request.params.id;
  if(!bearer||!installations.authorizeJob(bearer,id))return reply.code(404).send(error('not_found','Comparison unavailable.'));
  const job=jobs.get(id);if(!job||job.kind!=='climate-comparison-v2'||job.state!=='completed')return reply.code(404).send(error('not_found','Completed comparison unavailable.'));
  const p=z.object({locationId:z.string(),startDate:z.iso.date(),endDate:z.iso.date()}).safeParse(request.query);
  const selected=ComparisonQuerySchema.parse(job.payload);
  const location=p.success?selected.locations.find(l=>l.id===p.data.locationId):undefined;
  if(!p.success||!location||p.data.startDate<selected.startDate||p.data.endDate>selected.endDate||p.data.endDate<p.data.startDate||Date.parse(p.data.endDate)-Date.parse(p.data.startDate)>=31*86400000)return reply.code(400).send(error('invalid_request','Select 1–31 local dates inside this comparison.'));
  try{
   const start=localDayBounds(p.data.startDate,location.timezone).start,end=localDayBounds(p.data.endDate,location.timezone).end;
   const envelope=coveringUtcDates(start,end);const chunks=[];
   for(let cursor=Date.parse(envelope.startDate);cursor<=Date.parse(envelope.endDate);cursor+=31*86400000){
    const q={latitude:location.latitude,longitude:location.longitude,startDate:new Date(cursor).toISOString().slice(0,10),endDate:new Date(Math.min(cursor+30*86400000,Date.parse(envelope.endDate))).toISOString().slice(0,10)};
    const days=(Date.parse(q.endDate)-Date.parse(q.startDate))/86400000+1;
    const r=await cached.get('climate:era5:9fields:utc:v2:'+JSON.stringify(q),ComparisonWeatherDataSchema,Math.ceil(days/14),86400000,0,()=>fetchComparisonWeather(q,AbortSignal.timeout(10000)));
    if(JSON.stringify(r.data.query)!==JSON.stringify(q))throw Error('Mismatched detail');chunks.push(r.data);
   }
   const hours=chunks.flatMap(c=>c.hours);const days=summarizeClimateDays(hours,location.timezone,p.data.startDate,p.data.endDate);
   return ClimateDetailSchema.parse({status:'success',location,startDate:p.data.startDate,endDate:p.data.endDate,days,hours:hours.filter(h=>Date.parse(h.time)>=start&&Date.parse(h.time)<=end),sources:chunks.map(c=>c.provenance)});
  }catch{return reply.code(502).send(error('provider_error','Detailed history unavailable; retry when the provider budget and connection are available.'));}
 });

}
