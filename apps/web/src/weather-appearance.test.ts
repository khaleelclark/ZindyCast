import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Hour} from '@zindycast/contracts';
import {WeatherBackdrop,WeatherIcon,weatherKind,weatherAtmosphere} from './weather-appearance';
test('WMO weather icons distinguish precipitation, freezing, fog, snow and hail; unknown remains neutral',()=>{
 for(const [code,kind] of [[0,'clear'],[2,'partly-cloudy'],[3,'cloudy'],[45,'fog'],[48,'fog'],[55,'drizzle'],[56,'freezing-rain'],[67,'freezing-rain'],[65,'rain'],[82,'rain'],[77,'snow'],[86,'snow'],[95,'storm'],[99,'hail'],[4,'unknown'],[null,'unknown']] as const)assert.equal(weatherKind(code),kind);
 for(const isDay of [0,1,null] as const){const html=renderToStaticMarkup(React.createElement(WeatherIcon,{code:0,isDay}));assert.match(html,new RegExp(`data-weather-icon="clear-${isDay===0?'night':isDay===1?'day':'unknown'}"`));assert.match(html,/role="img"/);}
});
test('weather theme uses supplied daylight and requires fresh current weather',()=>{
 const h={weatherCode:0,isDay:0} as Hour;
 assert.equal(weatherAtmosphere(h,true),'night');assert.equal(weatherAtmosphere({...h,isDay:1},true),'sunny');assert.equal(weatherAtmosphere({...h,isDay:null},true),'neutral');
 assert.equal(weatherAtmosphere(h,false),'neutral');assert.equal(weatherAtmosphere(undefined,true),'neutral');
 for(const [code,theme] of [[65,'rain'],[75,'snow'],[95,'storm'],[45,'fog'],[3,'cloudy']] as const)assert.equal(weatherAtmosphere({...h,weatherCode:code},true),theme);
});

test('decorative scene renders deterministically without interactive or network elements',()=>{
 const render=()=>renderToStaticMarkup(React.createElement(WeatherBackdrop));
 const html=render();assert.equal(html,render());assert.match(html,/aria-hidden="true"/);
 assert.match(html,/data-paused="false"/);assert.match(html,/scene-moon/);assert.match(html,/scene-rainfall/);
 assert.doesNotMatch(html,/<(?:image|img|iframe|button)|tabindex|https?:|<span/);
});
test('all recognized weather scenes clear when current conditions are stale or missing',()=>{
 for(const code of [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]) {
  const hour={weatherCode:code,isDay:1} as Hour;
  assert.notEqual(weatherAtmosphere(hour,true),'neutral');assert.equal(weatherAtmosphere(hour,false),'neutral');
 }
 assert.equal(weatherAtmosphere({weatherCode:999,isDay:1} as Hour,true),'neutral');
});

import {observedWeatherKind,weatherKindAtmosphere} from './weather-appearance';
test('observed sky decoration follows station descriptions independently of daylight',()=>{
 for(const [description,expected] of [['Light Rain','rain'],['Mostly Cloudy','cloudy'],['Partly Cloudy','partly-cloudy'],['Clear','clear'],['Mostly Clear','partly-cloudy'],['Thunderstorm','storm'],['Freezing Rain','freezing-rain'],['Light Snow','snow'],['Fog','fog'],['','unknown']] as const)assert.equal(observedWeatherKind(description),expected);
 assert.equal(weatherKindAtmosphere(observedWeatherKind('Clear'),0),'night');
 assert.equal(weatherKindAtmosphere(observedWeatherKind('Light Rain'),0),'rain');
});
