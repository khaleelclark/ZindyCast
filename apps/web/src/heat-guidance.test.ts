import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HeatGuidance,HeatBandStatus} from './heat-guidance';
const c = (f:number)=>(f-32)*5/9;
test('Tulsa effects preserve source limits and missing/boundary status without a safe category',()=>{
 const html=renderToStaticMarkup(React.createElement(HeatGuidance,{valueC:c(86),units:"us"}));
 assert.match(html,/Effects on body/);
 assert.deepEqual([...html.matchAll(/source reference: (\d+) min/g)].map(match=>Number(match[1])),[45,30,20,15]);
 assert.match(html,/not safe exposure limits or personal predictions/);
 assert.match(html,/No effect specified by the source; this does not mean no risk/);
 assert.match(html,/does not assign specific symptoms to each band/);
 assert.doesNotMatch(html,/Breaks each hour|\d+ minutes|heat exhaustion|heat stroke|cramps/i);
 assert.match(html,/weather.gov\/tsa\/wbgt/);
 assert.equal((html.match(/aria-current="true"/g)??[]).length,1);
 assert.match(html,/85–88°F<small>Current band/);
 for(const valueC of [null,c(80),c(85),c(88),c(90)])assert.doesNotMatch(renderToStaticMarkup(React.createElement(HeatGuidance,{valueC:valueC,units:"us"})),/aria-current/);
 assert.equal(renderToStaticMarkup(React.createElement(HeatBandStatus,{valueC:null,units:"us"})),'');
 assert.match(renderToStaticMarkup(React.createElement(HeatBandStatus,{valueC:c(85),units:"us"})),/reference boundary/);
 assert.match(renderToStaticMarkup(React.createElement(HeatGuidance,{valueC:c(86),units:"metric"})),/29.4–31.1°C/);
});
test('effects keep all five source bands selectable in either unit system',()=>{
 for(const units of ['us','metric'] as const)for(const f of [79,82,86,89,91]){
  const html=renderToStaticMarkup(React.createElement(HeatGuidance,{valueC:c(f),units}));
  assert.equal((html.match(/aria-current="true"/g)??[]).length,1);
  assert.equal((html.match(/<td>/g)??[]).length,5);
 }
});
