import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { NotificationSaveSchema, type NotificationSave } from '../../../packages/contracts/src/notifications.js';
export type NotificationRecord = NotificationSave & { owner:string; revision:string; expiresAt:number; lease:string; savedAt:number };
/** Private endpoint/key storage. Bounded rows and disk; no endpoints or credentials in logs/status. */
export class NotificationRepository {
  private db:DatabaseSync;
  constructor(path:string,private now:()=>number=Date.now) {
    this.db=new DatabaseSync(path,{timeout:1000});
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA wal_autocheckpoint=128; PRAGMA journal_size_limit=1048576; PRAGMA max_page_count=4096;
    CREATE TABLE IF NOT EXISTS notification_subscriptions(owner TEXT PRIMARY KEY,endpoint_hash TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,revision TEXT NOT NULL,saved_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,next_check INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_checked INTEGER,last_delivery INTEGER,outcome TEXT NOT NULL DEFAULT 'not_checked') STRICT;
    CREATE TABLE IF NOT EXISTS notification_deliveries(owner TEXT NOT NULL,revision TEXT NOT NULL,identity TEXT NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(owner,identity)) STRICT;
    CREATE INDEX IF NOT EXISTS notification_due ON notification_subscriptions(next_check,lease_until);`);
  }
  private transaction<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try {const r=fn();this.db.exec('COMMIT');return r;}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}}
  save(owner:string,input:NotificationSave,expiresAt:number) {
    const data=NotificationSaveSchema.parse(input),now=this.now();
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=now)throw new Error('Expired installation');
    const subExpiry=data.subscription.expirationTime;
    expiresAt=Math.min(expiresAt,subExpiry??expiresAt);
    if(expiresAt<=now)throw new Error('Expired subscription');
    const payload=JSON.stringify(data);if(Buffer.byteLength(payload)>14000)throw new Error('Subscription too large');
    this.transaction(()=>{
      const prior=this.db.prepare('SELECT * FROM notification_subscriptions WHERE owner=?').get(owner);
      if(prior?.payload===payload && Number(prior.expires_at)===expiresAt)return;
      if(!prior && Number(this.db.prepare('SELECT count(*) AS n FROM notification_subscriptions').get()!.n)>=100)throw new Error('Notification capacity reached');
      this.db.prepare('INSERT INTO notification_subscriptions(owner,endpoint_hash,payload,revision,saved_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET endpoint_hash=excluded.endpoint_hash,payload=excluded.payload,revision=excluded.revision,saved_at=excluded.saved_at,expires_at=excluded.expires_at,next_check=0,lease=NULL,lease_until=0,outcome=\'not_checked\'').run(owner,createHash('sha256').update(data.subscription.endpoint).digest('hex'),payload,randomUUID(),now,expiresAt);
    });
  }
  status(owner:string) {const row=this.db.prepare('SELECT * FROM notification_subscriptions WHERE owner=? AND expires_at>?').get(owner,this.now());return row?{enabled:true,preferences:NotificationSaveSchema.parse(JSON.parse(String(row.payload))).preferences,expiresAt:Number(row.expires_at),lastCheckedAt:row.last_checked===null?null:Number(row.last_checked),lastDeliveryAt:row.last_delivery===null?null:Number(row.last_delivery),lastOutcome:String(row.outcome)}:{enabled:false,preferences:null,expiresAt:null,lastCheckedAt:null,lastDeliveryAt:null,lastOutcome:null};}
  remove(owner:string) {this.transaction(()=>{this.db.prepare('DELETE FROM notification_subscriptions WHERE owner=?').run(owner);this.db.prepare('DELETE FROM notification_deliveries WHERE owner=?').run(owner);});}
  claim():NotificationRecord|null {return this.transaction(()=>{const now=this.now();const row=this.db.prepare('SELECT * FROM notification_subscriptions WHERE expires_at>? AND next_check<=? AND lease_until<=? ORDER BY next_check,owner LIMIT 1').get(now,now,now);if(!row)return null;
    const lease=randomUUID();this.db.prepare('UPDATE notification_subscriptions SET lease=?,lease_until=?,next_check=? WHERE owner=?').run(lease,now+180000,now+120000,row.owner);
    return {...NotificationSaveSchema.parse(JSON.parse(String(row.payload))),owner:String(row.owner),revision:String(row.revision),savedAt:Number(row.saved_at),expiresAt:Number(row.expires_at),lease};});}
  active(r:NotificationRecord) {return !!this.db.prepare('SELECT 1 FROM notification_subscriptions WHERE owner=? AND revision=? AND lease=? AND lease_until>? AND expires_at>?').get(r.owner,r.revision,r.lease,this.now(),this.now());}
  reserve(r:NotificationRecord,identity:string,expiresAt:number):boolean {return this.transaction(()=>{if(!this.active(r)||expiresAt<=this.now())return false;
    if(Number(this.db.prepare('SELECT count(*) AS n FROM notification_deliveries').get()!.n)>=5000)return false;
    return Number(this.db.prepare("INSERT OR IGNORE INTO notification_deliveries VALUES(?,?,?,?, 'attempted')").run(r.owner,r.revision,identity,expiresAt).changes)===1;});}
  finishDelivery(r:NotificationRecord,identity:string,ok:boolean) {if(!this.active(r))return;this.db.prepare('UPDATE notification_deliveries SET state=? WHERE owner=? AND revision=? AND identity=?').run(ok?'delivered':'failed',r.owner,r.revision,identity);this.db.prepare('UPDATE notification_subscriptions SET outcome=?,last_delivery=CASE WHEN ? THEN ? ELSE last_delivery END WHERE owner=? AND revision=?').run(ok?'delivered':'delivery_failed',Number(ok),this.now(),r.owner,r.revision);}
  release(r:NotificationRecord,sourceOk:boolean) {this.db.prepare("UPDATE notification_subscriptions SET lease=NULL,lease_until=0,last_checked=?,outcome=CASE WHEN ?='source_unavailable' THEN 'source_unavailable' WHEN outcome IN ('delivered','delivery_failed') THEN outcome ELSE ? END WHERE owner=? AND revision=? AND lease=?").run(this.now(),sourceOk?'checked':'source_unavailable',sourceOk?'checked':'source_unavailable',r.owner,r.revision,r.lease);}
  cleanup(isActive?:(owner:string)=>boolean){if(isActive)for(const row of this.db.prepare('SELECT owner FROM notification_subscriptions LIMIT 100').all())if(!isActive(String(row.owner)))this.remove(String(row.owner));this.transaction(()=>{this.db.prepare('DELETE FROM notification_deliveries WHERE expires_at<=?').run(this.now());this.db.prepare('DELETE FROM notification_deliveries WHERE owner IN (SELECT owner FROM notification_subscriptions WHERE expires_at<=?)').run(this.now());this.db.prepare('DELETE FROM notification_subscriptions WHERE expires_at<=?').run(this.now());});this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');}
  close(){this.db.close();}
}
