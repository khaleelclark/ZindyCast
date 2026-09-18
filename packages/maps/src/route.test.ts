import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Fastify from 'fastify';
import {SharedStorage,APP_PROVIDER_LIMITS} from '@zindycast/storage';
import {MapFrameResponseSchema} from '@zindycast/contracts';
import {CachedRequests} from '../../../apps/api/src/cache.js';
import {registerMaps} from '../../../apps/api/src/maps.js';
import {parseMapCatalog} from './index.js';
const xml=readFileSync('docs/research/maps/followup-nowcoast-capabilities.xml','utf8');
const png=readFileSync('docs/research/maps/conus-radar.png');
const catalog=parseMapCatalog(xml,new Date().toISOString());
const url='/api/v1/maps/frame?'+new URLSearchParams({product:'radar-conus',west:'-125',south:'24',east:'-66',north:'50',width:'800',height:'500',time:catalog.products[0]!.times.at(-1)!});
function setup(t:TestContext,storage=new SharedStorage({path:':memory:',providers:APP_PROVIDER_LIMITS})){
 const app=Fastify();registerMaps(app,new CachedRequests(storage));t.after(async()=>{await app.close();storage.close();});return{app,storage};
}
function seed(storage:SharedStorage){const now=Date.now();storage.set('noaa:catalog:v2',JSON.parse(JSON.stringify(catalog)),{retrievedAt:now,expiresAt:now+120000,staleUntil:now+120000});}
test('map catalog and frame preserve quota denial as429 with retry, without network',async t=>{
 const storage=new SharedStorage({path:':memory:',providers:{noaa:{minute:1,hour:1,day:1,month:1}}});storage.reserveQuota('noaa',1);
 const {app}=setup(t,storage);const mock=t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected network');});
 const c=await app.inject('/api/v1/maps');assert.equal(c.statusCode,429);assert.equal(c.json().code,'rate_limited');assert.ok(Number(c.headers['retry-after'])>0);
 seed(storage);const f=await app.inject(url);assert.equal(f.statusCode,429);assert.equal(f.json().code,'rate_limited');assert.equal(mock.mock.callCount(),0);
});
test('upstream429 retry survives both endpoints while invalid provider responses remain502',async t=>{
 const {app,storage}=setup(t);const mock=t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429,headers:{'retry-after':'17'}}));
 const c=await app.inject('/api/v1/maps');assert.equal(c.statusCode,429);assert.equal(c.headers['retry-after'],'17');
 seed(storage);const f=await app.inject(url);assert.equal(f.statusCode,429);assert.equal(f.headers['retry-after'],'17');
 mock.mock.mockImplementation(async()=>new Response('<error/>',{headers:{'content-type':'text/xml'}}));assert.equal((await app.inject(url)).statusCode,502);
});
test('regional frame runtime response, cache and independent source time remain valid',async t=>{
 const {app,storage}=setup(t);seed(storage);const mock=t.mock.method(globalThis,'fetch',async()=>new Response(png,{headers:{'content-type':'image/png','warning':'99 Nearest value used','cache-control':'max-age=600'}}));
 const first=await app.inject(url);assert.equal(first.statusCode,200);const result=MapFrameResponseSchema.parse(first.json());assert.equal(result.data.sourceTimeStatus,'provider_warning_actual_time_unknown');assert.equal(result.data.actualSourceTime,null);assert.equal(result.data.requestedTime,catalog.products[0]!.times.at(-1));assert.equal(result.data.imageBase64,png.toString('base64'));
 assert.equal((await app.inject(url)).statusCode,200);assert.equal(mock.mock.callCount(),1);
 assert.equal((await app.inject(url.replace('west=-125','west=170'))).statusCode,400);assert.equal(mock.mock.callCount(),1);
});
test('projection-specific cache identity and validation prevent a CRS84 image becoming Mercator',async t=>{
 const {app,storage}=setup(t);seed(storage);const seen:string[]=[];
 const mock=t.mock.method(globalThis,'fetch',async(input:unknown)=>{seen.push(String(input));return new Response(png,{headers:{'content-type':'image/png'}});});
 const first=await app.inject(url);assert.equal(first.statusCode,200);assert.equal(first.json().data.projection,'CRS:84');
 const mercator=url+'&projection=EPSG%3A3857';const second=await app.inject(mercator);assert.equal(second.statusCode,200);assert.equal(second.json().data.projection,'EPSG:3857');
 assert.equal((await app.inject(mercator)).statusCode,200);assert.equal(mock.mock.callCount(),2);assert.equal(new URL(seen[1]!).searchParams.get('crs'),'EPSG:3857');
 const q={product:'radar-conus',west:-125,south:24,east:-66,north:50,width:800,height:500,time:catalog.products[0]!.times.at(-1)!,projection:'EPSG:3857'};
 const now=Date.now();storage.set(`noaa:frame:v2:${JSON.stringify(q)}`,first.json().data,{retrievedAt:now,expiresAt:now+300000,staleUntil:now+300000});
 assert.equal((await app.inject(mercator)).json().data.projection,'EPSG:3857');assert.equal(mock.mock.callCount(),3);
 assert.equal((await app.inject(url+'&projection=EPSG%3A4326')).statusCode,400);
 assert.equal((await app.inject(mercator.replace('north=50','north=86'))).statusCode,400);assert.equal(mock.mock.callCount(),3);
});
