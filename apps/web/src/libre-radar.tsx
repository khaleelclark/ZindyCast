import React, { useEffect, useState } from 'react';
import { Button } from '@mui/material';
import { LibreRadarCatalogSchema } from '@zindycast/contracts';
import { requestJson } from './request';

type Catalog = ReturnType<typeof LibreRadarCatalogSchema.parse>;
export type LibreSelection = { time: number; generated: number; future: boolean };
export type LibreStatus = { loading: boolean; error: string; time?: number; tileCount?: number };
export function libreTimes(catalog: Catalog | null, future: boolean, now: number, capacity = 6) {
  if (!catalog || catalog.generated * 1000 > now + 60000 || now - catalog.generated * 1000 >= 1200000) return [];
  return sampleLibreTimes([...new Set(future ? catalog.nowcast : catalog.past)].filter(t => Number.isSafeInteger(t) && t > 0 && (future ? t * 1000 > now && t <= catalog.generated + 3600 : t * 1000 <= now && t >= catalog.generated - 7200)).sort((a, b) => a - b), capacity);
}
export function sampleLibreTimes(times: number[], capacity: number) {
  const count = Math.max(1, Math.min(6, Math.floor(capacity), times.length));
  return times.length <= count ? times : Array.from({length:count}, (_,i) => times[Math.round(i * (times.length-1) / Math.max(1,count-1))]!);
}
export function libreCapacity(tileCount: number) { return Math.max(1, Math.min(6, Math.floor(32 / Math.max(1,tileCount)))); }
export function libreEligible(frame: LibreSelection, now = Date.now()) {
  return Number.isSafeInteger(frame.time) && frame.time > 0 && Number.isSafeInteger(frame.generated) && frame.generated > 0 && frame.generated * 1000 <= now + 60000 && now - frame.generated * 1000 < 1200000 && (frame.future ? frame.time * 1000 > now && frame.time <= frame.generated + 3600 : frame.time * 1000 <= now && frame.time >= frame.generated - 7200);
}
export function libreTilePath(time: number, z: number, x: number, y: number) {
  if (!Number.isSafeInteger(time) || time <= 0 || !Number.isInteger(z) || z < 0 || z > 10 || ![x,y].every(n => Number.isInteger(n) && n >= 0 && n < 2 ** z)) throw Error('Invalid LibreWXR tile selection.');
  return `/api/v1/maps/libre/tiles/${time}/${z}/${x}/${y}.png`;
}
/** Only requested visible tiles, at most 32 decoded 512px images (32 MiB). */
export class LibreTileCache {
  entries = new Map<string, { data: ImageBitmap | ArrayBuffer; expires: number }>();
  queue: Promise<unknown> = Promise.resolve();
  clear() { for (const item of this.entries.values()) if ('close' in item.data) item.data.close(); this.entries.clear(); }
  prune(now = Date.now()) { for (const [key,item] of this.entries) if (item.expires <= now) { if ('close' in item.data) item.data.close(); this.entries.delete(key); } }
  async get(key: string) { this.prune(); const item = this.entries.get(key); if (!item) return; this.entries.delete(key); this.entries.set(key,item); return { data: item.data instanceof ArrayBuffer ? item.data.slice(0) : await createImageBitmap(item.data) }; }
  put(key: string, data: ImageBitmap | ArrayBuffer, expires: number) {
    const old = this.entries.get(key); if (old && 'close' in old.data) old.data.close(); this.entries.delete(key); this.entries.set(key,{data,expires});
    while (this.entries.size > 32) { const key = this.entries.keys().next().value!; const item = this.entries.get(key)!; if ('close' in item.data) item.data.close(); this.entries.delete(key); }
  }
}
const cache = new LibreTileCache();
export function libreTileSession(frame: LibreSelection, changed: (status: LibreStatus) => void, fetcher: typeof fetch = fetch, client = cache) {
  const lifetime = new AbortController(); let failed = false;
  return { dispose() { lifetime.abort(); }, load(z: number, x: number, y: number, signal: AbortSignal) { const next = client.queue.catch(() => {}).then(() => perform(z,x,y,signal)); client.queue = next; return next; } };
  async function perform(z: number, x: number, y: number, signal: AbortSignal) {
    const combined = AbortSignal.any([signal, lifetime.signal]);
    if (combined.aborted || failed) throw new DOMException('Selection ended', 'AbortError');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!libreEligible(frame)) throw Error('LibreWXR frame expired. Refresh the trial timeline.');
      const path = libreTilePath(frame.time,z,x,y); const cached = await client.get(path);
      if (combined.aborted || !libreEligible(frame)) { if (cached && 'close' in cached.data) cached.data.close(); throw Error('LibreWXR frame expired or selection changed.'); }
      if (cached) return cached;
      const timeout = new AbortController(); timer = setTimeout(() => timeout.abort(),10000);
      const response = await fetcher(path, { signal: AbortSignal.any([combined,timeout.signal]), credentials:'same-origin', redirect:'error' });
      if (response.status !== 200) throw Error(response.status === 429 ? 'LibreWXR request limit reached. Use NOAA radar or retry later.' : 'LibreWXR tiles are unavailable.');
      if (response.headers.get('X-Libre-Frame') !== String(frame.time) || !response.headers.get('Content-Type')?.startsWith('image/png')) throw Error('LibreWXR tile time or format did not match.');
      const bytes = await response.arrayBuffer(); const view = new DataView(bytes);
      if (bytes.byteLength < 24 || bytes.byteLength > 2 * 1024 * 1024 || ![137,80,78,71,13,10,26,10].every((v,i) => view.getUint8(i) === v) || view.getUint32(16) !== 512 || view.getUint32(20) !== 512) throw Error('LibreWXR tile is not a 512px PNG.');
      const data = typeof createImageBitmap === 'function' ? await createImageBitmap(new Blob([bytes], { type:'image/png' })) : bytes;
      if (combined.aborted || !libreEligible(frame)) { if ('close' in data) data.close(); throw Error('LibreWXR frame expired or selection changed.'); }
      client.put(path,data,Math.min(Date.now()+300000,frame.generated*1000+1200000,frame.future ? frame.time*1000 : Infinity));
      return (await client.get(path))!;
    } catch (cause) {
      if (!combined.aborted && !failed) { failed = true; changed({ loading:false,error:cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'LibreWXR tile request timed out.' }); lifetime.abort(); }
      throw new Error('LibreWXR tile unavailable.');
    } finally { clearTimeout(timer); }
  }
}
export function useLibreRadar(active: boolean, future: boolean, now: number) {
  const [catalog,setCatalog] = useState<Catalog | null>(null); const [error,setError] = useState(''); const [revision,setRevision] = useState(0); const [chosen,setChosen] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [tileCount,setTileCount] = useState(0);
  const [tiles,updateTiles] = useState<LibreStatus>({loading:false,error:''});
  const setTiles = (status: LibreStatus) => { updateTiles(previous => ({...status, time:status.error ? undefined : status.time ?? previous.time})); if (status.tileCount) setTileCount(status.tileCount); if(status.error) setPlaying(false); };
  useEffect(() => { setPlaying(false); updateTiles({loading:false,error:''}); }, [active,future,revision]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); setCatalog(null); setError(''); setTiles({loading:false,error:''});
    void requestJson('/api/v1/maps/libre/catalog',controller.signal).then(raw => { const parsed = LibreRadarCatalogSchema.parse(raw); if (!controller.signal.aborted) setCatalog(parsed); }).catch(() => { if (!controller.signal.aborted) setError('LibreWXR timeline unavailable or invalid.'); });
    return () => controller.abort();
  }, [active,revision]);
  const times = libreTimes(catalog,future,now,libreCapacity(tileCount)); const time = times.includes(chosen) ? chosen : future ? times[0] : times.at(-1);
  useEffect(() => { updateTiles(previous => ({loading:!!time,error:'',time:previous.time})); },[time,future,active]);
  useEffect(() => { if (!time || !active || tiles.error) setPlaying(false); },[time,active,tiles.error]);
  useEffect(() => {
    if (!playing || !active || tiles.loading || tiles.error || tiles.time !== time || times.length < 2) return;
    const timer = setTimeout(() => setChosen(times[(times.indexOf(time!) + 1) % times.length]!), time === times.at(-1) ? 1200 : 900);
    return () => clearTimeout(timer);
  },[playing,active,tiles.loading,tiles.error,tiles.time,time,times.join('|')]);
  const frame: LibreSelection | null = active && catalog && time && !error && !tiles.error ? {time,generated:catalog.generated,future} : null;
  return {catalog,error,tiles,setTiles,times,time,frame,playing,pause:() => setPlaying(false),toggle:() => { if(!playing) setChosen(times[0]!); setPlaying(value=>!value); },choose:(value:number) => {setPlaying(false);setChosen(value);},refresh:() => {setPlaying(false);setRevision(n=>n+1);}};
}
export function LibreRadarControls({state,future,timezone,onNoaa}: { state:ReturnType<typeof useLibreRadar>; future:boolean; timezone?:string; onNoaa:()=>void }) {
  const format = (time:number) => new Intl.DateTimeFormat(undefined,{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(time*1000);
  return <div><p className="map-clock">{future ? 'Experimental nowcast · LibreWXR' : 'Radar composite · LibreWXR trial'}</p>
    <Button variant="contained" aria-label={state.playing ? 'Pause LibreWXR' : 'Play LibreWXR'} disabled={!state.frame || state.times.length < 2 || !!state.error || !!state.tiles.error} onClick={state.toggle}>{state.playing ? 'Pause' : 'Play'}</Button>
    <label>{state.frame && state.tiles.time ? `Showing ${format(state.tiles.time)}` : state.time ? format(state.time) : 'No eligible frames'}<input aria-label="LibreWXR frames" type="range" min="0" max={Math.max(0,state.times.length-1)} value={Math.max(0,state.times.indexOf(state.time ?? 0))} disabled={!state.times.length} aria-valuetext={state.time ? format(state.time) : 'No frames'} onChange={event => state.choose(state.times[Number(event.target.value)]!)} /></label>
    <p role="status">{state.error || state.tiles.error || (state.catalog && !state.time ? 'No fresh advertised frames available for this layer.' : state.tiles.loading || !state.catalog || state.tiles.time !== state.time ? (state.playing ? 'Buffering LibreWXR playback…' : 'Loading LibreWXR…') : state.playing ? 'Playing LibreWXR · cached frames are reused.' : 'Selected frame loaded.')} {state.tiles.loading && 'The previous complete frame stays visible until ready.'}</p>
    <Button onClick={state.refresh}>Refresh LibreWXR</Button><Button onClick={onNoaa}>Use NOAA radar</Button>
    <details><summary>LibreWXR trial details</summary><p>Playback samples up to six actual advertised frames across the available horizon, bounded by visible tile memory. Playback pauses when the view or layer changes, hidden, or offline. Composite imagery can include model fallback. Blank pixels do not establish dry conditions. Colors are illustrative; no verified quantitative scale.</p>{future && <p>Experimental optical-flow extrapolation blended with weather models, up to one hour from generation. Developing storms can be missed. This is not a future radar observation.</p>}<p>Data: <a href="https://librewxr.net/" target="_blank" rel="noreferrer">LibreWXR</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> · NOAA/IEM and ECMWF; regional fallback possible. Italian DPC data: CC BY-SA 4.0.</p>{state.catalog && <p>Generated {format(state.catalog.generated)}. Retrieved {state.catalog.retrievedAt}; retrieval is not observation time.</p>}</details></div>;
}
