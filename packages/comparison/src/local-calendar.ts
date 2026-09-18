const DAY = 86_400_000;
const HOUR = 3_600_000;
// Bounded formatter reuse, independent of the host timezone and locale.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== 'string' || !timezone.trim()) throw new RangeError('Invalid timezone');
  const cached = formatters.get(timezone);
  if (cached) return cached;
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn',
    era: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
  formatters.set(timezone, value);
  return value;
}

function fields(timeMs: number, fmt: Intl.DateTimeFormat) {
  const values: Record<string, number> = {};
  let beforeCommonEra = false;
  for (const part of fmt.formatToParts(timeMs)) {
    if (part.type === 'era') beforeCommonEra = part.value === 'BC';
    else if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  if (beforeCommonEra) values.year = 1 - values.year;
  return values;
}

function instant(timeMs: number): void {
  if (!Number.isSafeInteger(timeMs) || Math.abs(timeMs) > 8_640_000_000_000_000) {
    throw new RangeError('Expected a valid integer epoch-millisecond instant');
  }
}

/** Gregorian local date, using the runtime's IANA timezone database. */
export function localDate(timeMs: number, timezone: string): string {
  instant(timeMs);
  const p = fields(timeMs, formatter(timezone));
  if (p.year < 1 || p.year > 9999) {
    throw new RangeError('Local date must have a year from 0001 through 9999');
  }
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseDate(date: string): number {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('Expected a Gregorian YYYY-MM-DD date');
  }
  const year = Number(date.slice(0, 4));
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (year < 1940 || !Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) {
    throw new RangeError('Expected a valid Gregorian date in years 1940 through 9999');
  }
  return value;
}

function dateKey(timeMs: number, fmt: Intl.DateTimeFormat): number {
  const p = fields(timeMs, fmt);
  return Date.UTC(p.year, p.month - 1, p.day);
}

function boundary(target: number, fmt: Intl.DateTimeFormat): number {
  // Resolve actual midnight using offsets on both sides of nearby transitions.
  // The bounded four-day window covers IANA offsets and date-line jumps since 1940.
  // Checking candidates also selects the FIRST occurrence of repeated midnight.
  const offsets = new Set<number>();
  for (let sample = target - 2 * DAY; sample <= target + 2 * DAY; sample += 6 * HOUR) {
    const p = fields(sample, fmt);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - sample);
  }
  let first = Infinity;
  for (const offset of offsets) {
    const candidate = target - offset;
    const p = fields(candidate, fmt);
    if (Date.UTC(p.year, p.month - 1, p.day) === target && p.hour === 0 && p.minute === 0 && p.second === 0) {
      first = Math.min(first, candidate);
    }
  }
  if (Number.isFinite(first)) return first;
  // Midnight is missing: locate the first represented instant on/after this
  // calendar date, to millisecond precision (at most 29 bisections).
  let low = target - 2 * DAY;
  let high = target + 2 * DAY;
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (dateKey(middle, fmt) < target) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * Half-open local calendar day [start, end), in epoch milliseconds.
 * A missing midnight uses the first represented instant of that day; repeated
 * midnight uses its first occurrence. Entirely skipped dates throw RangeError.
 * The day before a skipped date ends at the start of the next represented date.
 */
export function localDayBounds(date: string, timezone: string): { start: number; end: number } {
  const target = parseDate(date);
  const fmt = formatter(timezone);
  const start = boundary(target, fmt);
  if (dateKey(start, fmt) !== target) throw new RangeError(`Skipped local date ${date} in ${timezone}`);
  const end = boundary(target + DAY, fmt);
  if (end <= start) throw new RangeError(`Invalid local day ${date} in ${timezone}`);
  return { start, end };
}

/**
 * Inclusive UTC source-date envelope, including the closing endpoint itself.
 * This retains midnight-ending preceding-hour rainfall/sunshine records. It is
 * an envelope, not an aggregation rule; callers may add padding for their cadence.
 */
export function coveringUtcDates(start: number, end: number): { startDate: string; endDate: string } {
  instant(start);
  instant(end);
  if (end < start) throw new RangeError('UTC range end must not precede start');
  return { startDate: localDate(start, 'UTC'), endDate: localDate(end, 'UTC') };
}
