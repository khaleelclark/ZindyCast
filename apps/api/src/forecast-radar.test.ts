import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { SharedStorage,APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { ForecastRadarCatalogResponseSchema } from '@zindycast/contracts';
import { CachedRequests } from './cache.js';
import { registerForecastRadar } from './forecast-radar.js';
const png=Buffer.from(readFileSync('docs/decisions/future-radar.md','utf8').split('```base64\n')[1].split('```')[0].trim(),'base64');
const path='/api/v1/maps/forecast/catalog',key='iem:hrrr:refd:v1:metadata';
function raw(){const r=Math.floor(Date.now()/3600000)*3600000-7200000;return {model_init_utc:new Date(r).toISOString(),model_forecast_utc:new Date(r+64800000).toISOString(),forecast_minute:1080};}
function setup(t:TestContext,storage=new SharedStorage({path:':memory:',providers:APP_PROVIDER_LIMITS,clock:()=>Date.now()})){const app=Fastify();registerForecastRadar(app,new CachedRequests(storage));t.after(async()=>{await app.close();storage.close();});return {app,storage};}
test('catalog singleflight, original retrieval, binary tile bytes, provenance and exact five minute cache',async t=>{
 const {app,storage}=setup(t);const mock=t.mock.method(globalThis,'fetch',async(url:URL)=>url.pathname.endsWith('.json')?new Response(JSON.stringify(raw()),{headers:{'content-type':'application/json'}}):new Response(png,{headers:{'content-type':'image/png'}}));
 const results=await Promise.all([app.inject(path),app.inject(path)]);for(const r of results){assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'private, no-store');ForecastRadarCatalogResponseSchema.parse(r.json());}assert.equal(mock.mock.callCount(),1);
 const c=results[0].json().data,entry=storage.get(key)!;assert.equal(entry.expiresAt-entry.retrievedAt,300000);assert.equal(entry.expiresAt,entry.staleUntil);
 const url=`/api/v1/maps/forecast/tiles/${c.frames[0].id}/4/3/6.png`;
 const tile=await app.inject(url);assert.equal(tile.statusCode,200);assert.deepEqual(tile.rawPayload,png);assert.equal(tile.headers['content-type'],'image/png');assert.equal(tile.headers['x-forecast-model-run'],c.modelRunTime);assert.equal(tile.headers['x-forecast-valid-time'],c.frames[0].validTime);assert.equal(tile.headers['x-forecast-source-time-status'],'pinned_model_run_requested');assert.equal(tile.headers['cache-control'],'private, no-store');
 const hit=await app.inject(url);assert.equal(hit.statusCode,200);assert.equal(hit.headers['x-forecast-retrieved-at'],tile.headers['x-forecast-retrieved-at']);assert.equal(mock.mock.callCount(),2);
 const tileKey=`iem:hrrr:refd:v1:tile:${c.frames[0].id}:4:3:6`,cached=storage.get(tileKey)!;assert.equal(cached.expiresAt-cached.retrievedAt,300000);assert.equal(cached.expiresAt,cached.staleUntil);
});
test('invalid query, XYZ bounds and HI rejected before any provider action',async t=>{
 const {app}=setup(t),mock=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not fetch');});
 for(const url of [path+'?url=anything','/api/v1/maps/forecast/tiles/hrrr-202609111400-f0180/8/3/6.png','/api/v1/maps/forecast/tiles/hrrr-202609111400-f0180/7/7/56.png','/api/v1/maps/forecast/tiles/hrrr-202609111400-f0180/4/03/6.png'])assert.equal((await app.inject(url)).statusCode,400);assert.equal(mock.mock.callCount(),0);
});
test('cached old model cannot regain freshness; expired tile and arbitrary run cannot fetch',async t=>{
 const {app,storage}=setup(t),now=Date.now(),r=now-18000000,modelRunTime=new Date(Math.floor(r/3600000)*3600000).toISOString();storage.set(key,{modelRunTime,horizonEnd:new Date(Date.parse(modelRunTime)+64800000).toISOString(),retrievedAt:new Date(now-1000).toISOString()},{retrievedAt:now,expiresAt:now+300000,staleUntil:now+300000});
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(raw()),{headers:{'content-type':'application/json'}}));const stale=await app.inject(path);assert.equal(stale.statusCode,502);assert.equal(stale.json().code,'model_run_too_old');assert.equal(mock.mock.callCount(),0);
 const other=setup(t);const c=(await other.app.inject(path)).json().data;
 for(const id of ['hrrr-202609101400-f0180',`hrrr-${c.modelRunTime.replace(/[-:]/g,'').replace('T','').slice(0,12)}-f0000`])assert.equal((await other.app.inject(`/api/v1/maps/forecast/tiles/${id}/4/3/6.png`)).statusCode,400);assert.equal(mock.mock.callCount(),1);
});
test('shared NOAA quota charged before fetch; outage redacted and no stale fallback',async t=>{
 const storage=new SharedStorage({path:':memory:',providers:{noaa:{minute:1,hour:1,day:1,month:1}}});storage.reserveQuota('noaa',1);const {app}=setup(t,storage),mock=t.mock.method(globalThis,'fetch',async()=>{throw Error('sensitive URL');});assert.equal((await app.inject(path)).statusCode,429);assert.equal(mock.mock.callCount(),0);
 const other=setup(t),now=Date.now(),source=raw();other.storage.set(key,{modelRunTime:source.model_init_utc,horizonEnd:source.model_forecast_utc,retrievedAt:new Date(now-600000).toISOString()},{retrievedAt:now-600000,expiresAt:now-1000,staleUntil:now+60000});const r=await other.app.inject(path);assert.equal(r.statusCode,502);assert.equal(r.json().code,'provider_error');assert.ok(!r.body.includes('sensitive'));assert.equal(mock.mock.callCount(),1);
});
test('cached tile is rejected once valid time passes; wrong cached XYZ is refetched',async t=>{
 const {app,storage}=setup(t);const mock=t.mock.method(globalThis,'fetch',async(url:URL)=>url.pathname.endsWith('.json')?new Response(JSON.stringify(raw()),{headers:{'content-type':'application/json'}}):new Response(png,{headers:{'content-type':'image/png'}}));
 const c=(await app.inject(path)).json().data,f=c.frames[0],url=`/api/v1/maps/forecast/tiles/${f.id}/4/3/6.png`,tileKey=`iem:hrrr:refd:v1:tile:${f.id}:4:3:6`,now=Date.now();
 storage.set(tileKey,{frameId:f.id,z:4,x:4,y:6,retrievedAt:new Date(now).toISOString(),imageBase64:png.toString('base64')},{retrievedAt:now,expiresAt:now+300000,staleUntil:now+300000});
 assert.equal((await app.inject(url)).statusCode,200);assert.equal(mock.mock.callCount(),2);
 const m=storage.get(key)!,future=Date.parse(f.validTime);t.mock.method(Date,'now',()=>future);
 // Keep metadata cache valid in the simulated clock, so this tests frame gating independently.
 storage.set(key,m.value,{retrievedAt:future,expiresAt:future+300000,staleUntil:future+300000});
 assert.equal((await app.inject(url)).statusCode,400);assert.equal(mock.mock.callCount(),2);
});
