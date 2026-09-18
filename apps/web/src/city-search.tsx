import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, TextField } from '@mui/material';
import { SearchResponseSchema, type Location } from '@zindycast/contracts';
import { placeLabel } from './weather';
import { requestJson } from './request';

export type CitySearchHandle = { clear: () => void; focus: () => void };

/** Keep keystrokes and asynchronous search updates outside the weather dashboard. */
export const CitySearch = forwardRef<CitySearchHandle, { onSelect: (location: Location) => void }>(function CitySearch({ onSelect }, ref) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [searchState, setSearchState] = useState('');
  const searchVersion = useRef(0);
  const input = useRef<HTMLInputElement | null>(null);
  const searchCache = useRef(new Map<string, { locations: Location[]; expires: number }>());
  const activeController = useRef<AbortController | null>(null);
  function clear() {
    ++searchVersion.current;
    activeController.current?.abort();
    setQuery(''); setResults([]); setSearchState('');
  }
  useImperativeHandle(ref, () => ({ clear, focus: () => input.current?.focus() }), []);
  function choose(location: Location) { clear(); onSelect(location); }
  useEffect(() => {
    const version = ++searchVersion.current;
    const controller = new AbortController();
    activeController.current = controller;
    setResults([]);
    if (query.trim().length < 2) { setSearchState(''); return () => controller.abort(); }
    const searchKey = query.trim().toLowerCase();
    const cachedSearch = searchCache.current.get(searchKey);
    if (cachedSearch && cachedSearch.expires > Date.now()) {
      setResults(cachedSearch.locations);
      setSearchState(cachedSearch.locations.length ? '' : 'No matching places. Try a nearby city or a different spelling.');
      return () => controller.abort();
    }
    setSearchState('Searching…');
    const timer = window.setTimeout(async () => {
      try {
        const data = SearchResponseSchema.parse(await requestJson(`/api/v1/locations?q=${encodeURIComponent(query.trim())}`, controller.signal));
        for (const item of data.locations) new Intl.DateTimeFormat('en-US', { timeZone: item.timezone });
        if (version !== searchVersion.current || controller.signal.aborted) return;
        searchCache.current.delete(searchKey);
        searchCache.current.set(searchKey, {locations: data.locations, expires: Date.now() + 86_400_000});
        if (searchCache.current.size > 30) searchCache.current.delete(searchCache.current.keys().next().value!);
        setResults(data.locations); setSearchState(data.locations.length ? '' : 'No matching places. Try a nearby city or a different spelling.');
      } catch (cause) { if (!controller.signal.aborted && version === searchVersion.current) setSearchState(cause instanceof Error ? cause.message : 'Search failed.'); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <div className="search-wrap"><label className="sr-only" htmlFor="city-search">Search cities</label><TextField inputRef={input} fullWidth size="small" id="city-search" label="Search cities" type="search" value={query} placeholder="Search city or ZIP code" autoComplete="off" onChange={event => { ++searchVersion.current; setResults([]); setQuery(event.target.value); }} /><div role="status" className="search-status">{searchState}</div>{results.length > 0 && <ul className="search-results">{results.map(item => <li key={`${item.id}-${item.latitude}-${item.longitude}`}><Button onClick={() => choose(item)}>{placeLabel(item)}<small>{item.latitude.toFixed(3)}, {item.longitude.toFixed(3)} · {item.timezone}</small></Button></li>)}</ul>}</div>;
});
