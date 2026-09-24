import test from 'node:test';
import assert from 'node:assert/strict';
import type { WetBulbTrackerRecord } from '@zindycast/contracts';
import { analyzeWetBulb } from './wet-bulb-analysis.js';

const record = (sourceValidTime: string, wbgtC: number, recordedAt = sourceValidTime): WetBulbTrackerRecord => ({
  recordedAt, sourceValidTime, retrievedAt: recordedAt, ordinaryWetBulbC: null, wbgtC,
  temperatureC: 30, dewPointC: 22, humidityPercent: 70, apparentTemperatureC: 34,
  windSpeedMs: 2, precipitationProbability: 20, weatherCode: 1, isDay: 1,
  provider: 'Open-Meteo', classification: 'modeled',
});

test('analysis counts updated half-hour captures of one source hour once and compares local daylight windows', () => {
  const records = [19, 20, 21].flatMap(day => [
    record(`2026-09-${day}T12:00:00.000Z`, 25), // 8 AM in Osteen
    record(`2026-09-${day}T20:00:00.000Z`, 30), // 4 PM in Osteen
  ]);
  records.push(record('2026-09-19T12:00:00.000Z', 26, '2026-09-19T12:30:00.000Z'));
  const result = analyzeWetBulb(records, 'America/New_York');
  assert.equal(result.sourceHours, 6);
  assert.equal(result.days, 3);
  assert.equal(result.lowestDaylight?.label, '8 AM–noon');
  assert.equal(result.lowestDaylight?.hours, 3);
  assert.equal(result.lowestDaylight?.wbgtC, 25 + 1 / 3);
  assert.equal(result.windows[4]?.wbgtC, 30);
});

test('a recurring daylight window needs three separate local dates', () => {
  const result = analyzeWetBulb([
    record('2026-09-19T12:00:00.000Z', 25),
    record('2026-09-19T13:00:00.000Z', 26),
    record('2026-09-20T12:00:00.000Z', 27),
  ], 'America/New_York');
  assert.equal(result.lowestDaylight, null);
  assert.equal(result.windows[2]?.days, 2);
  assert.equal(analyzeWetBulb([], 'America/New_York').p90C, null);
});
