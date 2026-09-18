import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist='/tmp/zindycast-current-final-dist';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'UTC',country:'US',admin1:'Oklahoma'};
const austin={...tulsa,id:'4671654',name:'Austin',latitude:30.267,longitude:-97.743,admin1:'Texas'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
let iconCode=0, daylight=1; let gaugeMode='normal';let forecastCalls=0;
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
 if(url.pathname==='/api/v1/forecast'){
 requests.push({forecastRefresh:url.searchParams.get('refresh')});forecastCalls++;const data=structuredClone(forecast);const start=Date.parse('2026-09-12T00:00:00Z');
 data.provenance.retrievedAt='2026-09-12T12:00:00Z';data.provenance.attribution='BROWSER FIXTURE ONLY';
 data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();const apparentTemperatureC=gaugeMode==='null'?null:gaugeMode==='equal'?0:i===0?-10:i===23?10:gaugeMode==='negative'?-5:0;const next={...h,time,apparentTemperatureC,isDay:1,weatherCode:0};delete next.wbgt;return next;});
 data.current=gaugeMode==='missing'?undefined:{time:gaugeMode==='old'?'2026-09-12T11:15:00Z':'2026-09-12T11:45:00Z',intervalSeconds:900,temperatureC:4,apparentTemperatureC:5,humidityPercent:70,windSpeedMs:2,windDirectionDeg:80,weatherCode:3,isDay:1,cloudCoverPercent:90};
 data.location=tulsa;return route.fulfill({json:{status:'success',freshness:gaugeMode==='stale'?'stale':'fresh',data}});
 }
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
 await page.clock.setFixedTime(new Date('2026-09-12T12:00:00Z'));
 await page.goto('http://127.0.0.1:4311/');await page.locator('.feels-like-gauge').waitFor();
 for(const width of [390,1440]) {await page.setViewportSize({width,height:1000});await page.waitForTimeout(250);assert.equal(await page.locator('.feels-gauge-value').innerText(),'41.0°F');assert.match(await page.locator('.current-time').innerText(),/Current modeled estimate/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 assert.equal(requests.find(r=>r.forecastRefresh).forecastRefresh,'1');
 const before=forecastCalls;await page.getByRole('button',{name:'Refresh weather',exact:true}).click();await page.waitForTimeout(400);assert.equal(forecastCalls,before+1);assert.equal(requests.filter(r=>r.forecastRefresh==='1').length,2);
 await page.getByRole('button',{name:'°C',exact:true}).click();await page.waitForTimeout(200);assert.equal(await page.locator('.feels-gauge-value').innerText(),'5.0°C');
 gaugeMode='old';await page.getByRole('button',{name:'Refresh weather',exact:true}).click();await page.waitForTimeout(400);assert.match(await page.locator('.current-time').innerText(),/Hourly forecast fallback/);assert.equal(await page.locator('.feels-gauge-value').innerText(),'0.0°C');
 gaugeMode='normal';await page.getByRole('button',{name:'Refresh weather',exact:true}).click();await page.waitForTimeout(400);await page.screenshot({path:'/tmp/current-gauge-final.png',fullPage:false});assert.deepEqual(errors,[]);console.log('PASS current coherent value, F/C, stale-current hourly fallback, refresh=1, phone/desktop nooverflow; fixture-only');
} finally {await browser.close();}
