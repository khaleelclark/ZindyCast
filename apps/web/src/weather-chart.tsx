import { useId, useState } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';
import { timeLabel, type Units } from './weather';

export type WeatherPoint = { time: number; values: (number | null)[] };
export function exactChartValue(value: number | null, units: Units) {
  return value === null ? 'Unavailable' : `${(units === 'us' ? value * 9 / 5 + 32 : value).toFixed(1)}°${units === 'us' ? 'F' : 'C'}`;
}
export function weatherChartReadout(point: WeatherPoint, labels: string[], units: Units, zone: string) {
  return `${timeLabel(new Date(point.time).toISOString(), zone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} · ${labels.map((label, i) => `${label} ${exactChartValue(point.values[i] ?? null, units)}`).join(' · ')}`;
}
// Insert explicit missing slots so the library never joins observations across an absent hour.
export function fillChartGaps(points: WeatherPoint[]): WeatherPoint[] {
  return points.flatMap((point, i) => i && point.time - points[i - 1]!.time > 3_600_000 ? [{ time: points[i - 1]!.time + 3_600_000, values: point.values.map(() => null) }, point] : [point]);
}
export function WeatherChart({ points, labels, colors, units, zone, label }: { points: WeatherPoint[]; labels: string[]; colors: string[]; units: Units; zone: string; label: string }) {
  const id = useId();
  const identity = JSON.stringify(points);
  const [selection, setSelection] = useState<{ identity: string; index: number } | null>(null);
  const selected = selection?.identity === identity ? selection.index : null;
  const choose = (index: number | undefined) => { if (index !== undefined && points[index]) setSelection({ identity, index }); };
  return <div data-weather-chart style={{ minWidth: 0, width: '100%' }}>
    <div id={id} data-chart-readout role="status" aria-live="polite" className="sr-only">{selected === null ? 'Hover or tap for exact values. Use arrow keys when focused.' : weatherChartReadout(points[selected]!, labels, units, zone)}</div>
    <div data-chart-hit-area tabIndex={0} role="slider" aria-label={label} aria-valuemin={1} aria-valuemax={points.length} aria-valuenow={(selected ?? 0) + 1} aria-valuetext={points[selected ?? 0] ? weatherChartReadout(points[selected ?? 0]!, labels, units, zone) : 'Unavailable'} aria-describedby={id} style={{ touchAction: 'pan-y', borderRadius: 8 }} onFocus={() => choose(selected ?? 0)} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setSelection(null); return; }
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
      if (delta || ['Home', 'End', 'Enter', ' '].includes(event.key)) { event.preventDefault(); choose(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (selected ?? 0) + delta))); }
    }}>
      <LineChart height={280} margin={{ top: 20, right: 18, bottom: 4, left: 0 }} disableKeyboardNavigation skipAnimation hideLegend={labels.length === 1}
        xAxis={[{ id: 'time', scaleType: 'time', data: points.map(p => new Date(p.time)), tickNumber: 3, tickLabelMinGap: 36, height: 62, valueFormatter: (date: Date, context) => context.location === 'tick' ? `${timeLabel(date.toISOString(), zone, { weekday: 'short' })}\n${timeLabel(date.toISOString(), zone, { hour: 'numeric', timeZoneName: 'short' })}` : timeLabel(date.toISOString(), zone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) }]}
        yAxis={[{ width: 52, tickNumber: 4, valueFormatter: (value: number) => `${Math.round(value)}°` }]}
        series={labels.map((name, i) => ({ id: name, label: name, color: colors[i], data: points.map(p => p.values[i] == null ? null : units === 'us' ? p.values[i]! * 9 / 5 + 32 : p.values[i]!), valueFormatter: (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(1)}°${units === 'us' ? 'F' : 'C'}`, connectNulls: false, curve: 'linear' as const, showMark: false }))}
        slotProps={{ tooltip: { sx: { maxWidth: 'calc(100vw - 32px)', '& .MuiChartsTooltip-paper': { maxWidth: '100%' }, '& td, & th': { fontSize: 16, whiteSpace: 'normal' } } } }}
        grid={{ horizontal: true }} highlightedAxis={selected === null ? [] : [{ axisId: 'time', dataIndex: selected }]}
        onHighlightedAxisChange={items => choose(items.find(item => item.axisId === 'time')?.dataIndex)} onAxisClick={(_event, data) => choose(data?.dataIndex)}
        sx={{ width: '100%', minWidth: 0, touchAction: 'pan-y', '&& svg': { minWidth: 0, maxHeight: 'none' }, '&& svg text': { fontSize: 13 }, '& .MuiChartsAxis-tickLabel': { fontSize: 13 }, '& .MuiChartsLegend-label': { fontSize: 16 }, '& .MuiLineElement-root': { strokeWidth: 3 }, '& [data-series="Feels like"] .MuiLineElement-root, & .MuiLineElement-series-Feels\\ like': { strokeDasharray: '6 4' } }}
      />
    </div>
  </div>;
}
