import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {InstallationRepository} from '@zindycast/installations';
import {NotificationRepository} from './notifications-store.js';
import {registerNotifications} from './notification-routes.js';
import {NotificationSaveSchema} from '../../../packages/contracts/src/notifications.js';
const location={id:'tulsa',name:'Tulsa',latitude:36.1,longitude:-95.9,country:'US',timezone:'America/Chicago'};
export const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/example',keys:{p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)}};
const input={subscription,preferences:{locations:[location],quietStart:22,quietEnd:7,urgentDuringQuiet:true}};
test('push destinations fail closed and preference place/timezone validation',()=>{
 for(const endpoint of ['http://fcm.googleapis.com/path','https://localhost/push','https://fcm.googleapis.com.evil.test/push','https://user@fcm.googleapis.com/push','https://fcm.googleapis.com:8443/push','https://127.0.0.1/push'])assert.equal(NotificationSaveSchema.safeParse({...input,subscription:{...subscription,endpoint}}).success,false);
 assert.equal(NotificationSaveSchema.safeParse({...input,preferences:{...input.preferences,locations:[location,location]}}).success,false);
 assert.equal(NotificationSaveSchema.safeParse({...input,preferences:{...input.preferences,locations:[{...location,timezone:'bad'}]}}).success,false);
});
test('authenticated subscription isolation, same-origin, disable and revocation',async()=>{
 const app=Fastify(),repo=new NotificationRepository(':memory:'),installations=new InstallationRepository({path:':memory:'});registerNotifications(app,repo,installations,'public');
 const a=installations.register(86400000),b=installations.register(86400000);const headers={authorization:`Bearer ${a.bearer}`,'x-zindycast-request':'1'};
 try{
 assert.equal((await app.inject({method:'POST',url:'/api/v1/notifications',headers:{...headers,origin:'https://other.test'},payload:input})).statusCode,403);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/notifications',headers,payload:input})).statusCode,200);
 assert.equal((await app.inject({url:'/api/v1/notifications',headers:{authorization:`Bearer ${b.bearer}`}})).json().enabled,false);
 assert.equal((await app.inject({url:'/api/v1/notifications',headers})).json().enabled,true);
 assert.equal((await app.inject({method:'POST',url:'/api/v1/notifications/disable',headers})).statusCode,200);assert.equal(repo.status(a.id).enabled,false);
 installations.revoke(a.bearer);assert.equal((await app.inject({method:'POST',url:'/api/v1/notifications',headers,payload:input})).statusCode,401);
 }finally{await app.close();repo.close();installations.close();}
});
test('durable lease, idempotent saves, endpoint ownership, changed preference and stale lease fences',()=>{
 let now=1000;const repo=new NotificationRepository(':memory:',()=>now);try{
 repo.save('a',input,1000000);const first=repo.claim()!;assert.ok(first);assert.equal(repo.claim(),null);
 assert.equal(repo.reserve(first,'warning',10000),true);assert.equal(repo.reserve(first,'warning',10000),false);
 repo.save('a',input,1000000);assert.equal(repo.active(first),true);
 assert.throws(()=>repo.save('b',input,1000000));
 repo.save('a',{...input,preferences:{...input.preferences,quietEnd:8}},1000000);assert.equal(repo.active(first),false);
 const second=repo.claim()!;now+=180001;assert.equal(repo.active(second),false);assert.equal(repo.reserve(second,'new',1000000),false);
 repo.remove('a');assert.equal(repo.status('a').enabled,false);
 }finally{repo.close();}
});
