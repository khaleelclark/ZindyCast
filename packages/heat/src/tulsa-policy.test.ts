import test from 'node:test';
import assert from 'node:assert/strict';
import { TULSA_WBGT_SCALE, tulsaWbgtPosition } from './tulsa-policy';

const c = (f: number) => (f - 32) * 5 / 9;
const domain = [c(70), c(100)] as const; // Test viewport, not clinical limits.
const at = (f: number) => tulsaWbgtPosition({ metric: 'wbgt', valueC: c(f) }, domain);

test('every printed endpoint is unresolved while nearby unrounded values retain their band', () => {
  for (const [index, f] of [80, 85, 88, 90].entries()) {
    const exact = at(f), below = at(f - 0.001), above = at(f + 0.001);
    assert.equal(exact.status, 'positioned');
    assert.equal(below.status, 'positioned');
    assert.equal(above.status, 'positioned');
    if (exact.status !== 'positioned' || below.status !== 'positioned' || above.status !== 'positioned') throw Error();
    assert.equal(exact.bandIndex, null); assert.equal(exact.boundaryF, f);
    assert.equal(below.bandIndex, index); assert.equal(above.bandIndex, index + 1);
    assert.equal(below.boundaryF, null); assert.equal(above.boundaryF, null);
    assert.ok(Math.abs(exact.valueF - f) < 1e-12);
  }
});

test('viewport clips only marker, retains true value and reference band, and positions monotonically', () => {
  let previous = -1;
  for (let f = 50; f <= 120; f += 0.25) {
    const result = at(f);
    assert.equal(result.status, 'positioned');
    if (result.status !== 'positioned') throw Error();
    assert.ok(result.fraction >= previous && result.fraction >= 0 && result.fraction <= 1);
    previous = result.fraction;
    assert.equal(result.clipped, f < 70 ? 'below' : f > 100 ? 'above' : null);
    assert.equal(result.valueC, c(f));
  }
  const middle = at(85);
  assert.ok(middle.status === 'positioned' && Math.abs(middle.fraction - 0.5) < 1e-12);
});

test('wrong metrics, missing/nonfinite values and invalid domains never produce markers', () => {
  for (const metric of ['ordinary_wet_bulb', 'heat_index'] as const)
    assert.deepEqual(tulsaWbgtPosition({ metric, valueC: 30 }, domain), { status: 'unavailable', reason: 'wrong_metric' });
  for (const valueC of [null, NaN, Infinity, -Infinity, Number.MAX_VALUE])
    assert.deepEqual(tulsaWbgtPosition({ metric: 'wbgt', valueC }, domain), { status: 'unavailable', reason: 'missing_value' });
  for (const invalid of [[1, 1], [2, 1], [NaN, 3], [-Infinity, 1], [-Number.MAX_VALUE, Number.MAX_VALUE]] as const)
    assert.deepEqual(tulsaWbgtPosition({ metric: 'wbgt', valueC: 30 }, invalid), { status: 'unavailable', reason: 'invalid_domain' });
});

test('source description is immutable and keeps categorical notifications disabled', () => {
  assert.ok(Object.isFrozen(TULSA_WBGT_SCALE));
  assert.ok(Object.isFrozen(TULSA_WBGT_SCALE.boundariesF));
  assert.ok(Object.isFrozen(TULSA_WBGT_SCALE.labels));
  assert.equal(TULSA_WBGT_SCALE.categoricalNotificationsEnabled, false);
  assert.equal(TULSA_WBGT_SCALE.sourceStatus, 'nonoperational_prototype');
});
