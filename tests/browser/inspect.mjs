import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4311/');
 await page.getByRole('tab',{name:'Maps',exact:true}).click();
 await page.locator('.map-figure image').waitFor({timeout:25000});
 await page.locator('.map-figure').scrollIntoViewIfNeeded();
 await page.screenshot({path:'docs/verification/browser/map-before.png'});
 console.log('MAP',await page.locator('.map-figure').innerText());
 await page.getByRole('tab',{name:'Today',exact:true}).click();
 await page.locator('#city-search').fill('Roseville');
 await page.locator('.search-results button').first().waitFor({timeout:20000});
 console.log('SEARCH',await page.locator('.search-results').innerText());
 await page.screenshot({path:'docs/verification/browser/search-before.png'});
 await writeFile('docs/verification/browser/initial-errors.json',JSON.stringify(errors));
}finally{await browser.close();}
