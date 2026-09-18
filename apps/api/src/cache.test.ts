import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { SharedStorage } from '@zindycast/storage';
import { CachedRequests } from './cache.js';
test('concurrent requests coalesce and persisted cache avoids another provider call',async()=>{
 const storage=new SharedStorage({path:':memory:'});const a=new CachedRequests(storage),b=new CachedRequests(storage);let calls=0;
 const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {value:7};};const schema=z.object({value:z.number()});
 const [one,two]=await Promise.all([a.get('x',schema,2,10000,0,fetcher),a.get('x',schema,2,10000,0,fetcher)]);
 assert.deepEqual(one,two);assert.equal((await b.get('x',schema,2,10000,0,fetcher)).data.value,7);assert.equal(calls,1);storage.close();
});
test('quota denial cannot cause an unbudgeted fetch',async()=>{
 const storage=new SharedStorage({path:':memory:',providers:{'open-meteo':{minute:1,hour:1,day:1,month:1}}});const cache=new CachedRequests(storage);let calls=0;
 await assert.rejects(cache.get('x',z.number(),2,10000,0,async()=>{calls++;return 7;}),/budget/);assert.equal(calls,0);storage.close();
});
test('provider failure retains permitted stale data without changing freshness',async()=>{
 const storage=new SharedStorage({path:':memory:'});const now=Date.now();storage.set('x',7,{retrievedAt:now-1000,expiresAt:now-1,staleUntil:now+10000});
 const result=await new CachedRequests(storage).get('x',z.number(),1,1000,10000,async()=>{throw new Error('offline');});
 assert.equal(result.data,7);assert.equal(result.freshness,'stale');storage.close();
});
test('explicit refresh bypasses older fresh cache without shortening normal cache lifetime',async()=>{
 const storage=new SharedStorage({path:':memory:'}),cache=new CachedRequests(storage),now=Date.now();let calls=0;
 storage.set('refresh',1,{retrievedAt:now-20000,expiresAt:now+280000,staleUntil:now+1800000});
 const fetcher=async()=>{calls++;return 2;};
 assert.equal((await cache.get('refresh',z.number(),1,300000,1800000,fetcher)).data,1);
 const results=await Promise.all([cache.get('refresh',z.number(),1,300000,1800000,fetcher,'open-meteo',10000),cache.get('refresh',z.number(),1,300000,1800000,fetcher,'open-meteo',10000)]);
 assert.ok(results.every(r=>r.data===2&&r.freshness==='fresh'));assert.equal(calls,1);
 const saved=storage.get('refresh')!;assert.equal(saved.expiresAt-saved.retrievedAt,300000);
 await cache.get('refresh',z.number(),1,300000,1800000,fetcher,'open-meteo',10000);assert.equal(calls,1);storage.close();
});
test('failed explicit refresh labels retained older data stale',async()=>{
 const storage=new SharedStorage({path:':memory:'}),now=Date.now();storage.set('refresh',1,{retrievedAt:now-20000,expiresAt:now+280000,staleUntil:now+1800000});
 const r=await new CachedRequests(storage).get('refresh',z.number(),1,300000,1800000,async()=>{throw Error('outage');},'open-meteo',10000);assert.equal(r.freshness,'stale');assert.equal(r.data,1);storage.close();
});
