// Manual single GET of a retained, explicit historical run; not live forecast acceptance.
import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const z=9,lat=28.858,lon=-81.170;
const x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
const url=`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0180-202609111400/${z}/${x}/${y}.png`;
const r=await fetch(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});const reader=r.body.getReader();let n=0;const chunks=[];while(true){const{done,value}=await reader.read();if(done)break;n+=value.length;if(n>1048576){await reader.cancel();throw Error('oversize')}chunks.push(value)}const b=Buffer.concat(chunks);const e={url,status:r.status,headers:Object.fromEntries(r.headers),retrievedAt:new Date().toISOString(),bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),historicalRun:true};writeFileSync('docs/verification/map-imagery-diagnosis/forecast-z9.json',JSON.stringify(e,null,2));writeFileSync('docs/verification/map-imagery-diagnosis/forecast-z9.png',b);console.log(e);
