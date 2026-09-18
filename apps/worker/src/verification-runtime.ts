import {createHash} from 'node:crypto';
import {ForecastSchema} from '@zindycast/contracts';
import {getForecast,getModelForecast,type ForecastModel} from '@zindycast/providers';
import {fetchNearbyObservations} from '../../../packages/providers/src/observations.js';
import {ObservationsDataSchema,type ObservationQuery} from '../../../packages/contracts/src/observations.js';
import type {VerificationRepository} from '@zindycast/verification';
import type {SharedStorage} from '@zindycast/storage';
import {CachedRequests} from '../../api/src/cache.js';
import {VerificationWorker,observationSnapshotFromNws} from './verification-worker.js';
/** Scheduled pilot: baseline every six hours, two named candidates at most daily.
 * Every upstream request shares the existing persistent quota/refresh fencing. */
export function createVerificationWorker(verification:VerificationRepository,storage:SharedStorage, isInstallationActive:(installationId:string)=>boolean, sources={getForecast,getModelForecast,fetchNearbyObservations}){
 const cached=new CachedRequests(storage);
 return new VerificationWorker({verification,isInstallationActive,
  candidateModels:[{id:'open-meteo-gfs',role:'candidate',provider:'Open-Meteo',requestedModel:'gfs_seamless',constituentModel:null},{id:'open-meteo-ifs',role:'candidate',provider:'Open-Meteo',requestedModel:'ecmwf_ifs025',constituentModel:null}],
  // CachedRequests performs the actual persistent reservation, including cache hits.
  reserveCandidateBudget:()=>true,
  fetchForecast:async(target,model,signal)=>{
   const requested=target.location;
   const key=model.role==='baseline'?`forecast:v6:28-fields:current:astronomy:wbgt-fao-instant-v1:360h:past1:utc:si:${JSON.stringify(requested)}`:`verification:forecast:v1:${model.requestedModel}:${JSON.stringify(requested)}`;
   const schema=ForecastSchema.refine(f=>f.location.latitude===requested.latitude&&f.location.longitude===requested.longitude&&f.location.timezone===requested.timezone&&Date.parse(f.provenance.retrievedAt)<=Date.now()&&Date.now()-Date.parse(f.provenance.retrievedAt)<300000);
   const r=await cached.get(key,schema,3,300000,0,()=>model.role==='baseline'?sources.getForecast(requested,signal):sources.getModelForecast(requested,model.requestedModel as ForecastModel,signal));
   if(r.freshness!=='fresh')throw new Error('Accuracy collection requires fresh forecasts');return r.data;
  },
  fetchObservations:async(target,need,signal)=>{
   const query:ObservationQuery={latitude:target.location.latitude,longitude:target.location.longitude,since:need.requestStartTime,until:need.requestEndTime,stationLimit:3};
   const key='verification:observations:v1:'+createHash('sha256').update(JSON.stringify(query)).digest('hex');
   const schema=ObservationsDataSchema.refine(d=>JSON.stringify(d.query)===JSON.stringify(query));
   const r=await cached.get(key,schema,5,300000,0,()=>sources.fetchNearbyObservations(query,signal),'nws');
   if(r.freshness!=='fresh')throw new Error('Accuracy collection requires a fresh observation retrieval');return observationSnapshotFromNws(target,need,r.data);
  },
 });
}
