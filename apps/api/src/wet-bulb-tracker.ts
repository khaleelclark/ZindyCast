import type { FastifyInstance } from 'fastify';
import { WetBulbTrackerResponseSchema } from '@zindycast/contracts';
import { TRACKER_RETENTION_DAYS, type WetBulbTrackerStore } from './wet-bulb-tracker-store.js';
import type { Location } from '@zindycast/contracts';
export function registerWetBulbTracker(app:FastifyInstance,store:WetBulbTrackerStore|null,location:Location|null){
 app.get('/api/v1/wet-bulb-tracker',async(_request,reply)=>{if(!store||!location)return reply.code(404).send({status:'error',code:'not_configured',message:'Wet-bulb tracker is not enabled.'});return WetBulbTrackerResponseSchema.parse({status:'success',location,cadenceMinutes:30,retentionDays:TRACKER_RETENTION_DAYS,records:store.list(Date.now()-TRACKER_RETENTION_DAYS*86400000)});});
}
