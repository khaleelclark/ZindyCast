import { hasDailyTemperatureRange } from './metric-display';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { climateNumber, climateValue, climateHeadline, climateDrillWindow } from './climate-results';
import type { ClimateMetricSummary, ClimateSummary, ClimateQuery } from '../../../packages/contracts/src/climate-comparison';
test('converts temperature, wet bulb, wind, precipitation and seconds once; zero and null remain distinct', () => {
  assert.equal(climateNumber('temperatureC', -40, 'us'), -40);
  assert.equal(climateNumber('wetBulbTemperatureC', 0, 'us'), 32);
  assert.equal(climateNumber('dewPointC', -10, 'metric'), -10);
  assert.equal(climateNumber('precipitationMm', 25.4, 'us'), 1);
  assert.ok(Math.abs(climateNumber('windSpeedMs', 1609.344 / 3600, 'us')! - 1) < 1e-12);
  assert.equal(climateNumber('windSpeedMs', 10, 'metric'), 36);
  assert.equal(climateNumber('sunshineDurationSeconds', 7200, 'us'), 2);
  assert.equal(climateValue('sunshineDurationSeconds', 0, 'metric'), '0.0 h');
  assert.equal(climateValue('humidityPercent', 0, 'us'), '0.0 %');
  assert.equal(climateValue('cloudCoverPercent', null, 'us'), 'Unavailable');
});
test('partial/no-data headlines cannot expose available values as full coverage', () => {
  for (const status of ['partial', 'no_data'] as const) {
    const m = { status, mean: 10, total: 40, avgDailyHigh: 20 } as ClimateMetricSummary;
    assert.equal(climateHeadline(m), null); assert.equal(climateHeadline(m, 'total'), null); assert.equal(climateHeadline(m, 'avgDailyHigh'), null);
  }
  assert.equal(climateHeadline(undefined), null);
  assert.equal(climateHeadline({ status: 'complete', mean: 0 } as ClimateMetricSummary), 0);
});
test('climatology requires explicit valid year, clips leap month and never drills multi-year overview', () => {
  const query = { startDate: '2019-01-01', endDate: '2023-12-31' } as ClimateQuery;
  const month = { startDate: '2019-02-01', endDate: '2023-02-28', years: [2019, 2020, 2021, 2022, 2023] } as ClimateSummary;
  assert.equal(climateDrillWindow(month, 'climatology', '', query), null);
  assert.equal(climateDrillWindow(month, 'climatology', '2018', query), null);
  assert.deepEqual(climateDrillWindow(month, 'climatology', '2020', query), ['2020-02-01', '2020-02-29']);
  assert.deepEqual(climateDrillWindow(month, 'climatology', '2021', query), ['2021-02-01', '2021-02-28']);
  assert.equal(climateDrillWindow(month, 'period', '', query), null);
});
test('period drilling respects partial months and maximum 31 local days', () => {
  const query = { startDate: '2024-01-15', endDate: '2024-03-15' } as ClimateQuery;
  assert.deepEqual(climateDrillWindow({ startDate: '2024-01-01', endDate: '2024-01-31' } as ClimateSummary, 'period', '', query), ['2024-01-15', '2024-01-31']);
  assert.equal(climateDrillWindow({ startDate: '2024-01-15', endDate: '2024-02-15' } as ClimateSummary, 'period', '', query), null);
  assert.equal(climateDrillWindow(undefined, 'period', '', query), null);
});

test('daily high/low summaries apply only to temperature metrics', () => {
  for (const field of ['temperatureC','dewPointC','wetBulbTemperatureC'] as const) assert.equal(hasDailyTemperatureRange(field), true);
  for (const field of ['humidityPercent','windSpeedMs','cloudCoverPercent','precipitationMm','sunshineDurationSeconds'] as const) assert.equal(hasDailyTemperatureRange(field), false);
});
