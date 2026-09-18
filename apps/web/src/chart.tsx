import { Component, type ReactNode } from 'react';
import { WeatherChart, fillChartGaps } from './weather-chart';
import type { Hour } from '@zindycast/contracts';
import { timeLabel, type Units } from './weather';

export function chartSeries(hours: Hour[], field: 'temperatureC' | 'apparentTemperatureC') {
  const segments: { time: number; value: number }[][] = [];
  let segment: { time: number; value: number }[] = [];
  for (const hour of hours) {
    const value = hour[field]; const time = Date.parse(hour.time);
    if (value === null || (segment.length && time - segment.at(-1)!.time !== 3_600_000)) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (value !== null) segment.push({ time, value });
  }
  if (segment.length) segments.push(segment);
  return segments;
}
export class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="notice">The chart is unavailable. Use the hourly forecast table below.</p> : this.props.children; }
}
export function hourlyReadout(hour: Hour, units: Units, zone: string) {
  const exact = (value: number | null) => value === null ? 'Unavailable' : `${(units === 'us' ? value * 9 / 5 + 32 : value).toFixed(1)}°${units === 'us' ? 'F' : 'C'}`;
  return `${timeLabel(hour.time, zone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} · Temp ${exact(hour.temperatureC)} · Feels like ${exact(hour.apparentTemperatureC)}`;
}
export function nearestChartHour(hours: Hour[], time: number) {
  return hours.reduce((best, hour, index) => Math.abs(Date.parse(hour.time) - time) < Math.abs(Date.parse(hours[best]!.time) - time) ? index : best, 0);
}
export function HourlyChart({ hours, units, zone }: { hours: Hour[]; units: Units; zone: string }) {
  const points = fillChartGaps(hours.map(hour => ({ time: Date.parse(hour.time), values: [hour.temperatureC, hour.apparentTemperatureC] })));
  if (!points.some(point => point.values.some(value => value !== null))) return <p>Temperature chart unavailable: no temperature values. Other hourly details may be available in the table below.</p>;
  return <figure className="hourly-chart" style={{ minWidth: 0 }}><figcaption>Temperature trend · °{units === 'us' ? 'F' : 'C'}</figcaption>
    <WeatherChart points={points} labels={['Temp', 'Feels like']} colors={['#22695b', '#b56815']} units={units} zone={zone} label="Hourly temperatures" />
    <p className="subtle">Local time · {zone}. Gaps mean missing data. Hourly forecast table below.</p></figure>;
}
