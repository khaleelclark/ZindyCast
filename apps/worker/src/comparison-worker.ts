import { randomUUID } from 'node:crypto';
import { ComparisonQuerySchema, ComparisonResultSchema, ReanalysisDataSchema, type ReanalysisQuery, type ReanalysisData } from '@zindycast/contracts';
import { createComparisonPlan, aggregateComparison, type ComparisonChunkResult } from '@zindycast/comparison';
import { getReanalysis } from '@zindycast/history';
import type { JobRepository, JobLease } from '@zindycast/jobs';
import type { InstallationRepository } from '@zindycast/installations';
import type { SharedStorage } from '@zindycast/storage';
const DAY = 86400000;
export interface WorkerOptions {
  jobs: JobRepository; installations: InstallationRepository; storage: SharedStorage;
  fetchHistory?: (query: ReanalysisQuery, signal?: AbortSignal) => Promise<ReanalysisData>;
  clock?: () => number; owner?: string; pollMs?: number;
}
class Stop extends Error { constructor(readonly code: string) { super(code); } }
/** Exact shared API history cache identity; property insertion order is intentional. */
export function historyCacheKey(q: ReanalysisQuery): string {
  return 'history:era5:5fields:utc:v1:' + JSON.stringify({ latitude: q.latitude, longitude: q.longitude, startDate: q.startDate, endDate: q.endDate });
}
/** One in-process job at a time; SQLite leases also fence competing processes.
 * No automatic failed-job retry. A caller may invoke runOnce again after an idle result.
 */
export class ComparisonWorker {
  private busy = false;
  private readonly clock: () => number;
  private readonly owner: string;
  private readonly pollMs: number;
  constructor(private readonly options: WorkerOptions) {
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
      const job = jobs.acquire(this.owner, 30_000, 'comparison-v1');
      if (!job) return 'idle';
      id = job.id; lease = job.lease!;
      check();
      const query = ComparisonQuerySchema.parse(job.payload);
      const plan = createComparisonPlan(query);
      const latest = new Date(Math.floor(this.clock() / DAY) * DAY - 5 * DAY).toISOString().slice(0, 10);
      if (plan.fetchEndDate > latest) throw new Stop('archive_not_available');
      heartbeat = setInterval(() => { try { check(); } catch (error) { controller.abort(error); } }, this.pollMs);
      const chunks: ComparisonChunkResult[] = [];
      for (const chunk of plan.chunks) {
        check();
        const q = chunk.query, key = historyCacheKey(q);
        const validate = (value: unknown): ReanalysisData => {
          const data = ReanalysisDataSchema.parse(value);
          if (Object.entries(q).some(([k, v]) => data.query[k as keyof ReanalysisQuery] !== v) || Date.parse(data.provenance.retrievedAt) > this.clock()) throw new Stop('invalid_history_data');
          const url = new URL(data.provenance.requestUrl);
          const expected = { latitude: String(q.latitude), longitude: String(q.longitude), start_date: q.startDate, end_date: q.endDate,
            models: 'era5', hourly: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,dew_point_2m',
            timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm', cell_selection: 'land' };
          if (url.origin !== 'https://archive-api.open-meteo.com' || url.pathname !== '/v1/archive' || url.username || url.password || url.hash ||
            [...url.searchParams].length !== Object.keys(expected).length || Object.entries(expected).some(([k, v]) => url.searchParams.getAll(k).length !== 1 || url.searchParams.get(k) !== v)) throw new Stop('invalid_history_data');
          return data;
        };
        const cached = storage.get(key);
        let data: ReanalysisData;
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
                data = validate(await Promise.race([(this.options.fetchHistory ?? getReanalysis)(q, fetchController.signal), aborted]));
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
      const result = ComparisonResultSchema.parse(aggregateComparison(plan, chunks));
      check();
      if (!jobs.complete(lease!, result)) throw new Stop('lease_lost');
      return 'handled';
    } catch (error) {
      if (id && lease && !shutdown?.aborted) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        if (!(reason instanceof Stop && reason.code === 'lease_lost')) jobs.fail(lease, reason instanceof Stop ? reason.code : 'comparison_failed');
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
