import {chromium} from 'playwright-core';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
const samples=[];let start;let count=0;const fixture={id:'fixture',name:'Boston',latitude:42.358,longitude:-71.06,timezone:'America/New_York',country:'US'};
await page.route('**/*',async r=>{const u=new URL(r.request().url());if(u.origin!=='http://127.0.0.1:4311')return r.fulfill({status:503,body:'audit blocked'});if(u.pathname==='/api/v1/locations'){count++;return r.fulfill({json:{status:'success',locations:[{...fixture,name:u.searchParams.get('q')}]}});}if(u.pathname.startsWith('/api/'))return r.fulfill({status:503,json:{status:'error',message:'audit disabled'}});return r.continue();});
await page.goto('http://127.0.0.1:4311/');
for(const query of ['Boston','Deltona','Boston']){await page.locator('#city-search').fill('');await page.waitForTimeout(100);const before=count;start=performance.now();await page.locator('#city-search').fill(query);await page.locator('.search-results').waitFor();samples.push({query,visibleMs:performance.now()-start,requests:count-before});}
if(samples[2].requests!==0)throw new Error('Repeat search fetched again');
await page.locator('#city-search').fill('Bo');await page.locator('#city-search').fill('Tokyo');await page.waitForTimeout(350);if(!(await page.locator('.search-results').innerText()).includes('Tokyo'))throw new Error('Outdated results');
await page.screenshot({path:'/tmp/search-after.png'});
console.log(JSON.stringify(samples,null,2));await writeFile('/tmp/search-after.json',JSON.stringify(samples,null,2));await browser.close();
