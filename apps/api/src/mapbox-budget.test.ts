import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {registerMapboxBudget} from './mapbox-budget';
test('admission is POST only, noncacheable, rejects untrusted input, and fails closed',async()=>{
 const app=Fastify();let calls=0,mode='ok';
 registerMapboxBudget(app,{reserveMapboxRequest(){calls++;if(mode==='fail')throw Error('private storage path');return {allowed:mode==='ok',used:mode==='ok'?1:190000,limit:190000};}});
 try{
  let r=await app.inject({method:'POST',url:'/api/v1/maps/mapbox/admission'});assert.equal(r.statusCode,200);assert.equal(r.json().allowed,true);assert.equal(r.headers['cache-control'],'no-store');
  for(const options of [{method:'GET' as const,url:'/api/v1/maps/mapbox/admission'},{method:'POST' as const,url:'/api/v1/maps/mapbox/admission?extra=1'},{method:'POST' as const,url:'/api/v1/maps/mapbox/admission',headers:{'sec-fetch-site':'cross-site'}},{method:'POST' as const,url:'/api/v1/maps/mapbox/admission',payload:{count:100}}]){r=await app.inject(options);assert.ok(r.statusCode>=400);}
  assert.equal(calls,1);mode='limit';r=await app.inject({method:'POST',url:'/api/v1/maps/mapbox/admission'});assert.equal(r.statusCode,429);assert.equal(r.json().reason,'limit');
  mode='fail';r=await app.inject({method:'POST',url:'/api/v1/maps/mapbox/admission'});assert.equal(r.statusCode,503);assert.equal(r.json().allowed,false);assert.ok(!r.body.includes('private'));
 }finally{await app.close();}
});
