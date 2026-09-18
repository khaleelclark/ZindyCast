export type ObservedFeelsLike = {
  valueC: number | null;
  method: 'heat-index' | 'wind-chill' | 'air-temperature' | 'unavailable';
};

const unavailable = (): ObservedFeelsLike => ({ valueC: null, method: 'unavailable' });
const fromF = (value: number): number => (value - 32) * 5 / 9;
const screenedHeatIndexF = (t: number, rh: number): number =>
  (0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094) + t) / 2;

/** Derived from co-timed, quality-eligible station observations only.
 * Caller owns provenance, freshness and QC; never fill gaps with modeled inputs.
 * NWS equations and application selection limits: docs/research/observed-feels-like.md.
 */
export function observedFeelsLike(
  temperatureC: number | null,
  humidityPercent: number | null,
  windSpeedMs: number | null,
): ObservedFeelsLike {
  // Defensive weather-input bounds, not scientific validity or safety thresholds.
  if (temperatureC === null || !Number.isFinite(temperatureC) || temperatureC < -100 || temperatureC > 60 ||
      (humidityPercent !== null && (!Number.isFinite(humidityPercent) || humidityPercent < 0 || humidityPercent > 100)) ||
      (windSpeedMs !== null && (!Number.isFinite(windSpeedMs) || windSpeedMs < 0 || windSpeedMs > 150))) {
    return unavailable();
  }
  const t = temperatureC * 9 / 5 + 32;
  if (t <= 50) {
    if (windSpeedMs === null) return unavailable();
    // Exact international-mile conversion; NWS domain excludes exactly 3 mph.
    if (windSpeedMs <= 3 * 0.44704) return { valueC: temperatureC, method: 'air-temperature' };
    const v = (windSpeedMs / 0.44704) ** 0.16;
    return { valueC: fromF(35.74 + 0.6215 * t - 35.75 * v + 0.4275 * t * v), method: 'wind-chill' };
  }
  if (humidityPercent === null) {
    // Missing RH cannot establish whether the full equation would apply.
    return t >= 80 || screenedHeatIndexF(t, 100) >= 80
      ? unavailable() : { valueC: temperatureC, method: 'air-temperature' };
  }
  const rh = humidityPercent;
  let hi = screenedHeatIndexF(t, rh);
  if (t < 80 && hi < 80) return { valueC: temperatureC, method: 'air-temperature' };
  if (hi >= 80) {
    hi = -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh
      - 0.00683783 * t * t - 0.05481717 * rh * rh + 0.00122874 * t * t * rh
      + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh;
    if (rh < 13 && t >= 80 && t <= 112) {
      hi -= (13 - rh) / 4 * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (rh > 85 && t >= 80 && t <= 87) {
      hi += (rh - 85) / 10 * (87 - t) / 5;
    }
  }
  return Number.isFinite(hi) ? { valueC: fromF(hi), method: 'heat-index' } : unavailable();
}
