// Test-only process: all database paths are supplied by the isolated parent fixture.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JobRepository } from '../../packages/jobs/src/index.js';
import { InstallationRepository } from '../../packages/installations/src/index.js';
import { SharedStorage } from '../../packages/storage/src/index.js';
const dir = process.argv[2];
if (!dir || !process.send) throw new Error('Isolated IPC test harness required');
const clock = () => 1000;
const jobs = new JobRepository({ path: join(dir, 'jobs.sqlite'), clock });
const installations = new InstallationRepository({ path: join(dir, 'installations.sqlite'), clock, maxActiveJobs: 10 });
const storage = new SharedStorage({ path: join(dir, 'coordination.sqlite'), clock, providers: { test: { minute: 2, hour: 2, day: 2, month: 2 } } });
const owner = installations.register(20000), revoked = installations.register(20000);
const leases = {} as Record<string, unknown>;
for (const id of ['done', 'fenced', 'cancelled', 'running', 'exhausted', 'revoked']) {
  if (!installations.reserveJob(id === 'revoked' ? revoked.bearer : owner.bearer, id, 10000)) throw new Error('fixture reservation failed');
  jobs.enqueue({ id, kind: id, payload: { fixture: true }, expiresAt: 10000, maxAttempts: id === 'exhausted' ? 1 : 2 });
  const lease = jobs.acquire('killed-worker', 100, id)!.lease!;
  leases[id] = lease;
  if (id === 'done') jobs.complete(lease, { committed: true });
  if (id === 'fenced') { jobs.fail(lease, 'test_failure'); jobs.closeTerminalAdmission(id); }
  if (id === 'cancelled') jobs.cancel(id);
}
installations.reserveJob(owner.bearer, 'absent', 10000);
installations.revoke(revoked.bearer);
storage.reserveQuota('test', 2);
storage.set('fixture', { committed: true }, { retrievedAt: 1000, expiresAt: 9000, staleUntil: 9000 });
// Leave an actual uncommitted writer transaction open at SIGKILL.
const writer = new DatabaseSync(join(dir, 'jobs.sqlite'));
writer.exec(`BEGIN IMMEDIATE; UPDATE zc_jobs SET result='{"uncommitted":true}' WHERE id='done';`);
process.send({ ready: true, owner, revoked, leases });
setInterval(() => {}, 1000);
