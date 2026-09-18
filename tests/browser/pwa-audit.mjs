import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});const context=await browser.newContext();const page=await context.newPage();
const results=[];
try{
 await page.goto('http://127.0.0.1:4311/');await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
 expect(await page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);results.push('actual service worker controls reloaded page');
 await page.getByRole('button',{name:'°C',exact:true}).click();await context.setOffline(true);await page.reload();
 await expect(page.getByRole('tab',{name:'Today',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'°C',exact:true})).toHaveAttribute('aria-pressed','true');results.push('offline shell navigation reload and unit preference persistence');
 const cachedPaths=await page.evaluate(async()=>{const paths=[];for(const name of await caches.keys()){for(const r of await (await caches.open(name)).keys())paths.push(new URL(r.url).pathname);}return paths;});
 expect(cachedPaths.some(p=>p.startsWith('/api/'))).toBe(false);results.push('actual Cache Storage contains no API entries');
 await context.setOffline(false);await page.reload();await expect(page.locator('#city-search')).toBeEnabled();results.push('online reload recovery');
 await writeFile('docs/verification/browser/pwa-results.json',JSON.stringify({time:new Date().toISOString(),browser:browser.version(),results,cachedPaths,limits:'Desktop Chrome at localhost; physical installation, iOS icons, push and multi-release update still require checks.'},null,2));console.log(results);
}finally{await browser.close();}
