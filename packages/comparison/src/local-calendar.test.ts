import test from 'node:test';
import assert from 'node:assert/strict';
import { localDate, localDayBounds, coveringUtcDates } from './local-calendar.js';

const ms = (value: string) => Date.parse(value);
const HOUR = 3_600_000;
function bounds(date: string, zone: string, start: string, end: string) {
  const result = localDayBounds(date, zone);
  assert.deepEqual(result, { start: ms(start), end: ms(end) });
  assert.equal(localDate(result.start, zone), date);
  assert.equal(localDate(result.end - 1, zone), date);
  assert.notEqual(localDate(result.start - 1, zone), date);
  assert.notEqual(localDate(result.end, zone), date);
  return result;
}

test('New York spring/fall days have exact 23/25-hour boundaries and repeated-hour dates', () => {
  const spring = bounds('2020-03-08', 'America/New_York', '2020-03-08T05:00Z', '2020-03-09T04:00Z');
  const fall = bounds('2020-11-01', 'America/New_York', '2020-11-01T04:00Z', '2020-11-02T05:00Z');
  assert.equal((spring.end - spring.start) / HOUR, 23);
  assert.equal((fall.end - fall.start) / HOUR, 25);
  for (const time of ['2020-11-01T05:30Z', '2020-11-01T06:30Z']) {
    assert.equal(localDate(ms(time), 'America/New_York'), '2020-11-01');
  }
});

test('UTC rollover in Honolulu, Tokyo and Kiritimati does not use host timezone', () => {
  bounds('2020-01-01', 'Pacific/Honolulu', '2020-01-01T10:00Z', '2020-01-02T10:00Z');
  bounds('2020-01-01', 'Asia/Tokyo', '2019-12-31T15:00Z', '2020-01-01T15:00Z');
  bounds('2020-01-01', 'Pacific/Kiritimati', '2019-12-31T10:00Z', '2020-01-01T10:00Z');
  assert.equal(localDate(ms('2020-01-01T00:00Z'), 'Pacific/Honolulu'), '2019-12-31');
  assert.equal(localDate(ms('2020-01-01T23:00Z'), 'Asia/Tokyo'), '2020-01-02');
});

test('fractional offsets retain exact minute boundaries and historical changes', () => {
  bounds('2020-06-01', 'Asia/Kathmandu', '2020-05-31T18:15Z', '2020-06-01T18:15Z');
  bounds('2020-06-01', 'Asia/Kolkata', '2020-05-31T18:30Z', '2020-06-01T18:30Z');
  bounds('1985-12-31', 'Asia/Kathmandu', '1985-12-30T18:30Z', '1985-12-31T18:30Z');
  const changed = bounds('1986-01-01', 'Asia/Kathmandu', '1985-12-31T18:30Z', '1986-01-01T18:15Z');
  assert.equal(changed.end - changed.start, 23.75 * HOUR);
  const halfDst = bounds('2020-10-04', 'Australia/Lord_Howe', '2020-10-03T13:30Z', '2020-10-04T13:00Z');
  assert.equal(halfDst.end - halfDst.start, 23.5 * HOUR);
});

test('missing and repeated midnight use the first actual instant of the day', () => {
  bounds('2018-11-04', 'America/Sao_Paulo', '2018-11-04T03:00Z', '2018-11-05T02:00Z');
  const repeated = bounds('2020-11-01', 'America/Havana', '2020-11-01T04:00Z', '2020-11-02T05:00Z');
  assert.equal(repeated.end - repeated.start, 25 * HOUR);
});

test('Samoa skipped date rejects explicitly; adjacent days remain contiguous', () => {
  assert.throws(() => localDayBounds('2011-12-30', 'Pacific/Apia'), /Skipped local date 2011-12-30/);
  const before = bounds('2011-12-29', 'Pacific/Apia', '2011-12-29T10:00Z', '2011-12-30T10:00Z');
  const after = bounds('2011-12-31', 'Pacific/Apia', '2011-12-30T10:00Z', '2011-12-31T10:00Z');
  assert.equal(before.end, after.start);
});

test('strict Gregorian validation, leap/month/year boundaries and supported year limits', () => {
  for (const date of ['2020-02-29', '2000-02-29', '2020-04-30', '2020-12-31', '1940-01-01', '9999-12-31']) {
    const start = ms(`${date}T00:00Z`);
    assert.deepEqual(localDayBounds(date, 'UTC'), { start, end: start + 24 * HOUR });
  }
  for (const date of ['1939-12-31', '2021-02-29', '2100-02-29', '2020-04-31', '2020-00-01', '2020-13-01',
    '2020-01-00', '2020-1-01', '2020-01-01T00:00Z', ' 2020-01-01', '10000-01-01', 'no']) {
    assert.throws(() => localDayBounds(date, 'UTC'), RangeError, date);
  }
});

test('invalid timezone and invalid instants fail explicitly', () => {
  for (const zone of ['', ' ', 'Not/A_Zone']) {
    assert.throws(() => localDate(0, zone), RangeError);
    assert.throws(() => localDayBounds('2020-01-01', zone), RangeError);
  }
  for (const time of [NaN, Infinity, -Infinity, 0.5, 8_640_000_000_000_001]) {
    assert.throws(() => localDate(time, 'UTC'), RangeError);
    assert.throws(() => coveringUtcDates(time, 0), RangeError);
    assert.throws(() => coveringUtcDates(0, time), RangeError);
  }
  assert.equal(localDate(-1, 'UTC'), '1969-12-31');
  assert.equal(localDate(ms('0001-01-01T00:00Z'), 'UTC'), '0001-01-01');
  assert.throws(() => localDate(ms('0000-01-01T00:00Z'), 'UTC'), RangeError);
});

test('UTC envelope includes closing midnight for preceding-hour records, with no implicit padding', () => {
  assert.deepEqual(coveringUtcDates(ms('2020-02-29T00:00Z'), ms('2020-03-01T00:00Z')),
    { startDate: '2020-02-29', endDate: '2020-03-01' });
  const nepal = localDayBounds('2020-01-01', 'Asia/Kathmandu');
  assert.deepEqual(coveringUtcDates(nepal.start, nepal.end), { startDate: '2019-12-31', endDate: '2020-01-01' });
  assert.deepEqual(coveringUtcDates(0, 0), { startDate: '1970-01-01', endDate: '1970-01-01' });
  assert.throws(() => coveringUtcDates(1, 0), /must not precede/);
});
