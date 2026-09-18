import { Buffer } from 'node:buffer';
import { STATION_DISCOVERY_SOURCE, StationDiscoveryQuerySchema, StationDiscoveryDataSchema, stationDistanceKm,
  type StationDiscoveryQuery, type StationDiscoveryData, type StationCandidate } from '@zindycast/contracts';
import { StationError } from './index.js';
export const STATION_DISCOVERY_MAX_BYTES = 20 * 1024 * 1024;
const bad = () => new StationError('provider_error','NOAA returned invalid or oversized station metadata.');
const order = (a:StationCandidate,b:StationCandidate) => a.distanceKm-b.distanceKm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Full catalog scan, retaining at most ten candidates. No inventory or HOMR inference. */
export function parseStationDiscovery(text:string, query:StationDiscoveryQuery, metadataRetrievedAt:string):StationDiscoveryData {
  const q=StationDiscoveryQuerySchema.parse(query);
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length || bytes.length > STATION_DISCOVERY_MAX_BYTES) throw bad();
  // NOAA's fixed columns are byte positions; UTF-8 names can use multiple bytes.
  text = Buffer.from(bytes).toString('latin1');
  const candidates:StationCandidate[]=[]; const seen=new Set<string>();
  let start=0;
  while(start<text.length) {
    const end=text.indexOf('\n',start); let line=text.slice(start,end<0?text.length:end); start=end<0?text.length:end+1;
    if(line.endsWith('\r')) line=line.slice(0,-1);
    if(line.length!==85 || !/^[\x20-\x7e]*$/.test(line.slice(0,41)+line.slice(71)) || /[\x00-\x1f\x7f]/.test(line.slice(41,71)) || !/^[A-Z]{2}[A-Za-z0-9_-]{9}$/.test(line.slice(0,11)) ||
      [11,20,30,37,40,71,75,79].some(i=>line[i]!==' ') ||
      !/^ {0,2}[A-Z]{0,2} *$/.test(line.slice(38,40)) || !['   ','GSN'].includes(line.slice(72,75)) ||
      !['   ','HCN','CRN'].includes(line.slice(76,79)) || !/^(?: {5}|\d{5})$/.test(line.slice(80,85))) throw bad();
    const id=line.slice(0,11); if(seen.has(id)) throw bad(); seen.add(id);
    const decimal=(s:string,digits:number) => { if(!new RegExp(`^ *-?\\d+\\.\\d{${digits}}$`).test(s)) throw bad(); return Number(s); };
    const latitude=decimal(line.slice(12,20),4), longitude=decimal(line.slice(21,30),4), elevation=decimal(line.slice(31,37),1);
    if(!StationDiscoveryQuerySchema.safeParse({latitude,longitude}).success || elevation < -999.9 || elevation>9999.9) throw bad();
    // Only IDs supported by the existing daily-history endpoint are selectable.
    if(!/^US[A-Z0-9]{9}$/.test(id)) continue;
    const coordinates={latitude,longitude}; const distanceKm=stationDistanceKm(q,coordinates);
    if(distanceKm>150) continue;
    candidates.push({id,name:new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(line.slice(41,71),c=>c.charCodeAt(0))).trim()||null,coordinates,elevationM:elevation===-999.9?null:elevation,distanceKm});
    candidates.sort(order); if(candidates.length>10) candidates.pop();
  }
  return StationDiscoveryDataSchema.parse({query:q,candidates,radiusKm:150,limit:10,countryScope:'US',ordering:'distance_then_id',
    metadataRetrievedAt,sourceUrl:STATION_DISCOVERY_SOURCE,provider:'NOAA NCEI',dataset:'GHCN-Daily station metadata',
    adapterVersion:'ghcnd-discovery-v1',sourceUpdatedAt:null,completeness:'not_assessed',timeHistory:'not_assessed',
    eligibility:'not_assessed',proximityMeaning:'not_a_scientific_recommendation'});
}

/** Fixed URL, no redirects/retries/raw cache; callers must reserve NOAA quota before entering. */
export async function getStationDiscovery(query:StationDiscoveryQuery, signal?:AbortSignal):Promise<StationDiscoveryData> {
  const parsed=StationDiscoveryQuerySchema.safeParse(query);
  if(!parsed.success) throw new StationError('invalid_request','Use valid latitude and longitude.');
  signal?.throwIfAborted();
  const controller=new AbortController(); const abort=()=>controller.abort(signal?.reason);
  signal?.addEventListener('abort',abort,{once:true});
  const started=performance.now(); const timer=setTimeout(()=>controller.abort(new DOMException('Metadata deadline','TimeoutError')),12000);
  let rejectAbort:(reason:unknown)=>void=()=>{};
  const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>rejectAbort(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
    const response=await Promise.race([fetch(STATION_DISCOVERY_SOURCE,{signal:controller.signal,redirect:'error',headers:{Accept:'text/plain'}}),aborted]);
    if(response.status!==200) {
      void response.body?.cancel().catch(()=>{});
      const retry=response.headers.get('retry-after');
      const seconds=retry===null?NaN:/^\d+$/.test(retry)?Number(retry):Math.max(0,Math.ceil((Date.parse(retry)-Date.now())/1000));
      throw new StationError(response.status===429?'rate_limited':'provider_error','NOAA station metadata request failed.',response.status,Number.isSafeInteger(seconds)?seconds:undefined);
    }
    if(Number(response.headers.get('content-length'))>STATION_DISCOVERY_MAX_BYTES || response.headers.has('content-range') ||
      !response.headers.get('content-type')?.toLowerCase().startsWith('text/plain')) {void response.body?.cancel().catch(()=>{});throw bad();}
    reader=response.body?.getReader(); if(!reader) throw bad();
    const decoder=new TextDecoder('utf-8',{fatal:true}); let text='',size=0;
    while(true) {
      const {done,value}=await Promise.race([reader.read(),aborted]); controller.signal.throwIfAborted(); if(done) break;
      size+=value.byteLength; if(size>STATION_DISCOVERY_MAX_BYTES) throw bad(); text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    const result=parseStationDiscovery(text,parsed.data,new Date().toISOString());
    controller.signal.throwIfAborted(); if(performance.now()-started>=12000) throw bad(); return result;
  } catch(error) {
    if(signal?.aborted) throw signal.reason;
    if(error instanceof StationError) throw error;
    throw new StationError('provider_error','NOAA station metadata unavailable.');
  } finally {
    if(reader) {void reader.cancel().catch(()=>{});reader.releaseLock();}
    clearTimeout(timer); signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',onAbort);
  }
}
