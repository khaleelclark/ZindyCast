import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Location } from '@zindycast/contracts';
import { climateSelection, climateLocation, sameClimateQuery, parseClimateJob, climateDrillSelection, parseClimateDetail, climateJobKey, climatePreset } from './climate-panel';
import { summarizeClimateDays, createClimatePlan, aggregateClimate } from '../../../packages/comparison/src/climate';
const now = Date.parse('2026-09-13T12:00:00Z');
const places: Location[] = [
  {id:'geo-a',name:'East',country:'US',latitude:40,longitude:-74,timezone:'America/New_York'},
  {id:'geo-b',name:'West',country:'US',latitude:21,longitude:-157,timezone:'Pacific/Honolulu'},
];
const query = climateSelection(places,'2024-01-01','2024-01-31','period',now);
const id='00000000-0000-0000-0000-000000000001';
const queued = () => ({id,query,state:'queued',progress:0,attempt:0,createdAt:now,expiresAt:now+3600000,error:null,result:null});
test('climate controls bind normalized coordinates and timezone; dates and full-year bounds are strict',()=>{
 assert.equal(climateLocation(places[0]!).id,'40,-74');
 assert.equal(query.locations[0]!.timezone,'America/New_York');
 assert.doesNotThrow(()=>climateSelection(places,'2024-01-01','2024-12-31','period',now));
 assert.doesNotThrow(()=>climateSelection(places,'2020-01-01','2024-12-31','climatology',now));
 for(const [start,end,mode] of [['2024-01-01','2025-01-01','period'],['2024-02-30','2024-03-01','period'],['2024-01-01','2024-12-31','climatology'],['2019-01-01','2024-12-31','climatology'],['2020-02-01','2024-12-31','climatology'],['2026-09-08','2026-09-08','period']] as const) assert.throws(()=>climateSelection(places,start,end,mode,now));
 assert.throws(()=>climateSelection([places[0]!,places[0]!],'2024-01-01','2024-01-01','period',now));
 assert.throws(()=>climateSelection([{...places[0]!,timezone:'Bad/Zone'},places[1]!],'2024-01-01','2024-01-01','period',now));
 assert.equal(sameClimateQuery(query,{...query,mode:'climatology'}),false);
 assert.equal(sameClimateQuery(query,{...query,locations:[...query.locations].reverse()}),false);
 assert.equal(climateJobKey,'zindycast.climate-job.v2');
});
test('quick periods are inclusive and never imply a 30-year climate normal',()=>{
 assert.deepEqual(climatePreset('last-30-days','2026-09-08'),{mode:'period',startDate:'2026-08-10',endDate:'2026-09-08'});
 assert.deepEqual(climatePreset('last-complete-year','2026-09-08'),{mode:'period',startDate:'2025-01-01',endDate:'2025-12-31'});
 assert.deepEqual(climatePreset('recent-two-years','2026-09-08'),{mode:'climatology',firstYear:'2024',lastYear:'2025'});
});
test('job response rejects wrong identity, changed timezone, invalid expiry and completed without result',()=>{
 assert.equal(parseClimateJob(queued(),query,id).state,'queued');
 for(const update of [{id:'wrong'},{expiresAt:now},{createdAt:NaN},{state:'completed'},{query:{...query,endDate:'2024-01-30'}},{query:{...query,locations:query.locations.map(l=>({...l,timezone:'UTC'}))}}]) assert.throws(()=>parseClimateJob({...queued(),...update},query,id));
 assert.throws(()=>parseClimateJob(queued(),query,'00000000-0000-0000-0000-000000000002'));
});
test('detail selection accepts a month, rejects spillovers, invalid dates and unknown cities',()=>{
 assert.equal(climateDrillSelection(query,query.locations[0]!.id,'2024-01-01','2024-01-31').location.timezone,'America/New_York');
 for(const [city,start,end] of [['unknown','2024-01-01','2024-01-01'],[query.locations[0]!.id,'2023-12-31','2024-01-01'],[query.locations[0]!.id,'2024-01-01','2024-02-01'],[query.locations[0]!.id,'2024-01-03','2024-01-02'],[query.locations[0]!.id,'2024-01-00','2024-01-01']]) assert.throws(()=>climateDrillSelection(query,city!,start!,end!));
});
test('detail validates location/calendar and rejects unordered or out-of-window hourly values',()=>{
 const selection=climateDrillSelection(query,query.locations[0]!.id,'2024-01-01','2024-01-01');
 const days=summarizeClimateDays([],selection.location.timezone,selection.startDate,selection.endDate);
 const detail={status:'success',...selection,days,hours:[],sources:[]};
 assert.equal(parseClimateDetail(detail,selection).days.length,1);
 for(const changed of [{location:{...selection.location,timezone:'UTC'}},{startDate:'2024-01-02'},{days:[{...days[0]!,timezone:'UTC'}]},{days:[days[0],days[0]]}]) assert.throws(()=>parseClimateDetail({...detail,...changed},selection));
});

import { comparisonWeatherFieldNames, comparisonWeatherRequestUrl, type ComparisonWeatherHour, type ComparisonWeatherData } from '../../../packages/contracts/src/comparison-weather';
const HOUR=3600000;
function row(time: number, patch: Partial<ComparisonWeatherHour> = {}): ComparisonWeatherHour {
  const h: ComparisonWeatherHour = {time:new Date(time).toISOString(), temperatureC:10, dewPointC:5, wetBulbTemperatureC:7, humidityPercent:50,windSpeedMs:2,precipitationMm:0,sunshineDurationSeconds:0,cloudCoverPercent:5,weatherCode:0,sourceHourPresent:true,missingFields:[], ...patch};
  h.missingFields = comparisonWeatherFieldNames.filter(f=>h[f]===null);
  return h;
}
function rows(start: string, count: number, value?: (time:number,i:number)=>Partial<ComparisonWeatherHour>) {
  return Array.from({length:count},(_,i)=>{const time=Date.parse(start)+i*HOUR;return row(time,value?.(time,i));});
}
function fixtures(plan: ReturnType<typeof createClimatePlan>, value?: (time:number,locationId:string)=>Partial<ComparisonWeatherHour>) {
  return plan.chunks.map(c=>{
    const n=(Date.parse(c.query.endDate)-Date.parse(c.query.startDate))/HOUR+24;
    const hours=rows(c.query.startDate,n,time=>value?.(time,c.locationId)??{});
    const sourceHours=hours.filter(h=>h.sourceHourPresent).length, completeHours=hours.filter(h=>h.missingFields.length===0).length;
    const data: ComparisonWeatherData = { query:c.query,timezone:'UTC',hours,
      provenance:{provider:'Open-Meteo',dataset:'ERA5 (requested)',requestedModel:'era5',constituent:null,classification:'modeled_reanalysis',sourceCoordinates:{latitude:c.query.latitude,longitude:c.query.longitude},sourceElevationM:20,retrievedAt:'2026-09-13T00:00:00.000Z',sourceIssuedAt:null,sourceUpdatedAt:null,requestUrl:comparisonWeatherRequestUrl(c.query),sourceUrl:'https://open-meteo.com/en/docs/historical-weather-api',attribution:'Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF',cellSelection:'land',downscaling:'provider default elevation adjustment',calculationVersion:'comparison-weather-adapter-v2'},
      units:{temperatureC:'°C',dewPointC:'°C',wetBulbTemperatureC:'°C',humidityPercent:'%',windSpeedMs:'m/s',precipitationMm:'mm',sunshineDurationSeconds:'s',cloudCoverPercent:'%',weatherCode:'wmo code'},
      intervalSemantics:'instant meteorology; precipitation and sunshine duration sums over preceding hour ending at time',
      completeness:{status:completeHours===n?'complete':hours.some(h=>comparisonWeatherFieldNames.some(f=>h[f]!==null))?'partial':'no_data',expectedHours:n,sourceHours,completeHours,missingHours:n-sourceHours,validCounts:Object.fromEntries(comparisonWeatherFieldNames.map(f=>[f,hours.filter(h=>h[f]!==null).length])) as ComparisonWeatherData['completeness']['validCounts']}};
    return {chunkId:c.id,data};
  });
}


test('completed response binds result query, each city timezone and plan windows before display',()=>{
 const plan=createClimatePlan(query);const result=aggregateClimate(plan,fixtures(plan));
 const job={...queued(),state:'completed',progress:1,result};
 assert.equal(parseClimateJob(job,query).result!.locations.length,2);
 const changes=[(r:typeof result)=>{r.locations.reverse();},(r:typeof result)=>{r.locations[0]!.location.timezone='UTC';},(r:typeof result)=>{r.plan.query.mode='climatology';},(r:typeof result)=>{r.plan.windows[0]!.timezone='UTC';},(r:typeof result)=>{r.plan.chunks[0]!.query.latitude=0;}];
 for(const change of changes){const copy=structuredClone(result);change(copy);assert.throws(()=>parseClimateJob({...job,result:copy},query));}
});
test('detail rejects shifted UTC boundaries and preserves null hours and zero endpoints',()=>{
 const selection=climateDrillSelection(query,query.locations[0]!.id,'2024-01-01','2024-01-01');
 const hours=rows('2024-01-01T05:00:00Z',25,(_,i)=>({temperatureC:i===0?0:null}));
 const days=summarizeClimateDays(hours,selection.location.timezone,selection.startDate,selection.endDate);
 const detail={status:'success',...selection,days,hours,sources:[]};
 assert.equal(parseClimateDetail(detail,selection).hours[0]!.temperatureC,0);
 assert.equal(parseClimateDetail(detail,selection).hours[1]!.temperatureC,null);
 assert.throws(()=>parseClimateDetail({...detail,hours:[hours[1],hours[0]]},selection));
 assert.throws(()=>parseClimateDetail({...detail,days:[{...days[0],startInclusive:'2024-01-01T06:00:00Z'}]},selection));
 assert.throws(()=>parseClimateDetail({...detail,hours:[...hours,row(Date.parse('2024-01-02T06:00:00Z'))]},selection));
});
