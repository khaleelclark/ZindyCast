import {test} from 'node:test';import assert from 'node:assert/strict';
import {NotificationWorker,quietAt,eligibleWarning} from './notification-worker.js';
import {NotificationRepository} from '../../api/src/notifications-store.js';
import {InstallationRepository} from '@zindycast/installations';import {SharedStorage,APP_PROVIDER_LIMITS} from '@zindycast/storage';
import type {AlertsData} from '@zindycast/contracts';
const location={id:'tulsa',name:'Tulsa',latitude:36.1,longitude:-95.9,country:'US',timezone:'America/Chicago'};
const prefs={locations:[location],quietStart:22,quietEnd:7,urgentDuringQuiet:true};
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)}};
const warning=(now:number):AlertsData['alerts'][number]=>({id:'one',event:'Tornado Warning',headline:'Test fixture',severity:'Extreme',urgency:'Immediate',certainty:'Observed',sent:new Date(now-1000).toISOString(),effective:new Date(now-1000).toISOString(),onset:null,expires:new Date(now+3600000).toISOString(),ends:null,status:'Actual',messageType:'Alert',description:'Fixture',instruction:null,areaDesc:'Fixture',senderName:'NWS',web:null,geometry:null,affectedZones:[]});
test('quiet hours use place zone across midnight and only official active warning policy',()=>{const now=Date.parse('2026-09-14T04:00:00Z');assert.equal(quietAt(prefs,'America/Chicago',now),true);assert.equal(quietAt(prefs,'Pacific/Honolulu',now),false);assert.equal(quietAt({...prefs,quietStart:7,quietEnd:7},'UTC',now),false);assert.ok(eligibleWarning(warning(now),now));assert.equal(eligibleWarning({...warning(now),messageType:'Cancel'},now),false);assert.equal(eligibleWarning({...warning(now),event:'Tornado Watch'},now),false);assert.equal(eligibleWarning({...warning(now),expires:new Date(now).toISOString()},now),false);});
for(const mode of ['success','revoked','expired-endpoint','stale','mismatch','ambiguous']as const)test(`notification worker ${mode}: bounded, no duplicate and no invalid-source send`,async()=>{
 const now=Date.now();const repo=new NotificationRepository(':memory:'),installations=new InstallationRepository({path:':memory:'}),storage=new SharedStorage({path:':memory:',providers:APP_PROVIDER_LIMITS});const reg=installations.register(86400000);repo.save(reg.id,{subscription:sub,preferences:prefs},reg.expiresAt);let sent=0;
 if(mode==='revoked')installations.revoke(reg.bearer);
 const fetchAlerts=async():Promise<AlertsData>=>({coordinates:mode==='mismatch'?{latitude:0,longitude:0}:location,retrievedAt:new Date(mode==='stale'?now-180000:now).toISOString(),provider:'NWS',alerts:[warning(now),warning(now)],attribution:'NWS'});
 const send=async()=>{sent++;if(mode==='expired-endpoint')throw {statusCode:410};if(mode==='ambiguous')throw new Error('timeout');};
 try{const worker=new NotificationWorker({repo,installations,storage,send,fetchAlerts});await worker.runOnce(new AbortController().signal);await worker.runOnce(new AbortController().signal);assert.equal(sent,['success','expired-endpoint','ambiguous'].includes(mode)?1:0);if(mode==='expired-endpoint'||mode==='revoked')assert.equal(repo.status(reg.id).enabled,false);}
 finally{repo.close();installations.close();storage.close();}
});
