// Bounded real Mapbox validation. Weather APIs replay retained fixtures; no live NOAA/IEM.
import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const origin = process.env.ZINDYCAST_TEST_ORIGIN;
if (!origin) throw new Error('Set ZINDYCAST_TEST_ORIGIN to the authorized test origin before running this live audit.');
const catalog=JSON.parse(await readFile('docs/verification/map-fix/catalog.json','utf8'));
const frame=JSON.parse(await readFile('docs/verification/map-fix/frame.json','utf8'));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1100,height:900},serviceWorkers:'block'});
await context.addInitScript(()=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[],selected:{id:'audit-deltona',name:'Deltona',latitude:28.858,longitude:-81.17,timezone:'America/New_York',country:'US',admin1:'Florida'}})));
let starts=0,osm=0,simulateFailure=false;const responses=[],errors=[];
await context.route('**/*',async r=>{
 const u=new URL(r.request().url());
 if(u.hostname==='api.mapbox.com'){
  if(simulateFailure)return r.fulfill({status:503,body:'Simulated Mapbox outage',headers:{'access-control-allow-origin':'*'}});
  if(++starts>16)return r.abort();
  return r.continue();
 }
 if(u.hostname==='tile.openstreetmap.org'){if(++osm>12)return r.abort();return r.continue();}
 if(u.origin!==origin)return r.abort();
 if(u.pathname==='/api/v1/maps')return r.fulfill({json:catalog});
 if(u.pathname==='/api/v1/maps/frame'){
  const f=structuredClone(frame);Object.assign(f.data,{projection:'EPSG:3857',productId:u.searchParams.get('product'),requestedTime:u.searchParams.get('time')});return r.fulfill({json:f});
 }
 if(u.pathname.startsWith('/api/') && u.pathname!='/api/v1/health')return r.fulfill({status:503,json:{status:'error',message:'Weather unavailable in basemap audit fixture'}});
 return r.continue();
});
const p=await context.newPage();p.on('pageerror',()=>errors.push('Uncaught page error'));
p.on('response',r=>{const u=new URL(r.url());if(u.hostname==='api.mapbox.com'&&!simulateFailure)responses.push({path:u.pathname,status:r.status()});});
try{
 await p.goto(origin,{waitUntil:'domcontentloaded'});
 await p.getByRole('tab',{name:'Maps',exact:true}).click();
 await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
 await expect.poll(()=>responses.filter(r=>r.status===200).length).toBeGreaterThan(0);
 await p.locator('.interactive-map').scrollIntoViewIfNeeded();
 await p.waitForTimeout(3500);
 await p.getByText('Map info/settings',{exact:true}).click();
 await expect(p.getByRole('button',{name:'Use standard map',exact:true})).toBeVisible();
 await expect(p.getByText('Mapbox unavailable — using standard map.',{exact:false})).not.toBeVisible();
 console.log(await p.evaluate(()=>({canvas:{w:document.querySelector('canvas').width,h:document.querySelector('canvas').height,css:document.querySelector('canvas').getBoundingClientRect().toJSON()},map:document.querySelector('.interactive-map').getBoundingClientRect().toJSON()})));
 await p.evaluate(()=>{window.auditCanvas=document.querySelector('.maplibregl-canvas');window.auditMarker=document.querySelector('.maplibregl-marker')?.style.transform;});
 await p.locator('.map-panel').count();
 await p.locator('.interactive-map').screenshot({path:'docs/verification/mapbox-live/mapbox.png'});
 await p.getByRole('button',{name:'Use standard map',exact:true}).click();
 await expect(p.getByRole('button',{name:'Use Mapbox',exact:true})).toBeVisible();
 await p.waitForTimeout(1800);
 simulateFailure=true;
 await p.getByRole('button',{name:'Use Mapbox',exact:true}).click();
 await expect(p.getByText('Mapbox unavailable — using standard map.',{exact:false})).toBeVisible();
 expect(await p.evaluate(()=>window.auditCanvas===document.querySelector('.maplibregl-canvas'))).toBe(true);
 expect(await p.evaluate(()=>window.auditMarker===document.querySelector('.maplibregl-marker')?.style.transform)).toBe(true);
 await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
 expect(errors).toEqual([]);
 await writeFile('docs/verification/mapbox-live/results.json',JSON.stringify({passed:true,mapboxRequests:starts,osmRequests:osm,responses,errors,sameCanvas:true,sameCameraMarker:true,fallback:'simulated 503 after successful live Mapbox',weather:'retained fixtures only',limitations:'Live Mapbox basemap at 1100x900; no live weather or physical-device validation.'},null,2));
 console.log('PASS: live Mapbox rendered and simulated outage fell back; requests='+starts);
} finally {console.log(JSON.stringify({starts,responses,errors}));await browser.close();}
