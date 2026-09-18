import type { WbgtEstimate } from '@zindycast/contracts';
import { calculateWbgt } from './liljegren';

export const FORECAST_WBGT_POLICY_VERSION = 'liljegren-1.1-zindy-ts-1+fao56-eq47-10m+om-instant-v1';
/** FAO-56 chapter 3 equation 47, short grass, z=10 m.
 * https://www.fao.org/4/X0490E/x0490e07.htm#wind%20speed
 * An explicit reference-exposure assumption, not actual local shelter/stability.
 */
export const FAO56_WIND_10M_TO_2M = 4.87 / Math.log(67.8 * 10 - 5.42);
export const FORECAST_WIND_ASSUMPTION = 'FAO-56 equation 47; short-grass reference; u2=u10*4.87/ln(67.8*10-5.42); no local shelter or stability inference';
export interface ForecastWbgtHour {
  time: string;
  temperatureC: number | null;
  humidityPercent: number | null;
  surfacePressureHpa: number | null;
  windSpeedMs: number | null;
  shortwaveInstantWm2?: number | null;
  /** Retained by the caller; never substituted for missing instantaneous GHI. */
  shortwaveMeanWm2?: number | null;
}
/** Pure adapter for co-timed, unit-validated provider hours. Coordinates must be
 * returned series geometry, not requested-city coordinates. Freshness/current
 * hour selection and provider provenance belong to the enclosing forecast.
 */
export function deriveForecastWbgt(hour: ForecastWbgtHour, coordinates: { latitude: number; longitude: number }, source: string): WbgtEstimate {
  const wind10mMs = typeof hour.windSpeedMs === 'number' && Number.isFinite(hour.windSpeedMs) && hour.windSpeedMs >= 0 ? hour.windSpeedMs : null;
  const wind2mMs = wind10mMs === null ? null : wind10mMs * FAO56_WIND_10M_TO_2M;
  const base = {
    policyVersion: FORECAST_WBGT_POLICY_VERSION as typeof FORECAST_WBGT_POLICY_VERSION,
    exposure: 'modeled_outdoor_short_grass_reference' as const,
    wind10mMs, wind2mMs,
    radiationDerivation: 'provider_instant_derived_from_preceding_hour_mean' as const,
  };
  const missing = (['temperatureC', 'humidityPercent', 'surfacePressureHpa', 'windSpeedMs', 'shortwaveInstantWm2'] as const)
    .filter(key => hour[key] === null || hour[key] === undefined);
  if (missing.length) return { ...base, status: 'unavailable', valueC: null, reason: `missing_input: ${missing.join(', ')}`, diagnostics: null };
  const result = calculateWbgt({
    time: hour.time, latitude: coordinates.latitude, longitude: coordinates.longitude,
    temperatureC: hour.temperatureC!, humidityPercent: hour.humidityPercent!,
    surfacePressureHpa: hour.surfacePressureHpa!, wind2mMs: wind2mMs ?? NaN,
    ghiWm2: hour.shortwaveInstantWm2!, windAssumption: FORECAST_WIND_ASSUMPTION,
    radiationAssumption: 'instantaneous', source,
  });
  if ('reason' in result)
    return { ...base, status: 'unavailable', valueC: null, reason: `${result.status}: ${result.reason}`, diagnostics: null };
  if (result.status === 'component_failure')
    return { ...base, status: 'unavailable', valueC: null, reason: 'component_failure: one or more Liljegren components failed', diagnostics: result.diagnostics };
  return { ...base, status: 'success', valueC: result.wbgtC, reason: null, diagnostics: result.diagnostics };
}
