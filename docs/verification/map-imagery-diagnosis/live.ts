// Manual diagnostic only. Exactly two live GETs; retained images must never be used as live UI data.
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseMapCatalog,buildMapRequest} from '../../../packages/maps/src/index.ts';
const dir='docs/verification/map-imagery-diagnosis/';
const evidence:any[]=[];
async function get(url:string,name:string,cap:number){
 const start=Date.now();const r=await fetch(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});
 const reader=r.body!.getReader(); const chunks:Uint8Array[]=[];let total=0;
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>cap){await reader.cancel();throw Error('oversize');}chunks.push(value);}
 const b=Buffer.concat(chunks); const e={url,status:r.status,headers:Object.fromEntries(r.headers),retrievedAt:new Date().toISOString(),elapsedMs:Date.now()-start,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};evidence.push(e);writeFileSync(dir+'live.json',JSON.stringify(evidence,null,2));writeFileSync(dir+name,b);if(!r.ok)throw Error('HTTP');return b;
}
const xml=await get('https://nowcoast.noaa.gov/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities','capabilities.xml',2097152);
const catalog=parseMapCatalog(xml.toString(),new Date().toISOString());
writeFileSync(dir+'catalog.json',JSON.stringify(catalog,null,2));
const product=catalog.products.find(p=>p.id==='satellite-goes-infrared')!;
const time=product.times.at(-1)!;
const bbox=[-82.17,28.2,-80.17,29.51] as const;
await get(buildMapRequest(product.id,bbox,800,600,time,catalog,'EPSG:3857').href,'florida-satellite.png',8388608);
console.log(JSON.stringify(evidence,null,2));
