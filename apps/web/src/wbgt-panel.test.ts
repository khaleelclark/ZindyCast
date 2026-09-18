import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HourSchema, WbgtEstimateSchema, type Hour } from '@zindycast/contracts';
import { WbgtPanel, wbgtSeries, wbgtValue, type WbgtPanelProps } from './wbgt-panel';
const now = Date.parse('2026-09-11T12:30:00Z');
function hour(valueC: number | null, time = '2026-09-11T12:00:00Z'): Hour {
 const component = { status: 'success', temperatureC: 30, iterations: 2 };
 const wbgt = WbgtEstimateSchema.parse({ status: valueC == null ? 'unavailable' : 'success', valueC, reason: valueC == null ? 'Missing instant radiation' : null, policyVersion: 'liljegren-1.1-zindy-ts-1+fao56-eq47-10m+om-instant-v1', exposure: 'modeled_outdoor_short_grass_reference', wind10mMs: 0, wind2mMs: 0, radiationDerivation: 'provider_instant_derived_from_preceding_hour_mean', diagnostics: valueC == null ? null : { calculationVersion: 'test', referenceRevision: 'test', input: { time, latitude: 36, longitude: -96, temperatureC: 30, humidityPercent: 50, surfacePressureHpa: 1000, wind2mMs: 0, ghiWm2: 0, windAssumption: 'test', radiationAssumption: 'instantaneous', source: 'Synthetic test only' }, windUsedMs: .13, windFloored: true, ghiUsedWm2: 0, ghiCapped: false, cosineSolarZenith: 0, directFraction: 0, warnings: [], globe: component, naturalWetBulb: component, psychrometricWetBulb: component } });
 return HourSchema.parse({ time, wbgt, temperatureC: 30, apparentTemperatureC: 40, ordinaryWetBulbC: 99, humidityPercent: 50, dewPointC: null, precipitationMm: null, precipitationProbability: null, windSpeedMs: null, windGustMs: null, windDirectionDeg: null, cloudCoverPercent: null, weatherCode: null, surfacePressureHpa: null, visibilityM: null, uvIndex: null });
}
function render(h: Hour | undefined, extra: Partial<WbgtPanelProps> = {}) { return renderToStaticMarkup(React.createElement(WbgtPanel, { hour: h, hours: h ? [h] : [], now, zone: 'UTC', units: 'us', online: true, freshness: 'fresh', aged: false, ...extra })); }
test('WBGT marker requires successful co-timed eligible hour and fresh online state; never substitutes ordinary wet-bulb', () => {
 const h = hour(0);
 assert.match(render(h), /Current WBGT 32.0°F · reference band &lt;80°F/);
 for (const extra of [{ freshness: 'stale' as const }, { aged: true }, { online: false }, { now: Date.parse(h.time) + 3600000 }, { now: Date.parse(h.time) - 1 }]) assert.doesNotMatch(render(h, extra), /data-wbgt-current/);
 assert.doesNotMatch(render(hour(null)), /data-wbgt-current/);
 assert.match(render(hour(null)), /Missing instant radiation/);
 assert.doesNotMatch(render(undefined), /data-wbgt-current/);
 const mismatched = hour(30); mismatched.wbgt!.diagnostics!.input.time = '2026-09-11T11:00:00Z';
 assert.equal(wbgtValue(mismatched), null);
 const ordinary = hour(null); delete ordinary.wbgt;
 assert.doesNotMatch(render(ordinary), /data-wbgt-current|210.2/);
});
test('Tulsa exact endpoints retain ambiguity before display rounding and convert scale ticks', () => {
 for (const f of [80, 85, 88, 90]) {
  const h = hour((f - 32) * 5 / 9);
  assert.match(render(h), /At a reference boundary/);
  assert.match(render(h), new RegExp(`Current WBGT ${f}.0°F`));
  assert.match(render(h, { units: 'metric' }), /26.7/);
  assert.doesNotMatch(render(hour(h.wbgt!.valueC! + .0001)), /At a reference boundary/);
 }
});
test('visible 24-hour graph preserve real hour spacing, missing gaps, zero, bounds and accessible values', () => {
 const hours = [hour(0), hour(null, '2026-09-11T13:00:00Z'), hour(30, '2026-09-11T14:00:00Z'), hour(40, '2026-09-13T12:00:00Z')];
 const series = wbgtSeries(hours, now);
 assert.equal(series.length, 48); assert.deepEqual(series.slice(0, 3).map(p => p.value), [0, null, 30]);
 const html = render(hours[0], { hours });
 assert.match(html, /data-weather-chart/);
 assert.doesNotMatch(html, /Hourly heat|hourly-heat/);
 assert.match(html, /Heat over the next 24 hours · WBGT °F/);
 assert.match(html, /local time/);
 assert.match(html, /2\/24 values/); assert.doesNotMatch(html, /Hourly heat/);
 assert.match(render(hours[0], { hours, freshness: 'stale' }), /previously retrieved forecast/);
 assert.doesNotMatch(render(hours[0], { hours, online: false }), /<svg/);
});

test('heat precautions precede trend without the removed lower estimate', () => {
 const current=hour(30),future=hour(25,'2026-09-11T14:00:00Z');
 const html=render(current,{hours:[current,future]});
 assert.doesNotMatch(html,/Lower upcoming estimate|Green does not mean risk-free|Reference ticks in/);
 assert.ok(html.indexOf('Heat precautions')<html.indexOf('Heat over the next 24 hours'));
});

test('heat interaction controls and compact hourly list preserve endpoints, all slots and missingness without removed disclosures', () => {
 const html = render(hour(30));
 assert.match(html, /Equal band widths/); assert.match(html, /&lt;80/); assert.match(html, /&gt;90/);
 assert.match(render(hour(30), {units:'metric'}), /32.2/);
 assert.match(html, /WBGT 86.0°F/);
 assert.match(html, /Hover or tap for exact values/);
 assert.equal((html.match(/<dt>/g) ?? []).length,0);
 assert.doesNotMatch(html, /hourly-heat/);
 assert.doesNotMatch(html, /table-scroll|WBGT inputs|wbgt-diagnostics|Ordinary wet-bulb/);
});

test('heat graph point labels distinguish DST repeated hours', () => {
 const times = ['2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z'];
 const hours = times.map(t => hour(20,t));
 const html = render(hours[0], {hours,now:Date.parse(times[0]!),zone:'America/New_York'});
 assert.match(html,/EDT/); assert.equal(wbgtSeries(hours, Date.parse(times[0]!))[1]!.time, Date.parse(times[1]!));
 assert.doesNotMatch(html,/Hourly heat|hourly-heat/);
});

test('equal bands center every interior value and leave exact boundaries neutral', () => {
 for (const units of ['us','metric'] as const) {
  for (const [index,f] of [79,82,86,89,91].entries()) {
   const html = render(hour((f-32)*5/9), {units});
   assert.match(html, new RegExp(`data-wbgt-band="${index}"`));
   assert.match(html, new RegExp(`data-wbgt-current="true" style="left:${index*20+10}%"`));
   assert.equal((html.match(/width:20%/g) ?? []).length,5);
  }
  for (const [index,f] of [80,85,88,90].entries()) {
   const html=render(hour((f-32)*5/9),{units});
   assert.match(html,/data-wbgt-band="neutral"/);
   assert.match(html,new RegExp(`data-wbgt-current="true" style="left:${(index+1)*20}%"`));
   assert.match(html,/reference boundary; adjacent bands unresolved/);
  }
 }
 for (const h of [hour(null),undefined]) assert.match(render(h),/data-wbgt-band="neutral"/);
 assert.match(render(hour(40),{freshness:'stale'}),/data-wbgt-band="neutral"/);
 assert.match(render(hour(50)),/data-wbgt-current="true" style="left:90%"/);
});
