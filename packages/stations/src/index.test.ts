import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getStationHistory, parseStationDaily, StationDataSchema, StationQuerySchema, StationError, STATION_MAX_BYTES } from './index.js';
const id = 'USC00021282';
const query = { stationId: id, startDate: '2020-02-28', endDate: '2020-03-01' };
const retrievedAt = '2026-09-11T00:00:00.000Z';
function row(element = 'TMAX', month = '202002', slots: Record<number,string> = {}) {
  const days = month === '202002' ? 29 : 31;
  return id + month + element + Array.from({ length: 31 }, (_, i) => slots[i+1] ?? (i < days ? '  123  7' : '-9999   ')).join('');
}
function parse(text: string, q = query) { return parseStationDaily(text, q, retrievedAt); }
const invalid = (f: () => unknown) => assert.throws(f, (e: unknown) => e instanceof StationError);
test('calendar labels retain leap day, expand absent months, preserve SI zero/missing/raw flags', () => {
  const d = parse(row('TMAX') + '\r\n' + row('PRCP', '202002', { 28: '    0T 7', 29: '-9999P 0' }) + '\r\n');
  assert.deepEqual(d.days.map(d => d.date), ['2020-02-28','2020-02-29','2020-03-01']);
  assert.equal(d.days[0].TMAX.value, 12.3); assert.equal(d.days[0].PRCP.value, 0);
  assert.equal(d.days[0].PRCP.trace, true); assert.equal(d.days[1].PRCP.presumedZero, true);
  assert.equal(d.days[1].PRCP.rawValue, -9999); assert.equal(d.days[1].PRCP.value, null);
  assert.equal(d.days[2].TMAX.rawValue, null); assert.equal(d.coverage.TMAX.absentMonth, 1);
  assert.equal(d.timeContext.timezone, null); assert.equal(d.station.name, null);
  assert.equal(d.provenance.sourceUpdatedAt, null); assert.equal(d.coverage.eligibility, 'not_assessed');
});
test('QC screen counts do not imply eligibility; unknown flags remain explicit and values preserved', () => {
  const d = parse(row('PRCP','202002',{28:'    0P 0',29:'   15? 7'}).replace('?', 'J') + '\n' +
    row('TMAX','202002',{28:'  111 I0',29:'  222 JW'}));
  assert.equal(d.days[0].TMAX.value,11.1); assert.equal(d.days[0].TMAX.qcStatus,'flagged');
  assert.equal(d.days[1].TMAX.qcStatus,'unknown_code'); assert.equal(d.coverage.TMAX.flagged,1);
  assert.equal(d.coverage.TMAX.unknownQuality,1); assert.equal(d.coverage.PRCP.unflagged,2);
  assert.equal(d.coverage.PRCP.presumedZero,1); assert.deepEqual(d.days[1].PRCP.unknownFlags,['measurement']);
});
test('real research complete file and known raw examples pass without mutating evidence', () => {
  const text = readFileSync('docs/research/history/USC00021282.dly','utf8');
  const d = parse(text,{stationId:id,startDate:'2020-07-15',endDate:'2020-07-15'});
  assert.equal(d.days[0].TMAX.rawValue,417); assert.equal(d.days[0].TMIN.rawValue,261); assert.equal(d.days[0].PRCP.rawValue,0);
  const flagged = parse(text,{stationId:id,startDate:'1991-03-15',endDate:'1991-03-15'});
  assert.equal(flagged.days[0].TMAX.qualityFlag,'I'); assert.equal(flagged.coverage.TMAX.flagged,1);
});
test('bounds reject malformed IDs/dates/ranges; calendar works before epoch and at DST without invented hours', () => {
  for (const q of [{...query,stationId:'../USC00021282'}, {...query,startDate:'2021-02-29'}, {...query,endDate:'2019-01-01'},
    {...query,startDate:'2020-01-01',endDate:'2021-01-01'}]) assert.equal(StationQuerySchema.safeParse(q).success,false);
  assert.equal(StationQuerySchema.safeParse({...query,startDate:'2020-01-01',endDate:'2020-12-31'}).success,true);
  const d = parse(row('TMAX','196903'),{stationId:id,startDate:'1969-03-08',endDate:'1969-03-10'});
  assert.equal(d.days.length,3); assert.equal(d.days[0].date,'1969-03-08');
});
test('fixed width, mixed station, duplicate rows, invalid padding/month/integer/flags rejected including irrelevant elements', () => {
  for (const text of ['', ' ', row().slice(0,-1), row()+'\n\n', row().replace(id,'USW00026451'), row()+'\n'+row(),
    row('TMAX','202013'), row('TMAX','202002',{30:'    0  7'}), row('TMAX','202002',{1:' 1.23  7'}),
    row('SNOW','202002',{1:'    1! 7'}), row().replace('202002','000002')]) invalid(() => parse(text));
});
test('result runtime schema rejects edited values/counts/timeline/identity', () => {
  const d = parse(row());
  for (const edit of [(x: typeof d) => {x.days[0].TMAX.value=99;},(x: typeof d)=>{x.coverage.TMAX.unflagged=0;},
    (x: typeof d)=>{x.days[0].date='2020-02-27';},(x: typeof d)=>{x.station.id='USW00026451';}, (x: typeof d)=>{x.query.startDate='invalid';}]) {
    const changed=structuredClone(d); edit(changed); assert.equal(StationDataSchema.safeParse(changed).success,false);
  }
});
test('fetch is fixed-source complete-file bounded, query snapshotted, rate/errors/partial/html/oversize rejected', async t => {
  const mock = t.mock.method(globalThis,'fetch',async (url: unknown, options: RequestInit | undefined) => {
    assert.equal(String(url),'https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/USC00021282.dly');
    assert.equal(options?.redirect,'error'); return new Response(row(),{headers:{'content-type':'text/plain'}});
  });
  const q = {...query}; const pending=getStationHistory(q); q.stationId='USW00026451';
  assert.equal((await pending).query.stationId,id);
  for (const response of [new Response('x',{status:404}),new Response('x',{status:206}),new Response('<html>',{headers:{'content-type':'text/html'}}),
    new Response(row(),{headers:{'content-type':'text/plain','content-length':String(STATION_MAX_BYTES+1)}}),
    new Response(new Uint8Array(STATION_MAX_BYTES+1),{headers:{'content-type':'text/plain'}}),
    new Response(row().slice(0,-2),{headers:{'content-type':'text/plain'}})]) {
    mock.mock.mockImplementation(async()=>response); await assert.rejects(getStationHistory(query), StationError);
  }
  mock.mock.mockImplementation(async()=>new Response('',{status:429,headers:{'retry-after':'12'}}));
  await assert.rejects(getStationHistory(query),(e: unknown)=> e instanceof StationError && e.code==='rate_limited' && e.retryAfterSeconds===12);
});
test('pre-abort, in-flight abort and deadlines bound stalled fetch and body', async t => {
  const c=new AbortController(); const reason=new Error('stop'); c.abort(reason);
  await assert.rejects(getStationHistory(query,c.signal),e=>e===reason);
  const mock=t.mock.method(globalThis,'fetch',()=>new Promise<Response>(()=>{}));
  const c2=new AbortController(); const request=getStationHistory(query,c2.signal); c2.abort(reason);
  await assert.rejects(request,e=>e===reason);
  t.mock.timers.enable({apis:['setTimeout']});
  const stalled=getStationHistory(query); t.mock.timers.tick(15000);
  await assert.rejects(stalled,/timed out/);
  mock.mock.mockImplementation(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){ controller.enqueue(new TextEncoder().encode(row())); }}),{headers:{'content-type':'text/plain'}}));
  const body=getStationHistory(query); await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(15000);
  await assert.rejects(body,/timed out/);
});
