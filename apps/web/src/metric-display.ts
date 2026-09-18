/**
 * Shared presentation definitions. Source statistics and interval semantics stay
 * with each feature; this module only makes conversion, precision and labels
 * consistent across Today, History and Compare.
 */
export type Units = 'us' | 'metric';
export type WeatherMetric = 'temperatureC' | 'apparentTemperatureC' | 'dewPointC' | 'wetBulbTemperatureC' | 'humidityPercent' | 'precipitationProbabilityPercent' | 'windSpeedMs' | 'precipitationMm' | 'sunshineDurationSeconds' | 'cloudCoverPercent';
export type MetricPrecision = 'compact' | 'detail' | 'export';
export type MetricStatistic = 'instant' | 'mean' | 'minimum' | 'maximum' | 'total';
type MetricDefinition = {
  label: string;
  compactDigits: number;
  detailDigits: number;
  exportDigits: number;
  unit: (units: Units) => string;
  convert: (value: number, units: Units) => number;
};
const same = (value: number) => value;
export const metricDefinitions: Record<WeatherMetric, MetricDefinition> = {
  temperatureC: { label: 'Air temperature', compactDigits: 0, detailDigits: 1, exportDigits: 3, unit: units => `°${units === 'us' ? 'F' : 'C'}`, convert: (value, units) => units === 'us' ? value * 9 / 5 + 32 : value },
  apparentTemperatureC: { label: 'Feels-like temperature', compactDigits: 0, detailDigits: 1, exportDigits: 3, unit: units => `°${units === 'us' ? 'F' : 'C'}`, convert: (value, units) => units === 'us' ? value * 9 / 5 + 32 : value },
  dewPointC: { label: 'Dew point', compactDigits: 0, detailDigits: 1, exportDigits: 3, unit: units => `°${units === 'us' ? 'F' : 'C'}`, convert: (value, units) => units === 'us' ? value * 9 / 5 + 32 : value },
  wetBulbTemperatureC: { label: 'Ordinary wet bulb', compactDigits: 0, detailDigits: 1, exportDigits: 3, unit: units => `°${units === 'us' ? 'F' : 'C'}`, convert: (value, units) => units === 'us' ? value * 9 / 5 + 32 : value },
  humidityPercent: { label: 'Relative humidity', compactDigits: 0, detailDigits: 1, exportDigits: 3, unit: () => '%', convert: same },
  precipitationProbabilityPercent: { label: 'Rain chance', compactDigits: 0, detailDigits: 0, exportDigits: 3, unit: () => '%', convert: same },
  windSpeedMs: { label: 'Wind at 10 m', compactDigits: 0, detailDigits: 1, exportDigits: 4, unit: units => units === 'us' ? 'mph' : 'km/h', convert: (value, units) => value * (units === 'us' ? 3600 / 1609.344 : 3.6) },
  precipitationMm: { label: 'Precipitation', compactDigits: 2, detailDigits: 2, exportDigits: 4, unit: units => units === 'us' ? 'in' : 'mm', convert: (value, units) => value / (units === 'us' ? 25.4 : 1) },
  sunshineDurationSeconds: { label: 'Sunshine duration', compactDigits: 1, detailDigits: 1, exportDigits: 3, unit: () => 'h', convert: value => value / 3600 },
  cloudCoverPercent: { label: 'Cloud cover', compactDigits: 0, detailDigits: 1, exportDigits: 3, unit: () => '%', convert: same },
};
export const hasDailyTemperatureRange = (field: WeatherMetric) => field === 'temperatureC' || field === 'dewPointC' || field === 'wetBulbTemperatureC';
export const cityColors = ['#246c9c', '#a14d23', '#6e54a0', '#24786c', '#986817'];
export function metricUnit(field: WeatherMetric, units: Units) {
  return metricDefinitions[field].unit(units);
}
export function metricNumber(field: WeatherMetric, value: number | null | undefined, units: Units): number | null {
  return value == null || !Number.isFinite(value) ? null : metricDefinitions[field].convert(value, units);
}
export function metricValue(field: WeatherMetric, value: number | null | undefined, units: Units, precision: MetricPrecision = 'detail', missing = 'Unavailable') {
  const converted = metricNumber(field, value, units);
  if (converted === null) return missing;
  const definition = metricDefinitions[field];
  const digits = field === 'precipitationMm' && precision !== 'export' ? (units === 'us' ? 2 : 1) : precision === 'compact' ? definition.compactDigits : precision === 'export' ? definition.exportDigits : definition.detailDigits;
  const spacer = field.endsWith('C') ? '' : ' ';
  return `${converted.toFixed(digits)}${spacer}${definition.unit(units)}`;
}
export function metricLabel(field: WeatherMetric) { return metricDefinitions[field].label; }
export function metricStatisticLabel(field: WeatherMetric, statistic: MetricStatistic, window: 'hour' | 'available-hours' | 'day' | 'period' = 'available-hours') {
  if (field === 'precipitationProbabilityPercent' && statistic === 'maximum') return window === 'day' ? 'Highest hourly rain chance' : 'Highest rain chance in an hour';
  if (field === 'precipitationMm' && statistic === 'maximum' && window === 'hour') return 'Highest preceding-hour precipitation';
  const statisticLabel = statistic === 'instant' ? '' : statistic === 'mean' ? 'Average' : statistic === 'minimum' ? 'Lowest' : statistic === 'maximum' ? 'Highest' : 'Total';
  const windowLabel = window === 'hour' ? 'this hour' : window === 'available-hours' ? 'available hours' : window === 'day' ? 'day' : 'period';
  return `${statisticLabel ? `${statisticLabel} ` : ''}${metricDefinitions[field].label.toLowerCase()}${statistic === 'instant' ? ` ${windowLabel}` : ` over ${windowLabel}`}`;
}
