import { cityColors as climateColors, metricUnit as climateUnit, metricNumber as climateNumber, metricValue as climateValue, hasDailyTemperatureRange } from './metric-display';
import React, { Component, useId, useState, type ReactNode } from 'react';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import type { ClimateResult, ClimateField, ClimateSummary, ClimateMetricSummary } from '../../../packages/contracts/src/climate-comparison';
import type { Units } from './weather';

export const climateLabels: Record<ClimateField, string> = { temperatureC: 'Air temperature', dewPointC: 'Dew point', wetBulbTemperatureC: 'Ordinary wet bulb', humidityPercent: 'Relative humidity', windSpeedMs: 'Wind at 10 m', precipitationMm: 'Precipitation', sunshineDurationSeconds: 'Sunshine duration', cloudCoverPercent: 'Cloud cover' };
export { cityColors as climateColors, metricUnit as climateUnit, metricNumber as climateNumber, metricValue as climateValue } from './metric-display';
export function climateHeadline(metric: ClimateMetricSummary | undefined, stat: 'mean' | 'avgDailyHigh' | 'avgDailyLow' | 'total' = 'mean') {
  return metric?.status === 'complete' ? metric[stat] : null;
}
/** A selected climatological month must become one concrete local calendar month. */
export function climateDrillWindow(summary: ClimateSummary | undefined, mode: 'period' | 'climatology', year: string, query: ClimateResult['plan']['query']): [string, string] | null {
  if (!summary) return null;
  let start = summary.startDate, end = summary.endDate;
  if (mode === 'climatology') {
    if (!/^\d{4}$/.test(year) || !summary.years.includes(Number(year))) return null;
    const month = summary.startDate.slice(5, 7);
    start = `${year}-${month}-01`;
    end = new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10);
  }
  start = start < query.startDate ? query.startDate : start;
  end = end > query.endDate ? query.endDate : end;
  return end >= start && Date.parse(end) - Date.parse(start) < 31 * 86400000 ? [start, end] : null;
}
class ClimateChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="status">Chart unavailable. Read the same values in the city tiles and detailed table.</p> : this.props.children; }
}
const chartStyle = { width: '100%', minWidth: 0, '&& svg': { minWidth: 0, maxHeight: 'none' }, '&& svg text': { fontSize: 12 } };
const tooltip = { tooltip: { sx: { maxWidth: 'calc(100vw - 32px)', '& td, & th': { whiteSpace: 'normal', overflowWrap: 'anywhere' } } } };
function monthLabel(summary: ClimateSummary, mode: 'period' | 'climatology') {
  return new Intl.DateTimeFormat('en', { month: 'short', ...(mode === 'period' ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(`${summary.startDate}T12:00:00Z`));
}
export function ClimateResults({ result, units, onDrill }: { result: ClimateResult; units: Units; onDrill: (locationId: string, startDate: string, endDate: string) => void }) {
  const [metric, setMetric] = useState<ClimateField>('temperatureC');
  const [period, setPeriod] = useState('overview');
  const [year, setYear] = useState('');
  const id = useId();
  const query = result.plan.query;
  const months = Array.from(new Map(result.locations.flatMap(city => city.monthly.map(month => [month.key, month] as const))).values()).sort((a, b) => a.key.localeCompare(b.key));
  const selectedPeriod = period === 'overview' || months.some(month => month.key === period) ? period : 'overview';
  const rows = result.locations.map((city, index) => ({ ...city, number: index + 1, color: climateColors[index]!, summary: selectedPeriod === 'overview' ? city.overview : city.monthly.find(month => month.key === selectedPeriod) }));
  const temperatureRange = hasDailyTemperatureRange(metric);
  const amount = metric === 'precipitationMm' || metric === 'sunshineDurationSeconds';
  const unit = climateUnit(metric, units);
  const fmt = (value: number | null) => climateValue(metric, value, units);
  const meanLabel = amount ? 'Average daily amount' : 'Average';
  const unequal = rows.some(row => row.summary?.metrics[metric].validDays !== rows[0]?.summary?.metrics[metric].validDays);
  const series = rows.map(row => ({ id: row.location.id, label: `${row.number}. ${row.location.name}`, color: row.color, data: months.map(month => climateNumber(metric, climateHeadline(row.monthly.find(m => m.key === month.key)?.metrics[metric]), units)), valueFormatter: (value: number | null) => value === null ? 'Some data missing' : `${value.toFixed(metric === 'precipitationMm' ? 2 : 1)} ${unit}` }));
  const drill = (locationId: string, summary: ClimateSummary | undefined) => { const window = climateDrillWindow(summary, query.mode, year, query); if (window) onDrill(locationId, ...window); };
  return <section className="climate-results" aria-labelledby={`${id}-title`}>
    <header className="climate-heading"><div><p className="eyebrow">ERA5 · modeled reanalysis</p><h2 id={`${id}-title`}>{query.mode === 'climatology' ? 'A seasonal view of your cities' : 'Your cities, side by side'}</h2><p>{query.startDate} – {query.endDate} · each city’s local calendar</p></div><div className="climate-controls">
      <label htmlFor={`${id}-period`}>Period<select aria-label="Period" id={`${id}-period`} value={selectedPeriod} onChange={e => setPeriod(e.target.value)}><option value="overview">Full selected period</option>{months.map(month => <option key={month.key} value={month.key}>{monthLabel(month, query.mode)}</option>)}</select></label>
      <label htmlFor={`${id}-metric`}>Climate variable<select aria-label="Climate variable" id={`${id}-metric`} value={metric} onChange={e => setMetric(e.target.value as ClimateField)}><optgroup label="Everyday measurements">{(['temperatureC','humidityPercent','precipitationMm','windSpeedMs'] as const).map(field => <option key={field} value={field}>{climateLabels[field]}</option>)}</optgroup><optgroup label="Advanced measurements">{(['dewPointC','wetBulbTemperatureC','sunshineDurationSeconds','cloudCoverPercent'] as const).map(field => <option key={field} value={field}>{climateLabels[field]}</option>)}</optgroup></select><small>Advanced measurements keep their distinct scientific definitions.</small></label>
      {query.mode === 'climatology' && <label htmlFor={`${id}-year`}>Year for daily detail<select aria-label="Year for daily detail" id={`${id}-year`} value={year} onChange={e => setYear(e.target.value)}><option value="">Choose a year</option>{Array.from(new Set(months.flatMap(m => m.years))).sort().map(y => <option key={y} value={y}>{y}</option>)}</select></label>}
    </div></header>
    <p className="climate-coverage" role="status">{unequal ? 'Some cities have missing data. ' : ''}Gaps in the charts mean data is missing.</p>
    <figure className="climate-chart"><figcaption>{climateLabels[metric]} · {amount ? 'average daily amount' : temperatureRange ? 'average low / average / average high' : 'average'} ({unit})</figcaption>
      {rows.some(row => climateHeadline(row.summary?.metrics[metric]) !== null) ? <ClimateChartBoundary key={`bar-${metric}-${units}-${selectedPeriod}`}><BarChart layout="horizontal" height={rows.length * 52 + 80} hideLegend skipAnimation margin={{ left: 0, right: 20, top: 12, bottom: 5 }}
        yAxis={[{ scaleType: 'band', width: 35, data: rows.map(row => row.number), colorMap: { type: 'ordinal', values: rows.map(row => row.number), colors: rows.map(row => row.color) }, valueFormatter: (n: number, context) => context.location === 'tick' ? String(n) : rows[n - 1]!.location.name }]}
        xAxis={[{ tickNumber: 4, valueFormatter: (n: number) => String(Number(n.toFixed(2))) }]}
        series={(temperatureRange ? ['avgDailyLow', 'mean', 'avgDailyHigh'] as const : ['mean'] as const).map(stat => ({ id: stat, label: stat === 'mean' ? meanLabel : stat === 'avgDailyLow' ? 'Average daily low' : 'Average daily high', data: rows.map(row => climateNumber(metric, climateHeadline(row.summary?.metrics[metric], stat), units)), valueFormatter: (v: number | null) => v === null ? 'Unavailable' : `${v.toFixed(2)} ${unit}` }))} grid={{ vertical: true }} slotProps={tooltip} sx={chartStyle} /></ClimateChartBoundary> : <p>Not enough data to show this comparison.</p>}
    {temperatureRange && <p>Compare each city’s average low, average and average high. Highest and lowest values appear below.</p>}
    </figure>
    <div className="climate-city-grid">{rows.map(row => { const summary = row.summary, stats = summary?.metrics[metric]; return <article className="climate-city" key={row.location.id} style={{ '--climate-color': row.color } as React.CSSProperties}>
      <h3><span className="climate-city-number">{row.number}</span>{row.location.name}</h3><p className="climate-place">{row.location.timezone}</p>
      <p className="climate-value">{fmt(climateHeadline(stats))}<small>{meanLabel}</small></p>
      <dl>{temperatureRange && <><div><dt>Average daily high</dt><dd>{fmt(climateHeadline(stats, 'avgDailyHigh'))}</dd></div><div><dt>Average daily low</dt><dd>{fmt(climateHeadline(stats, 'avgDailyLow'))}</dd></div></>}{amount && <div><dt>Period total</dt><dd>{fmt(climateHeadline(stats, 'total'))}</dd></div>}
        {(['max', 'min'] as const).map(stat => { const extreme = stats?.status === 'complete' ? stats[stat] : null; return <div key={stat}><dt>{stat === 'max' ? 'Highest' : 'Lowest'}{amount ? ' hourly amount' : ''}</dt><dd>{fmt(extreme?.value ?? null)}{extreme && <small>{extreme.localDate}</small>}</dd></div>; })}</dl>
      {stats?.status !== 'complete' && <p className="climate-coverage">{stats?.status === 'partial' ? 'Some data missing' : 'No data available'}</p>}
      {stats?.status === 'partial' && <p>Average for days with data: {fmt(stats.availableCompleteDays.mean)}.</p>}
      {selectedPeriod !== 'overview' && <button type="button" disabled={!climateDrillWindow(summary, query.mode, year, query)} onClick={() => drill(row.location.id, summary)}>Daily detail · {row.location.name}</button>}
    </article>; })}</div>
    <figure className="climate-chart"><figcaption>Month by month · {climateLabels[metric].toLowerCase()} · {meanLabel.toLowerCase()} ({unit})</figcaption>
      <ClimateChartBoundary key={`monthly-${metric}-${units}`}>
        {amount ? <BarChart height={310} skipAnimation hideLegend xAxis={[{ scaleType: 'band', data: months.map(m => monthLabel(m, query.mode)), tickLabelStyle: { fontSize: 11 } }]} yAxis={[{ tickNumber: 4, width: 48 }]} series={series} slotProps={tooltip} sx={chartStyle} onItemClick={(_, item) => { const row = rows.find(r => r.location.id === item.seriesId); if (row) drill(row.location.id, row.monthly.find(m => m.key === months[item.dataIndex]?.key)); }} /> :
        <LineChart height={310} skipAnimation hideLegend xAxis={[{ scaleType: 'point', data: months.map(m => monthLabel(m, query.mode)), tickLabelStyle: { fontSize: 11 } }]} yAxis={[{ tickNumber: 4, width: 48 }]} series={series.map(s => ({ ...s, showMark: true, connectNulls: false, curve: 'linear' as const }))} slotProps={tooltip} sx={chartStyle} onMarkClick={(_, item) => { const row = rows.find(r => r.location.id === item.seriesId); if (row) drill(row.location.id, row.monthly.find(m => m.key === months[item.dataIndex]?.key)); }} />}
      </ClimateChartBoundary><div className="climate-legend">{rows.map(row => <span key={row.location.id} style={{ color: row.color }}>{row.number}. {row.location.name}</span>)}</div>
      <p>Select a month above for city detail buttons, or select a chart point.{query.mode === 'climatology' && ' Choose a year first to open daily detail.'} Missing months stay gaps.</p>
    </figure>
    <h3>Humidity, rain and sky</h3><p>Wet bulb describes temperature with humidity taken into account; it is different from WBGT. A day can have both sunshine and rain.</p>
    <div className="climate-city-grid">{rows.map(row => { const summary = row.summary; if (!summary) return <article className="climate-city" key={row.location.id}><h4>{row.location.name}</h4><p>Month unavailable</p></article>; return <article className="climate-city" key={row.location.id} style={{ '--climate-color': row.color } as React.CSSProperties}><h4>{row.number}. {row.location.name}</h4>
      <dl>{(['p50', 'p90', 'p95'] as const).map(p => <div key={p}><dt>Wet bulb · {p === 'p50' ? 'typical' : p === 'p90' ? 'high end (90th percentile)' : 'high end (95th percentile)'}</dt><dd>{climateValue('wetBulbTemperatureC', summary.wetBulbDistribution[p], units)}</dd></div>)}</dl><p className="subtle">Typical is the middle value. The high-end values show the higher wet-bulb temperatures during this period.</p>
      <dl><div><dt>Rain days ≥ {climateValue('precipitationMm', 1, units)}</dt><dd>{summary.precipitationDays.qualifying} / {summary.expectedDays}<small>{summary.precipitationDays.unknown ? `${summary.precipitationDays.unknown} days missing data` : ''}</small></dd></div><div><dt>Sunshine total</dt><dd>{climateValue('sunshineDurationSeconds', climateHeadline(summary.metrics.sunshineDurationSeconds, 'total'), units)}</dd></div></dl>
      <p>Days by average cloud cover</p><div className="climate-cloud-bins">{['≤5%', '>5–25%', '>25–50%', '>50–69%', '>69–87%', '>87%'].map((label, index) => <div key={label}><span>{label}</span><strong>{summary.cloudDays.counts[index]}</strong></div>)}</div>{summary.cloudDays.unknown > 0 && <p>{summary.cloudDays.unknown} days missing cloud data</p>}
    </article>; })}</div>
    <details><summary>Monthly values</summary><div className="climate-table-scroll" tabIndex={0} role="region" aria-label="Monthly values"><table><caption>{climateLabels[metric]} · {unit}; — means unavailable</caption><thead><tr><th>City / month</th><th>{meanLabel}</th>{temperatureRange && <><th>Avg high</th><th>Avg low</th></>}{amount && <th>Total</th>}<th>Data</th></tr></thead><tbody>{rows.flatMap(row => row.monthly.map(month => { const m = month.metrics[metric]; return <tr key={`${row.location.id}-${month.key}`}><th>{row.number}. {row.location.name} · {monthLabel(month, query.mode)}</th><td>{fmt(climateHeadline(m))}</td>{temperatureRange && <><td>{fmt(climateHeadline(m, 'avgDailyHigh'))}</td><td>{fmt(climateHeadline(m, 'avgDailyLow'))}</td></>}{amount && <td>{fmt(climateHeadline(m, 'total'))}</td>}<td>{m.status === 'complete' ? 'Available' : m.status === 'partial' ? 'Some missing' : 'Unavailable'}</td></tr>; }))}</tbody></table></div></details>
    <details><summary>Sources and calculation method</summary><p>{result.dataset} · {result.classification} · {result.calculationVersion}</p><p>{result.weighting}. {result.intervalSemantics}. Coverage policy: {result.coveragePolicy}.</p>{rows.map(row => <div key={row.location.id}><h4>{row.location.name}</h4><p>Requested: {row.location.latitude}, {row.location.longitude} · {row.location.timezone}. Source grid: {row.source.sourceCoordinates.latitude}, {row.source.sourceCoordinates.longitude} · elevation {row.source.sourceElevationM ?? 'unavailable'} m.</p><p>{row.source.attribution}. {row.source.downscaling}. Source issue/update times unavailable; retrieval is not source freshness.</p><a href={row.source.sourceUrl} target="_blank" rel="noreferrer">Provider documentation</a><ul>{row.sources.map(source => <li key={source.chunkId}>Retrieved {source.retrievedAt} · <a href={source.requestUrl} target="_blank" rel="noreferrer">Source request</a></li>)}</ul></div>)}</details>
  </section>;
}
