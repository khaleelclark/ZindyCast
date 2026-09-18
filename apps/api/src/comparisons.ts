import type {FastifyInstance,FastifyRequest} from 'fastify';
import {randomUUID} from 'node:crypto';
import {JobRepository,type Job} from '@zindycast/jobs';
import {InstallationRepository,parseBearerHeader} from '@zindycast/installations';
import {ComparisonQuerySchema,ComparisonJobSchema,ComparisonResultSchema} from '@zindycast/contracts';
import {createComparisonPlan} from '@zindycast/comparison';
export interface JobServices {jobs:JobRepository;installations:InstallationRepository}
export function registerComparisons(app:FastifyInstance,{jobs,installations}:JobServices) {
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
 app.post('/api/v1/installations',async(request,reply)=>{
  if(!mutationAllowed(request))return reply.code(403).send(error('invalid_request','Same-origin application request required.'));
  const now=Date.now();while(registrationTimes.length && registrationTimes[0]!<=now-3600000)registrationTimes.shift();
  if(registrationTimes.length>=10)return reply.header('Retry-After',Math.max(1,Math.ceil((registrationTimes[0]!+3600000-now)/1000))).code(429).send(error('rate_limited','Installation registration limit reached. Try later.'));
  registrationTimes.push(now);
  try{return reply.code(201).send(installations.register(365*86400000));}catch{return reply.code(503).send(error('rate_limited','Installation capacity is unavailable.'));}
 });
 app.post('/api/v1/comparisons',async(request,reply)=>{
  if(!mutationAllowed(request))return reply.code(403).send(error('invalid_request','Same-origin application request required.'));
  const bearer=parseBearerHeader(request.headers.authorization);const identity=bearer?installations.authenticate(bearer):null;
  if(!bearer||!identity)return reply.code(401).send(error('unauthorized','Installation credential required.'));
  const q=ComparisonQuerySchema.safeParse(request.body);
  if(!q.success)return reply.code(400).send(error('invalid_request','Select 2–5 locations and 1–366 shared UTC days.'));
  const plan=createComparisonPlan(q.data);const latest=new Date(Math.floor(Date.now()/86400000)*86400000-5*86400000).toISOString().slice(0,10);
  if(plan.fetchEndDate>latest)return reply.code(400).send(error('invalid_request','The closing precipitation interval is not yet available. Use a period ending at least six UTC days ago.'));
  const id=randomUUID(),expiresAt=Math.min(identity.expiresAt,Date.now()+7*86400000);
  try{
   if(!installations.reserveJob(bearer,id,expiresAt))return reply.code(429).send(error('rate_limited','This installation has reached its job limit.'));
   const job=jobs.enqueue({id,kind:'comparison-v1',payload:q.data,expiresAt,maxAttempts:3});
   return reply.code(202).send(publicJob(job));
  }catch{ try{if(!jobs.get(id))installations.releaseJob(id);}catch{/* Ambiguous enqueue stays charged until expiry. */}return reply.code(503).send(error('provider_error','Comparison could not be queued.'));}
 });
 app.get<{Params:{id:string}}>('/api/v1/comparisons/:id',async(request,reply)=>{
  const bearer=parseBearerHeader(request.headers.authorization),id=request.params.id;
  if(!/^[a-f0-9-]{36}$/.test(id)||!bearer||!installations.authorizeJob(bearer,id))return reply.code(404).send(error('not_found','Job unavailable for this installation.'));
  const job=jobs.get(id);if(!job || job.kind!=='comparison-v1')return reply.code(404).send(error('not_found','Job expired or unavailable.'));
  return publicJob(job);
 });
 app.post<{Params:{id:string}}>('/api/v1/comparisons/:id/cancel',async(request,reply)=>{
  if(!mutationAllowed(request))return reply.code(403).send(error('invalid_request','Same-origin application request required.'));
  const bearer=parseBearerHeader(request.headers.authorization),id=request.params.id;
  if(!/^[a-f0-9-]{36}$/.test(id)||!bearer||!installations.authorizeJob(bearer,id))return reply.code(404).send(error('not_found','Job unavailable for this installation.'));
  if(jobs.get(id)?.kind!=='comparison-v1')return reply.code(404).send(error('not_found','Job unavailable'));
  jobs.cancel(id);const job=jobs.get(id);
  if(!job)return reply.code(404).send(error('not_found','Job expired or unavailable.'));
  if(jobs.closeTerminalAdmission(id))installations.releaseJob(id);
  return publicJob(job);
 });
}
