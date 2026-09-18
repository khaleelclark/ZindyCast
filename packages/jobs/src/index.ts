import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface JobLease { id: string; owner: string; token: string; expiresAt: number; attempt: number }
export interface Job {
  id: string; kind: string; payload: JsonValue; result: JsonValue; state: JobState;
  createdAt: number; updatedAt: number; expiresAt: number; availableAt: number;
  attempt: number; maxAttempts: number; progress: number; error: string | null; lease: JobLease | null;
}
export interface JobOptions {
  path: string; clock?: () => number; busyTimeoutMs?: number;
  maxJobs?: number; maxJsonBytes?: number; maxTotalJsonBytes?: number; maxDiskBytes?: number;
}
export interface EnqueueJob { id?: string; kind: string; payload: JsonValue; expiresAt: number; maxAttempts: number; availableAt?: number }
const DAY = 86_400_000;
function integer(n: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`Invalid ${name}`);
  return n;
}
function identifier(s: string): void {
  if (typeof s !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(s)) throw new TypeError('Invalid job id, kind or owner');
}
// Reject lossy JSON (NaN, undefined, Date, sparse arrays, accessors) before serializing.
function jsonText(value: JsonValue, maxBytes: number): string {
  let nodes = 0, lowerBoundBytes = 0;
  const visit = (v: JsonValue, depth: number): void => {
    if (++nodes > 100_000 || depth > 32) throw new RangeError('JSON structure limit');
    if (v === null || typeof v === 'boolean') { lowerBoundBytes += 4; return; }
    if (typeof v === 'string') { lowerBoundBytes += Buffer.byteLength(v) + 2; if (lowerBoundBytes > maxBytes) throw new RangeError('JSON byte limit'); return; }
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) throw new TypeError('Expected plain finite JSON');
    if (Array.isArray(v)) {
      if (v.length > 100_000 || Reflect.ownKeys(v).length !== v.length + 1) throw new TypeError('Invalid JSON array');
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !('value' in d)) throw new TypeError('Invalid JSON property');
        visit(d.value, depth + 1);
      }
    } else {
      for (const k of Reflect.ownKeys(v)) {
        const d = Object.getOwnPropertyDescriptor(v, k)!;
        if (typeof k !== 'string' || !d.enumerable || !('value' in d)) throw new TypeError('Invalid JSON property');
        lowerBoundBytes += Buffer.byteLength(k) + 3;
        if (lowerBoundBytes > maxBytes) throw new RangeError('JSON byte limit');
        visit(d.value, depth + 1);
      }
    }
  };
  visit(value, 0);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) throw new RangeError('JSON byte limit');
  return text;
}

/** Server-only local SQLite repository. UTC milliseconds; no network work or access control. */
export class JobRepository {
  private readonly db: DatabaseSync;
  private readonly clock: () => number;
  private readonly path: string;
  private readonly limits;
  constructor(options: JobOptions) {
    this.path = options.path; this.clock = options.clock ?? Date.now;
    this.limits = {
      maxJobs: integer(options.maxJobs ?? 1000, 'maxJobs', 1, 10_000),
      maxJsonBytes: integer(options.maxJsonBytes ?? 2 * 1024 ** 2, 'maxJsonBytes', 4, 16 * 1024 ** 2),
      maxTotalJsonBytes: integer(options.maxTotalJsonBytes ?? 32 * 1024 ** 2, 'maxTotalJsonBytes', 4, 256 * 1024 ** 2),
      maxDiskBytes: integer(options.maxDiskBytes ?? 128 * 1024 ** 2, 'maxDiskBytes', 1024 ** 2),
    };
    this.db = new DatabaseSync(options.path, { timeout: integer(options.busyTimeoutMs ?? 1000, 'busyTimeoutMs', 0, 5000) });
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=1048576;
        CREATE TABLE IF NOT EXISTS zc_jobs_meta(id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, last_now INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS zc_jobs(
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL DEFAULT 'null',
          state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed','cancelled')),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL, progress REAL NOT NULL DEFAULT 0, error TEXT,
          owner TEXT, token TEXT, lease_until INTEGER, bytes INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS zc_jobs_admission_closed(id TEXT PRIMARY KEY REFERENCES zc_jobs(id) ON DELETE CASCADE) STRICT;
        CREATE INDEX IF NOT EXISTS zc_jobs_queue ON zc_jobs(state, available_at, created_at);
        CREATE INDEX IF NOT EXISTS zc_jobs_expiry ON zc_jobs(expires_at);`);
      const config = JSON.stringify({ schema: 1, ...this.limits });
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO zc_jobs_meta VALUES(1,?,0)').run(config);
        if (this.db.prepare('SELECT config FROM zc_jobs_meta WHERE id=1').get()!.config !== config) throw new Error('Jobs configuration mismatch');
      });
      const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
      this.db.exec(`PRAGMA max_page_count=${Math.floor(this.limits.maxDiskBytes / pageSize)}`);
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      // SQLITE_FULL/IOERR can already have rolled back the transaction.
      // Preserve the original failure even when no transaction remains.
      try { this.db.exec('ROLLBACK'); } catch { /* original error is authoritative */ }
      throw error;
    }
  }
  private now(): number {
    const now = integer(this.clock(), 'clock', 0, 8_640_000_000_000_000 - 31 * DAY);
    if (now < Number(this.db.prepare('SELECT last_now FROM zc_jobs_meta WHERE id=1').get()!.last_now)) throw new Error('Clock moved backwards');
    return now;
  }
  private mutationTime(): number {
    const now = this.now(); this.db.prepare('UPDATE zc_jobs_meta SET last_now=? WHERE id=1').run(now); return now;
  }
  private decode(row: Record<string, unknown>): Job {
    return { id: String(row.id), kind: String(row.kind), payload: JSON.parse(String(row.payload)), result: JSON.parse(String(row.result)),
      state: row.state as JobState, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), expiresAt: Number(row.expires_at),
      availableAt: Number(row.available_at), attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts), progress: Number(row.progress),
      error: row.error === null ? null : String(row.error), lease: row.token === null ? null : { id: String(row.id), owner: String(row.owner), token: String(row.token), expiresAt: Number(row.lease_until), attempt: Number(row.attempt) } };
  }
  private row(id: string) { return this.db.prepare('SELECT * FROM zc_jobs WHERE id=?').get(id); }
  private fenced(lease: JobLease, now: number): boolean {
    identifier(lease.id); identifier(lease.owner); identifier(lease.token); integer(lease.attempt, 'attempt', 1, 10);
    return !!this.db.prepare(`SELECT 1 FROM zc_jobs WHERE id=? AND state='running' AND owner=? AND token=? AND attempt=? AND lease_until>? AND expires_at>?`)
      .get(lease.id, lease.owner, lease.token, lease.attempt, now, now);
  }
  private admission(extraBytes: number): void {
    if (this.usage().jsonBytes + extraBytes > this.limits.maxTotalJsonBytes) throw new RangeError('Jobs total JSON budget reached');
    if (this.diskUsage().totalBytes >= this.limits.maxDiskBytes) throw new RangeError('Jobs disk budget reached');
  }
  enqueue(input: EnqueueJob): Job {
    const id = input.id ?? randomUUID(); identifier(id); identifier(input.kind);
    integer(input.maxAttempts, 'maxAttempts', 1, 10); integer(input.expiresAt, 'expiresAt');
    const payload = jsonText(input.payload, this.limits.maxJsonBytes), bytes = Buffer.byteLength(payload) + 4;
    return this.transaction(() => {
      const now = this.mutationTime(), availableAt = input.availableAt ?? now;
      integer(availableAt, 'availableAt', now);
      if (input.expiresAt <= availableAt || input.expiresAt > now + 30 * DAY) throw new RangeError('Job must expire after availability and within 30 days');
      if (this.usage().jobs >= this.limits.maxJobs) throw new RangeError('Job capacity reached; cleanup required');
      this.admission(bytes);
      this.db.prepare(`INSERT INTO zc_jobs(id,kind,payload,state,created_at,updated_at,expires_at,available_at,max_attempts,bytes) VALUES(?,?,?,'queued',?,?,?,?,?,?)`)
        .run(id, input.kind, payload, now, now, input.expiresAt, availableAt, input.maxAttempts, bytes);
      return this.decode(this.row(id)!);
    });
  }
  get(id: string): Job | null {
    identifier(id); const now = this.now(), row = this.row(id);
    return row && Number(row.expires_at) > now ? this.decode(row) : null;
  }
  /** A recovered expired lease consumes a new attempt; workers must tolerate duplicate execution. */
  acquire(owner: string, ttlMs: number, kind: string): Job | null {
    identifier(owner); identifier(kind); integer(ttlMs, 'ttlMs', 1, DAY);
    return this.transaction(() => {
      const now = this.mutationTime();
      this.db.prepare(`UPDATE zc_jobs SET state='failed', error='lease_expired_attempts_exhausted', owner=NULL, token=NULL, lease_until=NULL, updated_at=?
        WHERE kind=? AND state='running' AND lease_until<=? AND attempt>=max_attempts AND expires_at>?`).run(now, kind, now, now);
      const row = this.db.prepare(`SELECT id,expires_at FROM zc_jobs WHERE kind=? AND expires_at>? AND attempt<max_attempts AND
        ((state='queued' AND available_at<=?) OR (state='running' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1`).get(kind, now, now, now);
      if (!row) return null;
      this.db.prepare(`UPDATE zc_jobs SET state='running', attempt=attempt+1, progress=0, error=NULL, owner=?,token=?,lease_until=?,updated_at=? WHERE id=?`)
        .run(owner, randomUUID(), Math.min(now + ttlMs, Number(row.expires_at)), now, row.id);
      return this.decode(this.row(String(row.id))!);
    });
  }
  /** Progress is a finite fraction [0,1], monotonic within the current attempt. */
  progress(lease: JobLease, progress: number): boolean {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new RangeError('Invalid progress');
    return this.transaction(() => {
      const now = this.mutationTime(); if (!this.fenced(lease, now)) return false;
      return Number(this.db.prepare('UPDATE zc_jobs SET progress=?,updated_at=? WHERE id=? AND progress<=?').run(progress, now, lease.id, progress).changes) === 1;
    });
  }
  renew(lease: JobLease, ttlMs: number): JobLease | null {
    integer(ttlMs, 'ttlMs', 1, DAY);
    return this.transaction(() => {
      const now = this.mutationTime(); if (!this.fenced(lease, now)) return null;
      const row = this.row(lease.id)!;
      const expiresAt = Math.min(Number(row.expires_at), Math.max(Number(row.lease_until), now + ttlMs));
      this.db.prepare('UPDATE zc_jobs SET lease_until=?, updated_at=? WHERE id=?').run(expiresAt, now, lease.id);
      return { ...lease, expiresAt };
    });
  }
  complete(lease: JobLease, result: JsonValue): boolean {
    const json = jsonText(result, this.limits.maxJsonBytes);
    return this.transaction(() => {
      const now = this.mutationTime(); if (!this.fenced(lease, now)) return false;
      const row = this.row(lease.id)!, bytes = Buffer.byteLength(String(row.payload)) + Buffer.byteLength(json);
      this.admission(bytes - Number(row.bytes));
      this.db.prepare(`UPDATE zc_jobs SET state='completed',result=?,bytes=?,progress=1,error=NULL,owner=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE id=?`).run(json, bytes, now, lease.id);
      return true;
    });
  }
  fail(lease: JobLease, errorCode: string): boolean {
    identifier(errorCode);
    return this.transaction(() => {
      const now = this.mutationTime(); if (!this.fenced(lease, now)) return false;
      this.db.prepare(`UPDATE zc_jobs SET state='failed',error=?,owner=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE id=?`).run(errorCode, now, lease.id);
      return true;
    });
  }
  /** Explicit retry only for failed jobs with attempts left; no implicit provider retry. */
  retry(id: string, delayMs = 0): boolean {
    identifier(id); integer(delayMs, 'delayMs', 0, DAY);
    return this.transaction(() => {
      const now = this.mutationTime();
      return Number(this.db.prepare(`UPDATE zc_jobs SET state='queued',available_at=?,updated_at=? WHERE id=? AND state='failed' AND attempt<max_attempts AND expires_at>? AND NOT EXISTS(SELECT 1 FROM zc_jobs_admission_closed c WHERE c.id=zc_jobs.id)`)
        .run(now + delayMs, now, id, now + delayMs).changes) === 1;
    });
  }
  /** TRUSTED: durably forbid retry before cross-database admission release. No payload read.
   * True is idempotent for a retained terminal job; absent/expired/active jobs return false.
   * Commit this fence BEFORE releasing admission; a crash may retain capacity, never free it early.
   */
  closeTerminalAdmission(id: string): boolean {
    identifier(id);
    return this.transaction(() => {
      const now = this.mutationTime();
      const row = this.db.prepare("SELECT 1 FROM zc_jobs WHERE id=? AND expires_at>? AND state IN ('completed','failed','cancelled')").get(id, now);
      if (!row) return false;
      this.db.prepare('INSERT OR IGNORE INTO zc_jobs_admission_closed(id) VALUES(?)').run(id);
      return true;
    });
  }
  /** Repository cancellation fences writes; caller must separately abort in-flight work. */
  cancel(id: string): boolean {
    identifier(id);
    return this.transaction(() => {
      const now = this.mutationTime();
      return Number(this.db.prepare(`UPDATE zc_jobs SET state='cancelled',owner=NULL,token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state IN ('queued','running') AND expires_at>?`).run(now, id, now).changes) === 1;
    });
  }
  usage(): { jobs: number; jsonBytes: number } {
    const row = this.db.prepare('SELECT count(*) AS jobs,coalesce(sum(bytes),0) AS bytes FROM zc_jobs').get()!;
    return { jobs: Number(row.jobs), jsonBytes: Number(row.bytes) };
  }
  diskUsage(): { databaseBytes: number; walBytes: number; shmBytes: number; totalBytes: number } {
    const size = (suffix: string): number => {
      if (this.path === ':memory:') return 0;
      try { return statSync(this.path + suffix).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    };
    const databaseBytes = size(''), walBytes = size('-wal'), shmBytes = size('-shm');
    return { databaseBytes, walBytes, shmBytes, totalBytes: databaseBytes + walBytes + shmBytes };
  }
  cleanup(batchSize = 100): { deleted: number; checkpointBusy: boolean } {
    integer(batchSize, 'batchSize', 1, 1000);
    const deleted = this.transaction(() => {
      const now = this.mutationTime();
      return Number(this.db.prepare('DELETE FROM zc_jobs WHERE id IN (SELECT id FROM zc_jobs WHERE expires_at<=? ORDER BY expires_at,id LIMIT ?)').run(now, batchSize).changes);
    });
    const checkpoint = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!;
    return { deleted, checkpointBusy: Number(checkpoint.busy) !== 0 };
  }
  close(): void { this.db.close(); }
}
