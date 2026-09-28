import type { AlertsData, Hour, Location } from '@zindycast/contracts';
export type Units = 'imperial' | 'metric';
export function dateKey(time: string | number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function dayKey(now: number, timezone: string, offset: number): string {
  const [year, month, day] = dateKey(now, timezone).split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + offset)).toISOString().slice(0, 10);
}
export function dayHours(hours: Hour[], timezone: string, day: string): Hour[] {
  return hours.filter(hour => dateKey(hour.time, timezone) === day);
}
export function temperature(value: number | null | undefined, units: Units): string {
  return value == null ? '—' : `${Math.round(units === 'imperial' ? value * 9 / 5 + 32 : value)}°${units === 'imperial' ? 'F' : 'C'}`;
}
export function wind(value: number | null | undefined, units: Units): string {
  return value == null ? '—' : `${Math.round(value * (units === 'imperial' ? 2.236936 : 3.6))} ${units === 'imperial' ? 'mph' : 'km/h'}`;
}
export function amount(value: number | null, units: Units): string {
  return value == null ? '—' : `${(units === 'imperial' ? value / 25.4 : value).toFixed(units === 'imperial' ? 2 : 1)} ${units === 'imperial' ? 'in' : 'mm'}`;
}
export function placeLabel(location: Location): string {
  return [location.name, location.admin2, location.admin1, location.country].filter(Boolean).join(', ');
}
export function sameLocation(a: Location, b: Location): boolean {
  return a.latitude === b.latitude && a.longitude === b.longitude && a.timezone === b.timezone;
}
export function activeAlerts(alerts: AlertsData['alerts'], now: number) {
  return alerts.filter(a => a.status === 'Actual' && a.messageType !== 'Cancel' && (!a.effective || Date.parse(a.effective) <= now) && (!a.expires || Date.parse(a.expires) > now) && (!a.ends || Date.parse(a.ends) > now));
}
export function summary(hours: Hour[]) {
  const temps = hours.flatMap(h => h.temperatureC == null ? [] : [h.temperatureC]);
  const chances = hours.flatMap(h => h.precipitationProbability == null ? [] : [h.precipitationProbability]);
  return { high: temps.length ? Math.max(...temps) : null, low: temps.length ? Math.min(...temps) : null, rain: chances.length ? Math.max(...chances) : null };
}
