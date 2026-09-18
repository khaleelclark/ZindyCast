// Isolated browser fixtures only. Every network origin is intercepted; no live provider calls.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { deflateSync } from 'node:zlib';
const out = resolve(process.env.BASEMAP_EVIDENCE_DIR || 'docs/verification/mapbox-fallback');
const root = process.env.BASEMAP_DIST;
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
async function setup({noKey=false,standard=false,width=1440}={}) {
 const c=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
 await c.addInitScript(({standard})=>{localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[],selected:{id:'fixture-florida',name:'Deltona',country:'US',admin1:'Florida',latitude:28.858,longitude:-81.17,timezone:'America/New_York'}}));if(standard)localStorage.setItem('zindycast.basemap.standard.v1','true');}, {standard});
 const calls={mapbox:[],osm:0,weather:[],future:0,errors:[]};let mode='ok',image=base1024;
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
  if(u.pathname==='/api/v1/maps/mapbox/admission')return r.fulfill({json:{allowed:true,used:1,limit:190000}});
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
 return {c,p,calls,start,setMode:v=>mode=v,setImage:v=>image=v===512?base512:base1024};
}
async function snapshot(p) { return p.evaluate(()=>{window.auditCanvas??=document.querySelector('.maplibregl-canvas');const marker=document.querySelector('.maplibregl-marker');return {sameCanvas:window.auditCanvas===document.querySelector('.maplibregl-canvas'),marker:marker?.style.transform,ready:document.querySelector('.interactive-map')?.getAttribute('data-weather-ready')};});}
try {
 for(const noKey of [true,false]){
  const a=await setup({noKey,standard:!noKey});await a.start();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard');expect(a.calls.mapbox).toHaveLength(0);expect(a.calls.osm).toBeGreaterThan(0);results.push({case:noKey?'no token':'remembered standard',mapboxRequests:0,weatherReady:true});await a.c.close();
 }
 const a=await setup();await a.start();const {p,calls}=a;
 await expect(p.locator('.interactive-map')).toHaveAttribute('data-basemap','mapbox');expect(calls.mapbox.length).toBeGreaterThan(0);expect(calls.mapbox.every(v=>/^\/styles\/v1\/mapbox\/streets-v12\/tiles\/512\/\d+\/\d+\/\d+@2x$/.test(v.path))).toBe(true);
 await expect(p.getByRole('img',{name:'Mapbox',exact:true})).toBeVisible();
 const before=await snapshot(p),weatherCount=calls.weather.length;
 await p.getByText('Map info/settings',{exact:true}).click();await p.getByRole('button',{name:'Use standard map',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard');await p.waitForTimeout(400);expect(await snapshot(p)).toEqual(before);expect(calls.weather.length).toBe(weatherCount);
 a.setImage(512);await p.getByRole('button',{name:'Use Mapbox',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-basemap','mapbox');await p.waitForTimeout(600);expect(await snapshot(p)).toEqual(before);
 await p.getByRole('button',{name:'Future radar',exact:true}).click();await expect(p.getByRole('slider',{name:'Future forecast time'})).toBeVisible();await expect(p.getByText('Loading selected forecast tiles… Previous imagery may remain until ready.',{exact:true})).not.toBeVisible();await expect.poll(()=>calls.future).toBeGreaterThan(0);await p.waitForTimeout(1200);
 const futureCount=calls.future,futureTime=await p.getByRole('slider',{name:'Future forecast time'}).inputValue();
 await p.getByRole('button',{name:'Use standard map',exact:true}).click();await p.waitForTimeout(400);await p.getByRole('button',{name:'Use Mapbox',exact:true}).click();await p.waitForTimeout(600);expect(calls.future).toBe(futureCount);expect(await p.getByRole('slider',{name:'Future forecast time'}).inputValue()).toBe(futureTime);expect((await snapshot(p)).sameCanvas).toBe(true);
 // Failure after forecast is already rendered must retain its selected imagery and canvas.
 await p.getByRole('button',{name:'Use standard map',exact:true}).click();a.setMode('429');const beforeFailure=await snapshot(p);await p.getByRole('button',{name:'Use Mapbox',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard');await expect(p.getByRole('button',{name:'Try Mapbox',exact:true})).toBeVisible();await p.waitForTimeout(400);expect(await snapshot(p)).toEqual(beforeFailure);expect(calls.future).toBe(futureCount);a.setMode('ok');await p.getByRole('button',{name:'Try Mapbox',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-basemap','mapbox');await p.waitForTimeout(600);
 await p.getByRole('button',{name:'Satellite',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
 await p.getByText('Map info/settings',{exact:true}).click();await p.locator('.maps-panel').screenshot({path:out+'/desktop.png'});await p.setViewportSize({width:390,height:844});await p.waitForTimeout(900);await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.locator('.maps-panel').screenshot({path:out+'/mobile.png'});expect(calls.errors).toEqual([]);
 results.push({case:'manual switch 1024 and 512 fixture PNGs',sameCanvas:true,sameMarkerTransform:true,observedNoExtraGET:true,forecastNoExtraGET:true,forecastTimePreserved:true,forecastFailurePreserved:true,logoVisible:true,noMobileOverflow:true,errors:calls.errors});await a.c.close();
 for(const mode of ['401','403','429','500','timeout']) {
  const a=await setup();a.setMode(mode);const start=Date.now();await a.start();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard',{timeout:18000});await expect(a.p.getByRole('button',{name:'Try Mapbox',exact:true})).toBeVisible();
  const elapsed=Date.now()-start,count=a.calls.mapbox.length;const snap=await snapshot(a.p);await a.p.waitForTimeout(700);expect(a.calls.mapbox.length).toBe(count);expect(snap.ready).toBe('true');expect(await a.p.locator('body').innerText()).not.toContain('pk.fixture');
  await a.p.getByRole('tab',{name:'Settings',exact:true}).click();await a.p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');expect(a.calls.mapbox.length).toBe(count);
  a.setMode('ok');await a.p.getByRole('button',{name:'Try Mapbox',exact:true}).click();await expect(a.p.locator('.interactive-map')).toHaveAttribute('data-basemap','mapbox');await a.p.waitForTimeout(800);expect(a.calls.mapbox.length).toBeGreaterThan(count);expect(a.calls.errors).toEqual([]);
  results.push({case:mode,elapsedMs:elapsed,failedRequestCount:count,stickyAcrossRemount:true,explicitRecovery:true,weatherReady:true,errors:a.calls.errors});await a.c.close();
 }
 // A previously complete source can stall after a genuine zoom: timeout must re-arm.
 const moved=await setup();await moved.start();moved.setMode('timeout');const initialCalls=moved.calls.mapbox.length;await moved.p.getByRole('button',{name:'Zoom in',exact:true}).click();await expect.poll(()=>moved.calls.mapbox.length).toBeGreaterThan(initialCalls);await expect(moved.p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');await moved.p.waitForTimeout(900);const zoomed=await snapshot(moved.p);await expect(moved.p.locator('.interactive-map')).toHaveAttribute('data-basemap','standard',{timeout:18000});expect(await snapshot(moved.p)).toEqual(zoomed);expect(moved.calls.errors).toEqual([]);results.push({case:'timeout after successful load and zoom',cameraAndWeatherPreserved:true,errors:moved.calls.errors});await moved.c.close();
 await writeFile(out+'/results.json',JSON.stringify({passed:true,results,limitations:'Synthetic basemap grids (512/1024 PNG), retained observed imagery with adapted request metadata, synthetic forecast catalog and retained PNG. No actual Mapbox style/token entitlement or physical device acceptance; zero live provider calls.'},null,2));
} catch(error) {await writeFile(out+'/results.json',JSON.stringify({passed:false,results,error:error.stack},null,2));throw error;} finally {await browser.close();}
