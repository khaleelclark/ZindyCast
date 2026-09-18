import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSeries, hourlyReadout, nearestChartHour } from './chart';
import { HourSchema } from '@zindycast/contracts';
function hour(time: string, temperatureC: number | null) {
  return HourSchema.parse({ time, temperatureC, apparentTemperatureC: temperatureC, humidityPercent: null, precipitationMm: null, precipitationProbability: null, windSpeedMs: null, windGustMs: null, windDirectionDeg: null, weatherCode: null, ordinaryWetBulbC: null });
}
test('chart breaks missing values/hours but keeps repeated local DST hours in chronological order', () => {
  const values = [hour('2026-11-01T08:00:00Z', 0), hour('2026-11-01T09:00:00Z', 1), hour('2026-11-01T10:00:00Z', null), hour('2026-11-01T11:00:00Z', 3), hour('2026-11-01T13:00:00Z', 5)];
  assert.deepEqual(chartSeries(values, 'temperatureC').map(s => s.map(p => p.value)), [[0, 1], [3], [5]]);
  assert.deepEqual(chartSeries([hour('2026-11-01T08:00:00Z', null)], 'apparentTemperatureC'), []);
});

test('chart renders accessible SVG and meaningful missing-data text', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { HourlyChart } = await import('./chart');
  const html = renderToStaticMarkup(createElement(HourlyChart, { hours: [hour('2026-11-01T08:00:00Z', 0)], units: 'us', zone: 'America/Los_Angeles' }));
  assert.match(html, /data-weather-chart/); assert.match(html, /Hourly temperatures/); assert.match(html, /Temp 32.0°F/); assert.match(html, /Feels like 32.0°F/); assert.match(html, /Hourly forecast table/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  const missing = renderToStaticMarkup(createElement(HourlyChart, { hours: [], units: 'metric', zone: 'UTC' }));
  assert.match(missing, /no temperature values/); assert.doesNotMatch(missing, /<svg/);
});

 test('exact readouts retain zero, independent missing values, units and DST timezone', () => {
  const first = hour('2026-11-01T08:00:00Z', 0);
  first.apparentTemperatureC = 1.25;
  assert.match(hourlyReadout(first, 'us', 'America/Los_Angeles'), /1:00 AM PDT · Temp 32.0°F · Feels like 34.3°F/);
  assert.match(hourlyReadout(first, 'metric', 'America/Los_Angeles'), /Temp 0.0°C · Feels like 1.3°C/);
  const second = hour('2026-11-01T09:00:00Z', null);
  second.apparentTemperatureC = -2;
  assert.match(hourlyReadout(second, 'us', 'America/Los_Angeles'), /1:00 AM PST · Temp Unavailable · Feels like 28.4°F/);
  assert.match(hourlyReadout(hour(second.time, null), 'metric', 'UTC'), /Temp Unavailable · Feels like Unavailable/);
  assert.equal(nearestChartHour([first, second], Date.parse(second.time) - 100), 1);
  assert.equal(nearestChartHour([first, second], Date.parse(first.time) - 3600000), 0);
 });
