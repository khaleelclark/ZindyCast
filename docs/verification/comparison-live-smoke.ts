// Manual bounded smoke: at most two upstream archive requests, persistent shared quota/cache.
// Installation credentials exist only in memory and an isolated temporary hashed repository.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { ComparisonWorker } from '../../apps/worker/src/comparison-worker.js';
import { JobRepository } from '@zindycast/jobs';
import { InstallationRepository } from '@zindycast/installations';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { ComparisonJobSchema } from '@zindycast/contracts';
const dir=mkdtempSync(join(tmpdir(),'zindycast-smoke-'));
const jobs=new JobRepository({path:join(dir,'jobs.sqlite')});
const installations=new InstallationRepository({path:join(dir,'installations.sqlite')});
const storage=new SharedStorage({path:'var/coordination.sqlite',providers:APP_PROVIDER_LIMITS});
const app=createApp({searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');}},storage,{jobs,installations});
try {
 const registration=await app.inject({method:'POST',url:'/api/v1/installations',headers:{'x-zindycast-request':'1'}});
 assert.equal(registration.statusCode,201);
 const headers={authorization:`Bearer ${registration.json().bearer}`,'x-zindycast-request':'1'};
 const query={locations:[{id:'honolulu',name:'Honolulu',latitude:21.3069,longitude:-157.8583},{id:'anchorage',name:'Anchorage',latitude:61.2181,longitude:-149.9003}],startDate:'2020-07-15',endDate:'2020-07-15'};
 const queued=await app.inject({method:'POST',url:'/api/v1/comparisons',headers,payload:query});
 assert.equal(queued.statusCode,202);
 const id=queued.json().id;
 await new ComparisonWorker({jobs,installations,storage}).runOnce();
 const response=await app.inject({url:`/api/v1/comparisons/${id}`,headers});
 assert.equal(response.statusCode,200);
 const job=ComparisonJobSchema.parse(response.json());
 assert.equal(job.state,'completed',job.error??'Incomplete job');
 assert.equal(job.result?.locations.length,2);
 assert.equal((await app.inject(`/api/v1/comparisons/${id}`)).statusCode,404);
 assert.equal(installations.isJobActive(id),false);
 assert.ok(!response.body.includes('lease'));
 const cancelled=await app.inject({method:'POST',url:'/api/v1/comparisons',headers,payload:query});
 assert.equal(cancelled.statusCode,202);
 const cancel=await app.inject({method:'POST',url:`/api/v1/comparisons/${cancelled.json().id}/cancel`,headers});
 assert.equal(cancel.json().state,'cancelled');
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),state:job.state,query,locations:job.result?.locations.map(l=>({name:l.location.name,temperatureCount:l.variables.temperatureC.validCount,precipitationCount:l.variables.precipitationMm.validCount})),ownershipDeniedWithoutCredential:true,leaseRedacted:true,terminalAdmissionReleased:true,queuedCancellation:true},null,2));
} finally {await app.close();rmSync(dir,{recursive:true,force:true});}
