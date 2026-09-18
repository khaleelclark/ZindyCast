import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobRepository } from '@zindycast/jobs';
import { InstallationRepository } from '@zindycast/installations';
import { SharedStorage } from '@zindycast/storage';
import { ComparisonResultSchema, ReanalysisDataSchema, type ReanalysisData, type ReanalysisQuery } from '@zindycast/contracts';
import { ComparisonWorker, historyCacheKey } from './comparison-worker.js';
const DAY = 86400000;
const query = { locations: [{ id: 'a', name: 'A', latitude: 40, longitude: -74 }, { id: 'b', name: 'B', latitude: 21, longitude: -157 }], startDate: '2020-03-08', endDate: '2020-03-08' };
// Metadata only from retained evidence; every weather value/time below is synthetic.
const template = JSON.parse(readFileSync(new URL('../../../docs/verification/history-runtime/new-york-march-2020.json', import.meta.url), 'utf8')) as ReanalysisData;
function fixture(q: ReanalysisQuery, now: number): ReanalysisData {
  const d = structuredClone(template), start = Date.parse(q.startDate), n = (Date.parse(q.endDate) - start) / 3600000 + 24;
  d.query = q;
  d.hours = Array.from({ length: n }, (_, i) => ({ time: new Date(start + i * 3600000).toISOString(), temperatureC: 10, humidityPercent: 50, precipitationMm: 1, windSpeedMs: 2, dewPointC: 0, sourceHourPresent: true, missingFields: [] }));
  d.completeness = { expectedHours: n, sourceHours: n, completeHours: n, missingHours: 0, status: 'complete', validCounts: { temperatureC: n, humidityPercent: n, precipitationMm: n, windSpeedMs: n, dewPointC: n } };
  d.provenance.retrievedAt = new Date(now).toISOString();
  d.provenance.sourceCoordinates = { latitude: q.latitude, longitude: q.longitude };
  const url = new URL(d.provenance.requestUrl);
  for (const [k, v] of Object.entries({ latitude: q.latitude, longitude: q.longitude, start_date: q.startDate, end_date: q.endDate })) url.searchParams.set(k, String(v));
  d.provenance.requestUrl = url.toString();
  return ReanalysisDataSchema.parse(d);
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zc-worker-'));
  let now = Date.parse('2026-09-11T00:00:00Z'); const clock = () => now;
  const jobs = new JobRepository({ path: join(dir, 'jobs.db'), clock });
  const peer = new JobRepository({ path: join(dir, 'jobs.db'), clock });
  const installations = new InstallationRepository({ path: join(dir, 'inst.db'), clock });
  const identity = installations.register(10 * DAY);
  const storage = new SharedStorage({ path: join(dir, 'cache.db'), clock });
  const enqueue = (id = 'job', owned = true, payload = query) => {
    if (owned) assert.ok(installations.reserveJob(identity.bearer, id, now + DAY));
    return jobs.enqueue({ id, kind: 'comparison-v1', payload, expiresAt: now + DAY, maxAttempts: 3 });
  };
  return { jobs, peer, storage, installations, clock, identity, enqueue, advance: (ms: number) => { now += ms; },
    close: () => { jobs.close(); peer.close(); storage.close(); installations.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('sequential completion, validated result, shared cache identity and terminal admission release', async () => {
  const s = setup(); try {
    s.enqueue(); let calls = 0, inflight = 0;
    const worker = new ComparisonWorker({ ...s, fetchHistory: async q => { assert.equal(inflight++, 0); calls++; const data = fixture(q, s.clock()); inflight--; return data; } });
    assert.equal(await worker.runOnce(), 'handled');
    const job = s.jobs.get('job')!; assert.equal(job.state, 'completed'); assert.equal(job.progress, 1);
    const result = ComparisonResultSchema.parse(job.result);
    assert.equal(result.locations[0].variables.precipitationMm.totalMm, 24);
    assert.equal(result.locations[0].variables.temperatureC.mean, 10);
    assert.equal(s.installations.authorizeJob(s.identity.bearer, 'job')!.active, false);
    assert.equal(calls, 2);
    const q = result.plan.chunks[0].query;
    assert.equal(historyCacheKey(q), 'history:era5:5fields:utc:v1:' + JSON.stringify({ latitude: 40, longitude: -74, startDate: '2020-03-08', endDate: '2020-03-09' }));
    s.enqueue('again'); await worker.runOnce(); assert.equal(calls, 2); assert.equal(s.jobs.get('again')!.state, 'completed');
    assert.equal(await worker.runOnce(), 'idle');
  } finally { s.close(); }
});
for (const action of ['cancel', 'revoke'] as const) test(`${action} from another actor aborts in-flight work and prevents publication`, async () => {
  const s = setup(); try {
    s.enqueue(); let aborted = false;
    const worker = new ComparisonWorker({ ...s, pollMs: 5, fetchHistory: async (_q, signal) => {
      if (action === 'cancel') s.peer.cancel('job'); else s.installations.revoke(s.identity.bearer);
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => { aborted = true; reject(signal!.reason); }, { once: true }));
    } });
    await worker.runOnce(); assert.ok(aborted); assert.equal(s.jobs.get('job')!.state, 'cancelled');
    assert.equal(s.jobs.get('job')!.result, null); assert.equal(s.storage.cacheUsage().entries, 0);
    assert.equal(s.installations.isJobActive('job'), false);
  } finally { s.close(); }
});
test('unowned payload and too-recent closing padding make no provider calls', async () => {
  const s = setup(); try {
    let calls = 0; const worker = new ComparisonWorker({ ...s, fetchHistory: async q => { calls++; return fixture(q, s.clock()); } });
    s.enqueue('unowned', false); await worker.runOnce(); assert.equal(s.jobs.get('unowned')!.state, 'cancelled');
    s.enqueue('recent', true, { ...query, startDate: '2026-09-06', endDate: '2026-09-06' });
    await worker.runOnce(); assert.equal(s.jobs.get('recent')!.error, 'archive_not_available'); assert.equal(calls, 0);
  } finally { s.close(); }
});
test('quota denial and corrupt cached data fail closed without network fallback', async () => {
  const s = setup(); try {
    let calls = 0; const worker = new ComparisonWorker({ ...s, fetchHistory: async q => { calls++; return fixture(q, s.clock()); } });
    s.storage.reserveQuota('open-meteo', 600); s.enqueue(); await worker.runOnce();
    assert.equal(s.jobs.get('job')!.error, 'provider_budget_denied'); assert.equal(calls, 0);
    const q = { latitude: 40, longitude: -74, startDate: query.startDate, endDate: '2020-03-09' };
    s.storage.set(historyCacheKey(q), { invalid: true }, { retrievedAt: s.clock(), expiresAt: s.clock() + DAY, staleUntil: s.clock() + DAY });
    s.enqueue('corrupt'); await worker.runOnce(); assert.equal(s.jobs.get('corrupt')!.state, 'failed'); assert.equal(calls, 0);
  } finally { s.close(); }
});
test('shutdown aborts and leaves running lease/admission recoverable; next attempt reuses validated chunks', async () => {
  const s = setup(); try {
    s.enqueue(); const stop = new AbortController(); let calls = 0;
    const worker = new ComparisonWorker({ ...s, fetchHistory: async (q, signal) => {
      calls++; if (calls === 1) return fixture(q, s.clock());
      stop.abort(); assert.ok(signal!.aborted); throw signal!.reason;
    } });
    await worker.runOnce(stop.signal);
    assert.equal(s.jobs.get('job')!.state, 'running'); assert.equal(s.jobs.get('job')!.progress, 0.5);
    assert.ok(s.installations.isJobActive('job')); assert.equal(s.storage.cacheUsage().entries, 1);
    s.advance(30_001); let recoveryCalls = 0;
    await new ComparisonWorker({ ...s, fetchHistory: async q => { recoveryCalls++; return fixture(q, s.clock()); } }).runOnce();
    assert.equal(s.jobs.get('job')!.state, 'completed'); assert.equal(s.jobs.get('job')!.attempt, 2); assert.equal(recoveryCalls, 1);
  } finally { s.close(); }
});
test('lease takeover fences old result and retains new running admission', async () => {
  const s = setup(); try {
    s.enqueue();
    await new ComparisonWorker({ ...s, fetchHistory: async q => {
      s.advance(30_001); assert.ok(s.peer.acquire('other-worker', 30_000, 'comparison-v1'));
      return fixture(q, s.clock());
    } }).runOnce();
    const job = s.jobs.get('job')!; assert.equal(job.state, 'running'); assert.equal(job.attempt, 2);
    assert.equal(job.lease!.owner, 'other-worker'); assert.ok(s.installations.isJobActive('job')); assert.equal(s.storage.cacheUsage().entries, 0);
  } finally { s.close(); }
});
test('heartbeat renews during provider work and runOnce excludes same-instance concurrency', async () => {
  const s = setup(); try {
    s.enqueue(); let worker: ComparisonWorker;
    worker = new ComparisonWorker({ ...s, pollMs: 5, fetchHistory: async q => {
      assert.equal(await worker.runOnce(), 'busy');
      s.advance(15_000);
      await new Promise(resolve => setTimeout(resolve, 15));
      assert.ok(s.jobs.get('job')!.lease!.expiresAt > s.clock() + 20_000);
      return fixture(q, s.clock());
    } });
    await worker.runOnce(); assert.equal(s.jobs.get('job')!.state, 'completed');
  } finally { s.close(); }
});
test('31-day chunks charge weight three and padding weight one before each request', async () => {
  const s = setup(); try {
    s.enqueue('weighted', true, { ...query, startDate: '2020-01-01', endDate: '2020-01-31' });
    const weights: number[] = []; const reserve = s.storage.reserveQuota.bind(s.storage);
    s.storage.reserveQuota = (provider, weight) => { weights.push(weight); return reserve(provider, weight); };
    let calls = 0;
    await new ComparisonWorker({ ...s, fetchHistory: async q => { calls++; assert.equal(weights.length, calls); return fixture(q, s.clock()); } }).runOnce();
    assert.deepEqual(weights, [3, 1, 3, 1]); assert.equal(s.jobs.get('weighted')!.state, 'completed');
  } finally { s.close(); }
});
test('storage read failure and held cache lease fail without provider work', async () => {
  const s = setup(); try {
    s.enqueue(); let calls = 0;
    const worker = new ComparisonWorker({ ...s, fetchHistory: async q => { calls++; return fixture(q, s.clock()); } });
    const get = s.storage.get.bind(s.storage); s.storage.get = () => { throw new Error('injected disk error'); };
    await worker.runOnce(); assert.equal(calls, 0); assert.equal(s.jobs.get('job')!.state, 'failed');
    s.storage.get = get;
    s.enqueue('locked'); const key = historyCacheKey({ latitude: 40, longitude: -74, startDate: query.startDate, endDate: '2020-03-09' });
    s.storage.acquireLease(key, 'api', 20_000); await worker.runOnce();
    assert.equal(s.jobs.get('locked')!.error, 'history_refresh_busy'); assert.equal(calls, 0);
  } finally { s.close(); }
});
test('wrong provenance and expired cache write lease are rejected before progress/publication', async () => {
  const s = setup(); try {
    s.enqueue();
    await new ComparisonWorker({ ...s, fetchHistory: async q => { const d = fixture(q, s.clock()); const u = new URL(d.provenance.requestUrl); u.searchParams.set('models', 'era5_seamless'); d.provenance.requestUrl = u.toString(); return d; } }).runOnce();
    assert.equal(s.jobs.get('job')!.state, 'failed'); assert.equal(s.jobs.get('job')!.progress, 0); assert.equal(s.storage.cacheUsage().entries, 0);
    s.enqueue('cache-expired');
    await new ComparisonWorker({ ...s, fetchHistory: async q => { s.advance(20_001); return fixture(q, s.clock()); } }).runOnce();
    assert.equal(s.jobs.get('cache-expired')!.error, 'cache_lease_lost'); assert.equal(s.storage.cacheUsage().entries, 0);
  } finally { s.close(); }
});
