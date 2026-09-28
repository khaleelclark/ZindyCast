import test from 'node:test';
import assert from 'node:assert/strict';
import { activeAlerts, dateKey, dayKey, temperature, summary } from './weather';
import { validateBase } from './api';
import type { AlertsData } from '@zindycast/contracts';
test('calendar days use location timezone across DST and UTC midnight', () => {
  const now = Date.parse('2026-03-08T07:30:00Z');
  assert.equal(dateKey(now, 'America/Los_Angeles'), '2026-03-07');
  assert.equal(dayKey(now, 'America/Los_Angeles', 1), '2026-03-08');
  assert.equal(dayKey(Date.parse('2026-03-08T10:30:00Z'), 'America/Los_Angeles', 1), '2026-03-09');
  assert.equal(dateKey('2026-09-28T03:00:00Z', 'Pacific/Honolulu'), '2026-09-27');
});
test('unit conversion preserves missingness and empty days', () => {
  assert.equal(temperature(0, 'imperial'), '32°F');
  assert.equal(temperature(null, 'metric'), '—');
  assert.deepEqual(summary([]), { high: null, low: null, rain: null });
});
test('alerts exclude cancelled, expired, future and test messages', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const base = { status: 'Actual', messageType: 'Alert', effective: null, expires: null, ends: null };
  const items = [base, { ...base, messageType: 'Cancel' }, { ...base, status: 'Test' }, { ...base, expires: '2026-09-28T11:00:00Z' }, { ...base, effective: '2026-09-28T13:00:00Z' }, { ...base, ends: '2026-09-28T11:00:00Z' }] as AlertsData['alerts'];
  assert.equal(activeAlerts(items, now).length, 1);
});
test('API configuration rejects credentials, paths and non-http schemes', () => {
  assert.equal(validateBase('https://weather.example'), 'https://weather.example');
  for (const base of ['', 'file:///tmp/data', 'https://secret:password@example.com', 'https://example.com/api/v1', 'https://example.com?key=x']) assert.throws(() => validateBase(base));
});
test('same-city identity includes coordinates and timezone, not label alone', async () => {
  const { sameLocation } = await import('./weather');
  const location = { id: 'city', name: 'Springfield', country: 'US', timezone: 'America/Chicago', latitude: 39, longitude: -90 };
  assert.equal(sameLocation(location, { ...location }), true);
  assert.equal(sameLocation(location, { ...location, longitude: -91 }), false);
  assert.equal(sameLocation(location, { ...location, timezone: 'America/New_York' }), false);
});
test('runtime server changes normalize origin and reject credentials', async () => {
  const api = await import('./api');
  api.configureApi(' https://weather.example/ ');
  assert.equal(api.API_BASE, 'https://weather.example');
  assert.throws(() => api.configureApi('https://user:password@weather.example'));
  assert.equal(api.API_BASE, 'https://weather.example');
});
test('release server configuration rejects placeholders, loopback and HTTP', () => {
  assert.equal(validateBase('https://weather.tailnet.ts.net', true), 'https://weather.tailnet.ts.net');
  for (const base of ['http://weather.tailnet.ts.net', 'https://weather.example', 'https://example.com', 'https://api.example.org', 'https://localhost', 'https://localhost.', 'https://127.0.0.2', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://10.0.2.2']) assert.throws(() => validateBase(base, true), base);
  assert.equal(validateBase('http://10.0.2.2:4311'), 'http://10.0.2.2:4311');
});
test('network failures explain tailnet connectivity and server settings', async () => {
  const api = await import('./api');
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Network request failed'); };
  try {
    api.configureApi('https://weather.tailnet.ts.net');
    await assert.rejects(api.request('/locations?q=test', new AbortController().signal), /enable Tailscale.*Server settings/);
  } finally { globalThis.fetch = original; }
});
