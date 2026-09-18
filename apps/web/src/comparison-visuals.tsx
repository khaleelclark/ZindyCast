import { cityColors, metricLabel, metricStatisticLabel, metricUnit as comparisonUnit, metricNumber as comparisonNumber, metricValue as comparisonVisualValue } from './metric-display';
import React, { Component, useId, useState, type ReactNode } from 'react';
import { BarChart } from '@mui/x-charts/BarChart';
import { fields, type ComparisonResult } from './comparison-model';
import type { Units } from './weather';

export type ComparisonMetric = typeof fields[number];
export const comparisonMetricLabels: Record<ComparisonMetric, string> = { temperatureC: metricLabel('temperatureC'), dewPointC: metricLabel('dewPointC'), humidityPercent: metricLabel('humidityPercent'), windSpeedMs: metricLabel('windSpeedMs'), precipitationMm: 'Preceding-hour precipitation' };
export { metricUnit as comparisonUnit, metricNumber as comparisonNumber, metricValue as comparisonVisualValue } from './metric-display';
export function comparisonVisualRows(result: ComparisonResult, field: ComparisonMetric, units: Units) {
  return result.locations.map((city, index) => ({ id: city.location.id, name: city.location.name, number: index + 1, color: cityColors[index % cityColors.length]!, summary: city.variables[field], mean: comparisonNumber(field, city.variables[field].mean, units) }));
}
class ComparisonChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="status">Chart unavailable. City summaries below contain the same values.</p> : this.props.children; }
}
export function ComparisonVisuals({ result, units }: { result: ComparisonResult; units: Units }) {
  const [metric, setMetric] = useState<ComparisonMetric>('temperatureC');
  const id = useId();
  const rows = comparisonVisualRows(result, metric, units);
  const unit = comparisonUnit(metric, units);
  const common = result.commonValidCounts[metric];
  const expected = result.plan.window.expectedHours;
  const unequal = rows.some(row => row.summary.validCount !== rows[0]!.summary.validCount);
  return <section className="comparison-visuals" aria-labelledby={`${id}-title`}>
    <div className="comparison-visual-heading"><div><p className="eyebrow">City overview · modeled reanalysis</p><h2 id={`${id}-title`}>One period, {rows.length} places</h2><p>{result.plan.query.startDate} – {result.plan.query.endDate} · UTC</p></div><label htmlFor={`${id}-metric`}>Compare variable<select id={`${id}-metric`} value={metric} onChange={event => setMetric(event.target.value as ComparisonMetric)}>{fields.map(field => <option key={field} value={field}>{comparisonMetricLabels[field]}</option>)}</select></label></div>
    <p className="comparison-coverage" role="status"><strong>{common}/{expected} shared valid hourly slots</strong> · {unequal ? 'Unequal city coverage.' : 'City counts match; valid hours may differ.'} Means use each city’s available values, not only shared hours.</p>
    <figure className="comparison-mean-chart" aria-label={`${comparisonMetricLabels[metric]} available-value means in ${unit}`}>
      <figcaption>{comparisonMetricLabels[metric]} · mean ({unit})</figcaption>
      {rows.some(row => row.mean !== null) ? <ComparisonChartBoundary key={`${metric}-${units}`}><BarChart layout="horizontal" height={Math.max(230, rows.length * 54 + 65)} margin={{ left: 0, right: 20, top: 12, bottom: 6 }} hideLegend skipAnimation
        yAxis={[{ id: 'cities', scaleType: 'band', width: 40, data: rows.map(row => row.number), valueFormatter: (value: number, context) => context.location === 'tick' ? String(value) : rows[value - 1]!.name, colorMap: { type: 'ordinal', values: rows.map(row => row.number), colors: rows.map(row => row.color) } }]}
        xAxis={[{ scaleType: 'linear', tickNumber: 4, height: 38, valueFormatter: (value: number) => `${Number(value.toFixed(2))}` }]}
        series={[{ id: 'mean', label: `Mean ${comparisonMetricLabels[metric]}`, data: rows.map(row => row.mean), valueFormatter: (value: number | null) => value === null ? 'Unavailable' : `${value.toFixed(metric === 'precipitationMm' ? 2 : 1)} ${unit}` }]}
        grid={{ vertical: true }} borderRadius={3}
        slotProps={{ tooltip: { sx: { maxWidth: 'calc(100vw - 32px)', '& td, & th': { whiteSpace: 'normal', overflowWrap: 'anywhere' } } } }}
        sx={{ width: '100%', minWidth: 0, '&& svg': { minWidth: 0, maxHeight: 'none' }, '&& svg text': { fontSize: 13 } }}
      /></ComparisonChartBoundary> : <p>No available values for this variable in any selected city.</p>}
      <p className="subtle">Bars show available-value means. Min/max ranges below describe available hours; they are not distributions. A zero mean has no bar length.</p>
    </figure>
    <div className="comparison-city-grid">{rows.map(row => <article className="comparison-city-summary" key={row.id} style={{ '--comparison-city-color': row.color } as React.CSSProperties}>
      <h3><span className="comparison-city-number">{row.number}</span>{row.name}</h3>
      <p className="comparison-city-value">{comparisonVisualValue(metric, row.summary.mean, units)}<small>{metricStatisticLabel(metric, 'mean', 'available-hours')}</small></p>
      <dl><div><dt>{metricStatisticLabel(metric, 'minimum', 'available-hours')}</dt><dd>{comparisonVisualValue(metric, row.summary.min, units)}</dd></div><div><dt>{metricStatisticLabel(metric, 'maximum', 'available-hours')}</dt><dd>{comparisonVisualValue(metric, row.summary.max, units)}</dd></div></dl>
      <p className="comparison-city-coverage"><strong>{row.summary.status === 'no_data' ? 'No data' : row.summary.status === 'partial' ? 'Partial' : 'Complete'}</strong> · {row.summary.validCount}/{row.summary.expectedCount} valid · {row.summary.missingCount} missing</p>
      {metric === 'precipitationMm' && <p className="comparison-rain-note">Mean of available hourly amounts, not a period total.</p>}
    </article>)}</div>
  </section>;
}
