import type { Location } from '@zindycast/contracts';
import { ObservationsResponseSchema, type ObservationsResponse, type ObservationField, type StationObservation } from '../../../packages/contracts/src/observations';
import { observedFeelsLike } from './observed-feels-like';

// Product freshness/proximity limits, not a guarantee of neighborhood representativeness.
export const CURRENT_STATION_MAX_AGE_MS = 90 * 60_000;
export const CURRENT_STATION_MAX_DISTANCE_KM = 25;
const ranges: Record<ObservationField, readonly [number, number]> = {
  temperatureC: [-90, 60], dewPointC: [-100, 60], humidityPercent: [0, 100],
  windSpeedMs: [0, 150], windGustMs: [0, 150], windDirectionDeg: [0, 360],
  barometricPressurePa: [30_000, 110_000], visibilityM: [0, 200_000], precipitationLastHourMm: [0, 1000],
};
export function acceptedObservationValue(observation: StationObservation | undefined, key: ObservationField): number | null {
  const measurement = observation?.measurements[key];
  if (!measurement || measurement.value === null || !Number.isFinite(measurement.value)) return null;
  const passed = ['C', 'S', 'V', 'G'].includes(measurement.qualityControl ?? '') ||
    key === 'temperatureC' && measurement.qualityControl === 'T';
  const [min, max] = ranges[key];
  return passed && measurement.value >= min && measurement.value <= max ? measurement.value : null;
}
export function parseObservedResponse(raw: unknown, location: Pick<Location, 'latitude' | 'longitude'>): ObservationsResponse {
  const result = ObservationsResponseSchema.parse(raw);
  if (result.data.query.latitude !== location.latitude || result.data.query.longitude !== location.longitude) {
    throw new Error('Station observations do not match this place.');
  }
  return result;
}
export function selectObservedCurrent(response: ObservationsResponse | null, location: Location | null, now: number) {
  if (!response || !location || response.freshness !== 'fresh' || !Number.isFinite(now)) return null;
  const { data } = response;
  if (data.query.latitude !== location.latitude || data.query.longitude !== location.longitude) return null;
  for (const time of [data.retrievedAt, data.query.until]) {
    const age = now - Date.parse(time);
    if (!Number.isFinite(age) || age < -1000 || age > 10 * 60_000) return null;
  }
  for (const station of data.stations) {
    if (station.distanceKm > CURRENT_STATION_MAX_DISTANCE_KM) continue;
    const observation = station.observations[0];
    if (!observation) continue;
    const age = now - Date.parse(observation.time);
    if (!Number.isFinite(age) || age < 0 || age > CURRENT_STATION_MAX_AGE_MS) continue;
    const temperatureC = acceptedObservationValue(observation, 'temperatureC');
    if (temperatureC === null) continue;
    const humidityPercent = acceptedObservationValue(observation, 'humidityPercent');
    const windSpeedMs = acceptedObservationValue(observation, 'windSpeedMs');
    return { station, observation, temperatureC, humidityPercent, windSpeedMs,
      feelsLike: observedFeelsLike(temperatureC, humidityPercent, windSpeedMs) };
  }
  return null;
}
export type ObservedCurrent = NonNullable<ReturnType<typeof selectObservedCurrent>>;
