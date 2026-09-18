import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { stationCell, stationCoverage } from '../../../packages/contracts/src/index.ts';
const root=process.cwd(),dist='/tmp/zindycast-ui-garden-dist';
const history=JSON.parse(await readFile(root+'/docs/verification/history-runtime/new-york-march-2020.json','utf8'));
const station=JSON.parse(await readFile(root+'/docs/verification/stations-runtime/live-result.json','utf8'));
const city={id:'5128581',name:'Fixture city',latitude:40.7128,longitude:-74.006,timezone:'America/New_York',country:'US'};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:1000},hasTouch:true,serviceWorkers:'block'});
await context.addInitScript(city=>localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',selected:city,saved:[city],activity:'walking'})),city);
let calls=0,outside=0,blank=false;const errors=[];
await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='http://fixture.test'){outside++;return route.fulfill({status:503,body:'Fixture only'});}
 if(url.pathname==='/api/v1/history'){
 calls++; const data=structuredClone(history);data.query=Object.fromEntries(['startDate','endDate'].map(k=>[k,url.searchParams.get(k)]));Object.assign(data.query,{latitude:city.latitude,longitude:city.longitude});
 const fields=['temperatureC','humidityPercent','precipitationMm','windSpeedMs','dewPointC'];const n=(Date.parse(data.query.endDate)-Date.parse(data.query.startDate))/3600000+24;
 data.hours=Array.from({length:n},(_,i)=>{const h={time:new Date(Date.parse(data.query.startDate)+i*3600000).toISOString(),temperatureC:blank?null:i===0?0:i%24-10,dewPointC:blank?null:i===0?0:i%24-14,humidityPercent:blank?null:50,precipitationMm:blank?null:i%5===0?0:1,windSpeedMs:blank?null:2,sourceHourPresent:!blank,missingFields:[]};if(i===2)for(const f of fields)h[f]=null;h.missingFields=fields.filter(f=>h[f]===null);return h;});
 data.completeness={status:blank?'no_data':'partial',expectedHours:n,sourceHours:blank?0:n,completeHours:blank?0:n-1,missingHours:blank?n:0,validCounts:Object.fromEntries(fields.map(f=>[f,data.hours.filter(h=>h[f]!==null).length]))};return route.fulfill({json:{status:'success',freshness:'fresh',data}});
 }
 if(url.pathname==='/api/v1/stations/history'){
 calls++;const data=structuredClone(station);data.query=Object.fromEntries(url.searchParams);data.station.id=data.query.stationId;
 data.days=Array.from({length:3},(_,i)=>({date:new Date(Date.parse(data.query.startDate)+i*86400000).toISOString().slice(0,10),TMAX:stationCell(i===1?500:100,' ',i===1?'I':' ','7'),TMIN:stationCell(i===2?-9999:0,' ',' ','7'),PRCP:stationCell(0,i===0?'T':i===1?'P':' ',' ','7')}));data.coverage=stationCoverage(data.days);return route.fulfill({json:{status:'success',freshness:'fresh',data}});
 }
 if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{status:'error',message:'Fixture provider unavailable'}});
 try{return await route.fulfill({path:dist+(url.pathname==='/'?'/index.html':url.pathname)});}catch{return route.fulfill({status:404,body:'fixture unavailable'});}
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
try{
 await page.goto('http://fixture.test');await page.getByRole('tab',{name:'History',exact:true}).click();
 for(const width of [390,1440]){
 await page.setViewportSize({width,height:1000});
 await page.getByRole('button',{name:'Load history',exact:true}).click();await page.locator('.history-visuals').waitFor();
 const hit=page.getByRole('slider',{name:'Historical hourly values in UTC'});await hit.focus();await hit.press('Home');assert.match(await hit.getAttribute('aria-valuetext'),/Air 32.0°F.*Dew point 32.0°F/);await hit.press('ArrowRight');assert.match(await hit.getAttribute('aria-valuetext'),/15.8°F/);await hit.press('ArrowRight');assert.match(await hit.getAttribute('aria-valuetext'),/Unavailable/);await hit.press('End');await hit.press('Escape');
 const before=calls;await page.getByLabel('Explore hourly values').selectOption('precipitation');await page.getByRole('slider',{name:'Historical hourly values in UTC'}).focus();assert.match(await page.locator('.history-plot-readout').innerText(),/0.00 in/);await page.getByLabel('Explore hourly values').selectOption('temperature');assert.equal(calls,before);
 await page.locator('.history-visuals').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/history-visuals-day-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('.history-panel form select').selectOption('month');await page.getByLabel('UTC month',{exact:true}).fill('2020-03');await page.getByRole('button',{name:'Load history',exact:true}).click();await page.waitForTimeout(600);assert.equal(await page.locator('.history-range-row').count(),31);await page.locator('.history-plot').scrollIntoViewIfNeeded();await page.locator('.history-plot svg.MuiChartsSvgLayer-root').tap({position:{x:160,y:120}});await page.screenshot({path:`/tmp/history-visuals-month-${width}.png`});
 await page.locator('.history-panel form select').selectOption('day');
 }
 // Display-unit toggle remains local.
 await page.getByRole('button',{name:/°C/}).click();await page.getByRole('slider',{name:'Historical hourly values in UTC'}).focus();await page.getByRole('slider',{name:'Historical hourly values in UTC'}).press('Home');assert.match(await page.locator('.history-plot-readout').innerText(),/Air 0.0°C.*Dew point 0.0°C/);
 blank=true;await page.getByRole('button',{name:'Load history',exact:true}).click();await page.getByText('No values available for this chart;', {exact:false}).waitFor();assert.equal(await page.locator('.history-plot').count(),0);
 await page.locator('select').filter({has:page.locator('option[value=station]')}).selectOption('station');await page.getByLabel('US GHCN-Daily station ID',{exact:true}).fill('USC00021282');await page.getByLabel('Start source date').fill('2020-03-01');await page.getByLabel('End source date').fill('2020-03-03');await page.getByRole('button',{name:'Load station',exact:true}).click();await page.locator('.history-visuals').waitFor();
 const stationHit=page.getByRole('slider',{name:'Station values by source calendar date'});await stationHit.focus();await stationHit.press('ArrowRight');assert.match(await stationHit.getAttribute('aria-valuetext'),/Daily high Unavailable \/ excluded/);
 for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.locator('.history-visuals').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/history-visuals-station-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 const before=calls;await page.getByLabel('Explore station values').selectOption('precipitation');await stationHit.focus();await stationHit.press('Home');assert.match(await stationHit.getAttribute('aria-valuetext'),/Unavailable \/ excluded/);await stationHit.press('End');assert.match(await stationHit.getAttribute('aria-valuetext'),/0.0 mm/);assert.equal(calls,before);
 await page.getByText('Daily station values & flags',{exact:true}).click();assert.match(await page.locator('.station-panel').innerText(),/Trace \(T\).*Missing presumed zero/s);
 await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.getByText('Offline — station history unavailable.',{exact:false}).waitFor();assert.equal(await page.locator('.history-visuals').count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,calls,outside,errors}));
}finally{await browser.close();}
