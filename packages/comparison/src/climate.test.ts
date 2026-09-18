import test from 'node:test';
import assert from 'node:assert/strict';
import { createClimatePlan, aggregateClimate, summarizeClimateDays, ClimatePlanSchema, ClimateError } from './climate';
import { ClimateQuerySchema, ClimateDaySchema, climateFields, type ClimateQuery } from '../../contracts/src/climate-comparison';
import { comparisonWeatherFieldNames, comparisonWeatherRequestUrl, ComparisonWeatherDataSchema, type ComparisonWeatherHour, type ComparisonWeatherData } from '../../contracts/src/comparison-weather';
const HOUR = 3600000, DAY = 86400000;
const query = (startDate='2024-01-01', endDate=startDate, timezone='UTC'): ClimateQuery => ({ mode: 'period', startDate, endDate,
  locations: [{id:'a',name:'A',latitude:30,longitude:-80,timezone},{id:'b',name:'B',latitude:35,longitude:-90,timezone}] });
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

test('bounded query, frozen per-city source envelope and canonical plan validation',()=>{
  const p=createClimatePlan(query('2024-03-10','2024-03-10','America/New_York'));
  assert.equal(p.windows[0].startInclusive,'2024-03-10T05:00:00.000Z');
  assert.equal(p.windows[0].endExclusive,'2024-03-11T04:00:00.000Z');
  assert.equal(p.fetchEndDate,'2024-03-11');
  assert.ok(ClimatePlanSchema.safeParse(p).success);
  const changed=structuredClone(p);changed.windows[0].timezone='UTC';assert.equal(ClimatePlanSchema.safeParse(changed).success,false);
  assert.equal(ClimateQuerySchema.safeParse({...query(),mode:'climatology'}).success,false);
  assert.throws(()=>createClimatePlan(query('2024-01-01','2025-01-01')),ClimateError);
  assert.throws(()=>createClimatePlan(query('1940-01-01','1940-01-01','Asia/Tokyo')),ClimateError);
  assert.throws(()=>createClimatePlan(query('2011-12-29','2011-12-31','Pacific/Apia')),/Unsupported local date/);
});

test('local DST days contain 23/25 distinct instants; closing amounts belong once',()=>{
  for(const [date,start,count] of [['2024-03-10','2024-03-10T05:00:00Z',23],['2024-11-03','2024-11-03T04:00:00Z',25]] as const){
    const day=summarizeClimateDays(rows(start,count+1,(_,i)=>({temperatureC:i,precipitationMm:1,sunshineDurationSeconds:60})), 'America/New_York',date,date)[0];
    assert.equal(day.metrics.temperatureC.expectedSlots,count);
    assert.equal(day.metrics.temperatureC.mean,(count-1)/2);
    assert.equal(day.metrics.precipitationMm.total,count);
    assert.equal(day.metrics.sunshineDurationSeconds.total,count*60);
    assert.ok(ClimateDaySchema.safeParse(day).success);
  }
  const days=summarizeClimateDays(rows('2024-01-01',49,(_,i)=>({precipitationMm:i===24?5:0})), 'UTC','2024-01-01','2024-01-02');
  assert.equal(days[0].metrics.precipitationMm.total,5);assert.equal(days[1].metrics.precipitationMm.total,0);
});

test('fractional boundaries retain instant temperatures and mark only interval totals unsupported',()=>{
  const day=summarizeClimateDays(rows('2024-01-01',72,()=>({precipitationMm:1})), 'Asia/Kolkata','2024-01-02','2024-01-02')[0];
  assert.equal(day.metrics.temperatureC.expectedSlots,24);assert.equal(day.metrics.temperatureC.complete,true);
  assert.equal(day.metrics.precipitationMm.expectedSlots,23);assert.equal(day.metrics.precipitationMm.sumAvailable,23);
  assert.equal(day.metrics.precipitationMm.total,null);assert.equal(day.metrics.precipitationMm.intervalAligned,false);
  assert.equal(day.precipitationDay,null);
});

test('missingness is per-field, distinguishes absence/null and never turns null into zero',()=>{
  const hours=rows('2024-01-01',25,(_,i)=>i===1?{temperatureC:null}:{});
  hours.splice(3,1);
  const day=summarizeClimateDays(hours,'UTC','2024-01-01','2024-01-01')[0];
  const t=day.metrics.temperatureC;
  assert.equal(t.mean,null);assert.equal(t.min,null);assert.equal(t.max,null);
  assert.equal(t.validSlots,22);assert.equal(t.absentSourceSlots,1);assert.equal(t.nullSlots,1);
  assert.equal(t.expectedSlots,t.validSlots+t.absentSourceSlots+t.nullSlots);
  assert.equal(day.metrics.precipitationMm.sumAvailable,0);assert.equal(day.metrics.precipitationMm.total,null);
  const noClosing=summarizeClimateDays(rows('2024-01-01',24),'UTC','2024-01-01','2024-01-01')[0];
  assert.equal(noClosing.metrics.temperatureC.complete,true);assert.equal(noClosing.metrics.precipitationMm.complete,false);
  const empty=summarizeClimateDays([],'UTC','2024-01-01','2024-01-01')[0];
  assert.equal(empty.metrics.precipitationMm.sumAvailable,null);
  assert.throws(()=>summarizeClimateDays([hours[0],hours[0]],'UTC','2024-01-01','2024-01-01'),/Duplicate/);
});

test('day weighted means differ from hour weighting; average high/low, extrema ties and nearest rank',()=>{
  const p=createClimatePlan(query('2024-03-09','2024-03-10','America/New_York'));
  const data=fixtures(p,time=>({temperatureC:time<Date.parse('2024-03-10T05:00Z')?10:20, wetBulbTemperatureC:time<Date.parse('2024-03-10T05:00Z')?1:4}));
  const result=aggregateClimate(p,data), s=result.locations[0].overview;
  assert.equal(s.metrics.temperatureC.mean,15);assert.equal(s.metrics.temperatureC.avgDailyHigh,15);assert.equal(s.metrics.temperatureC.avgDailyLow,15);
  assert.equal(s.metrics.temperatureC.max!.time,'2024-03-10T05:00:00.000Z');assert.equal(s.metrics.temperatureC.max!.localDate,'2024-03-10');assert.equal(s.metrics.temperatureC.max!.tieCount,23);
  assert.equal(s.wetBulbDistribution.p50,1);assert.equal(s.wetBulbDistribution.p90,4);assert.equal(s.wetBulbDistribution.validSlots,47);
  assert.deepEqual(aggregateClimate(p,[...data].reverse()),result);
});

test('partial headline stays null; available daily and sample statistics are explicit',()=>{
  const p=createClimatePlan(query('2024-01-01','2024-01-02'));
  const r=aggregateClimate(p,fixtures(p,(time)=>({temperatureC:time===Date.parse('2024-01-02T01:00Z')?null:time>=Date.parse('2024-01-02')?60:10}))).locations[0].overview.metrics.temperatureC;
  assert.equal(r.status,'partial');assert.equal(r.validDays,1);assert.equal(r.mean,null);assert.equal(r.max,null);
  assert.equal(r.availableCompleteDays.mean,10);assert.equal(r.availableMax!.value,60);assert.equal(r.availableMax!.tieCount,23);
});

test('leap month weighting, exact wet-day/cloud boundaries, sunshine independent of precipitation',()=>{
  const p=createClimatePlan(query('2024-01-01','2024-02-29'));
  const result=aggregateClimate(p,fixtures(p,time=>({temperatureC:new Date(time).getUTCMonth()===0?10:20,precipitationMm:1,sunshineDurationSeconds:60}))).locations[0];
  assert.equal(result.monthly[1].expectedDays,29);assert.equal(result.overview.metrics.temperatureC.mean,(31*10+29*20)/60);
  assert.equal(result.overview.precipitationDays.qualifying,60);assert.equal(result.overview.metrics.sunshineDurationSeconds.total,60*24*60);
  for(const [value,expected] of [[5,0],[25,1],[50,2],[69,3],[87,4],[100,5]] as const){
    assert.equal(summarizeClimateDays(rows('2024-01-01',25,()=>({cloudCoverPercent:value})),'UTC','2024-01-01','2024-01-01')[0].cloudBin,expected);
  }
  for(const [value,expected] of [[0,false],[.9,false],[1,true]] as const){
    assert.equal(summarizeClimateDays(rows('2024-01-01',25,(_,i)=>({precipitationMm:i===1?value:0})),'UTC','2024-01-01','2024-01-01')[0].precipitationDay,expected);
  }
});

test('all planned delivery and fixed request/grid identities are mandatory',()=>{
  const p=createClimatePlan(query('2024-01-01','2024-02-15')), data=fixtures(p);
  assert.throws(()=>aggregateClimate(p,data.slice(1)),/Every planned/);
  assert.throws(()=>aggregateClimate(p,[data[0],data[0],...data.slice(2)]),/duplicate/);
  const changed=structuredClone(data);changed[0].data.provenance.requestUrl+='&foo=bar';assert.throws(()=>aggregateClimate(p,changed),/provenance/);
  const grid=structuredClone(data);grid[1].data.provenance.sourceElevationM=200;assert.throws(()=>aggregateClimate(p,grid),/grid/);
  const wrong=structuredClone(data);wrong[0].data.units.temperatureC='F' as '°C';assert.throws(()=>aggregateClimate(p,wrong),/units/);
  assert.ok(ComparisonWeatherDataSchema.safeParse(data[0].data).success);
});

test('five-year five-city climatology is twelve pooled months and fits existing JSON limits',()=>{
  const q: ClimateQuery={...query('2019-01-01','2023-12-31'),mode:'climatology'};
  q.locations=Array.from({length:5},(_,i)=>({...q.locations[0],id:`city-${i}`,name:`City ${i}`,latitude:30+i}));
  const p=createClimatePlan(q);assert.ok(p.chunks.length<=305);
  const result=aggregateClimate(p,fixtures(p,time=>({temperatureC:new Date(time).getUTCFullYear()===2020?20:10})));
  assert.equal(result.locations[0].monthly.length,12);assert.equal(result.locations[0].monthly[0].metrics.temperatureC.validYears,5);assert.equal(result.locations[0].monthly[1].expectedDays,141);
  assert.deepEqual(result.locations[0].monthly[1].years,[2019,2020,2021,2022,2023]);
  assert.equal(result.locations[0].overview.expectedDays,1826);assert.equal(result.locations[0].overview.metrics.temperatureC.mean,(366*20+1460*10)/1826);
  const json=JSON.stringify(result);assert.ok(Buffer.byteLength(json)<1_000_000);
  assert.equal('hours' in result.locations[0],false);assert.equal('days' in result.locations[0],false);
  assert.equal(Object.keys(result.locations[0].overview.metrics).length,climateFields.length);
  let nodes=0;const visit=(v:unknown)=>{nodes++;if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(result);assert.ok(nodes<100000);
  console.log(`Maximum fixture: ${p.chunks.length} chunks, ${Buffer.byteLength(json)} bytes, ${nodes} JSON nodes`);
});

test('daily mean, average daily high and absolute hourly high are distinct quantities',()=>{
  const p=createClimatePlan(query('2024-01-01','2024-01-02'));
  const r=aggregateClimate(p,fixtures(p,time=>{const day=new Date(time).getUTCDate(), hour=new Date(time).getUTCHours();return {temperatureC:day===1?hour:hour+10};})).locations[0].overview.metrics.temperatureC;
  assert.equal(r.mean,16.5);assert.equal(r.avgDailyHigh,28);assert.equal(r.avgDailyLow,5);assert.equal(r.max!.value,33);assert.equal(r.min!.value,0);
});

test('long identities and full-precision five-year summaries remain bounded',()=>{
  const q: ClimateQuery={...query('1996-01-01','2000-12-31'),mode:'climatology'};
  q.locations=Array.from({length:5},(_,i)=>({...q.locations[0],id:`${i}${'漢'.repeat(199)}`,name:'漢'.repeat(200),latitude:30.12345678901234+i,longitude:-80.98765432109876,timezone:'America/Argentina/ComodRivadavia'}));
  const p=createClimatePlan(q);
  const results=fixtures(p,time=>({temperatureC:Math.sin(time)*19.1234567890123,dewPointC:1.1234567890123,wetBulbTemperatureC:2.1234567890123,humidityPercent:59.1234567890123,windSpeedMs:3.1234567890123,precipitationMm:.1234567890123,sunshineDurationSeconds:1234.1234567890123,cloudCoverPercent:23.1234567890123}));
  const result=aggregateClimate(p,results);assert.equal(result.locations[0].overview.expectedDays,1827);
  const bytes=Buffer.byteLength(JSON.stringify(result));assert.ok(bytes<1_000_000);let nodes=0;const visit=(v:unknown)=>{nodes++;if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(result);assert.ok(nodes<100000);console.log(`Precision/identity stress fixture: ${bytes} bytes, ${nodes} JSON nodes`);
});

test('hourly distribution uses nearest rank, and all-null source is no-data with unknown days',()=>{
  const p=createClimatePlan(query());
  const ranked=aggregateClimate(p,fixtures(p,time=>({wetBulbTemperatureC:new Date(time).getUTCHours()+1}))).locations[0].overview.wetBulbDistribution;
  assert.deepEqual([ranked.p50,ranked.p90,ranked.p95],[12,22,23]);
  const blank=Object.fromEntries(comparisonWeatherFieldNames.map(f=>[f,null])) as Partial<ComparisonWeatherHour>;
  const result=aggregateClimate(p,fixtures(p,()=>blank)).locations[0].overview;
  assert.equal(result.metrics.temperatureC.status,'no_data');assert.equal(result.metrics.temperatureC.nullSlots,24);
  assert.equal(result.metrics.temperatureC.absentSourceSlots,0);assert.equal(result.metrics.temperatureC.validYears,0);
  assert.equal(result.precipitationDays.unknown,1);assert.equal(result.cloudDays.unknown,1);
  assert.equal(result.wetBulbDistribution.p50,null);assert.equal(result.metrics.sunshineDurationSeconds.sumAvailable,null);
});
