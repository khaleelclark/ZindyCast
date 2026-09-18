import { randomUUID } from 'node:crypto';
import { SharedStorage, type JsonValue } from '@zindycast/storage';
import { ProviderError } from '@zindycast/providers';
import { z } from 'zod';
export class CachedRequests {
  private readonly owner = randomUUID();
  private readonly pending = new Map<string, Promise<{ data: unknown; freshness: 'fresh' | 'stale' }>>();
  constructor(private readonly storage: SharedStorage) {}
  async get<T>(key: string, schema: z.ZodType<T>, weight: number, ttl: number, stale: number, fetcher: () => Promise<T>, provider = 'open-meteo', maxAgeMs = ttl): Promise<{data:T;freshness:'fresh'|'stale'}> {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new RangeError('Invalid refresh age');
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || !Number.isSafeInteger(stale) || stale < 0 || !Number.isSafeInteger(ttl + stale)) throw new RangeError('Invalid cache lifetime');
    const read = (): {data:T;freshness:'fresh'|'stale'} | null => {
      const value = this.storage.get(key); if (!value) return null;
      // A retained record cannot extend the current caller's freshness policy.
      const now = Date.now(), expiresAt = Math.min(value.expiresAt, value.retrievedAt + ttl, value.retrievedAt + maxAgeMs);
      if (now < value.retrievedAt || now >= Math.min(value.staleUntil, expiresAt + stale)) return null;
      const parsed = schema.safeParse(value.value);
      return parsed.success ? {data:parsed.data,freshness:now < expiresAt ? 'fresh' : 'stale'} : null;
    };
    const hit = read();
    if (hit?.freshness === 'fresh') return hit;
    const existing = this.pending.get(key);
    if (existing) {
      await existing;
      // Recheck this caller's schema and deadlines after waiting, including exact
      // query refinements. A shared key alone is not a runtime type guarantee.
      const result = read();
      if (!result) throw new Error('Coalesced cache result does not satisfy request');
      return result;
    }
    if (this.pending.size >= 16) throw new ProviderError('rate_limited','Concurrent request limit',429,2);
    const work = (async () => {
      const lease = this.storage.acquireLease(key, this.owner, 15000);
      if (!lease) { if (hit) return hit; throw new ProviderError('rate_limited','Refresh already in progress',429,2); }
      try {
        const completed = read(); if (completed?.freshness === 'fresh') return completed;
        const quota = this.storage.reserveQuota(provider,weight);
        if (!quota.allowed) throw new ProviderError('rate_limited','Shared provider budget exhausted',429,quota.retryAt === null ? 60 : Math.max(1,Math.ceil((quota.retryAt-Date.now())/1000)));
        const data = schema.parse(await fetcher());
        const now = Date.now();
        if (!this.storage.set(key, JSON.parse(JSON.stringify(data)) as JsonValue, {retrievedAt:now,expiresAt:now+ttl,staleUntil:now+ttl+stale},lease)) throw new Error('Refresh lease expired');
        return {data,freshness:'fresh' as const};
      } catch(error) { const fallback=read(); if(fallback) return fallback; throw error; }
      finally { this.storage.releaseLease(lease); }
    })();
    this.pending.set(key,work);
    try { return await work; } finally { this.pending.delete(key); }
  }
}
