import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { migrationFallbackScript, migrationScript } from './migration';

const key = 'zindycast.preferences.v1';
const location = { id: 'osteen', name: 'Osteen', country: 'US', admin1: 'Florida', timezone: 'America/New_York', latitude: 28.87, longitude: -81.16 };

function run(previous: Parameters<typeof migrationScript>[0], existing?: string) {
  const values = new Map<string, string>();
  if (existing) values.set(key, existing);
  runInNewContext(migrationScript(previous), { localStorage: { getItem: (name: string) => values.get(name), setItem: (name: string, value: string) => values.set(name, value) } });
  return values.get(key);
}

test('first WebView load carries selected city and units from the earlier Android app', () => {
  const result = JSON.parse(run({ location, units: 'metric' }) ?? '{}');
  assert.deepEqual(result.selected, location);
  assert.equal(result.units, 'metric');
  assert.equal(result.activity, 'walking');
});

test('existing PWA choices are never overwritten and invalid legacy locations are ignored', () => {
  const existing = JSON.stringify({ selected: { name: 'Already chosen' } });
  assert.equal(run({ location, units: 'metric' }, existing), existing);
  const migrated = JSON.parse(run({ location: { ...location, timezone: 'not-a-timezone' } }) ?? '{}');
  assert.equal(migrated.selected, null);
});

test('late Android injection recovers an empty PWA profile once', () => {
  const values = new Map<string, string>([[key, JSON.stringify({ selected: null, saved: [], units: 'us' })]]);
  let reloads = 0;
  const context = { localStorage: { getItem: (name: string) => values.get(name), setItem: (name: string, value: string) => values.set(name, value) }, location: { reload: () => { reloads++; } } };
  runInNewContext(migrationFallbackScript({ location, units: 'metric' }), context);
  runInNewContext(migrationFallbackScript({ location, units: 'metric' }), context);
  assert.equal(reloads, 1);
  assert.deepEqual(JSON.parse(values.get(key) ?? '{}').selected, location);
});
