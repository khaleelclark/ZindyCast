import { createHash, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ForecastVerificationSnapshotSchema,
  ObservationVerificationSnapshotSchema,
  VerificationModelSchema,
  VerificationPlaceInputSchema,
  VerificationPlaceSchema,
  type ForecastVerificationSnapshot,
  type ObservationVerificationSnapshot,
  type VerificationPlace,
  type VerificationPlaceInput,
  type VerificationScorecard,
} from '../../contracts/src/verification.js';
import { calculateScorecard, type StoredForecastPoint, type StoredObservationPoint } from './score.js';

export * from '../../contracts/src/verification.js';
export { calculateScorecard } from './score.js';
export type { ScorecardInput, StoredForecastPoint, StoredObservationPoint } from './score.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const KEY = /^[a-f0-9]{64}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface VerificationRepositoryOptions {
  path: string;
  clock?: () => number;
  busyTimeoutMs?: number;
  maxTrackedPlaces?: number;
  maxPlacesPerInstallation?: number;
  maxForecastSnapshots?: number;
  maxForecastPoints?: number;
  maxObservationSnapshots?: number;
  maxObservationPoints?: number;
  maxScorecardRows?: number;
  maxJsonBytes?: number;
  maxDiskBytes?: number;
  retentionDays?: number;
}

export interface VerificationTargetLease {
  target: VerificationPlace;
  owner: string;
  token: string;
  expiresAt: number;
}

export interface ObservationNeed {
  targetKey: string;
  stationId: string;
  startTime: string;
  endTime: string;
  requestStartTime: string;
  requestEndTime: string;
  validTimes: string[];
}

function integer(value: number, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${name}`);
  return value;
}
function checkedKey(value: string): string {
  if (!KEY.test(value)) throw new TypeError('Invalid verification target key');
  return value;
}
function checkedOwner(value: string): string {
  if (!OWNER.test(value)) throw new TypeError('Invalid verification owner');
  return value;
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function targetIdentity(input: VerificationPlaceInput): string {
  return digest({ placeId: input.placeId, optedIn: input.optedIn, location: input.location, station: input.station });
}

/** Dedicated immutable forecast/observation archive. Cleanup may delete expired
 * snapshots; no stored snapshot can be updated or relabeled. */
export class VerificationRepository {
  private readonly db: DatabaseSync;
  private readonly path: string;
  private readonly clock: () => number;
  private readonly limits: {
    maxTrackedPlaces: number; maxPlacesPerInstallation: number;
    maxForecastSnapshots: number; maxForecastPoints: number;
    maxObservationSnapshots: number; maxObservationPoints: number; maxScorecardRows: number;
    maxJsonBytes: number; maxDiskBytes: number; retentionDays: number;
  };

  constructor(options: VerificationRepositoryOptions) {
    this.path = options.path;
    this.clock = options.clock ?? Date.now;
    this.limits = {
      maxTrackedPlaces: integer(options.maxTrackedPlaces ?? 20, 'maxTrackedPlaces', 1, 100),
      maxPlacesPerInstallation: integer(options.maxPlacesPerInstallation ?? 5, 'maxPlacesPerInstallation', 1, 5),
      maxForecastSnapshots: integer(options.maxForecastSnapshots ?? 15_000, 'maxForecastSnapshots', 1, 100_000),
      maxForecastPoints: integer(options.maxForecastPoints ?? 5_000_000, 'maxForecastPoints', 1, 20_000_000),
      maxObservationSnapshots: integer(options.maxObservationSnapshots ?? 15_000, 'maxObservationSnapshots', 1, 100_000),
      maxObservationPoints: integer(options.maxObservationPoints ?? 1_000_000, 'maxObservationPoints', 1, 10_000_000),
      maxScorecardRows: integer(options.maxScorecardRows ?? 50_000, 'maxScorecardRows', 1, 50_000),
      maxJsonBytes: integer(options.maxJsonBytes ?? 64 * 1024, 'maxJsonBytes', 1024, 1024 ** 2),
      maxDiskBytes: integer(options.maxDiskBytes ?? 768 * 1024 ** 2, 'maxDiskBytes', 1024 ** 2, 4 * 1024 ** 3),
      retentionDays: integer(options.retentionDays ?? 120, 'retentionDays', 30, 366),
    };
    this.db = new DatabaseSync(options.path, { timeout: integer(options.busyTimeoutMs ?? 1000, 'busyTimeoutMs', 0, 5000) });
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        PRAGMA wal_autocheckpoint=256; PRAGMA journal_size_limit=4194304;
        CREATE TABLE IF NOT EXISTS zc_verification_meta(id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,last_now INTEGER NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS zc_verification_targets(
          target_key TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at INTEGER NOT NULL,next_capture_at INTEGER NOT NULL,
          lease_owner TEXT,lease_token TEXT,lease_until INTEGER) STRICT;
        CREATE TABLE IF NOT EXISTS zc_verification_memberships(
          installation_id TEXT NOT NULL,place_id TEXT NOT NULL,target_key TEXT NOT NULL REFERENCES zc_verification_targets(target_key) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,PRIMARY KEY(installation_id,place_id)) STRICT;
        CREATE INDEX IF NOT EXISTS zc_verification_membership_target ON zc_verification_memberships(target_key);
        CREATE INDEX IF NOT EXISTS zc_verification_target_due ON zc_verification_targets(next_capture_at,lease_until);
        CREATE TABLE IF NOT EXISTS zc_verification_forecasts(
          snapshot_id TEXT PRIMARY KEY,target_key TEXT NOT NULL REFERENCES zc_verification_targets(target_key) ON DELETE CASCADE,
          model_id TEXT NOT NULL,model_role TEXT NOT NULL,retrieved_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,metadata TEXT NOT NULL,bytes INTEGER NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS zc_verification_forecast_target ON zc_verification_forecasts(target_key,model_id,retrieved_at);
        CREATE INDEX IF NOT EXISTS zc_verification_forecast_expiry ON zc_verification_forecasts(expires_at,snapshot_id);
        CREATE TABLE IF NOT EXISTS zc_verification_forecast_points(
          snapshot_id TEXT NOT NULL REFERENCES zc_verification_forecasts(snapshot_id) ON DELETE CASCADE,valid_time INTEGER NOT NULL,
          temperature_c REAL,dew_point_c REAL,wind_speed_ms REAL,precip_probability REAL,
          PRIMARY KEY(snapshot_id,valid_time)) STRICT;
        CREATE INDEX IF NOT EXISTS zc_verification_forecast_valid ON zc_verification_forecast_points(valid_time,snapshot_id);
        CREATE TABLE IF NOT EXISTS zc_verification_observations(
          snapshot_id TEXT PRIMARY KEY,target_key TEXT NOT NULL REFERENCES zc_verification_targets(target_key) ON DELETE CASCADE,
          retrieved_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,metadata TEXT NOT NULL,bytes INTEGER NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS zc_verification_observation_target ON zc_verification_observations(target_key,retrieved_at);
        CREATE INDEX IF NOT EXISTS zc_verification_observation_expiry ON zc_verification_observations(expires_at,snapshot_id);
        CREATE TABLE IF NOT EXISTS zc_verification_observation_points(
          snapshot_id TEXT NOT NULL REFERENCES zc_verification_observations(snapshot_id) ON DELETE CASCADE,valid_time INTEGER NOT NULL,source_time INTEGER,source_id TEXT,
          temperature_c REAL,temperature_status TEXT NOT NULL,temperature_flags TEXT NOT NULL,
          dew_point_c REAL,dew_point_status TEXT NOT NULL,dew_point_flags TEXT NOT NULL,
          wind_speed_ms REAL,wind_status TEXT NOT NULL,wind_flags TEXT NOT NULL,
          precipitation_mm REAL,precipitation_status TEXT NOT NULL,precipitation_flags TEXT NOT NULL,
          precipitation_start INTEGER,precipitation_end INTEGER,precipitation_completeness TEXT,
          PRIMARY KEY(snapshot_id,valid_time)) STRICT;
        CREATE INDEX IF NOT EXISTS zc_verification_observation_valid ON zc_verification_observation_points(valid_time,snapshot_id);`);
      const config = JSON.stringify({ schema: 1, ...this.limits });
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO zc_verification_meta VALUES(1,?,0)').run(config);
        if (String(this.db.prepare('SELECT config FROM zc_verification_meta WHERE id=1').get()!.config) !== config) throw new Error('Verification configuration mismatch');
      });
      const pageSize = Number(this.db.prepare('PRAGMA page_size').get()!.page_size);
      this.db.exec(`PRAGMA max_page_count=${Math.floor(this.limits.maxDiskBytes / pageSize)}`);
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = run(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* preserve original */ } throw error; }
  }
  private now(): number {
    const now = integer(this.clock(), 'clock', 0, 8_640_000_000_000_000 - 367 * DAY);
    const last = Number(this.db.prepare('SELECT last_now FROM zc_verification_meta WHERE id=1').get()!.last_now);
    if (now < last) throw new Error('Clock moved backwards');
    return now;
  }
  private mutationTime(): number {
    const now = this.now();
    this.db.prepare('UPDATE zc_verification_meta SET last_now=? WHERE id=1').run(now);
    return now;
  }
  private admission(): void {
    if (this.diskUsage().totalBytes >= this.limits.maxDiskBytes) throw new RangeError('Verification disk budget reached');
  }
  private target(key: string): VerificationPlace | null {
    const row = this.db.prepare('SELECT payload,created_at,next_capture_at FROM zc_verification_targets WHERE target_key=?').get(checkedKey(key));
    if (!row) return null;
    const input = VerificationPlaceInputSchema.parse(JSON.parse(String(row.payload)));
    return VerificationPlaceSchema.parse({ ...input, targetKey: key, createdAt: Number(row.created_at), nextCaptureAt: Number(row.next_capture_at) });
  }

  registerPlace(installationId: string, value: VerificationPlaceInput): VerificationPlace {
    checkedOwner(installationId);
    const input = VerificationPlaceInputSchema.parse(value);
    const targetKey = targetIdentity(input);
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      const existingMember = this.db.prepare('SELECT target_key FROM zc_verification_memberships WHERE installation_id=? AND place_id=?').get(installationId, input.placeId);
      if (existingMember) {
        if (String(existingMember.target_key) !== targetKey) throw new RangeError('Place ID is already registered with different immutable metadata');
        return this.target(targetKey)!;
      }
      const owned = Number(this.db.prepare('SELECT count(*) AS n FROM zc_verification_memberships WHERE installation_id=?').get(installationId)!.n);
      const global = Number(this.db.prepare('SELECT count(*) AS n FROM zc_verification_memberships').get()!.n);
      if (owned >= this.limits.maxPlacesPerInstallation) throw new RangeError('Installation verification place limit reached');
      if (global >= this.limits.maxTrackedPlaces) throw new RangeError('Global verification place limit reached');
      const payload = JSON.stringify(input);
      if (Buffer.byteLength(payload) > this.limits.maxJsonBytes) throw new RangeError('Verification place exceeds JSON budget');
      this.db.prepare('INSERT OR IGNORE INTO zc_verification_targets(target_key,payload,created_at,next_capture_at) VALUES(?,?,?,?)').run(targetKey, payload, now, now);
      // An existing shared target must retain the same scientifically relevant identity.
      const stored = VerificationPlaceInputSchema.parse(JSON.parse(String(this.db.prepare('SELECT payload FROM zc_verification_targets WHERE target_key=?').get(targetKey)!.payload)));
      if (targetIdentity(stored) !== targetKey) throw new Error('Corrupt verification target identity');
      this.db.prepare('INSERT INTO zc_verification_memberships VALUES(?,?,?,?)').run(installationId, input.placeId, targetKey, now);
      return this.target(targetKey)!;
    });
  }

  listPlaces(installationId: string): VerificationPlace[] {
    checkedOwner(installationId);
    return this.db.prepare(`SELECT t.target_key,t.payload,t.created_at,t.next_capture_at
      FROM zc_verification_memberships m JOIN zc_verification_targets t ON t.target_key=m.target_key
      WHERE m.installation_id=? ORDER BY m.created_at,m.place_id`).all(installationId).map(row => {
        const input = VerificationPlaceInputSchema.parse(JSON.parse(String(row.payload)));
        return VerificationPlaceSchema.parse({ ...input, targetKey: String(row.target_key), createdAt: Number(row.created_at), nextCaptureAt: Number(row.next_capture_at) });
      });
  }

  place(installationId: string, placeId: string): VerificationPlace | null {
    checkedOwner(installationId);
    const parsedPlaceId = VerificationPlaceInputSchema.shape.placeId.parse(placeId);
    const row = this.db.prepare(`SELECT t.target_key,t.payload,t.created_at,t.next_capture_at
      FROM zc_verification_memberships m JOIN zc_verification_targets t ON t.target_key=m.target_key
      WHERE m.installation_id=? AND m.place_id=?`).get(installationId, parsedPlaceId);
    if (!row) return null;
    return VerificationPlaceSchema.parse({ ...VerificationPlaceInputSchema.parse(JSON.parse(String(row.payload))), targetKey: String(row.target_key), createdAt: Number(row.created_at), nextCaptureAt: Number(row.next_capture_at) });
  }

  removePlace(installationId: string, placeId: string): boolean {
    checkedOwner(installationId);
    const parsedPlaceId = VerificationPlaceInputSchema.shape.placeId.parse(placeId);
    return this.transaction(() => {
      this.mutationTime();
      const row = this.db.prepare('SELECT target_key FROM zc_verification_memberships WHERE installation_id=? AND place_id=?').get(installationId, parsedPlaceId);
      if (!row) return false;
      const key = String(row.target_key);
      this.db.prepare('DELETE FROM zc_verification_memberships WHERE installation_id=? AND place_id=?').run(installationId, parsedPlaceId);
      this.db.prepare('DELETE FROM zc_verification_targets WHERE target_key=? AND NOT EXISTS(SELECT 1 FROM zc_verification_memberships WHERE target_key=?)').run(key, key);
      return true;
    });
  }

  targetsForLocation(latitude: number, longitude: number, timezone: string): VerificationPlace[] {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new TypeError('Invalid coordinates');
    const unique = new Set<string>();
    const result: VerificationPlace[] = [];
    for (const row of this.db.prepare(`SELECT target_key,payload,created_at,next_capture_at FROM zc_verification_targets t
      WHERE EXISTS(SELECT 1 FROM zc_verification_memberships m WHERE m.target_key=t.target_key) ORDER BY target_key`).all()) {
      const input = VerificationPlaceInputSchema.parse(JSON.parse(String(row.payload)));
      const key = String(row.target_key);
      if (!unique.has(key) && input.location.latitude === latitude && input.location.longitude === longitude && input.location.timezone === timezone) {
        unique.add(key); result.push(VerificationPlaceSchema.parse({ ...input, targetKey: key, createdAt: Number(row.created_at), nextCaptureAt: Number(row.next_capture_at) }));
      }
    }
    return result;
  }

  /** Remove collection authority for expired or revoked installations without
   * cascading through their immutable archive. Orphaned evidence ages out via
   * bounded cleanup and can no longer be scheduled or matched by forecast hooks. */
  pruneInactiveInstallations(isActive: (installationId: string) => boolean): { checked: number; removedMemberships: number } {
    if (typeof isActive !== 'function') throw new TypeError('Installation liveness callback required');
    const ids = this.db.prepare('SELECT DISTINCT installation_id FROM zc_verification_memberships ORDER BY installation_id').all()
      .map(row => String(row.installation_id));
    const inactive = ids.filter(id => !isActive(id));
    if (!inactive.length) return { checked: ids.length, removedMemberships: 0 };
    const removedMemberships = this.transaction(() => {
      this.mutationTime();
      const remove = this.db.prepare('DELETE FROM zc_verification_memberships WHERE installation_id=?');
      return inactive.reduce((sum, id) => sum + Number(remove.run(id).changes), 0);
    });
    return { checked: ids.length, removedMemberships };
  }

  acquireDueTarget(ownerValue: string, leaseMs = 60_000): VerificationTargetLease | null {
    const owner = checkedOwner(ownerValue); integer(leaseMs, 'leaseMs', 1000, 15 * 60_000);
    return this.transaction(() => {
      const now = this.mutationTime();
      const row = this.db.prepare(`SELECT target_key FROM zc_verification_targets t WHERE next_capture_at<=?
        AND (lease_until IS NULL OR lease_until<=?) AND EXISTS(SELECT 1 FROM zc_verification_memberships m WHERE m.target_key=t.target_key)
        ORDER BY next_capture_at,target_key LIMIT 1`).get(now, now);
      if (!row) return null;
      const targetKey = String(row.target_key), token = randomUUID(), expiresAt = now + leaseMs;
      const changed = this.db.prepare(`UPDATE zc_verification_targets SET lease_owner=?,lease_token=?,lease_until=?
        WHERE target_key=? AND (lease_until IS NULL OR lease_until<=?)`).run(owner, token, expiresAt, targetKey, now).changes;
      if (Number(changed) !== 1) return null;
      return { target: this.target(targetKey)!, owner, token, expiresAt };
    });
  }

  finishTarget(lease: VerificationTargetLease, nextCaptureAt: number): boolean {
    integer(nextCaptureAt, 'nextCaptureAt'); checkedKey(lease.target.targetKey); checkedOwner(lease.owner);
    return this.transaction(() => {
      const now = this.mutationTime();
      if (nextCaptureAt <= now || nextCaptureAt > now + 7 * DAY) throw new RangeError('Invalid next capture time');
      return Number(this.db.prepare(`UPDATE zc_verification_targets SET next_capture_at=?,lease_owner=NULL,lease_token=NULL,lease_until=NULL
        WHERE target_key=? AND lease_owner=? AND lease_token=? AND lease_until>?`).run(nextCaptureAt, lease.target.targetKey, lease.owner, lease.token, now).changes) === 1;
    });
  }

  releaseTarget(lease: VerificationTargetLease, retryAt: number): boolean { return this.finishTarget(lease, retryAt); }

  leaseActive(lease: VerificationTargetLease): boolean {
    checkedKey(lease.target.targetKey); checkedOwner(lease.owner);
    const now = this.now();
    return !!this.db.prepare(`SELECT 1 FROM zc_verification_targets WHERE target_key=? AND lease_owner=? AND lease_token=? AND lease_until>?`)
      .get(lease.target.targetKey, lease.owner, lease.token, now);
  }

  lastModelCapture(targetKey: string, modelId: string): number | null {
    checkedKey(targetKey); checkedOwner(modelId);
    const row = this.db.prepare('SELECT max(retrieved_at) AS at FROM zc_verification_forecasts WHERE target_key=? AND model_id=?').get(targetKey, modelId)!;
    return row.at === null ? null : Number(row.at);
  }

  addForecastSnapshot(value: ForecastVerificationSnapshot): { inserted: boolean; snapshotId: string } {
    const snapshot = ForecastVerificationSnapshotSchema.parse(value);
    const snapshotId = digest(snapshot);
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      const retrievedAt = Date.parse(snapshot.retrievedAt);
      if (retrievedAt > now) throw new RangeError('Forecast retrieval is in the future');
      const target = this.target(snapshot.targetKey);
      if (!target || targetIdentity(target) !== snapshot.targetKey || target.location.latitude !== snapshot.location.latitude ||
          target.location.longitude !== snapshot.location.longitude || target.location.timezone !== snapshot.location.timezone) throw new RangeError('Forecast target identity mismatch');
      if (this.db.prepare('SELECT 1 FROM zc_verification_forecasts WHERE snapshot_id=?').get(snapshotId)) return { inserted: false, snapshotId };
      const existingModel = this.db.prepare(`SELECT metadata FROM zc_verification_forecasts
        WHERE target_key=? AND model_id=? ORDER BY retrieved_at,snapshot_id LIMIT 1`).get(snapshot.targetKey, snapshot.model.id);
      if (existingModel) {
        const stored = VerificationModelSchema.parse((JSON.parse(String(existingModel.metadata)) as { model?: unknown }).model);
        if (JSON.stringify(stored) !== JSON.stringify(snapshot.model)) throw new RangeError('Verification model identity changed');
      } else {
        const modelCount = Number(this.db.prepare('SELECT count(DISTINCT model_id) AS n FROM zc_verification_forecasts WHERE target_key=?').get(snapshot.targetKey)!.n);
        if (modelCount >= 3) throw new RangeError('Verification target model limit reached');
      }
      const usage = this.usage();
      if (usage.forecastSnapshots >= this.limits.maxForecastSnapshots || usage.forecastPoints + snapshot.points.length > this.limits.maxForecastPoints) throw new RangeError('Forecast archive capacity reached');
      const { points, ...metadata } = snapshot;
      const json = JSON.stringify(metadata), bytes = Buffer.byteLength(json);
      if (bytes > this.limits.maxJsonBytes) throw new RangeError('Forecast metadata exceeds JSON budget');
      const expiresAt = retrievedAt + this.limits.retentionDays * DAY;
      if (expiresAt <= now) throw new RangeError('Forecast snapshot is already outside retention');
      this.db.prepare('INSERT INTO zc_verification_forecasts VALUES(?,?,?,?,?,?,?,?)').run(
        snapshotId, snapshot.targetKey, snapshot.model.id, snapshot.model.role, retrievedAt, expiresAt, json, bytes + points.length * 48);
      const insert = this.db.prepare('INSERT INTO zc_verification_forecast_points VALUES(?,?,?,?,?,?)');
      for (const point of points) insert.run(snapshotId, Date.parse(point.validTime), point.temperatureC, point.dewPointC, point.windSpeedMs, point.precipitationProbabilityPercent);
      return { inserted: true, snapshotId };
    });
  }

  addObservationSnapshot(value: ObservationVerificationSnapshot): { inserted: boolean; snapshotId: string } {
    const snapshot = ObservationVerificationSnapshotSchema.parse(value);
    const snapshotId = digest(snapshot);
    return this.transaction(() => {
      const now = this.mutationTime(); this.admission();
      const retrievedAt = Date.parse(snapshot.retrievedAt);
      if (retrievedAt > now) throw new RangeError('Observation retrieval is in the future');
      const target = this.target(snapshot.targetKey);
      if (!target || target.station.id !== snapshot.station.id || JSON.stringify(target.station) !== JSON.stringify(snapshot.station)) throw new RangeError('Observation station identity mismatch');
      if (this.db.prepare('SELECT 1 FROM zc_verification_observations WHERE snapshot_id=?').get(snapshotId)) return { inserted: false, snapshotId };
      const usage = this.usage();
      if (usage.observationSnapshots >= this.limits.maxObservationSnapshots || usage.observationPoints + snapshot.points.length > this.limits.maxObservationPoints) throw new RangeError('Observation archive capacity reached');
      const { points, ...metadata } = snapshot;
      const json = JSON.stringify(metadata), bytes = Buffer.byteLength(json);
      if (bytes > this.limits.maxJsonBytes) throw new RangeError('Observation metadata exceeds JSON budget');
      const expiresAt = retrievedAt + this.limits.retentionDays * DAY;
      if (expiresAt <= now) throw new RangeError('Observation snapshot is already outside retention');
      this.db.prepare('INSERT INTO zc_verification_observations VALUES(?,?,?,?,?,?)').run(snapshotId, snapshot.targetKey, retrievedAt, expiresAt, json, bytes + points.length * 160);
      const insert = this.db.prepare('INSERT INTO zc_verification_observation_points VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const point of points) insert.run(snapshotId, Date.parse(point.validTime),
        point.sourceTime === null ? null : Date.parse(point.sourceTime), point.sourceId,
        point.temperatureC.value, point.temperatureC.status, JSON.stringify(point.temperatureC.flags),
        point.dewPointC.value, point.dewPointC.status, JSON.stringify(point.dewPointC.flags),
        point.windSpeedMs.value, point.windSpeedMs.status, JSON.stringify(point.windSpeedMs.flags),
        point.precipitationMm.value, point.precipitationMm.status, JSON.stringify(point.precipitationMm.flags),
        point.precipitationInterval ? Date.parse(point.precipitationInterval.start) : null,
        point.precipitationInterval ? Date.parse(point.precipitationInterval.end) : null,
        point.precipitationInterval?.completeness ?? null);
      return { inserted: true, snapshotId };
    });
  }

  observationNeed(targetKey: string, throughTime: number, maxPoints = 168): ObservationNeed | null {
    checkedKey(targetKey); integer(throughTime, 'throughTime'); integer(maxPoints, 'maxPoints', 1, 744);
    const target = this.target(targetKey); if (!target) return null;
    const missingSql = `FROM zc_verification_forecast_points p
      JOIN zc_verification_forecasts f ON f.snapshot_id=p.snapshot_id
      WHERE f.target_key=? AND p.valid_time<=? AND NOT EXISTS(
        SELECT 1 FROM zc_verification_observation_points o JOIN zc_verification_observations s ON s.snapshot_id=o.snapshot_id
        WHERE s.target_key=f.target_key AND o.valid_time=p.valid_time
          AND (o.temperature_status='accepted' OR o.dew_point_status='accepted' OR o.wind_status='accepted'
            OR (o.precipitation_status='accepted' AND o.precipitation_completeness='complete')))
      `;
    const first = this.db.prepare(`SELECT min(p.valid_time) AS at ${missingSql}`).get(targetKey, throughTime)!;
    if (first.at === null) return null;
    const firstTime = Number(first.at);
    const rows = this.db.prepare(`SELECT DISTINCT p.valid_time ${missingSql} AND p.valid_time<=? ORDER BY p.valid_time LIMIT ?`)
      .all(targetKey, throughTime, firstTime + 7 * DAY - HOUR, maxPoints);
    if (!rows.length) return null;
    const validTimes = rows.map(row => new Date(Number(row.valid_time)).toISOString());
    return { targetKey, stationId: target.station.id, startTime: validTimes[0]!, endTime: validTimes.at(-1)!,
      requestStartTime: new Date(firstTime - 30 * 60_000).toISOString(), requestEndTime: new Date(Number(rows.at(-1)!.valid_time) + 30 * 60_000).toISOString(), validTimes };
  }

  scorecard(targetKey: string): VerificationScorecard {
    const target = this.target(checkedKey(targetKey));
    if (!target) throw new RangeError('Unknown verification target');
    const counts = this.db.prepare(`SELECT
      (SELECT count(*) FROM zc_verification_forecasts WHERE target_key=?) AS forecasts,
      (SELECT count(*) FROM zc_verification_observations WHERE target_key=?) AS observations,
      (SELECT count(*) FROM zc_verification_forecast_points p JOIN zc_verification_forecasts f ON f.snapshot_id=p.snapshot_id WHERE f.target_key=?) AS forecast_points,
      (SELECT count(*) FROM zc_verification_observation_points p JOIN zc_verification_observations o ON o.snapshot_id=p.snapshot_id WHERE o.target_key=?) AS observation_points`).get(targetKey, targetKey, targetKey, targetKey)!;
    const storedForecastPoints = Number(counts.forecast_points), storedObservationPoints = Number(counts.observation_points);
    const modelRows = this.db.prepare(`WITH models AS (
        SELECT model_id,model_role,metadata,row_number() OVER(PARTITION BY model_id ORDER BY retrieved_at,snapshot_id) AS rn
        FROM zc_verification_forecasts WHERE target_key=?)
      SELECT model_id,model_role,metadata FROM models WHERE rn=1 ORDER BY model_role,model_id LIMIT 4`).all(targetKey);
    if (modelRows.length > 3) return calculateScorecard({ place: target, generatedAt: this.now(), archivedSnapshots: Number(counts.forecasts),
      observationSnapshots: Number(counts.observations), forecasts: [], observations: [], storedForecastPoints, storedObservationPoints,
      reportOverflow: true, reportRowLimit: this.limits.maxScorecardRows });
    const models = new Map(modelRows.map(row => {
      const metadata = JSON.parse(String(row.metadata)) as { model?: unknown };
      const model = VerificationModelSchema.parse(metadata.model);
      if (model.id !== String(row.model_id) || model.role !== String(row.model_role)) throw new Error('Corrupt verification model metadata');
      return [model.id, model] as const;
    }));
    // Rank and deduplicate in SQLite before crossing the process-memory boundary.
    // At most 50,001 compact rows are materialized, regardless of archive size.
    const forecastRows = this.db.prepare(`WITH candidates AS (
        SELECT f.snapshot_id,f.model_id,f.retrieved_at,p.valid_time,p.temperature_c,p.dew_point_c,p.wind_speed_ms,p.precip_probability,
          CASE WHEN p.valid_time-f.retrieved_at<=? THEN 0 WHEN p.valid_time-f.retrieved_at<=? THEN 1
            WHEN p.valid_time-f.retrieved_at<=? THEN 2 WHEN p.valid_time-f.retrieved_at<=? THEN 3 ELSE 4 END AS horizon,
          CASE WHEN p.valid_time-f.retrieved_at<=? THEN ? WHEN p.valid_time-f.retrieved_at<=? THEN ?
            WHEN p.valid_time-f.retrieved_at<=? THEN ? WHEN p.valid_time-f.retrieved_at<=? THEN ? ELSE ? END AS target_lead
        FROM zc_verification_forecasts f JOIN zc_verification_forecast_points p ON p.snapshot_id=f.snapshot_id
        WHERE f.target_key=? AND p.valid_time>f.retrieved_at AND p.valid_time-f.retrieved_at<=?), ranked AS (
        SELECT *,row_number() OVER(PARTITION BY model_id,valid_time,horizon
          ORDER BY abs((valid_time-retrieved_at)-target_lead),retrieved_at,snapshot_id) AS rn FROM candidates)
      SELECT snapshot_id,model_id,retrieved_at,valid_time,temperature_c,dew_point_c,wind_speed_ms,precip_probability
      FROM ranked WHERE rn=1 ORDER BY valid_time,model_id LIMIT ?`).all(
        6 * HOUR, 24 * HOUR, 72 * HOUR, 168 * HOUR,
        6 * HOUR, 3 * HOUR, 24 * HOUR, 12 * HOUR, 72 * HOUR, 48 * HOUR, 168 * HOUR, 120 * HOUR, 240 * HOUR,
        targetKey, 384 * HOUR, this.limits.maxScorecardRows + 1);
    if (forecastRows.length > this.limits.maxScorecardRows) return calculateScorecard({ place: target, generatedAt: this.now(), archivedSnapshots: Number(counts.forecasts),
      observationSnapshots: Number(counts.observations), forecasts: [], observations: [], storedForecastPoints, storedObservationPoints,
      reportOverflow: true, reportRowLimit: this.limits.maxScorecardRows });
    const forecasts: StoredForecastPoint[] = forecastRows.map(row => {
        const model = models.get(String(row.model_id));
        if (!model) throw new Error('Missing verification model metadata');
        return { snapshotId: String(row.snapshot_id), model, retrievedAt: Number(row.retrieved_at), validTime: Number(row.valid_time),
          temperatureC: row.temperature_c === null ? null : Number(row.temperature_c), dewPointC: row.dew_point_c === null ? null : Number(row.dew_point_c),
          windSpeedMs: row.wind_speed_ms === null ? null : Number(row.wind_speed_ms), precipitationProbabilityPercent: row.precip_probability === null ? null : Number(row.precip_probability) };
      });
    const remaining = this.limits.maxScorecardRows - forecasts.length;
    const observationRows = this.db.prepare(`WITH ranked AS (
        SELECT s.snapshot_id,s.retrieved_at,o.*,row_number() OVER(PARTITION BY o.valid_time ORDER BY s.retrieved_at DESC,s.snapshot_id DESC) AS rn
        FROM zc_verification_observations s JOIN zc_verification_observation_points o ON o.snapshot_id=s.snapshot_id WHERE s.target_key=?)
      SELECT * FROM ranked WHERE rn=1 ORDER BY valid_time LIMIT ?`).all(targetKey, remaining + 1);
    if (observationRows.length > remaining) return calculateScorecard({ place: target, generatedAt: this.now(), archivedSnapshots: Number(counts.forecasts),
      observationSnapshots: Number(counts.observations), forecasts: [], observations: [], storedForecastPoints, storedObservationPoints,
      reportOverflow: true, reportRowLimit: this.limits.maxScorecardRows });
    const observations: StoredObservationPoint[] = observationRows.map(row => ({
        snapshotId: String(row.snapshot_id), retrievedAt: Number(row.retrieved_at), validTime: Number(row.valid_time),
        temperatureC: row.temperature_c === null ? null : Number(row.temperature_c), temperatureStatus: String(row.temperature_status) as StoredObservationPoint['temperatureStatus'],
        dewPointC: row.dew_point_c === null ? null : Number(row.dew_point_c), dewPointStatus: String(row.dew_point_status) as StoredObservationPoint['dewPointStatus'],
        windSpeedMs: row.wind_speed_ms === null ? null : Number(row.wind_speed_ms), windStatus: String(row.wind_status) as StoredObservationPoint['windStatus'],
        precipitationMm: row.precipitation_mm === null ? null : Number(row.precipitation_mm), precipitationStatus: String(row.precipitation_status) as StoredObservationPoint['precipitationStatus'],
        precipitationStart: row.precipitation_start === null ? null : Number(row.precipitation_start), precipitationEnd: row.precipitation_end === null ? null : Number(row.precipitation_end),
        precipitationCompleteness: row.precipitation_completeness === null ? null : String(row.precipitation_completeness) as StoredObservationPoint['precipitationCompleteness'],
      }));
    return calculateScorecard({ place: target, generatedAt: this.now(), archivedSnapshots: Number(counts.forecasts), observationSnapshots: Number(counts.observations),
      forecasts, observations, storedForecastPoints, storedObservationPoints, reportRowLimit: this.limits.maxScorecardRows });
  }

  usage() {
    const row = this.db.prepare(`SELECT
      (SELECT count(*) FROM zc_verification_memberships) AS memberships,
      (SELECT count(*) FROM zc_verification_targets) AS targets,
      (SELECT count(*) FROM zc_verification_forecasts) AS forecast_snapshots,
      (SELECT count(*) FROM zc_verification_forecast_points) AS forecast_points,
      (SELECT count(*) FROM zc_verification_observations) AS observation_snapshots,
      (SELECT count(*) FROM zc_verification_observation_points) AS observation_points`).get()!;
    return { memberships: Number(row.memberships), targets: Number(row.targets), forecastSnapshots: Number(row.forecast_snapshots),
      forecastPoints: Number(row.forecast_points), observationSnapshots: Number(row.observation_snapshots), observationPoints: Number(row.observation_points) };
  }

  diskUsage(): { databaseBytes: number; walBytes: number; shmBytes: number; totalBytes: number } {
    const size = (suffix: string) => {
      if (this.path === ':memory:') return 0;
      try { return statSync(this.path + suffix).size; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    };
    const databaseBytes = size(''), walBytes = size('-wal'), shmBytes = size('-shm');
    return { databaseBytes, walBytes, shmBytes, totalBytes: databaseBytes + walBytes + shmBytes };
  }

  cleanup(batchSize = 1000) {
    integer(batchSize, 'batchSize', 1, 10_000);
    const deleted = this.transaction(() => {
      const now = this.mutationTime();
      const forecasts = Number(this.db.prepare('DELETE FROM zc_verification_forecasts WHERE snapshot_id IN(SELECT snapshot_id FROM zc_verification_forecasts WHERE expires_at<=? ORDER BY expires_at,snapshot_id LIMIT ?)').run(now, batchSize).changes);
      const observations = Number(this.db.prepare('DELETE FROM zc_verification_observations WHERE snapshot_id IN(SELECT snapshot_id FROM zc_verification_observations WHERE expires_at<=? ORDER BY expires_at,snapshot_id LIMIT ?)').run(now, batchSize).changes);
      const orphanRows = this.db.prepare(`SELECT target_key FROM zc_verification_targets t
        WHERE NOT EXISTS(SELECT 1 FROM zc_verification_memberships m WHERE m.target_key=t.target_key)
          AND NOT EXISTS(SELECT 1 FROM zc_verification_forecasts f WHERE f.target_key=t.target_key)
          AND NOT EXISTS(SELECT 1 FROM zc_verification_observations o WHERE o.target_key=t.target_key)
        ORDER BY target_key LIMIT ?`).all(batchSize);
      const removeOrphan = this.db.prepare('DELETE FROM zc_verification_targets WHERE target_key=?');
      const orphanTargets = orphanRows.reduce((sum, row) => sum + Number(removeOrphan.run(String(row.target_key)).changes), 0);
      return { forecasts, observations, orphanTargets };
    });
    const checkpointBusy = Number(this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!.busy) !== 0;
    return { deleted, checkpointBusy, ...this.usage(), ...this.diskUsage() };
  }

  close(): void { this.db.close(); }
}

export const VERIFICATION_BASELINE_MODEL = Object.freeze({
  id: 'open-meteo-best-match', role: 'baseline', provider: 'Open-Meteo', requestedModel: 'best_match', constituentModel: null,
} as const);

/** Map the existing forecast contract into the intentionally small verification
 * archive. WBGT, apparent temperature, weather codes and other large fields are
 * never accepted by the snapshot schema. Past/current points are dropped. */
export function sanitizeForecast(
  target: VerificationPlace,
  model: import('../../contracts/src/verification.js').VerificationModel,
  forecast: {
    location: import('../../contracts/src/location.js').Location;
    provenance: { provider: string; dataset: string; retrievedAt: string; sourceIssuedAt: string | null;
      sourceCoordinates: { latitude: number; longitude: number }; sourceElevationM?: number | null };
    hours: Array<{ time: string; temperatureC: number | null; dewPointC?: number | null; windSpeedMs: number | null; precipitationProbability: number | null }>;
  },
  providerRequestVersion: string,
  gridElevationM?: number | null,
): ForecastVerificationSnapshot {
  if (forecast.location.latitude !== target.location.latitude || forecast.location.longitude !== target.location.longitude ||
      forecast.location.timezone !== target.location.timezone) throw new RangeError('Forecast request location does not match verification target');
  const retrieved = Date.parse(forecast.provenance.retrievedAt);
  const points = forecast.hours.filter(hour => Date.parse(hour.time) > retrieved).map(hour => ({
    validTime: hour.time,
    temperatureC: hour.temperatureC,
    dewPointC: hour.dewPointC ?? null,
    windSpeedMs: hour.windSpeedMs,
    precipitationProbabilityPercent: hour.precipitationProbability,
  }));
  return ForecastVerificationSnapshotSchema.parse({
    schemaVersion: 'forecast-verification-snapshot-v1', targetKey: target.targetKey, location: target.location, requestLocation: forecast.location, model,
    retrievedAt: forecast.provenance.retrievedAt, sourceIssuedAt: forecast.provenance.sourceIssuedAt,
    dataset: forecast.provenance.dataset, sourceVersion: null, providerRequestVersion,
    grid: { coordinates: forecast.provenance.sourceCoordinates, elevationM: gridElevationM ?? forecast.provenance.sourceElevationM ?? null },
    units: { temperature: '°C', dewPoint: '°C', windSpeed: 'm/s', precipitationProbability: '%' },
    intervalSemantics: 'temperature, dew point and wind are valid-time instants; precipitation probability is the preceding hour ending at validTime',
    points,
  });
}
