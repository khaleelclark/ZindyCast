import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallationRepository } from '../packages/installations/src/index.js';
import { JobRepository } from '../packages/jobs/src/index.js';
// Operations JavaScript is run directly by the pinned Node runtime.
import { snapshot } from './sqlite-snapshot.mjs';

test('online WAL snapshots restore ownership, results, revoked auth and recoverable leases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-backup-')); let now = 1000;
  const clock = () => now;
  const installations = new InstallationRepository({ path: join(dir, 'installations.sqlite'), clock });
  const jobs = new JobRepository({ path: join(dir, 'jobs.sqlite'), clock });
  let restoredI: InstallationRepository | undefined, restoredJ: JobRepository | undefined;
  try {
    const person = installations.register(9000), revoked = installations.register(9000);
    installations.revoke(revoked.bearer);
    for (const id of ['done', 'running']) {
      assert.equal(installations.reserveJob(person.bearer, id, 8000), true);
      jobs.enqueue({ id, kind: 'comparison-v1', payload: { fixture: true }, expiresAt: 8000, maxAttempts: 2 });
    }
    const first = jobs.acquire('original', 100, 'comparison-v1')!;
    jobs.complete(first.lease!, { fixtureResult: true });
    assert.ok(jobs.closeTerminalAdmission(first.id)); installations.releaseJob(first.id);
    const running = jobs.acquire('original', 100, 'comparison-v1')!;
    // Connections remain open; snapshots include committed WAL contents.
    for (const name of ['installations', 'jobs']) {
      await snapshot(join(dir, `${name}.sqlite`), join(dir, `${name}.backup`));
      await snapshot(join(dir, `${name}.backup`), join(dir, `${name}.restored`));
      assert.equal(statSync(join(dir, `${name}.backup`)).mode & 0o777, 0o600);
    }
    restoredI = new InstallationRepository({ path: join(dir, 'installations.restored'), clock });
    restoredJ = new JobRepository({ path: join(dir, 'jobs.restored'), clock });
    assert.equal(restoredI.authenticate(person.bearer)?.id, person.id);
    assert.equal(restoredI.authenticate(revoked.bearer), null);
    assert.equal(restoredI.authorizeJob(person.bearer, first.id)?.active, false);
    assert.deepEqual(restoredJ.get(first.id)?.result, { fixtureResult: true });
    now = 1100;
    const recovered = restoredJ.acquire('recovered', 100, 'comparison-v1')!;
    assert.equal(recovered.id, running.id); assert.equal(recovered.attempt, 2);
    assert.equal(restoredJ.complete(running.lease!, { late: true }), false);
    assert.equal(readFileSync(join(dir, 'installations.backup')).includes(Buffer.from(person.bearer)), false);
    now = 10000; assert.equal(restoredI.authenticate(person.bearer), null); assert.equal(restoredJ.get(first.id), null);
    const before = readFileSync(join(dir, 'jobs.backup'));
    await assert.rejects(snapshot(join(dir, 'jobs.sqlite'), join(dir, 'jobs.backup')));
    assert.deepEqual(readFileSync(join(dir, 'jobs.backup')), before);
    await assert.rejects(snapshot(join(dir, 'missing'), join(dir, 'no-create')));
  } finally { restoredI?.close(); restoredJ?.close(); installations.close(); jobs.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('backup refuses leftover destination sidecars without altering them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-backup-sidecar-'));
  const source = join(dir, 'source'), destination = join(dir, 'new');
  const jobs = new JobRepository({ path: source });
  try {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      writeFileSync(destination + suffix, 'retain this existing file');
      await assert.rejects(snapshot(source, destination), /sidecar already exists/);
      assert.equal(existsSync(destination), false);
      assert.equal(readFileSync(destination + suffix, 'utf8'), 'retain this existing file');
      rmSync(destination + suffix);
    }
    await snapshot(source, destination);
  } finally { jobs.close(); rmSync(dir, { recursive: true, force: true }); }
});
