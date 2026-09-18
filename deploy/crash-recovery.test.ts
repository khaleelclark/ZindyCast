import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobRepository, type JobLease } from '../packages/jobs/src/index.js';
import { InstallationRepository, type Registration } from '../packages/installations/src/index.js';
import { SharedStorage } from '../packages/storage/src/index.js';
import { AdmissionReconciler } from '../apps/worker/src/reconciliation.js';
import { snapshot } from './sqlite-snapshot.mjs';

test('SIGKILL: committed WAL survives, open transaction rolls back, all three snapshots restore fences/auth/quota', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-kill-'));
  const child = fork(fileURLToPath(new URL('./fixtures/crash-child.ts', import.meta.url)), [dir], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const exited = once(child, 'exit');
  const resources: { close(): void }[] = [];
  try {
    const info = await new Promise<{ owner: Registration; revoked: Registration; leases: Record<string, JobLease> }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child readiness timeout')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('child exited before readiness')); });
      child.once('message', message => { clearTimeout(timer); resolve(message as never); });
    });
    assert.ok(child.kill('SIGKILL'));
    const [code, signal] = await exited;
    assert.equal(code, null); assert.equal(signal, 'SIGKILL');
    let now = 1000; const clock = () => now;
    const open = (suffix: string) => {
      const jobs = new JobRepository({ path: join(dir, `jobs.${suffix}`), clock }); resources.push(jobs);
      const installations = new InstallationRepository({ path: join(dir, `installations.${suffix}`), clock, maxActiveJobs: 10 }); resources.push(installations);
      const storage = new SharedStorage({ path: join(dir, `coordination.${suffix}`), clock, providers: { test: { minute: 2, hour: 2, day: 2, month: 2 } } }); resources.push(storage);
      return { jobs, installations, storage };
    };
    const original = open('sqlite');
    assert.deepEqual(original.jobs.get('done')!.result, { committed: true });
    assert.equal(original.installations.authenticate(info.revoked.bearer), null);
    // No writes occur while taking this fixed three-database test snapshot set.
    for (const name of ['jobs', 'installations', 'coordination']) {
      await snapshot(join(dir, `${name}.sqlite`), join(dir, `${name}.backup`));
      await snapshot(join(dir, `${name}.backup`), join(dir, `${name}.restored`));
    }
    const restored = open('restored');
    for (const { jobs, installations, storage } of [original, restored]) {
      assert.deepEqual(jobs.get('done')!.result, { committed: true });
      assert.equal(installations.authenticate(info.owner.bearer)?.id, info.owner.id);
      assert.equal(installations.authenticate(info.revoked.bearer), null);
      assert.equal(installations.isJobActive('revoked'), false);
      assert.equal(installations.authorizeJob(info.owner.bearer, 'revoked'), null);
      assert.equal(jobs.retry('fenced'), false);
      assert.equal(jobs.complete(info.leases.cancelled, { late: true }), false);
      assert.equal(jobs.acquire('replacement', 100, 'running'), null);
      assert.deepEqual(storage.get('fixture')!.value, { committed: true });
      assert.equal(storage.reserveQuota('test', 1).allowed, false);
      assert.deepEqual(new AdmissionReconciler(jobs, installations).runBatch(), { examined: 7, released: 3 });
      assert.deepEqual(installations.listActiveJobIds(), ['absent', 'exhausted', 'revoked', 'running']);
    }
    now = 1100;
    for (const { jobs, installations } of [original, restored]) {
      const lease = jobs.acquire('replacement', 100, 'running')!.lease!;
      assert.equal(lease.attempt, 2);
      assert.equal(jobs.complete(info.leases.running, { late: true }), false);
      assert.equal(jobs.renew(info.leases.running, 100), null);
      assert.equal(jobs.acquire('replacement', 100, 'exhausted'), null);
      assert.equal(jobs.get('exhausted')!.error, 'lease_expired_attempts_exhausted');
      assert.equal(new AdmissionReconciler(jobs, installations).runBatch().released, 1);
      assert.ok(installations.isJobActive('absent'));
      assert.ok(installations.isJobActive('running'));
      assert.ok(jobs.complete(lease, { recovered: true }));
    }
    now = 10000;
    for (const { jobs, installations } of [original, restored]) {
      assert.equal(jobs.cleanup(100).deleted, 6);
      assert.equal(installations.cleanup(100).jobMappings, 7);
      assert.deepEqual(installations.listActiveJobIds(), []);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    for (const resource of resources.reverse()) resource.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
