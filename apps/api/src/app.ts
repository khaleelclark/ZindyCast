import {fetchNearbyObservations} from '../../../packages/providers/src/observations.js';
import {ObservationsDataSchema} from '../../../packages/contracts/src/observations.js';
import {VerificationRepository} from '@zindycast/verification';
import {registerVerification,archiveReceivedForecast} from './verification.js';
import {registerObservations} from './observations.js';
import {registerClimateNormals} from './climate-normals.js';
import {NotificationRepository} from './notifications-store.js';
import {registerNotifications} from './notification-routes.js';
import {registerClimateComparisons} from './climate-comparisons.js';
import { registerLibreRadar } from './libre-radar.js';
import { registerMapboxBudget } from './mapbox-budget.js';
import {registerHeaders} from './headers.js';
import {registerWetBulbTracker} from './wet-bulb-tracker.js';
import type {WetBulbTrackerStore} from './wet-bulb-tracker-store.js';
import {trackerRecord,sameTrackerResult} from './wet-bulb-tracker-record.js';
import Fastify from 'fastify';
import {JobRepository} from '@zindycast/jobs';
import {InstallationRepository} from '@zindycast/installations';
import {registerComparisons,type JobServices} from './comparisons.js';
import { SharedStorage, APP_PROVIDER_LIMITS } from '@zindycast/storage';
import { CachedRequests } from './cache.js';
import { registerMaps } from './maps.js';
import { registerForecastRadar } from './forecast-radar.js';
import { registerHistory } from './history.js';
import { registerStations } from './stations.js';
import { registerStationDiscovery } from './station-discovery.js';
import { registerWildfires } from './wildfire.js';
import { z } from 'zod';
import { ProviderError } from '@zindycast/providers';
import { LocationSchema, ForecastSchema, ForecastResponseSchema, SearchResponseSchema, ResolvedLocationResponseSchema, AlertsDataSchema, AlertsResponseSchema, type AlertsData, type Location, type Forecast } from '@zindycast/contracts';
export interface Providers {
  getAlerts?(latitude:number,longitude:number,signal?:AbortSignal):Promise<AlertsData>;
  resolveLocation?(latitude: number, longitude: number, signal?: AbortSignal): Promise<Location>;
  searchLocations(query: string, signal?: AbortSignal): Promise<Location[]>;
  getForecast(location: Location, signal?: AbortSignal): Promise<Forecast>;
}
const Query = z.object({ refresh: z.enum(['1']).optional(), latitude: z.coerce.number().finite().min(-90).max(90), longitude: z.coerce.number().finite().min(-180).max(180), name: z.string().min(1).max(160), timezone: z.string().min(1).max(80), id: z.string().max(160).optional(), country: z.string().max(100).default(''), admin1: z.string().max(100).optional(), admin2: z.string().max(100).optional() });
export function createApp(providers: Providers, storage = new SharedStorage({path: ':memory:', providers:APP_PROVIDER_LIMITS}), jobServices:JobServices={jobs:new JobRepository({path:':memory:'}),installations:new InstallationRepository({path:':memory:'})}, notificationServices:{repo:NotificationRepository;publicKey:string|null}={repo:new NotificationRepository(':memory:'),publicKey:null}, verification=new VerificationRepository({path:':memory:'}), tracker:{store:WetBulbTrackerStore|null;location:Location|null}={store:null,location:null}) {
  const failure = (error: unknown) => error instanceof ProviderError && error.code === 'rate_limited'
    ? { http: 429, code: 'rate_limited', message: 'Weather service request limit reached. Try again later.', retry: error.retryAfterSeconds }
    : error instanceof ProviderError && error.code === 'no_data'
    ? { http: 503, code: 'no_data', message: 'No weather data were published for this request.', retry: undefined }
    : { http: 502, code: 'provider_error', message: 'Weather service is temporarily unavailable.', retry: undefined };
  const app = Fastify({ logger: false, bodyLimit: 16384, requestTimeout: 15000, connectionTimeout: 15000, keepAliveTimeout: 5000, maxRequestsPerSocket: 100 });
  registerHeaders(app);
  registerNotifications(app,notificationServices.repo,jobServices.installations,notificationServices.publicKey);
  app.setErrorHandler((error,_request,reply)=>{ const status=error instanceof Error && 'statusCode' in error ? error.statusCode : null; const invalid=status===400 || status===413 || status===415; reply.code(invalid?status:503).send({status:'error',code:invalid?'invalid_request':'provider_error',message:status===413?'Request body is too large.':invalid?'Invalid request.':'Service temporarily unavailable.'}); });
  app.addHook('onRequest', async (request, reply) => { if (request.url.startsWith('/api/')) reply.header('Cache-Control','no-store'); });
  const cached = new CachedRequests(storage);
  registerWetBulbTracker(app,tracker.store,tracker.location,tracker.store&&tracker.location?async()=>{const location=tracker.location!;const schema=ForecastSchema.refine(f=>JSON.stringify(f.location)===JSON.stringify(location));const key=`forecast:v6:28-fields:current:astronomy:wbgt-fao-instant-v1:360h:past1:utc:si:${JSON.stringify(location)}`;const forecast=(await cached.get(key,schema,3,300000,0,()=>providers.getForecast(location,AbortSignal.timeout(10000)),'open-meteo',10000)).data;const record=trackerRecord(forecast);const latest=tracker.store!.latest();if(latest&&sameTrackerResult(latest,record))return 'same';tracker.store!.add(record);return 'saved';}:undefined);
  registerMapboxBudget(app,storage);
  registerClimateNormals(app,cached);
  registerObservations(app,cached);
  registerVerification(app,{verification,installations:jobServices.installations,fetchStationCandidates:async(query,signal)=>{
    const schema=ObservationsDataSchema.refine(d=>JSON.stringify(d.query)===JSON.stringify(query));
    const response=await cached.get(`verification:station-validation:v1:${JSON.stringify(query)}`,schema,5,300000,0,()=>fetchNearbyObservations(query,signal),'nws');
    if(response.freshness!=='fresh')throw new Error('Station validation requires a fresh source');
    return response.data;
  }});
  registerMaps(app,cached);
  registerForecastRadar(app,cached);
  registerLibreRadar(app,cached);
  registerHistory(app,cached);
  registerStations(app,cached);
  registerStationDiscovery(app,cached);
  registerWildfires(app,cached);
  registerComparisons(app,jobServices);
  registerClimateComparisons(app,jobServices,cached);
  app.addHook('onClose',async()=>{let failed=false;for(const repository of [jobServices.jobs,jobServices.installations,storage,notificationServices.repo,verification,tracker.store]){try{repository?.close();}catch{failed=true;}}if(failed)throw new Error('Repository shutdown failed');});
  app.get('/api/v1/health', async () => ({ status: 'ok', service: 'api', version: '0.1.0' }));
  app.get('/api/v1/locations', async (request, reply) => {
    const parsed = z.object({ q: z.string().trim().min(2).max(100) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: 'error', code: 'invalid_request', message: 'Enter a city name of 2–100 characters.' });
    try { return SearchResponseSchema.parse({ status: 'success', locations: (await cached.get(`geocoding:v1:${parsed.data.q.toLowerCase()}`, LocationSchema.array(), 1, 86400000, 0, () => providers.searchLocations(parsed.data.q, AbortSignal.timeout(10000)))).data }); }
    catch (error) { const result = failure(error); if (result.retry !== undefined) reply.header('Retry-After', result.retry); return reply.code(result.http).send({ status: 'error', code: result.code, message: result.message }); }
  });
  app.get('/api/v1/location', async (request, reply) => {
    const parsed = z.object({ latitude: z.coerce.number().finite().min(-90).max(90), longitude: z.coerce.number().finite().min(-180).max(180) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: 'error', code: 'invalid_request', message: 'Valid coordinates are required.' });
    if (!providers.resolveLocation) return reply.code(503).send({ status: 'error', code: 'not_configured', message: 'Location resolution is not yet available.' });
    try { return ResolvedLocationResponseSchema.parse({ status: 'success', location: (await cached.get(`timezone:v1:${parsed.data.latitude},${parsed.data.longitude}`, LocationSchema, 1, 86400000, 0, () => providers.resolveLocation!(parsed.data.latitude, parsed.data.longitude, AbortSignal.timeout(10000)))).data }); }
    catch (error) { const result = failure(error); if (result.retry !== undefined) reply.header('Retry-After', result.retry); return reply.code(result.http).send({ status: 'error', code: result.code, message: result.message }); }
  });
  app.get('/api/v1/alerts', async (request, reply) => {
    const q = z.object({latitude:z.coerce.number().finite().min(-90).max(90),longitude:z.coerce.number().finite().min(-180).max(180)}).safeParse(request.query);
    if(!q.success) return reply.code(400).send({status:'error',code:'invalid_request',message:'Valid coordinates are required.'});
    if(!providers.getAlerts) return reply.code(503).send({status:'error',code:'not_configured',message:'Official alerts are not configured.'});
    try {
      const result = await cached.get(`nws:active:v1:${q.data.latitude},${q.data.longitude}`,AlertsDataSchema,1,60000,240000,()=>providers.getAlerts!(q.data.latitude,q.data.longitude,AbortSignal.timeout(10000)),'nws');
      if(result.data.coordinates.latitude!==q.data.latitude || result.data.coordinates.longitude!==q.data.longitude) throw new Error('Alert coordinates mismatch');
      const now=Date.now();
      const alerts=result.data.alerts.filter(a=>a.status==='Actual' && a.messageType!=='Cancel' && (!a.expires || Date.parse(a.expires)>now) && (!a.ends || Date.parse(a.ends)>now));
      return AlertsResponseSchema.parse({status:'success',freshness:result.freshness,data:{...result.data,alerts}});
    }catch(error){ const result=failure(error);if(result.retry!==undefined)reply.header('Retry-After',result.retry);return reply.code(result.http).send({status:'error',code:result.code,message:result.message}); }
  });
  app.get('/api/v1/forecast', async (request, reply) => {
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ status: 'error', code: 'invalid_request', message: 'A valid location and time zone are required.' });
    try { new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone }); }
    catch { return reply.code(400).send({ status: 'error', code: 'invalid_request', message: 'Unknown time zone.' }); }
    const location = LocationSchema.parse({ ...parsed.data, id: parsed.data.id ?? `${parsed.data.latitude},${parsed.data.longitude}` });
    const key = `forecast:v6:28-fields:current:astronomy:wbgt-fao-instant-v1:360h:past1:utc:si:${JSON.stringify(location)}`;
    try {
      // Eighteen hourly, two daily and eight current fields: conservatively reserve three weighted calls.
      const result = await cached.get(key, ForecastSchema, 3, 300000, 1800000, async () => {
        const data = ForecastSchema.parse(await providers.getForecast(location, AbortSignal.timeout(10000)));
        if (JSON.stringify(data.location) !== JSON.stringify(location)) throw new Error('Location mismatch');
        return data;
      }, 'open-meteo', parsed.data.refresh === '1' ? 10000 : 300000);

      if(result.freshness==='fresh')try{archiveReceivedForecast(verification,result.data,'forecast-v6-current-astronomy');}catch{/* Accuracy storage cannot break the forecast. */}
      return ForecastResponseSchema.parse({status:'success', ...result});
    } catch (error) {
      const result = failure(error);
      if (result.retry !== undefined) reply.header('Retry-After', result.retry);
      return reply.code(result.http).send({ status: 'error', code: result.code, message: result.message });
    }
  });
  return app;
}
