import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Fastify from 'fastify';
import {SharedStorage,APP_PROVIDER_LIMITS} from '@zindycast/storage';
import {CachedRequests} from './cache.js';
import {registerLibreRadar} from './libre-radar.js';
const png=readFileSync('docs/verification/librewxr-trial/chrome-nowcast.bin');
const base='/api/v1/maps/libre';
function setup(t:TestContext,limits=APP_PROVIDER_LIMITS){const storage=new SharedStorage({path:':memory:',providers:limits}),app=Fastify();registerLibreRadar(app,new CachedRequests(storage));t.after(async()=>{await app.close();storage.close();});return {app,storage};}
function source(){const time=Math.floor(Date.now()/600000)*600;return {version:'2.0',generated:Math.floor(Date.now()/1000),radar:{past:[{time,path:`/v2/radar/${time}`}],nowcast:[{time:time+600,path:`/v2/radar/${time+600}`}]}};}
test('Libre catalog singleflight and pinned tile reuse preserve identity',async t=>{
 const {app}=setup(t),s=source(),time=s.radar.nowcast[0]!.time;
 const mock=t.mock.method(globalThis,'fetch',async(u:URL)=>u.pathname.endsWith('.json')?new Response(JSON.stringify(s),{headers:{'Content-Type':'application/json'}}):new Response(png,{headers:{'Content-Type':'image/png','X-Frame-Timestamp':String(time)}}));
 const cs=await Promise.all([app.inject(base+'/catalog'),app.inject(base+'/catalog')]);for(const r of cs)assert.equal(r.statusCode,200);assert.equal(mock.mock.callCount(),1);
 const path=`${base}/tiles/${time}/10/281/426.png`;const a=await app.inject(path),b=await app.inject(path);assert.equal(a.statusCode,200);assert.deepEqual(a.rawPayload,png);assert.equal(b.headers['x-libre-frame'],String(time));assert.equal(mock.mock.callCount(),2);
 assert.equal(String(mock.mock.calls[1]!.arguments[0]),`https://api.librewxr.net/v2/radar/${time}/512/10/281/426/6/1_0.png`);
});
test('Libre rejects arbitrary paths, archive frames, malformed and stale source data',async t=>{
 const {app}=setup(t),s=source();const mock=t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(s),{headers:{'Content-Type':'application/json'}}));
 for(const path of ['/catalog?host=bad','/tiles/0/10/281/426.png','/tiles/1789230000/11/281/426.png','/tiles/1789230000/10/1024/426.png'])assert.equal((await app.inject(base+path)).statusCode,400);assert.equal(mock.mock.callCount(),0);
 assert.equal((await app.inject(`${base}/tiles/100/10/281/426.png`)).statusCode,400);assert.equal(mock.mock.callCount(),1);
 const other=setup(t);s.generated-=1800;assert.equal((await other.app.inject(base+'/catalog')).statusCode,502);
 const third=setup(t);s.generated+=1800;s.radar.past[0]!.path='/evil';assert.equal((await third.app.inject(base+'/catalog')).statusCode,502);
});
test('Libre rejects wrong image timestamp and redacts failures; shared quota prevents fetch',async t=>{
 const {app}=setup(t),s=source(),time=s.radar.nowcast[0]!.time;
 const mock=t.mock.method(globalThis,'fetch',async(u:URL)=>u.pathname.endsWith('.json')?new Response(JSON.stringify(s),{headers:{'Content-Type':'application/json'}}):new Response(png,{headers:{'Content-Type':'image/png','X-Frame-Timestamp':'0'}}));
 const r=await app.inject(`${base}/tiles/${time}/10/281/426.png`);assert.equal(r.statusCode,502);assert.ok(!r.body.includes('api.librewxr'));
 const {app:limited,storage}=setup(t,{...APP_PROVIDER_LIMITS,noaa:{minute:1,hour:1,day:1,month:1}});storage.reserveQuota('noaa',1);const before=mock.mock.callCount();assert.equal((await limited.inject(base+'/catalog')).statusCode,429);assert.equal(mock.mock.callCount(),before);
});
test('Libre nowcast expiration is rechecked after slow tile fetch',async t=>{
 const {app}=setup(t),s=source(),time=s.radar.nowcast[0]!.time;const realNow=Date.now;
 t.mock.method(globalThis,'fetch',async(u:URL)=>{if(u.pathname.endsWith('.json'))return new Response(JSON.stringify(s),{headers:{'Content-Type':'application/json'}});t.mock.method(Date,'now',()=>time*1000);return new Response(png,{headers:{'Content-Type':'image/png','X-Frame-Timestamp':String(time)}});});
 const r=await app.inject(`${base}/tiles/${time}/10/281/426.png`);assert.ok([400,502].includes(r.statusCode));t.mock.method(Date,'now',realNow);
});
