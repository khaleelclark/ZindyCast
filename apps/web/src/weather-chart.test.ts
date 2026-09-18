import test from 'node:test';
import assert from 'node:assert/strict';
import { exactChartValue, fillChartGaps, weatherChartReadout } from './weather-chart';
test('chart conversion keeps exact values and nulls, with distinct repeated DST instants', () => {
 const p = { time: Date.parse('2026-11-01T08:00:00Z'), values: [0, 1.25] };
 assert.match(weatherChartReadout(p, ['Temp', 'Feels like'], 'us', 'America/Los_Angeles'), /1:00 AM PDT · Temp 32.0°F · Feels like 34.3°F/);
 assert.match(weatherChartReadout({...p,time:p.time+3600000,values:[null,-2]}, ['Temp', 'Feels like'], 'metric', 'America/Los_Angeles'), /1:00 AM PST · Temp Unavailable · Feels like -2.0°C/);
 assert.equal(exactChartValue(null,'us'),'Unavailable'); assert.equal(exactChartValue(0,'metric'),'0.0°C');
});
test('missing intervals and independent nulls remain gaps without invented measurements', () => {
 const points = [{time:0,values:[0,null]}, {time:7200000,values:[null,3]}];
 assert.deepEqual(fillChartGaps(points), [points[0], {time:3600000,values:[null,null]},points[1]]);
 assert.deepEqual(fillChartGaps([]),[]);
});
