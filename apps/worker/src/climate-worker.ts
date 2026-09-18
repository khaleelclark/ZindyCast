import { randomUUID } from 'node:crypto';
import { ClimateQuerySchema, ClimateResultSchema, ComparisonWeatherDataSchema, type ReanalysisQuery, type ComparisonWeatherData } from '@zindycast/contracts';
import { createClimatePlan, aggregateClimate } from '@zindycast/comparison';
import type { ClimateChunkResult } from '../../../packages/comparison/src/climate';
import { fetchComparisonWeather } from '@zindycast/history';
import type { JobRepository, JobLease } from '@zindycast/jobs';
import type { InstallationRepository } from '@zindycast/installations';
import type { SharedStorage } from '@zindycast/storage';
const DAY = 86400000;
export interface ClimateWorkerOptions {
  jobs: JobRepository; installations: InstallationRepository; storage: SharedStorage;
  fetchWeather?: (query: ReanalysisQuery, signal?: AbortSignal) => Promise<ComparisonWeatherData>;
  clock?: () => number; owner?: string; pollMs?: number;
}
class Stop extends Error { constructor(readonly code: string) { super(code); } }
/** Exact shared API climate weather cache identity; property insertion order is intentional. */
export function climateWeatherCacheKey(q: ReanalysisQuery): string {
  return 'climate:era5:9fields:utc:v2:' + JSON.stringify({ latitude: q.latitude, longitude: q.longitude, startDate: q.startDate, endDate: q.endDate });
}
/** One in-process job at a time; SQLite leases also fence competing processes.
 * No automatic failed-job retry. A caller may invoke runOnce again after an idle result.
 */
export class ClimateWorker {
  private busy = false;
  private readonly clock: () => number;
  private readonly owner: string;
  private readonly pollMs: number;
  constructor(private readonly options: ClimateWorkerOptions) {
    this.clock = options.clock ?? Date.now; this.owner = options.owner ?? `worker-${randomUUID()}`;
    this.pollMs = options.pollMs ?? 250;
    if (!Number.isInteger(this.pollMs) || this.pollMs < 5 || this.pollMs > 1000) throw new RangeError('Invalid polling interval');
  }
  async runOnce(shutdown?: AbortSignal): Promise<'idle' | 'handled' | 'busy'> {
    if (this.busy) return 'busy';
    if (shutdown?.aborted) return 'idle';
    this.busy = true;
    const { jobs, installations, storage } = this.options;
    let id: string | undefined;
    let lease: JobLease | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const controller = new AbortController();
    const onShutdown = () => controller.abort(new Stop('shutdown'));
    shutdown?.addEventListener('abort', onShutdown, { once: true });
    const started = this.clock();
    const check = () => {
      if (shutdown?.aborted) throw new Stop('shutdown');
      controller.signal.throwIfAborted();
      if (this.clock() - started >= 15 * 60_000) throw new Stop('job_time_limit');
      const current = jobs.get(id!);
      if (!current || current.state !== 'running' || current.lease?.token !== lease?.token || !current.lease || current.lease.expiresAt <= this.clock()) throw new Stop('lease_lost');
      if (!installations.isJobActive(id!)) { jobs.cancel(id!); throw new Stop('ownership_inactive'); }
      if (current.lease.expiresAt - this.clock() < 20_000) {
        const renewed = jobs.renew(lease!, 30_000);
        if (!renewed) throw new Stop('lease_lost');
        lease = renewed;
      }
    };
    try {
      const job = jobs.acquire(this.owner, 30_000, 'climate-comparison-v2');
      if (!job) return 'idle';
      id = job.id; lease = job.lease!;
      check();
      const query = ClimateQuerySchema.parse(job.payload);
      const plan = createClimatePlan(query);
      const latest = new Date(Math.floor(this.clock() / DAY) * DAY - 5 * DAY).toISOString().slice(0, 10);
      if (plan.fetchEndDate > latest) throw new Stop('archive_not_available');
      heartbeat = setInterval(() => { try { check(); } catch (error) { controller.abort(error); } }, this.pollMs);
      // Canonical plan caps at 305 chunks; data caps each chunk at 744 rows.
      // Keep typed weather only (no retained raw response bodies); aggregate once.
      const chunks: ClimateChunkResult[] = [];
      for (const chunk of plan.chunks) {
        check();
        const q = chunk.query, key = climateWeatherCacheKey(q);
        const validate = (value: unknown): ComparisonWeatherData => {
          const data = ComparisonWeatherDataSchema.parse(value);
          if (Object.entries(q).some(([k, v]) => data.query[k as keyof ReanalysisQuery] !== v) || Date.parse(data.provenance.retrievedAt) > this.clock()) throw new Stop('invalid_history_data');
          // The v2 schema checks the canonical fixed nine-field ERA5 request URL.
          return data;
        };
        const cached = storage.get(key);
        let data: ComparisonWeatherData;
        if (cached?.freshness === 'fresh') data = validate(cached.value);
        else {
          const cacheLease = storage.acquireLease(key, this.owner, 20_000);
          if (!cacheLease) throw new Stop('history_refresh_busy');
          try {
            const again = storage.get(key);
            if (again?.freshness === 'fresh') data = validate(again.value);
            else {
              check();
              const days = (Date.parse(q.endDate) - Date.parse(q.startDate)) / DAY + 1;
              if (!storage.reserveQuota('open-meteo', Math.ceil(days / 14)).allowed) throw new Stop('provider_budget_denied');
              const fetchController = new AbortController();
              const abort = () => fetchController.abort(controller.signal.reason);
              controller.signal.addEventListener('abort', abort, { once: true });
              const timer = setTimeout(() => fetchController.abort(new Stop('provider_timeout')), 10_000);
              let rejectAbort: (error: unknown) => void = () => {};
              const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
              const reject = () => rejectAbort(fetchController.signal.reason);
              fetchController.signal.addEventListener('abort', reject, { once: true });
              try {
                controller.signal.throwIfAborted();
                data = validate(await Promise.race([(this.options.fetchWeather ?? fetchComparisonWeather)(q, fetchController.signal), aborted]));
                check();
                const retrievedAt = Date.parse(data.provenance.retrievedAt);
                // Never extend source retrieval freshness because an old response arrived now.
                if (retrievedAt + DAY <= this.clock()) throw new Stop('history_response_stale');
                if (!storage.set(key, data, { retrievedAt, expiresAt: retrievedAt + DAY, staleUntil: retrievedAt + DAY }, cacheLease)) throw new Stop('cache_lease_lost');
              } finally {
                clearTimeout(timer); controller.signal.removeEventListener('abort', abort);
                fetchController.signal.removeEventListener('abort', reject);
              }
            }
          } finally { storage.releaseLease(cacheLease); }
        }
        check();
        chunks.push({ chunkId: chunk.id, data });
        if (!jobs.progress(lease!, chunks.length / plan.chunks.length)) throw new Stop('lease_lost');
      }
      const result = ClimateResultSchema.parse(aggregateClimate(plan, chunks));
      check();
      if (!jobs.complete(lease!, result)) throw new Stop('lease_lost');
      return 'handled';
    } catch (error) {
      if (id && lease && !shutdown?.aborted) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        if (!(reason instanceof Stop && reason.code === 'lease_lost')) jobs.fail(lease, reason instanceof Stop ? reason.code : 'climate_comparison_failed');
      }
      if (!id) throw error;
      return 'handled';
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      shutdown?.removeEventListener('abort', onShutdown);
      try {
        if (id && !shutdown?.aborted) {
          if (jobs.closeTerminalAdmission(id)) installations.releaseJob(id);
        }
      } finally { this.busy = false; }
    }
  }
}
