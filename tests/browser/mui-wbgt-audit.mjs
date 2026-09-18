import {chromium,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
const out='docs/verification/mui-wbgt';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1100}});const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[],checks=[];let forecast;const requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().includes('/api/v1/'))requests.push({path:new URL(r.url()).pathname,status:r.status()});if(r.url().includes('/api/v1/forecast?')&&r.ok())forecast=await r.json();});
try{
 await page.goto('http://127.0.0.1:4311/?update-recovery=1');await page.locator('#city-search').fill('Honolulu');await page.locator('.search-results button').filter({hasText:'Hawaii'}).first().click();
 await expect(page.locator('.wbgt-value')).toBeVisible();await expect(page.locator('[data-wbgt-current]')).toHaveCount(1);
 const now=Date.now(),hour=forecast.data.hours.find(h=>Date.parse(h.time)<=now&&now-Date.parse(h.time)<3600000);expect(hour.wbgt.status).toBe('success');
 await expect(page.locator('.wbgt-value')).toHaveText(`${(hour.wbgt.valueC*9/5+32).toFixed(1)}°F`);expect(hour.wbgt.diagnostics.input.latitude).toBe(forecast.data.provenance.sourceCoordinates.latitude);checks.push('Live hourly WBGT matches response; source grid provenance and current marker present');
 await expect(page.locator('.hero .wbgt-panel')).toBeVisible();
 const metricsBox=await page.locator('.hero-bottom').boundingBox(),heatBox=await page.locator('.hero .heat-card').boundingBox();expect(heatBox.y).toBeGreaterThan(metricsBox.y+metricsBox.height);expect(heatBox.y-metricsBox.y-metricsBox.height).toBeLessThan(35);
 expect(await page.locator('.wbgt-scale-track').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('linear-gradient');checks.push('Heat scale follows current metrics in the same card with green-to-red gradient');
 await expect(page.locator('.wbgt-forecast svg')).toBeVisible();await expect(page.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true',{timeout:30000});await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);checks.push('Today has one rendered interactive map and WBGT forecast graph');
 const mapSize=await page.locator('.interactive-map').boundingBox();expect(mapSize.height).toBeGreaterThan(650);
 const mapCard=await page.locator('.today-map').boundingBox();expect(mapCard.y+mapCard.height-mapSize.y-mapSize.height).toBeLessThan(160);
 expect(await page.locator('.maplibregl-canvas').evaluate(el=>Math.abs(el.clientHeight-el.parentElement.parentElement.clientHeight)<2)).toBe(true);
 checks.push('Desktop map fills available card height and canvas matches viewport');

 await page.getByRole('button',{name:'°C',exact:true}).click();await expect(page.locator('.wbgt-value')).toHaveText(`${hour.wbgt.valueC.toFixed(1)}°C`);await expect(page.locator('.wbgt-tick').first()).toContainText('26.7');checks.push('Metric value and reference ticks convert correctly');
 await page.getByRole('button',{name:/Save place/}).click();await page.screenshot({path:`${out}/desktop.png`,fullPage:true});
 await page.getByRole('tab',{name:'Maps',exact:true}).click();await expect(page.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true',{timeout:30000});await page.getByRole('tab',{name:'Today',exact:true}).click();await expect(page.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true',{timeout:30000});checks.push('Today/Maps switching preserves single rendered map');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:`${out}/mobile.png`,fullPage:true});checks.push('390px layout has no horizontal overflow');
 await context.setOffline(true);await expect(page.locator('[data-wbgt-current]')).toHaveCount(0);await expect(page.locator('.wbgt-value')).toHaveCount(0);await context.setOffline(false);await expect(page.locator('.wbgt-value')).toBeVisible();checks.push('Offline removes current WBGT and reconnect restores it');
 expect(errors).toEqual([]);
}finally{await writeFile(`${out}/results.json`,JSON.stringify({at:new Date().toISOString(),checks,errors,requests,limits:'Live localhost Chrome, not physical devices. Upstream cache/provider call count not inferred from internal requests.'},null,2));await browser.close();}
console.log(checks);
