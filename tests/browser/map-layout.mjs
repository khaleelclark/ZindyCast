import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const directory='docs/verification/map-layout';await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[],measurements=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:4311/?update-recovery=1');await page.locator('#city-search').fill('Honolulu');await page.locator('.search-results button').filter({hasText:'Hawaii'}).first().click();await expect(page.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true',{timeout:30000});
 // Additional viewport requests deliberately fail locally to check warning containment without upstream demand.
 await page.route('**/api/v1/maps/frame?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({status:'error',code:'provider_error',message:'Layout test: frame unavailable'})}));
 for(const width of [1280,800,390]){
  await page.setViewportSize({width,height:1000});
  for(const open of [false,true]){
   await page.locator('.compact-map-details').evaluate((node,value)=>{node.open=value;},open);
   await page.waitForTimeout(600);
   const metrics=await page.evaluate(()=>{const card=document.querySelector('.compact-map'),next=document.querySelector('.details-card'),r=card.getBoundingClientRect();const last=card.lastElementChild.getBoundingClientRect();return {cardBottom:r.bottom,lastBottom:last.bottom,nextTop:next.getBoundingClientRect().top,width:document.documentElement.scrollWidth,viewport:innerWidth};});
   expect(metrics.lastBottom).toBeLessThanOrEqual(metrics.cardBottom);expect(metrics.nextTop).toBeGreaterThanOrEqual(metrics.cardBottom);expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);measurements.push({width,open,...metrics});
  }
  await page.locator('.compact-map-details').evaluate(node=>{node.open=false;});await page.locator('.today-map').scrollIntoViewIfNeeded();await page.screenshot({path:`${directory}/${width}.png`});
 }
 expect(errors).toEqual([]);
}finally{await writeFile(`${directory}/results.json`,JSON.stringify({measurements,errors},null,2));await browser.close();}
