import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.js';
const providers={searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');}};
test('climate job APIs enforce installation ownership and redact worker authority',async()=>{
 const app=createApp(providers);const headers={'x-zindycast-request':'1'};
 const a=(await app.inject({method:'POST',url:'/api/v1/installations',headers})).json();
 const b=(await app.inject({method:'POST',url:'/api/v1/installations',headers})).json();
 const auth={...headers,authorization:`Bearer ${a.bearer}`};
 const response=await app.inject({method:'POST',url:'/api/v1/climate-comparisons',headers:auth,payload:{locations:[{id:'a',name:'A',latitude:21,longitude:-157,timezone:'Pacific/Honolulu'},{id:'b',name:'B',latitude:38,longitude:-121,timezone:'America/Los_Angeles'}],mode:'period',startDate:'2020-07-15',endDate:'2020-07-15'}});
 assert.equal(response.statusCode,202);const job=response.json();assert.equal(job.state,'queued');assert.ok(!response.body.includes('lease'));assert.ok(!response.body.includes('token'));
 assert.equal((await app.inject({url:`/api/v1/climate-comparisons/${job.id}`,headers:{authorization:`Bearer ${b.bearer}`}})).statusCode,404);
 assert.equal((await app.inject({url:`/api/v1/climate-comparisons/${job.id}`,headers:{authorization:`Bearer ${a.id}`}})).statusCode,404);
 const cancelled=await app.inject({method:'POST',url:`/api/v1/climate-comparisons/${job.id}/cancel`,headers:auth});assert.equal(cancelled.json().state,'cancelled');assert.equal(cancelled.headers['cache-control'],'no-store');
 await app.close();
});

import {readFileSync} from 'node:fs';
import {SharedStorage} from '@zindycast/storage';
import {JobRepository} from '@zindycast/jobs';
import {InstallationRepository} from '@zindycast/installations';
import {ComparisonWeatherDataSchema,comparisonWeatherRequestUrl,ClimateDetailSchema,type ComparisonWeatherData,type ReanalysisQuery} from '@zindycast/contracts';
import {climateSummaryCsv,climateDailyCsv,climateDetailCsv} from '../../web/src/climate-export';
import {ClimateWorker} from '../../worker/src/climate-worker';
const template=JSON.parse(readFileSync('docs/verification/history-runtime/new-york-march-2020.json','utf8')) as ComparisonWeatherData;
function fixture(q: ReanalysisQuery, now: number): ComparisonWeatherData {
  const d = structuredClone(template), start = Date.parse(q.startDate), n = (Date.parse(q.endDate) - start) / 3600000 + 24;
  d.query = q;
  d.hours = Array.from({ length: n }, (_, i) => ({ time: new Date(start + i * 3600000).toISOString(), temperatureC: 10, humidityPercent: 50, precipitationMm: 1, windSpeedMs: 2, dewPointC: 0, wetBulbTemperatureC: 5, sunshineDurationSeconds: 60, cloudCoverPercent: 10, weatherCode: 0, sourceHourPresent: true, missingFields: [] }));
  d.completeness = { expectedHours: n, sourceHours: n, completeHours: n, missingHours: 0, status: 'complete', validCounts: { temperatureC: n, humidityPercent: n, precipitationMm: n, windSpeedMs: n, dewPointC: n, wetBulbTemperatureC: n, sunshineDurationSeconds: n, cloudCoverPercent: n, weatherCode: n } };
  d.provenance.retrievedAt = new Date(now).toISOString();
  d.provenance.sourceCoordinates = { latitude: q.latitude, longitude: q.longitude };
  d.provenance.requestUrl = comparisonWeatherRequestUrl(q);
  d.provenance.calculationVersion = 'comparison-weather-adapter-v2';
  d.intervalSemantics = 'instant meteorology; precipitation and sunshine duration sums over preceding hour ending at time';
  d.units = { ...d.units, wetBulbTemperatureC: '°C', sunshineDurationSeconds: 's', cloudCoverPercent: '%', weatherCode: 'wmo code' };
  return ComparisonWeatherDataSchema.parse(d);
}
test('completed climate job serves authorized cache-backed local detail and preserves v1 isolation',async()=>{
 const storage=new SharedStorage({path:':memory:'});const jobs=new JobRepository({path:':memory:'});const installations=new InstallationRepository({path:':memory:'});
 const app=createApp(providers,storage,{jobs,installations});const headers={'x-zindycast-request':'1'};
 const identity=(await app.inject({method:'POST',url:'/api/v1/installations',headers})).json();const auth={...headers,authorization:`Bearer ${identity.bearer}`};
 const query={mode:'period',locations:[{id:'a',name:'East',latitude:40,longitude:-74,timezone:'UTC'},{id:'b',name:'West',latitude:21,longitude:-157,timezone:'UTC'}],startDate:'2020-03-08',endDate:'2020-03-08'};
 const queued=(await app.inject({method:'POST',url:'/api/v1/climate-comparisons',headers:auth,payload:query})).json();
 let calls=0;await new ClimateWorker({jobs,installations,storage,fetchWeather:async q=>{calls++;return fixture(q,Date.now());}}).runOnce();assert.equal(calls,2);
 const shown=await app.inject({url:`/api/v1/climate-comparisons/${queued.id}`,headers:auth});assert.equal(shown.json().state,'completed');
 assert.equal((await app.inject({url:`/api/v1/comparisons/${queued.id}`,headers:auth})).statusCode,404);
 const path=`/api/v1/climate-comparisons/${queued.id}/detail?locationId=a&startDate=2020-03-08&endDate=2020-03-08`;
 assert.equal((await app.inject({url:path})).statusCode,404);
 const detail=await app.inject({url:path,headers:auth});assert.equal(detail.statusCode,200,detail.body);const d=ClimateDetailSchema.parse(detail.json());assert.equal(d.days.length,1);assert.equal(d.hours.length,25);assert.equal(d.days[0]!.metrics.temperatureC.max,10);
 const summary=climateSummaryCsv(shown.json().result);assert.match(summary,/average_daily_high/);assert.match(summary,/wet_bulb_p95_C/);assert.match(summary,/sunshineDurationSeconds/);
 assert.match(climateDailyCsv(d),/complete_total/);assert.equal(climateDetailCsv(d).split('\r\n').length,26);
 assert.match(climateDetailCsv({...d,location:{...d.location,name:'=danger'}}),/"'=danger"/);
 assert.equal((await app.inject({url:path.replace('locationId=a','locationId=unknown'),headers:auth})).statusCode,400);
 assert.equal((await app.inject({url:path.replaceAll('2020-03-08','2020-03-07'),headers:auth})).statusCode,400);
 await app.close();
});
