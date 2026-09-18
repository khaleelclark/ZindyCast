import React, { useEffect, useId } from 'react';
import type { Hour } from '@zindycast/contracts';
import { dayKey, timeLabel, type Units } from './weather';

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
// Decorative temperature palette, not heat guidance. Fixed Celsius anchors make
// a given temperature the same color across locations, daily ranges and units.
const temperatureColors = [
  [-40, [87, 65, 151]], [-10, [39, 105, 179]], [10, [22, 117, 133]],
  [20, [145, 108, 24]], [30, [186, 80, 28]], [40, [182, 43, 57]], [60, [130, 39, 109]],
] as const;
export function temperatureColor(valueC: number): string {
  const value = Math.max(-40, Math.min(60, valueC));
  const upper = temperatureColors.findIndex(([temperature]) => temperature >= value);
  const [end, b] = temperatureColors[Math.max(1, upper)]!;
  const [start, a] = temperatureColors[Math.max(0, upper - 1)]!;
  const weight = (value - start) / (end - start);
  return `rgb(${a.map((channel, index) => Math.round(channel + (b[index]! - channel) * weight)).join(', ')})`;
}
export function todayFeelsRange(hours: Hour[], now: number, zone: string) {
  const today = dayKey(new Date(now).toISOString(), zone);
  const rows = hours.filter(hour => dayKey(hour.time, zone) === today);
  const values = rows.flatMap(hour => finite(hour.apparentTemperatureC) ? [hour.apparentTemperatureC] : []);
  const localHour = (hour: Hour) => Number(timeLabel(hour.time, zone, { hour: 'numeric', hourCycle: 'h23' }));
  const partial = !rows.length || localHour(rows[0]!) !== 0 || localHour(rows.at(-1)!) !== 23
    || values.length !== rows.length || rows.some((hour, i) => i > 0 && Date.parse(hour.time) - Date.parse(rows[i - 1]!.time) !== 3_600_000);
  return { low: values.length ? Math.min(...values) : null, high: values.length ? Math.max(...values) : null, partial };
}
export function feelsPosition(value: number | null | undefined, low: number | null, high: number | null, fresh: boolean) {
  if (!fresh || !finite(value) || !finite(low) || !finite(high) || high <= low || value < low || value > high) return null;
  return (value - low) / (high - low);
}
export function FeelsLikeGauge({ valueC, lowC, highC, units, fresh, partial = false, showForecastRange = true }: {
  valueC: number | null | undefined; lowC: number | null; highC: number | null; units: Units; fresh: boolean; partial?: boolean; showForecastRange?: boolean;
}) {
  useEffect(() => { void import('./feels-like-gauge.css'); }, []);
  const gradientId = useId();
  const scaleLow = showForecastRange ? lowC : -40;
  const scaleHigh = showForecastRange ? highC : 60;
  const scaleLabel = showForecastRange ? 'daily forecast range' : 'display scale';
  const position = feelsPosition(valueC, scaleLow, scaleHigh, fresh);
  const range = finite(scaleLow) && finite(scaleHigh) && scaleHigh >= scaleLow;
  const exact = (value: number | null | undefined) => finite(value) ? `${(units === 'us' ? value * 9 / 5 + 32 : value).toFixed(1)}°${units === 'us' ? 'F' : 'C'}` : 'Unavailable';
  const status = !fresh ? 'Previously retrieved · position unavailable' : !finite(valueC) ? 'Current feels like unavailable'
    : !range ? 'Daily forecast range unavailable'
    : valueC < scaleLow! ? `Below ${scaleLabel} · position unavailable`
    : valueC > scaleHigh! ? `Above ${scaleLabel} · position unavailable`
    : scaleLow === scaleHigh ? 'Same low and high · no relative position' : '';
  const colored = fresh && finite(valueC);
  const valueColor = colored ? temperatureColor(valueC) : undefined;
  const angle = position == null ? null : Math.PI * (1 - position);
  return <figure className="feels-like-gauge" data-state={position == null ? 'neutral' : 'positioned'} aria-label={showForecastRange ? 'Feels like relative to today’s daily forecast range' : 'Feels-like temperature on a fixed numeric scale'}>
    <figcaption>Feels like</figcaption>
    <div className="feels-gauge-face">
      <svg viewBox="0 0 320 180" aria-hidden="true" focusable="false">
        {colored && range && <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">{Array.from({ length: 21 }, (_, index) => {
          const fraction = index / 20;
          return <stop key={index} offset={(1 - Math.cos(Math.PI * fraction)) / 2} stopColor={temperatureColor(scaleLow! + (scaleHigh! - scaleLow!) * fraction)} />;
        })}</linearGradient></defs>}
        <path d="M24 156 A136 136 0 0 1 296 156" fill="none" stroke={colored && range ? `url(#${gradientId})` : "#8296a3"} strokeWidth="16" strokeLinecap="round"/>
        {angle != null && <circle data-gauge-marker="true" cx={160 + 136 * Math.cos(angle)} cy={156 - 136 * Math.sin(angle)} r="9" fill={valueColor ?? "#173b50"} stroke="#f4fafc" strokeWidth="3"/>}
      </svg>
      <div className="feels-gauge-current" data-missing={!finite(valueC)}><strong className="feels-gauge-value" style={{ color: valueColor }}>{exact(valueC)}</strong></div>
    </div>
    {showForecastRange && <><div className="feels-gauge-endpoints"><span>{showForecastRange && 'Feels-like low'}<strong>{exact(scaleLow)}</strong></span><span>{showForecastRange && 'Feels-like high'}<strong>{exact(scaleHigh)}</strong></span></div>
    <p className="feels-gauge-caption">{!showForecastRange ? 'Feels-like temperature' : partial ? 'Daily forecast range · available hours only (partial)' : 'Daily forecast range · feels like'}</p></>}
    {status && <p className="feels-gauge-status">{status}</p>}
  </figure>;
}
