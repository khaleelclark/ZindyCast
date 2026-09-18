import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentHour, dailyGroups, dayKey, parseForecast, rain, speed, temperature } from './weather';
import type { Forecast, Hour } from '@zindycast/contracts';
const hour: Hour = { time: '2026-11-01T08:00:00Z', temperatureC: 0, apparentTemperatureC: -1, humidityPercent: 50, precipitationMm: null, precipitationProbability: null, windSpeedMs: 1, windGustMs: null, windDirectionDeg: null, weatherCode: 0, ordinaryWetBulbC: null, dewPointC: null, surfacePressureHpa: null, cloudCoverPercent: null, visibilityM: null, uvIndex: null };
const forecast: Forecast = { location: { id: 'test', name: 'Test only', country: 'US', latitude: 0, longitude: 0, timezone: 'America/Los_Angeles' }, provenance: { provider: 'test', dataset: 'fixture', classification: 'modeled', retrievedAt: '2026-11-01T08:00:00Z', sourceIssuedAt: null, sourceCoordinates: { latitude: 0, longitude: 0 }, attribution: 'test' }, hours: [hour], intervalSemantics: 'instant meteorology; precipitation and probability preceding hour; gust preceding-hour maximum', missingFields: [] };
test('SI conversions retain missingness and legitimate zeros', () => {
  assert.equal(temperature(0, 'us'), '32°'); assert.equal(temperature(null, 'us'), '—');
  assert.equal(speed(10, 'us'), '22 mph'); assert.equal(speed(10, 'metric'), '36 km/h');
  assert.equal(rain(25.4, 'us'), '1.00 in'); assert.equal(rain(null, 'metric'), '—');
});
test('local calendar uses location timezone across UTC midnight and DST repeat', () => {
  assert.equal(dayKey('2026-11-01T06:00:00Z', 'America/Los_Angeles'), '2026-10-31');
  assert.equal(dayKey('2026-11-01T09:00:00Z', 'America/Los_Angeles'), '2026-11-01');
  assert.equal(dayKey('2026-07-01T06:30:00Z', 'America/Phoenix'), '2026-06-30');
  assert.equal(dayKey('2026-07-01T09:30:00Z', 'Pacific/Honolulu'), '2026-06-30');
});
test('current conditions never borrow a future or expired hour', () => {
  assert.equal(currentHour([hour], Date.parse('2026-11-01T07:59:00Z')), undefined);
  assert.equal(currentHour([hour], Date.parse('2026-11-01T08:59:00Z')), hour);
  assert.equal(currentHour([hour], Date.parse('2026-11-01T09:00:00Z')), undefined);
});
test('runtime validation rejects old location and unordered timelines', () => {
  const response = { status: 'success', freshness: 'fresh', data: forecast };
  assert.throws(() => parseForecast(response, { ...forecast.location, latitude: 1 }), /selected location/);
  assert.throws(() => parseForecast({ ...response, data: { ...forecast, hours: [hour, hour] } }, forecast.location), /timeline/);
  assert.throws(() => parseForecast({ ...response, data: { ...forecast, hours: [{ ...hour, temperatureC: '0' }] } }, forecast.location));
});
test('daily aggregation retains null-only temperatures and a repeated local hour', () => {
  const data = { ...forecast, hours: [{ ...hour, temperatureC: null }, { ...hour, time: '2026-11-01T09:00:00Z', temperatureC: null }] };
  const days = dailyGroups(data, Date.parse(hour.time), 7);
  assert.equal(days.length, 1); assert.equal(days[0]?.hours.length, 2);
  assert.equal(days[0]?.low, null); assert.equal(days[0]?.high, null);
});
test('midnight precipitation belongs to preceding date, missing intervals stay missing', () => {
  const hours: Hour[] = ['2026-07-01T23:00:00Z', '2026-07-02T00:00:00Z', '2026-07-02T01:00:00Z'].map((time, i) => ({ ...hour, time, precipitationMm: i + 1 }));
  const data = { ...forecast, location: { ...forecast.location, timezone: 'UTC' }, hours };
  const days = dailyGroups(data, Date.parse(hours[0]!.time), 7);
  assert.equal(days[0]?.rainTotal, 3); assert.equal(days[1]?.rainTotal, 3);
  assert.equal(days[0]?.rainHours.length, 2);
  data.hours[1]!.precipitationMm = null;
  assert.equal(dailyGroups(data, Date.parse(hours[0]!.time), 7)[0]?.rainTotal, null);
});
test('precipitation uses 23/25 actual intervals on spring/fall local DST days', () => {
  for (const [start, length] of [['2026-03-08T08:00:00Z', 23], ['2026-11-01T07:00:00Z', 25]] as const) {
    const hours = Array.from({ length: length + 1 }, (_, index) => ({ ...hour, time: new Date(Date.parse(start) + index * 3_600_000).toISOString(), precipitationMm: 1 }));
    const day = dailyGroups({ ...forecast, hours }, Date.parse(start), 1)[0]!;
    assert.equal(day.hours.length, length); assert.equal(day.rainHours.length, length); assert.equal(day.rainTotal, length);
  }
});

test('night and unknown daylight never imply sunshine', async () => {
 const { weatherSymbol } = await import('./weather');
 assert.equal(weatherSymbol(0, 0), '☾'); assert.equal(weatherSymbol(1, 0), '☾');
 assert.equal(weatherSymbol(0, null), '◇'); assert.equal(weatherSymbol(0), '◇'); assert.equal(weatherSymbol(0, 1), '☀');
});
test('periods preserve repeated DST night hours and missing/partial rain', async () => {
 const { forecastPeriods, hourlySummary } = await import('./weather');
 const start = Date.parse('2026-11-01T01:00:00Z');
 const hours = Array.from({length: 26}, (_,i) => ({...hour, time:new Date(start+i*3600000).toISOString(), precipitationProbability:i === 3 ? null : 20 }));
 const periods = forecastPeriods({...forecast, hours}, start);
 const night = periods.find(p => p.label === 'Tonight')!;
 assert.equal(night.hours.length,13); assert.equal(night.rainExpected,13); assert.equal(night.rainCount,12); assert.equal(night.rainChance,20);
 assert.equal(hourlySummary([{...hour, precipitationProbability:null}]).rainChance,null);
 assert.equal(hourlySummary([{...hour, precipitationProbability:0}]).rainChance,0);
});
test('astronomy uses exact local valid date and rejects mismatches and duplicate dates', async () => {
 const { astronomyForDate } = await import('./weather');
 const data = {...forecast, astronomy:[{date:'2026-11-01',sunrise:'2026-11-01T14:20:00Z',sunset:'2026-11-02T01:00:00Z'}]};
 assert.equal(astronomyForDate(data,'2026-11-01').sunset,'2026-11-02T01:00:00Z');
 assert.equal(astronomyForDate(data,'2026-11-02').sunrise,null);
 assert.equal(astronomyForDate({...data,astronomy:data.astronomy.map(row=>({...row,date:'2026-11-02'}))},'2026-11-01').sunset,'2026-11-02T01:00:00Z');
 assert.equal(astronomyForDate({...data,astronomy:[{...data.astronomy[0]!,sunrise:'2026-11-01T01:00:00Z'}]},'2026-11-01').sunrise,null);
 assert.equal(astronomyForDate({...data,astronomy:[...data.astronomy,{...data.astronomy[0]!,sunset:'2026-11-02T01:30:00Z'}]},'2026-11-01').sunset,null);
});

test('daily wording shows forecast conditions and hourly maxima without obscuring missing or DST hours', async () => {
 const {dailySummary} = await import('./weather');
 const start = Date.parse('2026-11-01T04:00:00Z');
 const hours = Array.from({length:25},(_,i)=>({...hour,time:new Date(start+i*3600000).toISOString(),temperatureC:20,weatherCode:i===12?95:2,precipitationProbability:0,windSpeedMs:0}));
 const result = dailySummary(hours,hours,'America/New_York');
 assert.equal(result.partial,false);assert.equal(result.condition,'Thunderstorms at times');assert.equal(result.rainChance,0);assert.equal(result.windMax,0);
 assert.equal(dailySummary(hours.slice(1),hours,'America/New_York').partial,true);
 assert.equal(dailySummary(hours.map(h=>({...h,weatherCode:2})),hours,'America/New_York').condition,'Partly cloudy');
 const missing = hours.map(h=>({...h,weatherCode:null,windSpeedMs:null,precipitationProbability:null}));
 assert.equal(dailySummary(missing,missing,'America/New_York').condition,'Conditions unavailable');
 assert.equal(dailySummary(missing,missing,'America/New_York').rainChance,null);
 assert.equal(dailySummary(missing,missing,'America/New_York').windMax,null);
});
