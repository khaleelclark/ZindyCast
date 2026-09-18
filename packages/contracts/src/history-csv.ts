import { z } from 'zod';
import { ReanalysisDataSchema, type ReanalysisData } from './history';

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return '';
  if (typeof value !== 'string') return String(value);
  // Quoting alone does not prevent formulas. Preserve numeric negatives as numbers.
  const safe = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Deterministic RFC4180 CSV for exactly this UTC selection. Null numeric cells are empty.
 * Optional display label is bounded and spreadsheet-escaped; numeric SI values are unchanged.
 */
export function renderReanalysisCsv(data: ReanalysisData, locationName = ''): string {
  const parsed = ReanalysisDataSchema.safeParse(data);
  if (!parsed.success || !z.string().max(200).safeParse(locationName).success) {
    throw new Error('Valid bounded reanalysis data and a label of at most 200 characters are required.');
  }
  const d = parsed.data; const p = d.provenance;
  const headers = ['location_name', 'requested_latitude', 'requested_longitude', 'start_date_utc', 'end_date_utc',
    'time_utc', 'temperature_C', 'relative_humidity_percent', 'precipitation_mm', 'wind_speed_m_s', 'dew_point_C',
    'precipitation_interval_start_utc', 'precipitation_interval_end_utc', 'source_hour_present', 'missing_fields',
    'completeness_status', 'expected_hours', 'source_hours', 'complete_hours',
    'provider', 'dataset', 'requested_model', 'constituent', 'classification', 'source_latitude', 'source_longitude', 'source_elevation_m',
    'retrieved_at_utc', 'source_issued_at_utc', 'source_updated_at_utc', 'cell_selection', 'downscaling', 'interval_semantics',
    'calculation_version', 'attribution', 'source_url', 'request_url'];
  const rows = d.hours.map(h => [locationName, d.query.latitude, d.query.longitude, d.query.startDate, d.query.endDate,
    h.time, h.temperatureC, h.humidityPercent, h.precipitationMm, h.windSpeedMs, h.dewPointC,
    new Date(Date.parse(h.time) - 3600000).toISOString(), h.time, h.sourceHourPresent, h.missingFields.join(';'),
    d.completeness.status, d.completeness.expectedHours, d.completeness.sourceHours, d.completeness.completeHours,
    p.provider, p.dataset, p.requestedModel, p.constituent, p.classification, p.sourceCoordinates.latitude, p.sourceCoordinates.longitude,
    p.sourceElevationM, p.retrievedAt, p.sourceIssuedAt, p.sourceUpdatedAt, p.cellSelection, p.downscaling, d.intervalSemantics,
    p.calculationVersion, p.attribution, p.sourceUrl, p.requestUrl]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
