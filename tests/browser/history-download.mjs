import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});const page=await browser.newPage();page.setDefaultTimeout(20000);
try{
 await page.goto('http://127.0.0.1:4311/');await page.locator('#city-search').fill('Austin');await page.locator('.search-results button').filter({hasText:'Travis'}).first().click();await page.getByRole('tab',{name:'History',exact:true}).click();
 await page.getByLabel('UTC date',{exact:true}).fill('2020-07-15');await page.getByRole('button',{name:'Load history / retry',exact:true}).click();await expect(page.getByRole('button',{name:'Download CSV for displayed UTC selection',exact:true})).toBeVisible();
 await page.getByLabel('UTC date',{exact:true}).fill('2020-07-16');await expect(page.locator('.history-panel')).toContainText('Inputs changed');
 const ready=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV for displayed UTC selection',exact:true}).click();const download=await ready;const path='docs/verification/browser/history-download.csv';await download.saveAs(path);const csv=await readFile(path,'utf8');
 expect(csv).toContain('2020-07-15');expect(csv).not.toContain('2020-07-16T');expect(csv).toContain('ERA5');expect(csv.includes('temperature_C')).toBe(true);
 await writeFile('docs/verification/browser/history-download.json',JSON.stringify({time:new Date().toISOString(),browser:browser.version(),suggestedFilename:download.suggestedFilename(),bytes:Buffer.byteLength(csv),sameDisplayedSelection:true,si:true},null,2));console.log('Actual browser CSV saved and same-displayed-date checks passed');
}finally{await browser.close();}
