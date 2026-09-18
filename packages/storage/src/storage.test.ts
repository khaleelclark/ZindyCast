import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { SharedStorage, type StorageOptions, type JsonValue } from './index.js';

const DAY = 86_400_000;
function fixture(t: test.TestContext, overrides: Partial<StorageOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zindycast-storage-'));
  let now = Date.UTC(2026, 0, 31, 23, 59, 59);
  const options = { path: join(dir, 'shared.sqlite'), clock: () => now, ...overrides };
  const connections: SharedStorage[] = [];
  const open = () => { const db = new SharedStorage(options); connections.push(db); return db; };
  t.after(() => { for (const db of connections) { try { db.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); });
  return { options, open, advance: (ms: number) => { now += ms; }, time: () => now };
}
test('cache shares JSON, preserves metadata and exact expiry/stale boundaries through restart', t => {
  const f = fixture(t); const a = f.open(), b = f.open();
  const times = { retrievedAt: f.time(), expiresAt: f.time() + 100, staleUntil: f.time() + 200 };
  const value = { source: 'fixture', hours: [1, null, 'é'] };
  assert.equal(a.set('forecast', value, times), true);
  assert.deepEqual(b.get('forecast'), { value, ...times, freshness: 'fresh' });
  f.advance(100); assert.equal(b.get('forecast')!.freshness, 'stale');
  a.close(); const reopened = f.open(); assert.deepEqual(reopened.get('forecast')!.value, value);
  f.advance(100); assert.equal(reopened.get('forecast'), null);
  assert.equal(reopened.cleanup().deleted.cache, 1);
});
test('entry and total UTF-8 byte/count bounds, replacement accounting, older write protection', t => {
  const f = fixture(t, { maxEntries: 2, maxBytes: 16, maxEntryBytes: 12 }); const a = f.open(), b = f.open();
  const times = () => ({ retrievedAt: f.time(), expiresAt: f.time() + 100, staleUntil: f.time() + 200 });
  a.set('a', 'éé', times()); // 7 UTF-8 bytes including key and JSON quotes
  f.advance(1); a.set('b', 'bb', times());
  f.advance(1); a.set('c', 'cc', times());
  assert.equal(b.get('a'), null); assert.deepEqual(b.cacheUsage(), { entries: 2, bytes: 10 });
  a.set('c', 'ccc', times()); assert.equal(b.cacheUsage().bytes, 11);
  assert.equal(a.set('c', 'old', { ...times(), retrievedAt: f.time() - 1 }), false);
  assert.throws(() => a.set('huge', 'xxxxxxxxxxx', times()), /byte budget/);
  assert.equal(b.get('c')!.value, 'ccc');
  a.set('d', 'ddddddd', times()); assert.ok(b.cacheUsage().bytes <= 16);
});
test('rejects malformed JSON, timestamps and configuration mismatch without corrupting records', t => {
  const f = fixture(t); const a = f.open();
  const times = { retrievedAt: f.time(), expiresAt: f.time() + 10, staleUntil: f.time() + 20 };
  for (const value of [NaN, Infinity, undefined, new Date(), { x: undefined }]) assert.throws(() => a.set('x', value as JsonValue, times));
  assert.throws(() => a.set('x', {}, { ...times, retrievedAt: f.time() + 1 }), /future/);
  assert.throws(() => a.set('x', {}, { ...times, expiresAt: times.staleUntil + 1 }), /deadlines/);
  assert.throws(() => new SharedStorage({ ...f.options, maxEntries: 2 }), /configuration mismatch/);
  a.set('x', null, times); assert.equal(a.get('x')!.value, null);
});
test('two connections compete for lease; token fences late release and cache publication after takeover', t => {
  const f = fixture(t); const a = f.open(), b = f.open();
  const old = a.acquireLease('refresh', 'api', 100)!;
  assert.ok(old); assert.equal(b.acquireLease('refresh', 'worker', 100), null);
  assert.equal(a.acquireLease('refresh', 'api', 100), null);
  f.advance(100); const current = b.acquireLease('refresh', 'worker', 100)!;
  assert.notEqual(current.token, old.token); assert.equal(a.releaseLease(old), false);
  const times = { retrievedAt: f.time(), expiresAt: f.time() + 10, staleUntil: f.time() + 20 };
  assert.equal(a.set('refresh', 'late', times, old), false);
  assert.equal(b.set('refresh', 'winner', times, current), true);
  assert.equal(a.get('refresh')!.value, 'winner');
  assert.equal(b.releaseLease({ ...current, owner: 'wrong' }), false);
  assert.equal(b.releaseLease(current), true);
});
test('lease capacity and restart expiry do not require successful original-owner release', t => {
  const f = fixture(t, { maxLeases: 1 }); const a = f.open();
  assert.ok(a.acquireLease('one', 'api', 100)); assert.equal(a.acquireLease('two', 'api', 100), null);
  a.close(); const b = f.open(); assert.equal(b.acquireLease('one', 'worker', 100), null);
  f.advance(100); assert.ok(b.acquireLease('two', 'worker', 100));
});
test('weighted quota denial rolls back all four windows across independent connections and restart', t => {
  const f = fixture(t, { providers: { sample: { minute: 2, hour: 3, day: 4, month: 5 } } });
  const a = f.open(), b = f.open();
  assert.deepEqual(a.reserveQuota('sample', 1.2501), { allowed: true, chargedWeight: 1.251 });
  assert.equal(b.reserveQuota('sample', 0.749).allowed, true);
  const denied = a.reserveQuota('sample', 1);
  assert.equal(denied.allowed, false); if (!denied.allowed) assert.deepEqual(denied.windows, ['minute']);
  f.advance(60_000); assert.equal(b.reserveQuota('sample', 1).allowed, true);
  const hourly = a.reserveQuota('sample', 0.001);
  assert.equal(hourly.allowed, false); if (!hourly.allowed) assert.deepEqual(hourly.windows, ['hour']);
  a.close(); const c = f.open();
  f.advance(3_600_000); assert.equal(c.reserveQuota('sample', 1).allowed, true);
  const daily = c.reserveQuota('sample', 0.001); assert.equal(daily.allowed, false);
  if (!daily.allowed) assert.deepEqual(daily.windows, ['day']);
  f.advance(DAY); assert.equal(c.reserveQuota('sample', 1).allowed, true);
  const monthly = c.reserveQuota('sample', 0.001); assert.equal(monthly.allowed, false);
  if (!monthly.allowed) assert.deepEqual(monthly.windows, ['month']);
  f.advance(31 * DAY); assert.equal(c.reserveQuota('sample', 2).allowed, true);
});
test('rolling quotas prevent midnight/month boundary bursts and isolate configured providers', t => {
  const limits = { minute: 1, hour: 1, day: 1, month: 1 };
  const f = fixture(t, { providers: { a: limits, b: limits } }); const a = f.open();
  assert.equal(a.reserveQuota('a', 1).allowed, true);
  f.advance(2000); assert.equal(a.reserveQuota('a', 1).allowed, false);
  assert.equal(a.reserveQuota('b', 1).allowed, true);
  assert.throws(() => a.reserveQuota('unconfigured', 1), /not configured/);
  for (const weight of [0, -1, NaN, Infinity]) assert.throws(() => a.reserveQuota('a', weight));
});
test('quota ledger capacity fails closed; bounded cleanup reclaims old entries', t => {
  const f = fixture(t, { maxQuotaEvents: 2 }); const a = f.open();
  assert.equal(a.reserveQuota('open-meteo', 1).allowed, true);
  f.advance(1); assert.equal(a.reserveQuota('open-meteo', 1).allowed, true);
  f.advance(1); assert.deepEqual(a.reserveQuota('open-meteo', 1), { allowed: false, reason: 'capacity', retryAt: null, windows: [] });
  f.advance(31 * DAY); assert.equal(a.cleanup(1).deleted.quota, 1);
  assert.equal(a.reserveQuota('open-meteo', 1).allowed, true);
});
test('clock rollback fails closed for coordinated mutations', t => {
  const f = fixture(t); const a = f.open(), b = f.open();
  a.reserveQuota('open-meteo', 1); f.advance(-1);
  assert.throws(() => b.reserveQuota('open-meteo', 1), /backwards/);
  assert.throws(() => b.acquireLease('x', 'worker', 100), /backwards/);
  f.advance(1); assert.equal(b.reserveQuota('open-meteo', 1).allowed, true);
});
test('bounded lock wait surfaces contention; cleanup measures physical DB/WAL/SHM and truncates WAL', t => {
  const f = fixture(t, { busyTimeoutMs: 20 }); const a = f.open(), b = f.open();
  const blocker = new DatabaseSync(f.options.path);
  try {
    blocker.exec('BEGIN IMMEDIATE');
    assert.throws(() => b.reserveQuota('open-meteo', 1), /locked/);
    blocker.exec('ROLLBACK');
  } finally { blocker.close(); }
  const now = f.time(); a.set('fixture', { test: true }, { retrievedAt: now, expiresAt: now + 1, staleUntil: now + 2 });
  const before = a.diskUsage(); assert.ok(before.databaseBytes > 0); assert.ok(before.walBytes > 0);
  f.advance(2); const cleaned = a.cleanup();
  assert.equal(cleaned.deleted.cache, 1); assert.equal(cleaned.checkpointBusy, false); assert.equal(cleaned.walBytes, 0);
  assert.equal(cleaned.totalBytes, cleaned.databaseBytes + cleaned.walBytes + cleaned.shmBytes);
  assert.equal(b.get('fixture'), null);
});
test('simultaneous independent processes admit exactly one lease and one final quota unit', async t => {
  const providers = { test: { minute: 1, hour: 1, day: 1, month: 1 } };
  const f = fixture(t, { providers }); f.open();
  const script = `import { SharedStorage } from ${JSON.stringify(new URL('./index.ts', import.meta.url).href)};
    const db = new SharedStorage({path: process.argv[1], providers: ${JSON.stringify(providers)}, clock: () => ${f.time()}});
    const lease = db.acquireLease('shared-refresh', process.argv[2], 10000);
    const quota = db.reserveQuota('test', 1);
    console.log(JSON.stringify({lease: !!lease, quota: quota.allowed})); db.close();`;
  const run = promisify(execFile);
  const outcomes = await Promise.all(['api', 'worker'].map(owner => run(process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script, f.options.path, owner], { timeout: 10_000 })));
  const values = outcomes.map(result => JSON.parse(result.stdout));
  assert.equal(values.filter(value => value.lease).length, 1);
  assert.equal(values.filter(value => value.quota).length, 1);
});
