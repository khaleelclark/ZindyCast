// Read-only private HTTPS verification in a disposable browser profile.
// API requests are intercepted; an inert browser-only marker exercises updating.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origin = process.env.ZINDYCAST_VERIFY_ORIGIN;
if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Set ZINDYCAST_VERIFY_ORIGIN to the private HTTPS origin');
const root = 'apps/web/dist';
const html = await readFile(`${root}/index.html`, 'utf8');
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/static\/[^\"]+\.(?:js|css))"/g)].map(match => match[1]))].sort();
const responses = [];
for (const path of ['/', '/sw.js', '/manifest.webmanifest', ...assets]) {
  const response = await fetch(origin + path);
  if (!response.ok) throw new Error(`Delivery status ${response.status} for ${path}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = await readFile(root + (path === '/' ? '/index.html' : path));
  expect(bytes.equals(local)).toBe(true);
  responses.push({ path, status: response.status, cacheControl: response.headers.get('cache-control'), sha256: createHash('sha256').update(bytes).digest('hex') });
}
const health = await fetch(origin + '/api/v1/health');
expect(health.status).toBe(200);
expect((await health.json()).status).toBe('ok');

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const preferences = { units: 'metric', activity: 'walking', selected: null, saved: [], backgroundMotion: true };
await context.addInitScript(preferences => {
  if (!localStorage.getItem('zindycast.preferences.v1')) localStorage.setItem('zindycast.preferences.v1', JSON.stringify(preferences));
}, preferences);
let simulateUpdate = false;
const errors = [];
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { status: 'error', code: 'provider_error', message: 'Delivery check: provider requests disabled' } });
  if (url.pathname === '/static/js/ux-release-marker.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.uxDeliveryMarker=true;' });
  if (simulateUpdate && url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html.replace('</head>', '<script defer src="/static/js/ux-release-marker.js"></script></head>') });
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab', { name: 'Today', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const installedBuild = await page.evaluate(() => new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get('build'));
  expect(installedBuild).toBe(assets.join('|'));
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/')).waiting)).toBe(false);
  await expect(page.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '°C', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const before = await page.evaluate(() => localStorage.getItem('zindycast.preferences.v1'));
  simulateUpdate = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const update = page.getByRole('button', { name: 'Update', exact: true });
  await expect(update).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.uxDeliveryMarker)).toBeUndefined();
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), update.click()]);
  await expect(page.getByRole('tab', { name: 'Today', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.uxDeliveryMarker)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('zindycast.preferences.v1'))).toBe(before);
  expect(errors).toEqual([]);
  const report = {
    checkedAt: new Date().toISOString(), browser: await browser.version(), responses,
    healthOk: true, currentServiceWorkerControlsReload: true,
    installedBuildMatchesServedAssets: true, alreadyCurrentHasNoUpdateButton: true,
    updateButtonPreservesOpenSettingsUntilClicked: true,
    updateLoadsNewShellAndPreservesPreferences: true, pageErrors: errors,
    limitations: 'Certificate-verified private HTTPS and disposable desktop Chromium at phone width. API fixtures return unavailable; no live weather calls. Update transition uses an inert marker intercepted only in this browser. No physical-phone or Android WebView performance claim.'
  };
  await writeFile('docs/verification/mobile-ux/delivery-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ responsesMatched: responses.length, healthOk: true, updatePreservesPreferences: true, pageErrors: errors }));
} finally { await browser.close(); }
