import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobRepository } from '@zindycast/jobs';
import { InstallationRepository } from '@zindycast/installations';
import { SharedStorage } from '@zindycast/storage';
import { ClimateResultSchema, ComparisonWeatherDataSchema, type ComparisonWeatherData, type ReanalysisQuery, comparisonWeatherRequestUrl } from '@zindycast/contracts';
import { ClimateWorker, climateWeatherCacheKey } from './climate-worker.js';
const DAY = 86400000;
const query = { mode: 'period' as const, locations: [{ id: 'a', name: 'A', latitude: 40, longitude: -74, timezone: 'UTC' }, { id: 'b', name: 'B', latitude: 21, longitude: -157, timezone: 'UTC' }], startDate: '2020-03-08', endDate: '2020-03-08' };
// Metadata only from retained evidence; every weather value/time below is synthetic.
const template = JSON.parse(readFileSync(new URL('../../../docs/verification/history-runtime/new-york-march-2020.json', import.meta.url), 'utf8')) as unknown as ComparisonWeatherData;
function fixture(q: ReanalysisQuery, now: number): ComparisonWeatherData {
  const d = structuredClone(template), start = Date.parse(q.startDate), n = (Date.parse(q.endDate) - start) / 3600000 + 24;
  d.query = q;
  d.hours = Array.from({ length: n }, (_, i) => ({ time: new Date(start + i * 3600000).toISOString(), temperatureC: 10, humidityPercent: 50, precipitationMm: 1, windSpeedMs: 2, dewPointC: 0, wetBulbTemperatureC: 5, sunshineDurationSeconds: 60, cloudCoverPercent: 10, weatherCode: 0, sourceHourPresent: true, missingFields: [] }));
  d.completeness = { expectedHours: n, sourceHours: n, completeHours: n, missingHours: 0, status: 'complete', validCounts: { temperatureC: n, humidityPercent: n, precipitationMm: n, windSpeedMs: n, dewPointC: n, wetBulbTemperatureC: n, sunshineDurationSeconds: n, cloudCoverPercent: n, weatherCode: n } };
  d.provenance.retrievedAt = new Date(now).toISOString();
  d.provenance.sourceCoordinates = { latitude: q.latitude, longitude: q.longitude };
  d.provenance.requestUrl = comparisonWeatherRequestUrl(q);
  d.provenance.calculationVersion = 'comparison-weather-adapter-v2';
  d.intervalSemantics = 'instant meteorology; precipitation and sunshine duration sums over preceding hour ending at time';
  d.units = { ...d.units, wetBulbTemperatureC: '°C', sunshineDurationSeconds: 's', cloudCoverPercent: '%', weatherCode: 'wmo code' };
  return ComparisonWeatherDataSchema.parse(d);
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
    return jobs.enqueue({ id, kind: 'climate-comparison-v2', payload, expiresAt: now + DAY, maxAttempts: 3 });
  };
  return { jobs, peer, storage, installations, clock, identity, enqueue, advance: (ms: number) => { now += ms; },
    close: () => { jobs.close(); peer.close(); storage.close(); installations.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('sequential completion, validated result, shared cache identity and terminal admission release', async () => {
  const s = setup(); try {
    s.enqueue(); let calls = 0, inflight = 0;
    const worker = new ClimateWorker({ ...s, fetchWeather: async q => { assert.equal(inflight++, 0); calls++; const data = fixture(q, s.clock()); inflight--; return data; } });
    assert.equal(await worker.runOnce(), 'handled');
    const job = s.jobs.get('job')!; assert.equal(job.state, 'completed'); assert.equal(job.progress, 1);
    const result = ClimateResultSchema.parse(job.result);
    assert.equal(result.locations[0].overview.metrics.precipitationMm.total, 24);
    assert.equal(result.locations[0].overview.metrics.temperatureC.mean, 10);
    assert.equal(result.locations[0].monthly[0].key, '2020-03');
    assert.equal(result.locations[0].monthly[0].metrics.wetBulbTemperatureC.avgDailyHigh, 5);
    assert.equal(result.locations[0].monthly[0].metrics.sunshineDurationSeconds.total, 1440);
    assert.equal(s.installations.authorizeJob(s.identity.bearer, 'job')!.active, false);
    assert.equal(calls, 2);
    const q = result.plan.chunks[0].query;
    assert.equal(climateWeatherCacheKey(q), 'climate:era5:9fields:utc:v2:' + JSON.stringify({ latitude: 40, longitude: -74, startDate: '2020-03-08', endDate: '2020-03-09' }));
    s.enqueue('again'); await worker.runOnce(); assert.equal(calls, 2); assert.equal(s.jobs.get('again')!.state, 'completed');
    assert.equal(await worker.runOnce(), 'idle');
  } finally { s.close(); }
});
for (const action of ['cancel', 'revoke'] as const) test(`${action} from another actor aborts in-flight work and prevents publication`, async () => {
  const s = setup(); try {
    s.enqueue(); let aborted = false;
    const worker = new ClimateWorker({ ...s, pollMs: 5, fetchWeather: async (_q, signal) => {
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
    let calls = 0; const worker = new ClimateWorker({ ...s, fetchWeather: async q => { calls++; return fixture(q, s.clock()); } });
    s.enqueue('unowned', false); await worker.runOnce(); assert.equal(s.jobs.get('unowned')!.state, 'cancelled');
    s.enqueue('recent', true, { ...query, startDate: '2026-09-06', endDate: '2026-09-06' });
    await worker.runOnce(); assert.equal(s.jobs.get('recent')!.error, 'archive_not_available'); assert.equal(calls, 0);
  } finally { s.close(); }
});
test('quota denial and corrupt cached data fail closed without network fallback', async () => {
  const s = setup(); try {
    let calls = 0; const worker = new ClimateWorker({ ...s, fetchWeather: async q => { calls++; return fixture(q, s.clock()); } });
    s.storage.reserveQuota('open-meteo', 600); s.enqueue(); await worker.runOnce();
    assert.equal(s.jobs.get('job')!.error, 'provider_budget_denied'); assert.equal(calls, 0);
    const q = { latitude: 40, longitude: -74, startDate: query.startDate, endDate: '2020-03-09' };
    s.storage.set(climateWeatherCacheKey(q), { invalid: true }, { retrievedAt: s.clock(), expiresAt: s.clock() + DAY, staleUntil: s.clock() + DAY });
    s.enqueue('corrupt'); await worker.runOnce(); assert.equal(s.jobs.get('corrupt')!.state, 'failed'); assert.equal(calls, 0);
  } finally { s.close(); }
});
test('shutdown aborts and leaves running lease/admission recoverable; next attempt reuses validated chunks', async () => {
  const s = setup(); try {
    s.enqueue(); const stop = new AbortController(); let calls = 0;
    const worker = new ClimateWorker({ ...s, fetchWeather: async (q, signal) => {
      calls++; if (calls === 1) return fixture(q, s.clock());
      stop.abort(); assert.ok(signal!.aborted); throw signal!.reason;
    } });
    await worker.runOnce(stop.signal);
    assert.equal(s.jobs.get('job')!.state, 'running'); assert.equal(s.jobs.get('job')!.progress, 0.5);
    assert.ok(s.installations.isJobActive('job')); assert.equal(s.storage.cacheUsage().entries, 1);
    s.advance(30_001); let recoveryCalls = 0;
    await new ClimateWorker({ ...s, fetchWeather: async q => { recoveryCalls++; return fixture(q, s.clock()); } }).runOnce();
    assert.equal(s.jobs.get('job')!.state, 'completed'); assert.equal(s.jobs.get('job')!.attempt, 2); assert.equal(recoveryCalls, 1);
  } finally { s.close(); }
});
test('lease takeover fences old result and retains new running admission', async () => {
  const s = setup(); try {
    s.enqueue();
    await new ClimateWorker({ ...s, fetchWeather: async q => {
      s.advance(30_001); assert.ok(s.peer.acquire('other-worker', 30_000, 'climate-comparison-v2'));
      return fixture(q, s.clock());
    } }).runOnce();
    const job = s.jobs.get('job')!; assert.equal(job.state, 'running'); assert.equal(job.attempt, 2);
    assert.equal(job.lease!.owner, 'other-worker'); assert.ok(s.installations.isJobActive('job')); assert.equal(s.storage.cacheUsage().entries, 0);
  } finally { s.close(); }
});
test('heartbeat renews during provider work and runOnce excludes same-instance concurrency', async () => {
  const s = setup(); try {
    s.enqueue(); let worker: ClimateWorker;
    worker = new ClimateWorker({ ...s, pollMs: 5, fetchWeather: async q => {
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
    await new ClimateWorker({ ...s, fetchWeather: async q => { calls++; assert.equal(weights.length, calls); return fixture(q, s.clock()); } }).runOnce();
    assert.deepEqual(weights, [3, 1, 3, 1]); assert.equal(s.jobs.get('weighted')!.state, 'completed');
  } finally { s.close(); }
});
test('storage read failure and held cache lease fail without provider work', async () => {
  const s = setup(); try {
    s.enqueue(); let calls = 0;
    const worker = new ClimateWorker({ ...s, fetchWeather: async q => { calls++; return fixture(q, s.clock()); } });
    const get = s.storage.get.bind(s.storage); s.storage.get = () => { throw new Error('injected disk error'); };
    await worker.runOnce(); assert.equal(calls, 0); assert.equal(s.jobs.get('job')!.state, 'failed');
    s.storage.get = get;
    s.enqueue('locked'); const key = climateWeatherCacheKey({ latitude: 40, longitude: -74, startDate: query.startDate, endDate: '2020-03-09' });
    s.storage.acquireLease(key, 'api', 20_000); await worker.runOnce();
    assert.equal(s.jobs.get('locked')!.error, 'history_refresh_busy'); assert.equal(calls, 0);
  } finally { s.close(); }
});
test('wrong provenance and expired cache write lease are rejected before progress/publication', async () => {
  const s = setup(); try {
    s.enqueue();
    await new ClimateWorker({ ...s, fetchWeather: async q => { const d = fixture(q, s.clock()); const u = new URL(d.provenance.requestUrl); u.searchParams.set('models', 'era5_seamless'); d.provenance.requestUrl = u.toString(); return d; } }).runOnce();
    assert.equal(s.jobs.get('job')!.state, 'failed'); assert.equal(s.jobs.get('job')!.progress, 0); assert.equal(s.storage.cacheUsage().entries, 0);
    s.enqueue('cache-expired');
    await new ClimateWorker({ ...s, fetchWeather: async q => { s.advance(20_001); return fixture(q, s.clock()); } }).runOnce();
    assert.equal(s.jobs.get('cache-expired')!.error, 'cache_lease_lost'); assert.equal(s.storage.cacheUsage().entries, 0);
  } finally { s.close(); }
});

for (const offset of [-DAY, 1]) test(`source retrieval offset ${offset} is rejected without caching or retry`, async () => {
  const s = setup(); try {
    s.enqueue(); let calls = 0;
    const worker = new ClimateWorker({ ...s, fetchWeather: async q => { calls++; return fixture(q, s.clock() + offset); } });
    await worker.runOnce();
    assert.equal(s.jobs.get('job')!.state, 'failed'); assert.equal(s.storage.cacheUsage().entries, 0);
    assert.equal(await worker.runOnce(), 'idle'); assert.equal(calls, 1);
  } finally { s.close(); }
});
test('expired job aborts an uncooperative provider and never publishes', async () => {
  const s = setup(); try {
    s.enqueue(); let signal: AbortSignal | undefined;
    await new ClimateWorker({ ...s, pollMs: 5, fetchWeather: async (_q, abort) => {
      signal = abort; s.advance(DAY + 1); return new Promise(() => {});
    } }).runOnce();
    assert.ok(signal!.aborted); assert.notEqual(s.jobs.get('job')?.state, 'completed');
    assert.equal(s.jobs.get('job')?.result ?? null, null); assert.equal(s.storage.cacheUsage().entries, 0);
  } finally { s.close(); }
});
test('fifteen-minute total fence stops further chunks even with renewed job lease', async () => {
  const s = setup(); try {
    s.enqueue(); let calls = 0;
    await new ClimateWorker({ ...s, fetchWeather: async q => {
      calls++;
      // Keep the actual lease alive while advancing the job's total elapsed time.
      for (let i = 0; i < 90; i++) { s.advance(10_000); assert.ok(s.jobs.renew(s.jobs.get('job')!.lease!, 30_000)); }
      return fixture(q, s.clock());
    } }).runOnce();
    assert.equal(s.jobs.get('job')!.error, 'job_time_limit'); assert.equal(calls, 1);
    assert.equal(s.jobs.get('job')!.result, null); assert.equal(s.storage.cacheUsage().entries, 0);
  } finally { s.close(); }
});
test('maximum five-city five-year fixture memory audit', { skip: process.env.CLIMATE_MEMORY_AUDIT !== '1' }, async () => {
  const s = setup(); try {
    const payload = { mode: 'climatology', startDate: '2020-01-01', endDate: '2024-12-31', locations: Array.from({ length: 5 }, (_, i) => ({ id: `city-${i}`, name: `Fixture ${i}`, latitude: 30 + i, longitude: -80 - i, timezone: 'America/New_York' })) };
    const id = 'maximum'; assert.ok(s.installations.reserveJob(s.identity.bearer, id, s.clock() + DAY));
    s.jobs.enqueue({ id, kind: 'climate-comparison-v2', payload, expiresAt: s.clock() + DAY, maxAttempts: 1 });
    // Synthetic local audit intentionally bypasses quota admission; no HTTP transport.
    s.storage.reserveQuota = () => ({ allowed: true } as ReturnType<SharedStorage['reserveQuota']>);
    let calls = 0, hours = 0;
    await new ClimateWorker({ ...s, fetchWeather: async q => { calls++; const d = fixture(q, s.clock()); hours += d.hours.length; return d; } }).runOnce();
    const job = s.jobs.get(id)!;
    assert.equal(job.state, 'completed', job.error ?? undefined);
    const result = ClimateResultSchema.parse(job.result);
    assert.equal(result.locations.length, 5); assert.equal(result.locations[0].monthly.length, 12);
    assert.ok(calls <= 305); assert.ok(hours <= 305 * 744);
    console.log(JSON.stringify({ audit: 'synthetic maximum climate worker', calls, hours, memory: process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS, resultBytes: Buffer.byteLength(JSON.stringify(result)) }));
  } finally { s.close(); }
});
