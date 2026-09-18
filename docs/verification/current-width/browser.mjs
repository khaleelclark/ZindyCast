import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist=process.env.RADAR_CONTROLS_DIST || root+'/apps/web/dist';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'America/Chicago',country:'US',admin1:'Oklahoma'};
const austin={...tulsa,id:'4671654',name:'Austin',latitude:30.267,longitude:-97.743,admin1:'Texas'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
let iconCode=0, daylight=0;
let mode='good', pending=null, requests=[], outside=0;
await context.addInitScript(({tulsa,austin})=>{
 localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',selected:tulsa,saved:[tulsa]}));
 window.auditUrls={created:[],revoked:[]};
 const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=(blob)=>{const url=create(blob);window.auditUrls.created.push(url);return url;};
 URL.revokeObjectURL=(url)=>{window.auditUrls.revoked.push(url);revoke(url);};
},{tulsa,austin});
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin!=='http://127.0.0.1:4311'){outside++;return route.fulfill({status:503,body:'Fixture basemap outage'});}
 if(url.pathname==='/api/v1/alerts')return route.fulfill({json:{status:'success',freshness:'fresh',data:{coordinates:{latitude:tulsa.latitude,longitude:tulsa.longitude},alerts:[],retrievedAt:new Date().toISOString(),attribution:'NWS fixture',provider:'NWS'}}});
 if(url.pathname==='/api/v1/forecast'){const data=structuredClone(forecast);const start=Math.floor(Date.now()/3600000)*3600000;data.provenance.retrievedAt=new Date().toISOString();data.provenance.attribution='BROWSER FIXTURE ONLY';data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();return {...h,time,isDay:daylight,weatherCode:iconCode,wbgt:h.wbgt?.diagnostics?{...h.wbgt,diagnostics:{...h.wbgt.diagnostics,input:{...h.wbgt.diagnostics.input,time}}}:h.wbgt};});data.hours[0].wbgt.valueC=(88-32)*5/9;delete data.hours[2].wbgt;data.location=Object.fromEntries(url.searchParams);data.location.latitude=Number(data.location.latitude);data.location.longitude=Number(data.location.longitude);return route.fulfill({json:{status:'success',freshness:'fresh',data}});}
 if(url.pathname==='/api/v1/maps')return route.fulfill({json:catalog});
 if(url.pathname==='/api/v1/maps/frame'){
  requests.push(Object.fromEntries(url.searchParams));
  const response=structuredClone(frame); response.data.productId=url.searchParams.get('product');response.data.requestedTime=url.searchParams.get('time');response.data.projection='EPSG:3857';
  response.freshness='stale';response.data.extentRelation='partial';
  if(mode==='bad-image')response.data.imageBase64='iVBORw0KGgo=';
  if(mode==='defer'){pending=()=>route.fulfill({json:response}).catch(()=>{});return;}
  if(mode==='failure')return route.fulfill({status:503,json:{status:'error',code:'provider_error',message:'Fixture frame failure'}});
  return route.fulfill({json:response});
 }
 if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{message:'Fixture provider outage'}});
 if(url.search)return route.fulfill({status:503,body:'Release checks disabled in fixture context'});
 try{return route.fulfill({path:dist+(url.pathname==='/'?'/index.html':url.pathname)});}catch{return route.fulfill({status:404,body:'Not in isolated build'});}
});
const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.clock.install();
 for (const [width,height] of [[1440,1000],[1100,900],[390,844]]) {
  await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:4311');
  await page.locator('.hero-temperature').waitFor();
  await page.waitForFunction(()=>document.querySelector('.interactive-map')?.getAttribute('data-weather-ready')==='true');
  await page.waitForTimeout(1000);
  const hero=await page.locator('.dashboard-grid .hero').boundingBox();const radar=await page.locator('.dashboard-grid .today-map').boundingBox();
  assert.ok(hero&&radar);if(width>1000){assert.ok(hero.width>radar.width*1.4);assert.ok(radar.width>=340);assert.ok(Math.abs(hero.y-radar.y)<2);}else{assert.ok(Math.abs(hero.width-radar.width)<2);assert.ok(radar.y>hero.y);}
  console.log(JSON.stringify({viewport:width,current:hero.width,radar:radar.width}));
  const before=requests.length;
  await page.evaluate(()=>{window.idleCanvas=document.querySelector('.maplibregl-canvas');window.changes=[];new MutationObserver(rs=>window.changes.push(...rs.map(r=>r.target.getAttribute('data-weather-ready')))).observe(document.querySelector('.interactive-map'),{attributes:true,attributeFilter:['data-weather-ready']});});
  const chart=page.locator('.hourly-card svg').first();await chart.scrollIntoViewIfNeeded();
  const rect=await chart.boundingBox();assert.ok(rect);
  for(let i=0;i<20;i++){await page.mouse.move(rect.x+rect.width*(.15+.7*i/20),rect.y+rect.height*.45);await page.waitForTimeout(60);}
  await page.clock.fastForward(61000);await page.waitForTimeout(800);
  assert.equal(requests.length,before,'chart hover and parent clock must not reload radar');
  assert.deepEqual(await page.evaluate(()=>window.changes),[],'idle raster remains ready');
  assert.equal(await page.evaluate(()=>window.idleCanvas===document.querySelector('.maplibregl-canvas')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  await page.locator('.hero').scrollIntoViewIfNeeded();
  await page.screenshot({path:root+'/docs/verification/current-width/width-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);
 await writeFile(root+'/docs/verification/current-width/results.json',JSON.stringify({passed:true,requests:requests.length,errors,viewports:['1440x1000','1100x900','390x844'],chartHoverSamples:20,parentClockAdvanceMs:61000,stableCanvas:true,noReadyTransitions:true,limitations:'Synthetic weather timing and retained map fixtures; all external requests blocked. No physical device or live-weather claim.'},null,2));
 console.log('PASS Today chart hover, clock tick, canvas, raster and requests stable on desktop/mobile');
} catch(error) {await writeFile('/tmp/zindycast-flashing-today-debug.json',JSON.stringify({requests,changes:await page.evaluate(()=>window.changes),size:await page.locator('.interactive-map').boundingBox()},null,2));throw error;} finally {await browser.close();}
