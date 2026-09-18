import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { ClimateQuerySchema, ClimateJobSchema, ClimateDetailSchema, type ClimateQuery, type ClimateJob, type ClimateDetail as Detail, type Location } from '@zindycast/contracts';
import { installationStore, latestComparisonDate, comparisonLocation } from './comparison-model';
import { CityPicker } from './city-picker';
import { ClimateResults } from './climate-results';
import { ClimateDetailView as ClimateDetail } from './climate-detail';
import { downloadClimateSummary, downloadClimateDetail } from './climate-export';
import { requestJson } from './request';
import { placeLabel, type Units } from './weather';
if (typeof document !== 'undefined') void import('./climate-panel.css');
export const climateJobKey = 'zindycast.climate-job.v2';
const jobKey = climateJobKey;
type Ticket = { id: string; expiresAt: number; query: ClimateQuery };
const terminal = (job: ClimateJob) => ['completed', 'failed', 'cancelled'].includes(job.state);
export const climateLocation = (location: Location) => ({ ...comparisonLocation(location), timezone: location.timezone });
export const sameClimateQuery = (a: ClimateQuery, b: ClimateQuery) => a.mode === b.mode && a.startDate === b.startDate && a.endDate === b.endDate && JSON.stringify(a.locations) === JSON.stringify(b.locations);
export type ClimatePreset = 'last-30-days' | 'last-90-days' | 'last-complete-year' | 'recent-two-years';
export function climatePreset(preset: ClimatePreset, latest: string) {
  const year = Number(latest.slice(0, 4));
  const subtract = (days: number) => new Date(Date.parse(`${latest}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  if (preset === 'last-30-days') return { mode: 'period' as const, startDate: subtract(29), endDate: latest };
  if (preset === 'last-90-days') return { mode: 'period' as const, startDate: subtract(89), endDate: latest };
  if (preset === 'last-complete-year') return { mode: 'period' as const, startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` };
  return { mode: 'climatology' as const, firstYear: String(year - 2), lastYear: String(year - 1) };
}
export function climateSelection(locations: Location[], startDate: string, endDate: string, mode: ClimateQuery['mode'], now: number): ClimateQuery {
  const parsed = ClimateQuerySchema.safeParse({ locations: locations.map(climateLocation), startDate, endDate, mode });
  if (!parsed.success || endDate > latestComparisonDate(now)) throw new Error(`Choose 2–5 distinct cities with time zones and 1–366 local dates, or 2–5 full calendar years, through ${latestComparisonDate(now)}.`);
  return parsed.data;
}
export function parseClimateJob(raw: unknown, query: ClimateQuery, id?: string): ClimateJob {
  const job = ClimateJobSchema.parse(raw);
  const bad = () => { throw new Error('Climate response does not match the requested job, places or dates.'); };
  if (!/^[a-f0-9-]{36}$/.test(job.id) || (id !== undefined && id !== job.id) || !sameClimateQuery(job.query, query) || !Number.isSafeInteger(job.createdAt) || job.createdAt < 0 || !Number.isSafeInteger(job.expiresAt) || job.expiresAt <= job.createdAt || job.expiresAt > 8.64e15 || (job.state === 'completed') !== (job.result !== null)) bad();
  const result = job.result;
  if (result) {
    if (!sameClimateQuery(result.plan.query, query) || result.locations.length !== query.locations.length || result.plan.windows.length !== query.locations.length) bad();
    result.locations.forEach((entry, index) => {
      const location = query.locations[index]!;
      const window = result.plan.windows.find(w => w.locationId === location.id);
      if (JSON.stringify(entry.location) !== JSON.stringify(location) || !window || window.timezone !== location.timezone || entry.overview.startDate !== query.startDate || entry.overview.endDate !== query.endDate || entry.monthly.some(month => month.startDate < query.startDate || month.endDate > query.endDate)) bad();
    });
    if (new Set(result.plan.windows.map(w => w.locationId)).size !== query.locations.length || result.plan.chunks.some(chunk => !query.locations.some(l => l.id === chunk.locationId && l.latitude === chunk.query.latitude && l.longitude === chunk.query.longitude))) bad();
  }
  return job;
}
export function climateDrillSelection(query: ClimateQuery, locationId: string, startDate: string, endDate: string) {
  const location = query.locations.find(l => l.id === locationId);
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  if (!location || !validDate(startDate) || !validDate(endDate) || startDate < query.startDate || endDate > query.endDate || endDate < startDate || Date.parse(endDate)-Date.parse(startDate) >= 31*86400000) throw new Error('Choose 1–31 local dates within this comparison for an included city.');
  return { location, startDate, endDate };
}
export function parseClimateDetail(raw: unknown, selection: ReturnType<typeof climateDrillSelection>): Detail {
  const detail = ClimateDetailSchema.parse(raw);
  if (JSON.stringify(detail.location) !== JSON.stringify(selection.location) || detail.startDate !== selection.startDate || detail.endDate !== selection.endDate || detail.days.some((day,index) => day.timezone !== selection.location.timezone || day.date < selection.startDate || day.date > selection.endDate || (index > 0 && day.date <= detail.days[index-1]!.date))) throw new Error('Detail response does not match the selected city, time zone or dates.');
  const localDate = (time: number) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: selection.location.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time); return ['year','month','day'].map(key => parts.find(p => p.type === key)!.value).join('-'); };
  const expectedDays = (Date.parse(selection.endDate)-Date.parse(selection.startDate))/86400000+1;
  if (detail.days.length !== expectedDays || detail.days.some((day,index) => day.date !== new Date(Date.parse(selection.startDate)+index*86400000).toISOString().slice(0,10) || Date.parse(day.endExclusive) <= Date.parse(day.startInclusive) || localDate(Date.parse(day.startInclusive)) !== day.date || localDate(Date.parse(day.startInclusive)-1) === day.date || localDate(Date.parse(day.endExclusive)-1) !== day.date || localDate(Date.parse(day.endExclusive)) === day.date || (index > 0 && Date.parse(day.startInclusive) !== Date.parse(detail.days[index-1]!.endExclusive)))) throw new Error('Detail local day boundaries do not match the selected calendar.');
  const start = detail.days.length ? Date.parse(detail.days[0]!.startInclusive) : null;
  const end = detail.days.length ? Date.parse(detail.days.at(-1)!.endExclusive) : null;
  if (detail.hours.some((hour,index) => start === null || end === null || Date.parse(hour.time) < start || Date.parse(hour.time) > end || (index > 0 && Date.parse(hour.time) <= Date.parse(detail.hours[index-1]!.time)))) throw new Error('Detail hours are outside the requested local day boundaries.');
  return detail;
}
export function ClimatePanel({ saved, online, active, units, now }: { saved: Location[]; online: boolean; active: boolean; units: Units; now: number }) {
  const [added,setAdded]=useState<Location[]>([]);
  const choices=[...new Map([...saved,...added].map(l=>[climateLocation(l).id,l])).values()];
  const [selected, setSelected] = useState<string[]>([]); const [start, setStart] = useState(latestComparisonDate(now)); const [end, setEnd] = useState(latestComparisonDate(now));
  const [mode, setMode] = useState<ClimateQuery['mode']>('period');
  const [firstYear,setFirstYear] = useState(String(new Date(now).getUTCFullYear()-2));
  const [lastYear,setLastYear] = useState(String(new Date(now).getUTCFullYear()-1));
  const [ticket, setTicket] = useState<Ticket | null>(null); const [job, setJob] = useState<ClimateJob | null>(null);
  const [error, setError] = useState(''); const [warning, setWarning] = useState(''); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const mutation = useRef(false);
  const controller = useRef<AbortController | null>(null); const generation = useRef(0); const store = useRef<ReturnType<typeof installationStore> | null>(null);
  const eligible = active && online && visible;
  const chosenCount = choices.filter(l => selected.includes(climateLocation(l).id)).length;
  const latest = latestComparisonDate(now); const expired = !!ticket && ticket.expiresAt <= now;
  const applyPreset = (preset: ClimatePreset) => {
    const value = climatePreset(preset, latest);
    setMode(value.mode);
    if (value.mode === 'period') { setStart(value.startDate); setEnd(value.endDate); }
    else { setFirstYear(value.firstYear); setLastYear(value.lastYear); }
  };
  let query: ClimateQuery | null = null; let invalid = '';
  try { query = climateSelection(choices.filter(l => selected.includes(climateLocation(l).id)), mode === 'period' ? start : `${firstYear}-01-01`, mode === 'period' ? end : `${lastYear}-12-31`, mode, now); } catch (cause) { invalid = (cause as Error).message; }
  function access() { try { return store.current ??= installationStore(localStorage); } catch { throw new Error('Browser storage cannot be accessed. Installation settings and job access cannot be retained; enable storage before creating a comparison.'); } }
  function remember(next: Ticket) {
    setTicket(next);
    try { localStorage.setItem(jobKey, JSON.stringify(next)); if (localStorage.getItem(jobKey) !== JSON.stringify(next)) throw new Error(); }
    catch { setWarning('This job remains available in this tab, but its reference could not be saved. Reloading or clearing browser data may lose job access. No new installation will be registered automatically.'); }
  }
  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState !== 'hidden'); document.addEventListener('visibilitychange', visibility);
    try { const raw = localStorage.getItem(jobKey); if (raw) { const t = JSON.parse(raw) as Ticket; const q = ClimateQuerySchema.safeParse(t.query); if (!q.success || typeof t.id !== 'string' || !/^[a-f0-9-]{36}$/.test(t.id) || !Number.isSafeInteger(t.expiresAt) || t.expiresAt > 8.64e15 || t.expiresAt < 0) throw new Error(); setTicket({ id: t.id, query: q.data, expiresAt: t.expiresAt }); } }
    catch { setWarning('The saved comparison reference is unavailable. Browser storage loss can remove installation settings and job access.'); }
    return () => { document.removeEventListener('visibilitychange', visibility); ++generation.current; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (!eligible) { ++generation.current; controller.current?.abort(); mutation.current = false; setBusy(false); } }, [eligible]);
  useEffect(() => {
    if (!eligible || !ticket || expired || busy || (job && terminal(job))) return;
    let polls = 0; let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const version = ++generation.current; const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    async function poll() {
      if (stopped || abort.signal.aborted || ticket!.expiresAt <= Date.now()) return;
      try {
        const bearer = access().existing(Date.now()); if (!bearer) throw new Error();
        const next = parseClimateJob(await requestJson(`/api/v1/climate-comparisons/${encodeURIComponent(ticket!.id)}`, abort.signal, 20_000, { bearer }), ticket!.query, ticket!.id);
        if (stopped || abort.signal.aborted || version !== generation.current) return;
        if (ticket!.expiresAt <= Date.now()) return;
        setJob(next); setError('');
        if (!terminal(next) && ++polls < 200) timer = setTimeout(() => void poll(), 3000);
        else if (!terminal(next)) setError('Automatic status checks paused after 200 checks. Refresh status to continue checking this job.');
      } catch { if (!stopped && !abort.signal.aborted && version === generation.current) setError('Job status could not be loaded. It may be expired, unavailable for this installation, or the service may be offline. Refresh status to retry; this does not create another job.'); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, [eligible, ticket, expired, busy, refresh]);
  async function create() {
    if (!query || !eligible || busy || mutation.current || (ticket && !expired && (!job || !terminal(job)))) return;
    mutation.current = true;
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
      const next = parseClimateJob(await requestJson('/api/v1/climate-comparisons', abort.signal, 20_000, { method: 'POST', bearer, body: requested }), requested);
      if (abort.signal.aborted || version !== generation.current) return;
      setWarning(''); remember({ id: next.id, query: next.query, expiresAt: next.expiresAt }); setJob(next);
    } catch (cause) {
      if (!abort.signal.aborted && version === generation.current) setError(registered ? 'Comparison creation could not be confirmed. A job may have been created; there is no automatic retry. Creating again submits a NEW job and may consume another job slot.' : cause instanceof Error ? cause.message : 'Installation access could not be saved. No automatic repeat registration will occur.');
    } finally { if (version === generation.current) { mutation.current = false; setBusy(false); } }
  }
  async function cancel() {
    if (!ticket || !eligible || busy || mutation.current || expired) return;
    mutation.current = true;
    const requested = ticket; const version = ++generation.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError('');
    try { const bearer = access().existing(Date.now()); if (!bearer) throw new Error(); const next = parseClimateJob(await requestJson(`/api/v1/climate-comparisons/${encodeURIComponent(requested.id)}/cancel`, abort.signal, 20_000, { method: 'POST', bearer }), requested.query, requested.id); if (!abort.signal.aborted && version === generation.current) setJob(next); }
    catch { if (!abort.signal.aborted && version === generation.current) setError('Cancellation could not be confirmed. Refresh status before retrying cancellation.'); }
    finally { if (version === generation.current) { mutation.current = false; setBusy(false); } }
  }
  const [detail,setDetail] = useState<Detail | null>(null);
  const [detailBusy,setDetailBusy] = useState(false), [detailError,setDetailError] = useState('');
  const [drillLocation,setDrillLocation] = useState(''), [drillStart,setDrillStart] = useState(''), [drillEnd,setDrillEnd] = useState('');
  const detailController = useRef<AbortController | null>(null), detailVersion = useRef(0);
  useEffect(() => {
    ++detailVersion.current; detailController.current?.abort(); setDetailBusy(false); setDetail(null); setDetailError('');
    setDrillLocation(ticket?.query.locations[0]?.id ?? ''); setDrillStart(ticket?.query.startDate ?? ''); setDrillEnd(ticket?.query.startDate ?? '');
    return () => { ++detailVersion.current; detailController.current?.abort(); };
  }, [ticket?.id, eligible, expired]);
  async function drill(locationId: string, startDate: string, endDate: string) {
    if (!ticket || !eligible || expired || job?.state !== 'completed' || busy) return;
    const version = ++detailVersion.current; detailController.current?.abort(); const abort = new AbortController(); detailController.current = abort;
    setDetail(null); setDetailError(''); setDetailBusy(true);
    setDrillLocation(locationId); setDrillStart(startDate); setDrillEnd(endDate);
    try {
      const selection = climateDrillSelection(ticket.query, locationId, startDate, endDate);
      const bearer = access().existing(Date.now()); if (!bearer) throw new Error('Installation access is unavailable.');
      const params = new URLSearchParams({ locationId, startDate, endDate });
      const next = parseClimateDetail(await requestJson(`/api/v1/climate-comparisons/${encodeURIComponent(ticket.id)}/detail?${params}`, abort.signal, 20_000, { bearer }), selection);
      if (!abort.signal.aborted && version === detailVersion.current && ticket.expiresAt > Date.now()) setDetail(next);
    } catch (cause) { if (!abort.signal.aborted && version === detailVersion.current) setDetailError(cause instanceof Error ? cause.message : 'Detail unavailable. Select Load daily and hourly detail to retry.'); }
    finally { if (version === detailVersion.current) setDetailBusy(false); }
  }
  const pending = ticket && !expired && (!job || !terminal(job));
  const completed = online && !expired && job?.state === 'completed' ? job.result : null;
  return <Card component="section" className="card comparison-panel climate-panel" hidden={!active}>
    <p className="eyebrow">Compare places · local calendars</p><h1>Climate comparison</h1>
    <p className="subtle">Temperature, humidity, sunshine and more · historical weather estimates</p>
    <CityPicker active={eligible} disabled={chosenCount >= 5 || added.length >= 20} onChoose={location => { const id = climateLocation(location).id; setAdded(items => items.some(item => climateLocation(item).id === id) ? items : [...items, location]); setSelected(items => items.includes(id) ? items : [...items,id]); }}/>
    <div className="comparison-presets" aria-label="Useful comparison periods"><span>Quick period</span><Button type="button" onClick={() => applyPreset('last-30-days')}>Last 30 days</Button><Button type="button" onClick={() => applyPreset('last-90-days')}>Last 90 days</Button><Button type="button" onClick={() => applyPreset('last-complete-year')}>Last full year</Button><Button type="button" onClick={() => applyPreset('recent-two-years')}>Recent 2 full years</Button></div>
    <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <fieldset><legend>Cities · choose 2–5</legend><div className="comparison-places">{choices.map(location => { const id = climateLocation(location).id; return <label key={id}><input type="checkbox" checked={selected.includes(id)} disabled={!selected.includes(id) && chosenCount >= 5} onChange={event => setSelected(items => event.target.checked ? [...items,id] : items.filter(item => item !== id))}/><span>{placeLabel(location)}<small>{location.latitude}, {location.longitude} · {location.timezone}</small></span></label>; })}</div>{choices.length < 2 && <p>Add two distinct cities above or choose saved places.</p>}</fieldset>
      <div className="map-controls"><label>Comparison period<select aria-label="Comparison period" value={mode} onChange={event => setMode(event.target.value as ClimateQuery['mode'])}><option value="period">Selected dates · up to 366 days</option><option value="climatology">Calendar-year comparison · 2–5 years</option></select></label>
      {mode === 'period' ? <><label>Start local date<input type="date" min="1940-01-01" max={latest} value={start} required onChange={event => setStart(event.target.value)}/></label><label>End local date<input type="date" min="1940-01-01" max={latest} value={end} required onChange={event => setEnd(event.target.value)}/></label></> : <><label>First full year<input type="number" min="1940" max={Number(latest.slice(0,4))} step="1" value={firstYear} required onChange={event => setFirstYear(event.target.value)}/></label><label>Last full year<input type="number" min="1941" max={Number(latest.slice(0,4))} step="1" value={lastYear} required onChange={event => setLastYear(event.target.value)}/></label></>}
      <Button type="submit" className="primary" disabled={!query || !eligible || busy || !!pending}>{busy ? 'Working…' : job && terminal(job) ? 'Create another comparison' : 'Compare cities'}</Button></div>
    </form>
    <p className="subtle">Dates follow each city’s local time. Historical data is available through {latest}.</p>
    <details><summary>Browser access and comparison scope</summary><p>The first comparison registers access for this browser only, using the same installation as archived comparisons. Clearing browser data loses installation settings and job access. No account or synchronization. Missing measurements remain unavailable; modeled values are not station observations.</p></details>
    {invalid && <p>{invalid}</p>}{warning && <p className="notice" role="status">{warning}</p>}{error && <p className="notice error" role="alert">{error}</p>}
    {!online && <p role="status">Offline — results are unavailable. The job reference is retained; checking resumes when online and this tab is active.</p>}
    {ticket && <><h2>Requested: {ticket.query.startDate} – {ticket.query.endDate} · {ticket.query.mode === 'period' ? 'local dates' : 'full calendar years'}</h2><p>{ticket.query.locations.map(location => `${location.name} (${location.timezone})`).join(' · ')}</p>
      {(!query || !sameClimateQuery(query,ticket.query)) && <p className="notice">Your selection has changed. Create another comparison to update these results.</p>}
      <details><summary>Job reference &amp; expiry</summary><p>Job reference: {ticket.id}. Expires {new Date(ticket.expiresAt).toISOString()}. {expired ? 'Expired; create a new comparison to request these data again.' : 'Creating a new job replaces the displayed reference.'}</p></details>
      {!expired && <><p role="status">{job ? `Status: ${job.state} · ${Math.round(job.progress * 100)}%` : 'Status awaiting service confirmation.'}{job?.state === 'failed' ? ' The service could not complete this comparison. A retry creates a new job.' : ''}</p>{job && <progress aria-label="Climate comparison job progress" max={1} value={job.progress}/>}
      <div className="map-controls"><Button disabled={!eligible || busy} onClick={() => { setJob(null); setDetail(null); ++detailVersion.current; detailController.current?.abort(); setDetailBusy(false); setRefresh(n => n+1); }}>Refresh climate status</Button>{pending && <Button disabled={!eligible || busy} onClick={() => void cancel()}>Cancel climate comparison</Button>}</div>
      {completed && <><Button onClick={() => downloadClimateSummary(completed)}>Download comparison CSV</Button><ClimateResults result={completed} units={units} onDrill={(locationId: string,startDate: string,endDate: string) => void drill(locationId,startDate,endDate)}/>
        <section className="climate-detail-selection" aria-label="Daily and hourly detail"><h2>Explore daily and hourly values</h2><p>Choose up to 31 days to explore in more detail.</p><form className="map-controls" onSubmit={event => { event.preventDefault(); void drill(drillLocation,drillStart,drillEnd); }}>
          <label>Detail city<select aria-label="Detail city" value={drillLocation} onChange={event => setDrillLocation(event.target.value)}>{ticket.query.locations.map(location => <option value={location.id} key={location.id}>{location.name} · {location.timezone}</option>)}</select></label>
          <label>Detail start local date<input type="date" min={ticket.query.startDate} max={ticket.query.endDate} required value={drillStart} onChange={event => setDrillStart(event.target.value)}/></label><label>Detail end local date<input type="date" min={ticket.query.startDate} max={ticket.query.endDate} required value={drillEnd} onChange={event => setDrillEnd(event.target.value)}/></label>
          <Button type="submit" disabled={!eligible || busy || detailBusy}>{detailBusy ? 'Loading detail…' : 'Load daily and hourly detail'}</Button></form>
          {detailBusy && <p role="status">Loading selected local days…</p>}{detailError && <p role="alert">{detailError}</p>}
          {detail && <><p className="notice">Loaded {detail.location.name}: {detail.startDate} – {detail.endDate} ({detail.location.timezone}). {detail.location.id !== drillLocation || detail.startDate !== drillStart || detail.endDate !== drillEnd ? 'Detail form changed; the values and export still use this loaded selection.' : ''}</p><Button onClick={() => downloadClimateDetail(detail)}>Download displayed climate detail CSV (SI)</Button><ClimateDetail detail={detail} units={units}/></>}
        </section></>}
      </>}
    </>}
  </Card>;
}
