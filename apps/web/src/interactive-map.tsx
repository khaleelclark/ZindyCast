import { Button } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import type { Map as LibreMap, ImageSource, GeoJSONSource } from 'maplibre-gl';
import type { Location } from '@zindycast/contracts';
import { FORECAST_BOUNDS, forecastTileSession, type ForecastTileSelection, type ForecastTileStatus } from './forecast-map';
import { libreTileSession, type LibreSelection, type LibreStatus } from './libre-radar';
import { mapboxPublicToken } from './mapbox-config';
import { installBasemap, initialBasemap, basemapFeedback, MAPBOX_LOGO, type BasemapStatus } from './basemap';
let forecastSourceSequence = 0;
export type MapBox = [number, number, number, number];
export function boundedView(values: MapBox): MapBox {
  if (!values.every(Number.isFinite)) throw new Error('Invalid map bounds.');
  const box: MapBox = [Math.max(-180, values[0]), Math.max(-85, values[1]), Math.min(180, values[2]), Math.min(85, values[3])];
  const rounded = box.map(n => Math.round(n * 100000) / 100000) as MapBox;
  if (rounded[0] >= rounded[2] || rounded[1] >= rounded[3]) throw new Error('Map bounds cross the supported nonwrapping view.');
  return rounded;
}
export function imageCorners([w, s, e, n]: MapBox): [[number, number], [number, number], [number, number], [number, number]] { return [[w, n], [e, n], [e, s], [w, s]]; }
/** Sources live until map.remove(). Reusing IDs after removeSource can race worker tile tasks. */
export function hideWeather(instance: LibreMap) {
  for (const id of ['weather', 'footprint']) if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility', 'none');
}
export function displayWeather(instance: LibreMap, image: HTMLImageElement, box: MapBox, opacity: number) {
  const coordinates = imageCorners(box);
  if (!instance.getSource('weather')) {
    instance.addSource('weather', { type: 'image', coordinates });
    instance.addLayer({ id: 'weather', type: 'raster', source: 'weather', paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
  }
  // Decode is owned/cancelled by React; MapLibre receives an atomic image/coordinates update.
  (instance.getSource('weather') as ImageSource).updateImage({ image, coordinates });
  const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [...coordinates, coordinates[0]!] } };
  if (!instance.getSource('footprint')) {
    instance.addSource('footprint', { type: 'geojson', data });
    instance.addLayer({ id: 'footprint', type: 'line', source: 'footprint', paint: { 'line-color': '#31425d', 'line-width': 2, 'line-dasharray': [3, 3] } });
  } else (instance.getSource('footprint') as GeoJSONSource).setData(data);
  instance.setPaintProperty('weather', 'raster-opacity', opacity);
  for (const id of ['weather', 'footprint']) instance.setLayoutProperty(id, 'visibility', 'visible');
}
export function InteractiveMap({ regionBox, location, online, overlay, weatherProduct = 'radar-conus', forecast = null, onForecastStatus, libre = null, onLibreStatus, onView, children }: { children?: React.ReactNode; regionBox: MapBox; location: Location | null; online: boolean; weatherProduct?: string; overlay: { url: string; box: MapBox } | null; libre?: LibreSelection | null; onLibreStatus?: (status: LibreStatus) => void; forecast?: ForecastTileSelection | null; onForecastStatus?: (status: ForecastTileStatus) => void; onView: (box: MapBox | null) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const loadedMap = useRef<LibreMap | null>(null);
  const latestLibre = useRef(libre); latestLibre.current = online ? libre : null;
  const retainedLibre = useRef<{id:string; instance:LibreMap; removeProtocol?:()=>void} | null>(null);
  const removeLibre = () => { const old = retainedLibre.current; if (!old) return; if(map.current === old.instance) { if(old.instance.getLayer(old.id)) old.instance.removeLayer(old.id); if(old.instance.getSource(old.id)) old.instance.removeSource(old.id); } old.removeProtocol?.(); retainedLibre.current = null; };
  const completedLibreSource = useRef<string | null>(null);
  const activeLibreSource = useRef<string | null>(null);
  const libreCallback = useRef(onLibreStatus); libreCallback.current = onLibreStatus;
  const activeForecastSource = useRef<string | null>(null);
  const forecastFailed = useRef(false);
  const forecastLatest = useRef(forecast); forecastLatest.current = online ? forecast : null;
  const retainedForecast = useRef<{ id: string; instance: LibreMap; removeProtocol?: () => void } | null>(null);
  const removeRetained = () => {
    const old = retainedForecast.current; if (!old) return;
    if (map.current === old.instance) { if (old.instance.getLayer(old.id)) old.instance.removeLayer(old.id); if (old.instance.getSource(old.id)) old.instance.removeSource(old.id); }
    old.removeProtocol?.(); retainedForecast.current = null;
  };
  const [ready, setReady] = useState(0);
  const forecastCallback = useRef(onForecastStatus); forecastCallback.current = onForecastStatus;
  // Infrared fills every pixel; retain geographic context without changing data.
  // Remember each product independently so adjusting satellite does not dim radar.
  const [productOpacities, setProductOpacities] = useState<Record<string, number>>({});
  const opacity = productOpacities[weatherProduct] ?? (weatherProduct.startsWith('satellite-') ? 0.45 : 0.65);
  const setOpacity = (value: number) => setProductOpacities(previous => ({ ...previous, [weatherProduct]: value }));
  const [error, setError] = useState('');
  const [basemap, setBasemap] = useState<BasemapStatus>(() => ({ kind: initialBasemap(mapboxPublicToken), failed: false, message: '' }));
  const basemapController = useRef<ReturnType<typeof installBasemap> | null>(null);
  const [feedback, setFeedback] = useState('https://apps.mapbox.com/feedback/');
  const [viewError, setViewError] = useState('');
  const [imageError, setImageError] = useState('');
  const [restart, setRestart] = useState(0);
  const opacityRef = useRef(opacity); opacityRef.current = opacity;
  const [weatherReady, setWeatherReady] = useState(false);
  const viewCallback = useRef(onView); viewCallback.current = onView;
  useEffect(() => {
    if (!online || !element.current) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    setError(''); setViewError(''); setImageError(''); setWeatherReady(false); viewCallback.current(null);
    Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([lib]) => {
      if (disposed) return;
      lib.setWorkerUrl('/vendor/maplibre-6.9.0/maplibre-gl-worker.mjs');
      lib.setMaxParallelImageRequests(6);
      const instance = new lib.Map({ container: element.current!, center: [(regionBox[0] + regionBox[2]) / 2, (regionBox[1] + regionBox[3]) / 2], zoom: 3, renderWorldCopies: false, maxZoom: 12, maxPitch: 0, dragRotate: false, touchPitch: false, pitchWithRotate: false, cancelPendingTileRequestsWhileZooming: true, attributionControl: false,
        style: { version: 8, sources: {}, layers: [] } });
      map.current = instance;
      // MapLibre owns a container ResizeObserver already. A second observer
      // doubles resize/movement events and can feed back through loading layout.
      instance.touchZoomRotate.disableRotation();
      instance.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
      instance.addControl(new lib.ScaleControl(), 'top-left');
      instance.addControl(new lib.AttributionControl({ compact: false }), 'bottom-right');
      instance.on('error', event => { if ('sourceId' in event && (String(event.sourceId).startsWith('base-') || String(event.sourceId).startsWith('libre-'))) return; else if ('sourceId' in event && String(event.sourceId).startsWith('forecast-')) { if (event.sourceId === activeForecastSource.current && !forecastFailed.current) forecastCallback.current?.({ loading: false, error: 'Forecast tiles could not be rendered. Use Retry future radar.' }); } else setError('Map rendering issue. Reload Maps to retry.'); });
      let reportedView = ''; let invalidated = false;
      const currentView = () => { const b = instance.getBounds(); return boundedView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); };
      const invalidateChangedView = () => {
        if (!reportedView || invalidated) return;
        let next = ''; try { next = currentView().join(','); } catch { /* unsupported view */ }
        if (next === reportedView) return;
        invalidated = true; hideWeather(instance); setWeatherReady(false); viewCallback.current(null);
      };
      // resize() and even a no-op jumpTo() emit movement events. Only changed
      // geographic bounds invalidate imagery, never parent renders or chart layout.
      instance.on('move', invalidateChangedView);
      const reportView = () => { invalidateChangedView(); clearTimeout(timer); timer = setTimeout(() => {
        if (disposed) return;
        try {
          const next = currentView(); const key = next.join(','); setViewError('');
          const center = instance.getCenter(); setFeedback(basemapFeedback(center.lng, center.lat, instance.getZoom()));
          if (invalidated || key !== reportedView) { reportedView = key; invalidated = false; viewCallback.current(next); }
        } catch { if (!invalidated) viewCallback.current(null); invalidated = true; setViewError('This view crosses supported map bounds. Use Fit region.'); }
      }, 450); };
      instance.on('moveend', reportView);
      instance.on('zoomend', reportView);
      instance.on('resize', reportView);
      instance.on('style.load', () => {
        if (disposed) return;
        loadedMap.current = instance; instance.setMinZoom(1); setReady(n => n + 1); reportView();
        // A real Mapbox logo from their attribution guide, never a recreated wordmark.
        const logo = document.createElement('div'); logo.className = 'maplibregl-ctrl';
        const link = document.createElement('a'); link.href = 'https://www.mapbox.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
        const image = document.createElement('img'); image.src = MAPBOX_LOGO; image.alt = 'Mapbox'; image.width = 88; image.height = 23;
        link.append(image); logo.append(link);
        const control = { onAdd: () => logo, onRemove: () => logo.remove() };
        instance.addControl(control, 'top-left');
        basemapController.current = installBasemap(instance, lib, mapboxPublicToken, status => {
          if (disposed) return;
          logo.style.display = status.kind === 'mapbox' ? '' : 'none';
          setBasemap(status);
        });
      });
      if (location && Math.abs(location.latitude) <= 85) instance.jumpTo({ center: [location.longitude, location.latitude], zoom: 7 });
      else instance.fitBounds([[regionBox[0], regionBox[1]], [regionBox[2], regionBox[3]]], { padding: 24, duration: 0 });
      if (location && Math.abs(location.latitude) <= 85) {
        const marker = new lib.Marker({ color: '#143e73' }).setLngLat([location.longitude, location.latitude]).addTo(instance);
        marker.getElement().setAttribute('aria-label', `Selected city: ${location.name}`);
        marker.getElement().setAttribute('title', location.name);
      }
    }).catch(cause => { if (!disposed) setError(`Interactive map could not start: ${cause instanceof Error ? cause.message : 'unknown rendering error'}`); });
    return () => { disposed = true; clearTimeout(timer); loadedMap.current = null; basemapController.current?.dispose(); basemapController.current = null; map.current?.remove(); map.current = null; };
  }, [online, restart, ...regionBox, location?.id, location?.latitude, location?.longitude]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || loadedMap.current !== instance) return;
    if (!overlay || !online) { hideWeather(instance); setWeatherReady(false); return; }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || map.current !== instance) return;
      try { displayWeather(instance, image, overlay.box, opacityRef.current); setImageError(''); setWeatherReady(true); }
      catch (cause) { hideWeather(instance); setImageError(`Weather rendering failed: ${cause instanceof Error ? cause.message : 'unknown error'}. Refresh the frame to retry.`); }
    };
    image.onerror = () => { if (!cancelled) setImageError('Weather image could not be decoded. Refresh the frame to retry.'); };
    image.src = overlay.url;
    return () => { cancelled = true; image.onload = null; image.onerror = null; if (!image.complete) image.src = '';  };
  }, [overlay?.url, overlay?.box.join(','), ready, online]);
  useEffect(() => {
    const instance = map.current;
    if (!forecast || !online || !instance || loadedMap.current !== instance) return;
    let disposed = false; let completedTile = false; let readyReported = false; const visibleTiles = new Set<string>();
    const id = `forecast-${++forecastSourceSequence}`;
    activeForecastSource.current = id; forecastFailed.current = false;
    const session = forecastTileSession(forecast, status => { if (!disposed) { if (status.error) forecastFailed.current = true; if (!status.loading && !status.error) completedTile = true; if (status.loading || status.error) forecastCallback.current?.(status); } });
    let removeProtocol: (() => void) | undefined;
    const sourceReady = (event: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (!disposed && !readyReported && event.sourceId === id && event.isSourceLoaded && completedTile && !forecastFailed.current) { readyReported = true; removeRetained(); forecastCallback.current?.({ loading: false, error: '', frameId: forecast.id, tileCount: visibleTiles.size }); }
    };
    instance.on('sourcedata', sourceReady);
    void import('maplibre-gl').then(lib => {
      if (disposed) return;
      lib.addProtocol(id, (parameters, controller) => {
        const match = parameters.url.match(new RegExp(`^${id}://(\\d+)/(\\d+)/(\\d+)\\.png$`));
        if (!match) return Promise.reject(new Error('Invalid forecast tile path.'));
        visibleTiles.add(match.slice(1).join('/'));
        return session.load(Number(match[1]), Number(match[2]), Number(match[3]), controller.signal);
      });
      removeProtocol = () => lib.removeProtocol(id);
      hideWeather(instance);
      instance.addSource(id, { type: 'raster', tiles: [`${id}://{z}/{x}/{y}.png`], tileSize: 256, minzoom: 0, maxzoom: 7, bounds: FORECAST_BOUNDS, scheme: 'xyz' });
      instance.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacityRef.current, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
    }).catch(cause => { if (!disposed) forecastCallback.current?.({ loading: false, error: `Forecast map could not start: ${cause instanceof Error ? cause.message : 'unknown error'}` }); });
    return () => {
      disposed = true; if (activeForecastSource.current === id) activeForecastSource.current = null; session.dispose();
      instance.off('sourcedata', sourceReady);
      removeRetained();
      // Keep one completed image layer while the replacement loads. Its session is
      // already cancelled, so retaining the raster cannot start upstream work.
      if (forecastLatest.current && completedTile && map.current === instance && instance.getLayer(id) && instance.isSourceLoaded(id)) {
        retainedForecast.current = { id, instance, removeProtocol };
      } else {
        if (map.current === instance && instance.getLayer(id)) instance.removeLayer(id);
        if (map.current === instance && instance.getSource(id)) instance.removeSource(id);
        removeProtocol?.();
      }
    };
  }, [forecast?.id, forecast?.modelRunTime, ready, online]);
  useEffect(() => {
    const instance = map.current;
    if (!libre || !online || !instance || loadedMap.current !== instance) { removeLibre(); return; }
    let disposed = false; let completed = false; const tiles = new Set<string>();
    const id = `libre-${++forecastSourceSequence}`; activeLibreSource.current = id;
    libreCallback.current?.({loading:true,error:''});
    const session = libreTileSession(libre,status => { if (!disposed) libreCallback.current?.(status); });
    let removeProtocol: (() => void) | undefined;
    const timeout = setTimeout(() => { if (!disposed && !completed) { session.dispose(); libreCallback.current?.({loading:false,error:'LibreWXR visible tiles did not finish loading.'}); } },15000);
    const loaded = (event: {sourceId?:string; isSourceLoaded?:boolean}) => { if (!disposed && event.sourceId === id && event.isSourceLoaded && tiles.size) { completed = true; completedLibreSource.current = id; clearTimeout(timeout); instance.setPaintProperty(id,'raster-opacity',opacityRef.current); removeLibre(); libreCallback.current?.({loading:false,error:'',time:libre.time,tileCount:tiles.size}); } };
    instance.on('sourcedata',loaded);
    void import('maplibre-gl').then(lib => {
      if (disposed) return;
      lib.addProtocol(id,async (parameters,controller) => {
        const match = parameters.url.match(new RegExp(`^${id}://(\\d+)/(\\d+)/(\\d+)\\.png$`));
        if (!match) throw Error('Invalid LibreWXR tile path.');
        const result = await session.load(Number(match[1]),Number(match[2]),Number(match[3]),controller.signal); tiles.add(match[0]); return result;
      });
      removeProtocol = () => lib.removeProtocol(id);
      hideWeather(instance);
      instance.addSource(id,{type:'raster',tiles:[`${id}://{z}/{x}/{y}.png`],tileSize:512,minzoom:0,maxzoom:10,scheme:'xyz',attribution:'LibreWXR · NOAA/IEM · ECMWF'});
      instance.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':0,'raster-fade-duration':0,'raster-resampling':'linear'}});
    }).catch(() => { if (!disposed) libreCallback.current?.({loading:false,error:'LibreWXR map could not start.'}); });
    return () => { disposed = true; clearTimeout(timeout); session.dispose(); instance.off('sourcedata',loaded); if (activeLibreSource.current === id) activeLibreSource.current = null;
      const next = latestLibre.current;
      if (completed && next && next.generated === libre.generated && next.future === libre.future && map.current === instance) { removeLibre(); retainedLibre.current = {id,instance,removeProtocol}; }
      else { if (map.current === instance) { if (instance.getLayer(id)) instance.removeLayer(id); if (instance.getSource(id)) instance.removeSource(id); } removeProtocol?.(); if (!next) removeLibre(); } };
  }, [libre?.time,libre?.generated,libre?.future,online,ready]);
  useEffect(() => { if (map.current?.getLayer('weather')) map.current.setPaintProperty('weather', 'raster-opacity', opacity); const id = activeForecastSource.current; if (id && map.current?.getLayer(id)) map.current.setPaintProperty(id, 'raster-opacity', opacity); const libreId = activeLibreSource.current; if (libreId && completedLibreSource.current === libreId && map.current?.getLayer(libreId)) map.current.setPaintProperty(libreId, 'raster-opacity', opacity); const retained = retainedLibre.current; if(retained && map.current?.getLayer(retained.id)) map.current.setPaintProperty(retained.id,'raster-opacity',opacity); }, [opacity]);
  return <><div className="map-controls">{location && <Button disabled={!online} onClick={() => map.current?.jumpTo({ center: [location.longitude, Math.max(-85, Math.min(85, location.latitude))], zoom: 7 })}>Recenter</Button>}</div>
    {error && <p role="alert" className="notice error">{error} <Button onClick={() => setRestart(n => n + 1)}>Restart map</Button></p>}{viewError && <p role="status" className="notice">{viewError}</p>}{imageError && <p role="alert" className="notice error">{imageError}</p>}{basemap.message && <p role="status" className="notice">{basemap.message} {mapboxPublicToken && basemap.failed && <Button onClick={() => basemapController.current?.select('mapbox')}>Try Mapbox</Button>}</p>}
    {online && <div ref={element} data-weather-ready={weatherReady} data-basemap={basemap.kind} className="interactive-map" role="region" aria-label="Interactive weather map. Use arrow keys to pan and plus or minus to zoom." />}
    <p className="map-attribution">{basemap.kind === 'mapbox' && <>© <a href="https://www.mapbox.com/about/maps" target="_blank" rel="noreferrer">Mapbox</a> · </>}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · <a href={basemap.kind === 'mapbox' ? feedback : 'https://www.openstreetmap.org/fixthemap'} target="_blank" rel="noreferrer">{basemap.kind === 'mapbox' ? 'Improve this map' : 'Report a map issue'}</a> · Weather: {weatherProduct === 'libre-radar' ? 'LibreWXR composite · NOAA/IEM · ECMWF' : forecast ? 'NOAA/NCEP HRRR via IEM' : 'NOAA nowCOAST'}</p>
<details><summary>Map info/settings</summary>{mapboxPublicToken && <Button disabled={!online} onClick={() => basemapController.current?.select(basemap.kind === 'mapbox' ? 'standard' : 'mapbox')}>{basemap.kind === 'mapbox' ? 'Use standard map' : 'Use Mapbox'}</Button>}<Button disabled={!online} onClick={() => map.current?.fitBounds([[regionBox[0], regionBox[1]], [regionBox[2], regionBox[3]]], { padding: 24, duration: 0 })}>Fit region</Button><label>Weather opacity {Math.round(opacity * 100)}%<input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label><p>Dashed boundary: requested image footprint, not radar coverage. North up · latitude limited to ±85° · no date-line wrapping.</p>{children}</details></>;
}
