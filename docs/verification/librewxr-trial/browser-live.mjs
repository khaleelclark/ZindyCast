// ONE tile request, no catalog. Do not rerun without a new live budget.
import {chromium} from 'playwright-core';
import {writeFile,readFile} from 'node:fs/promises';
const dir=new URL('./',import.meta.url);const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const context=await browser.newContext({serviceWorkers:'block'});const url='https://api.librewxr.net/v2/radar/0/512/10/28.858/-81.17/6/1_0.png';let calls=0;
await context.route('**/*',route=>route.request().url()===url&&++calls===1?route.continue():route.fulfill({status:404,body:'Blocked by bounded audit'}));
try{const page=await context.newPage();const response=await page.goto(url,{timeout:25000});const body=await response.body();await writeFile(new URL('chrome-latest-response.bin',dir),body);const logs=JSON.parse(await readFile(new URL('requests.json',dir)));logs.push({url,status:response.status(),headers:await response.allHeaders(),bytes:body.length,retrievedAt:new Date().toISOString(),client:'Actual Chrome navigation',calls});await writeFile(new URL('requests.json',dir),JSON.stringify(logs,null,2));console.log(logs.at(-1));}finally{await browser.close();}
