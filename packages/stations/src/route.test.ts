import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { StationResponseSchema, StationDataSchema as SharedSchema } from '@zindycast/contracts';
import { CachedRequests } from '../../../apps/api/src/cache.js';
import { registerStations } from '../../../apps/api/src/stations.js';
import { StationDataSchema, parseStationDaily } from './index.js';
const query = {stationId:'USC00021282',startDate:'2020-01-01',endDate:'2020-01-01'};
const url = '/api/v1/stations/history?' + new URLSearchParams(query);
const raw = query.stationId + '202001TMAX' + '  123  7'.repeat(31);
const key = `stations:ghcnd-daily-v1:TMAX,TMIN,PRCP:daily-labels:${JSON.stringify(query)}`;
function setup(t: TestContext, storage = new SharedStorage({path:':memory:',providers:APP_PROVIDER_LIMITS})) {
  const app=Fastify(); registerStations(app,new CachedRequests(storage));
  t.after(async()=>{await app.close();storage.close();}); return {app,storage};
}
test('shared runtime schema is the same object; route validates input and returns bounded normalized cached data',async t=>{
  assert.equal(SharedSchema,StationDataSchema);
  const {app}=setup(t);
  const mock=t.mock.method(globalThis,'fetch',async()=>new Response(raw,{headers:{'content-type':'text/plain'}}));
  for(const query of ['stationId=../../etc/passwd&startDate=2020-01-01&endDate=2020-01-01',
    'stationId=USC00021282&startDate=2021-02-29&endDate=2021-03-01',
    'stationId=USC00021282&startDate=9999-01-01&endDate=9999-01-01',
    'stationId=USC00021282&startDate=2020-01-01&endDate=2020-01-01&extra=x']) {
    assert.equal((await app.inject('/api/v1/stations/history?'+query)).statusCode,400);
  }
  assert.equal(mock.mock.callCount(),0);
  const a=await app.inject(url), b=await app.inject(url);
  assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);
  const response=StationResponseSchema.parse(a.json());assert.equal(response.freshness,'fresh');
  assert.equal(response.data.days[0].TMAX.value,12.3);assert.equal(mock.mock.callCount(),1);
  assert.equal(response.data.timeContext.timezone,null);
});
test('NOAA quota refusal prevents fetch; upstream retry-after and failures map correctly',async t=>{
  const storage=new SharedStorage({path:':memory:',providers:{noaa:{minute:1,hour:1,day:1,month:1}}});
  storage.reserveQuota('noaa',1);const {app}=setup(t,storage);
  const mock=t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429,headers:{'retry-after':'17'}}));
  assert.equal((await app.inject(url)).statusCode,429);assert.equal(mock.mock.callCount(),0);
  const other=setup(t).app;const limited=await other.inject(url);assert.equal(limited.statusCode,429);assert.equal(limited.headers['retry-after'],'17');
  mock.mock.mockImplementation(async()=>new Response('invalid',{headers:{'content-type':'text/plain'}}));
  assert.equal((await other.inject(url)).statusCode,502);
});
test('cache refuses mismatched query, never serves stale, stores selected JSON with one-day expiry',async t=>{
  const {app,storage}=setup(t);const now=Date.now();
  const wrong=parseStationDaily(raw,{...query,startDate:'2020-01-02',endDate:'2020-01-02'},new Date(now).toISOString());
  storage.set(key,JSON.parse(JSON.stringify(wrong)),{retrievedAt:now,expiresAt:now+10000,staleUntil:now+20000});
  const mock=t.mock.method(globalThis,'fetch',async()=>new Response(raw,{headers:{'content-type':'text/plain'}}));
  const result=await app.inject(url);assert.equal(result.statusCode,200);assert.equal(mock.mock.callCount(),1);
  assert.deepEqual(result.json().data.query,query);
  const entry=storage.get(key)!; assert.equal(entry.expiresAt-entry.retrievedAt,86400000);assert.equal(entry.staleUntil,entry.expiresAt); assert.ok(JSON.stringify(entry.value).length<10000);
  const data=result.json().data;
  const stale=setup(t); stale.storage.set(key,data,{retrievedAt:now-2000,expiresAt:now-1000,staleUntil:now+20000});
  mock.mock.mockImplementation(async()=>{throw new Error('offline');});
  assert.equal((await stale.app.inject(url)).statusCode,502);
});
test('12-second route deadline aborts stalled provider before cache lease expires',async t=>{
  const {app}=setup(t); await app.ready();
  let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  let signal:AbortSignal|undefined;
  t.mock.method(globalThis,'fetch',(_url: unknown, init?:RequestInit)=>{signal=init?.signal??undefined;started();return new Promise<Response>(()=>{});});
  t.mock.timers.enable({apis:['setTimeout']});
  const response=app.inject(url);await began;t.mock.timers.tick(12000);
  assert.equal((await response).statusCode,502);assert.equal(signal?.aborted,true);
});
