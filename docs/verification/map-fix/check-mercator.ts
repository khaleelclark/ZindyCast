/** Opt-in live verification: exactly one capabilities and one image GET. Never ordinary tests. */
import {writeFile} from 'node:fs/promises';
import {getMapCatalog,fetchMapImage,buildMapRequest,type Bbox} from '../../../packages/maps/src/index.js';
const realFetch=globalThis.fetch;const requests:unknown[]=[];
globalThis.fetch=async(input,init)=>{if(requests.length>=2)throw new Error('Two-request live cap');const entry:{url:string;startedAt:string;status?:number}={url:String(input),startedAt:new Date().toISOString()};requests.push(entry);const response=await realFetch(input,init);entry.status=response.status;return response;};
const catalog=await getMapCatalog();
const bbox:Bbox=[-125,24,-66,50];const time=catalog.products[0]!.times.at(-1)!;
const url=buildMapRequest('radar-conus',bbox,800,500,time,catalog,'EPSG:3857');
// Independent log/tan implementation checks actual request against asinh/tan implementation.
const independent=[6378137*(-125)*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+24*Math.PI/360)),6378137*(-66)*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+50*Math.PI/360))];
url.searchParams.get('bbox')!.split(',').map(Number).forEach((v,i)=>{if(Math.abs(v-independent[i]!)>1e-7)throw new Error('Independent projection mismatch');});
const image=await fetchMapImage('radar-conus',bbox,800,500,time,catalog,undefined,'EPSG:3857');
await writeFile(new URL('mercator.png',import.meta.url),image.bytes);
const {bytes,...metadata}=image;
await writeFile(new URL('mercator-evidence.json',import.meta.url),JSON.stringify({requests,catalog,bbox,independentMeters:independent,metadata,bytes:bytes.length},null,2)+'\n');
console.log(JSON.stringify({requests,metadata,bytes:bytes.length}));
