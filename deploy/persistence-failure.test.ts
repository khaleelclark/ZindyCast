import test from 'node:test';
import {SharedStorage} from '../packages/storage/src/index.js';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JobRepository } from '../packages/jobs/src/index.js';
import { InstallationRepository } from '../packages/installations/src/index.js';

for (const kind of ['jobs', 'installations', 'storage'] as const) {
  test(`${kind}: real SQLite page exhaustion preserves SQLITE_FULL, rolls back, and permits recovery`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'zc-full-')), path = join(dir, 'test.sqlite');
    const options = { path, clock: () => 1000, maxDiskBytes: 1024 ** 2 };
    const repo = kind === 'jobs' ? new JobRepository(options) : kind === 'storage' ? new SharedStorage(options) : new InstallationRepository(options);
    const probe = new DatabaseSync(path);
    try {
      // The trigger runs on the repository connection, whose max_page_count is 1 MiB.
      // No host disk is filled: allocation is bounded by SQLite and rolled back.
      probe.exec(`CREATE TABLE test_full_probe(value BLOB); CREATE TRIGGER test_full BEFORE INSERT ON ${kind === 'jobs' ? 'zc_jobs' : kind === 'storage' ? 'zc_cache' : 'zc_installations'} BEGIN INSERT INTO test_full_probe VALUES(zeroblob(2097152)); END;`);
      const write = () => repo instanceof JobRepository
        ? repo.enqueue({ id: 'one', kind: 'test', payload: null, expiresAt: 2000, maxAttempts: 1 })
        : repo instanceof SharedStorage ? repo.set('one',null,{retrievedAt:1000,expiresAt:2000,staleUntil:2000}) : repo.register(1000);
      assert.throws(write, (error: unknown) => {
        assert.equal((error as { errcode: number }).errcode, 13);
        assert.match((error as Error).message, /full/i);
        return true;
      });
      assert.equal(probe.prepare('SELECT count(*) AS n FROM test_full_probe').get()!.n, 0);
      assert.equal(probe.prepare(`SELECT count(*) AS n FROM ${kind === 'jobs' ? 'zc_jobs' : kind === 'storage' ? 'zc_cache' : 'zc_installations'}`).get()!.n, 0);
      probe.exec('DROP TRIGGER test_full');
      assert.ok(write());
      assert.equal(probe.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    } finally { probe.close(); repo.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}
