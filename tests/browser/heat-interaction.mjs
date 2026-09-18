import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist=process.env.ZINDYCAST_TEST_DIST || root+'/apps/web/dist';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'America/Chicago',country:'US',admin1:'Oklahoma'};
const austin={...tulsa,id:'4671654',name:'Austin',latitude:30.267,longitude:-97.743,admin1:'Texas'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
let fixtureF=88, fixtureFreshness='fresh', fixtureUnits='us';
let mode='good', pending=null, requests=[], outside=0;
await context.addInitScript(({tulsa,austin})=>{
 localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:sessionStorage.getItem('fixtureUnits') || 'us',activity:'walking',selected:tulsa,saved:[tulsa]}));
 window.auditUrls={created:[],revoked:[]};
 const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=(blob)=>{const url=create(blob);window.auditUrls.created.push(url);return url;};
 URL.revokeObjectURL=(url)=>{window.auditUrls.revoked.push(url);revoke(url);};
},{tulsa,austin});
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin!=='http://127.0.0.1:4311'){outside++;return route.fulfill({status:503,body:'Fixture basemap outage'});}
 if(url.pathname==='/api/v1/alerts')return route.fulfill({json:{status:'success',freshness:'fresh',data:{coordinates:{latitude:tulsa.latitude,longitude:tulsa.longitude},alerts:[],retrievedAt:new Date().toISOString(),attribution:'NWS fixture',provider:'NWS'}}});
 if(url.pathname==='/api/v1/forecast'){const data=structuredClone(forecast);const start=Math.floor(Date.now()/3600000)*3600000;data.provenance.retrievedAt=new Date().toISOString();data.provenance.attribution='BROWSER FIXTURE ONLY';data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();return {...h,time,isDay:0,weatherCode:0,wbgt:h.wbgt?.diagnostics?{...h.wbgt,diagnostics:{...h.wbgt.diagnostics,input:{...h.wbgt.diagnostics.input,time}}}:h.wbgt};});if(fixtureF===null)delete data.hours[0].wbgt;else data.hours[0].wbgt.valueC=(fixtureF-32)*5/9;delete data.hours[2].wbgt;data.location=Object.fromEntries(url.searchParams);data.location.latitude=Number(data.location.latitude);data.location.longitude=Number(data.location.longitude);return route.fulfill({json:{status:'success',freshness:fixtureFreshness,data}});}
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
 await page.goto('http://127.0.0.1:4311');await page.locator('.hero-temperature').waitFor();await page.waitForTimeout(1500);
 if(await page.locator('.heat-card > details').count())await page.locator('.heat-card > details').evaluate(e=>e.open=true);
 await page.locator('.heat-trend').evaluate(e=>e.open=true);

 console.log('READY');const marker=page.locator('[data-wbgt-current]');
 await marker.hover();await page.getByRole('tooltip',{name:/Current WBGT 88.0°F · reference boundary/}).waitFor();
 await page.mouse.move(0,0);await marker.focus();await page.getByRole('tooltip',{name:/Current WBGT 88.0°F · reference boundary/}).waitFor();
 await marker.blur();await marker.tap();await page.getByRole('tooltip',{name:/Current WBGT 88.0°F · reference boundary/}).waitFor();
 const point=page.locator('.wbgt-forecast [data-chart-hit-area]');
 assert.ok(await page.locator('.wbgt-forecast [data-chart-readout]').evaluate(e=>e.getBoundingClientRect().height)<=1);
 assert.equal(await page.getByText('Lower upcoming estimate:',{exact:false}).count(),0);
 assert.ok(await page.locator('.heat-guidance').evaluate(e=>Boolean(e.compareDocumentPosition(document.querySelector('.wbgt-forecast'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 console.log('MARKER PASS');await point.hover({position:{x:53,y:100}});assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/88.0°F/);
 await page.mouse.move(0,0);await point.focus();await point.press('Home');assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/88.0°F/);
 await point.press('Escape');assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/Hover or tap/);
 await point.tap({position:{x:53,y:100}});assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/88.0°F/);
 assert.match(await page.locator('.wbgt-forecast').innerText(),/23\/24 values/);
 await point.press('Home');await point.press('ArrowRight');await point.press('ArrowRight');assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/Unavailable/);
 await point.press('Home');
 assert.equal(await page.getByText('Hourly heat',{exact:true}).count(),0);
 assert.equal(await page.locator('.hourly-heat dt').count(),0);
 assert.equal(await page.locator('.hourly-heat .table-scroll').count(),0);
 assert.equal(await page.getByText('WBGT inputs, method & source',{exact:true}).count(),0);
 assert.equal(await page.getByText('Ordinary wet-bulb & humidity detail',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 const ticks=await page.locator('.wbgt-band-labels > span').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
 for(let i=0;i<ticks.length;i++)for(let j=i+1;j<ticks.length;j++){const a=ticks[i],b=ticks[j];assert.ok(Math.min(a.right,b.right)<=Math.max(a.x,b.x)||Math.min(a.bottom,b.bottom)<=Math.max(a.y,b.y),JSON.stringify({a,b}));}
 await page.locator('.wbgt-panel').screenshot({path:'/tmp/muicharts-heat-mobile.png'});
 await page.getByRole('button',{name:'°C',exact:true}).click();
 await marker.hover();await page.getByRole('tooltip',{name:/Current WBGT 31.1°C · reference boundary/}).waitFor();
 await point.focus();await point.press('Home');assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/31.1°C/);
 await point.tap({position:{x:53,y:100}});assert.match(await page.locator('.wbgt-forecast [data-chart-readout]').innerText(),/31.1°C/);
 assert.match(await page.locator('.wbgt-band-labels').innerText(),/<26.7/);assert.match(await page.locator('.wbgt-band-labels').innerText(),/>32.2/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 await page.locator('.wbgt-panel').screenshot({path:'/tmp/muicharts-heat-metric.png'});
 const metricTicks=await page.locator('.wbgt-band-labels > span').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
 for(let i=0;i<metricTicks.length;i++)for(let j=i+1;j<metricTicks.length;j++){const a=metricTicks[i],b=metricTicks[j];assert.ok(Math.min(a.right,b.right)<=Math.max(a.x,b.x)||Math.min(a.bottom,b.bottom)<=Math.max(a.y,b.y));}
 await page.getByText('Heat precautions',{exact:true}).click();
 assert.equal(await page.locator('.heat-guidance tbody tr').count(),5);
 assert.equal(await page.locator('.heat-guidance [aria-current]').count(),0);
 const guidance = await page.locator('.heat-guidance').innerText();
 assert.match(guidance,/Effects on body/);
 assert.deepEqual([...guidance.matchAll(/source reference: (\d+) min/g)].map(match=>Number(match[1])),[45,30,20,15]);
 assert.match(guidance,/not safe exposure limits or personal predictions/);
 assert.doesNotMatch(await page.locator('.wbgt-panel').innerText(),/Breaks each hour|Reference ticks in/);
 await page.getByText('Heat precautions',{exact:true}).focus();
 await page.getByText('Heat precautions',{exact:true}).press('Enter');
 assert.equal(await page.locator('.heat-guidance').evaluate(e=>e.open),false);
 await page.getByText('Heat precautions',{exact:true}).press('Enter');
 assert.equal(await page.locator('.heat-guidance').evaluate(e=>e.open),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 await page.locator('.heat-guidance').screenshot({path:'/tmp/mui-heat-guidance.png'});

 const bandChecks=[];
 for(const width of [390,1440])for(const units of ['us','metric'])for(const f of [79,82,86,89,91,80,85,88,90,null,'stale']){
  fixtureF=f==='stale'?91:f; fixtureFreshness=f==='stale'?'stale':'fresh';
  await page.setViewportSize({width,height:1000});
  await page.evaluate(units=>sessionStorage.setItem('fixtureUnits',units),units);
  await page.reload();await page.locator('.hero-temperature').waitFor();
  if(await page.locator('.heat-card > details').count())await page.locator('.heat-card > details').evaluate(e=>e.open=true);
  await page.locator('.wbgt-band-labels').waitFor();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.wbgt-scale-track')).backgroundImage==='none');
  const expected=[79,82,86,89,91].indexOf(f);
  const panel=page.locator('.wbgt-panel');
  assert.equal(await panel.getAttribute('data-wbgt-band'),expected<0?'neutral':String(expected));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  const labels=await page.locator('.wbgt-band-labels > span').evaluateAll(es=>es.map(e=>{const r=document.createRange();r.selectNodeContents(e);const b=r.getBoundingClientRect();return {left:b.left,right:b.right}}));
  for(let i=1;i<labels.length;i++)assert.ok(labels[i].left>=labels[i-1].right,JSON.stringify({width,units,labels}));
  if(expected>=0){
   assert.equal(await page.locator('[data-wbgt-current]').evaluate(e=>e.style.left),`${expected*20+10}%`);
   const colors=await panel.evaluate((e,index)=>({number:getComputedStyle(e.querySelector('.wbgt-value')).color,band:getComputedStyle(e.querySelector(`.wbgt-band-${index}`)).backgroundColor,swatch:getComputedStyle(e.querySelector(`.heat-band-swatch-${index}`)).backgroundColor}),expected);
   assert.equal(colors.number,colors.band);assert.equal(colors.number,colors.swatch);
   if(f===91)await panel.screenshot({path:`/tmp/wbgt-bands-${width}-${units}.png`});
  }else if(f===null||f==='stale')assert.equal(await page.locator('[data-wbgt-current]').count(),0);
  else assert.match(await panel.innerText(),/At a reference boundary/);
  bandChecks.push({width,units,f,band:expected<0?'neutral':expected});
 }
 console.log(JSON.stringify({bandChecks,fixtureOnly:true,browser:browser.version()},null,2));
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));assert.equal(await page.locator('[data-wbgt-current]').count(),0);assert.equal(await page.locator('.wbgt-point').count(),0);

 console.log(JSON.stringify({ticks,pageErrors:errors,liveCalls:0,points:23,removedHourlyList:true},null,2));
 assert.deepEqual(errors,[]);

} catch(error){console.log(await page.locator('body').innerText());throw error;} finally {await browser.close();}
