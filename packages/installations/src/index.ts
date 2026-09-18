import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';

export interface Installation { id: string; createdAt: number; expiresAt: number }
export interface Registration extends Installation { bearer: string }
export interface JobOwnership { installationId: string; jobId: string; createdAt: number; expiresAt: number; active: boolean }
export interface InstallationOptions {
  path: string; clock?: () => number; busyTimeoutMs?: number; maxInstallations?: number;
  maxActiveJobs?: number; maxJobsPerInstallation?: number; maxJobMappings?: number; maxDiskBytes?: number;
}
const DAY = 86_400_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TOKEN = new RegExp(`^(${UUID})\\.([A-Za-z0-9_-]{43})$`);
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
function integer(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}
function jobId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) throw new TypeError('Invalid job id');
}
/** Parse only the Authorization header; never query strings, cookies or installation IDs. */
export function parseBearerHeader(header: unknown): string | null {
  if (typeof header !== 'string' || header.length > 100) return null;
  const match = /^Bearer ([^ ]+)$/i.exec(header);
  return match && TOKEN.test(match[1]) ? match[1] : null;
}

/** Server-only repository. IDs are selectors, never credentials. No provider/job execution. */
export class InstallationRepository {
  private readonly db: DatabaseSync;
  private readonly path: string;
  private readonly clock: () => number;
  private readonly limits;
  constructor(options: InstallationOptions) {
    this.path = options.path; this.clock = options.clock ?? Date.now;
    this.limits = {
      maxInstallations: integer(options.maxInstallations ?? 100, 'maxInstallations', 1, 10_000),
      maxActiveJobs: integer(options.maxActiveJobs ?? 3, 'maxActiveJobs', 1, 100),
      maxJobsPerInstallation: integer(options.maxJobsPerInstallation ?? 100, 'maxJobsPerInstallation', 1, 10_000),
      maxJobMappings: integer(options.maxJobMappings ?? 1000, 'maxJobMappings', 1, 100_000),
      maxDiskBytes: integer(options.maxDiskBytes ?? 32 * 1024 ** 2, 'maxDiskBytes', 1024 ** 2),
    };
    this.db = new DatabaseSync(options.path, { timeout: integer(options.busyTimeoutMs ?? 1000, 'busyTimeoutMs', 0, 5000) });
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=1048576;
        CREATE TABLE IF NOT EXISTS zc_install_meta(id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,last_now INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS zc_installations(id TEXT PRIMARY KEY,secret_hash BLOB NOT NULL CHECK(length(secret_hash)=32),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1))) STRICT;
        CREATE TABLE IF NOT EXISTS zc_install_jobs(job_id TEXT PRIMARY KEY,installation_id TEXT NOT NULL REFERENCES zc_installations(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1))) STRICT;
        CREATE INDEX IF NOT EXISTS zc_install_jobs_owner ON zc_install_jobs(installation_id,active,expires_at);
        CREATE INDEX IF NOT EXISTS zc_install_jobs_expiry ON zc_install_jobs(expires_at);`);
      this.transaction(() => {
        const config = JSON.stringify({ schema: 1, ...this.limits });
        this.db.prepare('INSERT OR IGNORE INTO zc_install_meta VALUES(1,?,0)').run(config);
        if (this.db.prepare('SELECT config FROM zc_install_meta WHERE id=1').get()!.config !== config) throw new Error('Installations configuration mismatch');
      });
      const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
      this.db.exec(`PRAGMA max_page_count=${Math.floor(this.limits.maxDiskBytes / pageSize)}`);
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      // SQLite can automatically roll back on storage failure.
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    }
  }
  private now(): number {
    const now = integer(this.clock(), 'clock', 0, 8_640_000_000_000_000 - 366 * DAY);
    if (now < Number(this.db.prepare('SELECT last_now FROM zc_install_meta WHERE id=1').get()!.last_now)) throw new Error('Clock moved backwards');
    return now;
  }
  private mutationTime(): number {
    const now = this.now(); this.db.prepare('UPDATE zc_install_meta SET last_now=? WHERE id=1').run(now); return now;
  }
  private authenticateAt(bearer: string, now: number): Installation | null {
    if (typeof bearer !== 'string' || bearer.length > 100) return null;
    const match = TOKEN.exec(bearer); if (!match) return null;
    const row = this.db.prepare('SELECT * FROM zc_installations WHERE id=?').get(match[1]);
    // Always compare equal-length digests for syntactically valid tokens, including missing IDs.
    const valid = timingSafeEqual(digest(bearer), row ? Buffer.from(row.secret_hash as Uint8Array) : Buffer.alloc(32));
    return valid && row && row.revoked === 0 && Number(row.expires_at) > now
      ? { id: String(row.id), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) } : null;
  }
  register(ttlMs: number): Registration {
    integer(ttlMs, 'ttlMs', 1, 365 * DAY);
    return this.transaction(() => {
      const now = this.mutationTime();
      if (this.usage().installations >= this.limits.maxInstallations) throw new RangeError('Installation capacity reached');
      this.admission();
      const id = randomUUID(), bearer = `${id}.${randomBytes(32).toString('base64url')}`;
      this.db.prepare('INSERT INTO zc_installations(id,secret_hash,created_at,expires_at) VALUES(?,?,?,?)').run(id, digest(bearer), now, now + ttlMs);
      return { id, bearer, createdAt: now, expiresAt: now + ttlMs };
    });
  }
  authenticate(bearer: string): Installation | null { return this.authenticateAt(bearer, this.now()); }
  revoke(bearer: string): boolean {
    return this.transaction(() => {
      const installation = this.authenticateAt(bearer, this.mutationTime()); if (!installation) return false;
      this.db.prepare('UPDATE zc_installations SET revoked=1 WHERE id=?').run(installation.id); return true;
    });
  }
  /** Authenticated deletion; revoked/expired records are removed by cleanup. Does not cancel jobs. */
  delete(bearer: string): boolean {
    return this.transaction(() => {
      const installation = this.authenticateAt(bearer, this.mutationTime()); if (!installation) return false;
      this.db.prepare('DELETE FROM zc_installations WHERE id=?').run(installation.id); return true;
    });
  }
  /** Reserve BEFORE enqueue. False means unauthorized, duplicate ID or exhausted admission. */
  reserveJob(bearer: string, id: string, expiresAt: number): boolean {
    jobId(id); integer(expiresAt, 'expiresAt');
    return this.transaction(() => {
      const now = this.mutationTime(), installation = this.authenticateAt(bearer, now); if (!installation) return false;
      if (expiresAt <= now || expiresAt > now + 30 * DAY || expiresAt > installation.expiresAt) throw new RangeError('Job expiry must fit installation and 30-day limit');
      if (this.db.prepare('SELECT 1 FROM zc_install_jobs WHERE job_id=?').get(id)) return false;
      const row = this.db.prepare('SELECT count(*) AS total,coalesce(sum(CASE WHEN active=1 AND expires_at>? THEN 1 ELSE 0 END),0) AS active FROM zc_install_jobs WHERE installation_id=?').get(now, installation.id)!;
      if (Number(row.active) >= this.limits.maxActiveJobs || Number(row.total) >= this.limits.maxJobsPerInstallation || this.usage().jobMappings >= this.limits.maxJobMappings) return false;
      this.admission();
      this.db.prepare('INSERT INTO zc_install_jobs VALUES(?,?,?,?,1)').run(id, installation.id, now, expiresAt); return true;
    });
  }
  authorizeJob(bearer: string, id: string): JobOwnership | null {
    jobId(id); const now = this.now(), installation = this.authenticateAt(bearer, now); if (!installation) return null;
    const row = this.db.prepare('SELECT * FROM zc_install_jobs WHERE job_id=? AND installation_id=? AND expires_at>?').get(id, installation.id, now);
    return row ? { installationId: installation.id, jobId: id, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at), active: row.active === 1 } : null;
  }
  /** TRUSTED maintenance only, never an HTTP authorization API. Keyset pagination includes
   * revoked owners: only confirmed job terminal state permits early release.
   */
  listActiveJobIds(batchSize = 100, afterId?: string): string[] {
    integer(batchSize, 'batchSize', 1, 1000);
    if (afterId !== undefined) jobId(afterId);
    const now = this.now();
    return this.db.prepare('SELECT job_id FROM zc_install_jobs WHERE active=1 AND expires_at>? AND job_id>? ORDER BY job_id LIMIT ?')
      .all(now, afterId ?? '', batchSize).map(row => String(row.job_id));
  }
  /** TRUSTED server/worker only: call after confirmed terminal state or definite enqueue failure. */
  releaseJob(id: string): boolean {
    jobId(id);
    return this.transaction(() => {
      this.mutationTime();
      return Number(this.db.prepare('UPDATE zc_install_jobs SET active=0 WHERE job_id=? AND active=1').run(id).changes) === 1;
    });
  }
  usage(): { installations: number; jobMappings: number } {
    return { installations: Number(this.db.prepare('SELECT count(*) AS n FROM zc_installations').get()!.n), jobMappings: Number(this.db.prepare('SELECT count(*) AS n FROM zc_install_jobs').get()!.n) };
  }
  private admission(): void {
    if (this.diskUsage().totalBytes >= this.limits.maxDiskBytes) throw new RangeError('Installation disk budget reached');
  }
  diskUsage(): { databaseBytes: number; walBytes: number; shmBytes: number; totalBytes: number } {
    const size = (suffix: string): number => {
      if (this.path === ':memory:') return 0;
      try { return statSync(this.path + suffix).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    };
    const databaseBytes = size(''), walBytes = size('-wal'), shmBytes = size('-shm');
    return { databaseBytes, walBytes, shmBytes, totalBytes: databaseBytes + walBytes + shmBytes };
  }
  /** At most batchSize mappings plus batchSize installations (installation delete cascades bounded owned rows). */
  cleanup(batchSize = 100): { jobMappings: number; installations: number; checkpointBusy: boolean } {
    integer(batchSize, 'batchSize', 1, 1000);
    const result = this.transaction(() => {
      const now = this.mutationTime();
      const jobMappings = Number(this.db.prepare('DELETE FROM zc_install_jobs WHERE job_id IN(SELECT job_id FROM zc_install_jobs WHERE expires_at<=? ORDER BY expires_at LIMIT ?)').run(now, batchSize).changes);
      const installations = Number(this.db.prepare('DELETE FROM zc_installations WHERE id IN(SELECT id FROM zc_installations WHERE expires_at<=? OR revoked=1 ORDER BY expires_at LIMIT ?)').run(now, batchSize).changes);
      return { jobMappings, installations };
    });
    return { ...result, checkpointBusy: Number(this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!.busy) !== 0 };
  }
  /** Trusted worker check; never authorizes an HTTP caller by job ID alone. */
  isJobActive(id: string): boolean {
    jobId(id); const now=this.now();
    return !!this.db.prepare('SELECT 1 FROM zc_install_jobs j JOIN zc_installations i ON i.id=j.installation_id WHERE j.job_id=? AND j.active=1 AND j.expires_at>? AND i.expires_at>? AND i.revoked=0').get(id,now,now);
  }
  /** Trusted worker liveness check, never HTTP authorization by ID. */
  isActive(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM zc_installations WHERE id=? AND expires_at>? AND revoked=0').get(id, this.now());
  }
  close(): void { this.db.close(); }
}
