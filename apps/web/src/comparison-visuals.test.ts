import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonNumber, comparisonVisualValue, comparisonVisualRows } from './comparison-visuals';
import type { ComparisonResult } from './comparison-model';

test('visual means convert SI values once, retaining negatives, zeros, and nulls', () => {
  assert.equal(comparisonNumber('temperatureC', -40, 'us'), -40);
  assert.equal(comparisonNumber('temperatureC', 0, 'us'), 32);
  assert.equal(comparisonNumber('dewPointC', -10, 'metric'), -10);
  assert.equal(comparisonNumber('humidityPercent', 0, 'us'), 0);
  assert.equal(comparisonNumber('precipitationMm', 25.4, 'us'), 1);
  assert.equal(comparisonNumber('windSpeedMs', 10, 'metric'), 36);
  assert.equal(comparisonVisualValue('windSpeedMs', 10, 'us'), '22.4 mph');
  assert.equal(comparisonVisualValue('precipitationMm', 0, 'us'), '0.00 in');
  assert.equal(comparisonVisualValue('temperatureC', null, 'us'), 'Unavailable');
});
test('city color/order stay fixed across metric and unit changes without replacing missing means with zero', () => {
  const result = { locations: Array.from({ length: 5 }, (_, i) => ({ location: { id: String(i), name: `City ${i}` }, variables: { temperatureC: { mean: i ? null : -10 }, precipitationMm: { mean: i } } })) } as unknown as ComparisonResult;
  const temp = comparisonVisualRows(result, 'temperatureC', 'us');
  const rain = comparisonVisualRows(result, 'precipitationMm', 'metric');
  assert.deepEqual(temp.map(({ id, color, number }) => ({ id, color, number })), rain.map(({ id, color, number }) => ({ id, color, number })));
  assert.equal(new Set(temp.map(row => row.color)).size, 5);
  assert.deepEqual(temp.map(row => row.mean), [14, null, null, null, null]);
  assert.deepEqual(rain.map(row => row.mean), [0, 1, 2, 3, 4]);
});
