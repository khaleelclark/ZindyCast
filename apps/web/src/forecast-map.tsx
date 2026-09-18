import { Button } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { ForecastRadarCatalogResponseSchema, type Location } from '@zindycast/contracts';
import { requestJson } from './request';

type Catalog = Extract<ReturnType<typeof ForecastRadarCatalogResponseSchema.parse>, { status: 'success' }>;
export type ForecastTileSelection = { id: string; validTime: string; modelRunTime: string };
export type ForecastTileStatus = { loading: boolean; error: string; retryAt?: number; frameId?: string; tileCount?: number };
export const FORECAST_BOUNDS: [number, number, number, number] = [-125, 24, -66, 50];
export function forecastRegionAllowed(location: Location | null) {
  return !location || location.longitude >= -125 && location.longitude <= -66 && location.latitude >= 24 && location.latitude <= 50;
}
export function futureFrames(catalog: Catalog, now: number) {
  if (now - Date.parse(catalog.data.modelRunTime) > 4 * 3600_000) return [];
  return catalog.data.frames.filter(frame => Date.parse(frame.validTime) > now && Date.parse(frame.validTime) <= now + 3 * 3600_000).slice(0, 12);
}
/** Sample advertised times across the whole horizon without exceeding decoded tile capacity. */
export function forecastPlaybackFrames<T>(frames: readonly T[], tileCount: number) {
  const count = Math.min(frames.length, 6, Math.floor(32 / Math.max(1, tileCount)));
  if (count < 2) return [];
  return Array.from({ length: count }, (_, i) => frames[Math.round(i * (frames.length - 1) / (count - 1))]!);
}
export function forecastTilePath(frameId: string, z: number, x: number, y: number) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(frameId) || !Number.isInteger(z) || z < 0 || z > 7 || ![x, y].every(n => Number.isInteger(n) && n >= 0 && n < 2 ** z)) throw new Error('Invalid forecast tile coordinates or frame.');
  // XYZ north-origin y: never invert it for IEM's generically named TMS service.
  return `/api/v1/maps/forecast/tiles/${frameId}/${z}/${x}/${y}.png`;
}
/** Bounded decoded memory cache; never Cache Storage. Protocol consumers get copies. */
export class ForecastTileClient {
  entries = new Map<string, { data: ArrayBuffer | ImageBitmap; bytes: number; expires: number }>();
  queue: Promise<unknown> = Promise.resolve();
  retryAt = 0;
  failures = 0;
  private generation = 0;
  now() { return this.clock(); }
  constructor(private clock = () => Date.now()) {}
  clear() { this.generation++; for (const item of this.entries.values()) if ('close' in item.data) item.data.close(); this.entries.clear(); }
  prune() { for (const [key, item] of this.entries) if (item.expires <= this.clock()) { if ('close' in item.data) item.data.close(); this.entries.delete(key); } }
  async get(key: string) {
    this.prune(); const item = this.entries.get(key); if (!item) return;
    this.entries.delete(key); this.entries.set(key, item);
    return { data: item.data instanceof ArrayBuffer ? item.data.slice(0) : await createImageBitmap(item.data) };
  }
  eligible(frame: ForecastTileSelection) {
    return Date.parse(frame.validTime) > this.clock() && Date.parse(frame.modelRunTime) + 4 * 3600000 > this.clock();
  }
  async put(key: string, bytes: ArrayBuffer, frame: ForecastTileSelection, signal?: AbortSignal) {
    this.prune(); const generation = this.generation;
    const data = typeof createImageBitmap === 'function' ? await createImageBitmap(new Blob([bytes], { type: 'image/png' })) : bytes.slice(0);
    if (generation !== this.generation || signal?.aborted || !this.eligible(frame)) { if ('close' in data) data.close(); return; }
    const prior = this.entries.get(key); if (prior && 'close' in prior.data) prior.data.close();
    this.entries.delete(key);
    this.entries.set(key, { data, bytes: data instanceof ArrayBuffer ? data.byteLength : 256 * 256 * 4, expires: Math.min(this.clock() + 300000, Date.parse(frame.validTime), Date.parse(frame.modelRunTime) + 4 * 3600000) });
    while (this.entries.size > 32 || [...this.entries.values()].reduce((n, e) => n + e.bytes, 0) > 16 * 1024 * 1024) {
      const first = this.entries.keys().next().value!; const old = this.entries.get(first)!;
      if ('close' in old.data) old.data.close(); this.entries.delete(first);
    }
  }
  backoff(retry?: string | null) {
    const now = this.clock();
    const advertised = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : retry ? Date.parse(retry) : 0;
    this.retryAt = Math.max(this.retryAt, now + Math.min(300000, 30000 * 2 ** Math.min(this.failures++, 4)), Number.isFinite(advertised) ? advertised : 0);
    return this.retryAt;
  }
}
const forecastClient = new ForecastTileClient();
/** Serialize visible tiles across selections; a failure fences queued work. */
export function forecastTileSession(frame: ForecastTileSelection, changed: (status: ForecastTileStatus) => void, fetcher: typeof fetch = fetch, client = forecastClient) {
  const lifetime = new AbortController(); let pending = 0; let failed = false;
  return {
    dispose() { lifetime.abort(); },
    load(z: number, x: number, y: number, signal: AbortSignal) {
      const next = client.queue.catch(() => {}).then(() => perform(z, x, y, signal));
      client.queue = next; return next;
    },
  };
  async function perform(z: number, x: number, y: number, signal: AbortSignal) {
      if (signal.aborted || lifetime.signal.aborted || failed) throw new DOMException('Forecast selection ended', 'AbortError');
      if (!client.eligible(frame)) { client.prune(); throw new DOMException('Forecast frame expired', 'AbortError'); }
      const path = forecastTilePath(frame.id, z, x, y);
      const cacheKey = `${frame.modelRunTime}/${frame.validTime}/${path}`;
      const cached = await client.get(cacheKey);
      if (signal.aborted || lifetime.signal.aborted || !client.eligible(frame)) { if (cached && 'close' in cached.data) cached.data.close(); throw new DOMException('Forecast selection ended', 'AbortError'); }
      if (cached) { changed({ loading: false, error: '' }); return cached; }
      if (client.retryAt > client.now()) {
        failed = true; changed({ loading: false, error: 'Future radar request limit reached. Waiting to retry automatically.', retryAt: client.retryAt });
        throw new Error('Forecast cooldown active');
      }
      const controller = new AbortController();
      const cancel = () => controller.abort();
      lifetime.signal.addEventListener('abort', cancel, { once: true }); signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      const timer = setTimeout(cancel, 15_000);
      pending++; changed({ loading: true, error: '' });
      try {
        const response = await fetcher(path, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
        if (!response.ok) {
          const retry = response.headers.get('retry-after');
          client.backoff(response.status === 429 ? retry : null);
          throw new Error(response.status === 429 ? `Future radar request limit reached.${retry && /^\d{1,5}$/.test(retry) ? ` Wait ${retry} seconds.` : ' Wait before retrying.'} Automatic retry after the wait.` : 'Future radar tiles unavailable. Use Retry when the service recovers.');
        }
        if (response.headers.get('X-Forecast-Product') !== 'forecast-hrrr-conus' || response.headers.get('X-Forecast-Frame') !== frame.id || Date.parse(response.headers.get('X-Forecast-Model-Run') ?? '') !== Date.parse(frame.modelRunTime) || Date.parse(response.headers.get('X-Forecast-Valid-Time') ?? '') !== Date.parse(frame.validTime) || response.headers.get('X-Forecast-Source-Time-Status') !== 'pinned_model_run_requested') throw new Error('Forecast image does not match the selected model run and time.');
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/png') || Number(response.headers.get('content-length')) > 1048576) throw new Error('Invalid forecast image response.');
        const reader = response.body?.getReader(); if (!reader) throw new Error('Empty forecast image.');
        const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1048576) throw new Error('Forecast image exceeds size limit.'); chunks.push(value); } }
        finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        if (size < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) || new DataView(bytes.buffer).getUint32(16) !== 256 || new DataView(bytes.buffer).getUint32(20) !== 256) throw new Error('Invalid forecast PNG dimensions.');
        if (controller.signal.aborted) throw new DOMException('Forecast request ended', 'AbortError');
        await client.put(cacheKey, bytes.buffer, frame, controller.signal);
        if (controller.signal.aborted) { client.prune(); throw new DOMException('Forecast request ended', 'AbortError'); }
        client.failures = 0;
        if (!client.eligible(frame)) { client.prune(); throw new DOMException('Forecast frame expired', 'AbortError'); }
        const result = await client.get(cacheKey) ?? { data: bytes.buffer };
        if (controller.signal.aborted || !client.eligible(frame)) { if ('close' in result.data) result.data.close(); throw new DOMException('Forecast request ended', 'AbortError'); }
        return result;
      } catch (cause) {
        if (!signal.aborted && !lifetime.signal.aborted && client.eligible(frame)) { failed = true; if (client.retryAt <= client.now()) client.backoff(); changed({ retryAt: client.retryAt, loading: false, error: cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Future radar request timed out. Use Retry.' }); lifetime.abort(); }
        throw cause;
      } finally {
        pending--; clearTimeout(timer); signal.removeEventListener('abort', cancel); lifetime.signal.removeEventListener('abort', cancel);
        if (!failed && !lifetime.signal.aborted) changed({ loading: pending > 0, error: '' });
      }
  }
}
export function useForecastRadar(active: boolean, location: Location | null, now: number) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState<Catalog['data']['frames']>([]);
  const [chosen, setChosen] = useState(''); const [draft, setDraft] = useState('');
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [tiles, setTiles] = useState<ForecastTileStatus>({ loading: false, error: '' });
  const allowed = forecastRegionAllowed(location);
  const identity = `${location?.id}/${location?.latitude}/${location?.longitude}`;
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const catalogRef = useRef(catalog); catalogRef.current = catalog;
  const refreshedRevision = useRef(0);
  const fetched = useRef(0); const identityRef = useRef(identity);
  const cancelDraft = () => { clearTimeout(draftTimer.current); setDraft(''); };
  useEffect(() => { cancelDraft(); setPlaying(false); if (identityRef.current !== identity) { identityRef.current = identity; fetched.current = 0; setChosen(''); setCatalog(null); forecastClient.clear(); } }, [active, identity]);
  useEffect(() => { const timer = setInterval(() => forecastClient.prune(), 15000); return () => { clearInterval(timer); clearTimeout(draftTimer.current); forecastClient.clear(); }; }, []);
  useEffect(() => {
    if (!active || !allowed) return;
    const controller = new AbortController(); let pending = false;
    const refresh = async (force = false) => {
      if (playing || pending || document.hidden || !navigator.onLine || !force && Date.now() - fetched.current < 300000) return;
      pending = true; fetched.current = Date.now();
      try {
        const parsed = ForecastRadarCatalogResponseSchema.parse(await requestJson('/api/v1/maps/forecast/catalog', controller.signal));
        if (parsed.status !== 'success') throw new Error(parsed.message);
        if (!controller.signal.aborted) {
          setCatalog(parsed); setLoadedIdentity(identity); setError('');
          const available = futureFrames(parsed, Date.now());
          const previous = catalogRef.current;
          setChosen(old => available.find(f => f.id === old || f.validTime === previous?.data.frames.find(f => f.id === old)?.validTime)?.id ?? available[0]?.id ?? '');
        }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Future radar catalog unavailable.'); }
      finally { pending = false; }
    };
    void refresh(revision !== refreshedRevision.current); refreshedRevision.current = revision;
    const due = () => { void refresh(); };
    const interval = setInterval(due, 15000);
    window.addEventListener('focus', due); window.addEventListener('online', due); document.addEventListener('visibilitychange', due);
    return () => { if (pending) fetched.current = 0; controller.abort(); clearInterval(interval); window.removeEventListener('focus', due); window.removeEventListener('online', due); document.removeEventListener('visibilitychange', due); };
  }, [active, allowed, identity, revision, playing]);
  useEffect(() => {
    if (!active || !tiles.error || !tiles.retryAt) return;
    const timer = setTimeout(() => { if (!document.hidden && navigator.onLine) setTiles({ loading: false, error: '' }); }, Math.min(2147483647, Math.max(0, tiles.retryAt - Date.now())));
    return () => clearTimeout(timer);
  }, [active, tiles.error, tiles.retryAt]);
  const current = loadedIdentity === identity ? catalog : null;
  const frames = current ? futureFrames(current, now) : [];
  const frame = (playing ? loop.filter(f => Date.parse(f.validTime) > now && now - Date.parse(f.modelRunTime) <= 4 * 3600000) : frames).find(f => f.id === chosen) ?? frames[0];
  const preview = frames.find(f => f.id === draft) ?? frame;
  const commit = () => { clearTimeout(draftTimer.current); if (draft) setChosen(draft); setDraft(''); };
  const choose = (id: string) => {
    setPlaying(false); clearTimeout(draftTimer.current); setDraft(id);
    draftTimer.current = setTimeout(() => { if (active && !document.hidden && navigator.onLine) { setChosen(id); setDraft(''); } }, 450);
  };
  useEffect(() => {
    if (!playing || !active) return;
    if (loop.some(f => Date.parse(f.validTime) <= now || now - Date.parse(f.modelRunTime) > 4 * 3600000)) { setPlaying(false); return; }
    if (!frame || tiles.loading || tiles.error || tiles.frameId !== frame.id) return;
    const capacity = Math.min(6, Math.floor(32 / Math.max(1, tiles.tileCount ?? 32)));
    if (capacity < 2) { setPlaying(false); return; }
    const bounded = forecastPlaybackFrames(loop, tiles.tileCount ?? 32);
    const timer = setTimeout(() => {
      if (document.hidden || !navigator.onLine) { setPlaying(false); return; }
      setLoop(bounded); setChosen((bounded.find(f => Date.parse(f.validTime) > Date.parse(frame.validTime)) ?? bounded[0])!.id);
    }, 900);
    return () => clearTimeout(timer);
  }, [playing, active, frame?.id, tiles, loop, now]);
  const togglePlay = () => {
    cancelDraft();
    if (playing) { setPlaying(false); return; }
    const next = forecastPlaybackFrames(frames, tiles.tileCount ?? 32);
    if (next.length < 2) return;
    setLoop(next); setChosen(next[0]!.id); setPlaying(true);
  };
  return { playing, playbackCount: loop.length, togglePlay, pause: () => setPlaying(false), catalog: current, frames, frame, preview, error, tiles, setTiles, allowed, revision, choose, commit,
    retry: () => { if (Date.now() < forecastClient.retryAt) return; setTiles({ loading: false, error: '' }); setRevision(n => n + 1); } };
}
function localTime(time: string, timezone?: string) { return new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(time)); }
export function ForecastMapControls({ state, online, visible, location, now, details = false }: { details?: boolean; state: ReturnType<typeof useForecastRadar>; online: boolean; visible: boolean; location: Location | null; now: number }) {
  const { catalog, frames, preview: frame, error, tiles, allowed } = state;
  return <div className="forecast-map-controls">{!details && <>
    <p className="map-clock">Forecast · simulated radar · coarse model grid</p>
    {!allowed ? <p role="status">Future radar is available only for the contiguous United States. Alaska and Hawaii are unavailable for this product.</p> : !online ? <p role="status">Offline — future radar unavailable.</p> : !visible ? <p role="status">Future radar paused while this page is hidden.</p> : error && !catalog ? <p role="alert">Future radar unavailable: {error}</p> : !catalog ? <p role="status">Loading forecast times…</p> : !frame ? <p role="status">Selected forecast time has expired or is unavailable. Refresh forecast times.</p> : <>
      <div className="map-playback"><Button aria-label={state.playing ? 'Pause' : 'Play'} disabled={!state.playing && (tiles.loading || !!tiles.error || tiles.frameId !== state.frame?.id || (tiles.tileCount ?? 32) > 16 || frames.length < 2)} onClick={state.togglePlay}><span aria-hidden="true">{state.playing ? 'Ⅱ' : '▶'}</span> {state.playing ? 'Pause' : 'Play'}</Button><label className="forecast-timeline"><strong>Forecast for {localTime(frame.validTime, location?.timezone)}</strong><input aria-label="Future forecast time" type="range" min="0" max={frames.length - 1} step="1" value={frames.indexOf(frame)} disabled={!!tiles.error} aria-valuetext={localTime(frame.validTime, location?.timezone)} onPointerUp={state.commit} onChange={event => state.choose(frames[Number(event.target.value)]!.id)} /><span className="map-timeline-ends"><span>{localTime(frames[0]!.validTime, location?.timezone)}</span><span>{localTime(frames.at(-1)!.validTime, location?.timezone)}</span></span></label></div>
      
      <p role="status">{state.preview?.id !== state.frame?.id ? 'Preview time — the map updates when you release or pause.' : tiles.loading ? 'Loading selected forecast tiles… Previous imagery may remain until ready.' : tiles.error ? '' : state.playing ? `Playback samples ${state.playbackCount} forecast times` : (tiles.tileCount ?? 0) > 16 ? 'View needs too many tiles for playback. Zoom in to play.' : ''}</p>
    </>}
    {error && catalog && <p role="status">Forecast refresh unavailable: {error} Showing the previous catalog.</p>}
    {tiles.error && <p className="notice error" role="alert">{tiles.error}</p>}
    {catalog && now - Date.parse(catalog.data.retrievedAt) > 300000 && <p className="notice">Forecast catalog is stale · retrieved {localTime(catalog.data.retrievedAt, location?.timezone)}.</p>}
    {allowed && (error || tiles.error || catalog && !frame) && <Button disabled={!online || !visible || !!tiles.retryAt && now < tiles.retryAt} onClick={state.retry}>Retry future radar</Button>}
    </>}{details && <><p>Model run {frame ? localTime(frame.modelRunTime, location?.timezone) : 'Unavailable'} · {frame ? Math.floor((now - Date.parse(frame.modelRunTime)) / 60000) : '—'} min old</p><p className="map-legend" aria-label="Forecast legend">Simulated reflectivity at 1 km above ground · dBZ. Illustrative colors; no verified quantitative color scale. Coverage unknown: blank pixels do not establish clear weather.</p>
    <p className="map-attribution"><a href="https://mesonet.agron.iastate.edu/GIS/model.phtml" target="_blank" rel="noreferrer">Iowa Environmental Mesonet</a> · <a href="https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php" target="_blank" rel="noreferrer">NOAA/NCEP HRRR</a></p>
    <details className="map-settings"><summary>Forecast details</summary><p>Next three hours, up to twelve quarter-hour forecasts from one pinned model run. Play starts at the first available time and samples up to six advertised forecasts across the full timeline, including its end. Steps may skip quarter-hour times. It loads only visible tiles sequentially and waits for each frame. Larger views use fewer frames to fit the 32-tile memory cache. No frame prefetch. Playback pauses when the view changes, hidden or offline. The PNG does not independently confirm its model timestamp. No rainfall amount, probability or exact arrival prediction is implied.</p>{allowed && <Button disabled={!online || !visible || tiles.loading} onClick={state.retry}>Refresh forecast times</Button>}</details>
    </>}
  </div>;
}
