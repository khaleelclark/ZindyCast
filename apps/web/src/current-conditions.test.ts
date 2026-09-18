import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ForecastSchema } from '@zindycast/contracts';
import { eligibleCurrent } from './current-conditions';
test('current estimate keeps its own instant and rejects old/future/unfresh data',()=>{
 const data=ForecastSchema.parse(JSON.parse(readFileSync('docs/verification/current-hour-jump/forecast.json','utf8')).data);
 const now=Date.parse('2026-09-12T20:15:00Z');data.current={time:new Date(now-300000).toISOString(),intervalSeconds:900,temperatureC:25,apparentTemperatureC:28,humidityPercent:80,windSpeedMs:3,windDirectionDeg:90,weatherCode:3,isDay:1,cloudCoverPercent:100};
 assert.equal(eligibleCurrent(data,now,true),data.current);assert.equal(eligibleCurrent(data,now,false),undefined);
 assert.equal(eligibleCurrent(data,now+1500000,true),undefined);assert.equal(eligibleCurrent(data,now-300001,true),undefined);
 assert.equal(data.hours.find(h=>h.time===data.current!.time),undefined);
 delete data.current;assert.equal(eligibleCurrent(data,now,true),undefined);
});
