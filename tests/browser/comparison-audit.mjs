import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const out = 'docs/verification/browser-comparison';
await mkdir(`${out}/results`, { recursive: true });
await mkdir(`${out}/downloads`, { recursive: true });
const evidence = { started: new Date().toISOString(), checks: [], requests: [], consoleErrors: [], pageErrors: [], providerPotential: 0 };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(20000);
let lastCompleted;
let foregroundPotential = 0;
const pending = [];
// Count worst-case server upstream calls before forwarding. No responses are mocked.
// Each one-day/two-city job may issue two archive calls. Cache may reduce this.
await context.route('**/api/v1/**', async route => {
 const req = route.request(), u = new URL(req.url());
 const job = u.pathname === '/api/v1/comparisons' && req.method() === 'POST';
 const weight = u.pathname === '/api/v1/alerts' ? 3 : ['/api/v1/locations','/api/v1/forecast'].includes(u.pathname) ? 1 : job ? 2 : 0;
 // NWS may follow two redirects. Reserve four physical requests for two jobs.
 if (!job && foregroundPotential + weight > 8) { evidence.requests.push({ method:req.method(),path:u.pathname,blocked:'foreground budget reserved for comparisons' });await route.abort();return; }
 if (evidence.providerPotential + weight > 12) { evidence.requests.push({ method:req.method(), path:u.pathname, blocked:'budget' }); await route.abort(); return; }
 evidence.providerPotential += weight;
 if (!job) foregroundPotential += weight;
 evidence.requests.push({ method:req.method(), path:u.pathname.replace(/[a-f0-9-]{36}/g, ':job'), query: u.search, potentialUpstream:weight });
 await route.continue();
});
// Never collect request headers, registration bodies, console arguments or browser storage.
page.on('console', msg => { if (msg.type() === 'error') evidence.consoleErrors.push({ type:'error', location: new URL(msg.location().url || 'http://unknown').pathname, text: msg.text().replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,300) }); });
page.on('pageerror', () => evidence.pageErrors.push('Uncaught browser exception (message omitted to avoid secrets)'));
page.on('response', response => {
 const u = new URL(response.url());
 if (u.pathname.startsWith('/api/v1/')) evidence.requests.push({ response:response.status(), path:u.pathname.replace(/[a-f0-9-]{36}/g, ':job') });
 if (/\/comparisons\/[a-f0-9-]{36}$/.test(u.pathname)) pending.push((async () => { try { const j = await response.json(); if (j.state === 'completed') lastCompleted = j.result; } catch {} })());
});
const pass = text => evidence.checks.push({pass:text});
function parseCsv(text) {
 const lines = text.replace(/^\uFEFF/,'').trimEnd().split('\r\n');
 const rows = lines.map(line => { const cells=[]; let value='',quoted=false; for(let i=0;i<line.length;i++){const c=line[i]; if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){cells.push(value);value='';}else value+=c;}cells.push(value);return cells;});
 const keys=rows.shift(); return rows.map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]])));
}
try {
 evidence.browser = browser.version();
 await page.goto('http://127.0.0.1:4311/');
 for (const city of ['Roseville','Honolulu']) {
  await page.getByLabel('Search cities').fill(city);
  const option = page.locator('.search-results button').filter({hasText:city==='Roseville' ? /Placer/ : /Hawaii/}).first();
  await option.click();
  await page.getByRole('button',{name:'☆ Save place',exact:true}).click();
 }
 pass('Two cities searched and saved through UI');
 await page.getByRole('tab',{name:'Compare',exact:true}).click();
 const panel=page.locator('.comparison-panel');
 await expect(panel.getByRole('checkbox')).toHaveCount(2);
 for(const box of await panel.getByRole('checkbox').all()) await box.check();
 await panel.getByLabel('Start UTC date').fill('2020-07-15');
 await panel.getByLabel('End UTC date').fill('2020-07-15');
 const registration=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/installations'&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'Create comparison',exact:true}).click();
 assert.equal((await registration).status(),201); pass('First UI creation registers installation (201)');
 await expect(panel.getByRole('status').filter({hasText:'Status: completed'})).toBeVisible({timeout:60000});
 await Promise.all(pending);
 assert.ok(lastCompleted); assert.equal(lastCompleted.plan.window.expectedHours,24); assert.equal(lastCompleted.locations.length,2);
 await expect(panel.locator('tbody tr')).toHaveCount(5);
 for(const l of lastCompleted.locations) for(const v of Object.values(l.variables)) { assert.equal(v.expectedCount,24);assert.equal(v.validCount+v.missingCount,24); }
 pass('Live job completes; two cities, five variables and 24-hour denominators');
 await panel.getByLabel('Start UTC date').fill('2020-07-14');
 await expect(panel.getByText('Form inputs differ.',{exact:false})).toBeVisible();
 async function download(name) {const event=page.waitForEvent('download');await panel.getByRole('button',{name:'Download displayed comparison CSV (SI)',exact:true}).click();const d=await event;assert.equal(d.suggestedFilename(),'zindycast-comparison-summary.csv');await d.saveAs(`${out}/downloads/${name}`);return readFile(`${out}/downloads/${name}`,'utf8');}
 const first=await download('comparison-us.csv');
 const rows=parseCsv(first), summaries=rows.filter(r=>r.record_type==='variable_summary');
 assert.equal(summaries.length,10);
 for(const row of rows){assert.equal(row.start_date_utc,'2020-07-15');assert.equal(row.end_date_utc_inclusive,'2020-07-15');}
 for(const row of summaries){const l=lastCompleted.locations.find(l=>l.location.id===row.location_id);assert.ok(l);const v=l.variables[row.variable];for(const key of ['mean','min','max'])assert.equal(row[key],v[key]===null?'':String(v[key]));assert.equal(row.unit,v.unit);assert.equal(row.valid_count,String(v.validCount));if(row.variable!=='precipitationMm')assert.equal(row.complete_window_total_mm,'');}
 for(const row of rows.filter(r=>r.record_type==='source_chunk')){assert.equal(row.source_issued_at,'');assert.equal(row.source_updated_at,'');}
 pass('Saved CSV bytes match original selection and all live SI statistics; unavailable issue/update and inapplicable totals blank');
 await page.getByRole('button',{name:'°C',exact:true}).click();
 const metric=await download('comparison-metric.csv'); assert.equal(metric,first);
 pass('Metric display selection leaves downloaded SI snapshot byte-identical');
 await page.screenshot({path:`${out}/results/completed.png`,fullPage:true});
 await page.reload();
 await page.getByRole('tab',{name:'Compare',exact:true}).click();
 await expect(panel.getByRole('status').filter({hasText:'Status: completed'})).toBeVisible();
 await expect(page.getByRole('button',{name:'°C',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(panel.getByRole('checkbox')).toHaveCount(2); pass('Actual reload retains completed job, two saved cities and metric preference');
 for(const box of await panel.getByRole('checkbox').all()) await box.check();
 await panel.getByLabel('Start UTC date').fill('2020-07-15');await panel.getByLabel('End UTC date').fill('2020-07-15');
 await panel.getByRole('button',{name:'Create NEW comparison / retry',exact:true}).click();
 await panel.getByRole('button',{name:'Cancel comparison',exact:true}).click();
 await expect(panel.getByRole('status').filter({hasText:'Status: cancelled'})).toBeVisible();
 pass('Separate second UI creation and cancellation reach cancelled state');
 await page.reload();await page.getByRole('tab',{name:'Compare',exact:true}).click();
 await expect(panel.getByRole('status').filter({hasText:'Status: cancelled'})).toBeVisible();pass('Cancelled job reference/status survive reload');
 await page.screenshot({path:`${out}/results/cancelled.png`,fullPage:true});
 assert.equal(evidence.pageErrors.length,0);
 evidence.outcome='passed';
} catch(error) { evidence.outcome='failed'; evidence.failure=String(error.message).replace(/[a-f0-9-]{36}/g,':job').slice(0,2000);process.exitCode=1; }
finally { await browser.close(); await Promise.allSettled(pending);evidence.finished=new Date().toISOString();await writeFile(`${out}/results/audit.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify({outcome:evidence.outcome,checks:evidence.checks,failure:evidence.failure,providerPotential:evidence.providerPotential})); }
