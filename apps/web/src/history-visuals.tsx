import { metricNumber, metricStatisticLabel } from './metric-display';
import { useEffect, useId, useState } from 'react';
import { LineChart } from '@mui/x-charts/LineChart';
import type { ReanalysisData, ReanalysisHour, StationData, StationValue } from '@zindycast/contracts';
import { temperature, rain, speed, type Units } from './weather';
import { exactChartValue } from './weather-chart';

export function availableStats(values: (number | null)[]) {
  const valid = values.filter((v): v is number => v !== null);
  return { count: valid.length, low: valid.length ? Math.min(...valid) : null, high: valid.length ? Math.max(...valid) : null, mean: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null };
}
export function historyDailyRows(hours: ReanalysisHour[]) {
  const days = new Map<string, ReanalysisHour[]>();
  for (const hour of hours) { const date = hour.time.slice(0, 10); days.set(date, [...(days.get(date) ?? []), hour]); }
  return [...days].map(([date, values]) => ({ date, ...availableStats(values.map(h => h.temperatureC)) }));
}
// Conservative visual screen only, not station eligibility or a scientific accuracy assessment.
export function stationVisualValue(v: StationValue) {
  return v.qcStatus === 'unflagged' && !v.trace && !v.presumedZero && v.unknownFlags.length === 0 ? v.value : null;
}
type PlotSeries = { label: string; color: string; values: (number | null)[] };
function HistoryPlot({ dates, series, format, label, hourly = false }: { dates: string[]; series: PlotSeries[]; format: (value: number | null) => string; label: string; hourly?: boolean }) {
  const id = useId(); const [selected, setSelected] = useState<number | null>(null);
  const choose = (i: number | undefined) => { if (i !== undefined && dates[i]) setSelected(i); };
  const index = Math.min(selected ?? 0, dates.length - 1);
  const readout = `${dates[index]?.replace('T', ' ').replace('.000Z', 'Z')} · ${series.map(s => `${s.label} ${format(s.values[index] ?? null)}`).join(' · ')}`;
  return <div className="history-plot"><p id={id} className="history-plot-readout" role="status">{selected === null ? 'Hover or tap for values · focus and use arrow keys' : readout}</p><div tabIndex={0} role="slider" aria-label={label} aria-valuemin={1} aria-valuemax={dates.length} aria-valuenow={index + 1} aria-valuetext={readout} aria-describedby={id} onFocus={() => choose(0)} onKeyDown={e => {
    if (e.key === 'Escape') { setSelected(null); return; }
    if (['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); choose(e.key === 'Home' ? 0 : e.key === 'End' ? dates.length - 1 : Math.max(0, Math.min(dates.length - 1, index + (['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1)))); }
  }}><LineChart height={300} skipAnimation disableKeyboardNavigation margin={{ left: 0, right: 36, top: 18, bottom: 0 }}
    xAxis={[{ id: 'history-date', scaleType: 'point', data: dates, disableTicks: true, tickInterval: (_value, index) => index === 0 || index === Math.floor((dates.length - 1) / 2) || index === dates.length - 1, tickNumber: 3, tickLabelMinGap: 55, height: 55, valueFormatter: (v: string, c) => c.location === 'tick' ? hourly ? `${v.slice(5, 10)}\n${v.slice(11, 13)}h` : v.slice(5) : `${v.replace('T', ' ')}${hourly ? ' UTC' : ' · source date'}` }]}
    yAxis={[{ width: 62, tickNumber: 4, valueFormatter: (v: number) => format(v) }]}
    series={series.map(s => ({ id: s.label, label: s.label, color: s.color, data: s.values, valueFormatter: format, connectNulls: false, curve: 'linear' as const, showMark: dates.length < 32 }))}
    grid={{ horizontal: true }} highlightedAxis={selected === null ? [] : [{ axisId: 'history-date', dataIndex: index }]} onHighlightedAxisChange={items => choose(items.find(i => i.axisId === 'history-date')?.dataIndex)} onAxisClick={(_e, data) => choose(data?.dataIndex)}
    slotProps={{ tooltip: { sx: { maxWidth: 'calc(100vw - 24px)', '& td, & th': { fontSize: 16, whiteSpace: 'normal' } } } }}
    sx={{ width: '100%', minWidth: 0, touchAction: 'pan-y', '&& svg': { minWidth: 0, maxHeight: 'none' }, '&& svg text': { fontSize: 12 }, '& .MuiLineElement-root': { strokeWidth: 2.5 }, '& .MuiChartsLegend-label': { fontSize: 14 } }}/></div></div>;
}
function Stat({ label, value, note }: { label: string; value: string; note: string }) { return <div className="history-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function useVisualStyles() { useEffect(() => { void import('./history-visuals.css'); }, []); }
const displayTemp = (v: number | null, units: Units) => metricNumber('temperatureC', v, units);
export function HistoryVisuals({ data, units }: { data: ReanalysisData; units: Units }) {
  useVisualStyles();
  const [metric, setMetric] = useState('temperature');
  const stats = (field: 'temperatureC' | 'dewPointC' | 'humidityPercent' | 'windSpeedMs' | 'precipitationMm') => availableStats(data.hours.map(h => h[field]));
  const air = stats('temperatureC'), dew = stats('dewPointC'), humidity = stats('humidityPercent'), wind = stats('windSpeedMs'), precip = stats('precipitationMm');
  const n = data.completeness.expectedHours; const count = (v: number) => `${v}/${n} hours available`;
  const format = (v: number | null) => v === null ? 'Unavailable' : metric === 'temperature' ? `${v.toFixed(1)}°${units === 'us' ? 'F' : 'C'}` : metric === 'humidity' ? `${v.toFixed(1)}%` : metric === 'wind' ? speed(v, units) : rain(v, units);
  const series = metric === 'temperature' ? [{ label: 'Air', color: '#ad532b', values: data.hours.map(h => displayTemp(h.temperatureC, units)) }, { label: 'Dew point', color: '#247d83', values: data.hours.map(h => displayTemp(h.dewPointC, units)) }] : [{ label: metric === 'humidity' ? 'Humidity' : metric === 'wind' ? 'Wind (10 m)' : 'Preceding-hour precipitation', color: '#247d83', values: data.hours.map(h => metric === 'humidity' ? h.humidityPercent : metric === 'wind' ? h.windSpeedMs : h.precipitationMm) }];
  const rows = historyDailyRows(data.hours); const extent = Math.max(1, (air.high ?? 0) - (air.low ?? 0));
  return <section className="history-visuals" aria-label="Modeled history visual summary"><div className="history-summary">
    <Stat label={metricStatisticLabel('temperatureC', 'maximum')} value={exactChartValue(air.high, units)} note={count(air.count)}/><Stat label={metricStatisticLabel('temperatureC', 'minimum')} value={exactChartValue(air.low, units)} note={count(air.count)}/><Stat label={metricStatisticLabel('temperatureC', 'mean')} value={exactChartValue(air.mean, units)} note="Average of available hours"/>
    <Stat label={metricStatisticLabel('dewPointC', 'mean')} value={exactChartValue(dew.mean, units)} note={count(dew.count)}/><Stat label={metricStatisticLabel('humidityPercent', 'mean')} value={humidity.mean === null ? 'Unavailable' : `${humidity.mean.toFixed(1)}%`} note={count(humidity.count)}/><Stat label={metricStatisticLabel('windSpeedMs', 'mean')} value={speed(wind.mean, units)} note={count(wind.count)}/><Stat label={metricStatisticLabel('precipitationMm', 'maximum', 'hour')} value={rain(precip.high, units)} note={count(precip.count)}/>
  </div><p className="subtle">Available-hour summaries · {data.completeness.status === 'complete' ? 'complete' : 'partial or missing'} coverage. Precipitation is for the preceding hour, not a calendar-day total.</p>
  <label className="history-metric">Explore hourly values<select value={metric} onChange={e => setMetric(e.target.value)}><option value="temperature">Air & dew point</option><option value="humidity">Humidity</option><option value="wind">Wind</option><option value="precipitation">Precipitation · preceding hour</option></select></label>
  {series.some(s => s.values.some(v => v !== null)) ? <HistoryPlot key={`${metric}-${units}-${data.query.startDate}-${data.query.endDate}`} dates={data.hours.map(h => h.time)} series={series} format={format} label="Historical hourly values in UTC" hourly/> : <p>No values available for this chart; no temperature values or other selected values. Details retain all missing hours.</p>}
  <h3>Daily air ranges · UTC</h3><p className="subtle">Extremes of available hourly values, not observed daily maxima or minima.</p><div className="history-daily-ranges">{rows.map(row => <div className="history-range-row" key={row.date}><span>{row.date}<small>{row.count}/24 hours</small></span><span>{temperature(row.low, units)}</span><span className="history-range-track" aria-hidden="true">{row.low !== null && row.high !== null && <i style={{ left: `${((row.low - (air.low ?? 0)) / extent) * 100}%`, width: `${((row.high - row.low) / extent) * 100}%` }}/>}</span><span>{temperature(row.high, units)}</span></div>)}</div></section>;
}
export function StationVisuals({ data, units }: { data: StationData; units: Units }) {
  useVisualStyles(); const [metric, setMetric] = useState('temperature');
  const highs = data.days.map(d => stationVisualValue(d.TMAX)), lows = data.days.map(d => stationVisualValue(d.TMIN)), precipitation = data.days.map(d => stationVisualValue(d.PRCP));
  const high = availableStats(highs), low = availableStats(lows), wet = availableStats(precipitation);
  const series = metric === 'temperature' ? [{ label: 'Daily high', color: '#ad532b', values: highs.map(v => displayTemp(v, units)) }, { label: 'Daily low', color: '#247d83', values: lows.map(v => displayTemp(v, units)) }] : [{ label: 'Source daily precipitation', color: '#247d83', values: precipitation }];
  return <section className="history-visuals" aria-label="Station visual summary"><div className="history-summary"><Stat label="Highest daily maximum" value={exactChartValue(high.high, units)} note={`${high.count}/${data.days.length} source dates plotted`}/><Stat label="Lowest daily minimum" value={exactChartValue(low.low, units)} note={`${low.count}/${data.days.length} source dates plotted`}/><Stat label="Largest reported precipitation" value={rain(wet.high, units)} note={`${wet.count}/${data.days.length} source dates plotted`}/></div><p className="subtle">Plots show numeric values with blank QC and known flags only; trace and presumed zero excluded. Gaps include missing or excluded values. Blank QC is not an accuracy guarantee. Source calendar dates; accumulation intervals unknown. No period totals.</p><label className="history-metric">Explore station values<select value={metric} onChange={e => setMetric(e.target.value)}><option value="temperature">Daily high & low</option><option value="precipitation">Source daily precipitation</option></select></label>{series.some(s => s.values.some(v => v !== null)) ? <HistoryPlot key={`${metric}-${units}`} dates={data.days.map(d => d.date)} series={series} format={v => v === null ? 'Unavailable / excluded' : metric === 'temperature' ? `${v.toFixed(1)}°${units === 'us' ? 'F' : 'C'}` : rain(v, units)} label="Station values by source calendar date"/> : <p>No values pass the visual screen. Inspect the full values and flags below.</p>}</section>;
}
