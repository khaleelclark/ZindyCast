/** IEM documented explicit initialization REFD tiles. See docs/decisions/future-radar.md. */
export const FORECAST_RADAR_METADATA_URL='https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json';
export const FORECAST_RADAR_LIMITS=Object.freeze({timeoutMs:12000,metadataBytes:65536,imageBytes:1048576,maxZoom:7,cacheMs:300000,maxRunAgeMs:14400000,maxFrames:12,horizonMs:10800000});
export type ForecastRadarErrorCode='invalid_request'|'outside_supported_region'|'invalid_metadata'|'model_run_too_old'|'no_future_frames'|'provider_error'|'rate_limited';
export class ForecastRadarError extends Error {
 constructor(public readonly code:ForecastRadarErrorCode,message:string,public readonly retryAfterSeconds?:number){super(message);this.name='ForecastRadarError';}
}
const fail=(code:ForecastRadarErrorCode,message:string):never=>{throw new ForecastRadarError(code,message);};
export interface ForecastRadarMetadata {modelRunTime:string;horizonEnd:string;retrievedAt:string}
function instant(value:unknown):string {
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return fail('invalid_metadata','Invalid UTC timestamp');
 const ms=Date.parse(value);if(!Number.isFinite(ms) || new Date(ms).toISOString().replace('.000Z','Z')!==value.replace('.000Z','Z'))return fail('invalid_metadata','Invalid calendar timestamp');return new Date(ms).toISOString();
}
export function parseForecastRadarMetadata(raw:unknown,retrievedAt:string):ForecastRadarMetadata {
 if(!raw || typeof raw!=='object' || Array.isArray(raw))return fail('invalid_metadata','Invalid model metadata');
 const r=raw as Record<string,unknown>;const modelRunTime=instant(r.model_init_utc),horizonEnd=instant(r.model_forecast_utc),retrieved=instant(retrievedAt),run=Date.parse(modelRunTime);
 if(r.forecast_minute!==1080 || run%3600000!==0 || Date.parse(horizonEnd)!==run+1080*60000 || run>Date.parse(retrieved))return fail('invalid_metadata','Inconsistent model metadata');
 return {modelRunTime,horizonEnd,retrievedAt:retrieved};
}
export function buildForecastRadarCatalog(metadata:ForecastRadarMetadata,now=Date.now()) {
 const m=parseForecastRadarMetadata({model_init_utc:metadata.modelRunTime,model_forecast_utc:metadata.horizonEnd,forecast_minute:1080},metadata.retrievedAt);
 const run=Date.parse(m.modelRunTime);if(!Number.isFinite(now)||now<Date.parse(m.retrievedAt))return fail('invalid_metadata','Invalid evaluation time');
 if(now-run>FORECAST_RADAR_LIMITS.maxRunAgeMs)return fail('model_run_too_old','Model run is more than four hours old');
 const runId=m.modelRunTime.replace(/[-:]/g,'').replace('T','').slice(0,12);
 const frames=[];
 for(let lead=0;lead<=1080 && frames.length<12;lead+=15){const valid=run+lead*60000;if(valid>now && valid<=now+FORECAST_RADAR_LIMITS.horizonMs) frames.push({id:`hrrr-${runId}-f${String(lead).padStart(4,'0')}`,modelRunTime:m.modelRunTime,forecastLeadMinutes:lead,validTime:new Date(valid).toISOString()});}
 if(!frames.length)return fail('no_future_frames','No future frames available');
 return {...m,evaluatedAt:new Date(now).toISOString(),provider:'Iowa Environmental Mesonet' as const,sourceModel:'NOAA/NCEP HRRR' as const,version:'iem-hrrr-refd-v1' as const,productId:'forecast-hrrr-conus' as const,classification:'modeled' as const,temporalKind:'forecast' as const,quantity:'simulated_reflectivity_1000m_agl' as const,units:'dBZ' as const,region:'CONUS' as const,coverageState:'unknown' as const,frames,defaultFrameId:frames[0].id,sourceUrl:FORECAST_RADAR_METADATA_URL,attribution:'NOAA/NCEP HRRR; Iowa Environmental Mesonet' as const,legend:{kind:'illustrative' as const,explanation:'Simulated reflectivity; quantitative palette not independently verified. Blank pixels do not establish no precipitation or model coverage.' as const},sourceTimeStatus:'pinned_model_run_requested' as const,actualSourceTime:null};
}
export function validateForecastRadarTile(frameId:string,z:number,x:number,y:number):void {
 if(!/^hrrr-\d{12}-f\d{4}$/.test(frameId) || !Number.isInteger(z)||z<0||z>7||![x,y].every(v=>Number.isInteger(v)&&v>=0&&v<2**z))fail('invalid_request','Invalid frame or XYZ tile');
 const n=2**z,west=x/n*360-180,east=(x+1)/n*360-180;
 const lat=(v:number)=>Math.atan(Math.sinh(Math.PI*(1-2*v/n)))*180/Math.PI,north=lat(y),south=lat(y+1);
 if(east<=-125||west>=-66||north<=24||south>=50)fail('outside_supported_region','Tile does not intersect the application CONUS rectangle');
}
export function buildForecastRadarTileRequest(frameId:string,z:number,x:number,y:number,metadata:ForecastRadarMetadata,now=Date.now()):URL {
 validateForecastRadarTile(frameId,z,x,y);const c=buildForecastRadarCatalog(metadata,now),f=c.frames.find(f=>f.id===frameId);
 if(!f)return fail('invalid_request','Frame must belong to the current future catalog');
 const run=f.modelRunTime.replace(/[-:]/g,'').replace('T','').slice(0,12);
 return new URL(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${String(f.forecastLeadMinutes).padStart(4,'0')}-${run}/${z}/${x}/${y}.png`);
}
/** Per-process sliding-minute guard, in addition to route's persistent shared NOAA quota. */
export class ForecastRadarGate {
 private starts:number[]=[];private active=0;private cooldownUntil=0;
 constructor(private readonly now=()=>Date.now()){}
 enter():()=>void {
  const now=this.now();this.starts=this.starts.filter(t=>t>now-60000);
  if(now<this.cooldownUntil || this.active>=2 || this.starts.length>=30)throw new ForecastRadarError('rate_limited','Forecast imagery budget is busy',Math.max(1,Math.ceil((Math.max(this.cooldownUntil,this.starts.length>=30?this.starts[0]+60000:now+1000)-now)/1000)));
  this.starts.push(now);this.active++;let done=false;return ()=>{if(!done){done=true;this.active--;}};
 }
 cooldown(seconds:number){this.cooldownUntil=Math.max(this.cooldownUntil,this.now()+seconds*1000);}
}
const sharedGate=new ForecastRadarGate();
async function get(url:URL,type:string,limit:number,signal?:AbortSignal,gate=sharedGate){
 signal?.throwIfAborted();const release=gate.enter();
 const combined=AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])]);
 try {
  const response=await fetch(url,{signal:combined,redirect:'error',credentials:'omit',headers:{Accept:type}});
  if(response.status===429){const raw=response.headers.get('retry-after'),v=raw&&/^\d+$/.test(raw)?Number(raw):raw?Math.ceil((Date.parse(raw)-Date.now())/1000):60;const seconds=Number.isFinite(v)?Math.max(1,Math.min(v,86400)):60;gate.cooldown(seconds);await response.body?.cancel();throw new ForecastRadarError('rate_limited','Forecast imagery provider is busy',seconds);}
  const length=response.headers.get('content-length');
  if(!response.ok||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!==type||length!==null&&(!/^\d+$/.test(length)||Number(length)>limit)){await response.body?.cancel();return fail('provider_error','Invalid forecast imagery response');}
  if(!response.body)return fail('provider_error','Empty forecast imagery response');
  const reader=response.body.getReader(),parts:Buffer[]=[];let total=0;
  try{while(true){combined.throwIfAborted();const r=await reader.read();if(r.done)break;total+=r.value.byteLength;if(total>limit)fail('provider_error','Forecast imagery response exceeds byte limit');parts.push(Buffer.from(r.value));}}finally{await reader.cancel();reader.releaseLock();}
  combined.throwIfAborted();return {bytes:Buffer.concat(parts),retrievedAt:new Date().toISOString()};
 }catch(error){if(error instanceof ForecastRadarError)throw error;if(combined.aborted)throw combined.reason;return fail('provider_error','Forecast imagery request failed');}finally{release();}
}
export async function getForecastRadarMetadata(signal?:AbortSignal,gate=sharedGate):Promise<ForecastRadarMetadata>{
 const r=await get(new URL(FORECAST_RADAR_METADATA_URL),'application/json',65536,signal,gate);
 try{return parseForecastRadarMetadata(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.bytes)),r.retrievedAt);}catch(e){if(e instanceof ForecastRadarError)throw e;return fail('invalid_metadata','Invalid model metadata JSON');}
}
export function validateForecastRadarPng(bytes:Buffer):void {
 if(bytes.length<33||bytes.length>1048576||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==256||bytes.readUInt32BE(20)!==256)fail('provider_error','Invalid PNG signature or 256 pixel dimensions');
}
export async function fetchForecastRadarTile(frameId:string,z:number,x:number,y:number,metadata:ForecastRadarMetadata,signal?:AbortSignal,gate=sharedGate){
 const url=buildForecastRadarTileRequest(frameId,z,x,y,metadata);const result=await get(url,'image/png',1048576,signal,gate);validateForecastRadarPng(result.bytes);
 // Time can advance while downloading. Never return an expired frame as future.
 buildForecastRadarTileRequest(frameId,z,x,y,metadata);
 return result;
}
