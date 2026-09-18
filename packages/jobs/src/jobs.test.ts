import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JobRepository, type JobOptions, type JsonValue } from './index.js';

function fixture(t: { after(fn: () => void): void }, limits: Partial<JobOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zc-jobs-')); let now = 1000;
  const options = { path: join(dir, 'jobs.db'), clock: () => now, ...limits };
  const connections: JobRepository[] = [];
  const open = () => { const repo = new JobRepository(options); connections.push(repo); return repo; };
  t.after(() => { for (const repo of connections) { try { repo.close(); } catch {} } rmSync(dir, { recursive: true, force: true }); });
  return { options, open, time: (n: number) => { now = n; }, job: (repo: JobRepository, id = 'one', maxAttempts = 2) => repo.enqueue({ id, kind: 'comparison', payload: { dataset: 'ERA5' }, maxAttempts, expiresAt: 10_000 }) };
}
test('independent connections compete, recover at exact expiry, and fence all late writes', t => {
  const f = fixture(t), a = f.open(), b = f.open(); f.job(a);
  const first = a.acquire('worker-a', 100, 'comparison')!;
  assert.equal(first.attempt, 1); assert.equal(b.acquire('worker-b', 100, 'comparison'), null);
  assert.equal(a.progress(first.lease!, .7), true);
  f.time(1100); const second = b.acquire('worker-b', 100, 'comparison')!;
  assert.equal(second.attempt, 2); assert.equal(second.progress, 0); assert.notEqual(first.lease!.token, second.lease!.token);
  assert.equal(a.complete(first.lease!, { late: true }), false);
  assert.equal(a.fail(first.lease!, 'late'), false); assert.equal(a.progress(first.lease!, .9), false); assert.equal(a.renew(first.lease!, 200), null);
  assert.equal(b.complete(second.lease!, { valid: true }), true);
  assert.equal(b.complete(second.lease!, { duplicate: true }), false);
  assert.deepEqual(a.get('one')!.result, { valid: true }); assert.equal(a.get('one')!.progress, 1);
});
test('progress monotonic per attempt, renew never shortens or revives expired lease', t => {
  const f = fixture(t), a = f.open(); f.job(a);
  const lease = a.acquire('worker', 100, 'comparison')!.lease!;
  assert.equal(a.progress(lease, .6), true); assert.equal(a.progress(lease, .5), false);
  assert.throws(() => a.progress(lease, NaN)); assert.throws(() => a.progress(lease, 1.01));
  f.time(1050); assert.equal(a.renew(lease, 10)!.expiresAt, 1100);
  assert.equal(a.renew(lease, 200)!.expiresAt, 1250);
  f.time(1200); assert.equal(a.progress(lease, .7), true); // persisted token, not caller deadline, is authority
  f.time(1250); assert.equal(a.renew(lease, 100), null); assert.equal(a.complete(lease, null), false);
});
test('explicit bounded retry and delayed availability survive orderly restart', t => {
  const f = fixture(t), a = f.open(); f.job(a);
  const lease = a.acquire('worker', 100, 'comparison')!.lease!;
  assert.equal(a.fail(lease, 'provider_unavailable'), true); assert.equal(a.acquire('worker', 100, 'comparison'), null);
  assert.equal(a.retry('one', 100), true); a.close(); const b = f.open();
  assert.equal(b.get('one')!.state, 'queued'); assert.equal(b.acquire('worker', 100, 'comparison'), null);
  f.time(1100); const next = b.acquire('worker', 100, 'comparison')!;
  assert.equal(next.attempt, 2); assert.equal(next.progress, 0); assert.equal(next.error, null);
  assert.equal(b.fail(next.lease!, 'provider_unavailable'), true); assert.equal(b.retry('one'), false);
});
test('expired final attempt becomes failed and restart recovers abandoned running work', t => {
  const f = fixture(t), a = f.open(); f.job(a, 'final', 1); f.job(a, 'recover', 2);
  a.acquire('worker', 100, 'comparison'); a.acquire('worker', 100, 'comparison'); a.close(); f.time(1100);
  const b = f.open(), recovered = b.acquire('worker-b', 100, 'comparison')!;
  assert.equal(recovered.id, 'recover'); assert.equal(recovered.attempt, 2);
  assert.equal(b.get('final')!.state, 'failed'); assert.equal(b.get('final')!.error, 'lease_expired_attempts_exhausted');
});
test('cancel queued/running is terminal and fences late completion', t => {
  const f = fixture(t), a = f.open(), b = f.open(); f.job(a); f.job(a, 'two');
  const lease = a.acquire('worker', 100, 'comparison')!.lease!;
  assert.equal(b.cancel(lease.id), true); assert.equal(a.complete(lease, {}), false);
  assert.equal(a.cancel('two'), true); assert.equal(a.acquire('worker', 100, 'comparison'), null);
  assert.equal(a.retry('one'), false); assert.equal(a.cancel('one'), false);
});
test('fixed lifetime hides all expired states, clamps lease, and cleanup is bounded', t => {
  const f = fixture(t), a = f.open(); f.job(a); f.job(a, 'two');
  const lease = a.acquire('worker', 86_400_000, 'comparison')!.lease!;
  assert.equal(lease.expiresAt, 10_000); f.time(10_000);
  assert.equal(a.get('one'), null); assert.equal(a.complete(lease, null), false); assert.equal(a.cancel('two'), false);
  assert.equal(a.acquire('worker', 100, 'comparison'), null);
  assert.equal(a.cleanup(1).deleted, 1); assert.equal(a.usage().jobs, 1); assert.equal(a.cleanup(1).deleted, 1);
  assert.equal(a.diskUsage().walBytes, 0); assert.ok(a.diskUsage().databaseBytes > 0);
});
test('JSON, job count and combined byte limits fail atomically; duplicate id never overwrites', t => {
  const f = fixture(t, { maxJobs: 2, maxJsonBytes: 64, maxTotalJsonBytes: 48 }), a = f.open(); f.job(a);
  assert.throws(() => f.job(a)); assert.deepEqual(a.get('one')!.payload, { dataset: 'ERA5' });
  const lease = a.acquire('worker', 100, 'comparison')!.lease!;
  assert.throws(() => a.complete(lease, 'x'.repeat(40))); assert.equal(a.get('one')!.state, 'running');
  assert.equal(a.complete(lease, null), true); f.job(a, 'two'); assert.throws(() => f.job(a, 'three'));
  for (const payload of [NaN, new Date(), { x: undefined }, new Array(2), 'x'.repeat(65)] as unknown as JsonValue[]) {
    assert.throws(() => a.enqueue({ id: 'bad', kind: 'comparison', payload, maxAttempts: 1, expiresAt: 2000 }));
  }
  const circular: { x?: unknown } = {}; circular.x = circular;
  assert.throws(() => a.enqueue({ kind: 'comparison', payload: circular as JsonValue, maxAttempts: 1, expiresAt: 2000 }));
});
test('configuration and backwards clock fail closed; kind filtering and input bounds', t => {
  const f = fixture(t), a = f.open(); f.job(a);
  assert.throws(() => new JobRepository({ ...f.options, maxJobs: 2 }), /configuration/);
  assert.equal(a.acquire('worker', 100, 'unrelated'), null);
  assert.throws(() => a.enqueue({ kind: 'comparison', payload: null, maxAttempts: 11, expiresAt: 2000 }));
  assert.throws(() => a.enqueue({ kind: 'comparison', payload: null, maxAttempts: 1, expiresAt: 1000 }));
  assert.throws(() => a.enqueue({ kind: 'comparison', payload: null, maxAttempts: 1, expiresAt: 31 * 86_400_000 }));
  f.time(999); assert.throws(() => a.get('one'), /backwards/); assert.throws(() => a.cancel('one'), /backwards/);
});
test('busy writer fails within configured timeout without changing job', t => {
  const f = fixture(t, { busyTimeoutMs: 20 }), a = f.open(); f.job(a);
  const blocker = new DatabaseSync(f.options.path); t.after(() => blocker.close());
  blocker.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => a.acquire('worker', 100, 'comparison'), /locked/); }
  finally { blocker.exec('ROLLBACK'); }
  assert.equal(a.get('one')!.attempt, 0); assert.equal(a.acquire('worker', 100, 'comparison')!.attempt, 1);
});
