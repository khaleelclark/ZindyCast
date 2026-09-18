import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { MapCatalogResponseSchema, MapFrameResponseSchema, type Location } from '@zindycast/contracts';
import { requestJson } from './request';
import { InteractiveMap, type MapBox } from './interactive-map';
import { ForecastMapControls, useForecastRadar } from './forecast-map';
import { useLibreRadar, LibreRadarControls } from './libre-radar';
import { WildfirePanel } from './wildfires';

type Catalog = ReturnType<typeof MapCatalogResponseSchema.parse>;
type Product = Catalog['data']['products'][number];
type Frame = ReturnType<typeof MapFrameResponseSchema.parse>;
export type Region = 'CONUS' | 'AK' | 'HI';
export const regions: Record<Region, [number, number, number, number]> = { CONUS: [-125, 24, -66, 50], AK: [-170, 52, -130, 72], HI: [-161, 18, -154, 23] };
export function regionFor(location: Location | null): Region { return location && location.latitude > 50 ? 'AK' : location && location.longitude < -150 && location.latitude < 30 ? 'HI' : 'CONUS'; }
export function productsFor(products: Product[], region: Region) {
  const radar = { CONUS: 'radar-conus', AK: 'radar-alaska', HI: 'radar-hawaii' }[region];
  return products.filter(p => p.id === radar || p.id === (region === 'AK' ? 'satellite-global-infrared' : 'satellite-goes-infrared'));
}
export const MAX_RECENT_FRAMES = 6;
export function recentTimes(product?: Product, now = Infinity) { return advertisedTimes(product).filter(t => Date.parse(t) <= now).slice(-MAX_RECENT_FRAMES); }
export function layerLabel(product: Product) { return product.kind === 'radar' ? 'Weather radar' : product.id === 'satellite-global-infrared' ? 'Satellite · global infrared' : 'Satellite · regional infrared'; }
// Exact quantities/colors from retained NOAA weather_radar_base_reflectivity SLD,
// advertised by CONUS/Alaska/Hawaii layers (docs/research/maps/followup-*).
export const reflectivityStops = [[10, '#00ECEC'], [20, '#0000F6'], [30, '#00C800'], [40, '#FFFF00'], [50, '#FF9000'], [60, '#DC0000'], [70, '#FF00FF'], [80, '#05EDE0']] as const;
export function localFrameTime(time: string, timezone?: string) { return new Intl.DateTimeFormat(undefined, { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(time)); }
export function advertisedAge(time: string, now: number) { const minutes = Math.floor((now - Date.parse(time)) / 60_000); return minutes < 0 ? 'Advertised time is in the future' : `${minutes} min since advertised time`; }
export function advertisedTimes(product?: Product): string[] { return [...new Set(product?.times ?? [])].sort((a, b) => Date.parse(a) - Date.parse(b)); }
export function markerPosition(location: Pick<Location, 'latitude' | 'longitude'> | null, box: readonly number[]) {
  const [west, south, east, north] = box as [number, number, number, number];
  if (!location || location.longitude < west || location.longitude > east || location.latitude < south || location.latitude > north) return null;
  return { x: (location.longitude - west) / (east - west) * 800, y: (north - location.latitude) / (north - south) * 500 };
}
export function parseFrame(raw: unknown, product: string, time: string, mercator = false): Frame {
  const frame = MapFrameResponseSchema.parse(raw);
  if (frame.data.productId !== product || Date.parse(frame.data.requestedTime) !== Date.parse(time)) throw new Error('The map response does not match the selected product and time.');
  if (mercator && frame.data.projection !== 'EPSG:3857') throw new Error('Awaiting map server update: Mercator imagery required. Weather overlay withheld.');
  return frame;
}
export function pngBlob(base64: string): Blob {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error('Invalid map image encoding.');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) throw new Error('The map service did not return a PNG image.');
  return new Blob([bytes], { type: 'image/png' });
}
/** Only explicitly requested frames enter memory. Eviction and unmount release blob URLs. */
export class FrameCache {
  private entries = new Map<string, { frame: Frame; url: string }>();
  constructor(private revoke: (url: string) => void = url => URL.revokeObjectURL(url)) {}
  get(key: string) { const item = this.entries.get(key); if (item) { this.entries.delete(key); this.entries.set(key, item); } return item; }
  makeRoom() {
    // Release before URL.createObjectURL so transitions never briefly hold seven.
    while (this.entries.size >= MAX_RECENT_FRAMES) { const oldest = this.entries.keys().next().value!; this.revoke(this.entries.get(oldest)!.url); this.entries.delete(oldest); }
  }
  put(key: string, value: { frame: Frame; url: string }) {
    const prior = this.entries.get(key); if (prior) this.revoke(prior.url);
    this.entries.delete(key); this.entries.set(key, value);
    while (this.entries.size > MAX_RECENT_FRAMES) { const oldest = this.entries.keys().next().value!; this.revoke(this.entries.get(oldest)!.url); this.entries.delete(oldest); }
  }
  clear() { for (const item of this.entries.values()) this.revoke(item.url); this.entries.clear(); }
}
function sourceLink(url: string) { try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'noaa.gov' || u.hostname.endsWith('.noaa.gov')) ? u.href : 'https://nowcoast.noaa.gov/'; } catch { return 'https://nowcoast.noaa.gov/'; } }

export function MapsPanel({ location, online, now, compact = false }: { compact?: boolean; location: Location | null; online: boolean; now: number }) {
  useEffect(() => { void import('./maps-controls.css'); }, []);
  const [future, setFuture] = useState(false);
  const [radarSource,setRadarSource] = useState<'noaa' | 'libre'>('noaa');
  const [productId, setProductId] = useState('');
  const [sourceNotice,setSourceNotice] = useState('');
  const libreActive = radarSource === 'libre' && (future || !productId.startsWith('satellite-'));
  const useNoaa = () => { setRadarSource('noaa'); setFuture(false); setProductId(''); setSourceNotice('Source changed to NOAA observed radar.'); };
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => { const change = () => { setVisible(!document.hidden); if (document.hidden) setPlaying(false); }; document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  const libre = useLibreRadar(libreActive && online && visible, future, now);
  useEffect(() => { libre.pause(); }, [location?.id,location?.latitude,location?.longitude]);
  const region = regionFor(location);
  const forecast = useForecastRadar(!libreActive && future && online && visible, location, now);
  const [viewport, setViewport] = useState<MapBox | null>(null);
  const forecastSelection = !libreActive && future && online && visible && viewport && forecast.allowed && !forecast.tiles.error ? forecast.frame ?? null : null;
  const [loadedCount, setLoadedCount] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(-1);
  const [revision, setRevision] = useState(0);
  const [chosenTime, setChosenTime] = useState('');
  const [result, setResult] = useState<{ key: string; frame: Frame; url: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const cache = useRef(new FrameCache());
  useEffect(() => () => cache.current.clear(), []);
  const catalogFetched = useRef(0);
  const scrubbedAt = useRef(0);
  const refreshEligible = useRef(false); refreshEligible.current = online && visible && !future && !playing && !libreActive;
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    if (!online || future || libreActive) return;
    const refresh = async (force = false) => {
      if (pending || !refreshEligible.current || document.hidden || !navigator.onLine || Date.now() - scrubbedAt.current < 1000 || !force && Date.now() - catalogFetched.current < 120000) return;
      pending = true; catalogFetched.current = Date.now();
      try {
        const parsed = MapCatalogResponseSchema.parse(await requestJson('/api/v1/maps', controller.signal));
        if (!controller.signal.aborted) { setCatalog(parsed); setCatalogRevision(revision); setCatalogError(''); }
      } catch (cause) { if (!controller.signal.aborted) setCatalogError(cause instanceof Error ? cause.message : 'Map catalog unavailable.'); }
      finally { pending = false; }
    };
    void refresh(catalogRevision !== revision);
    const due = () => { void refresh(); }; const timer = setInterval(due, 15000);
    window.addEventListener('focus', due); window.addEventListener('online', due); document.addEventListener('visibilitychange', due);
    return () => { if (pending) catalogFetched.current = 0; controller.abort(); clearInterval(timer); window.removeEventListener('focus', due); window.removeEventListener('online', due); document.removeEventListener('visibilitychange', due); };
  }, [revision, online, future, visible, libreActive]);
  const products = productsFor(catalog?.data.products ?? [], region);
  const product = products.find(p => p.id === productId) ?? products.find(p => p.kind === (productId.startsWith('satellite-') ? 'infrared' : 'radar'));
  const times = recentTimes(product, now);
  const time = times.includes(chosenTime) ? chosenTime : product?.defaultTime && times.includes(product.defaultTime) ? product.defaultTime : times.at(-1) ?? '';
  const index = times.indexOf(time);
  const box = viewport ?? regions[region];
  const unavailable = product?.status === 'unavailable' || region === 'AK' && product?.id === 'satellite-goes-infrared';
  const context = `${revision}/${region}/${product?.id}/${location?.id}/${location?.latitude}/${location?.longitude}/${viewport?.join(',') ?? 'moving'}/`;
  const key = context + time;
  useEffect(() => { setPlaying(false); setError(''); cache.current.clear(); setResult(null); }, [region, product?.id, online, revision, location?.id, location?.latitude, location?.longitude, future, libreActive]);
  // Keep last-frame notices and bounded cached images through view settlement.
  // Removing them while loading changes the flex viewport and starts another load.
  useEffect(() => { setPlaying(false); setError(''); }, [viewport?.join(',')]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(false);
    if (libreActive || future || error || !online || !visible || catalogRevision !== revision || !viewport || !product || unavailable || !time) return;
    const targets = playing ? times : [time];
    let count = targets.filter(t => cache.current.get(context + t)).length;
    setLoadedCount(count);
    const load = async () => {
      for (const target of targets) {
        const targetKey = context + target;
        if (cache.current.get(targetKey)) continue;
        setLoading(true);
        const params = new URLSearchParams({ product: product.id, west: String(box[0]), south: String(box[1]), east: String(box[2]), north: String(box[3]), width: '800', height: '500', projection: 'EPSG:3857', time: target });
        const raw = await requestJson(`/api/v1/maps/frame?${params}`, controller.signal);
        const frame = parseFrame(raw, product.id, target, true);
        if (controller.signal.aborted) return;
        cache.current.makeRoom();
        const url = URL.createObjectURL(pngBlob(frame.data.imageBase64));
        cache.current.put(targetKey, { frame, url });
        setLoadedCount(++count);
      }
      if (controller.signal.aborted) return;
      const cached = cache.current.get(key);
      if (cached) { setError(''); setResult({ key, ...cached }); }
    };
    void load().catch(cause => { if (!controller.signal.aborted) { setPlaying(false); setError(cause instanceof Error ? cause.message : 'Map frame unavailable.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [libreActive, future, key, online, product, unavailable, time, box, catalogRevision, visible, playing, error]);
  const shown = !libreActive && !future && online && result?.key.startsWith(context) ? result : null;
  useEffect(() => {
    if (!playing || !shown || loading || loadedCount < times.length || !online || !visible || times.length < 2) return;
    const timer = setTimeout(() => setChosenTime(times[(index + 1) % times.length]!), 700);
    return () => clearTimeout(timer);
  }, [playing, shown, loading, loadedCount, online, visible, time, times.join('|')]);
  const overlay = React.useMemo(() => shown ? { url: shown.url, box } : null, [shown, box]);
  const mapInfo = <><label>Radar source <select style={{minWidth:0,maxWidth:'100%',width:'100%',boxSizing:'border-box'}} aria-label="Radar source" value={radarSource} onChange={event => { setPlaying(false); setRadarSource(event.target.value as 'noaa' | 'libre'); setSourceNotice(''); }}><option value="noaa">NOAA</option><option value="libre">LibreWXR trial</option></select></label>    {!libreActive && future && <ForecastMapControls details state={forecast} online={online} visible={visible} location={location} now={now} />}
    {!libreActive && !future && <>{product && <div className="map-legend" aria-label="Weather legend">{product.kind === 'radar' ? <><strong>Radar reflectivity · dBZ</strong><div className="reflectivity-stops">{reflectivityStops.map(([value, color]) => <span key={value}><i style={{ backgroundColor: color }} />{value}</span>)}</div><span>NOAA · not rainfall amounts. </span></> : <span>Infrared cloud/surface patterns · illustrative colors, no temperature scale. </span>}<a href={sourceLink(product.legend.url)} target="_blank" rel="noreferrer">NOAA legend ↗</a></div>}
    <details className="map-settings" ><summary>Imagery details</summary><Button disabled={!online} onClick={() => { setPlaying(false); setRevision(n => n + 1); }}>Refresh imagery</Button>
    {shown && <>
    <details><summary>Frame timing & extent</summary><div className="notice">Requested advertised time: {shown.frame.data.requestedTime}. Actual source time: unconfirmed. {shown.frame.data.warning ?? 'The provider does not confirm the exact returned observation time.'}{shown.frame.data.sourceTimeStatus === 'provider_warning_actual_time_unknown' && ' Provider warning: returned imagery may use a nearest available time.'}</div>
    <p className="subtle">Frame retrieved {shown.frame.data.retrievedAt}; retrieval is not observation time. {shown.frame.freshness === 'stale' || now - Date.parse(shown.frame.data.retrievedAt) > 600_000 ? 'Previously retrieved frame; it may be out of date. ' : ''}{shown.frame.data.extentRelation === 'partial' ? 'View only partly intersects the advertised product extent.' : 'View is inside the advertised rectangle, which is not a coverage mask.'}</p></details><p className="subtle">{shown.frame.data.attribution}</p></>}
    {product && <details><summary>Legend, source & timing</summary><p>{product.title} · {product.layer}</p><p>{product.description}</p><p>{product.coverageMessage} Blank pixels do not establish dry conditions or absence of clouds.</p><p>{product.legend.explanation} {product.kind === 'radar' ? 'Reflectivity is in dBZ, not rainfall depth or rate.' : 'Infrared cloud/surface patterns are not surface air temperatures; no quantitative temperature scale is implied.'}</p><a href={sourceLink(product.legend.url)} target="_blank" rel="noreferrer">Official product legend ↗</a><p>Approximate cadence: {product.approximateCadenceMinutes} minutes. {product.documentedLatencyMinutes ? `Documented latency: ${product.documentedLatencyMinutes.join('–')} minutes.` : 'Latency is not documented in this catalog.'} Each product has its own timeline.</p><p>{product.attribution} <a href={sourceLink(product.sourceUrl)} target="_blank" rel="noreferrer">NOAA source ↗</a></p></details>}
    <details><summary>Map capabilities</summary><p>Playback loops up to six recent advertised frames, loading one at a time and reusing memory. Playback pauses when hidden, offline, or the view changes. Pan, zoom and labeled basemap available. Temperature/wind overlays are unavailable.</p></details>
    </details>
    </>}
    {!compact && <WildfirePanel location={location} online={online} now={now} />}
</>;
  return <Card component="section" className={`card maps-panel ${compact ? "compact-map" : ""}`}>{compact ? <h2>Local weather map</h2> : <h1>Weather map</h1>}
    {compact && <InteractiveMap regionBox={regions[region]} location={location} online={online} overlay={overlay} libre={online && visible && viewport ? libre.frame : null} onLibreStatus={libre.setTiles} weatherProduct={libreActive ? 'libre-radar' : future ? 'forecast-hrrr-conus' : product?.id ?? 'radar-conus'} forecast={forecastSelection} onForecastStatus={forecast.setTiles} onView={view => { setViewport(view); if (view?.join(',') !== viewport?.join(',')) { forecast.pause(); libre.pause(); } }} >{mapInfo}</InteractiveMap>}
    {sourceNotice && <p role="status">{sourceNotice}</p>}
    <div className="map-layer-buttons" role="group" aria-label="Weather layer">{(['radar', 'infrared'] as const).map(kind => {
      const layer = products.find(p => p.kind === kind);
      return <Button key={kind} size="large" variant={!future && (libreActive ? kind === 'radar' : product?.kind === kind) ? 'contained' : 'outlined'} aria-pressed={!future && (libreActive ? kind === 'radar' : product?.kind === kind)} disabled={!layer && !future && !libreActive} onClick={() => { setFuture(false); setPlaying(false); setProductId(layer?.id ?? (kind === 'radar' ? 'radar-conus' : 'satellite-goes-infrared')); setChosenTime(''); }}>{kind === 'radar' ? 'Radar' : 'Satellite'}</Button>;
    })}<Button size="large" variant={future ? "contained" : "outlined"} aria-pressed={future} onClick={() => { setPlaying(false); setFuture(true); }}>Future radar</Button></div>
    {libreActive && !online && <p role="status">Offline — map imagery is unavailable.</p>}
    {libreActive && online && <LibreRadarControls state={libre} future={future} timezone={location?.timezone} onNoaa={useNoaa} />}
    {!libreActive && future && <ForecastMapControls state={forecast} online={online} visible={visible} location={location} now={now} />}
    {!libreActive && !future && <><div className="map-playback">
      <Button aria-label={playing ? 'Pause' : 'Play'} variant="contained" disabled={!online || !visible || !viewport || unavailable || times.length < 2 || !!error || !!catalogError} onClick={() => setPlaying(value => !value)}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span> {playing ? 'Pause' : 'Play'}</Button>
      <label><span>{time ? localFrameTime(shown?.frame.data.requestedTime ?? time, location?.timezone) : 'No imagery'}</span><input aria-label="Recent frames" type="range" min="0" max={Math.max(0, times.length - 1)} step="1" value={Math.max(0, index)} disabled={!online || unavailable || !times.length} aria-valuetext={time ? localFrameTime(time, location?.timezone) : 'No frames'} onChange={e => { scrubbedAt.current = Date.now(); setPlaying(false); setChosenTime(times[Number(e.target.value)]!); }} /><span className="map-timeline-ends"><span>Earlier</span><span>Latest available</span></span></label>
    </div>
    {time && <p className="map-clock">{product?.kind === 'infrared' ? `Satellite · infrared clouds (not rain) · ~${product.id === 'satellite-global-infrared' ? '3' : '2'} km detail · ` : 'Radar · '}{advertisedAge(shown?.frame.data.requestedTime ?? time, now)}</p>}
    {region === 'AK' && <p className="notice">{product?.kind === 'infrared' ? 'Alaska uses the slower global satellite mosaic. ' : ''}Western Aleutians across the date line are outside this view.</p>}
    {!online ? <p role="status">Offline — map imagery is unavailable.</p> : catalogError ? <p className="notice error" role="alert">{catalogError} Use Refresh to retry.</p> : !catalog ? <p role="status">Loading map catalog…</p> : null}
    {unavailable && <p role="status">{product?.unavailableReason ?? 'This product is unavailable in the selected region.'}</p>}
    {catalog && !product && <p role="status">No products reported for this region.</p>}
    {product && !time && <p role="status">No frame times reported for this product.</p>}
    <p role="status" className="map-loading" style={{display: 'block', minHeight: '1.5em', visibility: loading && online ? 'visible' : 'hidden'}}>{playing ? `Loading animation ${loadedCount}/${times.length}…` : 'Loading image…'}</p>{error && <p className="notice error" role="alert">Last frame request: {error} Use Refresh to retry.</p>}
    {catalog && (catalog.freshness === 'stale' || now - Date.parse(catalog.data.retrievedAt) > 600_000) && <p className="notice">Catalog may be out of date. Retrieved {catalog.data.retrievedAt}.</p>}
    {online && result && <>{(result.frame.freshness === 'stale' || now - Date.parse(result.frame.data.retrievedAt) > 600_000) && <p className="notice">Last retrieved frame may be out of date.</p>}{result.frame.data.extentRelation === 'partial' && <p className="notice">Last retrieved frame: partial product extent.</p>}{result.frame.data.warning && <p className="notice">{result.frame.data.warning}</p>}</>}
    </>}
    {!compact && <InteractiveMap regionBox={regions[region]} location={location} online={online} overlay={overlay} libre={online && visible && viewport ? libre.frame : null} onLibreStatus={libre.setTiles} weatherProduct={libreActive ? 'libre-radar' : future ? 'forecast-hrrr-conus' : product?.id ?? 'radar-conus'} forecast={forecastSelection} onForecastStatus={forecast.setTiles} onView={view => { setViewport(view); if (view?.join(',') !== viewport?.join(',')) { forecast.pause(); libre.pause(); } }} >{mapInfo}</InteractiveMap>}
  </Card>;
}
