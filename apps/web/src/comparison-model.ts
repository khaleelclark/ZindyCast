import { ComparisonQuerySchema, ComparisonJobSchema, InstallationResponseSchema, type Location } from '@zindycast/contracts';
import { placeLabel } from './weather';
import { requestJson } from './request';
export type ComparisonQuery = ReturnType<typeof ComparisonQuerySchema.parse>;
export type ComparisonJob = ReturnType<typeof ComparisonJobSchema.parse>;
export type ComparisonResult = NonNullable<ComparisonJob['result']>;
export const fields = ['temperatureC', 'dewPointC', 'humidityPercent', 'windSpeedMs', 'precipitationMm'] as const;
export const latestComparisonDate = (now: number) => new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
export const comparisonLocation = (l: Location) => ({ id: `${l.latitude},${l.longitude}`, name: placeLabel(l).slice(0, 200), latitude: l.latitude, longitude: l.longitude });
export function comparisonSelection(locations: Location[], startDate: string, endDate: string, now: number): ComparisonQuery {
  const parsed = ComparisonQuerySchema.safeParse({ locations: locations.map(comparisonLocation), startDate, endDate });
  if (!parsed.success || endDate > latestComparisonDate(now)) throw new Error(`Choose 2–5 distinct saved places and 1–366 inclusive UTC days, from 1940-01-01 through ${latestComparisonDate(now)}.`);
  return parsed.data;
}
export const sameComparison = (a: ComparisonQuery, b: ComparisonQuery) => a.startDate === b.startDate && a.endDate === b.endDate && JSON.stringify(a.locations) === JSON.stringify(b.locations);
export function parseComparison(raw: unknown, query: ComparisonQuery, id?: string): ComparisonJob {
  const parsed = ComparisonJobSchema.safeParse(raw);
  if (!parsed.success) throw new Error('The comparison response is invalid.');
  const job = parsed.data;
  const bad = () => { throw new Error('The comparison response does not match its requested locations, dates, units or completeness.'); };
  if (!/^[a-f0-9-]{36}$/.test(job.id) || (id !== undefined && job.id !== id) || !sameComparison(job.query, query) || !Number.isSafeInteger(job.expiresAt) || job.expiresAt > 8.64e15 || job.expiresAt <= job.createdAt || (job.state === 'completed') !== (job.result !== null)) bad();
  const r = job.result;
  if (r) {
    const expected = (Date.parse(query.endDate) - Date.parse(query.startDate)) / 3_600_000 + 24;
    if (!sameComparison(r.plan.query, query) || r.plan.window.expectedHours !== expected || Date.parse(r.plan.window.startInclusive) !== Date.parse(query.startDate) || Date.parse(r.plan.window.endExclusive) !== Date.parse(query.endDate) + 86_400_000 || r.locations.length !== query.locations.length) bad();
    const units = { temperatureC: '°C', dewPointC: '°C', humidityPercent: '%', windSpeedMs: 'm/s', precipitationMm: 'mm' };
    r.locations.forEach((l, i) => {
      if (JSON.stringify(l.location) !== JSON.stringify(query.locations[i])) bad();
      fields.forEach(f => {
        const v = l.variables[f];
        if (v.unit !== units[f] || v.expectedCount !== expected || v.validCount + v.missingCount !== expected || v.absentSourceCount + v.nullValueCount !== v.missingCount || r.commonValidCounts[f] > v.validCount || v.status !== (v.validCount === expected ? 'complete' : v.validCount ? 'partial' : 'no_data') || (v.validCount === 0 ? [v.mean, v.min, v.max].some(n => n !== null) : [v.mean, v.min, v.max].some(n => n === null)) || (v.min !== null && v.max !== null && v.mean !== null && (v.min - 1e-9 > v.mean || v.mean > v.max + 1e-9))) bad();
      });
      const p = l.variables.precipitationMm;
      if ((p.validCount === 0) !== (p.sumAvailableMm === null) || (p.status === 'complete' ? p.totalMm !== p.sumAvailableMm : p.totalMm !== null)) bad();
      if (!l.sources.length || l.sources.some(s => s.query.latitude !== l.location.latitude || s.query.longitude !== l.location.longitude)) bad();
    });
  }
  return job;
}
export const installationKey = 'zindycast.installation.v1';
const storageFailure = 'Browser storage is unavailable. Comparison access cannot be saved; clearing storage loses installation settings and job access. No additional installation was registered. Restore storage access and retry in this tab.';
/** A durable pending marker prevents silent re-registration after uncertain responses/reloads. */
export function installationStore(storage: Pick<Storage, 'getItem' | 'setItem'>, register: (signal: AbortSignal) => Promise<unknown> = signal => requestJson('/api/v1/installations', signal, 20_000, { method: 'POST' })) {
  let memory: ReturnType<typeof InstallationResponseSchema.parse> | null = null;
  let pending: Promise<string> | null = null;
  function write(value: unknown) { try { const encoded = JSON.stringify(value); storage.setItem(installationKey, encoded); if (storage.getItem(installationKey) !== encoded) throw new Error(); } catch { throw new Error(storageFailure); } }
  function existing(now: number): string | null {
    if (memory) { if (memory.expiresAt <= now) throw new Error('Installation access has expired. Registration renewal is not available yet.'); write(memory); return memory.bearer; }
    let raw: string | null;
    try { raw = storage.getItem(installationKey); } catch { throw new Error(storageFailure); }
    if (!raw) return null;
    const parsed = InstallationResponseSchema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
    if (!parsed.success || !parsed.data.bearer || parsed.data.expiresAt <= now) throw new Error('Installation access is expired, incomplete or could not be recovered. A previous registration may have succeeded. Automatic registration is stopped to avoid duplicates; clearing browser data would lose settings and job access.');
    memory = parsed.data; return memory.bearer;
  }
  return { existing, ensure(signal: AbortSignal): Promise<string> {
    if (pending) return pending;
    pending = (async () => {
      signal.throwIfAborted();
      const token = existing(Date.now()); if (token) return token;
      write({ pending: true });
      let raw: unknown;
      try { raw = await register(signal); } catch { throw new Error('Installation registration could not be confirmed. It may have succeeded; automatic repeat registration is stopped to prevent duplicates. Keep this browser’s data for recovery.'); }
      const parsed = InstallationResponseSchema.safeParse(raw);
      if (!parsed.success || !parsed.data.bearer || parsed.data.expiresAt <= Date.now()) throw new Error('Installation registration returned an invalid response. Automatic repeat registration is stopped.');
      memory = parsed.data; write(memory); return memory.bearer;
    })().finally(() => { pending = null; });
    return pending;
  } };
}
