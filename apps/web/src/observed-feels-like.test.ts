import assert from 'node:assert/strict';
import test from 'node:test';
import { observedFeelsLike } from './observed-feels-like';

const c = (f: number) => (f - 32) * 5 / 9;
const missing = { valueC: null, method: 'unavailable' };
function heat(t: number, rh: number, expectedF: number) {
  const result = observedFeelsLike(c(t), rh, null);
  assert.equal(result.method, 'heat-index');
  assert.ok(result.valueC !== null && Math.abs(result.valueC - c(expectedF)) < 1e-8,
    `${t} F / ${rh}%: ${result.valueC} C`);
}

test('NWS regression reference values, SI output and no wind dependency', () => {
  // Independent Python Decimal evaluation at precision 40, not calls to the helper.
  heat(88, 58, 94.25074074);
  heat(90, 50, 94.59694120);
  assert.deepEqual(observedFeelsLike(c(88), 58, 20), observedFeelsLike(c(88), 58, null));
});

test('NWS dry and humid corrections and correction boundaries', () => {
  heat(100, 10, 94.1224826621874);
  heat(85, 90, 101.7808036);
  heat(95, 13, 90.41105238);
  heat(85, 85, 99.1140315);
  heat(112, 10, 106.75097634);
  heat(87, 90, 109.18318514);
  heat(80, 100, 89.2878534);
});

test('screening retains the averaged simple result and handles humid air below 80 F', () => {
  heat(80, 40, 79.79);
  heat(79, 100, 83.80052814);
  assert.deepEqual(observedFeelsLike(c(79), 40, null), { valueC: c(79), method: 'air-temperature' });
  // At 80 F the screened estimate reaches 80 F at RH=48.9361702128...%.
  heat(80, 48.93, 79.999855);
  assert.equal(observedFeelsLike(c(80), 48.94, null).method, 'heat-index');
  assert.ok(observedFeelsLike(c(80), 48.94, null).valueC! > c(80));
});

test('cold reference agrees with published rounded NWS example', () => {
  const result = observedFeelsLike(c(0), null, 15 * 0.44704);
  assert.equal(result.method, 'wind-chill');
  assert.ok(result.valueC !== null && Math.abs(result.valueC - c(-19)) < 0.3);
});

test('wind chill includes 50 F, excludes exactly 3 mph and needs observed wind', () => {
  assert.equal(observedFeelsLike(c(50), null, 4 * 0.44704).method, 'wind-chill');
  assert.equal(observedFeelsLike(c(50.001), null, 4 * 0.44704).method, 'air-temperature');
  for (const speed of [0, 3 * 0.44704]) {
    assert.deepEqual(observedFeelsLike(0, null, speed), { valueC: 0, method: 'air-temperature' });
  }
  assert.equal(observedFeelsLike(0, null, 3.001 * 0.44704).method, 'wind-chill');
  assert.deepEqual(observedFeelsLike(0, 50, null), missing);
});

test('missing RH is unavailable whenever a heat-index branch could apply', () => {
  for (const f of [79, 80, 88, 100]) assert.deepEqual(observedFeelsLike(c(f), null, 0), missing);
  assert.deepEqual(observedFeelsLike(20, null, null), { valueC: 20, method: 'air-temperature' });
  assert.deepEqual(observedFeelsLike(null, 50, 0), missing);
});

test('reject invalid SI inputs without coercing, clamping or emitting nonfinite values', () => {
  for (const t of [NaN, Infinity, -Infinity, -100.01, 60.01]) {
    assert.deepEqual(observedFeelsLike(t, 50, 2), missing);
  }
  for (const rh of [NaN, Infinity, -0.01, 100.01]) {
    assert.deepEqual(observedFeelsLike(30, rh, 2), missing);
  }
  for (const speed of [NaN, Infinity, -0.01, 150.01]) {
    assert.deepEqual(observedFeelsLike(0, 50, speed), missing);
  }
  assert.equal(observedFeelsLike(30, 0, 0).method, 'heat-index');
  assert.equal(observedFeelsLike(30, 100, 0).method, 'heat-index');
});
