import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist='/tmp/zindycast-ui-garden-dist';
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
 await page.goto('http://127.0.0.1:4311/');await page.locator('.feels-like-gauge').waitFor();await page.waitForTimeout(1400);
 const metrics=[];
 for(const width of [1440,390]){
 await page.setViewportSize({width,height:1000});await page.locator('#city-search').scrollIntoViewIfNeeded();await page.waitForTimeout(500);
 const before={forecast:forecastCalls,map:requests.length,search:searches.length};
 await page.evaluate(()=>{const fiber=el=>el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];window.auditAppType=fiber(document.querySelector('.app-shell')).return.type;window.auditSearchType=fiber(document.querySelector('.search-wrap')).return.type;window.renderAudit=[];window.inputTrace=[];window.originalCanvas=document.querySelector('.maplibregl-canvas');document.querySelector('#city-search').addEventListener('input',e=>{const start=performance.now(),value=e.target.value;requestAnimationFrame(()=>window.inputTrace.push({value,ms:performance.now()-start}));});});
 const input=page.locator('#city-search');await input.fill('');await input.pressSequentially(width===1440?'Seattle':'Chicago',{delay:35});await page.locator('.search-results button').waitFor();
 assert.equal(searches.length,before.search+1);
 const audit=await page.evaluate(()=>({commits:window.renderAudit,trace:window.inputTrace,sameCanvas:window.originalCanvas===document.querySelector('.maplibregl-canvas'),overflow:document.documentElement.scrollWidth>innerWidth}));
 assert.ok(audit.commits.flat().includes('CitySearch'));assert.ok(!audit.commits.flat().includes('App'));assert.ok(!audit.commits.flat().includes('MapsPanel'));assert.ok(!audit.commits.flat().includes('HourlyChart'));assert.equal(audit.sameCanvas,true);assert.equal(audit.overflow,false);
 assert.equal(forecastCalls,before.forecast);assert.equal(requests.length,before.map);
 await page.screenshot({path:`/tmp/city-search-${width}.png`});metrics.push({width,...audit});
 await input.fill('slow');await page.waitForTimeout(260);await input.fill('newest');await page.locator('.search-results button').filter({hasText:'newest fixture'}).waitFor();for(const complete of deferred.splice(0))await complete();await page.waitForTimeout(100);assert.doesNotMatch(await page.locator('.search-wrap').innerText(),/Old slow/);
 await input.fill('slow');await page.waitForTimeout(260);await input.fill('');for(const complete of deferred.splice(0))await complete();await page.waitForTimeout(100);assert.equal(await page.locator('.search-results').count(),0);assert.equal(await page.locator('.search-status').innerText(),'');
 const n=searches.length;await input.fill(' NEWEST ');await page.locator('.search-results button').waitFor();await page.waitForTimeout(250);assert.equal(searches.length,n);
 await input.fill('empty');await page.getByRole('status').filter({hasText:'No matching places'}).waitFor();
 await input.fill('badzone');await page.locator('.search-status').filter({hasText:'Invalid time zone'}).waitFor();assert.equal(await page.locator('.search-results').count(),0);
 await input.fill('newest');await page.locator('.search-results button').click();await page.waitForTimeout(200);assert.equal(await input.inputValue(),'');assert.equal(await page.locator('.search-results').count(),0);
 // Restore selected fixture city through saved-place selection, which also clears a pending search.
 await input.fill('slow');await page.waitForTimeout(260);await page.locator('.saved-places button').first().click();for(const complete of deferred.splice(0))await complete();await page.waitForTimeout(250);assert.equal(await input.inputValue(),'');assert.equal(await page.locator('.search-results').count(),0);await page.locator('.feels-like-gauge').waitFor();
 }
 const input=page.locator('#city-search');
 for(let i=0;i<31;i++){await input.fill('cache'+i);await page.locator('.search-results button').filter({hasText:'cache'+i+' fixture'}).waitFor();}
 let count=searches.length;await input.fill('cache0');await page.locator('.search-results button').filter({hasText:'cache0 fixture'}).waitFor();assert.equal(searches.length,count+1);
 await input.fill('');count=searches.length;await input.fill('cache30');await page.locator('.search-results button').waitFor();assert.equal(searches.length,count);
 await input.fill('');await page.clock.setFixedTime(new Date('2026-09-13T12:00:01Z'));await input.fill('cache30');await page.locator('.search-results button').waitFor();assert.equal(searches.length,count+1);
 assert.deepEqual(errors,[]);await writeFile('/tmp/city-search-browser-results.json',JSON.stringify({passed:true,metrics,searches,forecastCalls,mapRequests:requests.length,errors,outside},null,2));console.log(JSON.stringify({passed:true,metrics:metrics.map(m=>({width:m.width,commits:m.commits.length,appRenders:m.commits.flat().filter(n=>n==='App').length,maxInputFrameMs:Math.max(...m.trace.map(t=>t.ms)),sameCanvas:m.sameCanvas})),errors,outside}));
}finally{await browser.close();}
