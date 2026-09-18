import test from 'node:test';
import assert from 'node:assert/strict';
import { metricNumber, metricStatisticLabel, metricValue } from './metric-display';

test('shared metric definitions preserve conversions, missingness and display precision', () => {
  assert.equal(metricNumber('temperatureC', 0, 'us'), 32);
  assert.equal(metricValue('temperatureC', 0, 'us', 'compact'), '32°F');
  assert.equal(metricValue('temperatureC', 0, 'us', 'detail'), '32.0°F');
  assert.equal(metricValue('windSpeedMs', 10, 'metric', 'compact'), '36 km/h');
  assert.equal(metricValue('precipitationMm', 25.4, 'us', 'compact'), '1.00 in');
  assert.equal(metricValue('precipitationMm', 25.4, 'metric', 'detail'), '25.4 mm');
  assert.equal(metricValue('humidityPercent', null, 'us', 'detail', '—'), '—');
});

test('statistic labels make hourly probability and available-hour summaries explicit', () => {
  assert.equal(metricStatisticLabel('precipitationProbabilityPercent', 'maximum', 'day'), 'Highest hourly rain chance');
  assert.equal(metricStatisticLabel('temperatureC', 'mean'), 'Average air temperature over available hours');
});
