import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface CacheTimes { retrievedAt: number; expiresAt: number; staleUntil: number }
export interface CacheRecord extends CacheTimes { value: JsonValue; freshness: 'fresh' | 'stale' }
export interface Lease { key: string; owner: string; token: string; expiresAt: number }
export interface QuotaLimits { minute: number; hour: number; day: number; month: number }
export const OPEN_METEO_LIMITS: Readonly<QuotaLimits> = Object.freeze({ minute: 600, hour: 5000, day: 10000, month: 300000 });
export interface StorageOptions {
  path: string;
  clock?: () => number;
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  maxLeases?: number;
  maxQuotaEvents?: number;
  maxDiskBytes?: number;
  busyTimeoutMs?: number;
  providers?: Record<string, QuotaLimits>;
}
export type QuotaResult = { allowed: true; chargedWeight: number } |
  { allowed: false; reason: 'quota' | 'capacity'; retryAt: number | null; windows: (keyof QuotaLimits)[] };
const DAY = 86_400_000;
const WINDOWS = { minute: 60_000, hour: 3_600_000, day: DAY, month: 31 * DAY } as const;
const names = Object.keys(WINDOWS) as (keyof QuotaLimits)[];
function integer(value: number, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${name}`);
  return value;
}
function key(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 2048) throw new TypeError('Key/owner must be 1–2048 UTF-8 bytes');
}
function validateJson(value: JsonValue, depth = 0): void {
  if (depth > 64) throw new TypeError('JSON nesting exceeds 64');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateJson(item, depth + 1); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) validateJson(item, depth + 1);
    return;
  }
  throw new TypeError('Value must be plain finite JSON');
}

/** Synchronous, local-file coordination. All timestamps are Unix milliseconds.
 * See docs/verification/storage/README.md for integration and disk limits. */
export class SharedStorage {
  private readonly db: DatabaseSync;
  private readonly clock: () => number;
  private readonly path: string;
  private readonly limits;
  private readonly providers: Record<string, QuotaLimits>;

  constructor(options: StorageOptions) {
    this.clock = options.clock ?? Date.now;
    this.path = options.path;
    this.limits = {
      maxEntries: integer(options.maxEntries ?? 1000, 'maxEntries', 1, 100_000),
      maxBytes: integer(options.maxBytes ?? 32 * 1024 ** 2, 'maxBytes', 1),
      maxEntryBytes: integer(options.maxEntryBytes ?? 2 * 1024 ** 2, 'maxEntryBytes', 1),
      maxLeases: integer(options.maxLeases ?? 1000, 'maxLeases', 1, 100_000),
      maxQuotaEvents: integer(options.maxQuotaEvents ?? 50_000, 'maxQuotaEvents', 1, 500_000),
      maxDiskBytes: integer(options.maxDiskBytes ?? 128 * 1024 ** 2, 'maxDiskBytes', 1024 ** 2),
    };
    this.providers = JSON.parse(JSON.stringify(options.providers ?? { 'open-meteo': OPEN_METEO_LIMITS }));
    for (const [provider, limits] of Object.entries(this.providers)) {
      key(provider);
      for (const name of names) integer(limits[name], `${provider}.${name}`, 1, 1_000_000_000);
    }
    if (Object.keys(this.providers).length > 32) throw new RangeError('At most 32 providers');
    const timeout = integer(options.busyTimeoutMs ?? 1000, 'busyTimeoutMs', 0, 5000);
    this.db = new DatabaseSync(options.path, { timeout });
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=1048576;`);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS zc_storage_meta (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL, last_now INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS zc_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, bytes INTEGER NOT NULL,
          retrieved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, stale_until INTEGER NOT NULL, written_at INTEGER NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS zc_cache_age ON zc_cache(written_at, key);
        CREATE INDEX IF NOT EXISTS zc_cache_expiry ON zc_cache(stale_until);
        CREATE TABLE IF NOT EXISTS zc_leases (key TEXT PRIMARY KEY, owner TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS zc_lease_expiry ON zc_leases(expires_at);
        CREATE TABLE IF NOT EXISTS zc_quota (provider TEXT NOT NULL, at INTEGER NOT NULL, units INTEGER NOT NULL, PRIMARY KEY(provider, at)) STRICT;
        CREATE INDEX IF NOT EXISTS zc_quota_age ON zc_quota(at);
        CREATE TABLE IF NOT EXISTS zc_mapbox_budget (day INTEGER PRIMARY KEY, used INTEGER NOT NULL CHECK(used BETWEEN 1 AND 190000)) STRICT;
      `);
      const config = JSON.stringify({ schema: 1, ...this.limits, providers: Object.fromEntries(Object.entries(this.providers).sort().map(([p, q]) => [p, names.map(n => q[n])])) });
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO zc_storage_meta VALUES (1, ?, 0)').run(config);
        if (this.db.prepare('SELECT config FROM zc_storage_meta WHERE id=1').get()!.config !== config) throw new Error('Shared storage configuration mismatch');
      });
      const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
      this.db.exec(`PRAGMA max_page_count=${Math.floor(this.limits.maxDiskBytes / pageSize)}`);
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* SQLite may already have rolled back; preserve original failure. */ } throw error; }
  }
  private now(): number { return integer(this.clock(), 'clock', 0, 8_640_000_000_000_000 - 32 * DAY); }
  private mutationTime(): number {
    const now = this.now();
    const last = Number(this.db.prepare('SELECT last_now FROM zc_storage_meta WHERE id=1').get()!.last_now);
    if (now < last) throw new Error('Clock moved backwards; mutation refused');
    this.db.prepare('UPDATE zc_storage_meta SET last_now=? WHERE id=1').run(now);
    return now;
  }
  private admission(): void {
    if (this.diskUsage().totalBytes >= this.limits.maxDiskBytes) throw new Error('Storage disk budget reached; cleanup required');
  }
  get(keyName: string): CacheRecord | null {
    key(keyName);
    const row = this.db.prepare('SELECT * FROM zc_cache WHERE key=?').get(keyName);
    const now = this.now();
    if (!row || now < Number(row.retrieved_at) || now >= Number(row.stale_until)) return null;
    return { value: JSON.parse(String(row.value)), retrievedAt: Number(row.retrieved_at), expiresAt: Number(row.expires_at),
      staleUntil: Number(row.stale_until), freshness: now < Number(row.expires_at) ? 'fresh' : 'stale' };
  }
  /** Optional lease fences late refresh writes after expiry or takeover. False means lost lease or older retrieval. */
  set(keyName: string, value: JsonValue, times: CacheTimes, lease?: Lease): boolean {
    key(keyName); validateJson(value);
    const json = JSON.stringify(value);
    const bytes = Buffer.byteLength(json) + Buffer.byteLength(keyName);
    if (bytes > Math.min(this.limits.maxEntryBytes, this.limits.maxBytes)) throw new RangeError('Cache entry exceeds byte budget');
    for (const [name, time] of Object.entries(times)) integer(time, name);
    if (!(times.retrievedAt <= times.expiresAt && times.expiresAt <= times.staleUntil)) throw new RangeError('Invalid cache deadlines');
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      if (times.retrievedAt > now || times.staleUntil <= now) throw new RangeError('Cache retrieval is future or already unusable');
      if (lease && (lease.key !== keyName || !this.db.prepare('SELECT 1 FROM zc_leases WHERE key=? AND owner=? AND token=? AND expires_at>?').get(keyName, lease.owner, lease.token, now))) return false;
      const previous = this.db.prepare('SELECT retrieved_at FROM zc_cache WHERE key=?').get(keyName);
      if (previous && Number(previous.retrieved_at) > times.retrievedAt) return false;
      this.db.prepare(`INSERT INTO zc_cache VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, bytes=excluded.bytes, retrieved_at=excluded.retrieved_at,
        expires_at=excluded.expires_at, stale_until=excluded.stale_until, written_at=excluded.written_at`).run(keyName, json, bytes, times.retrievedAt, times.expiresAt, times.staleUntil, now);
      let { entries, bytes: total } = this.cacheUsage();
      const oldest = this.db.prepare('SELECT key, bytes FROM zc_cache WHERE key<>? ORDER BY written_at, key').all(keyName);
      for (const row of oldest) {
        if (entries <= this.limits.maxEntries && total <= this.limits.maxBytes) break;
        this.db.prepare('DELETE FROM zc_cache WHERE key=?').run(row.key); entries--; total -= Number(row.bytes);
      }
      return true;
    });
  }
  acquireLease(keyName: string, owner: string, ttlMs: number): Lease | null {
    key(keyName); key(owner); integer(ttlMs, 'ttlMs', 1, DAY);
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      this.db.prepare('DELETE FROM zc_leases WHERE key IN (SELECT key FROM zc_leases WHERE expires_at<=? LIMIT 1000)').run(now);
      const current = this.db.prepare('SELECT expires_at FROM zc_leases WHERE key=?').get(keyName);
      if (current && Number(current.expires_at) > now) return null;
      if (!current && Number(this.db.prepare('SELECT count(*) AS n FROM zc_leases').get()!.n) >= this.limits.maxLeases) return null;
      const lease = { key: keyName, owner, token: randomUUID(), expiresAt: now + ttlMs };
      this.db.prepare('INSERT OR REPLACE INTO zc_leases VALUES (?, ?, ?, ?)').run(keyName, owner, lease.token, lease.expiresAt);
      return lease;
    });
  }
  releaseLease(lease: Lease): boolean {
    return Number(this.db.prepare('DELETE FROM zc_leases WHERE key=? AND owner=? AND token=?').run(lease.key, lease.owner, lease.token).changes) === 1;
  }
  /** Reserve before sending. No refund: failed calls/crashes can consume upstream quota. */
  reserveQuota(provider: string, weight: number): QuotaResult {
    if (!Object.hasOwn(this.providers, provider)) throw new TypeError('Provider quota is not configured');
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000_000) throw new RangeError('Invalid weight');
    const units = Math.ceil(weight * 1000);
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      this.db.prepare('DELETE FROM zc_quota WHERE rowid IN (SELECT rowid FROM zc_quota WHERE at<=? LIMIT 1000)').run(now - WINDOWS.month);
      const blocked: (keyof QuotaLimits)[] = [];
      let retryAt = now;
      for (const name of names) {
        const row = this.db.prepare('SELECT coalesce(sum(units),0) AS used, min(at) AS first FROM zc_quota WHERE provider=? AND at>?').get(provider, now - WINDOWS[name])!;
        if (Number(row.used) + units > this.providers[provider][name] * 1000) {
          blocked.push(name);
          // Earliest useful retry, not a guarantee that enough capacity has cleared.
          retryAt = Math.max(retryAt, row.first === null ? now + WINDOWS[name] : Number(row.first) + WINDOWS[name]);
        }
      }
      if (blocked.length) return { allowed: false, reason: 'quota', retryAt, windows: blocked };
      const exists = this.db.prepare('SELECT 1 FROM zc_quota WHERE provider=? AND at=?').get(provider, now);
      if (!exists && Number(this.db.prepare('SELECT count(*) AS n FROM zc_quota').get()!.n) >= this.limits.maxQuotaEvents)
        return { allowed: false, reason: 'capacity', retryAt: null, windows: [] };
      this.db.prepare('INSERT INTO zc_quota VALUES (?, ?, ?) ON CONFLICT(provider,at) DO UPDATE SET units=units+excluded.units').run(provider, now, units);
      return { allowed: true, chargedWeight: units / 1000 };
    });
  }
  /** Shared conservative admission: keep every reservation for at least 32 days.
   * Whole UTC-day buckets can retain it up to 33 days. Never refund a permit. */
  reserveMapboxRequest(): { allowed: boolean; used: number; limit: 190000 } {
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      const day = Math.floor(now / DAY);
      this.db.prepare('DELETE FROM zc_mapbox_budget WHERE day < ?').run(day - 32);
      const rows = this.db.prepare('SELECT day, used FROM zc_mapbox_budget').all();
      let used = 0;
      for (const row of rows) {
        if (!Number.isSafeInteger(row.day) || Number(row.day) > day || !Number.isSafeInteger(row.used) || Number(row.used) < 1 || Number(row.used) > 190000) throw new Error('Invalid Mapbox budget state');
        used += Number(row.used);
      }
      if (used >= 190000) return { allowed: false, used, limit: 190000 };
      this.db.prepare('INSERT INTO zc_mapbox_budget VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET used=used+1').run(day);
      return { allowed: true, used: used + 1, limit: 190000 };
    });
  }
  cacheUsage(): { entries: number; bytes: number } {
    const row = this.db.prepare('SELECT count(*) AS entries, coalesce(sum(bytes),0) AS bytes FROM zc_cache').get()!;
    return { entries: Number(row.entries), bytes: Number(row.bytes) };
  }
  diskUsage(): { databaseBytes: number; walBytes: number; shmBytes: number; totalBytes: number } {
    const size = (suffix: string) => {
      if (this.path === ':memory:') return 0;
      try { return statSync(this.path + suffix).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    };
    const databaseBytes = size(''), walBytes = size('-wal'), shmBytes = size('-shm');
    return { databaseBytes, walBytes, shmBytes, totalBytes: databaseBytes + walBytes + shmBytes };
  }
  /** Bounded row deletion plus checkpoint attempt; busy readers may prevent WAL truncation. */
  cleanup(batchSize = 1000) {
    integer(batchSize, 'batchSize', 1, 10_000);
    const deleted = this.transaction(() => {
      const now = this.mutationTime();
      const cache = this.db.prepare('DELETE FROM zc_cache WHERE key IN (SELECT key FROM zc_cache WHERE stale_until<=? LIMIT ?)').run(now, batchSize).changes;
      const leases = this.db.prepare('DELETE FROM zc_leases WHERE key IN (SELECT key FROM zc_leases WHERE expires_at<=? LIMIT ?)').run(now, batchSize).changes;
      const quota = this.db.prepare('DELETE FROM zc_quota WHERE rowid IN (SELECT rowid FROM zc_quota WHERE at<=? LIMIT ?)').run(now - WINDOWS.month, batchSize).changes;
      return { cache: Number(cache), leases: Number(leases), quota: Number(quota) };
    });
    const checkpoint = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!;
    return { deleted, checkpointBusy: Number(checkpoint.busy) !== 0, ...this.diskUsage(), ...this.cacheUsage() };
  }
  close(): void { this.db.close(); }
}

/** Application admission ceilings; NWS/NOAA values are conservative app policy, not advertised provider quotas. */
export const APP_PROVIDER_LIMITS = {
 'open-meteo': OPEN_METEO_LIMITS,
 nws: {minute:60,hour:1000,day:5000,month:100000},
 noaa: {minute:60,hour:1000,day:5000,month:100000},
};
