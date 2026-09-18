/** Manual bounded integration audit. Makes at most TWO live upstream GETs. Never run as a fixture test. */
import Fastify from 'fastify';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { ForecastRadarCatalogResponseSchema } from '@zindycast/contracts';
import { CachedRequests } from '../../../apps/api/src/cache.js';
import { registerForecastRadar } from '../../../apps/api/src/forecast-radar.js';
const directory=new URL('./',import.meta.url),original=globalThis.fetch,calls:{url:string;status:number;contentType:string|null;elapsedMs:number}[]=[];
let count=0;
globalThis.fetch=async(input,init)=>{if(++count>2)throw Error('Audit two-GET limit');const url=String(input);assert.equal(new URL(url).hostname,'mesonet.agron.iastate.edu');assert.equal(init?.redirect,'error');const start=performance.now();const r=await original(input,init);calls.push({url,status:r.status,contentType:r.headers.get('content-type'),elapsedMs:performance.now()-start});return r;};
const storage=new SharedStorage({path:':memory:',providers:APP_PROVIDER_LIMITS}),app=Fastify();registerForecastRadar(app,new CachedRequests(storage));
try{
 const response=await app.inject('/api/v1/maps/forecast/catalog');assert.equal(response.statusCode,200,response.body);
 const result=ForecastRadarCatalogResponseSchema.parse(response.json());assert.equal(result.status,'success');if(result.status!=='success')throw Error('Catalog unavailable');
 const catalog=result.data,frame=catalog.frames[2];assert.ok(Date.parse(frame.validTime)>Date.now());
 const tile=await app.inject(`/api/v1/maps/forecast/tiles/${frame.id}/4/3/6.png`);assert.equal(tile.statusCode,200,tile.statusCode===200?'':tile.body);assert.equal(tile.headers['x-forecast-valid-time'],frame.validTime);
 writeFileSync(new URL('live.png',directory),tile.rawPayload);
 writeFileSync(new URL('live.json',directory),JSON.stringify({recordedAt:new Date().toISOString(),kind:'live isolated Fastify injection; not running application or browser',calls,upstreamGetCount:count,catalog,selectedFrame:frame,tile:{bytes:tile.rawPayload.length,sha256:createHash('sha256').update(tile.rawPayload).digest('hex'),headers:tile.headers}},null,2)+'\n');
 console.log(JSON.stringify({upstreamGets:count,run:catalog.modelRunTime,selectedValid:frame.validTime,bytes:tile.rawPayload.length,calls}));
}catch(error){writeFileSync(new URL('live.json',directory),JSON.stringify({recordedAt:new Date().toISOString(),upstreamGetCount:count,calls,error:error instanceof Error?error.message:'audit failed'},null,2));throw error;}
finally{globalThis.fetch=original;await app.close();storage.close();}
