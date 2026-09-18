import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { StationDiscoveryResponseSchema } from '@zindycast/contracts';
import { parseStationDiscovery } from '@zindycast/stations';
import { CachedRequests } from './cache.js';
import { registerStationDiscovery } from './station-discovery.js';
const raw=readFileSync('docs/research/history/ghcnd-stations-subset.txt','utf8');
const q={latitude:21.3,longitude:-157.8}; const url='/api/v1/stations/nearby?latitude=21.3&longitude=-157.8';
const key=`stations:ghcnd-discovery-v1:US:150km:10:${JSON.stringify(q)}`;
function setup(t:TestContext,storage=new SharedStorage({path:':memory:',providers:APP_PROVIDER_LIMITS})) {
  const app=Fastify();registerStationDiscovery(app,new CachedRequests(storage));t.after(async()=>{await app.close();storage.close();});return {app,storage};
}
test('strict query; exact selection one-day cache; concurrent coalescing',async t=>{
  const {app,storage}=setup(t);const mock=t.mock.method(globalThis,'fetch',async()=>new Response(raw,{headers:{'content-type':'text/plain'}}));
  for(const query of ['latitude=&longitude=0','latitude=91&longitude=0','latitude=0&longitude=181','latitude=NaN&longitude=0','latitude=0&latitude=1&longitude=0','latitude=0&longitude=0&url=x']) assert.equal((await app.inject('/api/v1/stations/nearby?'+query)).statusCode,400);
  assert.equal(mock.mock.callCount(),0);
  const results=await Promise.all([app.inject(url),app.inject(url)]);
  for(const r of results) {assert.equal(r.statusCode,200);assert.deepEqual(StationDiscoveryResponseSchema.parse(r.json()).data.query,q);}
  assert.equal(mock.mock.callCount(),1);const entry=storage.get(key)!;
  assert.equal(entry.expiresAt-entry.retrievedAt,86400000);assert.equal(entry.staleUntil,entry.expiresAt);assert.ok(JSON.stringify(entry.value).length<10000);
});
test('query mismatch refetches; stale outage never returns old candidates',async t=>{
  const {app,storage}=setup(t),now=Date.now();
  storage.set(key,JSON.parse(JSON.stringify(parseStationDiscovery(raw,{latitude:0,longitude:0},new Date(now).toISOString()))),{retrievedAt:now,expiresAt:now+10000,staleUntil:now+20000});
  const mock=t.mock.method(globalThis,'fetch',async()=>new Response(raw,{headers:{'content-type':'text/plain'}}));
  const result=await app.inject(url);assert.equal(result.statusCode,200);assert.deepEqual(result.json().data.query,q);assert.equal(mock.mock.callCount(),1);
  const stale=setup(t); stale.storage.set(key,result.json().data,{retrievedAt:now-2000,expiresAt:now-1000,staleUntil:now+20000});
  mock.mock.mockImplementation(async()=>{throw new Error('private upstream failure');});
  const failed=await stale.app.inject(url);assert.equal(failed.statusCode,502);assert.ok(!failed.body.includes('private'));
});
test('NOAA quota charged before fetch and upstream retry-after preserved',async t=>{
  const storage=new SharedStorage({path:':memory:',providers:{noaa:{minute:1,hour:1,day:1,month:1}}});storage.reserveQuota('noaa',1);
  const {app}=setup(t,storage);const mock=t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429,headers:{'retry-after':'17'}}));
  assert.equal((await app.inject(url)).statusCode,429);assert.equal(mock.mock.callCount(),0);
  const other=setup(t).app;const result=await other.inject(url);assert.equal(result.statusCode,429);assert.equal(result.headers['retry-after'],'17');
});
