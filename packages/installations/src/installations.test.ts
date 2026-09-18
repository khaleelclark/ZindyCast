import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InstallationRepository, parseBearerHeader, type InstallationOptions } from './index.js';

function fixture(options: Partial<InstallationOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'zc-install-')), path = join(dir, 'install.sqlite');
  let time = 1000;
  const config = { path, clock: () => time, ...options };
  const a = new InstallationRepository(config), b = new InstallationRepository(config);
  return { a, b, path, config, at: (n: number) => { time = n; }, close: () => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('registration authenticates with digest only; malformed, wrong, unknown and ID-only credentials denied', () => {
  const f = fixture();
  try {
    const r = f.a.register(10000), other = f.b.register(10000);
    assert.deepEqual(f.b.authenticate(r.bearer), { id: r.id, createdAt: 1000, expiresAt: 11000 });
    for (const token of [r.id, '', 'x'.repeat(1000), `${r.id}.${other.bearer.split('.')[1]}`, `00000000-0000-4000-8000-000000000000.${r.bearer.split('.')[1]}`]) assert.equal(f.a.authenticate(token), null);
    assert.equal(parseBearerHeader(`Bearer ${r.bearer}`), r.bearer);
    for (const header of [r.bearer, [`Bearer ${r.bearer}`], `Bearer  ${r.bearer}`, `Bearer ${r.bearer}\n`]) assert.equal(parseBearerHeader(header), null);
    const db = new DatabaseSync(f.path);
    const row = db.prepare('SELECT * FROM zc_installations WHERE id=?').get(r.id)!;
    assert.equal((row.secret_hash as Uint8Array).length, 32); assert.equal(Object.keys(row).some(k => k === 'bearer' || k === 'secret'), false); db.close();
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(f.path + suffix)) {
      const bytes = readFileSync(f.path + suffix);
      assert.equal(bytes.includes(Buffer.from(r.bearer)), false);
      assert.equal(bytes.includes(Buffer.from(r.bearer.split('.')[1])), false);
    }
  } finally { f.close(); }
});
test('two connections enforce ownership, active admission and terminal release without changing read ownership', () => {
  const f = fixture({ maxActiveJobs: 1 });
  try {
    const a = f.a.register(10000), b = f.b.register(10000);
    assert.equal(f.a.reserveJob(a.bearer, 'first', 10000), true);
    assert.equal(f.b.reserveJob(a.bearer, 'second', 10000), false);
    assert.equal(f.b.reserveJob(b.bearer, 'first', 10000), false);
    assert.equal(f.b.authorizeJob(b.bearer, 'first'), null);
    assert.equal(f.b.authorizeJob(a.id, 'first'), null);
    assert.equal(f.b.authorizeJob(a.bearer, 'first')?.active, true);
    assert.equal(f.b.releaseJob('first'), true); assert.equal(f.a.releaseJob('first'), false);
    assert.equal(f.a.authorizeJob(a.bearer, 'first')?.active, false);
    assert.equal(f.a.reserveJob(a.bearer, 'first', 10000), false);
    assert.equal(f.b.reserveJob(a.bearer, 'second', 10000), true);
  } finally { f.close(); }
});
test('revocation and deletion immediately fence other connections and cleanup removes revoked records', () => {
  const f = fixture();
  try {
    const r = f.a.register(10000); f.a.reserveJob(r.bearer, 'job', 9000);
    assert.equal(f.b.revoke(r.id), false); assert.equal(f.b.revoke(r.bearer), true);
    assert.equal(f.a.authenticate(r.bearer), null); assert.equal(f.a.authorizeJob(r.bearer, 'job'), null);
    assert.equal(f.a.reserveJob(r.bearer, 'other', 9000), false);
    assert.equal(f.a.cleanup().installations, 1); assert.deepEqual(f.b.usage(), { installations: 0, jobMappings: 0 });
    const d = f.a.register(10000); f.a.reserveJob(d.bearer, 'delete-job', 9000);
    assert.equal(f.b.delete(d.bearer), true); assert.equal(f.a.authenticate(d.bearer), null); assert.equal(f.a.usage().jobMappings, 0);
  } finally { f.close(); }
});
test('expiry is exact across restart and orphan reservation remains charged until expiry', () => {
  const f = fixture({ maxActiveJobs: 1 });
  try {
    const r = f.a.register(10000); f.a.reserveJob(r.bearer, 'orphan', 2000);
    const reopened = new InstallationRepository(f.config);
    assert.equal(reopened.reserveJob(r.bearer, 'blocked', 3000), false); reopened.close();
    f.at(2000); assert.equal(f.b.authorizeJob(r.bearer, 'orphan'), null);
    assert.equal(f.b.reserveJob(r.bearer, 'next', 3000), true);
    f.at(11000); assert.equal(f.a.authenticate(r.bearer), null);
    assert.equal(f.a.cleanup().installations, 1); assert.equal(f.b.usage().jobMappings, 0);
  } finally { f.close(); }
});
test('installation and mapping count limits persist across connections; release does not bypass retention cap', () => {
  const f = fixture({ maxInstallations: 2, maxJobsPerInstallation: 1, maxJobMappings: 1 });
  try {
    const r = f.a.register(10000), s = f.b.register(10000);
    assert.throws(() => f.a.register(10000), /capacity/);
    assert.equal(f.a.reserveJob(r.bearer, 'one', 2000), true); f.a.releaseJob('one');
    assert.equal(f.b.reserveJob(r.bearer, 'two', 3000), false);
    assert.equal(f.b.reserveJob(s.bearer, 'three', 3000), false);
    f.at(2000); assert.equal(f.a.cleanup(1).jobMappings, 1);
    assert.equal(f.b.reserveJob(s.bearer, 'three', 3000), true);
  } finally { f.close(); }
});
test('bad input, different persistent config, rollback and lock contention fail closed', () => {
  const f = fixture({ busyTimeoutMs: 10 });
  try {
    const r = f.a.register(10000);
    assert.throws(() => f.a.register(NaN)); assert.throws(() => f.a.register(366 * 86400000));
    assert.throws(() => f.a.reserveJob(r.bearer, '../bad', 2000));
    assert.throws(() => f.a.reserveJob(r.bearer, 'job', 11001));
    assert.throws(() => new InstallationRepository({ ...f.config, maxActiveJobs: 2 }), /configuration/);
    f.at(999); assert.throws(() => f.a.authenticate(r.bearer), /backwards/); f.at(1000);
    const db = new DatabaseSync(f.path); db.exec('BEGIN IMMEDIATE');
    try { assert.throws(() => f.b.reserveJob(r.bearer, 'locked', 2000), /locked/); } finally { db.exec('ROLLBACK'); db.close(); }
    assert.equal(f.a.authorizeJob(r.bearer, 'locked'), null);
    assert.ok(f.a.diskUsage().totalBytes > 0); assert.equal(f.a.cleanup().checkpointBusy, false);
  } finally { f.close(); }
});
