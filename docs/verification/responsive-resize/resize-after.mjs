import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist='/tmp/zindycast-resize-dist';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'UTC',country:'US',admin1:'Oklahoma'};
const austin={...tulsa,id:'4671654',name:'Austin',latitude:30.267,longitude:-97.743,admin1:'Texas'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
let searches=[], deferred=[];
let iconCode=0, daylight=1; let gaugeMode='normal';let forecastCalls=0;
let mode='good', pending=null, requests=[], outside=0;
await context.addInitScript(({tulsa,austin})=>{
 localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',selected:tulsa,saved:[tulsa]}));
 window.renderAudit=[]; window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject(){return 1;},onCommitFiberRoot(id,root){const names=[];function walk(f){if(!f)return;const name=f.type===window.auditAppType?'App':f.type===window.auditSearchType?'CitySearch':f.type?.displayName||f.type?.name||f.type?.render?.name;if((f.flags&1)&&name)names.push(name);walk(f.child);walk(f.sibling);}walk(root.current);window.renderAudit.push(names);},onCommitFiberUnmount(){}};
 window.auditUrls={created:[],revoked:[]};
 const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=(blob)=>{const url=create(blob);window.auditUrls.created.push(url);return url;};
 URL.revokeObjectURL=(url)=>{window.auditUrls.revoked.push(url);revoke(url);};
},{tulsa,austin});
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin!=='http://127.0.0.1:4311'){outside++;return route.fulfill({status:503,body:'Fixture basemap outage'});}
 if(url.pathname==='/api/v1/locations'){const q=url.searchParams.get('q'); searches.push(q);if(q==='slow'){deferred.push(()=>route.fulfill({json:{status:'success',locations:[{...austin,name:'Old slow result'}]}}).catch(()=>{}));return;}return route.fulfill({json:{status:'success',locations:q==='empty'?[]:q==='badzone'?[{...austin,timezone:'Invalid/Zone'}]:[{...austin,name:q+' fixture'}]}});}
 if(url.pathname==='/api/v1/alerts')return route.fulfill({json:{status:'success',freshness:'fresh',data:{coordinates:{latitude:tulsa.latitude,longitude:tulsa.longitude},alerts:[],retrievedAt:new Date().toISOString(),attribution:'NWS fixture',provider:'NWS'}}});
 if(url.pathname==='/api/v1/forecast'){
 forecastCalls++;const data=structuredClone(forecast);const start=Date.parse('2026-09-12T00:00:00Z');
 data.provenance.retrievedAt='2026-09-12T12:00:00Z';data.provenance.attribution='BROWSER FIXTURE ONLY';
 data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();const apparentTemperatureC=gaugeMode==='null'?null:gaugeMode==='equal'?0:i===0?-10:i===23?10:gaugeMode==='negative'?-5:0;const next={...h,time,apparentTemperatureC,isDay:1,weatherCode:0};delete next.wbgt;return next;});
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
 await page.waitForTimeout(500);await page.evaluate(()=>window.firstRadarCanvas=document.querySelector('.today-map canvas.maplibregl-canvas'));
 const results=[];
 for(const width of [1440,1328,1200,1100,1001,1000,900,768,701,700,600,390,320,390,768,1001,1328,1600]){
  await page.setViewportSize({width,height:1000});
  await page.locator('.current-details').evaluate(el=>el.open=true);await page.waitForTimeout(200);
  const state=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom}};return {overflow:document.documentElement.scrollWidth>innerWidth,wind:box('.current-details .wind-widget'),heading:box('.current-details>summary'),summary:box('.current-summary'),details:box('.current-details')};});
  assert.equal(state.overflow,false,`page overflow ${width}`);
  assert.ok(state.wind.y>=state.heading.b,`wind overlaps heading ${width}`);
  const tiles=await page.locator('.daily-summary .hourly-strip').evaluate(el=>({w:el.clientWidth,scroll:el.scrollWidth}));assert.ok(tiles.scroll<=tiles.w+1,`hour tiles overflow ${width}`);
  await page.screenshot({path:`/tmp/resize-${width}.png`});const sizes=await page.evaluate(()=>({sameCanvas:window.firstRadarCanvas===document.querySelector('.today-map canvas.maplibregl-canvas'),maps:[...document.querySelectorAll('.today-map canvas.maplibregl-canvas')].map(c=>({canvas:c.getBoundingClientRect().width,container:c.closest('.interactive-map').clientWidth})),charts:[...document.querySelectorAll('.hourly-chart svg.MuiChartsSvgLayer-root')].map(c=>({chart:c.getBoundingClientRect().width,parent:c.closest('.hourly-chart').clientWidth}))}));
  assert.equal(sizes.sameCanvas,true,`map remounted ${width}`);for(const m of sizes.maps)assert.ok(Math.abs(m.canvas-m.container)<3,`map canvas mismatch ${width}`);for(const c of sizes.charts)assert.ok(c.chart<=c.parent+1,`chart overflow ${width}`);results.push({width,...state,...sizes});
 }
 for(let width=1500;width>=340;width-=40)await page.setViewportSize({width,height:900});for(let width=340;width<=1500;width+=40)await page.setViewportSize({width,height:900});await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 for(const tab of ['Maps','History','Compare','Settings']) {
  await page.getByRole('tab',{name:tab,exact:true}).click();
  for(const width of [1600,1328,1001,768,390,320,768,1440]){await page.setViewportSize({width,height:850});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${tab} overflow ${width}`);}
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({results,errors}));
}finally{await browser.close();}
