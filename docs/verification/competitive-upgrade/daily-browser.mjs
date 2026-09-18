import { chromium } from 'playwright-core';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = process.cwd();
const dist = `${root}/apps/web/dist`;
const source = JSON.parse(await readFile(`${root}/docs/verification/forecast-wbgt/live-result.json`, 'utf8'));
const place = { id: '4553433', name: 'Fixture Tulsa', latitude: 36.154, longitude: -95.993, timezone: 'America/Chicago', country: 'US', admin1: 'Oklahoma' };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failForecast = false;

async function contextFor(viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion, hasTouch: viewport.width < 500, serviceWorkers: 'block' });
  await context.addInitScript(place => localStorage.setItem('zindycast.preferences.v1', JSON.stringify({ units: 'us', activity: 'walking', selected: place, saved: [place], backgroundMotion: true })), place);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4311') return route.fulfill({ status: 503, body: 'Fixture blocks external traffic' });
    if (url.pathname === '/api/v1/alerts') return route.fulfill({ json: { status: 'success', freshness: 'fresh', data: { coordinates: { latitude: place.latitude, longitude: place.longitude }, alerts: [], retrievedAt: new Date().toISOString(), attribution: 'NWS fixture', provider: 'NWS' } } });
    if (url.pathname === '/api/v1/forecast') {
      if (failForecast) return route.fulfill({ status: 503, json: { status: 'error', code: 'provider_error', message: 'Fixture forecast outage' } });
      const data = structuredClone(source); const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      data.provenance.retrievedAt = new Date().toISOString(); data.provenance.attribution = 'BROWSER FIXTURE ONLY';
      data.location = place;
      data.hours = data.hours.map((hour, index) => { const time = new Date(start + index * 3_600_000).toISOString(); return { ...hour, time, isDay: index % 24 >= 6 && index % 24 < 18 ? 1 : 0, weatherCode: index < 8 ? 2 : 61, precipitationProbability: index === 5 ? 70 : 20, wbgt: hour.wbgt?.diagnostics ? { ...hour.wbgt, diagnostics: { ...hour.wbgt.diagnostics, input: { ...hour.wbgt.diagnostics.input, time } } } : hour.wbgt }; });
      return route.fulfill({ json: { status: 'success', freshness: 'fresh', data } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { status: 'error', code: 'provider_error', message: 'Fixture source unavailable' } });
    if (url.search) return route.fulfill({ status: 503, body: 'Release check disabled' });
    try { return route.fulfill({ path: `${dist}${url.pathname === '/' ? '/index.html' : url.pathname}` }); } catch { return route.fulfill({ status: 404, body: 'Missing isolated-build asset' }); }
  });
  return context;
}

const errors = [];
try {
  const mobile = await contextFor({ width: 390, height: 844 }); const page = await mobile.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4311/'); await expect(page.locator('.feels-gauge-value')).toBeVisible();
  await expect(page.locator('.selected-place-header h1')).toHaveText('Fixture Tulsa');
  await page.locator('.app-shell').evaluate(el=>el.dataset.skyPhase='night');
  assert.equal(await page.locator('.selected-place-header h1').evaluate(el=>getComputedStyle(el).color),'rgb(229, 237, 249)');
  assert.notEqual(await page.locator('.alerts-quiet').evaluate(el=>getComputedStyle(el).color),'rgb(229, 237, 249)');
  await expect(page.locator('#city-search')).toHaveCount(0);
  await expect(page.locator('.feels-gauge-endpoints>span').first()).toContainText('Feels-like low');
  await expect(page.locator('.forecast-day-rain').first()).toContainText('Highest hourly rain chance');
  await expect(page.getByRole('heading', { name: 'Tomorrow', exact: true })).toBeVisible();
  const summary = await page.locator('.daily-summary-card').boundingBox(); const next = await page.getByRole('heading', { name: 'Next six hours' }).boundingBox();
  const mobileBoxes = await page.evaluate(() => Object.fromEntries(['.masthead','.navigation','.selected-place-header','.alerts-card','.hero','.current-summary','.current-details','.heat-card','.daily-summary-card'].map(selector => { const box = document.querySelector(selector)?.getBoundingClientRect(); return [selector, box && { y: box.y, height: box.height, bottom: box.bottom }]; })));
  console.log(JSON.stringify({ mobileBoxes, next })); await page.screenshot({ path: '/tmp/zindycast-daily-mobile-debug.png', fullPage: true });
  assert.ok(summary && next); assert.ok(next.y < 900, `next-hours begins too low: ${next.y}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const change = page.getByRole('button', { name: 'Change location' }); await change.focus(); await page.keyboard.press('Enter'); await expect(page.locator('#city-search')).toBeVisible();
  await page.getByRole('button', { name: 'Close location chooser' }).click(); await expect(page.locator('#city-search')).toHaveCount(0);
  const closer = page.locator('.current-details>summary'); await closer.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.current-details')).toHaveAttribute('open', ''); await page.keyboard.press('Enter');
  const fahrenheit = await page.locator('.feels-gauge-value').innerText(); await page.getByRole('button', { name: '°C', exact: true }).click(); await expect(page.locator('.feels-gauge-value')).not.toHaveText(fahrenheit);
  await page.screenshot({ path: '/tmp/zindycast-daily-mobile.png', fullPage: true });
  failForecast = true; await page.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Fixture forecast outage' })).toBeVisible(); await expect(page.locator('.daily-summary-card')).toBeVisible(); failForecast = false;
  await mobile.close();

  const desktop = await contextFor({ width: 1440, height: 1000 }); const wide = await desktop.newPage(); wide.on('pageerror', error => errors.push(error.message)); await wide.goto('http://127.0.0.1:4311/'); await expect(wide.locator('.feels-gauge-value')).toBeVisible();
  const hero = await wide.locator('.hero').boundingBox(); const map = await wide.locator('.today-map').boundingBox(); const glance = await wide.locator('.daily-summary-card').boundingBox(); const desktopNext = await wide.getByRole('heading', { name: 'Next six hours' }).boundingBox(); assert.ok(hero && map && glance && desktopNext); assert.ok(Math.abs(hero.y - map.y) < 2); assert.ok(Math.abs(hero.y - glance.y) < 2); assert.ok(desktopNext.y < 1000);
  await wide.screenshot({ path: '/tmp/zindycast-daily-desktop.png', fullPage: true });
  await expect(wide.getByRole('heading', { name: /Forecast accuracy/ })).toBeAttached();
  await wide.getByRole('tab', { name: 'Compare', exact: true }).click(); await expect(wide.getByRole('heading', { name: 'Climate comparison' })).toBeVisible(); await expect(wide.getByRole('button', { name: 'Last 30 days' })).toBeVisible();
  const legacy = wide.locator('.legacy-compare'); await expect(legacy).not.toHaveAttribute('open', ''); await legacy.locator(':scope>summary').click(); await expect(wide.getByRole('heading', { name: 'Compare', exact: true })).toBeVisible(); await expect(wide.getByRole('heading', { name: 'Climate comparison' })).toBeVisible();
  await wide.getByRole('tab', { name: 'History', exact: true }).click(); await expect(wide.getByRole('heading', { name: 'Typical weather · 1991–2020' })).toBeVisible();
  await wide.getByRole('tab', { name: 'Settings', exact: true }).click(); await expect(wide.getByRole('heading', { name: 'Warning notifications' })).toBeVisible(); await desktop.close();

  const reduced = await contextFor({ width: 390, height: 844 }, 'reduce'); const quiet = await reduced.newPage(); await quiet.goto('http://127.0.0.1:4311/'); await expect(quiet.locator('.feels-gauge-value')).toBeVisible();
  assert.equal(await quiet.locator('.scene-motion').first().evaluate(element => getComputedStyle(element).animationName), 'none'); await quiet.getByRole('tab', { name: 'Settings', exact: true }).click(); await expect(quiet.getByRole('button', { name: 'Pause weather animation' })).toBeVisible(); await reduced.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, mobile: { nextHoursTop: next.y, summaryTop: summary.y }, desktop: { heroTop: hero.y, mapTop: map.y, glanceTop: glance.y }, errors }));
} finally { await browser.close(); }
