import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Hour } from '@zindycast/contracts';
import { HeatContext, WindCompass, wetBulbRange } from './dashboard-visuals';
test('wet-bulb numerical range preserves missingness, zero and constant values without risk categories', () => {
 const hours = [null, 0, 0].map(ordinaryWetBulbC => ({ ordinaryWetBulbC }) as Hour);
 assert.deepEqual(wetBulbRange(hours), { low: 0, high: 0, count: 2 });
 assert.equal(wetBulbRange([hours[0]!]), null);
 const html = renderToStaticMarkup(React.createElement(HeatContext, { hours, hour: hours[1], units: 'us', now: 0, zone: 'UTC', online: true, freshness: 'fresh', aged: false }));
 assert.doesNotMatch(html, /Ordinary wet-bulb|WBGT inputs|numerical-track/);
 assert.match(html, /No eligible hourly WBGT estimate/);
});
test('wind compass retains from-direction and distinguishes missing direction from north and zero speed', () => {
 const north = renderToStaticMarkup(React.createElement(WindCompass, { direction: 0, wind: 0, units: 'us' }));
 assert.match(north, /Wind from 0 degrees north/); assert.match(north, /0 mph/);
 const missing = renderToStaticMarkup(React.createElement(WindCompass, { direction: null, wind: null, units: 'metric' }));
 assert.match(missing, /Wind direction unavailable/); assert.doesNotMatch(missing, /rotate\(/);
});

test('hour strip renders moon at night and zone-qualified times', async () => {
 const { HourlyStrip } = await import('./dashboard-visuals');
 const html = renderToStaticMarkup(React.createElement(HourlyStrip,{hours:[{time:'2026-11-01T09:00:00Z',weatherCode:0,isDay:0,temperatureC:20,apparentTemperatureC:25,precipitationProbability:0} as Hour],units:'metric',zone:'America/Los_Angeles'}));
 assert.match(html,/data-weather-icon="clear-night"/); assert.doesNotMatch(html,/data-weather-icon="clear-day"/); assert.match(html,/PST/); assert.match(html, /<b>20°<\/b>/); assert.match(html, /Feels 25°/); assert.match(html, /0%/); assert.match(html, /Rain chance/);
});
