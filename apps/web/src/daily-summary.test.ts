import test from 'node:test';
import assert from 'node:assert/strict';
import type { Forecast, Hour } from '@zindycast/contracts';
import { dailyPlanningSummary } from './weather';

const base = { temperatureC: 20, apparentTemperatureC: 20, humidityPercent: 50, precipitationMm: 0, precipitationProbability: 10, windSpeedMs: 2, windGustMs: 3, windDirectionDeg: 180, weatherCode: 2, ordinaryWetBulbC: null, dewPointC: 10, surfacePressureHpa: 1012, cloudCoverPercent: 20, visibilityM: 10000, uvIndex: 2 };
const hours = Array.from({ length: 48 }, (_, index) => ({ ...base, time: new Date(Date.parse('2026-07-15T07:00:00Z') + index * 3_600_000).toISOString(), precipitationProbability: index === 12 ? 70 : 10 } as Hour));
const forecast = { location: { id: 'austin', name: 'Austin', country: 'US', latitude: 30.27, longitude: -97.74, timezone: 'America/Chicago' }, hours, astronomy: [], intervalSemantics: 'instant meteorology; precipitation and probability preceding hour; gust preceding-hour maximum', missingFields: [], provenance: { provider: 'fixture', dataset: 'fixture', classification: 'modeled', retrievedAt: hours[0]!.time, sourceIssuedAt: null, sourceCoordinates: { latitude: 30.27, longitude: -97.74 }, attribution: 'fixture' } } as Forecast;

test('daily planning summary states an hourly maximum and only a broad daypart', () => {
  const result = dailyPlanningSummary(forecast, Date.parse('2026-07-15T13:15:00Z'));
  assert.equal(result[0]?.label, 'Today');
  assert.equal(result[0]?.rainChance, 70);
  assert.equal(result[0]?.rainPeriod, 'this afternoon');
  assert.equal(result[1]?.label, 'Tomorrow');
  assert.equal(result[1]?.rainChance, 10);
  assert.equal(result[1]?.rainPeriod, 'early tomorrow');
});

test('zero and missing probability do not invent a likely rain period', () => {
  const dry = { ...forecast, hours: hours.map(hour => ({ ...hour, precipitationProbability: 0 })) };
  assert.equal(dailyPlanningSummary(dry, Date.parse('2026-07-15T13:15:00Z'))[0]?.rainPeriod, null);
});
