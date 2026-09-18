import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { renderReanalysisCsv, ReanalysisQuerySchema, ReanalysisResponseSchema, type ReanalysisData, type ReanalysisQuery, type Location } from '@zindycast/contracts';
import { requestJson } from './request';
import { temperature, speed, rain, placeLabel, type Units } from './weather';
import { StationPanel } from './stations';
import { HistoryVisuals } from './history-visuals';

const DAY = 86_400_000;
export const latestHistoryDate = (now: number) => new Date(now - 5 * DAY).toISOString().slice(0, 10);
export function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return { startDate: '', endDate: '' };
  const startDate = `${month}-01`; const start = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 7) !== month) return { startDate: '', endDate: '' };
  start.setUTCMonth(start.getUTCMonth() + 1);
  return { startDate, endDate: new Date(start.getTime() - DAY).toISOString().slice(0, 10) };
}
export function historySelection(location: Pick<Location, 'latitude' | 'longitude'>, startDate: string, endDate: string, now: number): ReanalysisQuery {
  const parsed = ReanalysisQuerySchema.safeParse({ latitude: location.latitude, longitude: location.longitude, startDate, endDate });
  if (!parsed.success || endDate > latestHistoryDate(now)) throw new Error(`Choose 1–31 inclusive UTC days between 1940-01-01 and ${latestHistoryDate(now)}.`);
  return parsed.data;
}
export const sameSelection = (a: ReanalysisQuery, b: ReanalysisQuery) => a.latitude === b.latitude && a.longitude === b.longitude && a.startDate === b.startDate && a.endDate === b.endDate;
export function parseHistory(raw: unknown, selection: ReanalysisQuery) {
  const response = ReanalysisResponseSchema.parse(raw);
  if (!sameSelection(response.data.query, selection)) throw new Error('History does not match the requested city and UTC dates. Please retry.');
  return response;
}
export function historyUrl(selection: ReanalysisQuery, name: string, format: 'json' | 'csv') {
  // CSV content and cell escaping are server-owned; additionally neutralize risky labels in this request.
  const safeName = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const params = new URLSearchParams({ ...Object.fromEntries(Object.entries(selection).map(([k, v]) => [k, String(v)])), name: /^[=+\-@]/.test(safeName) ? `'${safeName}` : safeName, format });
  return `/api/v1/history?${params}`;
}
export function completenessText(data: ReanalysisData) {
  const c = data.completeness;
  return `${c.status === 'complete' ? 'Complete returned series' : c.status === 'no_data' ? 'No data returned' : 'Partial returned series'}: ${c.completeHours}/${c.expectedHours} hours have all five fields; ${c.sourceHours} source hours, ${c.missingHours} missing source hours. Completeness is availability, not an accuracy assessment.`;
}
export function HistoryChart({ data, units }: { data: ReanalysisData; units: Units }) { return <HistoryVisuals data={data} units={units}/>; }
class HistoryChartBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="notice">Chart unavailable. The history table remains available below.</p> : this.props.children; }
}
export function HistoryResult({ data, units }: { data: ReanalysisData; units: Units }) {
  const p = data.provenance;
  return <><p className="subtle">Modeled reanalysis · UTC · {data.completeness.status === 'complete' ? 'Complete returned series' : data.completeness.status === 'no_data' ? 'No data returned' : 'Partial returned series'} · {data.completeness.completeHours}/{data.completeness.expectedHours} hours with all fields</p><details><summary>Data availability</summary><p>{completenessText(data)}</p><p>Valid values / {data.completeness.expectedHours} expected: air {data.completeness.validCounts.temperatureC}, humidity {data.completeness.validCounts.humidityPercent}, precipitation {data.completeness.validCounts.precipitationMm}, wind {data.completeness.validCounts.windSpeedMs}, dew point {data.completeness.validCounts.dewPointC}.</p></details><HistoryChartBoundary key={`${data.query.startDate}-${data.query.endDate}-${units}`}><HistoryChart data={data} units={units}/></HistoryChartBoundary><details><summary>Hourly modeled history table</summary><div className="table-scroll" tabIndex={0} aria-label="Scrollable history table"><table><caption>UTC timestamps, not local calendar days. Air/dew point in °{units === 'us' ? 'F' : 'C'}. Precipitation covers the preceding hour ending at each timestamp; the first interval starts on the prior UTC date. No calendar-day rainfall total is implied. — means missing.</caption><thead><tr>{['Time (UTC)', 'Air', 'Humidity', 'Preceding-hour rain', 'Wind (10 m)', 'Dew point', 'Availability'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{data.hours.map(h => <tr key={h.time}><th scope="row">{h.time.slice(0, 16).replace('T', ' ')}Z</th><td>{temperature(h.temperatureC, units)}</td><td>{h.humidityPercent === null ? '—' : `${h.humidityPercent}%`}</td><td>{rain(h.precipitationMm, units)}</td><td>{speed(h.windSpeedMs, units)}</td><td>{temperature(h.dewPointC, units)}</td><td>{!h.sourceHourPresent ? 'Missing source hour' : h.missingFields.length ? `Missing: ${h.missingFields.join(', ')}` : 'All five fields'}</td></tr>)}</tbody></table></div></details><details><summary>Sources and calculation method</summary><p>{p.attribution}. <a href={p.sourceUrl} target="_blank" rel="noreferrer">Historical API documentation ↗</a></p><p>Dataset: {p.dataset}; requested model: {p.requestedModel}. Classification: modeled reanalysis. Constituent model is not independently reported.</p><p>Requested coordinates: {data.query.latitude}, {data.query.longitude}. Source coordinates: {p.sourceCoordinates.latitude}, {p.sourceCoordinates.longitude}. Source elevation: {p.sourceElevationM === null ? 'unavailable' : `${p.sourceElevationM} m`}. Cell selection: {p.cellSelection}; downscaling: {p.downscaling}.</p><p>Retrieved {p.retrievedAt}. Source issue/update times unavailable; retrieval is not source freshness. Method: {p.calculationVersion}. Internal/export units: °C, %, mm and m/s. Interval semantics: {data.intervalSemantics}.</p></details></>;
}
export function HistoryPanel({ location, online, units, now }: { location: Location | null; online: boolean; units: Units; now: number }) {
  const [source, setSource] = useState('reanalysis');
  return <><Card component="section" className="card"><label>History source<select value={source} onChange={e => setSource(e.target.value)}><option value="reanalysis">Modeled reanalysis · city coordinates</option><option value="station">Station daily summaries · explicit station ID</option></select></label>{source === 'station' && <p className="subtle">Station selection is independent of the selected city. No nearest station is chosen or associated automatically.</p>}</Card>{source === 'station' ? <StationPanel online={online} units={units} now={now}/> : <ReanalysisPanel location={location} online={online} units={units} now={now}/>}</>;
}
function ReanalysisPanel({ location, online, units, now }: { location: Location | null; online: boolean; units: Units; now: number }) {
  const latest = latestHistoryDate(now);
  const [mode, setMode] = useState('day'); const [day, setDay] = useState(latest); const [month, setMonth] = useState(latest.slice(0, 7));
  const [start, setStart] = useState(latest); const [end, setEnd] = useState(latest);
  const [result, setResult] = useState<{ response: ReturnType<typeof parseHistory>; name: string } | null>(null);
  const exportUrls = useRef<string[]>([]);
  useEffect(() => () => { exportUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => { if (!online) { setResult(null); } }, [online]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null); const generation = useRef(0);
  const dates = mode === 'month' ? monthRange(month) : { startDate: mode === 'day' ? day : start, endDate: mode === 'day' ? day : end };
  let selection: ReanalysisQuery | null = null; let invalid = '';
  if (location) { try { selection = historySelection(location, dates.startDate, dates.endDate, now); } catch (cause) { invalid = (cause as Error).message; } }
  const invalidate = () => { ++generation.current; controller.current?.abort(); setLoading(false); setError(''); };
  useEffect(() => { if (!online) { ++generation.current; controller.current?.abort(); setLoading(false); } return () => { ++generation.current; controller.current?.abort(); }; }, [online]);
  async function load() {
    if (!selection || !location || !online) return;
    invalidate(); const version = generation.current; const abort = new AbortController(); controller.current = abort;
    const requested = selection, name = placeLabel(location); setLoading(true); setResult(null);
    try { const response = parseHistory(await requestJson(historyUrl(requested, name, 'json'), abort.signal), requested); if (!abort.signal.aborted && version === generation.current) setResult({ response, name }); }
    catch (cause) { if (!abort.signal.aborted && version === generation.current) setError(cause instanceof Error ? cause.message : 'History unavailable.'); }
    finally { if (version === generation.current) setLoading(false); }
  }
  function download() {
    if (!result || !online) return;
    const selected = result; setError('');
    try {
      const blob = new Blob([renderReanalysisCsv(selected.response.data, selected.name.slice(0, 200))], { type: 'text/csv;charset=utf-8' });
      exportUrls.current.forEach(url => URL.revokeObjectURL(url));
      const url = URL.createObjectURL(blob); exportUrls.current = [url];
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `zindycast-history-${selected.response.data.query.startDate}-${selected.response.data.query.endDate}.csv`; document.body.append(anchor); anchor.click(); anchor.remove();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'CSV export unavailable.'); }
  }
  const shown = online ? result : null;
  const changed = shown && (!selection || !sameSelection(shown.response.data.query, selection));
  return <Card component="section" className="card history-panel"><p className="eyebrow">Explore past weather · modeled reanalysis</p><h1>History</h1><p>{location ? placeLabel(location) : 'Choose a city above to explore its history.'}</p><p className="subtle">ERA5 modeled history · UTC dates · no WBGT or wet-bulb</p><details><summary>Dataset & date limits</summary><p>ERA5 requested via Open-Meteo. These are modeled grid values, not station observations. All selections and timestamps use UTC, not {location?.timezone ?? 'local time'}. WBGT and wet-bulb are not supplied.</p><p>Available: 1940-01-01 through {latest}; up to 31 days. A month must fit entirely within the window. Year views and longer jobs are forthcoming.</p></details><form onSubmit={e => { e.preventDefault(); void load(); }} onChange={invalidate}><div className="map-controls"><label>Range<select value={mode} onChange={e => setMode(e.target.value)}><option value="day">Day</option><option value="month">Month</option><option value="custom">Custom · up to 31 days</option></select></label>{mode === 'day' ? <label>UTC date<input type="date" min="1940-01-01" max={latest} required value={day} onChange={e => setDay(e.target.value)}/></label> : mode === 'month' ? <label>UTC month<input type="month" min="1940-01" max={latest.slice(0, 7)} required value={month} onChange={e => setMonth(e.target.value)}/></label> : <><label>Start UTC date<input type="date" min="1940-01-01" max={latest} required value={start} onChange={e => setStart(e.target.value)}/></label><label>End UTC date<input type="date" min="1940-01-01" max={latest} required value={end} onChange={e => setEnd(e.target.value)}/></label></>}<Button type="submit" className="primary" disabled={!selection || !online || loading}>{loading ? 'Loading history…' : 'Load history'}</Button></div></form>{invalid && <p role="status">{invalid}</p>}{!online && <p role="status">Offline — history and exports are unavailable. Reconnect and load history again.</p>}{loading && <p role="status">Loading selected UTC history…</p>}{error && <p className="notice error" role="alert">{error} Use Load history.</p>}{shown && <><h2>{shown.name} · {shown.response.data.query.startDate} – {shown.response.data.query.endDate} UTC</h2>{changed && <p className="notice">Inputs changed. The result and CSV below still refer to the displayed dates. Load history to apply your new selection.</p>}{shown.response.freshness === 'stale' && <p className="notice">Previously retrieved history marked stale by the service. Reload to request a refresh.</p>}<p><Button className="outline" onClick={download}>Download history CSV</Button> · SI units regardless of display preference. Exports exactly the displayed data snapshot, including missing values and retrieval metadata; no new provider request.</p><HistoryResult data={shown.response.data} units={units}/></>}</Card>;
}
