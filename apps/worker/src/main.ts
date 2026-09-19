import {VerificationRepository} from '@zindycast/verification';
import {createVerificationWorker} from './verification-runtime.js';
import {NotificationRepository} from '../../api/src/notifications-store.js';
import {NotificationWorker,vapidConfig,pushSender} from './notification-worker.js';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { JobRepository } from '@zindycast/jobs';
import { InstallationRepository } from '@zindycast/installations';
import { AdmissionReconciler } from './reconciliation.js';
import { ComparisonWorker } from './comparison-worker.js';
import { ClimateWorker } from './climate-worker.js';
import { closeRepositories } from './shutdown.js';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {WetBulbTrackerStore,wetBulbTrackerLocation} from '../../api/src/wet-bulb-tracker-store.js';
import {WetBulbTrackerWorker} from './wet-bulb-tracker-worker.js';
process.umask(0o077);
function dbPath(value: string): string { const path = resolve(value); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); return path; }
const storage = new SharedStorage({ path: dbPath(process.env.ZINDYCAST_DB_PATH ?? 'var/coordination.sqlite'), providers: APP_PROVIDER_LIMITS });
const jobs = new JobRepository({ path: dbPath(process.env.ZINDYCAST_JOBS_PATH ?? 'var/jobs.sqlite') });
const installations = new InstallationRepository({ path: dbPath(process.env.ZINDYCAST_INSTALLATIONS_PATH ?? 'var/installations.sqlite') });
const worker = new ComparisonWorker({ storage, jobs, installations });
const climateWorker = new ClimateWorker({storage,jobs,installations});
const reconciler = new AdmissionReconciler(jobs, installations);
const notifications=new NotificationRepository(dbPath(process.env.ZINDYCAST_NOTIFICATIONS_PATH??'var/notifications.sqlite'));
const verification=new VerificationRepository({path:dbPath(process.env.ZINDYCAST_VERIFICATION_PATH??'var/verification.sqlite')});
const verificationWorker=createVerificationWorker(verification,storage,id=>installations.isActive(id));
const trackerLocation=wetBulbTrackerLocation();
const trackerStore=trackerLocation?new WetBulbTrackerStore(dbPath(process.env.ZINDYCAST_WET_BULB_TRACKER_PATH??'var/wet-bulb-tracker.sqlite')):null;
const trackerWorker=trackerStore&&trackerLocation?new WetBulbTrackerWorker(trackerStore,trackerLocation,storage):null;
const pushConfig=vapidConfig();
const notificationWorker=pushConfig?new NotificationWorker({repo:notifications,installations,storage,send:pushSender(pushConfig)}):null;
const shutdown = new AbortController();
function maintain() {
  try { notifications.cleanup(id=>installations.isActive(id)); verification.cleanup(); const result = { reconciliation: reconciler.runBatch(100), storage: storage.cleanup(1000), jobs: jobs.cleanup(1000), installations: installations.cleanup(1000) }; console.log(JSON.stringify({ service: 'worker', status: 'maintenance', maintenance: result, time: new Date().toISOString() })); }
  catch { console.error(JSON.stringify({ service: 'worker', status: 'maintenance_failed', time: new Date().toISOString() })); }
}
maintain();
const maintenance = setInterval(maintain, 60_000);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => shutdown.abort());
async function pause(ms:number) {if(shutdown.signal.aborted)return;await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);shutdown.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);shutdown.signal.addEventListener('abort',done,{once:true});});}
async function comparisonLoop(){while(!shutdown.signal.aborted){try{await worker.runOnce(shutdown.signal);await climateWorker.runOnce(shutdown.signal);}catch{if(!shutdown.signal.aborted)console.error(JSON.stringify({service:'worker',status:'job_processing_failed'}));}await pause(1000);}}
async function warningLoop(){while(!shutdown.signal.aborted){try{await notificationWorker?.runOnce(shutdown.signal);}catch{if(!shutdown.signal.aborted)console.error(JSON.stringify({service:'worker',status:'notification_processing_failed'}));}await pause(2000);}}
async function verificationLoop(){while(!shutdown.signal.aborted){try{await verificationWorker.runOnce(shutdown.signal);}catch{if(!shutdown.signal.aborted)console.error(JSON.stringify({service:'worker',status:'verification_processing_failed'}));}await pause(5000);}}
async function trackerLoop(){while(!shutdown.signal.aborted){try{await trackerWorker?.runOnce(shutdown.signal);}catch{if(!shutdown.signal.aborted)console.error(JSON.stringify({service:'worker',status:'wet_bulb_tracker_failed'}));}await pause(30000);}}
try {
  await Promise.all([comparisonLoop(),warningLoop(),verificationLoop(),trackerLoop()]);
} finally {
  clearInterval(maintenance);
  if (closeRepositories([storage, jobs, installations, notifications, verification, ...(trackerStore?[trackerStore]:[])])) {
    console.error(JSON.stringify({ service: 'worker', status: 'shutdown_failed', time: new Date().toISOString() }));
    process.exitCode = 1;
  }
}
