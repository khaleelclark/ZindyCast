import { ForecastResponseSchema, type Forecast, type Hour, type Location } from '@zindycast/contracts';
import { metricValue, type Units } from './metric-display';

export type { Units } from './metric-display';
export const temperature = (value: number | null | undefined, units: Units) => metricValue('temperatureC', value, units, 'compact', '—').replace(/[FC]$/, '');
export const speed = (value: number | null | undefined, units: Units) => metricValue('windSpeedMs', value, units, 'compact', '—');
export const rain = (value: number | null | undefined, units: Units) => value == null ? '—' : metricValue('precipitationMm', value, units, units === 'us' ? 'compact' : 'detail', '—');
export function timeLabel(time: string, timezone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(new Date(time));
}
export function dayKey(time: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export const placeLabel = (location: Location) => [location.name, location.admin2, location.admin1, location.country].filter(Boolean).join(', ');
export const sameLocation = (a: Location, b: Location) => a.latitude === b.latitude && a.longitude === b.longitude && a.timezone === b.timezone;
export function parseForecast(raw: unknown, requested: Location) {
  const result = ForecastResponseSchema.parse(raw);
  if (result.status === 'error') throw new Error(result.message);
  if (!sameLocation(result.data.location, requested)) throw new Error('The forecast did not match the selected location. Please retry.');
  new Intl.DateTimeFormat('en-US', { timeZone: result.data.location.timezone });
  if (result.data.hours.some((hour, i, hours) => i > 0 && Date.parse(hour.time) <= Date.parse(hours[i - 1]!.time))) throw new Error('The forecast timeline is invalid. Please retry.');
  return result;
}
export function currentHour(hours: Hour[], now: number) {
  return hours.find(hour => Date.parse(hour.time) <= now && now - Date.parse(hour.time) < 3_600_000);
}
export function dailyGroups(forecast: Forecast, now: number, horizon: number) {
  const today = dayKey(new Date(now).toISOString(), forecast.location.timezone);
  const groups = new Map<string, Hour[]>();
  for (const hour of forecast.hours) {
    const key = dayKey(hour.time, forecast.location.timezone);
    if (key >= today) groups.set(key, [...(groups.get(key) ?? []), hour]);
  }
  return [...groups.entries()].slice(0, horizon).map(([key, hours]) => {
    const temperatures = hours.flatMap(hour => hour.temperatureC == null ? [] : [hour.temperatureC]);
    // The contract defines precipitation over [endpoint - 1h, endpoint).
    // Only whole intervals within this local date qualify; do not prorate crossing intervals.
    const rainHours = forecast.hours.filter(hour => {
      const end = Date.parse(hour.time);
      return dayKey(new Date(end - 3_600_000).toISOString(), forecast.location.timezone) === key
        && dayKey(new Date(end - 1).toISOString(), forecast.location.timezone) === key;
    });
    const rainTotal = rainHours.length && rainHours.every(hour => hour.precipitationMm !== null)
      ? rainHours.reduce((total, hour) => total + hour.precipitationMm!, 0) : null;
    return { key, hours, rainHours, rainTotal, low: temperatures.length ? Math.min(...temperatures) : null, high: temperatures.length ? Math.max(...temperatures) : null };
  });
}
export function conditions(code: number | null | undefined) {
  if (code == null) return 'Conditions unavailable';
  if (code === 0) return 'Clear sky';
  if (code <= 3) return ['Clear sky', 'Mainly clear', 'Partly cloudy', 'Overcast'][code];
  if (code <= 48) return 'Fog';
  if (code <= 67) return 'Rain or drizzle';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

export function weatherSymbol(code: number | null | undefined, isDay?: 0 | 1 | null) {
  if (code == null) return '—';
  if (code <= 1) return isDay === 1 ? '☀' : isDay === 0 ? '☾' : '◇';
  if (code <= 3) return '☁';
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return '❄';
  return '☂';
}
export function hourlySummary(hours: Hour[], rainHours = hours) {
  const temps = hours.flatMap(h => h.temperatureC == null ? [] : [h.temperatureC]);
  const probabilities = rainHours.flatMap(h => h.precipitationProbability == null ? [] : [h.precipitationProbability]);
  const codes = [...new Set(hours.flatMap(h => h.weatherCode == null ? [] : [conditions(h.weatherCode)]))];
  return { low: temps.length ? Math.min(...temps) : null, high: temps.length ? Math.max(...temps) : null,
    condition: codes.length === 0 ? 'Conditions unavailable' : codes.length === 1 ? codes[0]! : 'Mixed conditions',
    rainChance: probabilities.length ? Math.max(...probabilities) : null, rainCount: probabilities.length, rainExpected: rainHours.length };
}
export function forecastPeriods(forecast: Forecast, now: number) {
  const zone = forecast.location.timezone, today = dayKey(new Date(now).toISOString(), zone);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const localHour = (time: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(time)));
  const specs = [
    { label: 'Today', contains: (time: string) => dayKey(time, zone) === today && localHour(time) >= 6 && localHour(time) < 18 },
    { label: 'Tonight', contains: (time: string) => dayKey(time, zone) === today && localHour(time) >= 18 || dayKey(time, zone) === tomorrow && localHour(time) < 6 },
    { label: 'Tomorrow', contains: (time: string) => dayKey(time, zone) === tomorrow && localHour(time) >= 6 && localHour(time) < 18 },
  ];
  const start = Math.floor(now / 3600000) * 3600000;
  return specs.map(({ label, contains }) => {
    const hours = forecast.hours.filter(h => Date.parse(h.time) >= start && contains(h.time));
    const intervals = forecast.hours.filter(h => { const end = Date.parse(h.time); return end - 3600000 >= start && contains(new Date(end - 3600000).toISOString()) && contains(new Date(end - 1).toISOString()); });
    return { label, hours, ...hourlySummary(hours, intervals) };
  }).filter(p => p.hours.length || p.label !== 'Today');
}
export function astronomyForDate(forecast: Forecast, date: string) {
  // Provider row labels are UTC dates; each event belongs to its own local date.
  const event = (field: 'sunrise' | 'sunset') => {
    const values = [...new Set((forecast.astronomy ?? []).flatMap(row => {
      const time = row[field];
      return time && Number.isFinite(Date.parse(time)) && dayKey(time, forecast.location.timezone) === date ? [time] : [];
    }))];
    return values.length === 1 ? values[0]! : null;
  };
  return {date, sunrise: event('sunrise'), sunset: event('sunset'), reason: 'No validated sunrise/sunset supplied for this local date.'};
}

/** Consumer daily summary; maxima are hourly values, never whole-day probabilities. */
export function dailySummary(hours: Hour[], rainHours: Hour[], zone: string) {
  const summary = hourlySummary(hours, rainHours);
  const counts = new Map<string, number>();
  for (const h of hours) if (h.weatherCode != null) {
    const label = conditions(h.weatherCode)!;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Conditions unavailable';
  const precip = ['Thunderstorms', 'Snow showers', 'Snow', 'Rain showers', 'Rain or drizzle'].find(label => counts.has(label));
  const condition = precip ? `${precip}${counts.get(precip) === hours.length ? '' : ' at times'}` : dominant;
  const winds = hours.flatMap(h => h.windSpeedMs == null ? [] : [h.windSpeedMs]);
  const localHour = (h: Hour) => Number(timeLabel(h.time, zone, {hour: 'numeric', hourCycle: 'h23'}));
  const partial = !hours.length || localHour(hours[0]!) !== 0 || localHour(hours.at(-1)!) !== 23
    || hours.some((h, i) => h.temperatureC == null || h.weatherCode == null || h.windSpeedMs == null || i > 0 && Date.parse(h.time) - Date.parse(hours[i - 1]!.time) !== 3600000)
    || rainHours.some(h => h.precipitationProbability == null) || rainHours.length !== hours.length;
  return {...summary, condition, weatherCode: hours.find(h => h.weatherCode != null && conditions(h.weatherCode) === (precip ?? dominant))?.weatherCode ?? null, partial, windMax: winds.length ? Math.max(...winds) : null};
}

export type PlanningDay = ReturnType<typeof dailySummary> & { key: string; label: 'Today' | 'Tomorrow'; rainPeriod: string | null };
/** Plain-language daily facts only: no inferred rain start time or safety advice. */
export function dailyPlanningSummary(forecast: Forecast, now: number): PlanningDay[] {
  const days = dailyGroups(forecast, now, 2);
  const start = Math.floor(now / 3_600_000) * 3_600_000;
  const daypart = (hour: Hour, tomorrow: boolean) => {
    const local = Number(timeLabel(hour.time, forecast.location.timezone, { hour: 'numeric', hourCycle: 'h23' }));
    const prefix = tomorrow ? 'tomorrow ' : 'this ';
    return local < 6 ? (tomorrow ? 'early tomorrow' : 'overnight') : local < 12 ? `${prefix}morning` : local < 18 ? `${prefix}afternoon` : `${prefix}evening`;
  };
  return days.map((day, index) => {
    const summary = dailySummary(day.hours, day.rainHours, forecast.location.timezone);
    const futureRain = day.rainHours.filter(hour => Date.parse(hour.time) >= start && hour.precipitationProbability != null);
    const max = futureRain.reduce<Hour | null>((chosen, hour) => !chosen || hour.precipitationProbability! > chosen.precipitationProbability! ? hour : chosen, null);
    return { ...summary, key: day.key, label: index === 0 ? 'Today' : 'Tomorrow', rainPeriod: max?.precipitationProbability ? daypart(max, index === 1) : null };
  });
}
