import React from 'react';
import {WeatherIcon} from './weather-appearance';
import { Card } from '@mui/material';
import { WbgtPanel, type WbgtPanelProps } from './wbgt-panel';
import type { Hour, Forecast } from '@zindycast/contracts';
import { temperature, speed, conditions, timeLabel, forecastPeriods, type Units } from './weather';
import { metricStatisticLabel } from './metric-display';
export function WindCompass({ direction, wind, units, heightLabel = '10 m' }: { direction: number | null | undefined; wind: number | null | undefined; units: Units; heightLabel?: string }) {
  return <div className="wind-widget"><div className="wind-compass" role="img" aria-label={direction == null ? 'Wind direction unavailable' : `Wind from ${direction} degrees north`}><span>N</span>{direction != null && <i style={{ transform: `rotate(${direction}deg)` }}>↑</i>}</div><span>{speed(wind, units)}<small>{direction == null ? 'Direction unavailable' : `From ${Math.round(direction)}° · ${heightLabel}`}</small></span></div>;
}
export function wetBulbRange(hours: Hour[]) { const values = hours.flatMap(h => h.ordinaryWetBulbC == null ? [] : [h.ordinaryWetBulbC]); return values.length ? { low: Math.min(...values), high: Math.max(...values), count: values.length } : null; }
export function HeatContext({ hour, hours, units, ...context }: WbgtPanelProps) {
  return <Card component="section" className="card heat-card"><p className="eyebrow">Heat & humidity</p><h2>Beyond air temperature</h2><WbgtPanel hour={hour} hours={hours} units={units} {...context} /></Card>;
}
export function HourlyStrip({ hours, units, zone }: { hours: Hour[]; units: Units; zone: string }) {
  return <div className="hourly-strip" tabIndex={0} aria-label={`${hours.length} upcoming forecast hours`}>{hours.map(h => <div key={h.time}><strong>{timeLabel(h.time, zone, { hour: 'numeric', timeZoneName: 'short' })}</strong><span className="hour-symbol" title={conditions(h.weatherCode)} aria-label={conditions(h.weatherCode)}><WeatherIcon code={h.weatherCode} isDay={h.isDay}/></span><b>{temperature(h.temperatureC, units)}</b><small>Temperature</small><span className="hour-feels">Feels {temperature(h.apparentTemperatureC, units)}</span><span className="hour-rain">{h.precipitationProbability == null ? '—' : `${h.precipitationProbability}%`}</span><small>Rain chance</small></div>)}</div>;
}
export function DailyRange({ low, high, days }: { low: number | null; high: number | null; days: { low: number | null; high: number | null }[] }) {
  const values = days.flatMap(d => [d.low, d.high].filter((n): n is number => n != null));
  if (low == null || high == null || !values.length) return <span className="daily-range" aria-hidden="true" />;
  const min = Math.min(...values), span = Math.max(1, Math.max(...values) - min);
  return <span className="daily-range" aria-hidden="true"><i style={{ left: `${(low - min) / span * 100}%`, width: `${Math.max(3, (high - low) / span * 100)}%` }} /></span>;
}

export function PeriodPreview({ forecast, now, units }: { forecast: Forecast; now: number; units: Units }) {
  return <div className="period-preview">{forecastPeriods(forecast, now).map(period => <div key={period.label}><h3>{period.label}</h3><strong>High {temperature(period.high, units)}<br />Low {temperature(period.low, units)}</strong><p>{period.condition}</p><small>{period.rainChance == null ? 'Rain chance unavailable' : `${metricStatisticLabel('precipitationProbabilityPercent', 'maximum', 'day')} ${period.rainChance}%`}</small><small>{period.hours.length} available hours · partial</small></div>)}</div>;
}
