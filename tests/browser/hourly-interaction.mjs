import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist=process.env.ZINDYCAST_TEST_DIST || root+'/apps/web/dist';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'America/Los_Angeles',country:'US',admin1:'Oklahoma'};
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
 if(url.pathname==='/api/v1/forecast'){const data=structuredClone(forecast);const start=Date.parse('2026-11-01T08:00:00Z');data.provenance.retrievedAt='2026-11-01T08:10:00Z';data.provenance.attribution='BROWSER FIXTURE ONLY';data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();return {...h,time,isDay:0,weatherCode:0,wbgt:h.wbgt?.diagnostics?{...h.wbgt,diagnostics:{...h.wbgt.diagnostics,input:{...h.wbgt.diagnostics.input,time}}}:h.wbgt};});data.hours[0].temperatureC=0;data.hours[0].apparentTemperatureC=1.25;data.hours[1].temperatureC=null;data.hours[1].apparentTemperatureC=-2;data.hours[2].temperatureC=null;data.hours[2].apparentTemperatureC=null;delete data.hours[2].wbgt;data.location=Object.fromEntries(url.searchParams);data.location.latitude=Number(data.location.latitude);data.location.longitude=Number(data.location.longitude);return route.fulfill({json:{status:'success',freshness:'fresh',data}});}
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

await page.clock.install({time:new Date('2026-11-01T08:10:00Z')});
try {
 await page.goto('http://127.0.0.1:4311');await page.locator('.hero-temperature').waitFor();
 const plot=page.locator('.hourly-chart [data-chart-hit-area]');const readout=page.locator('.hourly-chart [data-chart-readout]');
 await plot.scrollIntoViewIfNeeded();
 await plot.hover({position:{x:53,y:100}});assert.match(await readout.innerText(),/1:00 AM PDT · Temp 32.0°F · Feels like 34.3°F/);
 await page.mouse.move(0,0);await plot.focus();await plot.press('Home');assert.match(await readout.innerText(),/32.0°F/);
 await plot.press('ArrowRight');assert.match(await readout.innerText(),/1:00 AM PST · Temp Unavailable · Feels like 28.4°F/);
 await plot.press('ArrowRight');assert.match(await readout.innerText(),/Temp Unavailable · Feels like Unavailable/);
 await plot.press('Escape');assert.match(await readout.innerText(),/Hover or tap/);
 await plot.tap({position:{x:53,y:100}});assert.match(await readout.innerText(),/32.0°F/);
 await plot.click({position:{x:53,y:100}});assert.match(await readout.innerText(),/34.3°F/);
 const tooltip=page.locator('.hourly-chart .MuiChartsTooltip-root');await tooltip.waitFor();const tipBox=await tooltip.boundingBox();assert.ok(tipBox.x>=0 && tipBox.x+tipBox.width<=390,JSON.stringify(tipBox));assert.match(await tooltip.innerText(),/32.0°F/);
 assert.ok((await page.locator('.hourly-chart .MuiChartsSvgLayer-root').boundingBox()).width<390);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 assert.ok(await readout.evaluate(e=>e.getBoundingClientRect().height)<=1,'no visible persistent readout box');
 assert.equal(await plot.evaluate(e=>getComputedStyle(e).touchAction),'pan-y');
 await page.locator('.hourly-chart').screenshot({path:'/tmp/muicharts-hourly-us.png'});
 await page.getByRole('button',{name:'°C',exact:true}).click();
 await plot.scrollIntoViewIfNeeded();await plot.focus();await plot.press('Home');assert.match(await readout.innerText(),/Temp 0.0°C · Feels like 1.3°C/);
 await plot.hover({position:{x:53,y:100}});assert.match(await readout.innerText(),/0.0°C/);
 await plot.tap({position:{x:53,y:100}});assert.match(await readout.innerText(),/1.3°C/);
 await plot.press('ArrowRight');assert.match(await readout.innerText(),/PST · Temp Unavailable · Feels like -2.0°C/);
 await page.locator('.hourly-chart').screenshot({path:'/tmp/muicharts-hourly-metric.png'});
 await plot.scrollIntoViewIfNeeded();
 const box=await plot.boundingBox();const startY=Math.min(700,box.y+100);const startX=180;const before=await page.evaluate(()=>scrollY);
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:startX,y:startY}]});
 for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX,y:startY-i*20}]});await page.waitForTimeout(25);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok(await page.evaluate(()=>scrollY)>before,'vertical touch gesture on chart scrolls the page');
 await page.setViewportSize({width:1280,height:844});await plot.focus();await plot.press('Home');
 const labels=await page.locator('.hourly-chart .MuiChartsAxis-tickLabel').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,text:e.textContent}}));
 for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j];assert.ok(Math.min(a.right,b.right)<=Math.max(a.x,b.x)||Math.min(a.bottom,b.bottom)<=Math.max(a.y,b.y),JSON.stringify({a,b}));}
 await page.locator('.hourly-chart').screenshot({path:'/tmp/muicharts-hourly-desktop.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1280);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({browser:browser.version(),pageErrors:errors,liveCalls:0,mobileWidth:390,desktopWidth:1280,units:['us','metric'],methods:['hover','focus','arrows','Escape','tap','click'],missing:'independent and both',dst:'1AM PDT and 1AM PST'},null,2));
} catch(e) { console.log(await page.locator('body').innerText()); console.log(errors); throw e; } finally {await browser.close();}
