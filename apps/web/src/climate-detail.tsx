import React,{useState} from 'react';
import {type ClimateDetail,climateFields} from '@zindycast/contracts';
import {WeatherChart} from './weather-chart';
import {type Units,timeLabel} from './weather';
import {Button} from '@mui/material';
import {downloadClimateDetail,downloadClimateDaily} from './climate-export';
const fieldLabels={temperatureC:'Air °C',dewPointC:'Dew point °C',wetBulbTemperatureC:'Wet bulb °C',humidityPercent:'Humidity %',windSpeedMs:'Wind m/s',precipitationMm:'Precipitation mm',sunshineDurationSeconds:'Sunshine seconds',cloudCoverPercent:'Cloud cover %'};
const exact=(v:number|null|undefined,units:Units)=>v==null?'—':`${(units==='us'?v*1.8+32:v).toFixed(1)}°${units==='us'?'F':'C'}`;
export function ClimateDetailView({detail:d,units}:{detail:ClimateDetail;units:Units}){
 const [date,setDate]=useState('');const day=d.days.find(day=>day.date===date)??d.days[0];
 const hours=day?d.hours.filter(h=>Date.parse(h.time)>=Date.parse(day.startInclusive)&&Date.parse(h.time)<Date.parse(day.endExclusive)):[];
 return <section className="climate-detail"><h2>{d.location.name} · daily detail</h2><p>{d.startDate} – {d.endDate} · {d.location.timezone}</p><p className="subtle">Modeled ERA5. Detail is a separately retrieved snapshot; its retrieval dates may differ from the comparison summary.</p><label>Day<select value={day?.date??''} onChange={e=>setDate(e.target.value)}>{d.days.map(day=><option key={day.date}>{day.date}</option>)}</select></label>
 {hours.length>0&&<WeatherChart points={hours.map(h=>({time:Date.parse(h.time),values:[h.temperatureC,h.dewPointC,h.wetBulbTemperatureC]}))} labels={['Air','Dew point','Wet bulb']} colors={['#b34d20','#087f8c','#7653a5']} units={units} zone={d.location.timezone} label="Hourly historical temperatures"/>}
 <div className="table-scroll"><table><caption>Daily temperatures · — means unavailable.</caption><thead><tr><th>Date</th><th>High</th><th>Low</th><th>Average wet bulb</th><th>Rain ≥1 mm</th></tr></thead><tbody>{d.days.map(day=><tr key={day.date}><th><button onClick={()=>setDate(day.date)}>{day.date}</button></th><td>{exact(day.metrics.temperatureC.max,units)}</td><td>{exact(day.metrics.temperatureC.min,units)}</td><td>{exact(day.metrics.wetBulbTemperatureC.mean,units)}</td><td>{day.precipitationDay==null?'Unknown':day.precipitationDay?'Yes':'No'}</td></tr>)}</tbody></table></div>
 <Button onClick={()=>downloadClimateDaily(d)}>Download daily CSV</Button><Button onClick={()=>downloadClimateDetail(d)}>Download hourly CSV · displayed date range</Button><details><summary>Hourly values · original SI units</summary><div className="table-scroll"><table><thead><tr><th>Local time</th>{climateFields.map(f=><th key={f}>{fieldLabels[f]}</th>)}</tr></thead><tbody>{hours.map(h=><tr key={h.time}><th>{timeLabel(h.time,d.location.timezone,{hour:'numeric',minute:'2-digit',timeZoneName:'short'})}</th>{climateFields.map(f=><td key={f}>{h[f]??'—'}</td>)}</tr>)}</tbody></table></div></details><details><summary>Detail sources</summary>{d.sources.map(s=><p key={s.requestUrl}>{s.attribution} · retrieved {s.retrievedAt}</p>)}</details></section>;
}
export {ClimateDetailView as ClimateDetail};
