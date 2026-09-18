import {Button,TextField} from '@mui/material';
import {useEffect,useState} from 'react';
import {SearchResponseSchema,type Location} from '@zindycast/contracts';
import {requestJson} from './request';
import {placeLabel} from './weather';
export function CityPicker({active,onChoose,disabled=false,label='Add a city to compare'}:{active:boolean;onChoose:(location:Location)=>void;disabled?:boolean;label?:string}) {
 const [query,setQuery]=useState(''),[results,setResults]=useState<Location[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setResults([]);setError('');setLoading(false);
  if(!active||disabled||query.trim().length<2)return ()=>controller.abort();
  const timer=setTimeout(()=>{setLoading(true);void requestJson(`/api/v1/locations?q=${encodeURIComponent(query.trim())}`,controller.signal).then(raw=>{const parsed=SearchResponseSchema.parse(raw);if(!controller.signal.aborted)setResults(parsed.locations);}).catch(()=>{if(!controller.signal.aborted)setError('City search is unavailable. Please try again.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,active,disabled]);
 return <div className="inline-city-picker"><TextField label={label} value={query} disabled={!active||disabled} onChange={event=>setQuery(event.target.value.slice(0,100))} fullWidth size="small" autoComplete="off"/><div role="status">{loading?'Searching cities…':error}</div>{results.length>0&&<ul aria-label={`${label} results`}>{results.map(location=><li key={location.id}><Button type="button" onClick={()=>{onChoose(location);setQuery('');setResults([]);}}>{placeLabel(location)} · {location.latitude.toFixed(3)}, {location.longitude.toFixed(3)}</Button></li>)}</ul>}</div>;
}
