import { ComparisonVisuals } from './comparison-visuals';
import {CityPicker} from './city-picker';
import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { ComparisonQuerySchema, type Location } from '@zindycast/contracts';
import { comparisonLocation, comparisonSelection, fields, installationStore, latestComparisonDate, parseComparison, sameComparison, type ComparisonJob, type ComparisonQuery, type ComparisonResult } from './comparison-model';
import { requestJson } from './request';
import { ComparisonDownload } from './comparison-export';
import { placeLabel, rain, type Units } from './weather';
import { metricLabel, metricValue } from './metric-display';
const jobKey = 'zindycast.comparison-job.v1';
type Ticket = { id: string; expiresAt: number; query: ComparisonQuery };
const terminal = (job: ComparisonJob) => ['completed', 'failed', 'cancelled'].includes(job.state);
const labels = { temperatureC: metricLabel('temperatureC'), dewPointC: metricLabel('dewPointC'), humidityPercent: metricLabel('humidityPercent'), windSpeedMs: metricLabel('windSpeedMs'), precipitationMm: 'Preceding-hour precipitation' };
export function comparisonValue(field: typeof fields[number], value: number | null, units: Units) {
  return metricValue(field, value, units, 'detail', '—');
}
export function ComparisonResults({ result: r, units }: { result: ComparisonResult; units: Units }) {
  return <><ComparisonVisuals result={r} units={units}/><details><summary>Detailed values and comparison method</summary><ComparisonDownload result={r}/><p className="notice">Cities may have different missing hours. Available-value means are not rankings or safety guidance.</p><details><summary>How to read the comparison</summary><p>Available-value summaries can cover different hours in each city. Shared valid counts describe the intersection; means below are not recalculated over that intersection. Missing data must not be interpreted as a cooler, drier or safer climate. No city rankings are inferred.</p></details><p>{r.plan.window.expectedHours} expected hourly slots per city. Equal hourly weights; leap day retained. Air/dew point: °{units === 'us' ? 'F' : 'C'}; wind: {units === 'us' ? 'mph' : 'km/h'}; rain: {units === 'us' ? 'in' : 'mm'}. — means unavailable.</p><div className="table-scroll" tabIndex={0} aria-label="Scrollable comparison summary"><table><caption>ERA5 requested · modeled reanalysis · {r.plan.query.startDate} through {r.plan.query.endDate}, inclusive UTC dates. Instant samples use start-inclusive/end-exclusive timestamps; rain uses whole preceding-hour intervals contained in that window.</caption><thead><tr><th scope="col">Variable / shared valid slots</th>{r.locations.map(l => <th scope="col" key={l.location.id}>{l.location.name}<small>{l.location.latitude}, {l.location.longitude}</small></th>)}</tr></thead><tbody>{fields.map(f => <tr key={f}><th scope="row">{labels[f]}<small>{r.commonValidCounts[f]}/{r.plan.window.expectedHours} shared valid</small></th>{r.locations.map(l => { const v = l.variables[f]; return <td key={l.location.id}><strong>{v.status === 'no_data' ? 'No data' : v.status === 'partial' ? 'Partial' : 'Complete'}</strong><div>Mean {comparisonValue(f, v.mean, units)}</div><div>Min {comparisonValue(f, v.min, units)} · max {comparisonValue(f, v.max, units)}</div><small>{v.validCount}/{v.expectedCount} valid; {v.missingCount} missing ({v.absentSourceCount} absent source, {v.nullValueCount} null values)</small>{f === 'precipitationMm' && <><div>Available-interval sum: {rain(l.variables.precipitationMm.sumAvailableMm, units)}</div><div>Complete-window total: {rain(l.variables.precipitationMm.totalMm, units)}</div></>}</td>; })}</tr>)}</tbody></table></div></details><details><summary>Sources and calculation provenance</summary><p>Weather data by Open-Meteo; ERA5 by Copernicus Climate Change Service (C3S) / ECMWF. Requested model ERA5; constituent model not independently reported. Method {r.calculationVersion}. No WBGT, ordinary wet-bulb or station observations. Retrieval dates are not source issue dates.</p><a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Historical weather documentation ↗</a>{r.locations.map(l => <Card component="section" key={l.location.id}><h3>{l.location.name}</h3>{l.sources.map(s => <p key={s.chunkId}>{s.query.startDate} – {s.query.endDate} UTC: requested {s.query.latitude}, {s.query.longitude}; source grid {s.provenance.sourceCoordinates.latitude}, {s.provenance.sourceCoordinates.longitude}; elevation {s.provenance.sourceElevationM === null ? 'unavailable' : `${s.provenance.sourceElevationM} m`}; land selection, provider default elevation adjustment. Retrieved {s.provenance.retrievedAt}; source issue/update times unavailable. Adapter {s.provenance.calculationVersion}.</p>)}</Card>)}</details></>;
}
export function ComparisonPanel({ saved, online, active, units, now }: { saved: Location[]; online: boolean; active: boolean; units: Units; now: number }) {
  const [added,setAdded]=useState<Location[]>([]);
  const choices=[...new Map([...saved,...added].map(l=>[comparisonLocation(l).id,l])).values()];
  const [selected, setSelected] = useState<string[]>([]); const [start, setStart] = useState(latestComparisonDate(now)); const [end, setEnd] = useState(latestComparisonDate(now));
  const [ticket, setTicket] = useState<Ticket | null>(null); const [job, setJob] = useState<ComparisonJob | null>(null);
  const [error, setError] = useState(''); const [warning, setWarning] = useState(''); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const controller = useRef<AbortController | null>(null); const generation = useRef(0); const store = useRef<ReturnType<typeof installationStore> | null>(null);
  const eligible = active && online && visible;
  const chosenCount = choices.filter(l => selected.includes(comparisonLocation(l).id)).length;
  const latest = latestComparisonDate(now); const expired = !!ticket && ticket.expiresAt <= now;
  let query: ComparisonQuery | null = null; let invalid = '';
  try { query = comparisonSelection(choices.filter(l => selected.includes(comparisonLocation(l).id)), start, end, now); } catch (cause) { invalid = (cause as Error).message; }
  function access() { try { return store.current ??= installationStore(localStorage); } catch { throw new Error('Browser storage cannot be accessed. Installation settings and job access cannot be retained; enable storage before creating a comparison.'); } }
  function remember(next: Ticket) {
    setTicket(next);
    try { localStorage.setItem(jobKey, JSON.stringify(next)); if (localStorage.getItem(jobKey) !== JSON.stringify(next)) throw new Error(); }
    catch { setWarning('This job remains available in this tab, but its reference could not be saved. Reloading or clearing browser data may lose job access. No new installation will be registered automatically.'); }
  }
  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState !== 'hidden'); document.addEventListener('visibilitychange', visibility);
    try { const raw = localStorage.getItem(jobKey); if (raw) { const t = JSON.parse(raw) as Ticket; const q = ComparisonQuerySchema.safeParse(t.query); if (!q.success || typeof t.id !== 'string' || !/^[a-f0-9-]{36}$/.test(t.id) || !Number.isSafeInteger(t.expiresAt) || t.expiresAt > 8.64e15 || t.expiresAt < 0) throw new Error(); setTicket({ id: t.id, query: q.data, expiresAt: t.expiresAt }); } }
    catch { setWarning('The saved comparison reference is unavailable. Browser storage loss can remove installation settings and job access.'); }
    return () => { document.removeEventListener('visibilitychange', visibility); ++generation.current; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (!eligible) { ++generation.current; controller.current?.abort(); setBusy(false); } }, [eligible]);
  useEffect(() => {
    if (!eligible || !ticket || expired || busy || (job && terminal(job))) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const version = ++generation.current; const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    async function poll() {
      if (stopped || abort.signal.aborted || ticket!.expiresAt <= Date.now()) return;
      try {
        const bearer = access().existing(Date.now()); if (!bearer) throw new Error();
        const next = parseComparison(await requestJson(`/api/v1/comparisons/${encodeURIComponent(ticket!.id)}`, abort.signal, 20_000, { bearer }), ticket!.query, ticket!.id);
        if (stopped || abort.signal.aborted || version !== generation.current) return;
        setJob(next); setError('');
        if (!terminal(next)) timer = setTimeout(() => void poll(), 3000);
      } catch { if (!stopped && !abort.signal.aborted && version === generation.current) setError('Job status could not be loaded. It may be expired, unavailable for this installation, or the service may be offline. Refresh status to retry; this does not create another job.'); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, [eligible, ticket, expired, busy, refresh]);
  async function create() {
    if (!query || !eligible || busy || (ticket && !expired && (!job || !terminal(job)))) return;
    const requested = query; const version = ++generation.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError('');
    let registered = false;
    try {
      // Web Locks serializes first registration across tabs. Fail closed without it when registration is needed.
      let bearer = access().existing(Date.now());
      if (!bearer) {
        if (!navigator.locks) { setError('This browser cannot coordinate installation registration safely. Use a browser with Web Locks support; no installation was created.'); return; }
        bearer = await navigator.locks.request('zindycast.installation-registration', { signal: abort.signal }, () => access().ensure(abort.signal));
      }
      registered = true;
      if (abort.signal.aborted || version !== generation.current) return;
      setWarning('Submitting a comparison. If you leave this tab before confirmation, a job may still be created; submitting again creates a NEW job.');
      const next = parseComparison(await requestJson('/api/v1/comparisons', abort.signal, 20_000, { method: 'POST', bearer, body: requested }), requested);
      if (abort.signal.aborted || version !== generation.current) return;
      setWarning(''); remember({ id: next.id, query: next.query, expiresAt: next.expiresAt }); setJob(next);
    } catch (cause) {
      if (!abort.signal.aborted && version === generation.current) setError(registered ? 'Comparison creation could not be confirmed. A job may have been created; there is no automatic retry. Creating again submits a NEW job and may consume another job slot.' : cause instanceof Error ? cause.message : 'Installation access could not be saved. No automatic repeat registration will occur.');
    } finally { if (version === generation.current) setBusy(false); }
  }
  async function cancel() {
    if (!ticket || !eligible || busy || expired) return;
    const requested = ticket; const version = ++generation.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError('');
    try { const bearer = access().existing(Date.now()); if (!bearer) throw new Error(); const next = parseComparison(await requestJson(`/api/v1/comparisons/${encodeURIComponent(requested.id)}/cancel`, abort.signal, 20_000, { method: 'POST', bearer }), requested.query, requested.id); if (!abort.signal.aborted && version === generation.current) setJob(next); }
    catch { if (!abort.signal.aborted && version === generation.current) setError('Cancellation could not be confirmed. Refresh status before retrying cancellation.'); }
    finally { if (version === generation.current) setBusy(false); }
  }
  const pending = ticket && !expired && (!job || !terminal(job));
  return <Card component="section" className="card comparison-panel" hidden={!active}><p className="eyebrow">Compare places · shared UTC period</p><h1>Compare</h1><p className="subtle">2–5 cities · ERA5 modeled history · 1–366 UTC days</p><details><summary>Comparison scope</summary><p>Choose cities here or use your saved places. Full 1991–2020 baselines, recent-decade comparisons, and distributions are forthcoming. Completed summaries can be exported as CSV.</p></details><CityPicker active={eligible} disabled={chosenCount>=5||added.length>=20} onChoose={l=>{const id=comparisonLocation(l).id;setAdded(items=>items.some(item=>comparisonLocation(item).id===id)?items:[...items,l]);setSelected(items=>items.includes(id)?items:[...items,id]);}}/><form onSubmit={e => { e.preventDefault(); void create(); }}><fieldset><legend>Cities · choose 2–5</legend><div className="comparison-places">{choices.map(l => { const id = comparisonLocation(l).id; return <label key={id}><input type="checkbox" checked={selected.includes(id)} disabled={!selected.includes(id) && chosenCount >= 5} onChange={e => setSelected(s => e.target.checked ? [...s, id] : s.filter(v => v !== id))}/><span>{placeLabel(l)}<small>{l.latitude}, {l.longitude}</small></span></label>; })}</div>{choices.length < 2 && <p>Search above to add two distinct cities, or choose saved places.</p>}</fieldset><div className="map-controls"><label>Start UTC date<input type="date" min="1940-01-01" max={latest} value={start} required onChange={e => setStart(e.target.value)}/></label><label>End UTC date<input type="date" min="1940-01-01" max={latest} value={end} required onChange={e => setEnd(e.target.value)}/></label><Button type="submit" className="primary" disabled={!query || !eligible || busy || !!pending}>{busy ? 'Working…' : job && terminal(job) ? 'Create NEW comparison / retry' : 'Create comparison'}</Button></div></form><p className="subtle">Available through {latest} UTC, allowing for the closing rain interval. Creating the first comparison registers access for this browser only; there is no account or synchronization. Clearing browser data loses installation settings and job access.</p>{invalid && <p>{invalid}</p>}{warning && <p className="notice" role="status">{warning}</p>}{error && <p className="notice error" role="alert">{error}</p>}{!online && <p role="status">Offline — comparison results are unavailable. The job reference is retained; checking resumes when online and this tab is active.</p>}{ticket && <><h2>Requested comparison: {ticket.query.startDate} – {ticket.query.endDate} UTC</h2><p>{ticket.query.locations.map(l => `${l.name} (${l.latitude}, ${l.longitude})`).join(' · ')}</p>{(!query || !sameComparison(query, ticket.query)) && <p className="notice">Form inputs differ. The existing job and results still use the requested selection above.</p>}<details><summary>Job reference & expiry</summary><p>Job reference: {ticket.id}. Expires {new Date(ticket.expiresAt).toISOString()}. {expired ? 'Expired; create a new comparison to request these data again.' : 'Keep this reference in this installation until expiry. Creating a new job replaces the displayed reference.'}</p></details>{!expired && <><p role="status">{job ? `Status: ${job.state} · ${Math.round(job.progress * 100)}% · attempt ${job.attempt}` : 'Status awaiting service confirmation.'}{job?.state === 'failed' ? ' The service could not complete this comparison. Retry creates a new job.' : ''}</p>{job && <progress aria-label="Comparison job progress" max={1} value={job.progress}/>}<div className="map-controls"><Button className="outline" disabled={!eligible || busy} onClick={() => { setJob(null); setRefresh(n => n + 1); }}>Refresh status</Button>{pending && <Button className="outline" disabled={!eligible || busy} onClick={() => void cancel()}>Cancel comparison</Button>}</div>{online && job?.state === 'completed' && job.result && <ComparisonResults result={job.result} units={units}/>}</>}</>}</Card>;
}
