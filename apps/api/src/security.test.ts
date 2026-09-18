import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {SharedStorage} from '@zindycast/storage';
import {InstallationRepository} from '@zindycast/installations';
import {JobRepository} from '@zindycast/jobs';
import {CachedRequests} from './cache.js';
import {createApp} from './app.js';
const providers={searchLocations:async()=>[],getForecast:async()=>{throw Error('No provider calls allowed');}};
const headers={'x-zindycast-request':'1'};
const query={locations:[{id:'a',name:'A',latitude:21,longitude:-157},{id:'b',name:'B',latitude:38,longitude:-121}],startDate:'2020-07-15',endDate:'2020-07-15'};

test('mutation guard rejects opaque/noncanonical origins, cross-site metadata and forwarded spoofing',async t=>{
 const app=createApp(providers);t.after(()=>app.close());
 for(const origin of ['null','ftp://localhost:80','https://user@localhost:80','http://localhost/path','http://localhost?x=1','http://localhost#x','http://evil.test']){
  const result=await app.inject({method:'POST',url:'/api/v1/installations',headers:{...headers,host:'localhost',origin,'x-forwarded-host':'evil.test','x-forwarded-proto':'https'}});
  assert.equal(result.statusCode,403,origin);
 }
 for(const site of ['cross-site','same-site','unexpected'])assert.equal((await app.inject({method:'POST',url:'/api/v1/installations',headers:{...headers,'sec-fetch-site':site}})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/installations',headers:{...headers,host:'localhost',origin:'http://localhost','sec-fetch-site':'same-origin'}})).statusCode,201);
});

test('simultaneous registration remains bounded and returns retry guidance',async t=>{
 const app=createApp(providers);t.after(()=>app.close());
 const results=await Promise.all(Array.from({length:14},()=>app.inject({method:'POST',url:'/api/v1/installations',headers})));
 assert.equal(results.filter(r=>r.statusCode===201).length,10);
 for(const r of results.filter(r=>r.statusCode!==201)){assert.equal(r.statusCode,429);assert.ok(Number(r.headers['retry-after'])>0);}
});

test('job admission races are bounded; owner IDs, cookies and other installations cannot read or cancel',async t=>{
 const installations=new InstallationRepository({path:':memory:'}),jobs=new JobRepository({path:':memory:'});
 const app=createApp(providers,undefined,{installations,jobs});t.after(()=>app.close());
 const a=installations.register(86400000),b=installations.register(86400000),auth={...headers,authorization:`Bearer ${a.bearer}`};
 const results=await Promise.all(Array.from({length:7},()=>app.inject({method:'POST',url:'/api/v1/comparisons',headers:auth,payload:query})));
 assert.equal(results.filter(r=>r.statusCode===202).length,3);assert.equal(results.filter(r=>r.statusCode===429).length,4);
 const id=results.find(r=>r.statusCode===202)!.json().id;
 for(const credentials of [{authorization:`Bearer ${b.bearer}`},{authorization:`Bearer ${a.id}`},{cookie:`bearer=${a.bearer}`},{authorization:`Bearer ${a.bearer} extra`}]){
  assert.equal((await app.inject({url:`/api/v1/comparisons/${id}`,headers:credentials})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:`/api/v1/comparisons/${id}/cancel`,headers:{...headers,...credentials}})).statusCode,404);
 }
 assert.equal(jobs.get(id)?.state,'queued');
 const lease=jobs.acquire('security-test',10000,'comparison-v1')!.lease!;
 const cancel=await app.inject({method:'POST',url:`/api/v1/comparisons/${lease.id}/cancel`,headers:auth});
 assert.equal(cancel.statusCode,200);assert.equal(cancel.json().state,'cancelled');assert.equal(jobs.complete(lease,{}),false);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/comparisons',headers:auth,payload:query})).statusCode,202);
 installations.revoke(a.bearer);
 assert.equal((await app.inject({url:`/api/v1/comparisons/${id}`,headers:auth})).statusCode,404);
});

test('zero-stale and reduced TTL reject inherited cache data on failure and lease contention',async t=>{
 const storage=new SharedStorage({path:':memory:'});t.after(()=>storage.close());const cache=new CachedRequests(storage),now=Date.now();
 storage.set('stale',7,{retrievedAt:now-20000,expiresAt:now-10000,staleUntil:now+60000});
 storage.set('old-policy',7,{retrievedAt:now-20000,expiresAt:now+60000,staleUntil:now+120000});
 let calls=0;const failure=async()=>{calls++;throw Error('offline');};
 await assert.rejects(cache.get('stale',z.number(),1,10000,0,failure),/offline/);
 await assert.rejects(cache.get('old-policy',z.number(),1,1000,1000,failure),/offline/);
 storage.acquireLease('stale','other-process',15000);
 await assert.rejects(cache.get('stale',z.number(),1,10000,0,failure),/Refresh already/);
 assert.equal(calls,2);
});

test('coalesced callers validate their own exact-query schema without duplicate provider work',async t=>{
 const storage=new SharedStorage({path:':memory:'});t.after(()=>storage.close());const cache=new CachedRequests(storage);
 let complete!:(value:{city:string})=>void,calls=0;
 const first=cache.get('shared',z.object({city:z.string()}),1,1000,0,()=>{calls++;return new Promise(resolve=>{complete=resolve;});});
 const other=cache.get('shared',z.object({city:z.literal('B')}),1,1000,0,async()=>{calls++;return {city:'B' as const};});
 const rejection=assert.rejects(other,/Coalesced cache result/);complete({city:'A'});
 assert.equal((await first).data.city,'A');await rejection;assert.equal(calls,1);
});

test('malformed retained data never bypasses quota and oversized results cannot populate cache',async t=>{
 const storage=new SharedStorage({path:':memory:',maxEntryBytes:100,providers:{'open-meteo':{minute:1,hour:1,day:1,month:1}}});t.after(()=>storage.close());
 const now=Date.now();storage.set('bad','wrong',{retrievedAt:now,expiresAt:now+10000,staleUntil:now+10000});
 const cache=new CachedRequests(storage);let calls=0;
 await assert.rejects(cache.get('bad',z.number(),2,1000,0,async()=>{calls++;return 1;}),/budget/);assert.equal(calls,0);
 await assert.rejects(cache.get('large',z.string(),1,1000,0,async()=>{calls++;return 'x'.repeat(101);}),/byte budget/);
 assert.equal(storage.get('large'),null);assert.equal(calls,1);
});

test('expired refresh lease cannot overwrite a newer result or refund provider quota',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});
 const storage=new SharedStorage({path:':memory:',providers:{'open-meteo':{minute:2,hour:2,day:2,month:2}}});t.after(()=>storage.close());
 const firstCache=new CachedRequests(storage),secondCache=new CachedRequests(storage);let complete!:(value:number)=>void;
 const first=firstCache.get('race',z.number(),1,60000,0,()=>new Promise(resolve=>{complete=resolve;}));
 t.mock.timers.tick(16000);
 assert.equal((await secondCache.get('race',z.number(),1,60000,0,async()=>2)).data,2);
 complete(1);
 // Losing refresh may use the validated winner, but cannot return its old data.
 assert.equal((await first).data,2);assert.equal(storage.get('race')?.value,2);
 let calls=0;await assert.rejects(secondCache.get('another',z.number(),1,60000,0,async()=>{calls++;return 3;}),/budget/);assert.equal(calls,0);
});
