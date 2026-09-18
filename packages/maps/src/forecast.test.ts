import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ForecastRadarCatalogSchema } from '../../contracts/src/forecast-radar.js';
import { buildForecastRadarCatalog,buildForecastRadarTileRequest,parseForecastRadarMetadata,validateForecastRadarTile,validateForecastRadarPng,ForecastRadarGate,ForecastRadarError,getForecastRadarMetadata,fetchForecastRadarTile } from './forecast.js';
const run='2026-09-11T14:00:00Z',retrieved='2026-09-11T16:08:46Z',now=Date.parse(retrieved);
const raw={model_init_utc:run,forecast_minute:1080,model_forecast_utc:'2026-09-12T08:00:00Z'};
const metadata=parseForecastRadarMetadata(raw,retrieved);
const png=Buffer.from(readFileSync('docs/decisions/future-radar.md','utf8').split('```base64\n')[1].split('```')[0].trim(),'base64');
function current(){const runMs=Math.floor(Date.now()/3600000)*3600000-7200000;return {model_init_utc:new Date(runMs).toISOString(),forecast_minute:1080,model_forecast_utc:new Date(runMs+64800000).toISOString()};}
const errorCode=(code:string)=>(e:unknown)=>e instanceof ForecastRadarError&&e.code===code;
test('source attribution, pinned arithmetic, twelve future quarter-hours, midnight horizon',()=>{
 const c=ForecastRadarCatalogSchema.parse(buildForecastRadarCatalog(metadata,now));assert.equal(c.frames.length,12);assert.equal(c.frames[0].validTime,'2026-09-11T16:15:00.000Z');assert.equal(c.frames.at(-1)!.validTime,'2026-09-11T19:00:00.000Z');assert.equal(c.modelRunTime,'2026-09-11T14:00:00.000Z');assert.equal(c.actualSourceTime,null);assert.equal(c.coverageState,'unknown');
 assert.equal(buildForecastRadarCatalog(metadata,Date.parse('2026-09-11T16:15Z')).frames[0].validTime,'2026-09-11T16:30:00.000Z');
 for(const bad of [{...c,classification:'observed'},{...c,modelRunTime:retrieved},{...c,frames:[{...c.frames[0],id:'hrrr-202609111400-f0000'}]},{...c,frames:[c.frames[0],c.frames[0]]},{...c,evaluatedAt:'2026-09-11T19:00:00Z'}])assert.equal(ForecastRadarCatalogSchema.safeParse(bad).success,false);
});
test('calendar, minute, horizon, future retrieval and four-hour run age fail closed',()=>{
 for(const r of [{...raw,forecast_minute:'1080'},{...raw,forecast_minute:15},{...raw,model_init_utc:'2026-02-30T14:00:00Z'},{...raw,model_init_utc:'2026-09-11T14:01:00Z'},{...raw,model_forecast_utc:run},{...raw,model_init_utc:'2026-09-11T14:00:00-00:00'},null])assert.throws(()=>parseForecastRadarMetadata(r,retrieved),errorCode('invalid_metadata'));
 assert.throws(()=>parseForecastRadarMetadata(raw,'2026-09-11T13:00:00Z'),errorCode('invalid_metadata'));
 assert.throws(()=>buildForecastRadarCatalog(metadata,now-1),errorCode('invalid_metadata'));
 assert.equal(buildForecastRadarCatalog(metadata,Date.parse('2026-09-11T18:00Z')).frames.length,12);
 assert.throws(()=>buildForecastRadarCatalog(metadata,Date.parse('2026-09-11T18:00Z')+1),errorCode('model_run_too_old'));
});
test('explicit allowlisted XYZ north-origin URL; archive, past, malformed, AK/HI requests rejected',()=>{
 const c=buildForecastRadarCatalog(metadata,now),id=c.frames[3].id;
 assert.equal(buildForecastRadarTileRequest(id,4,3,6,metadata,now).href,'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0180-202609111400/4/3/6.png');
 for(const args of [[8,3,6],[4,-1,6],[4,16,6],[4,3,1.5]])assert.throws(()=>validateForecastRadarTile(id,...args as [number,number,number]),errorCode('invalid_request'));
 for(const args of [[7,7,56],[7,10,37],[4,3,9]])assert.throws(()=>validateForecastRadarTile(id,...args as [number,number,number]),errorCode('outside_supported_region'));
 for(const f of ['https://evil/a','hrrr-202609101400-f0180','hrrr-202609111400-f0000','hrrr-202609111400-f1080'])assert.throws(()=>buildForecastRadarTileRequest(f,4,3,6,metadata,now),errorCode('invalid_request'));
});
test('gate bounds concurrent work, sliding 30/minute, cooldown and idempotent release',()=>{
 let time=0;const g=new ForecastRadarGate(()=>time),a=g.enter(),b=g.enter();assert.throws(()=>g.enter(),errorCode('rate_limited'));a();a();b();
 for(let i=2;i<30;i++)g.enter()();assert.throws(()=>g.enter(),errorCode('rate_limited'));time=59999;assert.throws(()=>g.enter(),errorCode('rate_limited'));time=60000;g.enter()();g.cooldown(17);assert.throws(()=>g.enter(),e=>errorCode('rate_limited')(e)&&(e as ForecastRadarError).retryAfterSeconds===17);time+=17000;g.enter()();
});
test('retained scientific sample signature/dimensions and malformed PNG rejection',()=>{
 validateForecastRadarPng(png);for(const bytes of [Buffer.alloc(32),Buffer.alloc(1048577),Buffer.from(png)]){if(bytes.length===png.length)bytes.writeUInt32BE(512,16);assert.throws(()=>validateForecastRadarPng(bytes),errorCode('provider_error'));}
});
test('mock metadata and tile GET: fixed host, no redirects/retries, requested pinned future',async t=>{
 const calls:URL[]=[];const mock=t.mock.method(globalThis,'fetch',async(url:URL,init:RequestInit)=>{calls.push(url);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.ok(init.signal);return calls.length===1?new Response(JSON.stringify(current()),{headers:{'content-type':'application/json'}}):new Response(png,{headers:{'content-type':'image/png'}});});
 const gate=new ForecastRadarGate(),m=await getForecastRadarMetadata(undefined,gate),c=buildForecastRadarCatalog(m);const r=await fetchForecastRadarTile(c.frames[0].id,4,3,6,m,undefined,gate);assert.deepEqual(r.bytes,png);assert.equal(mock.mock.callCount(),2);assert.equal(calls[1].hostname,'mesonet.agron.iastate.edu');
});
test('metadata body and content checks; upstream failures are generic',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response('private failure',{status:503}));
 for(const response of [new Response('private',{status:503}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'65537'}}),new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}})]){mock.mock.mockImplementation(async()=>response);await assert.rejects(getForecastRadarMetadata(undefined,new ForecastRadarGate()),errorCode('provider_error'));}
 mock.mock.mockImplementation(async()=>new Response('{',{headers:{'content-type':'application/json'}}));await assert.rejects(getForecastRadarMetadata(undefined,new ForecastRadarGate()),errorCode('invalid_metadata'));
 mock.mock.mockImplementation(async()=>{throw new Error('sensitive URL');});await assert.rejects(getForecastRadarMetadata(undefined,new ForecastRadarGate()),e=>errorCode('provider_error')(e)&&!(e as Error).message.includes('sensitive'));
});
test('429 retry-after creates shared local cooldown and no retry fetch',async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response('',{status:429,headers:{'retry-after':'17'}}));const gate=new ForecastRadarGate();await assert.rejects(getForecastRadarMetadata(undefined,gate),e=>errorCode('rate_limited')(e)&&(e as ForecastRadarError).retryAfterSeconds===17);await assert.rejects(getForecastRadarMetadata(undefined,gate),errorCode('rate_limited'));assert.equal(mock.mock.callCount(),1);
});
test('cancellation before start spends no request; inflight abort releases concurrency',async t=>{
 const abort=new AbortController(),gate=new ForecastRadarGate();abort.abort();const mock=t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true})));
 await assert.rejects(getForecastRadarMetadata(abort.signal,gate));assert.equal(mock.mock.callCount(),0);
 const pendingAbort=new AbortController(),work=getForecastRadarMetadata(pendingAbort.signal,gate);pendingAbort.abort();await assert.rejects(work);const a=gate.enter(),b=gate.enter();a();b();assert.equal(mock.mock.callCount(),1);
});
test('tile byte caps apply to declared and streamed sizes and content type',async t=>{
 const m=parseForecastRadarMetadata(current(),new Date().toISOString()),f=buildForecastRadarCatalog(m).frames[0];
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response(''));
 for(const response of [new Response(png,{headers:{'content-type':'image/png','content-length':'1048577'}}),new Response(Buffer.alloc(1048577),{headers:{'content-type':'image/png'}}),new Response(png,{headers:{'content-type':'text/html'}}),new Response(Buffer.alloc(33),{headers:{'content-type':'image/png'}})]){mock.mock.mockImplementation(async()=>response);await assert.rejects(fetchForecastRadarTile(f.id,4,3,6,m,undefined,new ForecastRadarGate()),errorCode('provider_error'));}
 assert.equal(mock.mock.callCount(),4);
});
