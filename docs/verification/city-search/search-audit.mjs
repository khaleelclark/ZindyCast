import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
const samples=[];let start;
await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:4311')return r.fulfill({status:503,body:'audit blocked'});if(u.pathname==='/api/v1/locations'){samples.push({query:u.searchParams.get('q'),requestMs:performance.now()-start});return r.continue();}if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,json:{status:'error',message:'audit disabled'}});return r.continue();});
page.on('response',async r=>{if(r.url().includes('/api/v1/locations?')){const sample=samples.at(-1);sample.responseMs=performance.now()-start;sample.status=r.status();}});
await page.goto('http://127.0.0.1:4311/');
for(const query of ['Boston','Deltona','Boston']){await page.locator('#city-search').fill('');await page.waitForTimeout(100);start=performance.now();await page.locator('#city-search').fill(query);await page.waitForFunction(()=>document.querySelector('.search-results')||/failed|timed out|limit|unavailable|No matching/.test(document.querySelector('.search-status')?.textContent??''),{},{timeout:15000});samples.at(-1).visibleMs=performance.now()-start;samples.at(-1).text=await page.locator('.search-wrap').innerText();}
console.log(JSON.stringify(samples,null,2));await writeFile('/tmp/search-audit.json',JSON.stringify(samples,null,2));await browser.close();
