import { CitySearch, type CitySearchHandle } from './city-search';
import { eligibleCurrent } from './current-conditions';
import { CurrentOverview } from './current-overview';
import { selectObservedCurrent } from './observed-current';
import { useObservations } from './use-observations';
import { initializePagePosition } from './page-position';
import { startRefresh } from './refresh';
import { ThemeProvider, CssBaseline, Tabs, Tab } from '@mui/material';
import { weatherTheme } from './theme';
import { HeatContext, DailyRange } from './dashboard-visuals';
import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActivitySchema, LocationSchema, ResolvedLocationResponseSchema, type Activity, type ForecastResponse, type Location } from '@zindycast/contracts';
import { conditions, astronomyForDate, dayKey, dailySummary, currentHour, dailyGroups, parseForecast, placeLabel, rain, speed, temperature, timeLabel, type Units } from './weather';
import './styles.css';
import './today-layout.css';
import './connected-grid.css';
import './explore-layout.css';
import './comparison-visuals.css';
import './climate-results.css';
import './weather-scene.css';
import './ui-controls.css';
import {skyPhase} from './sky-phase';
import {WeatherIcon,weatherKind,observedWeatherKind,weatherKindAtmosphere,WeatherBackdrop} from './weather-appearance';
import { requestJson } from './request';
import { PwaStatus } from './pwa';
import { AlertsPanel } from './alerts';
import { MapsPanel } from './maps';
import { HistoryPanel } from './history';
import { ComparisonPanel } from './comparison';
import { ClimatePanel } from './climate-panel';
import { ChartBoundary, HourlyChart } from './chart';
import { DailySummary } from './daily-summary';
import { AccuracyPanel, ClimateNormalsPanel, ObservationPanel } from './source-panels';
import { NotificationSettings } from './notifications';
import { usePullToRefresh } from './pull-to-refresh';

type Success = Extract<ForecastResponse, { status: 'success' }>;
type Preferences = { units: Units; activity: Activity; saved: Location[]; selected: Location | null; backgroundMotion: boolean };
const storageKey = 'zindycast.preferences.v1';
const warningHashPrefix = '#warning=';

function notificationLocation(candidate: unknown): Location | null {
  const parsed = LocationSchema.safeParse(candidate);
  if (!parsed.success) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.timezone }); }
  catch { return null; }
  return parsed.data;
}

function loadPreferences(): { preferences: Preferences; warning: string } {
  const defaults: Preferences = { units: 'us', activity: 'walking', saved: [], selected: null, backgroundMotion: typeof matchMedia === 'function' ? !matchMedia('(prefers-reduced-motion: reduce)').matches : true };
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return { preferences: defaults, warning: '' };
    const raw = JSON.parse(value);
    const units: Units = raw.units === 'metric' ? 'metric' : 'us';
    const saved = LocationSchema.array().max(30).parse(raw.saved);
    const selected = raw.selected == null ? null : LocationSchema.parse(raw.selected);
    for (const location of [...saved, ...(selected ? [selected] : [])]) new Intl.DateTimeFormat('en-US', { timeZone: location.timezone });
    return { preferences: { units, saved, selected, activity: ActivitySchema.parse(raw.activity), backgroundMotion: typeof raw.backgroundMotion === 'boolean' ? raw.backgroundMotion : defaults.backgroundMotion }, warning: '' };
  } catch { return { preferences: defaults, warning: 'Saved preferences could not be read. You can still use the app; choices may last only this visit.' }; }
}
initializePagePosition();
const initial = loadPreferences();
function App() {
  const [preferences, setPreferences] = useState(initial.preferences);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [tab, setTab] = useState('Today');
  const [choosingLocation, setChoosingLocation] = useState(!initial.preferences.selected);
  const [forecast, setForecast] = useState<Success | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [legacyCompare, setLegacyCompare] = useState(false);
  const [retry, setRetry] = useState(0);
  const [horizon, setHorizon] = useState(7);
  const [now, setNow] = useState(Date.now());
  const [geoState, setGeoState] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const geoVersion = useRef(0);
  const geoController = useRef<AbortController | null>(null);
  const citySearch = useRef<CitySearchHandle>(null);
  const locationChooser = useRef<HTMLElement>(null);
  const selectionVersion = useRef(0);
  const location = preferences.selected;
  const { units } = preferences;
  const observations = useObservations(location, online, tab === 'Today', retry);
  const observed = selectObservedCurrent(observations.data, location, Math.max(now, observations.checkedAt ?? now));
  const pull = usePullToRefresh(online && !!location, () => setRetry(value => value + 1));
  useEffect(() => {
    if (!choosingLocation || !location) return;
    const frame = requestAnimationFrame(() => {
      locationChooser.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      citySearch.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [choosingLocation, location]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
    catch { setStorageWarning('Your browser could not save preferences. Changes will last only this visit.'); }
  }, [preferences]);
  useEffect(() => {
    const connected = () => { setOnline(true); setRetry(value => value + 1); };
    const disconnected = () => { setOnline(false); setForecast(null); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); ++geoVersion.current; geoController.current?.abort(); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setError('');
    if (!location || !online) { setLoading(false); return; }
    const controller = new AbortController();
    const requested = location, version = selectionVersion.current;
    const params = new URLSearchParams(Object.entries(requested).map(([key, value]) => [key, String(value)]));
    let firstRequest = true;
    const refresh = startRefresh(async () => {
      setLoading(true);
      try {
        const forceRefresh = firstRequest; firstRequest = false;
        const data = parseForecast(await requestJson(`/api/v1/forecast?${params}${forceRefresh ? '&refresh=1' : ''}`, controller.signal), requested);
        if (!controller.signal.aborted && version === selectionVersion.current) { setForecast(data); setError(''); setNow(Date.now()); }
      } catch (cause) {
        if (!controller.signal.aborted && version === selectionVersion.current) {
          setError(`${cause instanceof Error ? cause.message : 'Forecast unavailable.'} Updates will retry automatically.`);
          setForecast(previous => previous ? { ...previous, freshness: 'stale' } : null);
        }
      } finally { if (!controller.signal.aborted && version === selectionVersion.current) setLoading(false); }
    }, () => !document.hidden && navigator.onLine, 300_000);
    const resume = () => { setNow(Date.now()); refresh.wake(); };
    document.addEventListener('visibilitychange',resume); window.addEventListener('focus',resume);
    return () => { refresh.stop(); controller.abort(); document.removeEventListener('visibilitychange',resume); window.removeEventListener('focus',resume); };
  }, [location, retry, online]);
  function select(next: Location) {
    ++selectionVersion.current; citySearch.current?.clear(); ++geoVersion.current; geoController.current?.abort();
    setForecast(null); setError(''); setRetry(value => value + 1); setPreferences(previous => ({ ...previous, selected: next }));
    setGeoState('');
    setChoosingLocation(false);
  }
  useEffect(() => {
    const clearWarningHash = () => {
      if (window.location.hash.startsWith(warningHashPrefix)) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
      }
    };
    const openWarning = (candidate: unknown) => {
      const next = notificationLocation(candidate);
      if (!next) return;
      select(next);
      setTab('Today');
      clearWarningHash();
    };
    if (window.location.hash.startsWith(warningHashPrefix)) {
      try { openWarning(JSON.parse(decodeURIComponent(window.location.hash.slice(warningHashPrefix.length)))); }
      catch {}
      clearWarningHash();
    }
    const onServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as { type?: unknown; location?: unknown };
      if (message.type === 'OPEN_WARNING') openWarning(message.location);
    };
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    return () => {
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
    };
  }, []);
  function locate() {
    if (!navigator.geolocation) { setGeoState('Location is not supported in this browser. Search for your city above.'); return; }
    const version = ++geoVersion.current;
    geoController.current?.abort();
    const controller = new AbortController(); geoController.current = controller;
    setGeoState('Waiting for location permission…');
    navigator.geolocation.getCurrentPosition(async position => {
      if (version !== geoVersion.current) return;
      setGeoState('Finding your location and local time zone…');
      try {
        const params = new URLSearchParams({ latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) });
        const result = ResolvedLocationResponseSchema.parse(await requestJson(`/api/v1/location?${params}`, controller.signal));
        new Intl.DateTimeFormat('en-US', { timeZone: result.location.timezone });
        if (version === geoVersion.current && !controller.signal.aborted) select(result.location);
      } catch (cause) {
        if (version === geoVersion.current && !controller.signal.aborted) setGeoState(`${cause instanceof Error ? cause.message : 'Location lookup failed.'} Search for your city above.`);
      }
    }, () => { if (version === geoVersion.current) setGeoState('Location could not be obtained. Search for your city above.'); }, { timeout: 12_000, maximumAge: 300_000 });
  }

  const data = online ? forecast?.data : undefined;
  const hour = data ? currentHour(data.hours, now) : undefined;
  const zone = location?.timezone ?? 'UTC';
  const daily = data ? dailyGroups(data, now, horizon) : [];
  const upcoming = data?.hours.filter(item => Date.parse(item.time) >= Math.floor(now / 3_600_000) * 3_600_000 && Date.parse(item.time) < Math.floor(now / 3_600_000) * 3_600_000 + 48 * 3_600_000).slice(0, 48) ?? [];
  const astronomy = data ? astronomyForDate(data, dayKey(new Date(now).toISOString(), zone)) : undefined;
  const aged = data ? now - Date.parse(data.provenance.retrievedAt) > 3_600_000 : false;
  const current = eligibleCurrent(data, now, online && forecast?.freshness === 'fresh' && !aged && !error);
  const conditionsNow = current ?? hour;
  const sceneFresh = online && forecast?.freshness === 'fresh' && !aged && !error && !!conditionsNow;
  const sceneKind = observed ? observedWeatherKind(observed.observation.textDescription) : sceneFresh ? weatherKind(conditionsNow?.weatherCode) : 'unknown';
  const actualSkyPhase = skyPhase(now, astronomy, conditionsNow?.isDay, online && (sceneFresh || !!(astronomy?.sunrise && astronomy?.sunset)));
  const bootPhase = document.documentElement.dataset.bootSky;
  const displaySkyPhase = !forecast && !error && ['day','dawn','dusk','night'].includes(bootPhase ?? '') ? bootPhase : actualSkyPhase;
  useEffect(() => {
    if (actualSkyPhase === 'neutral') return;
    const colors = {day:'#d5e5ee',dawn:'#d2dae6',dusk:'#34405e',night:'#101c36'};
    document.documentElement.dataset.bootSky = actualSkyPhase;
    document.documentElement.style.setProperty('--boot-sky', colors[actualSkyPhase]);
    try { localStorage.setItem('zindycast.sky-phase.v1', actualSkyPhase); } catch {}
  }, [actualSkyPhase]);

  const saved = location && preferences.saved.some(item => item.id === location.id && item.latitude === location.latitude && item.longitude === location.longitude);
  const temp = (value: number | null | undefined) => temperature(value, units);
  return <div className="app-shell" data-motion={preferences.backgroundMotion ? 'running' : 'paused'} data-weather={weatherKindAtmosphere(sceneKind, conditionsNow?.isDay)} data-weather-kind={sceneKind} data-sky-phase={displaySkyPhase} data-pulling={pull.distance > 0 ? 'true' : undefined} style={{ '--pull-distance': `${pull.distance}px` } as React.CSSProperties}>
    <div className="pull-refresh-indicator" role="status" aria-live="polite">{loading || observations.busy ? 'Refreshing weather…' : pull.ready ? 'Release to refresh' : 'Pull to refresh'}</div>
    <WeatherBackdrop />
    <a className="skip-link" href="#main">Skip to weather</a>
    <header className="masthead"><a className="brand" href="#main" onClick={() => setTab('Today')}><span className="brand-mark" aria-hidden="true">◒</span><span>ZindyCast<small>Weather beyond temperature</small></span></a><div className="header-controls"><div className="units" aria-label="Temperature units"><Button aria-pressed={units === 'us'} onClick={() => setPreferences(p => ({ ...p, units: 'us' }))}>°F</Button><Button aria-pressed={units === 'metric'} onClick={() => setPreferences(p => ({ ...p, units: 'metric' }))}>°C</Button></div></div></header>
    <Tabs className="navigation" value={tab} onChange={(_, value: string) => setTab(value)} variant="scrollable" scrollButtons="auto" aria-label="Main navigation">{['Today', 'Maps', 'History', 'Compare', 'Settings'].map(item => <Tab key={item} value={item} label={item} id={`tab-${item}`} aria-controls="active-panel" />)}</Tabs>
    {location && <section className="selected-place-header" aria-label="Selected place"><div><h1>{location.name}</h1><p>{[location.admin2, location.admin1, location.country].filter(Boolean).join(' · ')}</p><p className="subtle">{timeLabel(new Date(now).toISOString(), zone, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {zone}</p></div><div className="selected-place-actions"><Button className="outline" aria-label={saved ? `Remove ${location.name} from saved places` : `Save ${location.name}`} disabled={!saved && preferences.saved.length >= 30} onClick={() => setPreferences(p => ({ ...p, saved: saved ? p.saved.filter(item => !(item.id === location.id && item.latitude === location.latitude && item.longitude === location.longitude)) : [...p.saved, location] }))}><span className="wide-action-label">{saved ? '★ Saved · remove' : '☆ Save place'}</span><span className="short-action-label" aria-hidden="true">{saved ? '★ Saved' : '☆ Save'}</span></Button><Button className="outline change-location" aria-label={choosingLocation ? 'Close location chooser' : 'Change location'} aria-controls="location-chooser" aria-expanded={choosingLocation} onClick={() => setChoosingLocation(value => !value)}><span className="wide-action-label">{choosingLocation ? 'Close location chooser' : 'Change location'}</span><span className="short-action-label" aria-hidden="true">{choosingLocation ? 'Close' : 'Change location'}</span></Button></div></section>}
    {(!location || choosingLocation) && <Card ref={locationChooser} id="location-chooser" component="section" className="location-tools" aria-label="Choose a location"><CitySearch ref={citySearch} onSelect={select} /><div className="location-actions"><Button className="locate-button" onClick={locate}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>Use my location</Button></div></Card>}
    {geoState && <p className="notice" role="status">{geoState}</p>}{storageWarning && <p className="notice" role="status">{storageWarning}</p>}
    {choosingLocation && preferences.saved.length > 0 && <div className="saved-places" aria-label="Saved places">{preferences.saved.map(item => <Button key={`${item.id}-${item.latitude}`} onClick={() => select(item)}>{item.name}<span>{item.admin1}</span></Button>)}</div>}
    <PwaStatus persist={() => { try { localStorage.setItem(storageKey, JSON.stringify(preferences)); return true; } catch { return false; } }} />

    {!online && <p className="notice" role="status">You’re offline. Weather is unavailable; your saved places and settings remain accessible. Reconnect to the internet and your private network to refresh.</p>}
    <main id="main" tabIndex={-1}><div id="active-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} style={{ display: 'contents' }}>
      <ClimatePanel saved={preferences.saved} online={online} active={tab === 'Compare'} units={units} now={now} />
      {tab === 'Compare' && <details className="legacy-compare" open={legacyCompare} onToggle={event => setLegacyCompare(event.currentTarget.open)}><summary>Earlier comparison tool and saved results</summary>{legacyCompare && <ComparisonPanel saved={preferences.saved} online={online} active units={units} now={now} />}</details>}
      {tab === 'Compare' ? null : tab === 'Settings' ? <Card component="section" className="card settings"><p className="eyebrow">Make it yours</p><h1>Settings</h1><h2>This installation</h2><p>Units, activity and saved places stay in this browser. Clearing browser storage removes them. There are no accounts or cross-device syncing.</p><label>Display units <select value={units} onChange={e => setPreferences(p => ({ ...p, units: e.target.value as Units }))}><option value="us">Fahrenheit · mph · inches</option><option value="metric">Celsius · km/h · millimeters</option></select></label><h2>Appearance</h2><p>Weather animation is decorative and never changes the forecast. Your operating system’s reduced-motion preference always disables it.</p><Button className="outline background-toggle" aria-pressed={!preferences.backgroundMotion} onClick={() => setPreferences(p => ({ ...p, backgroundMotion: !p.backgroundMotion }))}>{preferences.backgroundMotion ? 'Pause weather animation' : 'Animate weather background'}</Button><h2>Saved places</h2>{preferences.saved.length ? preferences.saved.map(item => <div className="saved-setting" key={item.id}><span>{placeLabel(item)}</span><Button onClick={() => setPreferences(p => ({ ...p, saved: p.saved.filter(s => s !== item) }))}>Remove<span className="sr-only"> {item.name}</span></Button></div>) : <p>No saved places yet. Select a city and choose Save place.</p>}<NotificationSettings saved={preferences.saved} online={online} /></Card> : tab === 'Maps' ? <MapsPanel key={`${location?.latitude},${location?.longitude}`} location={location} online={online} now={now} /> : tab === 'History' ? <><HistoryPanel key={`${location?.latitude},${location?.longitude}`} location={location} online={online} units={units} now={now} /><Card component="section" className="card history-panel"><ClimateNormalsPanel online={online} units={units} /></Card></> : tab !== 'Today' ? <Card component="section" className="card coming-soon"><p className="eyebrow">More ways to see your weather</p><h1>{tab}</h1><p>{tab === 'Maps' ? 'Radar, satellite and weather layers are forthcoming. Map coverage and timestamps will be shown with each layer.' : tab === 'History' ? 'Historical browsing and CSV exports are forthcoming. Station observations and modeled reanalysis will be kept distinct.' : 'Seasonal city comparisons are forthcoming. Comparisons will use consistent sources, periods and completeness checks.'}</p><Button className="primary" onClick={() => setTab('Today')}>Back to today</Button></Card> : <>
      {loading && !forecast && <div className="notice" role="status">Loading weather for {location?.name}…</div>}{error && <div className="notice error" role="alert">{error} <Button onClick={() => setRetry(value => value + 1)}>Retry forecast</Button></div>}
      {!location ? <Card component="section" className="welcome card"><div className="sun-art" aria-hidden="true">☀</div><h2>A little more weather wisdom.</h2><p>Feels-like temperature, humidity and the forecast ahead, together in one place. Choose your city above; weather will come from the live service.</p></Card> : online && <>
      {data && (forecast?.freshness === 'stale' || aged) && <div className="notice" role="status">Previously retrieved forecast — it may be out of date. Retrieved {timeLabel(data.provenance.retrievedAt, zone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. <Button onClick={() => setRetry(value => value + 1)}>Refresh</Button></div>}
      <nav className="forecast-jumps" aria-label="Forecast sections"><a href="#current">Now</a><a href="#hourly">Hourly</a><a href="#daily">Daily</a><a href="#today-radar">Radar</a></nav><div className="dashboard-grid"><Card component="section" className="hero card" id="current" tabIndex={-1}><CurrentOverview forecast={data} observed={observed} units={units} zone={zone} now={Math.max(now, observations.checkedAt ?? now)} fresh={online && forecast?.freshness === 'fresh' && !aged && !error} busy={loading} stationBusy={observations.busy} stationError={observations.error} stationCheckedAt={observations.checkedAt} refresh={() => setRetry(value => value + 1)} />{data && <><p className="subtle">Outdoor heat estimate · hourly weather model</p><HeatContext hour={hour} hours={upcoming} units={units} now={now} zone={zone} online={online} freshness={forecast?.freshness ?? 'stale'} aged={aged} provenance={data.provenance} /></>}</Card>
      {data && <>

      <AlertsPanel key={`${location.latitude},${location.longitude}`} location={location} online={online} now={now} />
      <Card component="section" className="card daily-summary-card"><DailySummary forecast={data} upcoming={upcoming} units={units} now={now} /></Card>
      <div className="today-map" id="today-radar" tabIndex={-1}><MapsPanel compact key={`${location.latitude},${location.longitude}`} location={location} online={online} now={now} /></div>
      <Card component="section" className="card hourly-card" id="hourly" tabIndex={-1}><div className="section-top"><div><p className="eyebrow">Hour by hour</p><h2>Next 48 hours</h2></div><span className="subtle">{upcoming.length} available hours</span></div><ChartBoundary key={`${location.id}-${units}`}><HourlyChart hours={upcoming} units={units} zone={zone} /></ChartBoundary><details><summary>Hourly forecast table</summary><div className="table-scroll" tabIndex={0} aria-label="Scrollable hourly forecast"><table><caption>Local times in {zone}; zone abbreviations distinguish daylight-saving transitions. Rain chance covers the preceding hour. Temperatures and dew point are in °{units === 'us' ? 'F' : 'C'}.</caption><thead><tr><th scope="col">Time</th><th scope="col">Air</th><th scope="col">Feels like</th><th scope="col">Humidity</th><th scope="col">Rain chance</th><th scope="col">Dew point</th><th scope="col">Wind</th></tr></thead><tbody>{upcoming.map(item => <tr key={item.time}><th scope="row">{timeLabel(item.time, zone, { weekday: 'short', hour: 'numeric', timeZoneName: 'short' })}</th><td>{temp(item.temperatureC)}</td><td className="emphasis">{temp(item.apparentTemperatureC)}</td><td>{item.humidityPercent == null ? '—' : `${item.humidityPercent}%`}</td><td>{item.precipitationProbability == null ? '—' : `${item.precipitationProbability}%`}</td><td>{temp(item.dewPointC)}</td><td>{speed(item.windSpeedMs, units)}</td></tr>)}</tbody></table></div></details></Card>
      <Card component="section" className="card outlook" id="daily" tabIndex={-1}><div className="section-top"><div><p className="eyebrow">The days ahead</p><h2>Daily outlook</h2></div><div className="segmented" aria-label="Forecast horizon">{[7, 10, 14].map(days => <Button key={days} aria-pressed={horizon === days} onClick={() => setHorizon(days)}>{days} days</Button>)}</div></div><p className="subtle">Daily rain chance is the highest probability among the day’s hourly forecast intervals; it is not the chance of rain at any point in the whole day.</p><div className="daily-list">{daily.map(day => { const summary = dailySummary(day.hours, day.rainHours, zone); return <div className="daily-row forecast-day" key={day.key}><div className="forecast-day-date"><strong>{timeLabel(day.hours[0]!.time, zone, { weekday: 'short' })}</strong><small>{timeLabel(day.hours[0]!.time, zone, { month: 'short', day: 'numeric' })}</small></div><div className="forecast-day-condition"><WeatherIcon code={summary.weatherCode} isDay={1} label={summary.condition}/><strong>{summary.condition}</strong>{summary.partial && <small>Partial forecast</small>}</div><div className="daily-temperatures"><strong><small>High</small>{temp(day.high)}</strong><DailyRange low={day.low} high={day.high} days={daily} /><span><small>Low</small>{temp(day.low)}</span></div><div className="forecast-day-rain"><small>Highest hourly rain chance</small><strong>{summary.rainChance == null ? 'Unavailable' : `${summary.rainChance}%`}</strong></div><div className="forecast-day-wind"><small>Highest hourly wind · 10 m</small><span>{summary.windMax == null ? 'Unavailable' : speed(summary.windMax, units)}</span></div></div>; })}</div>{daily.length < horizon && <p className="notice">Only {daily.length} days are available.</p>}</Card>
      <Card component="section" className="card observations-card"><ObservationPanel location={location} online={online} units={units} shared={observations} /><AccuracyPanel location={location} online={online} units={units} /></Card>
      </>}
      </div>{data && <details className="source-details"><summary>Forecast sources & timing</summary><p>{data.provenance.provider} · {data.provenance.dataset} · {data.provenance.classification}. {data.provenance.attribution}</p><p>Retrieved {data.provenance.retrievedAt}. Source issue time: {data.provenance.sourceIssuedAt ?? 'not provided'}. Retrieval time is not a model issue time.</p><p>Requested coordinates: {data.location.latitude}, {data.location.longitude}. Source grid: {data.provenance.sourceCoordinates.latitude}, {data.provenance.sourceCoordinates.longitude}.</p><p>{data.intervalSemantics}. Missing source fields: {data.missingFields.join(', ') || 'none reported'}.</p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo ↗</a></details>}
      </>}
      </>}
    </div></main><footer><a href="https://open-meteo.com/">Weather / geocoding: Open-Meteo</a><a href="https://www.geonames.org/">Location data: GeoNames</a><a href="/notices/argonne-wbgt.txt">WBGT software notice</a><strong>ZindyCast</strong><span>A clearer picture of your weather.</span><span>Forecast estimates · no safe-exposure countdowns</span></footer>
  </div>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<React.StrictMode><ThemeProvider theme={weatherTheme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>);
