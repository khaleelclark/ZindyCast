import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const dist=process.env.RADAR_CONTROLS_DIST || '/tmp/zindycast-radar-deep-before';
const catalog=JSON.parse(await readFile(root+'/docs/verification/map-fix/catalog.json','utf8'));
const forecast=JSON.parse(await readFile(root+'/docs/verification/forecast-wbgt/live-result.json','utf8'));
const frame=JSON.parse(await readFile(root+'/docs/verification/map-fix/frame.json','utf8'));
frame.data.imageBase64=(await readFile(root+'/docs/verification/map-fix/mercator.png')).toString('base64');
const tulsa={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'America/Chicago',country:'US',admin1:'Oklahoma'};
const austin={...tulsa,id:'4671654',name:'Austin',latitude:30.267,longitude:-97.743,admin1:'Texas'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
let iconCode=95, daylight=1;
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
await context.addInitScript(()=>{
 window.audit={loads:[],uploads:[],raf:[],long:[],indices:[]};
 const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
 Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value){if(String(value).startsWith('blob:')){const entry={at:performance.now(),url:value};window.audit.loads.push(entry);this.addEventListener('load',()=>entry.duration=performance.now()-entry.at,{once:true});}src.set.call(this,value);}});
 for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype])for(const key of ['texImage2D','texSubImage2D']){const orig=proto[key];proto[key]=function(...args){const image=args.find(a=>a instanceof HTMLImageElement&&a.src.startsWith('blob:'));const start=performance.now();const result=orig.apply(this,args);if(image)window.audit.uploads.push({at:start,duration:performance.now()-start,url:image.src});return result;};}
 new PerformanceObserver(list=>window.audit.long.push(...list.getEntries().map(e=>({at:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
 let prior=0,last='';function tick(at){if(prior)window.audit.raf.push(at-prior);prior=at;const value=document.querySelector('.map-playback input')?.value;if(value!==last){window.audit.indices.push({at,value});last=value;}requestAnimationFrame(tick);}requestAnimationFrame(tick);
});
const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));const results=[];
try{
 for(const [width,height] of [[1440,1000],[390,844]]){
 await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:4311');
 await page.waitForFunction(()=>document.querySelector('.interactive-map')?.getAttribute('data-weather-ready')==='true');
 await page.locator('.interactive-map').scrollIntoViewIfNeeded();await page.waitForTimeout(800);
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(5500);
 for(const paused of [false,true]){
 await page.evaluate(paused=>{document.querySelector('.weather-backdrop')?.setAttribute('data-paused',String(paused));window.audit={loads:[],uploads:[],raf:[],long:[],indices:[]};},paused);
 const before=requests.length;await page.waitForTimeout(8500);
 const data=await page.evaluate(()=>window.audit);assert.equal(requests.length,before);assert.ok(new Set(data.indices.map(e=>e.value)).size>=5);
 results.push({width,paused,frameRequests:requests.length-before,...data});
 }
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.screenshot({path:root+'/docs/verification/radar-deep-audit/playback-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);await writeFile(root+'/docs/verification/radar-deep-audit/timings.json',JSON.stringify({results,errors,requests,outside,renderer:'Headless Chrome SwiftShader, not physical GPU',fixture:'Retained identical image assigned six advertised times; timing/lifecycle only'},null,2));
}finally{await browser.close();}
