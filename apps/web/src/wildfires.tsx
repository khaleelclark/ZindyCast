import { Button, Card } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { WildfireBboxSchema, WildfireResponseSchema, type Location } from '@zindycast/contracts';
import { requestJson } from './request';

type Box = ReturnType<typeof WildfireBboxSchema.parse>;
type Response = ReturnType<typeof WildfireResponseSchema.parse>;
type Data = Response['data'];
type Incident = Data['incidents'][number];
type Perimeter = Data['perimeters'][number];
export function wildfireBox(location: Pick<Location, 'latitude' | 'longitude'>): Box {
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) throw new Error('Valid city coordinates required.');
  return WildfireBboxSchema.parse({ west: Math.max(-180, location.longitude - 2), east: Math.min(180, location.longitude + 2), south: Math.max(-90, location.latitude - 2), north: Math.min(90, location.latitude + 2) });
}
export function sameWildfireBox(a: Box, b: Box) { return (['west', 'south', 'east', 'north'] as const).every(k => a[k] === b[k]); }
export function parseWildfires(raw: unknown, box: Box): Response {
  const parsed = WildfireResponseSchema.parse(raw);
  if (!sameWildfireBox(parsed.data.bbox, box)) throw new Error('The wildfire response does not match the requested area.');
  return parsed;
}
export function perimeterMatches(incident: Incident, perimeters: Perimeter[]) {
  return incident.normalizedIrwinId === null ? [] : perimeters.filter(p => p.normalizedIrwinId === incident.normalizedIrwinId);
}
function category(value: Incident['category']) { return value === 'WF' ? 'WF · Wildfire' : value === 'RX' ? 'RX · Prescribed fire' : value === 'CX' ? 'CX · Incident complex' : 'Unknown source category'; }
function timestamp(value: Incident['incidentUpdatedAt']) { return value.utc === null ? 'Unknown (source null)' : `${value.utc} (epoch ms ${value.epochMs})`; }
function Identity({ row }: { row: Incident | Perimeter }) {
  return <details><summary>Exact source identifiers</summary><dl><dt>IRWIN ID</dt><dd>{row.irwinId ?? 'Unknown'}</dd><dt>Unique fire identifier</dt><dd>{row.uniqueFireIdentifier ?? 'Unknown'}</dd><dt>Global ID</dt><dd>{row.globalId}</dd><dt>Layer-local object ID</dt><dd>{row.objectId}</dd>{'sourceGlobalId' in row ? <><dt>Source global ID</dt><dd>{row.sourceGlobalId ?? 'Unknown'}</dd></> : <><dt>Polygon IRWIN ID</dt><dd>{row.polygonIrwinId ?? 'Unknown'}</dd><dt>Attribute IRWIN ID</dt><dd>{row.attributeIrwinId ?? 'Unknown'}</dd><dt>Polygon source global ID</dt><dd>{row.polygonSourceGlobalId ?? 'Unknown'}</dd><dt>Incident source global ID</dt><dd>{row.incidentSourceGlobalId ?? 'Unknown'}</dd></>}</dl></details>;
}
function Paging({ page, count, setPage, label }: { page: number; count: number; setPage: (page: number) => void; label: string }) {
  return count > 25 ? <div className="map-controls"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous {label}</Button><span>{page * 25 + 1}–{Math.min(count, (page + 1) * 25)} of {count}</span><Button disabled={(page + 1) * 25 >= count} onClick={() => setPage(page + 1)}>Next {label}</Button></div> : null;
}
export function WildfireEvidence({ data, now }: { data: Data; now: number }) {
  const [incidentPage, setIncidentPage] = useState(0), [perimeterPage, setPerimeterPage] = useState(0);
  return <div className="wildfire-evidence"><p>Retrieved {data.retrievedAt}. Retrieval is not a field survey or incident update. {now - Date.parse(data.retrievedAt) > 600_000 ? 'This retrieval is over ten minutes old; reload for a new request. ' : ''}Source freshness and geographic coverage are unknown.</p>
    <p>{data.incidents.length} published incident records · {data.perimeters.length} published perimeter records. The two current layers are retrieved independently; pagination is complete for this query but is not an atomic snapshot.</p>
    <h3>Incident locations</h3>{!data.incidents.length ? <p>No matching published incident records in this area. This does not mean no fires or all clear.</p> : <><Paging label="incidents" page={incidentPage} count={data.incidents.length} setPage={setIncidentPage} /><div className="table-scroll"><table><caption>Published incidents · WGS84 longitude/latitude in degrees</caption><thead><tr><th scope="col">Incident / category</th><th scope="col">Source location</th><th scope="col">Incident updated (UTC)</th><th scope="col">Perimeter evidence</th></tr></thead><tbody>{data.incidents.slice(incidentPage * 25, (incidentPage + 1) * 25).map(row => { const matched = perimeterMatches(row, data.perimeters); return <tr key={row.globalId}><th scope="row">{row.name ?? 'Unnamed incident'}<p>{category(row.category)}</p><Identity row={row} /></th><td>{row.geometry ? `${row.geometry.y}° latitude, ${row.geometry.x}° longitude` : 'Location geometry unavailable'}</td><td>{timestamp(row.incidentUpdatedAt)}</td><td>{!row.normalizedIrwinId ? 'Association unknown: no IRWIN ID.' : matched.length ? `${matched.length} records with matching IRWIN ID; ${matched.filter(p => p.geometry !== null).length} with ring geometry. See perimeter records below.` : 'No matching published perimeter in this query. Not every incident has a perimeter.'}</td></tr>; })}</tbody></table></div></>}
    <h3>Perimeter records</h3><p>Evidence list only; no perimeter overlay is drawn. Native Esri rings are not GeoJSON polygons. Hole/disjoint-shell topology and geographic accuracy are unverified. Matching polygons can extend beyond the query area; records without a matching incident are retained.</p>
    {!data.perimeters.length ? <p>No matching published perimeter records. No perimeter does not mean no fire.</p> : <><Paging label="perimeters" page={perimeterPage} count={data.perimeters.length} setPage={setPerimeterPage} /><div className="table-scroll"><table><caption>Independent perimeter dates · UTC; unknown dates are never replaced with retrieval time</caption><thead><tr><th scope="col">Perimeter / category</th><th scope="col">Geometry availability</th><th scope="col">Polygon captured</th><th scope="col">Polygon last edited / created</th><th scope="col">Incident updated</th></tr></thead><tbody>{data.perimeters.slice(perimeterPage * 25, (perimeterPage + 1) * 25).map(row => <tr key={row.globalId}><th scope="row">{row.name ?? 'Unnamed perimeter'}<p>{category(row.category)}</p><Identity row={row} /></th><td>{row.geometry ? `${row.geometry.rings.length} Esri rings; topology unverified, not rendered.` : 'Geometry unavailable (source null)'}</td><td>{timestamp(row.polygonCapturedAt)}</td><td>Edited: {timestamp(row.polygonUpdatedAt)}<br />Created: {timestamp(row.polygonCreatedAt)}</td><td>{timestamp(row.incidentUpdatedAt)}</td></tr>)}</tbody></table></div></>}
    <details><summary>Source retrieval, attribution & limitations</summary>{(['incidents', 'perimeters'] as const).map(kind => <p key={kind}>{kind}: retrieved {data.sources[kind].retrievedAt}; source update time unknown; {data.sources[kind].publishedRecords} records over {data.sources[kind].pages} pages. <a href={data.sources[kind].sourceUrl} target="_blank" rel="noreferrer">Official WFIGS {kind} layer ↗</a></p>)}<p>{data.attribution}</p><ul>{data.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></details>
  </div>;
}
export function WildfirePanel({ location, online, now }: { location: Location | null; online: boolean; now: number }) {
  const selection = location ? `${location.latitude}/${location.longitude}/${location.name}` : '';
  return <WildfireSelection key={selection} location={location} online={online} now={now} />;
}
function WildfireSelection({ location, online, now }: { location: Location | null; online: boolean; now: number }) {
  const [result, setResult] = useState<Response | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { if (!online) { pending.current?.abort(); setResult(null); setLoading(false); setError(''); } return () => { pending.current?.abort(); }; }, [online]);
  const box = location ? wildfireBox(location) : null;
  async function load() {
    if (!box || !online || !navigator.onLine) return;
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setResult(null); setError(''); setLoading(true);
    try { const parsed = parseWildfires(await requestJson(`/api/v1/wildfires?${new URLSearchParams(Object.entries(box).map(([k, v]) => [k, String(v)]))}`, controller.signal), box); if (!controller.signal.aborted) setResult(parsed); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Wildfire data unavailable.'); }
    finally { if (!controller.signal.aborted) { setLoading(false); pending.current = null; } }
  }
  return <Card component="section" className="wildfire-panel" aria-labelledby="wildfire-heading"><p className="eyebrow">NIFC / WFIGS · Published incident mapping</p><h2 id="wildfire-heading">Wildfire & prescribed-fire evidence</h2>
    <p className="notice">Coverage unknown · no records ≠ no fire. Perimeters are not evacuation zones or safety boundaries.</p><details><summary>Wildfire limitations</summary><p>Perimeters are not evacuation zones, spread predictions or assurances of safety outside them. No published records does not mean no fires or all clear. Disappearance from the current feed does not establish extinguishment. Coverage and accuracy are not guaranteed.</p></details>
    <details><summary>Query area & categories</summary>{box && location ? <p>Area around {location.name}: west {box.west}°, south {box.south}°, east {box.east}°, north {box.north}°. Up to 2° each side of the city; degrees are not a fixed distance. This area is independent of the radar/satellite region. Bounds stop at poles and ±180°: any portion across the date line is excluded, not wrapped.</p> : <p>Choose a city to define a bounded area. No station or nearest-fire association is inferred.</p>}
    <p>Load queries both published layers only when requested. WF means wildfire, RX prescribed fire, CX incident complex; unknown categories stay unknown. Feed refreshes do not imply newly surveyed perimeters.</p></details>
    <div className="map-controls"><Button disabled={!box || !online || loading} onClick={() => void load()}>{result ? 'Reload wildfire evidence' : error ? 'Retry wildfire evidence' : 'Load wildfire evidence'}</Button>{loading && <Button onClick={() => { pending.current?.abort(); pending.current = null; setLoading(false); setError('Request cancelled. Load to try again.'); }}>Cancel wildfire request</Button>}</div>
    {!online && <p role="status">Offline — wildfire evidence is unavailable. Reconnect and select Load.</p>}{online && loading && <p role="status">Loading incident and perimeter evidence…</p>}{online && error && <p className="notice error" role="alert">{error}</p>}
    {online && result && <WildfireEvidence key={result.data.retrievedAt} data={result.data} now={now} />}
    <p><a href="https://www.nifc.gov/fire-information/maps" target="_blank" rel="noreferrer">NIFC official maps ↗</a> · NIFC / WFIGS; IRWIN / DOI, USDA Forest Service, partner agencies and NWCG.</p>
  </Card>;
}
