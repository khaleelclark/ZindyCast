import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobRepository } from '@zindycast/jobs';
import { InstallationRepository } from '@zindycast/installations';
import { AdmissionReconciler } from './reconciliation.js';
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zc-reconcile-'));
  let now = 1000000; const clock = () => now;
  const options = { path: join(dir, 'jobs'), clock, busyTimeoutMs: 0 };
  let jobs = new JobRepository(options);
  const peer = new JobRepository(options);
  const io = { path: join(dir, 'installations'), clock, maxActiveJobs: 10 };
  const installations = new InstallationRepository(io), other = new InstallationRepository(io);
  const identity = installations.register(100000);
  const reserve = (id: string) => assert.ok(other.reserveJob(identity.bearer, id, now + 10000));
  const enqueue = (id: string, maxAttempts = 2) => jobs.enqueue({ id, kind: 'comparison-v1', payload: null, maxAttempts, expiresAt: now + 10000 });
  return { get jobs() { return jobs; }, peer, installations, other, identity, reserve, enqueue,
    advance: (ms: number) => { now += ms; }, reopen: () => { jobs.close(); jobs = new JobRepository(options); },
    close: () => { jobs.close(); peer.close(); installations.close(); other.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('terminal-before-release restart, idempotent reconciliation and retained lookup isolation', () => {
  const s = setup(); try {
    s.reserve('done'); s.enqueue('done'); const lease = s.jobs.acquire('w', 100, 'comparison-v1')!.lease!;
    assert.ok(s.jobs.complete(lease, { ok: true })); s.reopen();
    const r = new AdmissionReconciler(s.jobs, s.installations);
    assert.deepEqual(r.runBatch(), { examined: 1, released: 1 });
    assert.equal(s.other.authorizeJob(s.identity.bearer, 'done')!.active, false);
    assert.equal(s.other.authorizeJob(s.other.register(10000).bearer, 'done'), null);
    assert.deepEqual(r.runBatch(), { examined: 0, released: 0 });
  } finally { s.close(); }
});
test('exhausted acquire failure and external queued cancellation release even after revocation', () => {
  const s = setup(); try {
    s.reserve('exhausted'); s.enqueue('exhausted', 1); s.jobs.acquire('w', 100, 'comparison-v1');
    s.advance(100); assert.equal(s.jobs.acquire('w', 100, 'comparison-v1'), null);
    s.reserve('cancelled'); s.enqueue('cancelled'); s.peer.cancel('cancelled');
    s.other.revoke(s.identity.bearer);
    assert.deepEqual(new AdmissionReconciler(s.jobs, s.installations).runBatch(), { examined: 2, released: 2 });
    assert.deepEqual(s.other.listActiveJobIds(), []);
  } finally { s.close(); }
});
test('keyset pages retain ambiguous absent, queued and expired-running reservations without starvation', () => {
  const s = setup(); try {
    for (const id of ['a-absent', 'b-running', 'c-queued', 'z-terminal']) s.reserve(id);
    s.enqueue('b-running'); s.jobs.acquire('w', 100, 'comparison-v1'); s.advance(100);
    s.enqueue('c-queued'); s.enqueue('z-terminal'); s.peer.cancel('z-terminal');
    const r = new AdmissionReconciler(s.jobs, s.installations);
    assert.deepEqual(r.runBatch(2), { examined: 2, released: 0 });
    s.enqueue('a-absent'); // enqueue races the earlier absent observation: admission was retained
    assert.deepEqual(r.runBatch(2), { examined: 2, released: 1 });
    assert.deepEqual(r.runBatch(2), { examined: 0, released: 0 });
    assert.deepEqual(s.other.listActiveJobIds(), ['a-absent', 'b-running', 'c-queued']);
    assert.throws(() => r.runBatch(0), /Invalid/); assert.throws(() => r.runBatch(1001), /Invalid/);
    assert.throws(() => s.other.listActiveJobIds(1, "'"), /Invalid/);
  } finally { s.close(); }
});
test('retry before fence retains queued admission; committed fence survives release failure and restart', () => {
  const s = setup(); try {
    s.reserve('retry'); s.enqueue('retry'); s.jobs.fail(s.jobs.acquire('w', 100, 'comparison-v1')!.lease!, 'test');
    assert.ok(s.peer.retry('retry'));
    assert.deepEqual(new AdmissionReconciler(s.jobs, s.installations).runBatch(), { examined: 1, released: 0 });
    s.jobs.fail(s.jobs.acquire('w', 100, 'comparison-v1')!.lease!, 'test');
    const release = s.installations.releaseJob.bind(s.installations);
    s.installations.releaseJob = () => { throw new Error('injected release failure'); };
    assert.throws(() => new AdmissionReconciler(s.jobs, s.installations).runBatch(), /injected/);
    s.reopen(); assert.equal(s.peer.retry('retry'), false);
    assert.ok(s.other.isJobActive('retry')); s.installations.releaseJob = release;
    assert.equal(new AdmissionReconciler(s.jobs, s.installations).runBatch().released, 1);
    s.advance(10000); s.jobs.cleanup(); s.installations.cleanup();
    assert.equal(s.jobs.usage().jobs, 0);
  } finally { s.close(); }
});
test('failed job with attempts left cannot retry between fence and release', () => {
  const s = setup(); try {
    s.reserve('failed'); s.enqueue('failed'); s.jobs.fail(s.jobs.acquire('w', 100, 'comparison-v1')!.lease!, 'test');
    const release = s.installations.releaseJob.bind(s.installations);
    s.installations.releaseJob = id => { assert.equal(s.peer.retry(id), false); return release(id); };
    assert.equal(new AdmissionReconciler(s.jobs, s.installations).runBatch().released, 1);
    s.reopen(); assert.equal(s.jobs.retry('failed'), false);
  } finally { s.close(); }
});
