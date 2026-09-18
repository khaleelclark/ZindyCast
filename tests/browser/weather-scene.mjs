import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist=process.env.SCENE_DIST || '/tmp/zindycast-weather-scene-dist';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'America/Chicago',country:'US',admin1:'Oklahoma'};
const austin={...tulsa,id:'4671654',name:'Austin',latitude:30.267,longitude:-97.743,admin1:'Texas'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
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
 if(url.pathname==='/api/v1/forecast'){const data=structuredClone(forecast);const start=Math.floor(Date.now()/3600000)*3600000;data.provenance.retrievedAt=new Date().toISOString();data.provenance.attribution='BROWSER FIXTURE ONLY';data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();return {...h,time,isDay:0,weatherCode:0,wbgt:h.wbgt?.diagnostics?{...h.wbgt,diagnostics:{...h.wbgt.diagnostics,input:{...h.wbgt.diagnostics.input,time}}}:h.wbgt};});data.hours[0].wbgt.valueC=(88-32)*5/9;delete data.hours[2].wbgt;data.location=Object.fromEntries(url.searchParams);data.location.latitude=Number(data.location.latitude);data.location.longitude=Number(data.location.longitude);return route.fulfill({json:{status:'success',freshness:'fresh',data}});}
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
 await page.goto('http://127.0.0.1:4311');await page.locator('.hero-temperature').waitFor();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.scene-stars')).animationName==='scene-star-shimmer');
 const results=[];
 for(const width of [1440,390]) {
  await page.setViewportSize({width,height:1000});
  for(const weather of ['sunny','night','cloudy','rain','snow','storm','fog','neutral']) {
   await page.locator('.app-shell').evaluate((e,w)=>e.dataset.weather=w,weather);
   const state=await page.evaluate(()=>{const shell=document.querySelector('.app-shell');const back=document.querySelector('.weather-backdrop');return {width:innerWidth,scroll:document.documentElement.scrollWidth,sky:getComputedStyle(shell).getPropertyValue('--sky').trim(),duplicate:getComputedStyle(shell,'::after').display,pointer:getComputedStyle(back).pointerEvents,visible:[...back.querySelectorAll('.scene-sun,.scene-moon,.scene-stars,.scene-cloud,.scene-rain,.scene-snow,.scene-fog')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.getAttribute('class'))}});
   assert.equal(state.scroll,width);assert.equal(state.duplicate,'none');assert.equal(state.pointer,'none');assert.ok(!state.sky.includes('gradient'));
   if(weather==='neutral')assert.equal(state.visible.length,0);else assert.ok(state.visible.length>0);
   results.push({weather,...state});
   if(['night','rain','sunny','snow'].includes(weather))await page.screenshot({path:`/tmp/weather-scene-${weather}-${width}.png`});
  }
 }
 await page.locator('.app-shell').evaluate(e=>e.dataset.weather='rain');
 const before=await page.locator('.scene-rainfall').evaluate(e=>getComputedStyle(e).transform);await page.waitForTimeout(250);const after=await page.locator('.scene-rainfall').evaluate(e=>getComputedStyle(e).transform);assert.notEqual(before,after);
 await page.getByRole('button',{name:'Pause background',exact:true}).click();assert.equal(await page.locator('.scene-rainfall').evaluate(e=>getComputedStyle(e).animationPlayState),'paused');await page.getByRole('button',{name:'Animate background',exact:true}).click();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>document.querySelector('.weather-backdrop').dataset.paused==='true');assert.equal(await page.locator('.scene-rainfall').evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.scene-rainfall').evaluate(e=>getComputedStyle(e).animationName),'none');
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.equal(await page.locator('.app-shell').getAttribute('data-weather'),'neutral');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,motionTransforms:{before,after},pause:true,hiddenPause:true,reducedMotion:true,offlineNeutral:true,liveCalls:0,errors},null,2));
}finally {await browser.close();}
