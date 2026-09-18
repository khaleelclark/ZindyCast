import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicMapboxToken } from './mapbox-config';
test('Mapbox config accepts only a bounded public token and defaults to no external provider', () => {
  assert.equal(publicMapboxToken(undefined), '');
  assert.equal(publicMapboxToken(''), '');
  assert.equal(publicMapboxToken('sk.secret'), '');
  assert.equal(publicMapboxToken('pk.invalid&extra=value'), '');
  assert.equal(publicMapboxToken('pk.' + 'a'.repeat(2048)), '');
  assert.equal(publicMapboxToken(' pk.fixture_token '), 'pk.fixture_token');
});
