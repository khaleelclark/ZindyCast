import test from 'node:test';
import assert from 'node:assert/strict';
import { pullRefreshThreshold, resistedPullDistance } from './pull-to-refresh';

test('pull refresh requires a downward threshold and caps visual travel', () => {
  assert.equal(resistedPullDistance(100, 80), 0);
  assert.equal(resistedPullDistance(100, 100), 0);
  assert.ok(Math.abs(resistedPullDistance(100, 200) - 55) < Number.EPSILON * 100);
  assert.ok(resistedPullDistance(100, 224) >= pullRefreshThreshold);
  assert.equal(resistedPullDistance(100, 1000), 96);
});
