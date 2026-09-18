import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { StationQuerySchema, StationResponseSchema, type StationQuery, type StationData, type StationValue } from '@zindycast/contracts';
import { requestJson } from './request';
import { StationDiscovery } from './station-discovery';
import { StationVisuals } from './history-visuals';
import { temperature, rain, type Units } from './weather';

const elements = ['TMAX', 'TMIN', 'PRCP'] as const;
type Element = typeof elements[number];
export function stationSelection(stationId: string, startDate: string, endDate: string, now: number): StationQuery {
  const parsed = StationQuerySchema.safeParse({ stationId: stationId.trim().toUpperCase(), startDate, endDate });
  if (!parsed.success || endDate > new Date(now).toISOString().slice(0, 10)) throw new Error('Enter an 11-character US GHCN-Daily station ID and 1–366 valid inclusive source calendar dates, no later than today.');
  return parsed.data;
}
export const sameStationSelection = (a: StationQuery, b: StationQuery) => a.stationId === b.stationId && a.startDate === b.startDate && a.endDate === b.endDate;
export function parseStationResponse(raw: unknown, requested: StationQuery) {
  const response = StationResponseSchema.parse(raw);
  if (!sameStationSelection(response.data.query, requested)) throw new Error('Station response does not match the requested station and dates. Please retry.');
  return response;
}
export const stationUrl = (query: StationQuery) => `/api/v1/stations/history?${new URLSearchParams(query)}`;
const flagText = (flag: string | null) => flag === null ? 'unavailable' : flag === ' ' ? 'blank' : flag;
export function StationCell({ value: v, element, units }: { value: StationValue; element: Element; units: Units }) {
  const quality = v.qcStatus === 'missing' ? 'Missing' : v.qcStatus === 'flagged' ? 'QC flagged — not accepted quality' : v.qcStatus === 'unknown_code' ? 'Unknown quality code — not accepted quality' : 'Blank QC flag — no failed check recorded; accuracy not guaranteed';
  return <><strong>{element === 'PRCP' ? rain(v.value, units) : temperature(v.value, units)}</strong><span className="station-cell-detail">{quality}</span>
    {v.missingReason && <span className="station-cell-detail">{v.missingReason === 'absent_month' ? 'Absent source month/element' : 'Source missing value (-9999)'}</span>}
    {v.trace && <strong className="station-cell-detail">Trace (T) — not an ordinary measured zero</strong>}
    {v.presumedZero && <strong className="station-cell-detail">Missing presumed zero (P) — not ordinary measured rainfall</strong>}
    {v.unknownFlags.length > 0 && <strong className="station-cell-detail">Unknown flag meaning: {v.unknownFlags.join(', ')}</strong>}
    <details><summary>Raw value & flags</summary><p>Raw value: {v.rawValue === null ? 'unavailable' : v.rawValue} ({element === 'PRCP' ? 'tenths mm' : 'tenths °C'}). Measurement: {flagText(v.measurementFlag)}; quality: {flagText(v.qualityFlag)}; source: {flagText(v.sourceFlag)}.</p></details></>;
}
class StationVisualBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="notice">Station chart unavailable. Daily values and flags remain available below.</p> : this.props.children; }
}
export function StationResult({ data, units }: { data: StationData; units: Units }) {
  const p = data.provenance;
  return <><h2>Station {data.station.id} · {data.query.startDate} – {data.query.endDate}</h2>
    <p className="notice">{data.coverage.jointUnflagged}/{data.days.length} source dates have all three values with blank QC flags. Eligibility is not assessed. Counts describe availability and flags, not a quality guarantee or complete measured rainfall.</p>
    <StationVisualBoundary key={`${data.query.stationId}-${data.query.startDate}-${data.query.endDate}-${units}`}><StationVisuals data={data} units={units}/></StationVisualBoundary><details><summary>Coverage & quality counts</summary><div className="table-scroll" tabIndex={0} aria-label="Scrollable station coverage table"><table><caption>Coverage for every requested source date. Flag counts can overlap; trace and presumed-zero counts include missing raw values where flagged.</caption><thead><tr>{['Element', 'Expected', 'Numeric present', 'Missing', 'Absent month/element', 'Source missing', 'Blank QC', 'QC flagged', 'Unknown quality', 'Any unknown flag', 'Trace', 'Presumed zero'].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{elements.map(e => { const c = data.coverage[e]; return <tr key={e}><th scope="row">{e}</th>{[c.expected, c.present, c.missing, c.absentMonth, c.sourceMissing, c.unflagged, c.flagged, c.unknownQuality, c.unknownFlags, c.trace, c.presumedZero].map((n, i) => <td key={i}>{n}</td>)}</tr>; })}</tbody></table></div>
    </details><details><summary>Daily station values & flags</summary><div className="table-scroll" tabIndex={0} aria-label="Scrollable daily station values"><table><caption>Source daily calendar labels; observation time, timezone and interval endpoints unknown. Temperature in °{units === 'us' ? 'F' : 'C'}; precipitation in {units === 'us' ? 'inches' : 'mm'}. — means missing. Flagged numeric values remain visible for inspection and are not accepted-quality observations. No period totals are computed.</caption><thead><tr><th scope="col">Source date</th><th scope="col">TMAX · daily maximum</th><th scope="col">TMIN · daily minimum</th><th scope="col">PRCP · source daily precipitation</th></tr></thead><tbody>{data.days.map(day => <tr key={day.date}><th scope="row">{day.date}</th>{elements.map(e => <td className="station-value" key={e}><StationCell value={day[e]} element={e} units={units}/></td>)}</tr>)}</tbody></table></div>
    </details><details><summary>Station metadata, source & flags documentation</summary><p>Station name, coordinates and elevation: not retrieved. Station relocations, instrument changes and observation schedules have not been retrieved; one identifier does not establish a homogeneous record. No city association or station ranking is provided.</p><p>{p.provider} · {p.dataset} · station daily summaries. Dataset version unavailable. <a href={p.requestUrl} target="_blank" rel="noreferrer">NOAA source file ↗</a> · <a href={p.sourceUrl} target="_blank" rel="noreferrer">NOAA daily format and flags ↗</a></p><p>Retrieved {p.retrievedAt}. Source issue/update times unavailable; retrieval does not establish source freshness. Adapter: {p.adapterVersion}. Raw units: tenths °C and tenths mm; normalized units: °C and mm.</p><p>Source dates have not been converted to UTC instants or the selected city’s local days. Actual accumulation duration and alignment between elements are unknown; daily precipitation is not summed. Observations are not spliced between stations or filled with modeled values.</p></details></>;
}
export function StationPanel({ online, units, now }: { online: boolean; units: Units; now: number }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const [stationId, setStationId] = useState(''); const [start, setStart] = useState(today); const [end, setEnd] = useState(today);
  const [result, setResult] = useState<ReturnType<typeof parseStationResponse> | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null); const generation = useRef(0);
  let selection: StationQuery | null = null; let invalid = '';
  try { selection = stationSelection(stationId, start, end, now); } catch (cause) { invalid = (cause as Error).message; }
  const invalidate = () => { ++generation.current; controller.current?.abort(); setResult(null); setLoading(false); setError(''); };
  useEffect(() => { if (!online) invalidate(); return () => { ++generation.current; controller.current?.abort(); }; }, [online]);
  async function load() {
    if (!selection || !online) return;
    invalidate(); const version = generation.current; const requested = selection;
    const abort = new AbortController(); controller.current = abort; setLoading(true);
    try {
      const response = parseStationResponse(await requestJson(stationUrl(requested), abort.signal), requested);
      if (!abort.signal.aborted && generation.current === version) setResult(response);
    } catch (cause) { if (!abort.signal.aborted && generation.current === version) setError(cause instanceof Error ? cause.message : 'Station history unavailable.'); }
    finally { if (generation.current === version) setLoading(false); }
  }
  const shown = online && selection && result && sameStationSelection(selection, result.data.query) ? result : null;
  return <Card component="section" className="card history-panel station-panel"><p className="eyebrow">Explore past weather · NOAA station daily summaries</p><h1>Station history</h1><p className="subtle">US GHCN-Daily station ID · 1–366 source dates</p><p className="notice">Observation time & accumulation intervals unknown. Discovery metadata is separate from the historical observations.</p><details><summary>Station selection & date limitations</summary><p>Search for metadata candidates or enter an explicit US GHCN-Daily station ID. No station is selected automatically. Nearby catalog metadata does not establish historical site location or coverage.</p><p>Choose 1–366 inclusive source calendar dates. These labels are not UTC instants or confirmed local civil days; observation time and accumulation intervals are unknown. Recent dates may be missing. Hourly station data, station CSV export and station WBGT are not available.</p></details>
    <StationDiscovery online={online} onChoose={id => { invalidate(); setStationId(id); }}/><form onSubmit={e => { e.preventDefault(); void load(); }} onChange={invalidate}><div className="map-controls"><label>US GHCN-Daily station ID<input type="text" autoCapitalize="characters" spellCheck={false} maxLength={11} required value={stationId} onChange={e => setStationId(e.target.value)} placeholder="11-character station ID"/></label><label>Start source date<input type="date" min="0001-01-01" max={today} required value={start} onChange={e => setStart(e.target.value)}/></label><label>End source date<input type="date" min="0001-01-01" max={today} required value={end} onChange={e => setEnd(e.target.value)}/></label><Button type="submit" className="primary" disabled={!selection || !online || loading}>{loading ? 'Loading station…' : 'Load station'}</Button></div></form>
    {invalid && <p role="status">{invalid}</p>}{!online && <p role="status">Offline — station history unavailable. Reconnect and load the station again.</p>}{loading && <p role="status">Loading requested station and source dates…</p>}{error && <p className="notice error" role="alert">{error} Use Load station.</p>}{shown && <StationResult data={shown.data} units={units}/>}
  </Card>;
}
