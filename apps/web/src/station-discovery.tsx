import { Button } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { StationDiscoveryResponseSchema, type Location } from '@zindycast/contracts';
import { CityPicker } from './city-picker';
import { requestJson } from './request';
import { placeLabel } from './weather';

type Point = Pick<Location, 'latitude' | 'longitude'>;
export const nearbyStationUrl = (point: Point) => `/api/v1/stations/nearby?${new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude) })}`;
export function parseStationDiscovery(raw: unknown, point: Point) {
  const response = StationDiscoveryResponseSchema.parse(raw);
  if (response.data.query.latitude !== point.latitude || response.data.query.longitude !== point.longitude) throw new Error('Station candidates do not match the searched city. Please retry.');
  return response;
}
export function StationDiscovery({ online, onChoose }: { online: boolean; onChoose: (id: string) => void }) {
  const [city, setCity] = useState<Location | null>(null);
  const [result, setResult] = useState<ReturnType<typeof parseStationDiscovery> | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  const cancel = () => { ++generation.current; controller.current?.abort(); setResult(null); setLoading(false); setError(''); };
  useEffect(() => { if (!online) cancel(); return () => { ++generation.current; controller.current?.abort(); }; }, [online]);
  async function find(selected: Location) {
    cancel(); setCity(selected);
    if (!online) return;
    const version = generation.current, abort = new AbortController(); controller.current = abort; setLoading(true);
    try {
      const response = parseStationDiscovery(await requestJson(nearbyStationUrl(selected), abort.signal), selected);
      if (!abort.signal.aborted && version === generation.current) setResult(response);
    } catch (cause) { if (!abort.signal.aborted && version === generation.current) setError(cause instanceof Error ? cause.message : 'Nearby station search unavailable.'); }
    finally { if (version === generation.current) setLoading(false); }
  }
  return <section aria-label="Find a station"><h2>Find a station near a city</h2><CityPicker active={online} disabled={!online} label="Search city for nearby stations" onChoose={selected => void find(selected)}/><p className="subtle">Up to 10 metadata candidates within 150 km. Distance is not a quality ranking; requested-period completeness and suitability are not assessed.</p>{city && <p>Search center: {placeLabel(city)} · {city.latitude}, {city.longitude}. These are city coordinates, not station coordinates.</p>}{loading && <p role="status">Finding station metadata…</p>}{error && <p role="alert">{error}</p>}{city && <Button type="button" disabled={!online || loading} onClick={() => void find(city)}>Retry nearby station search</Button>}{online && result && <><StationCandidates data={result.data} onChoose={onChoose}/></>}</section>;
}
export function StationCandidates({ data, onChoose }: { data: ReturnType<typeof parseStationDiscovery>['data']; onChoose: (id: string) => void }) {
  return <>{data.candidates.length === 0 ? <p role="status">No metadata candidates found within 150 km. Try another city or enter a station ID below.</p> : <ul aria-label="Nearby station candidates">{data.candidates.map(station => <li key={station.id}><Button type="button" onClick={() => onChoose(station.id)}>Use {station.name ?? 'Unnamed station'} · {station.id}</Button><p>{station.distanceKm.toFixed(1)} km from search center · elevation {station.elevationM === null ? 'unavailable' : `${station.elevationM} m`} · station coordinates {station.coordinates.latitude}, {station.coordinates.longitude}.</p></li>)}</ul>}<p className="subtle">Catalog positions are not verified historical locations. Selecting fills the station ID below; choose source dates and press Load station. Relocations, observation schedules and period coverage need separate review.</p><details><summary>Station metadata source</summary><p>{data.provider} · {data.dataset}. <a href={data.sourceUrl} target="_blank" rel="noreferrer">NOAA station catalog ↗</a>. Retrieved {data.metadataRetrievedAt}; source update time unavailable. Ordered by distance, then station ID; US catalog only. Method: {data.adapterVersion}. Completeness, historical positions and eligibility: not assessed.</p></details></>;
}
