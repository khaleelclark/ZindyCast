import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StationDiscoveryDataSchema, stationDistanceKm } from '@zindycast/contracts';
import { parseStationDiscovery, getStationDiscovery, STATION_DISCOVERY_MAX_BYTES } from './discovery.js';
const time='2026-09-11T00:00:00Z',q={latitude:0,longitude:0};
function row(id='USC00000001',lat=0,lon=0,elevation=-999.9,name='TEST') {
  return `${id} ${lat.toFixed(4).padStart(8)} ${lon.toFixed(4).padStart(9)} ${elevation.toFixed(1).padStart(6)}    ${name.padEnd(30)}              `;
}
test('NOAA retained fixed-width evidence parses; synthetic missing metadata stays null',()=>{
  const text=readFileSync('docs/research/history/ghcnd-stations-subset.txt','utf8');
  assert.ok(parseStationDiscovery(text,{latitude:21.3,longitude:-157.8},time).candidates.length);
  const d=parseStationDiscovery(row(undefined,0,0,-999.9,''),q,time);
  assert.equal(d.candidates[0].name,null);assert.equal(d.candidates[0].elevationM,null);
  assert.equal(d.eligibility,'not_assessed');assert.equal(d.timeHistory,'not_assessed');
});
test('nearest ten within 150km, stable ID ties, US scope and dateline geometry',()=>{
  const lines=Array.from({length:15},(_,i)=>row(`USC${String(15-i).padStart(8,'0')}`,0,i/100));
  lines.push(row('USC99999999',0,2),row('CA000000001'));
  const d=parseStationDiscovery(lines.join('\n')+'\n',q,time);
  assert.equal(d.candidates.length,10);assert.equal(d.candidates[0].id,'USC00000015');
  assert.ok(d.candidates.every(c=>c.distanceKm<=150));
  assert.ok(stationDistanceKm({latitude:0,longitude:179.9},{latitude:0,longitude:-179.9})<23);
  const tie=parseStationDiscovery(row('USC00000002')+'\r\n'+row(),q,time);assert.equal(tie.candidates[0].id,'USC00000001');
  assert.equal(parseStationDiscovery(row(undefined,30,30),q,time).candidates.length,0);
  assert.equal(StationDiscoveryDataSchema.safeParse({...d,candidates:[{...d.candidates[0],distanceKm:100}]}).success,false);
});
test('reject corrupt width/IDs/coordinates/flags/duplicates and invalid query/time',()=>{
  for(const text of ['',row().slice(1),row().replace('USC','../'),row(undefined,91),row()+'\n'+row(),row().replace('TEST','TE\tT'),row().slice(0,72)+'BAD'+row().slice(75)])
    assert.throws(()=>parseStationDiscovery(text,q,time));
  assert.throws(()=>parseStationDiscovery(row(),{latitude:NaN,longitude:0},time));
  assert.throws(()=>parseStationDiscovery(row(),q,'bad'));
});
test('fixed URL, no redirects, bounded body/status/type and cancellation',async t=>{
  const mock=t.mock.method(globalThis,'fetch',async (url:unknown,init?:RequestInit)=>{assert.equal(String(url),'https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt');assert.equal(init?.redirect,'error');return new Response(row(),{headers:{'content-type':'text/plain'}});});
  assert.equal((await getStationDiscovery(q)).candidates.length,1);
  for(const response of [new Response('bad',{status:503}),new Response(row(),{headers:{'content-type':'text/html'}}),new Response(row(),{headers:{'content-type':'text/plain','content-length':String(STATION_DISCOVERY_MAX_BYTES+1)}}),new Response(' '.repeat(STATION_DISCOVERY_MAX_BYTES+1),{headers:{'content-type':'text/plain'}})]) {
    mock.mock.mockImplementation(async()=>response);await assert.rejects(getStationDiscovery(q));
  }
  const c=new AbortController();c.abort();await assert.rejects(getStationDiscovery(q,c.signal));
});
test('12 second deadline rejects noncooperative stalled fetch',async t=>{
  t.mock.method(globalThis,'fetch',()=>new Promise<Response>(()=>{}));t.mock.timers.enable({apis:['setTimeout']});
  const result=getStationDiscovery(q);t.mock.timers.tick(12000);await assert.rejects(result);
});

test('full-catalog byte columns and unsupported station identifiers do not discard valid US candidates',()=>{
 const source=readFileSync('docs/verification/station-discovery/catalog-regression.txt','utf8');
 const d=parseStationDiscovery(source+row(),q,time);
 assert.deepEqual(d.candidates.map(c=>c.id),['USC00000001']);
 const unicode=row().replace('TEST                          ','CAFÉ                         ');
 assert.equal(parseStationDiscovery(unicode,q,time).candidates[0].name,'CAFÉ');
});
