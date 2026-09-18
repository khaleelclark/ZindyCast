// All origins intercepted. Retained imagery + synthetic advertised catalog for lifecycle checks.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { deflateSync } from 'node:zlib';
const out = resolve('docs/verification/libre-play');
const root = process.env.LIBRE_RADAR_DIST; if (!root) throw Error('Set isolated LIBRE_RADAR_DIST');
const noaaCatalog = JSON.parse(await readFile('docs/verification/map-fix/catalog.json'));
const noaaFrame = JSON.parse(await readFile('docs/verification/map-fix/frame.json'));
const tile = await readFile('docs/verification/librewxr-trial/libre-observed.png');
const nowcastTile = await readFile('docs/verification/librewxr-trial/chrome-nowcast.bin');
const now=Date.now(),generated=Math.floor(now/1000)-60;
const catalog={status:'success',generated,retrievedAt:new Date(now).toISOString(),past:Array.from({length:12},(_,i)=>generated-6600+i*600),nowcast:Array.from({length:12},(_,i)=>generated+300+i*300)};
function crc32(b) {let crc = 0xffffffff; for (const byte of b) {crc ^= byte; for(let j=0;j<8;j++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);} return (crc^0xffffffff)>>>0;}
function png(size) {
 const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc((size*3+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*(size*3+1)+1+x*3;const line=x%100<3||y%100<3;raw[i]=line?140:227;raw[i+1]=line?157:236;raw[i+2]=line?170:221;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const base512=png(512),base1024=png(1024),osm=png(256);

const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const results=[];
async function setup({mode='ok',mobile=false}={}) {
 const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
 const calls={catalog:0,tiles:[],noaa:0,forecast:0,mapbox:0,external:[],errors:[]};let current=mode;
 await c.addInitScript(()=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[],selected:{id:'fixture-florida',name:'Deltona',country:'US',admin1:'Florida',latitude:28.858,longitude:-81.17,timezone:'America/New_York'}})));
 await c.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.hostname==='tile.openstreetmap.org')return r.fulfill({body:osm,contentType:'image/png'});
  if(u.hostname!=='127.0.0.1'){calls.external.push(u.origin);return r.abort();}
  if(u.pathname.includes('mapbox')){calls.mapbox++;return r.abort();}
  if(u.pathname==='/api/v1/maps/libre/catalog'){
   calls.catalog++;if(current==='catalog503')return r.fulfill({status:503,json:{status:'error'}});
   if(current==='null')return r.fulfill({json:{...catalog,past:[null],nowcast:[null]}});
   if(current==='stale')return r.fulfill({json:{...catalog,generated:generated-1800}});
   if(current==='expired')return r.fulfill({json:{...catalog,past:[],nowcast:[generated]}});
   return r.fulfill({json:catalog});
  }
  if(u.pathname.startsWith('/api/v1/maps/libre/tiles/')){
   calls.tiles.push(u.pathname);const time=Number(u.pathname.split('/')[6]);
   if(current==='timeout')return;
   if(['429','502'].includes(current))return r.fulfill({status:Number(current),headers:{'Retry-After':'60'},body:''});
   return r.fulfill({body:current==='badpng'?Buffer.from('bad'):time>generated?nowcastTile:tile,headers:{'Content-Type':'image/png','X-Libre-Frame':String(current==='mismatch'?1:time)}});
  }
  if(u.pathname==='/api/v1/maps')return r.fulfill({json:noaaCatalog});
  if(u.pathname==='/api/v1/maps/frame'){calls.noaa++;const f=structuredClone(noaaFrame);Object.assign(f.data,{projection:'EPSG:3857',productId:u.searchParams.get('product'),requestedTime:u.searchParams.get('time')});return r.fulfill({json:f});}
  if(u.pathname.includes('/maps/forecast/'))calls.forecast++;
  if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,json:{status:'error',code:'provider_error',message:'Unavailable in fixture audit'}});
  try{return r.fulfill({body:await readFile(resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname))),contentType:({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html'})[extname(u.pathname)]|| (u.pathname==='/'?'text/html':'application/octet-stream')});}catch{return r.fulfill({status:404,body:''});}
 });
 const p=await c.newPage();p.setDefaultTimeout(18000);p.on('pageerror',e=>calls.errors.push(e.message));
 await p.clock.install({time:now}); await p.goto('http://127.0.0.1:4399');await p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.waitForTimeout(500);
 await p.evaluate(()=>{window.auditCanvas=document.querySelector('.maplibregl-canvas');window.auditMarker=document.querySelector('.maplibregl-marker')?.style.transform;});
 await p.getByText('Map info/settings',{exact:true}).click();
 return {c,p,calls,mode:m=>current=m,choose:async()=>p.getByLabel('Radar source',{exact:true}).selectOption('libre')};
}
async function preserved(p){return p.evaluate(()=>({canvas:window.auditCanvas===document.querySelector('.maplibregl-canvas'),camera:window.auditMarker===document.querySelector('.maplibregl-marker')?.style.transform}));}
try {
 const a=await setup();await a.choose();await expect(a.p.getByText('Selected frame loaded.',{exact:true})).toBeVisible();await a.p.getByRole('button',{name:'Play LibreWXR'}).click();
 await a.p.clock.fastForward(21*60*1000);
 await expect(a.p.getByRole('status').filter({hasText:'No fresh advertised frames'})).toBeVisible();await expect(a.p.getByRole('button',{name:'Play LibreWXR'})).toBeDisabled();
 await expect(a.p.getByRole('slider',{name:'LibreWXR frames'}).locator('..')).not.toContainText('Showing');const count=a.calls.tiles.length;await a.p.clock.fastForward(60000);expect(a.calls.tiles.length).toBe(count);await writeFile(out+'/expiry.json',JSON.stringify({passed:true,activeExpiryStops:true,noAutomaticRetry:true}));await a.c.close();
}finally{await browser.close();}
