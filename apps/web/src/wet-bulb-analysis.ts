import type { WetBulbTrackerRecord } from '@zindycast/contracts';

const average = (values: (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
};

const localParts = (time: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
};

export const WALK_WINDOWS = [
  'Midnight–4 AM', '4–8 AM', '8 AM–noon', 'Noon–4 PM', '4–8 PM', '8 PM–midnight',
] as const;

export function analyzeWetBulb(records: WetBulbTrackerRecord[], timezone: string) {
  // A half-hour capture can repeat an hourly source value. Use its newest version once.
  const unique = [...new Map([...records].sort((a, b) =>
    Date.parse(a.recordedAt) - Date.parse(b.recordedAt)).map(record => [record.sourceValidTime, record])).values()]
    .filter(record => record.wbgtC !== null);
  const withLocal = unique.map(record => ({ record, ...localParts(record.sourceValidTime, timezone) }));
  const values = withLocal.map(({ record }) => record.wbgtC!);
  const dates = new Set(withLocal.map(item => item.date));
  const sorted = [...values].sort((a, b) => a - b);
  const p90 = sorted.length ? sorted[Math.ceil(sorted.length * .9) - 1] : null;
  const windows = WALK_WINDOWS.map((label, index) => {
    const rows = withLocal.filter(item => Math.floor(item.hour / 4) === index);
    return {
      label, hours: rows.length, days: new Set(rows.map(item => item.date)).size,
      wbgtC: average(rows.map(item => item.record.wbgtC)),
      temperatureC: average(rows.map(item => item.record.temperatureC)),
      humidityPercent: average(rows.map(item => item.record.humidityPercent)),
      windSpeedMs: average(rows.map(item => item.record.windSpeedMs)),
      precipitationProbability: average(rows.map(item => item.record.precipitationProbability)),
      daylightPercent: rows.length ? rows.filter(item => item.record.isDay === 1).length / rows.length * 100 : null,
    };
  });
  // Three separate dates provide a minimal basis for a recurring time-of-day comparison.
  const daylight = windows.filter(window => window.days >= 3 && (window.daylightPercent ?? 0) >= 50 && window.wbgtC !== null);
  const lowestDaylight = daylight.sort((a, b) => a.wbgtC! - b.wbgtC!)[0] ?? null;
  const day = withLocal.filter(item => item.record.isDay === 1);
  const night = withLocal.filter(item => item.record.isDay === 0);
  return {
    sourceHours: unique.length, days: dates.size, p90C: p90,
    averageC: average(values),
    temperatureC: average(withLocal.map(item => item.record.temperatureC)),
    humidityPercent: average(withLocal.map(item => item.record.humidityPercent)),
    windSpeedMs: average(withLocal.map(item => item.record.windSpeedMs)),
    precipitationProbability: average(withLocal.map(item => item.record.precipitationProbability)),
    dayAverageC: average(day.map(item => item.record.wbgtC)),
    nightAverageC: average(night.map(item => item.record.wbgtC)),
    windows, lowestDaylight,
  };
}
