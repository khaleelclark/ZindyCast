import type { FastifyInstance } from 'fastify';
import { WetBulbTrackerResponseSchema } from '@zindycast/contracts';
import { TRACKER_RETENTION_DAYS, type WetBulbTrackerStore } from './wet-bulb-tracker-store.js';
import type { Location } from '@zindycast/contracts';
export function registerWetBulbTracker(app:FastifyInstance,store:WetBulbTrackerStore|null,location:Location|null,capture?:()=>Promise<'saved'|'same'>){
 app.get('/api/v1/wet-bulb-tracker',async(_request,reply)=>{if(!store||!location)return reply.code(404).send({status:'error',code:'not_configured',message:'Wet-bulb tracker is not enabled.'});return WetBulbTrackerResponseSchema.parse({status:'success',location,cadenceMinutes:30,retentionDays:TRACKER_RETENTION_DAYS,records:store.list(Date.now()-TRACKER_RETENTION_DAYS*86400000)});});
 app.post('/api/v1/wet-bulb-tracker/capture',async(request,reply)=>{if(request.headers['x-zindycast-request']!=='1')return reply.code(403).send({status:'error',code:'invalid_request',message:'Manual capture requires the ZindyCast app.'});if(!store||!location||!capture)return reply.code(404).send({status:'error',code:'not_configured',message:'Wet-bulb tracker is not enabled.'});try{const result=await capture();if(result==='same')return reply.code(409).send({status:'error',code:'same_result',message:'The current result is the same as the latest saved record.'});return {status:'success',result:'saved'};}catch{return reply.code(502).send({status:'error',code:'provider_error',message:'Current weather could not be captured. Try again shortly.'});}});
}
