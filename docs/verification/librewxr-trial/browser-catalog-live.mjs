// Lead authorized bounded follow-up: one ordinary Chrome catalog navigation, one advertised nowcast image. No retries.
import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const dir=new URL('./',import.meta.url), browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({serviceWorkers:'block'});
let allowed='https://api.librewxr.net/public/weather-maps.json', calls=0;const logs=[];
await context.route('**/*',r=>r.request().url()===allowed&&++calls<=2?r.continue():r.fulfill({status:404,body:'Audit blocked'}));
try {
 const p=await context.newPage();let r=await p.goto(allowed,{timeout:25000});let b=await r.body();logs.push({url:allowed,status:r.status(),headers:await r.allHeaders(),bytes:b.length,at:new Date().toISOString()});await writeFile(new URL('chrome-catalog.bin',dir),b);
 if(r.status()===200){const c=JSON.parse(b.toString());console.log(JSON.stringify(c).slice(0,16000));const f=c.radar?.nowcast?.find(f=>Number.isSafeInteger(f.time)&&f.time*1000>Date.now()&&f.time*1000<Date.now()+3600000);if(f){allowed=`https://api.librewxr.net/v2/radar/${f.time}/512/10/28.858/-81.17/6/1_0.png`;r=await p.goto(allowed,{timeout:25000});b=await r.body();logs.push({url:allowed,status:r.status(),headers:await r.allHeaders(),bytes:b.length,at:new Date().toISOString()});await writeFile(new URL('chrome-nowcast.bin',dir),b);}}
}finally{await writeFile(new URL('chrome-catalog-check.json',dir),JSON.stringify(logs,null,2));console.log(JSON.stringify(logs));await browser.close();}
