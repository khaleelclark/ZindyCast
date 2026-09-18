import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LibreRadarCatalogSchema } from '@zindycast/contracts';
import { sampleLibreTimes, libreCapacity, libreTimes, libreEligible, libreTilePath, LibreTileCache, libreTileSession } from './libre-radar';
const now = Date.now(), generated = Math.floor(now / 1000) - 60;
const catalog = {status:'success' as const,generated,retrievedAt:new Date(now).toISOString(),past:[generated-300,generated],nowcast:[generated+600,generated+1200]};
test('Libre timelines preserve advertised epochs, reject invalid/stale catalogs and expire future frames', () => {
  assert.deepEqual(libreTimes(catalog,false,now),catalog.past);
  assert.deepEqual(libreTimes(catalog,true,now),catalog.nowcast);
  assert.deepEqual(libreTimes(catalog,true,now+1200000),[]);
  assert.deepEqual(libreTimes({...catalog,generated:generated+300},false,now),[]);
  assert.deepEqual(libreTimes({...catalog,nowcast:[generated,generated+600,generated+4000]},true,now),[generated+600]);
  assert.deepEqual(libreTimes(null,true,now),[]);
  assert.throws(()=>LibreRadarCatalogSchema.parse({...catalog,past:[null]}));
  assert.throws(()=>LibreRadarCatalogSchema.parse({...catalog,generated:now}));
  assert.equal(libreEligible({time:generated,generated,future:true},now),false);
  assert.equal(libreTilePath(generated,10,281,425),`/api/v1/maps/libre/tiles/${generated}/10/281/425.png`);
  assert.throws(()=>libreTilePath(generated,10,1024,0));
  assert.throws(()=>libreTilePath(generated,11,0,0));
});
test('Libre visible tile cache is bounded and isolates returned bytes', async () => {
  const c = new LibreTileCache(); for(let i=0;i<35;i++)c.put(String(i),new Uint8Array([i]).buffer,Date.now()+10000);
  assert.equal(c.entries.size,32); assert.equal(await c.get('0'),undefined);
  const a = (await c.get('34'))!.data as ArrayBuffer; new Uint8Array(a)[0]=99;
  assert.equal(new Uint8Array((await c.get('34'))!.data as ArrayBuffer)[0],34);
  c.prune(Date.now()+10001); assert.equal(c.entries.size,0);
});
test('Libre sessions pin header/PNG dimensions, reuse cache, and stop queued work on failure or cancellation', async () => {
  const tile = await readFile('docs/verification/librewxr-trial/libre-observed.png');
  const selection = {time:generated,generated,future:false}; const statuses: unknown[] = []; let count=0;
  const fetcher = async () => {count++;return new Response(tile,{headers:{'Content-Type':'image/png','X-Libre-Frame':String(generated)}});};
  const session = libreTileSession(selection,s=>statuses.push(s),fetcher as typeof fetch,new LibreTileCache()); const signal = new AbortController().signal;
  await session.load(7,35,53,signal); await session.load(7,35,53,signal); assert.equal(count,1);session.dispose();await assert.rejects(session.load(7,36,53,signal));assert.equal(count,1);
  count=0;const failing = libreTileSession(selection,s=>statuses.push(s),(async()=>{count++;return new Response(tile,{headers:{'Content-Type':'image/png','X-Libre-Frame':'1'}});}) as typeof fetch,new LibreTileCache());
  const results = await Promise.allSettled([failing.load(7,35,53,signal),failing.load(7,36,53,signal)]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(count,1);assert.match(JSON.stringify(statuses),/did not match/);
});

test('Libre playback samples the whole advertised horizon within visible tile capacity', () => {
 const times = Array.from({length:25},(_,i)=>generated-7200+i*300);
 for (const tiles of [1,4,6,8,16]) { const selected=sampleLibreTimes(times,libreCapacity(tiles)); assert.equal(selected[0],times[0]); assert.equal(selected.at(-1),times.at(-1)); assert.ok(selected.length<=6); assert.ok(selected.length*tiles<=32); assert.ok(selected.every(t=>times.includes(t))); }
 assert.equal(libreCapacity(33),1);
});
test('Four eight-tile frames stay warm within the 32-tile decoded cache', async () => {
 const tile=await readFile('docs/verification/librewxr-trial/libre-observed.png'); const client=new LibreTileCache(); let gets=0;
 const frames=sampleLibreTimes(Array.from({length:12},(_,i)=>generated-6600+i*600),libreCapacity(8));
 for(let pass=0;pass<2;pass++) for(const time of frames) {
  const session=libreTileSession({time,generated,future:false},()=>{},(async()=>{gets++;return new Response(tile,{headers:{'Content-Type':'image/png','X-Libre-Frame':String(time)}});}) as typeof fetch,client);
  for(let x=30;x<38;x++) await session.load(7,x,53,new AbortController().signal);
  session.dispose();assert.ok(client.entries.size<=32);
 }
 assert.equal(gets,32);assert.equal(client.entries.size,32);client.clear();
});
