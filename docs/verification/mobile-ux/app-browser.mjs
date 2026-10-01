// Built-app mobile layout smoke check. All responses are isolated fixtures.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd();
const forecast=JSON.parse(await readFile('docs/verification/forecast-wbgt/live-result.json','utf8'));
const location={id:'4553433',name:'Fixture Tulsa',latitude:36.154,longitude:-95.993,timezone:'America/Chicago',country:'US',admin1:'Oklahoma'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
await context.addInitScript(location=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',selected:location,saved:[location],backgroundMotion:true})),location);
let requests=0;
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());
 if(url.origin!=='http://fixture.invalid')return route.fulfill({status:503,body:'External requests disabled'});
 if(url.pathname==='/api/v1/forecast') {
  requests++;
  const data=structuredClone(forecast),start=Math.floor(Date.now()/3600000)*3600000;
  data.location=location;data.provenance.retrievedAt=new Date().toISOString();data.provenance.attribution='BROWSER FIXTURE ONLY';
  data.hours=data.hours.map((h,i)=>{const time=new Date(start+i*3600000).toISOString();return {...h,time,isDay:1,weatherCode:2,wbgt:h.wbgt?.diagnostics?{...h.wbgt,diagnostics:{...h.wbgt.diagnostics,input:{...h.wbgt.diagnostics.input,time}}}:h.wbgt};});
  return route.fulfill({json:{status:'success',freshness:'fresh',data}});
 }
 if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{message:'Fixture provider outage'}});
 if(url.search)return route.fulfill({status:503,body:'Version requests disabled'});
 try{return await route.fulfill({path:root+'/apps/web/dist'+(url.pathname==='/'?'/index.html':url.pathname)});}catch{return route.fulfill({status:404,body:'Missing fixture file'});}
});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
const results=[];
try {
 await page.goto('http://fixture.invalid', {waitUntil:'domcontentloaded',timeout:60000});
 const refresh=page.getByRole('button',{name:'Refresh',exact:true}).first();
 await refresh.waitFor({state:'visible'});
 for(const width of [360,390,430]) {
  await page.setViewportSize({width,height:844});
  const measure=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,transform:getComputedStyle(document.querySelector('.app-shell')).transform}));
  assert.ok(measure.scrollWidth<=width,JSON.stringify(measure));
  assert.equal(measure.transform,'none');assert.equal(await refresh.isVisible(),true);
  results.push({...measure,refreshVisible:true});
 }
 const before=requests;await refresh.click();await page.waitForFunction(()=>!document.querySelector('.current-refresh-button')?.disabled);assert.ok(requests>before);
 await page.getByRole('tab',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
 assert.equal(await page.locator('.pull-refresh-indicator').getAttribute('data-pulling'),null);
 assert.deepEqual(errors,[]);
 await writeFile('docs/verification/mobile-ux/app-results.json',JSON.stringify({browser:await browser.version(),phoneLayouts:results,refreshButtonFetches:true,settingsNavigation:true,pageErrors:errors,limitations:'Synthetic browser fixtures; secondary providers deliberately unavailable; no physical-device profiling'},null,2)+'\n');
 console.log(JSON.stringify({phoneLayouts:results,refreshButtonFetches:true,settingsNavigation:true,pageErrors:errors},null,2));
} finally {await browser.close();}
