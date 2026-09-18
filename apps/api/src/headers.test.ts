import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_SECURITY_POLICY } from './headers';
test('styled basemaps allow only the fixed Mapbox API origin without widening script or worker policy', () => {
 const directives = Object.fromEntries(CONTENT_SECURITY_POLICY.split('; ').map(line => { const [key, ...values] = line.split(' '); return [key, values]; }));
 assert.deepEqual(directives['script-src'], ["'self'"]);
 assert.deepEqual(directives['worker-src'], ["'self'"]);
 for (const key of ['connect-src', 'img-src']) {
  assert.ok(directives[key]!.includes('https://api.mapbox.com'));
  assert.ok(directives[key]!.includes('https://tile.openstreetmap.org'));
  assert.ok(!directives[key]!.some(value => value.includes('*')));
 }
});
