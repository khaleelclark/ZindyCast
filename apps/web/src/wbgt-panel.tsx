import React, { useEffect } from 'react';
import { WeatherChart } from './weather-chart';
import { HeatBandStatus, HeatGuidance, bandLabel } from './heat-guidance';
import { Chip, Tooltip } from '@mui/material';
import type { Hour, Forecast } from '@zindycast/contracts';
import { TULSA_WBGT_SCALE, tulsaWbgtPosition } from '@zindycast/heat';
import { currentHour, timeLabel, type Units } from './weather';

const HOUR = 3_600_000;
const domain = [(70 - 32) * 5 / 9, (100 - 32) * 5 / 9] as const;
const number = (c: number, units: Units) => `${(units === 'us' ? c * 9 / 5 + 32 : c).toFixed(1)}°${units === 'us' ? 'F' : 'C'}`;
export function wbgtValue(hour: Hour | undefined) {
  const result = hour?.wbgt;
  return result?.status === 'success' && result.diagnostics?.input.time === hour?.time && result.valueC != null && Number.isFinite(result.valueC) ? result.valueC : null;
}
export function wbgtSeries(hours: Hour[], now: number) {
  const start = Math.floor(now / HOUR) * HOUR;
  return Array.from({ length: 48 }, (_, i) => {
    const time = start + i * HOUR;
    return { time, value: wbgtValue(hours.find(h => Date.parse(h.time) === time)) };
  });
}
export type WbgtPanelProps = { hour?: Hour; hours: Hour[]; units: Units; now: number; zone: string; online: boolean; freshness: 'fresh' | 'stale'; aged: boolean; provenance?: Forecast['provenance'] };
export function WbgtPanel({ hour, hours, units, now, zone, online, freshness, aged }: WbgtPanelProps) {
  useEffect(() => { void import('./wbgt-band-scale.css'); }, []);
  const fresh = online && freshness === 'fresh' && !aged;
  const eligible = fresh && hour && currentHour([hour], now) ? hour : undefined;
  const value = wbgtValue(eligible);
  const position = tulsaWbgtPosition({ metric: 'wbgt', valueC: value }, domain);
  const bandIndex = position.status === 'positioned' ? position.bandIndex : null;
  const markerPercent = position.status !== 'positioned' ? null : bandIndex != null ? bandIndex * 20 + 10 : (TULSA_WBGT_SCALE.boundariesF.indexOf(position.boundaryF as 80 | 85 | 88 | 90) + 1) * 20;
  const markerLabel = value == null ? '' : `Current WBGT ${number(value, units)} · ${bandIndex == null ? 'reference boundary; adjacent bands unresolved' : `reference band ${bandLabel(bandIndex, units)}`}`;
  const series = online ? wbgtSeries(hours, now) : [];
  const trend = series.slice(0, 24);
  const values = trend.flatMap(p => p.value == null ? [] : [p.value]);
  return <section className="wbgt-panel wbgt-banded" data-wbgt-band={bandIndex ?? 'neutral'} aria-label="Estimated outdoor WBGT">
    <div className="metric-row"><h3>Outdoor heat · WBGT</h3>{value == null ? <Chip label="Unavailable" size="small" /> : <strong className="wbgt-value">{number(value, units)}</strong>}</div>
    <p className="wbgt-explanation">Estimated heat stress from temperature, humidity, wind and sunshine.</p>

    {value == null && <p className="subtle">{!online ? 'Offline — no current WBGT.' : !fresh ? 'Stale forecast — no current WBGT.' : eligible?.wbgt?.reason ?? 'No eligible hourly WBGT estimate.'}</p>}
    <div className="wbgt-interpretation"><figure className="wbgt-scale"><figcaption><a href={TULSA_WBGT_SCALE.sourceUrl} target="_blank" rel="noreferrer">{TULSA_WBGT_SCALE.title}</a><small className="wbgt-band-caption">Equal band widths · not a linear temperature scale</small></figcaption><div className="wbgt-scale-track">
      {TULSA_WBGT_SCALE.labels.map((_, i) => <span className={`wbgt-band wbgt-band-${i}`} key={i} style={{ left: `${i * 20}%`, width: '20%' }} title={bandLabel(i, units)} />)}
      {position.status === 'positioned' && <Tooltip title={markerLabel} enterTouchDelay={0} leaveTouchDelay={4000} arrow><button type="button" className="wbgt-marker" data-wbgt-current="true" style={{ left: `${markerPercent}%` }} aria-label={markerLabel}>{bandIndex == null ? '◇' : '▼'}</button></Tooltip>}
    </div><div className="wbgt-band-labels">{TULSA_WBGT_SCALE.labels.map((_, i) => <span key={i} title={bandLabel(i, units)}>{bandLabel(i, units).split('°')[0]}<small>°{units === 'us' ? 'F' : 'C'}</small></span>)}</div><div className="wbgt-intensity-labels"><span>Lower heat stress</span><span>Higher heat stress</span></div></figure>
    <HeatBandStatus valueC={value} units={units} />
    <div className="heat-disclosures"><HeatGuidance valueC={value} units={units} />
    <details className="heat-trend"><summary>24-hour heat trend</summary><figure className="wbgt-forecast"><figcaption>Heat over the next 24 hours · WBGT °{units === 'us' ? 'F' : 'C'}{!fresh && ' · previously retrieved forecast'}</figcaption>{values.length ? <><WeatherChart points={trend.map(p => ({ time: p.time, values: [p.value] }))} labels={['WBGT']} colors={['#6754ab']} units={units} zone={zone} label="Hourly outdoor heat" /><small>{values.length}/24 values · gaps are missing · local time</small></> : <p className="subtle">WBGT forecast unavailable.</p>}</figure></details>
    <details className="heat-method"><summary>About this estimate</summary><p className="subtle">Modeled outdoor · short-grass reference</p>{eligible && value != null && <p className="subtle">Estimate at <time dateTime={eligible.time}>{timeLabel(eligible.time, zone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</time></p>}</details>
    </div></div>
  </section>;
}
