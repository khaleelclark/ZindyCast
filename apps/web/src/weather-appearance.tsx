import React, {useEffect, useState} from 'react';
import type {Hour} from '@zindycast/contracts';
export type WeatherKind = 'clear'|'partly-cloudy'|'cloudy'|'fog'|'drizzle'|'rain'|'freezing-rain'|'snow'|'storm'|'hail'|'unknown';
/** Open-Meteo documented WMO codes; unrecognized codes stay neutral. */
export function weatherKind(code:number|null|undefined):WeatherKind {
 if(code===0)return 'clear';if(code===1||code===2)return 'partly-cloudy';if(code===3)return 'cloudy';
 if(code===45||code===48)return 'fog';if([51,53,55].includes(code!))return 'drizzle';
 if([56,57,66,67].includes(code!))return 'freezing-rain';if([61,63,65,80,81,82].includes(code!))return 'rain';
 if([71,73,75,77,85,86].includes(code!))return 'snow';if(code===95)return 'storm';if(code===96||code===99)return 'hail';return 'unknown';
}
/** Decorative interpretation of the station's own description, never a model value. */
export function observedWeatherKind(description:string|null|undefined):WeatherKind {
 const text=description?.toLowerCase()??'';
 if(/thunder/.test(text))return 'storm';
 if(/freezing rain|freezing drizzle/.test(text))return 'freezing-rain';
 if(/snow|sleet|ice pellets/.test(text))return 'snow';
 if(/drizzle/.test(text))return 'drizzle';
 if(/rain|showers/.test(text))return 'rain';
 if(/fog|mist/.test(text))return 'fog';
 if(/overcast|mostly cloudy|cloudy/.test(text)&&!/partly cloudy/.test(text))return 'cloudy';
 if(/partly cloudy|few clouds|mostly clear/.test(text))return 'partly-cloudy';
 if(/clear|fair/.test(text))return 'clear';
 return 'unknown';
}
export function weatherKindAtmosphere(kind:WeatherKind,isDay:0|1|null|undefined) {
 if(kind==='unknown')return 'neutral';
 if(kind==='clear'||kind==='partly-cloudy')return isDay===0?'night':isDay===1?(kind==='clear'?'sunny':'cloudy'):'neutral';
 return kind==='hail'?'storm':kind==='freezing-rain'||kind==='drizzle'?'rain':kind;
}
export function weatherAtmosphere(hour:Pick<Hour,'weatherCode'|'isDay'>|undefined,fresh:boolean) {
 return fresh && hour ? weatherKindAtmosphere(weatherKind(hour.weatherCode),hour.isDay) : 'neutral';
}
export function WeatherIcon({code,isDay,label}:{code:number|null|undefined;isDay?:0|1|null;label?:string}) {
 const kind=weatherKind(code);const celestial=kind==='clear'||kind==='partly-cloudy';
 const description=label??(kind==='clear'?(isDay===0?'Clear night':isDay===1?'Clear sky':'Clear sky, daylight unknown'):kind.replaceAll('-',' '));
 const rain=['rain','drizzle','freezing-rain'].includes(kind);const snow=kind==='snow';const storm=kind==='storm'||kind==='hail';
 return <svg className="weather-icon" data-weather-icon={`${kind}${celestial?(isDay===0?'-night':isDay===1?'-day':'-unknown'):''}`} viewBox="0 0 64 64" role="img" aria-label={description} focusable="false" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
 {celestial&&isDay===1&&<g stroke="#c37a00"><circle cx="27" cy="25" r="11" fill="#ffca45"/>{Array.from({length:8},(_,i)=><path key={i} d="M27 7v-4" transform={`rotate(${i*45} 27 25)`}/>)}</g>}
 {celestial&&isDay===0&&<path d="M36 9a18 18 0 1 0 14 28A19 19 0 0 1 36 9Z" fill="#adaef4" stroke="#5d5db4"/>}
 {kind==='clear'&&isDay==null&&<g stroke="#667c90"><circle cx="32" cy="30" r="16"/><path d="M27 26a5 5 0 1 1 8 4l-3 3m0 6v1"/></g>}
 {kind!=='clear'&&kind!=='unknown'&&<path d="M15 39a10 10 0 1 1 2-20 15 15 0 0 1 28 3 9 9 0 1 1 3 17Z" fill={storm?'#8294b5':'#e4edf6'} stroke={storm?'#435577':'#738ca5'}/>}
 {rain&&[21,32,43].map(x=>kind==='drizzle'?<circle key={x} cx={x} cy="48" r="2" fill="#3b91ce" stroke="none"/>:<path key={x} d={`M${x} 45l-4 8`} stroke="#298aca"/>)}
 {kind==='freezing-rain'&&<path d="M26 58h17m-14-3 2 6m7-6 2 6" stroke="#6c74b2"/>}
 {snow&&[20,33,46].map(x=><path key={x} d={`M${x} 44v12m-5-9 10 6m0-6-10 6`} stroke="#418eb5"/>)}
 {storm&&<path d="m34 36-11 14h9l-5 12 18-20H34l5-6" fill="#ffcb43" stroke="#b87d16"/>}
 {kind==='hail'&&<g fill="#839bbc" stroke="#506a8d"><circle cx="15" cy="48" r="3"/><circle cx="48" cy="52" r="3"/></g>}
 {kind==='fog'&&<path d="M12 46h40M17 53h31" stroke="#91a0aa"/>}
 {kind==='unknown'&&<g stroke="#778594"><circle cx="32" cy="30" r="18"/><path d="M27 25a5 5 0 1 1 8 4l-3 3m0 7v1"/></g>}
 </svg>;
}

/** Decorative only: supplied weather determines CSS; no timers or requests. */
export function WeatherBackdrop() {
 useEffect(() => { void import('./weather-scene.css'); }, []);
 const [paused,setPaused]=useState(() => typeof document !== 'undefined' && document.hidden);
 useEffect(()=>{const change=()=>setPaused(document.hidden);document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);},[]);
 return <div className="weather-backdrop" aria-hidden="true" data-paused={paused}><svg className="scene-sky" viewBox="0 0 1440 1000" preserveAspectRatio="xMaxYMin slice" focusable="false">
  <defs>
   <radialGradient id="scene-light"><stop stopColor="#fff6d8" stopOpacity=".95"/><stop offset=".18" stopColor="#fff2ca" stopOpacity=".7"/><stop offset="1" stopColor="#ffe3b0" stopOpacity="0"/></radialGradient>
   <radialGradient id="scene-cloud-volume"><stop stopColor="var(--scene-cloud-color, #f3f6f8)" stopOpacity=".85"/><stop offset=".55" stopColor="var(--scene-cloud-color, #f3f6f8)" stopOpacity=".65"/><stop offset="1" stopColor="var(--scene-cloud-color, #f3f6f8)" stopOpacity="0"/></radialGradient>
   <linearGradient id="scene-horizon" x2="0" y2="1"><stop stopColor="var(--horizon-color)" stopOpacity="0"/><stop offset=".72" stopColor="var(--horizon-color)" stopOpacity=".5"/><stop offset="1" stopColor="var(--horizon-color)" stopOpacity=".1"/></linearGradient>
   <radialGradient id="scene-lunar"><stop stopColor="#fffbeb"/><stop offset=".8" stopColor="#e5e5df"/><stop offset="1" stopColor="#c6d0d8"/></radialGradient>
  </defs>
  <rect className="scene-horizon" width="1440" height="1000" fill="url(#scene-horizon)"/>
  <g className="scene-stars scene-motion" fill="#fff9ef">{Array.from({length:90},(_,i)=><circle key={i} cx={20+(i*173)%1400} cy={15+(i*97)%800} r={i%5===0?1.25:.65} opacity={.3+(i%7)/10}/>)}</g>
  <g className="scene-sun scene-motion"><circle cx="1190" cy="145" r="250" fill="url(#scene-light)"/><circle cx="1190" cy="145" r="28" fill="#fff6dc" opacity=".85"/></g>
  <g className="scene-moon"><circle cx="1190" cy="135" r="115" fill="url(#scene-light)" opacity=".25"/><circle cx="1190" cy="135" r="25" fill="url(#scene-lunar)"/>
   <g fill="#98a7b4" opacity=".2"><ellipse cx="1184" cy="128" rx="6" ry="9"/><circle cx="1197" cy="143" r="5"/><circle cx="1179" cy="143" r="3"/></g>
  </g>
  {[0,1,2,3,4,5].map(i=><g key={i} className={`scene-cloud scene-cloud-${i} scene-motion`}>
   {Array.from({length:12},(_,j)=><ellipse key={j} cx={j*34-40} cy={70+((j*31+i*17)%47)} rx={85+(j%3)*12} ry={25+(j%4)*9} fill="url(#scene-cloud-volume)" opacity={.45+(j%3)*.15}/>)}
   <ellipse cx="145" cy="126" rx="280" ry="24" fill="url(#scene-cloud-volume)" opacity=".45"/>
  </g>)}
 </svg>
 <svg className="scene-rain" width="100%" height="100%" focusable="false"><g className="scene-rainfall scene-motion" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">{Array.from({length:48},(_,i)=><path key={i} d={`M${(i*137)%1500} ${(i*83)%1200-160}l-10 30`}/>)}</g></svg>
 <svg className="scene-snow" width="100%" height="100%" focusable="false"><g className="scene-snowfall scene-motion" fill="#fff">{Array.from({length:42},(_,i)=><circle key={i} cx={(i*113)%1500} cy={(i*79)%1200-160} r={i%3+2}/>)}</g></svg>
 <svg className="scene-fog" viewBox="0 0 1440 1000" preserveAspectRatio="none" focusable="false"><g className="scene-mist scene-motion" fill="url(#scene-cloud-volume)" opacity=".6"><ellipse cx="410" cy="190" rx="720" ry="29"/><ellipse cx="1010" cy="315" rx="740" ry="40"/><ellipse cx="320" cy="520" rx="690" ry="35"/><ellipse cx="1060" cy="780" rx="780" ry="48"/></g></svg></div>;
}
