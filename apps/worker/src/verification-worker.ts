import { randomUUID } from 'node:crypto';
import type { Forecast } from '@zindycast/contracts';
import { ObservationsDataSchema, type ObservationValue, type ObservationsData } from '../../../packages/contracts/src/observations.js';
import {
  ObservationVerificationSnapshotSchema,
  VERIFICATION_BASELINE_MODEL,
  VerificationModelSchema,
  sanitizeForecast,
  type ObservationNeed,
  type ObservationVerificationSnapshot,
  type VerificationModel,
  type VerificationPlace,
  type VerificationRepository,
  type VerificationTargetLease,
} from '@zindycast/verification';

const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface VerificationWorkerOptions {
  verification: VerificationRepository;
  isInstallationActive: (installationId: string) => boolean;
  fetchForecast: (target: VerificationPlace, model: VerificationModel, signal: AbortSignal) => Promise<Forecast>;
  fetchObservations: (target: VerificationPlace, need: ObservationNeed, signal: AbortSignal) => Promise<ObservationVerificationSnapshot>;
  clock?: () => number;
  owner?: string;
  baselineModel?: VerificationModel;
  candidateModels?: VerificationModel[];
  reserveCandidateBudget?: (target: VerificationPlace, model: VerificationModel) => boolean;
  captureIntervalMs?: number;
  candidateIntervalMs?: number;
  observationLagMs?: number;
  requestTimeoutMs?: number;
}

class Stop extends Error { constructor(readonly code: string) { super(code); } }

const acceptedQuality = new Set(['C', 'S', 'V', 'G']);
function quality(value: ObservationValue, temperature = false) {
  if (value.value === null) return { value: null, status: 'missing' as const, flags: [] };
  const code = value.qualityControl;
  const flags = code === null ? [] : [`${code}:${value.qualityMeaning}`];
  const status = code === null || code === 'Z' || (code === 'T' && !temperature) ? 'suspect' as const : acceptedQuality.has(code) || code === 'T' ? 'accepted' as const : 'rejected' as const;
  return { value: value.value, status, flags };
}

/** Convert the bounded provider result without silently changing stations. Forecast
 * instants use a one-to-one nearest observation within 30 minutes. The original
 * station instant/source ID and actual precipitation interval remain archived. */
export function observationSnapshotFromNws(target: VerificationPlace, need: ObservationNeed, value: ObservationsData): ObservationVerificationSnapshot {
  const data = ObservationsDataSchema.parse(value);
  if (data.query.latitude !== target.location.latitude || data.query.longitude !== target.location.longitude ||
      data.query.since !== need.requestStartTime || data.query.until !== need.requestEndTime) throw new Stop('observation_query_mismatch');
  const station = data.stations.find(item => item.stationId === target.station.id);
  if (!station) throw new Stop('selected_station_unavailable');
  if (station.coordinates.latitude !== target.station.coordinates.latitude || station.coordinates.longitude !== target.station.coordinates.longitude ||
      station.elevationM !== target.station.elevationM) throw new Stop('station_metadata_changed');
  const candidates = need.validTimes.flatMap((validTime, slot) => station.observations.map(observation => ({
    slot, observation, delta: Math.abs(Date.parse(observation.time) - Date.parse(validTime)),
  })).filter(candidate => candidate.delta <= 30 * 60_000))
    .sort((a, b) => a.delta - b.delta || a.observation.time.localeCompare(b.observation.time) || a.slot - b.slot);
  const assigned = new Map<number, typeof station.observations[number]>(), used = new Set<string>();
  for (const candidate of candidates) {
    if (assigned.has(candidate.slot) || used.has(candidate.observation.sourceId)) continue;
    assigned.set(candidate.slot, candidate.observation); used.add(candidate.observation.sourceId);
  }
  const points = need.validTimes.map((validTime, slot) => {
    const observation = assigned.get(slot);
    if (!observation) {
      const missing = { value: null, status: 'missing' as const, flags: [] };
      return { validTime, sourceTime: null, sourceId: null, temperatureC: missing, dewPointC: missing, windSpeedMs: missing,
        precipitationMm: missing, precipitationInterval: null };
    }
    const precipitation = quality(observation.measurements.precipitationLastHourMm);
    return {
      validTime, sourceTime: observation.time, sourceId: observation.sourceId,
      temperatureC: quality(observation.measurements.temperatureC, true),
      dewPointC: quality(observation.measurements.dewPointC),
      windSpeedMs: quality(observation.measurements.windSpeedMs),
      precipitationMm: precipitation,
      precipitationInterval: precipitation.value === null ? null : {
        start: new Date(Date.parse(observation.time) - HOUR).toISOString(), end: observation.time, completeness: 'complete' as const,
      },
    };
  });
  return ObservationVerificationSnapshotSchema.parse({
    schemaVersion: 'observation-verification-snapshot-v1', targetKey: target.targetKey, station: target.station,
    provider: data.provider, dataset: data.dataset, retrievedAt: data.retrievedAt, sourceIssuedAt: null, sourceVersion: null,
    adapterVersion: 'nws-observation-verification-v1',
    units: { temperature: '°C', dewPoint: '°C', windSpeed: 'm/s', precipitation: 'mm' },
    timeSemantics: 'NWS/MADIS station instants matched one-to-one to forecast valid times within 30 minutes; reported precipitationLastHour retains its actual preceding-hour interval',
    points,
  });
}

/** Bounded scheduled capture. Provider adapters and quota admission are injected by
 * the composition root; tests never call live services. Candidate forecasts are
 * skipped unless a caller explicitly reserves their budget. */
export class VerificationWorker {
  private busy = false;
  private readonly clock: () => number;
  private readonly owner: string;
  private readonly baseline: VerificationModel;
  private readonly candidates: VerificationModel[];
  private readonly captureInterval: number;
  private readonly candidateInterval: number;
  private readonly observationLag: number;
  private readonly requestTimeout: number;

  constructor(private readonly options: VerificationWorkerOptions) {
    this.clock = options.clock ?? Date.now;
    this.owner = options.owner ?? `verification-${randomUUID()}`;
    this.baseline = VerificationModelSchema.parse(options.baselineModel ?? VERIFICATION_BASELINE_MODEL);
    this.candidates = (options.candidateModels ?? []).map(model => VerificationModelSchema.parse(model));
    if (this.baseline.role !== 'baseline' || this.candidates.some(model => model.role !== 'candidate') || this.candidates.length > 2 ||
        new Set([this.baseline.id, ...this.candidates.map(model => model.id)]).size !== this.candidates.length + 1) throw new RangeError('Use one baseline and at most two distinct explicit candidates');
    this.captureInterval = this.interval(options.captureIntervalMs ?? 6 * HOUR, 'captureIntervalMs', HOUR, DAY);
    this.candidateInterval = this.interval(options.candidateIntervalMs ?? DAY, 'candidateIntervalMs', this.captureInterval, 7 * DAY);
    this.observationLag = this.interval(options.observationLagMs ?? 2 * HOUR, 'observationLagMs', 0, DAY);
    this.requestTimeout = this.interval(options.requestTimeoutMs ?? 10_000, 'requestTimeoutMs', 100, 30_000);
  }

  private interval(value: number, name: string, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid ${name}`);
    return value;
  }

  private async bounded<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Stop('provider_timeout')), this.requestTimeout);
    let rejectAbort: (reason: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const reject = () => rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort', reject, { once: true });
    try { return await Promise.race([run(controller.signal), aborted]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', reject); }
  }

  async runOnce(shutdown?: AbortSignal): Promise<'idle' | 'handled' | 'busy'> {
    if (this.busy) return 'busy';
    if (shutdown?.aborted) return 'idle';
    this.busy = true;
    let lease: VerificationTargetLease | null = null;
    try {
      this.options.verification.pruneInactiveInstallations(this.options.isInstallationActive);
      lease = this.options.verification.acquireDueTarget(this.owner, 5 * 60_000);
      if (!lease) return 'idle';
      const target = lease.target;
      const now = this.clock();
      const need = this.options.verification.observationNeed(target.targetKey, now - this.observationLag);
      if (need) {
        try {
          const observations = ObservationVerificationSnapshotSchema.parse(await this.bounded(shutdown, signal => this.options.fetchObservations(target, need, signal)));
          if (!this.options.verification.leaseActive(lease)) throw new Stop('lease_lost');
          if (observations.targetKey !== target.targetKey || observations.station.id !== target.station.id ||
              observations.points.some(point => !need.validTimes.includes(point.validTime))) throw new Stop('observation_identity_mismatch');
          this.options.verification.addObservationSnapshot(observations);
        } catch (error) {
          if (shutdown?.aborted) throw error;
          if (!this.options.verification.leaseActive(lease)) throw new Stop('lease_lost');
          // Observation retrieval and QC publication are independent of receiving
          // new forecasts. The unfilled need remains explicit and is retried later.
        }
      }

      const models = [this.baseline, ...this.candidates];
      for (const model of models) {
        shutdown?.throwIfAborted();
        const previous = this.options.verification.lastModelCapture(target.targetKey, model.id);
        const interval = model.role === 'baseline' ? this.captureInterval : this.candidateInterval;
        if (previous !== null && previous + interval > now) continue;
        if (model.role === 'candidate' && !this.options.reserveCandidateBudget?.(target, model)) continue;
        const forecast = await this.bounded(shutdown, signal => this.options.fetchForecast(target, model, signal));
        if (!this.options.verification.leaseActive(lease)) throw new Stop('lease_lost');
        this.options.verification.addForecastSnapshot(sanitizeForecast(target, model, forecast, `verification-worker-v1:${model.requestedModel}`,
          forecast.provenance.sourceElevationM ?? null));
      }
      if (!this.options.verification.finishTarget(lease, now + this.captureInterval)) throw new Stop('lease_lost');
      lease = null;
      return 'handled';
    } catch (error) {
      if (shutdown?.aborted) return 'handled';
      if (lease && !(error instanceof Stop && error.code === 'lease_lost')) {
        try { this.options.verification.releaseTarget(lease, this.clock() + 15 * 60_000); lease = null; } catch { /* lease expiry permits recovery */ }
      }
      return 'handled';
    } finally { this.busy = false; }
  }
}
