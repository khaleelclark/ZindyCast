import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { LibreRadarCatalogSchema } from '@zindycast/contracts';
import { ProviderError } from '@zindycast/providers';
import type { CachedRequests } from './cache.js';
const epoch = z.number().int().positive().max(4102444800);
const upstream = z.object({version:z.literal('2.0'), generated:epoch, radar:z.object({past:z.array(z.object({time:epoch,path:z.string()})).max(100),nowcast:z.array(z.object({time:epoch,path:z.string()})).max(100)})});
const noQuery=z.strictObject({});
const integer=z.string().regex(/^(?:0|[1-9]\d{0,9})$/).pipe(z.coerce.number<string>().int());
const params=z.strictObject({time:integer,z:integer,x:integer,y:integer});
const tileRecord=z.object({time:epoch,z:z.number(),x:z.number(),y:z.number(),image:z.string().max(2800000)});
function error(reply:FastifyReply,cause:unknown){
 if(cause instanceof ProviderError&&cause.code==='rate_limited') return reply.header('Retry-After',cause.retryAfterSeconds??60).code(429).send({status:'error',message:'LibreWXR is busy. Wait before retrying.'});
 return reply.code(502).send({status:'error',message:'LibreWXR is unavailable. Use NOAA radar.'});
}
function eligible(c:z.infer<typeof LibreRadarCatalogSchema>,now=Date.now()){
 if(c.generated*1000>now+60000||now-c.generated*1000>1200000)throw Error('Stale catalog');
 return {...c,past:c.past.filter(t=>t*1000<=now&&now-t*1000<=8400000),nowcast:c.nowcast.filter(t=>t*1000>now&&t<=c.generated+3600)};
}
async function bytes(url:URL,limit:number,type:string){
 const response=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error',credentials:'omit'});
 if(response.status===429)throw new ProviderError('rate_limited','Upstream limited',429,60);
 if(!response.ok||!response.headers.get('content-type')?.startsWith(type))throw Error('Provider response');
 const reader=response.body?.getReader();if(!reader)throw Error('Empty response');const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Response too large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return {body:Buffer.concat(chunks),response};
}
function validatePng(b:Buffer){if(b.length<24||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b.readUInt32BE(16)!==512||b.readUInt32BE(20)!==512)throw Error('Invalid PNG');}
export function registerLibreRadar(app:FastifyInstance,cached:CachedRequests){
 const catalog=async()=>eligible((await cached.get('librewxr:v1:catalog',LibreRadarCatalogSchema,1,60000,0,async()=>{
  const {body}=await bytes(new URL('https://api.librewxr.net/public/weather-maps.json'),65536,'application/json');const raw=upstream.parse(JSON.parse(body.toString()));
  for(const f of [...raw.radar.past,...raw.radar.nowcast])if(f.path!==`/v2/radar/${f.time}`)throw Error('Frame identity');
  return eligible({status:'success',generated:raw.generated,retrievedAt:new Date().toISOString(),past:[...new Set(raw.radar.past.map(f=>f.time))].sort((a,b)=>a-b).slice(-12),nowcast:[...new Set(raw.radar.nowcast.map(f=>f.time))].sort((a,b)=>a-b).slice(0,12)});
 },'noaa')).data);
 app.get('/api/v1/maps/libre/catalog',async(request,reply)=>{
  reply.header('Cache-Control','private, no-store');if(!noQuery.safeParse(request.query).success)return reply.code(400).send({status:'error'});
  try{return await catalog();}catch(cause){return error(reply,cause);}
 });
 app.get('/api/v1/maps/libre/tiles/:time/:z/:x/:y.png',async(request,reply)=>{
  reply.header('Cache-Control','private, no-store');const p=params.safeParse(request.params);
  if(!p.success||!noQuery.safeParse(request.query).success)return reply.code(400).send({status:'error'});
  const {time,z,x,y}=p.data;if(z<0||z>10||x>=2**z||y>=2**z||time===0)return reply.code(400).send({status:'error'});
  try{
   const c=await catalog(),wasFuture=c.nowcast.includes(time);if(!c.past.includes(time)&&!wasFuture)return reply.code(400).send({status:'error',message:'Frame expired. Refresh radar times.'});
   const record=tileRecord.refine(t=>t.time===time&&t.z===z&&t.x===x&&t.y===y);
   const result=await cached.get(`librewxr:v1:${time}:${z}:${x}:${y}:6:1_0`,record,1,300000,0,async()=>{
    const {body,response}=await bytes(new URL(`https://api.librewxr.net/v2/radar/${time}/512/${z}/${x}/${y}/6/1_0.png`),2097152,'image/png');
    if(response.headers.get('x-frame-timestamp')!==String(time))throw Error('Wrong frame');validatePng(body);return {time,z,x,y,image:body.toString('base64')};
   },'noaa');
   const fresh=eligible(c);if(wasFuture? !fresh.nowcast.includes(time): !fresh.past.includes(time))return reply.code(400).send({status:'error',message:'Frame expired.'});
   const body=Buffer.from(result.data.image,'base64');validatePng(body);return reply.header('X-Libre-Frame',String(time)).type('image/png').send(body);
  }catch(cause){return error(reply,cause);}
 });
}
