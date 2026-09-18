import { Button } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { ComparisonResultSchema } from '@zindycast/contracts';
import { fields, type ComparisonResult } from './comparison-model';

type Cell = string | number | null;
/** Quote every cell; neutralize spreadsheet formulas in text, while retaining numeric negatives. */
export function comparisonCsvCell(value: Cell): string {
  if (value === null) return '""';
  let text = String(value);
  if (typeof value === 'string') {
    text = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
    if (/^[\s\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@＝＋－＠]/u.test(text)) text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
const columns = ['record_type', 'start_date_utc', 'end_date_utc_inclusive', 'window_start_inclusive', 'window_end_exclusive', 'timezone', 'dataset', 'classification', 'requested_model', 'constituent_model', 'comparison_method', 'weighting', 'interval_semantics', 'notes', 'location_id', 'location_name', 'requested_latitude', 'requested_longitude', 'variable', 'unit', 'expected_count', 'valid_count', 'missing_count', 'absent_source_count', 'null_value_count', 'status', 'mean', 'min', 'max', 'shared_valid_count', 'sum_available_mm', 'complete_window_total_mm', 'chunk_id', 'chunk_start_date_utc', 'chunk_end_date_utc_inclusive', 'source_latitude', 'source_longitude', 'source_elevation_m', 'provider', 'retrieved_at', 'source_issued_at', 'source_updated_at', 'cell_selection', 'downscaling', 'adapter_method', 'source_documentation', 'attribution'] as const;
type Row = Partial<Record<typeof columns[number], Cell>>;
/** Only the displayed result enters this boundary; no form state, job envelope or credentials. */
export function comparisonCsv(snapshot: ComparisonResult): string {
  if (snapshot.locations.reduce((n, l) => n + l.sources.length, 0) > 60) throw new Error('Too many source chunks for this bounded export.');
  const r = ComparisonResultSchema.parse(snapshot);
  const common: Row = { start_date_utc: r.plan.query.startDate, end_date_utc_inclusive: r.plan.query.endDate, window_start_inclusive: r.plan.window.startInclusive, window_end_exclusive: r.plan.window.endExclusive, timezone: r.plan.timezone, dataset: r.dataset, classification: r.classification, requested_model: r.plan.requestedModel, constituent_model: r.constituent, comparison_method: r.calculationVersion, weighting: r.weighting, interval_semantics: r.intervalSemantics };
  const rows: Row[] = [{ ...common, record_type: 'export_metadata', notes: 'Summary snapshot, not original hourly source values. SI units independent of display units. Blank means unavailable or not applicable, never zero. Source issue/update times and constituent model unavailable. Means use each location’s available hours, not shared intersection. Partial rain sum is not a complete-window total. No rankings, station observations or WBGT. Text control characters replaced by spaces; formula-like text prefixed with apostrophe. Request URLs omitted.' }];
  for (const l of r.locations) {
    const location: Row = { ...common, location_id: l.location.id, location_name: l.location.name, requested_latitude: l.location.latitude, requested_longitude: l.location.longitude };
    for (const field of fields) {
      const v = l.variables[field];
      rows.push({ ...location, record_type: 'variable_summary', variable: field, unit: v.unit, expected_count: v.expectedCount, valid_count: v.validCount, missing_count: v.missingCount, absent_source_count: v.absentSourceCount, null_value_count: v.nullValueCount, status: v.status, mean: v.mean, min: v.min, max: v.max, shared_valid_count: r.commonValidCounts[field], sum_available_mm: field === 'precipitationMm' ? l.variables.precipitationMm.sumAvailableMm : null, complete_window_total_mm: field === 'precipitationMm' ? l.variables.precipitationMm.totalMm : null });
    }
    for (const s of l.sources) {
      const p = s.provenance;
      rows.push({ ...location, record_type: 'source_chunk', chunk_id: s.chunkId, chunk_start_date_utc: s.query.startDate, chunk_end_date_utc_inclusive: s.query.endDate, requested_latitude: s.query.latitude, requested_longitude: s.query.longitude, dataset: p.dataset, classification: p.classification, requested_model: p.requestedModel, constituent_model: p.constituent, source_latitude: p.sourceCoordinates.latitude, source_longitude: p.sourceCoordinates.longitude, source_elevation_m: p.sourceElevationM, provider: p.provider, retrieved_at: p.retrievedAt, source_issued_at: p.sourceIssuedAt, source_updated_at: p.sourceUpdatedAt, cell_selection: p.cellSelection, downscaling: p.downscaling, adapter_method: p.calculationVersion, source_documentation: p.sourceUrl, attribution: p.attribution, notes: 'Source chunk may include padding beyond summary window; grid coordinates belong to this chunk. Retrieval is not source freshness.' });
    }
  }
  const csv = [columns.map(comparisonCsvCell).join(','), ...rows.map(row => columns.map(key => comparisonCsvCell(row[key] ?? null)).join(','))].join('\r\n') + '\r\n';
  if (new TextEncoder().encode(csv).byteLength > 2_000_000) throw new Error('Comparison export exceeds its size limit.');
  return csv;
}
export function ComparisonDownload({ result }: { result: ComparisonResult }) {
  const url = useRef<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); return () => { if (url.current) URL.revokeObjectURL(url.current); url.current = null; }; }, [result]);
  function download() {
    let anchor: HTMLAnchorElement | null = null;
    try {
      if (!navigator.onLine) throw new Error('Offline — reconnect before exporting the displayed comparison.');
      const csv = comparisonCsv(result);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
      url.current = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
      anchor = document.createElement('a'); anchor.href = url.current; anchor.download = 'zindycast-comparison-summary.csv'; document.body.append(anchor); anchor.click(); setError('');
    } catch { if (url.current) URL.revokeObjectURL(url.current); url.current = null; setError('CSV could not be downloaded. Check that you are online and browser downloads are available, then retry.'); }
    finally { anchor?.remove(); }
  }
  return <div><Button className="outline" onClick={download}>Download displayed comparison CSV (SI)</Button><p className="subtle">Exports this completed summary snapshot and chunk provenance, including its original locations and UTC dates even if form inputs change. SI units (°C, m/s, mm, %) are independent of display units. Original hourly values are not included; blank cells mean unavailable or not applicable. No new provider request is made.</p>{error && <p className="notice error" role="alert">{error}</p>}</div>;
}
