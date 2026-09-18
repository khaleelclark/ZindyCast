import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './app.js';
const providers={searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');}};
test('comparison job APIs enforce installation ownership and redact worker authority',async()=>{
 const app=createApp(providers);const headers={'x-zindycast-request':'1'};
 const a=(await app.inject({method:'POST',url:'/api/v1/installations',headers})).json();
 const b=(await app.inject({method:'POST',url:'/api/v1/installations',headers})).json();
 const auth={...headers,authorization:`Bearer ${a.bearer}`};
 const response=await app.inject({method:'POST',url:'/api/v1/comparisons',headers:auth,payload:{locations:[{id:'a',name:'A',latitude:21,longitude:-157},{id:'b',name:'B',latitude:38,longitude:-121}],startDate:'2020-07-15',endDate:'2020-07-15'}});
 assert.equal(response.statusCode,202);const job=response.json();assert.equal(job.state,'queued');assert.ok(!response.body.includes('lease'));assert.ok(!response.body.includes('token'));
 assert.equal((await app.inject({url:`/api/v1/comparisons/${job.id}`,headers:{authorization:`Bearer ${b.bearer}`}})).statusCode,404);
 assert.equal((await app.inject({url:`/api/v1/comparisons/${job.id}`,headers:{authorization:`Bearer ${a.id}`}})).statusCode,404);
 const cancelled=await app.inject({method:'POST',url:`/api/v1/comparisons/${job.id}/cancel`,headers:auth});assert.equal(cancelled.json().state,'cancelled');assert.equal(cancelled.headers['cache-control'],'no-store');
 await app.close();
});
test('registration mutations require same-origin header and are bounded',async()=>{
 const app=createApp(providers);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/installations'})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/installations',headers:{'x-zindycast-request':'1',origin:'https://unrelated.test'}})).statusCode,403);
 for(let i=0;i<10;i++)assert.equal((await app.inject({method:'POST',url:'/api/v1/installations',headers:{'x-zindycast-request':'1'}})).statusCode,201);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/installations',headers:{'x-zindycast-request':'1'}})).statusCode,429);await app.close();
});
