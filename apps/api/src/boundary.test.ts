import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerBoundary} from './boundary.js';
test('configured origin/Host boundary rejects rebinding and scheme mismatch without trusting proxy headers',async()=>{
 const app=Fastify();registerBoundary(app,['https://weather.example.test:21443','http://127.0.0.1:4311']);app.get('/',()=>({ok:true}));
 for(const headers of [{host:'evil.example'},{host:'evil.example','x-forwarded-host':'weather.example.test:21443'},{host:'weather.example.test:21443',origin:'http://weather.example.test:21443'},{host:'127.0.0.1:4311',origin:'null'}])assert.ok((await app.inject({url:'/',headers})).statusCode>=400);
 for(const host of ['127.0.0.1:4311','weather.example.test:21443'])assert.equal((await app.inject({url:'/',headers:{host}})).statusCode,200);
 await app.close();
});
