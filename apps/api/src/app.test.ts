import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
test('invalid coordinates and timezone never call weather provider', async () => {
 let calls = 0;
 const app = createApp({ searchLocations: async () => [], getForecast: async () => { calls++; throw new Error('offline'); } });
 for (const url of ['/api/v1/forecast?latitude=91&longitude=0&name=X&timezone=UTC','/api/v1/forecast?latitude=0&longitude=0&name=X&timezone=NotAZone']) assert.equal((await app.inject(url)).statusCode,400);
 assert.equal(calls,0); await app.close();
});
test('upstream errors produce sanitized independent resource failures', async () => {
 const app = createApp({ searchLocations: async () => { throw new Error('secret upstream detail'); }, getForecast: async () => { throw new Error('secret'); } });
 const result = await app.inject('/api/v1/locations?q=Roseville');
 assert.equal(result.statusCode,502); assert.equal(result.json().code,'provider_error'); assert.ok(!result.body.includes('secret'));
 assert.equal((await app.inject('/api/v1/health')).statusCode,200); await app.close();
});
test('rate-limit status and Retry-After survive API mapping', async () => {
 const { ProviderError } = await import('@zindycast/providers');
 const app = createApp({ searchLocations: async () => { throw new ProviderError('rate_limited','private detail',429,120); }, getForecast: async () => { throw new Error('unused'); } });
 const result = await app.inject('/api/v1/locations?q=Honolulu');
 assert.equal(result.statusCode,429); assert.equal(result.headers['retry-after'],'120'); assert.equal(result.json().code,'rate_limited'); assert.ok(!result.body.includes('private detail')); await app.close();
});
test('cached alert snapshots remove expired records and do not refetch within freshness window',async()=>{
 let calls=0;const now=Date.now();
 const base={id:'one',event:'Test fixture advisory',headline:null,severity:'Moderate',urgency:'Expected',certainty:'Likely',sent:new Date(now-1000).toISOString(),effective:null,onset:null,expires:new Date(now+60000).toISOString(),ends:null,status:'Actual',messageType:'Alert',description:'Fixture text',instruction:null,areaDesc:'Fixture area',senderName:'Fixture',web:null,geometry:null,affectedZones:[]};
 const app=createApp({searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');},getAlerts:async(latitude,longitude)=>{calls++;return {coordinates:{latitude,longitude},provider:'NWS',retrievedAt:new Date(now).toISOString(),attribution:'NWS',alerts:[base,{...base,id:'expired',expires:new Date(now-1).toISOString()}]};}});
 for(let i=0;i<2;i++){const r=await app.inject('/api/v1/alerts?latitude=38&longitude=-121');assert.equal(r.statusCode,200);assert.deepEqual(r.json().data.alerts.map((a:{id:string})=>a.id),['one']);assert.equal(r.headers['cache-control'],'no-store');}
 assert.equal(calls,1);await app.close();
});
