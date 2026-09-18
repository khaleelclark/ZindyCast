import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ForecastSchema, type Location} from '@zindycast/contracts';
import {readFileSync} from 'node:fs';
import {ObservationsResponseSchema, observationFields, observationDistanceKm, observationQualityMeanings, type ObservationQualityControl} from '../../../packages/contracts/src/observations';
import {acceptedObservationValue, parseObservedResponse, selectObservedCurrent, CURRENT_STATION_MAX_AGE_MS} from './observed-current';
import {CurrentOverview} from './current-overview';
const now=Date.parse('2026-09-12T20:15:00.000Z');
const location:Location={id:'fixture',name:'Fixture Osteen',latitude:28.846,longitude:-81.162,country:'US',timezone:'America/New_York'};
function fixture(){
 const point={latitude:28.78,longitude:-81.24};
 const values={temperatureC:(88-32)*5/9,dewPointC:21.5,humidityPercent:58,windSpeedMs:6.25,windGustMs:9.8,windDirectionDeg:43,barometricPressurePa:101800,visibilityM:16093.44,precipitationLastHourMm:0};
 const time=new Date(now-20*60000).toISOString();
 return ObservationsResponseSchema.parse({status:'success',freshness:'fresh',data:{query:{latitude:location.latitude,longitude:location.longitude,since:new Date(now-10800000).toISOString(),until:new Date(now).toISOString(),stationLimit:3},stations:[{stationId:'KSFB',name:'Fixture Sanford',coordinates:point,elevationM:16,distanceKm:observationDistanceKm(location,point),sourceUrl:'https://api.weather.gov/stations/KSFB',latestObservationTime:time,observations:[{sourceId:`https://api.weather.gov/stations/KSFB/observations/${encodeURIComponent(time)}`,time,textDescription:'Mostly Cloudy',measurements:Object.fromEntries(observationFields.map(([,key])=>[key,{value:values[key],qualityControl:'V',qualityMeaning:observationQualityMeanings.V}])),missingFields:[]}]}],candidateCount:1,candidateSetTruncated:false,provider:'NWS',dataset:'NWS API station observations (MADIS ingest)',classification:'observed',retrievedAt:new Date(now).toISOString(),stationListSourceUrl:'https://api.weather.gov/gridpoints/MLB/26,68/stations?limit=5',selectionPolicy:'distance-ranked candidates only; no automatic representativeness selection',stationContinuity:'observations remain grouped by station; no cross-station splice',intervalSemantics:'station instants; precipitationLastHourMm is the reported preceding-hour accumulation ending at observation time',units:Object.fromEntries(observationFields.map(([,key,unit])=>[key,unit])),qualityControlSourceUrl:'https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml',attribution:'Fixture NWS'}});
}
test('selects one nearby quality-checked report and calculates feels like from its own inputs',()=>{
 const r=fixture(),v=selectObservedCurrent(parseObservedResponse(r,location),location,now)!;
 assert.equal(v.station.stationId,'KSFB');assert.equal(v.temperatureC,(88-32)*5/9);
 assert.equal(v.feelsLike.method,'heat-index');assert.ok(Math.abs(v.feelsLike.valueC!*1.8+32-95)<1);
 assert.equal(acceptedObservationValue(v.observation,'precipitationLastHourMm'),0);
});
test('rejects stale, future, old, distant, and wrong-city readings',()=>{
 for(const mutate of [(r:ReturnType<typeof fixture>)=>r.freshness='stale',(r:ReturnType<typeof fixture>)=>r.data.retrievedAt=new Date(now+1001).toISOString(),(r:ReturnType<typeof fixture>)=>r.data.retrievedAt=new Date(now-600001).toISOString(),(r:ReturnType<typeof fixture>)=>r.data.query.until=new Date(now-600001).toISOString(),(r:ReturnType<typeof fixture>)=>r.data.query.latitude=0,(r:ReturnType<typeof fixture>)=>r.data.stations[0]!.distanceKm=25.001,(r:ReturnType<typeof fixture>)=>r.data.stations[0]!.observations[0]!.time=new Date(now-CURRENT_STATION_MAX_AGE_MS-1).toISOString(),(r:ReturnType<typeof fixture>)=>r.data.stations[0]!.observations[0]!.time=new Date(now+1).toISOString()]){
  const r=fixture();mutate(r);assert.equal(selectObservedCurrent(r,location,now),null);
 }
 assert.throws(()=>parseObservedResponse(fixture(),{...location,longitude:0}),/do not match/);
});
test('does not fill rejected or missing station measurements from another record/station/model',()=>{
 const r=fixture(),o=r.data.stations[0]!.observations[0]!;
 for(const quality of ['Z','X','Q','B',null] as const){o.measurements.humidityPercent.qualityControl=quality;assert.equal(selectObservedCurrent(r,location,now)!.feelsLike.valueC,null);}
 o.measurements.humidityPercent.qualityControl='V';o.measurements.humidityPercent.value=101;
 assert.equal(selectObservedCurrent(r,location,now)!.humidityPercent,null);
 for(const quality of ['Z','X','Q','B',null] as const){o.measurements.temperatureC.qualityControl=quality;assert.equal(selectObservedCurrent(r,location,now),null);}
 o.measurements.temperatureC.qualityControl='T';assert.ok(selectObservedCurrent(r,location,now));
 o.measurements.windSpeedMs.qualityControl='T';assert.equal(acceptedObservationValue(o,'windSpeedMs'),null);
 for(const quality of ['C','S','V','G'] as ObservationQualityControl[]){o.measurements.temperatureC.qualityControl=quality;assert.ok(selectObservedCurrent(r,location,now));}
});
test('uses next nearby eligible station without splicing and excludes older reports from rejected latest',()=>{
 const r=fixture(),first=r.data.stations[0]!,next=structuredClone(first);next.stationId='SECOND';next.distanceKm=15;next.observations[0]!.measurements.temperatureC.value=20;
 first.observations.push(structuredClone(first.observations[0]!));first.observations[0]!.measurements.temperatureC.qualityControl='Q';r.data.stations.push(next);
 assert.equal(selectObservedCurrent(r,location,now)!.station.stationId,'SECOND');
 assert.equal(selectObservedCurrent(r,location,now)!.temperatureC,20);
});
test('headline remains available without forecast; model details cannot masquerade as observed values',()=>{
 const r=fixture(),observed=selectObservedCurrent(r,location,now)!;
 const forecast=ForecastSchema.parse(JSON.parse(readFileSync('docs/verification/current-hour-jump/forecast.json','utf8')).data);
 forecast.current={time:new Date(now).toISOString(),intervalSeconds:900,temperatureC:28.333,apparentTemperatureC:29.722,humidityPercent:64,windSpeedMs:6.25,windDirectionDeg:43,weatherCode:0,isDay:1,cloudCoverPercent:4};
 const props={forecast,observed,units:'us' as const,zone:location.timezone,now,fresh:true,busy:false,stationBusy:false,refresh:()=>{}};
 const html=renderToStaticMarkup(React.createElement(CurrentOverview,props));
 assert.match(html,/Nearby station/);assert.match(html,/Fixture Sanford/);assert.match(html,/Mostly Cloudy/);assert.match(html,/94\.3°F/);assert.doesNotMatch(html,/85\.5°F|Clear sky|Today’s hourly feels-like range/);
 assert.match(html,/Heat index/);assert.match(html,/Forecast extras/);assert.match(html,/data-current-source="station"/);
 assert.match(renderToStaticMarkup(React.createElement(CurrentOverview,{...props,forecast:undefined})),/94\.3°F/);
 const missing=structuredClone(observed);missing.feelsLike={valueC:null,method:'unavailable'};missing.observation.measurements.dewPointC.value=null;
 const unavailable=renderToStaticMarkup(React.createElement(CurrentOverview,{...props,observed:missing}));assert.match(unavailable,/Feels like unavailable/);assert.doesNotMatch(unavailable,/85\.5°F/);
 const fallback=renderToStaticMarkup(React.createElement(CurrentOverview,{...props,observed:null}));assert.match(fallback,/Model estimate/);assert.match(fallback,/No recent nearby station/);assert.match(fallback,/data-current-source="model"/);
 const failed=renderToStaticMarkup(React.createElement(CurrentOverview,{...props,observed:null,stationError:'Fixture failure'}));assert.match(failed,/Station service unavailable/);assert.doesNotMatch(failed,/No recent nearby station/);
});
