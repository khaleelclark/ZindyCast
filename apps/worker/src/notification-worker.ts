import {createHash} from 'node:crypto';
import webpush from 'web-push';
import {AlertsDataSchema,type AlertsData} from '@zindycast/contracts';
import type {InstallationRepository} from '@zindycast/installations';
import {getAlerts} from '@zindycast/providers';
import type {SharedStorage} from '@zindycast/storage';
import {CachedRequests} from '../../api/src/cache.js';
import {NotificationRepository,type NotificationRecord} from '../../api/src/notifications-store.js';
import type {NotificationPreferences,NotificationSave} from '../../../packages/contracts/src/notifications.js';
export type PushPayload={title:string;body:string;tag:string;expiresAt:number;sentAt:number;location:NotificationPreferences['locations'][number]};
export type PushSender=(subscription:NotificationSave['subscription'],payload:PushPayload,ttl:number)=>Promise<void>;
export {notificationConfig as vapidConfig} from '../../api/src/notification-config.js';
import {notificationConfig as vapidConfig} from '../../api/src/notification-config.js';
export function pushSender(config:NonNullable<ReturnType<typeof vapidConfig>>):PushSender {
  return async(subscription,payload,ttl)=>{await webpush.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:config,TTL:ttl,timeout:8000,urgency:'high',topic:payload.tag});};
}
export function quietAt(p:NotificationPreferences,timezone:string,now:number) {
  if(p.quietStart===p.quietEnd)return false;
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(now));
  return p.quietStart<p.quietEnd?hour>=p.quietStart&&hour<p.quietEnd:hour>=p.quietStart||hour<p.quietEnd;
}
export function eligibleWarning(a:AlertsData['alerts'][number],now:number) {
  return a.status==='Actual' && ['Alert','Update'].includes(a.messageType) && /warning/i.test(a.event) && ['Severe','Extreme'].includes(a.severity) &&
    Date.parse(a.sent)<=now && a.expires!==null && Date.parse(a.expires)>now && (!a.effective||Date.parse(a.effective)<=now) && (!a.ends||Date.parse(a.ends)>now);
}
export class NotificationWorker {
  private cached:CachedRequests;
  constructor(private o:{repo:NotificationRepository;installations:InstallationRepository;storage:SharedStorage;send:PushSender;fetchAlerts?:typeof getAlerts;now?:()=>number}) {this.cached=new CachedRequests(o.storage);}
  async runOnce(signal:AbortSignal):Promise<void> {
    signal.throwIfAborted();const r=this.o.repo.claim();if(!r)return;
    const now=()=>this.o.now?.()??Date.now();let sourceOk=true,attempts=0;
    const active=()=>!signal.aborted&&this.o.repo.active(r)&&this.o.installations.isActive(r.owner);
    try {
      if(!active()){if(!this.o.installations.isActive(r.owner))this.o.repo.remove(r.owner);return;}
      for(const location of r.preferences.locations){
        if(!active())break;
        let data:AlertsData;
        try {const response=await this.cached.get(`nws:active:v1:${location.latitude},${location.longitude}`,AlertsDataSchema,1,60000,0,()=> (this.o.fetchAlerts??getAlerts)(location.latitude,location.longitude,AbortSignal.any([signal,AbortSignal.timeout(10000)])),'nws');
          data=response.data;
          if(response.freshness!=='fresh'||data.coordinates.latitude!==location.latitude||data.coordinates.longitude!==location.longitude||now()-Date.parse(data.retrievedAt)<0||now()-Date.parse(data.retrievedAt)>120000)throw new Error('Stale or mismatched source');
        }catch{sourceOk=false;continue;}
        for(const alert of data.alerts){
          if(!active()||attempts>=5)break;
          const time=now();if(!eligibleWarning(alert,time))continue;
          const urgent=alert.urgency==='Immediate'&&['Severe','Extreme'].includes(alert.severity);
          if(quietAt(r.preferences,location.timezone,time)&&!(urgent&&r.preferences.urgentDuringQuiet))continue;
          // One notification per official revision per installation, even when saved places overlap.
          const identity=createHash('sha256').update(`${alert.id}|${alert.sent}`).digest('base64url');
          const expiry=Math.min(Date.parse(alert.expires!),alert.ends?Date.parse(alert.ends):Infinity,r.expiresAt,time+120000);
          if(!this.o.repo.reserve(r,identity,Math.max(Date.parse(alert.expires!),time+86400000)))continue;
          if(!active()||expiry<=now())break;
          attempts++;
          const payload:PushPayload={title:`NWS: ${alert.event}`.slice(0,120),body:`${location.name}: ${(alert.headline??alert.event).slice(0,180)}. Open for current official details.`,tag:identity.slice(0,32),expiresAt:expiry,sentAt:time,location};
          try {await this.o.send(r.subscription,payload,Math.max(0,Math.floor((expiry-now())/1000)));this.o.repo.finishDelivery(r,identity,true);}
          catch(e){this.o.repo.finishDelivery(r,identity,false);const status=e && typeof e==='object'&&'statusCode'in e?e.statusCode:null;if(status===404||status===410){this.o.repo.remove(r.owner);return;}}
        }
      }
    }finally{this.o.repo.release(r,sourceOk);}
  }
}
