import { chromium } from 'playwright-core';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createClimatePlan,aggregateClimate,summarizeClimateDays} from '../../../packages/comparison/src/climate.ts';
import {localDayBounds} from '../../../packages/comparison/src/local-calendar.ts';
import {comparisonWeatherFieldNames,comparisonWeatherRequestUrl, type ComparisonWeatherHour,type ComparisonWeatherData} from '../../../packages/contracts/src/comparison-weather.ts';
const HOUR=3600000;
function row(time: number, patch: Partial<ComparisonWeatherHour> = {}): ComparisonWeatherHour {
  const h: ComparisonWeatherHour = {time:new Date(time).toISOString(), temperatureC:10, dewPointC:5, wetBulbTemperatureC:7, humidityPercent:50,windSpeedMs:2,precipitationMm:0,sunshineDurationSeconds:0,cloudCoverPercent:5,weatherCode:0,sourceHourPresent:true,missingFields:[], ...patch};
  h.missingFields = comparisonWeatherFieldNames.filter(f=>h[f]===null);
  return h;
}
function rows(start: string, count: number, value?: (time:number,i:number)=>Partial<ComparisonWeatherHour>) {
  return Array.from({length:count},(_,i)=>{const time=Date.parse(start)+i*HOUR;return row(time,value?.(time,i));});
}
function fixtures(plan: ReturnType<typeof createClimatePlan>, value?: (time:number,locationId:string)=>Partial<ComparisonWeatherHour>) {
  return plan.chunks.map(c=>{
    const n=(Date.parse(c.query.endDate)-Date.parse(c.query.startDate))/HOUR+24;
    const hours=rows(c.query.startDate,n,time=>value?.(time,c.locationId)??{});
    const sourceHours=hours.filter(h=>h.sourceHourPresent).length, completeHours=hours.filter(h=>h.missingFields.length===0).length;
    const data: ComparisonWeatherData = { query:c.query,timezone:'UTC',hours,
      provenance:{provider:'Open-Meteo',dataset:'ERA5 (requested)',requestedModel:'era5',constituent:null,classification:'modeled_reanalysis',sourceCoordinates:{latitude:c.query.latitude,longitude:c.query.longitude},sourceElevationM:20,retrievedAt:'2026-09-13T00:00:00.000Z',sourceIssuedAt:null,sourceUpdatedAt:null,requestUrl:comparisonWeatherRequestUrl(c.query),sourceUrl:'https://open-meteo.com/en/docs/historical-weather-api',attribution:'Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF',cellSelection:'land',downscaling:'provider default elevation adjustment',calculationVersion:'comparison-weather-adapter-v2'},
      units:{temperatureC:'°C',dewPointC:'°C',wetBulbTemperatureC:'°C',humidityPercent:'%',windSpeedMs:'m/s',precipitationMm:'mm',sunshineDurationSeconds:'s',cloudCoverPercent:'%',weatherCode:'wmo code'},
      intervalSemantics:'instant meteorology; precipitation and sunshine duration sums over preceding hour ending at time',
      completeness:{status:completeHours===n?'complete':hours.some(h=>comparisonWeatherFieldNames.some(f=>h[f]!==null))?'partial':'no_data',expectedHours:n,sourceHours,completeHours,missingHours:n-sourceHours,validCounts:Object.fromEntries(comparisonWeatherFieldNames.map(f=>[f,hours.filter(h=>h[f]!==null).length])) as ComparisonWeatherData['completeness']['validCounts']}};
    return {chunkId:c.id,data};
  });
}


const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const places=[{id:'a',name:'Fixture East',country:'US',latitude:40,longitude:-74,timezone:'America/New_York'},{id:'b',name:'Fixture West',country:'US',latitude:21,longitude:-157,timezone:'Pacific/Honolulu'}];
const results=[];
try { for(const width of [390,1440]) {
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,serviceWorkers:'block'});
 await context.addInitScript(places=>{localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',selected:places[0],saved:places,activity:'walking'}));localStorage.setItem('zindycast.installation.v1',JSON.stringify({id:'fixture',bearer:'fixture-access',createdAt:Date.now()-1000,expiresAt:Date.now()+3600000}));},places);
 let job:any=null, chunks:any[]=[], posts=0,gets=0,details=0,cancels=0,external=0,registration=0,failGet=false,failPost=false,delayDetail=false;
 const errors:string[]=[];
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.origin!=='http://fixture.test'){external++;return route.fulfill({status:503,body:'Fixture blocked'});}
  if(url.pathname==='/api/v1/installations'){registration++;return route.fulfill({status:503,body:'Never register in fixture'});}
  if(url.pathname.startsWith('/api/v1/climate-comparisons')) {
   assert.equal(req.headers().authorization,'Bearer fixture-access');
   if(req.method()==='POST'&&!url.pathname.endsWith('/cancel')){posts++;if(failPost)return route.fulfill({status:503,json:{status:'error'}});const query=req.postDataJSON();const plan=createClimatePlan(query);chunks=fixtures(plan,()=>({temperatureC:0,dewPointC:-5,wetBulbTemperatureC:0}));const result=aggregateClimate(plan,chunks);job={id:`00000000-0000-0000-0000-${String(posts).padStart(12,'0')}`,query,state:'completed',progress:1,attempt:1,createdAt:Date.now(),expiresAt:Date.now()+3600000,error:null,result};return route.fulfill({json:job});}
   if(url.pathname.endsWith('/cancel')){cancels++;job={...job,state:'cancelled',result:null};return route.fulfill({json:job});}
   if(url.pathname.endsWith('/detail')){details++;const location=job.query.locations.find(l=>l.id===url.searchParams.get('locationId'));const startDate=url.searchParams.get('startDate')!,endDate=url.searchParams.get('endDate')!;const hours=chunks.filter(c=>job.result.plan.chunks.find(p=>p.id===c.chunkId).locationId===location.id).flatMap(c=>c.data.hours);const days=summarizeClimateDays(hours,location.timezone,startDate,endDate);const start=localDayBounds(startDate,location.timezone).start,end=localDayBounds(endDate,location.timezone).end;const detail={status:'success',location,startDate,endDate,days,hours:hours.filter(h=>Date.parse(h.time)>=start&&Date.parse(h.time)<=end),sources:chunks.filter(c=>c.data.query.latitude===location.latitude).map(c=>c.data.provenance)};if(delayDetail)await new Promise(r=>setTimeout(r,700));return route.fulfill({json:detail});}
   gets++;if(failGet)return route.fulfill({status:503,json:{status:'error'}});return route.fulfill({json:job});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{status:'error',message:'Fixture unavailable'}});
  try{return await route.fulfill({path:'/tmp/zindycast-ui-garden-dist'+(url.pathname==='/'?'/index.html':url.pathname)});}catch{return route.fulfill({status:404,body:'Fixture missing'});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.goto('http://fixture.test');await page.getByRole('tab',{name:'Compare',exact:true}).click();const panel=page.locator('.climate-panel');await panel.waitFor();
 await panel.getByRole('checkbox').nth(0).check();await panel.getByRole('checkbox').nth(1).check();
 await panel.getByLabel('Start local date',{exact:true}).fill('2024-01-01');await panel.getByLabel('End local date',{exact:true}).fill('2024-01-31');
 await panel.getByRole('button',{name:'Compare cities',exact:true}).click();await panel.locator('.climate-results').waitFor();assert.equal(posts,1);assert.equal(await panel.getByText('Valid slots',{exact:true}).count(),0);assert.equal(await panel.getByText('Complete days',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await panel.getByLabel('Climate variable',{exact:true}).selectOption('humidityPercent');assert.equal(await panel.locator('.climate-city').getByText('Average daily high',{exact:true}).count(),0);await panel.getByLabel('Climate variable',{exact:true}).selectOption('temperatureC');assert.equal(await panel.locator('.climate-city').getByText('Average daily high',{exact:true}).count(),2);await panel.screenshot({path:`/tmp/climate-panel-${width}.png`});
 await panel.getByLabel('Detail end local date',{exact:true}).fill('2024-01-31');await panel.getByRole('button',{name:'Load daily and hourly detail',exact:true}).click();await panel.locator('.climate-detail').waitFor();assert.equal(details,1);
 await panel.locator('.climate-detail').screenshot({path:`/tmp/climate-panel-detail-${width}.png`});
 const before=posts+gets+details;await page.getByRole('button',{name:/°C/}).click();assert.equal(posts+gets+details,before);
 await panel.getByLabel('Detail city',{exact:true}).selectOption('21,-157');delayDetail=true;await panel.getByRole('button',{name:'Load daily and hourly detail',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.waitForTimeout(850);assert.equal(await panel.locator('.climate-detail').count(),0);assert.equal(await panel.locator('.climate-results').count(),0);await page.evaluate(()=>window.dispatchEvent(new Event('online')));delayDetail=false;
 await panel.getByLabel('Comparison period',{exact:true}).selectOption('climatology');await panel.getByLabel('First full year').fill('2022');await panel.getByLabel('Last full year').fill('2023');
 await panel.getByRole('button',{name:'Create another comparison',exact:true}).click();await page.waitForTimeout(700);assert.equal(job.query.mode,'climatology');assert.equal(posts,2);await panel.locator('.climate-results').waitFor();
 const postBeforeReload=posts;await page.reload();await page.getByRole('tab',{name:'Compare',exact:true}).click();await panel.locator('.climate-results').waitFor();assert.equal(posts,postBeforeReload);await panel.getByRole('checkbox').nth(0).check();await panel.getByRole('checkbox').nth(1).check();
 delayDetail=true;await panel.getByRole('button',{name:'Load daily and hourly detail',exact:true}).click();await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForTimeout(850);assert.equal(await panel.locator('.climate-detail').count(),0);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});delayDetail=false;
 
 failGet=true;await panel.getByRole('button',{name:'Refresh climate status',exact:true}).click();await panel.getByRole('alert').waitFor();const stopped=gets;await page.waitForTimeout(3200);assert.equal(gets,stopped);failGet=false;job={...job,state:'running',progress:.5,result:null};await panel.getByRole('button',{name:'Refresh climate status',exact:true}).click();await panel.getByRole('button',{name:'Cancel climate comparison',exact:true}).click();await page.waitForTimeout(200);assert.equal(cancels,1);
 failPost=true;await panel.getByRole('button',{name:'Create another comparison',exact:true}).click();await panel.getByRole('alert').waitFor();const noRetry=posts;await page.waitForTimeout(3200);assert.equal(posts,noRetry);
 assert.equal(registration,0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 results.push({width,posts,gets,details,cancels,registration,external,errors});await context.close();
 } await writeFile('/tmp/climate-panel-browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
