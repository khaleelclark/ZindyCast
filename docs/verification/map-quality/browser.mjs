// Manual audit: LIVE_MAP_QUALITY=1 permits at most one catalog + two frame API GETs,
// all within 90s. Other runs replay the exact retained responses (never live UI).
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const out=resolve('docs/verification/map-quality');
const dist=process.env.MAP_QUALITY_DIST || '/tmp/zindycast-map-quality-before';
const live=process.env.LIVE_MAP_QUALITY==='1';
const retained=live?{}:JSON.parse(await readFile(out+'/responses.json','utf8'));
const fixtureNow=Date.now();const run=new Date(Math.floor(fixtureNow/3600000)*3600000).toISOString();
const frames=[60,75].map(lead=>({id:'hrrr-'+run.replace(/[-:TZ.]/g,'').slice(0,12)+'-f'+String(lead).padStart(4,'0'),modelRunTime:run,forecastLeadMinutes:lead,validTime:new Date(Date.parse(run)+lead*60000).toISOString()}));
const futureCatalog={status:'success',freshness:'fresh',data:{provider:'Iowa Environmental Mesonet',sourceModel:'NOAA/NCEP HRRR',version:'iem-hrrr-refd-v1',productId:'forecast-hrrr-conus',classification:'modeled',temporalKind:'forecast',quantity:'simulated_reflectivity_1000m_agl',units:'dBZ',region:'CONUS',coverageState:'unknown',retrievedAt:new Date(fixtureNow).toISOString(),evaluatedAt:new Date(fixtureNow).toISOString(),modelRunTime:run,horizonEnd:new Date(Date.parse(run)+18*3600000).toISOString(),frames,defaultFrameId:frames[0].id,sourceUrl:'https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json',attribution:'NOAA/NCEP HRRR; Iowa Environmental Mesonet',legend:{kind:'illustrative',explanation:'Simulated reflectivity; quantitative palette not independently verified. Blank pixels do not establish no precipitation or model coverage.'},sourceTimeStatus:'pinned_model_run_requested',actualSourceTime:null}};
const fixturePng=await readFile('docs/verification/map-imagery-diagnosis/forecast-z9.png');let futureTiles=0;
const calls=[],errors=[];let count=0,start=Date.now();
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
await context.addInitScript(()=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[],selected:{id:'quality-florida',name:'Deltona',country:'US',admin1:'Florida',latitude:28.858,longitude:-81.17,timezone:'America/New_York'}})));
await context.route('http://127.0.0.1:4311/**',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname==='/api/v1/maps'||u.pathname==='/api/v1/maps/frame'){
  const key=u.pathname==='/api/v1/maps'?'catalog':u.searchParams.get('product');
  calls.push({url:u.pathname+u.search,at:new Date().toISOString(),replay:!!retained[key]});
  if(!retained[key]){
   if(!live||count>=3||Date.now()-start>90000)return route.fulfill({status:503,json:{status:'error',code:'provider_error',message:'Manual live audit budget exhausted'}});
   count++;const r=await fetch(u);const data=await r.json();retained[key]={status:r.status,body:data,url:u.href};
  }
  return route.fulfill({status:retained[key].status,json:retained[key].body});
 }
 if(!live&&u.pathname==='/api/v1/maps/forecast/catalog')return route.fulfill({json:futureCatalog});
 if(!live&&u.pathname.startsWith('/api/v1/maps/forecast/tiles/')){futureTiles++;const f=frames.find(f=>u.pathname.includes(f.id));return route.fulfill({body:fixturePng,headers:{'Content-Type':'image/png','X-Forecast-Product':'forecast-hrrr-conus','X-Forecast-Frame':f.id,'X-Forecast-Model-Run':f.modelRunTime,'X-Forecast-Valid-Time':f.validTime,'X-Forecast-Source-Time-Status':'pinned_model_run_requested'}});}
 if(u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{status:'error',code:'provider_error',message:'Other APIs intentionally unavailable in satellite audit'}});
 try{const p=resolve(dist,'.'+(u.pathname==='/'?'/index.html':u.pathname));return route.fulfill({body:await readFile(p),contentType:({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html'})[extname(p)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
});
const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
try{
 await p.goto('http://127.0.0.1:4311');await p.getByRole('tab',{name:'Maps',exact:true}).click();
 await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true',{timeout:30000});
 await p.evaluate(()=>window.firstCanvas=document.querySelector('.maplibregl-canvas'));
 await p.getByRole('button',{name:'Satellite',exact:true}).click();
 await expect(p.getByRole('button',{name:'Satellite',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(p.locator('.map-loading')).not.toBeVisible({timeout:30000});
 await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
 await p.waitForTimeout(900);await p.locator('.maps-panel').screenshot({path:out+(live?'/satellite-before.png':'/satellite-after.png')});
 await p.getByText('Map info/settings',{exact:true}).click();const opacity=p.getByRole('slider',{name:/Weather opacity/});
 const defaultOpacity=await opacity.inputValue();await opacity.fill('0.45');await p.waitForTimeout(300);
 await p.getByText('Map info/settings',{exact:true}).click();await p.locator('.maps-panel').screenshot({path:out+(live?'/satellite-45.png':'/satellite-after-45.png')});
 await p.getByRole('button',{name:'Future radar',exact:true}).click();await p.waitForTimeout(300);
 if(!live){await expect(p.getByRole('slider',{name:'Future forecast time'})).toBeVisible();await expect(p.getByText('Loading selected forecast tiles… Previous imagery may remain until ready.',{exact:true})).not.toBeVisible();expect(futureTiles).toBeGreaterThan(0);await p.waitForTimeout(500);await p.locator('.maps-panel').screenshot({path:out+'/future-fixture.png'});}
 await p.getByRole('button',{name:'Satellite',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
 expect(await p.evaluate(()=>window.firstCanvas===document.querySelector('.maplibregl-canvas'))).toBe(true);
 await p.getByRole('button',{name:'Radar',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
 await p.getByText('Map info/settings',{exact:true}).click();const radarOpacity=await opacity.inputValue();await opacity.fill('0.75');
 await p.getByRole('button',{name:'Satellite',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');const restoredSatelliteOpacity=await opacity.inputValue();
 await p.getByRole('button',{name:'Radar',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');const restoredRadarOpacity=await opacity.inputValue();
 if(!live){expect(defaultOpacity).toBe('0.45');expect(radarOpacity).toBe('0.65');expect(restoredSatelliteOpacity).toBe('0.45');expect(restoredRadarOpacity).toBe('0.75');}
 const stats=await p.evaluate(async base64=>{const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let opaque=0,min=255,max=0,gray=0;const colors=new Set();for(let i=0;i<d.length;i+=4){if(d[i+3]===255)opaque++;if(d[i]===d[i+1]&&d[i]===d[i+2])gray++;min=Math.min(min,d[i]);max=Math.max(max,d[i]);colors.add(d.slice(i,i+4).join(','));}return {width:c.width,height:c.height,opaque,gray,min,max,colors:colors.size};},retained['satellite-goes-infrared'].body.data.imageBase64);
 expect(errors).toEqual([]);
 await writeFile(out+(live?'/live-results.json':'/replay-results.json'),JSON.stringify({live,apiGetCount:count,maximumNewNoaaRequests:count?4:0,calls,errors,defaultOpacity,radarOpacity,restoredSatelliteOpacity,restoredRadarOpacity,stats,futureTiles,clock:await p.locator('.map-clock').innerText(),sameCanvas:true,limitations:'Live run: forecast and other weather APIs unavailable. Replay run: forecast catalog synthetic + retained tile, only lifecycle evidence. OSM visible tiles allowed. Replays use exact retained API metadata; no provider/geographic accuracy assertion.'},null,2));
}finally{if(live)await writeFile(out+'/responses.json',JSON.stringify(retained,null,2));await browser.close();}
