// Isolated browser fixtures only. Every network origin is intercepted; no live provider calls.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { deflateSync } from 'node:zlib';
const out = resolve('docs/verification/mapbox-quota');
const root = process.env.BASEMAP_QUOTA_DIST;
const noKeyRoot = process.env.BASEMAP_NO_KEY_DIST;
if (!root || !noKeyRoot) throw Error('Both isolated BASEMAP_DIST and BASEMAP_NO_KEY_DIST are required.');
const catalog = JSON.parse(await readFile('docs/verification/map-fix/catalog.json'));
const frame = JSON.parse(await readFile('docs/verification/map-fix/frame.json'));
const tile = await readFile('docs/verification/map-imagery-diagnosis/forecast-z9.png');
const now = Date.now(), run = new Date(Math.floor(now / 3600000) * 3600000).toISOString();
const frames = [60,75].map(lead => ({ id: 'hrrr-' + run.replace(/[-:TZ.]/g,'').slice(0,12) + '-f' + String(lead).padStart(4,'0'), modelRunTime:run, forecastLeadMinutes:lead, validTime:new Date(Date.parse(run)+lead*60000).toISOString() }));
const future = {status:'success',freshness:'fresh',data:{provider:'Iowa Environmental Mesonet',sourceModel:'NOAA/NCEP HRRR',version:'iem-hrrr-refd-v1',productId:'forecast-hrrr-conus',classification:'modeled',temporalKind:'forecast',quantity:'simulated_reflectivity_1000m_agl',units:'dBZ',region:'CONUS',coverageState:'unknown',retrievedAt:new Date(now).toISOString(),evaluatedAt:new Date(now).toISOString(),modelRunTime:run,horizonEnd:new Date(Date.parse(run)+18*3600000).toISOString(),frames,defaultFrameId:frames[0].id,sourceUrl:'https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json',attribution:'NOAA/NCEP HRRR; Iowa Environmental Mesonet',legend:{kind:'illustrative',explanation:'Simulated reflectivity; quantitative palette not independently verified. Blank pixels do not establish no precipitation or model coverage.'},sourceTimeStatus:'pinned_model_run_requested',actualSourceTime:null}};
function crc32(b) {let crc = 0xffffffff; for (const byte of b) {crc ^= byte; for(let j=0;j<8;j++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);} return (crc^0xffffffff)>>>0;}
function png(size) {
 const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc((size*3+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*(size*3+1)+1+x*3;const line=x%100<3||y%100<3;raw[i]=line?140:227;raw[i+1]=line?157:236;raw[i+2]=line?170:221;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const base512=png(512),base1024=png(1024),osm=png(256);
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const results = [];
async function setup({noKey=false,standard=false,width=1440,admission='ok',counter={used:0,ceiling:190000}}={}) {
 const c=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
 await c.addInitScript(({standard})=>{localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[],selected:{id:'fixture-florida',name:'Deltona',country:'US',admin1:'Florida',latitude:28.858,longitude:-81.17,timezone:'America/New_York'}}));if(standard)localStorage.setItem('zindycast.basemap.standard.v1','true');}, {standard});
 const calls={mapbox:[],admissions:[],osm:0,weather:[],future:0,errors:[]};let mode='ok',image=base1024;
 await c.route('**/*',async r=>{
  const u=new URL(r.request().url());
  if(u.hostname==='api.mapbox.com'){
   calls.mapbox.push({path:u.pathname,status:mode,at:Date.now()});
   if(mode==='timeout')return; // held until cancellation; real 12s browser timer is exercised
   if(mode!=='ok')return r.fulfill({status:Number(mode),body:'Fixture basemap failure',headers:{'access-control-allow-origin':'*'}});
   return r.fulfill({body:image,contentType:'image/png',headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  }
  if(u.hostname==='tile.openstreetmap.org'){calls.osm++;return r.fulfill({body:osm,contentType:'image/png'});}
  if(u.hostname!=='127.0.0.1')return r.abort();
  if(u.pathname==='/api/v1/maps/mapbox/admission') {
   expect(r.request().method()).toBe('POST');expect(r.request().postData()).toBe(null);
   calls.admissions.push({at:Date.now(),mode:admission});
   if(admission==='timeout')return;
   if(admission==='unavailable')return r.fulfill({status:503,json:{allowed:false,reason:'unavailable',limit:190000}});
   if(admission==='malformed')return r.fulfill({json:{allowed:true,used:0,limit:190000}});
   if(admission==='broken')return r.fulfill({body:'not json',contentType:'application/json'});
   if(admission==='limit'||counter.used>=counter.ceiling)return r.fulfill({status:429,json:{allowed:false,reason:'limit',limit:190000}});
   if(admission==='delayed')await new Promise(resolve=>setTimeout(resolve,1200));
   counter.used++;return r.fulfill({json:{allowed:true,used:counter.used,limit:190000}});
  }
  if(u.pathname==='/api/v1/maps')return r.fulfill({json:catalog});
  if(u.pathname==='/api/v1/maps/frame'){calls.weather.push(u.search);const f=structuredClone(frame);Object.assign(f.data,{projection:'EPSG:3857',productId:u.searchParams.get('product'),requestedTime:u.searchParams.get('time')});return r.fulfill({json:f});}
  if(u.pathname==='/api/v1/maps/forecast/catalog')return r.fulfill({json:future});
  if(u.pathname.startsWith('/api/v1/maps/forecast/tiles/')){calls.future++;const f=frames.find(f=>u.pathname.includes(f.id));return r.fulfill({body:tile,headers:{'Content-Type':'image/png','X-Forecast-Product':'forecast-hrrr-conus','X-Forecast-Frame':f.id,'X-Forecast-Model-Run':f.modelRunTime,'X-Forecast-Valid-Time':f.validTime,'X-Forecast-Source-Time-Status':'pinned_model_run_requested'}});}
  if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,json:{status:'error',code:'provider_error',message:'Other APIs unavailable in fixture audit'}});
  try{const file=resolve(noKey?noKeyRoot:root,'.'+(u.pathname==='/'?'/index.html':u.pathname));return r.fulfill({body:await readFile(file),contentType:({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream'});}catch{return r.fulfill({status:404,body:''});}
 });
 const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>calls.errors.push(e.message));
 // Capture camera/source identity through MapLibre's container DOM linkage is not public;
 // use marker screen position + identical canvas + unchanged weather GETs as black-box evidence.
 const start=async()=>{await p.goto('http://127.0.0.1:4399');await p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await p.waitForTimeout(600);};
 return {c,p,calls,start,setAdmission:v=>admission=v,setMode:v=>mode=v,setImage:v=>image=v===512?base512:base1024};
}
async function snapshot(p) { return p.evaluate(()=>{window.auditCanvas??=document.querySelector('.maplibregl-canvas');const marker=document.querySelector('.maplibregl-marker');return {sameCanvas:window.auditCanvas===document.querySelector('.maplibregl-canvas'),marker:marker?.style.transform,ready:document.querySelector('.interactive-map')?.getAttribute('data-weather-ready')};});}
try {
 for(const noKey of [true,false]) {
  const a=await setup({noKey,standard:!noKey});await a.start();expect(a.calls.admissions).toHaveLength(0);expect(a.calls.mapbox).toHaveLength(0);results.push({case:noKey?'no key':'standard preference',admissions:0,mapbox:0});await a.c.close();
 }
 for(const admission of ['limit','unavailable','malformed','broken','timeout']) {
  const a=await setup({admission});const start=Date.now();await a.start();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard',{timeout:9000});
  await expect(a.p.getByRole('status').filter({hasText:admission==='limit'?'Mapbox request budget reached — using standard map.':'Mapbox request counting unavailable — using standard map.'})).toBeVisible();
  const elapsed=Date.now()-start;expect(a.calls.mapbox).toHaveLength(0);expect(a.calls.admissions.length).toBeGreaterThan(0);const count=a.calls.admissions.length;
  const before=await snapshot(a.p);await a.p.waitForTimeout(700);expect(a.calls.admissions.length).toBe(count);
  await a.p.getByRole('button',{name:'Try Mapbox',exact:true}).click();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard',{timeout:9000});expect(a.calls.mapbox).toHaveLength(0);expect(await snapshot(a.p)).toEqual(before);
  await a.p.getByRole('tab',{name:'Settings',exact:true}).click();const after=a.calls.admissions.length;await a.p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');expect(a.calls.admissions.length).toBe(after);
  expect(a.calls.errors).toEqual([]);results.push({case:admission,mapbox:0,initialAdmissions:count,elapsedMs:elapsed,sticky:true,retryCannotBypass:true});await a.c.close();
 }
 const cancelled=await setup({standard:true,admission:'delayed'});await cancelled.start();await cancelled.p.getByText('Map info/settings',{exact:true}).click();await cancelled.p.getByRole('button',{name:'Use Mapbox',exact:true}).click();await expect.poll(()=>cancelled.calls.admissions.length).toBeGreaterThan(0);await cancelled.p.getByRole('button',{name:'Use standard map',exact:true}).click();await cancelled.p.waitForTimeout(1600);expect(cancelled.calls.mapbox).toHaveLength(0);await expect(cancelled.p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');results.push({case:'cancel during pending permit',mapbox:0,weatherReady:true});await cancelled.c.close();
 const counter={used:0,ceiling:190000};const a=await setup({counter});await a.start();await a.p.waitForTimeout(1000);expect(a.calls.mapbox.length).toBeGreaterThan(0);expect(a.calls.admissions.length).toBe(a.calls.mapbox.length);
 const initial=a.calls.mapbox.length,before=await snapshot(a.p),weather=a.calls.weather.length;counter.ceiling=counter.used;
 // Independent browser installation shares the fixture server's conservative counter.
 const b=await setup({counter});await b.start();await expect(b.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard',{timeout:9000});expect(b.calls.mapbox).toHaveLength(0);
 await a.p.getByText('Map info/settings',{exact:true}).click();await a.p.getByRole('button',{name:'Use standard map',exact:true}).click();const admitted=a.calls.admissions.length;await a.p.waitForTimeout(400);expect(a.calls.admissions.length).toBe(admitted);await a.p.getByRole('button',{name:'Use Mapbox',exact:true}).click();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard',{timeout:9000});expect(a.calls.mapbox.length).toBe(initial);expect(await snapshot(a.p)).toEqual(before);expect(a.calls.weather.length).toBe(weather);
 await a.p.locator('.maps-panel').screenshot({path:out+'/desktop.png'});await a.p.setViewportSize({width:390,height:844});await a.p.waitForTimeout(800);expect(await a.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await a.p.locator('.maps-panel').screenshot({path:out+'/mobile.png'});
 results.push({case:'shared fixture counter across two installations',successfulPermits:counter.used,actualMapboxFetches:initial,secondClientFetches:0,sameCanvasCameraWeather:true,standardBypassesAdmission:true});expect(a.calls.errors).toEqual([]);expect(b.calls.errors).toEqual([]);await a.c.close();await b.c.close();
 await writeFile(out+'/results.json',JSON.stringify({passed:true,results,limitations:'All network intercepted. Synthetic Mapbox tiles and shared admission fixture; retained weather. No production counter, Mapbox, NOAA, or IEM requests. Server persistence and atomicity remain lead acceptance gates.'},null,2));
} catch(error) {await writeFile(out+'/results.json',JSON.stringify({passed:false,results,error:error.stack},null,2));throw error;} finally {await browser.close();}
