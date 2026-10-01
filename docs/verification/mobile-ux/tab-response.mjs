// Run from repository root: node .../tab-response.mjs <before|after>.
// Built-app fixtures and 4x desktop CPU throttling; not a phone benchmark.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('Pass before or after');
const root = process.cwd();
const forecast = JSON.parse(await readFile('docs/verification/forecast-wbgt/live-result.json', 'utf8'));
const location = { id: '4553433', name: 'Fixture Tulsa', latitude: 36.154, longitude: -95.993, timezone: 'America/Chicago', country: 'US', admin1: 'Oklahoma' };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
await context.addInitScript(location => {
  localStorage.setItem('zindycast.preferences.v1', JSON.stringify({ units: 'us', activity: 'walking', selected: location, saved: [location], backgroundMotion: true }));
  window.dateFormatterConstructions = 0;
  const Original = Intl.DateTimeFormat;
  Intl.DateTimeFormat = new Proxy(Original, { construct(target, args) { window.dateFormatterConstructions++; return Reflect.construct(target, args); } });
  window.tabResults = [];
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('[role="tab"]');
    if (!tab) return;
    const started = performance.now(), before = window.dateFormatterConstructions;
    const painted = () => {
      if (tab.getAttribute('aria-selected') !== 'true') return requestAnimationFrame(painted);
      requestAnimationFrame(() => window.tabResults.push({ tab: tab.textContent, ms: performance.now() - started, dateFormatterConstructions: window.dateFormatterConstructions - before }));
    };
    requestAnimationFrame(painted);
  }, true);
}, location);
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== 'http://fixture.invalid') return route.fulfill({ status: 503, body: 'External requests disabled' });
  if (url.pathname === '/api/v1/forecast') {
    const data = structuredClone(forecast), start = Math.floor(Date.now() / 3600000) * 3600000;
    data.location = location; data.provenance.retrievedAt = new Date().toISOString(); data.provenance.attribution = 'TAB RESPONSE FIXTURE ONLY';
    data.hours = data.hours.map((hour, index) => {
      const time = new Date(start + index * 3600000).toISOString();
      return { ...hour, time, isDay: 1, weatherCode: 2, wbgt: hour.wbgt?.diagnostics ? { ...hour.wbgt, diagnostics: { ...hour.wbgt.diagnostics, input: { ...hour.wbgt.diagnostics.input, time } } } : hour.wbgt };
    });
    return route.fulfill({ json: { status: 'success', freshness: 'fresh', data } });
  }
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { message: 'Fixture provider unavailable' } });
  if (url.search) return route.fulfill({ status: 503, body: 'Version requests disabled' });
  try { return await route.fulfill({ path: root + '/apps/web/dist' + (url.pathname === '/' ? '/index.html' : url.pathname) }); }
  catch { return route.fulfill({ status: 404, body: 'Missing fixture file' }); }
});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(60000);
const session = await context.newCDPSession(page);
await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
try {
  await page.goto('http://fixture.invalid', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Today and tomorrow', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh', exact: true }).first().waitFor();
  for (const tab of ['Settings', 'History', 'Compare', 'Today', 'Settings', 'History', 'Compare', 'Today']) {
    const before = await page.evaluate(() => window.tabResults.length);
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.waitForFunction(before => window.tabResults.length > before, before);
    assert.equal(await page.getByRole('tab', { name: tab, exact: true }).getAttribute('aria-selected'), 'true');
    if (tab === 'Today') await page.getByRole('heading', { name: 'Today and tomorrow', exact: true }).waitFor();
    else await page.getByRole('heading', { name: tab === 'Compare' ? 'Climate comparison' : tab, exact: true }).first().waitFor();
  }
  // Controls that previously retriggered all forecast date grouping.
  await page.getByRole('button', { name: '14 days', exact: true }).click();
  assert.equal(await page.locator('.forecast-day').count(), 14);
  await page.getByRole('button', { name: '°C', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '°C', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  const switches = await page.evaluate(() => window.tabResults);
  if (phase === 'after') assert.ok(switches.every(item => item.dateFormatterConstructions <= 20), 'Tab switches should reuse date formatting rules instead of constructing thousands');
  // Verify the fifth tab separately; live map imagery/latency is outside fixtures.
  await page.getByRole('tab', { name: 'Maps', exact: true }).click();
  await page.getByRole('heading', { name: 'Weather map', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Maps', exact: true }).getAttribute('aria-selected'), 'true');
  assert.deepEqual(errors, []);
  const report = { phase, browser: await browser.version(), cpuThrottle: 4, switches, maxTabMs: Math.max(...switches.map(item => item.ms)), pageErrors: errors, horizon14Works: true, unitsWork: true, mapsNavigationWorks: true, limitations: 'Synthetic 336-hour forecast, unavailable secondary providers, external traffic blocked, 4x desktop CPU throttling. Click-to-two-animation-frames metric includes rendering; not physical-phone latency or an Android WebView benchmark. Maps navigation checked separately; live map imagery/latency unverified.' };
  await writeFile(`docs/verification/mobile-ux/tab-${phase}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
