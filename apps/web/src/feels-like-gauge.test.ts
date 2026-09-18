import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Hour } from '@zindycast/contracts';
import { FeelsLikeGauge, feelsPosition, todayFeelsRange, temperatureColor } from './feels-like-gauge';
const hour = (time: string, apparentTemperatureC: number | null) => ({ time, apparentTemperatureC }) as Hour;
test('positions actual values only; no fabricated position for stale, missing, equal or outside ranges', () => {
  assert.equal(feelsPosition(0, -10, 10, true), .5);
  for (const [value, low, high, fresh] of [[null,0,10,true],[0,null,10,true],[0,0,null,true],[0,0,0,true],[5,0,10,false],[0,10,0,true],[NaN,0,10,true],[-1,0,10,true],[11,0,10,true],[Infinity,0,10,true]] as const) assert.equal(feelsPosition(value,low,high,fresh),null);
  assert.equal(feelsPosition(-10,-10,10,true),0);assert.equal(feelsPosition(10,-10,10,true),1);
});
test('today range includes earlier hours, excludes adjacent local dates, and covers repeated DST hour', () => {
  const start = Date.parse('2026-11-01T07:00:00Z');
  const rows = Array.from({length:25},(_,i)=>hour(new Date(start+i*3600000).toISOString(), i===0 ? -10 : i===24 ? 10 : 0));
  assert.deepEqual(todayFeelsRange([hour('2026-11-01T06:00:00Z',-100),...rows,hour('2026-11-02T08:00:00Z',100)],start+15*3600000,'America/Los_Angeles'),{low:-10,high:10,partial:false});
  assert.equal(todayFeelsRange(rows.slice(1),start+15*3600000,'America/Los_Angeles').partial,true);
  rows[2]!.apparentTemperatureC=null;assert.equal(todayFeelsRange(rows,start,'America/Los_Angeles').partial,true);
  assert.deepEqual(todayFeelsRange([],start,'UTC'),{low:null,high:null,partial:true});
});
test('readable exact units and truthful neutral descriptions independent of SVG', () => {
 const render=(props:Partial<React.ComponentProps<typeof FeelsLikeGauge>>={})=>renderToStaticMarkup(React.createElement(FeelsLikeGauge,{valueC:0,lowC:-10,highC:10,units:'us',fresh:true,...props}));
 assert.match(render(),/32.0°F/);assert.match(render(),/14.0°F/);assert.match(render(),/50.0°F/);assert.match(render(),/data-gauge-marker/);
 assert.match(render({units:'metric'}),/0.0°C/);assert.match(render({units:'metric'}),/-10.0°C/);
 assert.doesNotMatch(render({fresh:false}),/data-gauge-marker/);assert.match(render({fresh:false}),/Previously retrieved/);
 assert.doesNotMatch(render({valueC:20}),/data-gauge-marker/);assert.match(render({valueC:20}),/Above daily forecast range/);
 assert.doesNotMatch(render({valueC:-20}),/data-gauge-marker/);assert.match(render({valueC:-20}),/Below daily forecast range/);
 assert.match(render({valueC:20,lowC:0,highC:0}),/Above daily forecast range/);
 assert.match(render({valueC:-20,lowC:0,highC:0}),/Below daily forecast range/);
 assert.match(render({lowC:0,highC:0}),/Same low and high/);assert.match(render({valueC:null}),/Unavailable/);
 assert.match(render({partial:true}),/available hours only \(partial\)/);
});

test('85.5°F uses the same temperature color at any daily-relative position', () => {
 const valueC=(85.5-32)*5/9;
 for (const [lowC,highC] of [[29,40],[20,30],[0,10]]) {
  const markup=renderToStaticMarkup(React.createElement(FeelsLikeGauge,{valueC,lowC,highC,units:'us',fresh:true}));
  assert.match(markup,/85.5°F/);
  assert.match(markup,/Daily forecast range/);
  assert.match(markup,/linearGradient/);
  assert.ok(markup.includes(`style="color:${temperatureColor(valueC)}"`));
 }
});

test('station mode uses fixed numeric endpoints independently of forecast range and coverage', () => {
 const render=(props:Partial<React.ComponentProps<typeof FeelsLikeGauge>>={})=>renderToStaticMarkup(React.createElement(FeelsLikeGauge,{valueC:10,lowC:null,highC:null,units:'us',fresh:true,partial:true,showForecastRange:false,...props}));
 assert.doesNotMatch(render(),/-40.0°F|140.0°F|feels-gauge-endpoints/);
 assert.match(render(),/Feels-like temperature/);assert.match(render(),/data-gauge-marker="true" cx="160"/);
 assert.doesNotMatch(render(),/forecast|partial|Feels-like low|Feels-like high/);
 assert.doesNotMatch(render({units:'metric'}),/-40.0°C|60.0°C/);
 assert.equal(render(),render({lowC:30,highC:40,partial:false}));
 for (const valueC of [-40,60]) assert.match(render({valueC}),/data-gauge-marker/);
 for (const [valueC,note] of [[-41,'Below'],[61,'Above']] as const) {
  assert.match(render({valueC}),new RegExp(`${note} display scale · position unavailable`));
  assert.doesNotMatch(render({valueC}),/data-gauge-marker/);
 }
 assert.match(render({valueC:61,units:'metric'}),/61.0°C/);
 assert.doesNotMatch(render({fresh:false}),/data-gauge-marker/);assert.match(render({fresh:false}),/Previously retrieved/);
 assert.doesNotMatch(render({valueC:null}),/data-gauge-marker/);assert.match(render({valueC:null}),/Unavailable/);
});

test('temperature colors are unit-independent and stale/missing gauges stay neutral', () => {
 const render=(fresh:boolean,valueC:number|null,units:'us'|'metric')=>renderToStaticMarkup(React.createElement(FeelsLikeGauge,{valueC,lowC:null,highC:null,units,fresh,showForecastRange:false}));
 assert.ok(render(true,30,'us').includes(`style="color:${temperatureColor(30)}"`));
 assert.ok(render(true,30,'metric').includes(`style="color:${temperatureColor(30)}"`));
 assert.notEqual(temperatureColor(0),temperatureColor(30));
 assert.doesNotMatch(render(false,30,'us'),/linearGradient|style="color:/);
 assert.doesNotMatch(render(true,null,'us'),/linearGradient|style="color:/);
});
