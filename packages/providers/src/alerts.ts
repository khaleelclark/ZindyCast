import { z } from 'zod';
import { AlertsDataSchema, CoordinatesSchema, type AlertsData } from '@zindycast/contracts';
import { ProviderError } from './index.js';

/** NWS primary sources checked 2026-09-11:
 * https://www.weather.gov/documentation/services-web-api (identifying User-Agent; free, unpublished quota)
 * https://api.weather.gov/openapi.json (Alert fields; expires is message expiry, ends is event end)
 * https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf (point matches county AND zone)
 * A missing polygon is retained as null, not synthesized from the requested point.
 * API/cache must replace snapshots, re-filter expired cached alerts, and expose retrieval age.
 */
const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const httpUrl = z.url().refine(value => ['https:', 'http:'].includes(new URL(value).protocol));
const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(position).min(4).refine(points => points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]);
const polygon = z.array(ring).min(1);
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: polygon }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon).min(1) }),
]).nullable();
const properties = z.object({
  id: z.string().min(1), event: z.string().min(1), headline: z.string().nullable(),
  severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
  urgency: z.enum(['Immediate', 'Expected', 'Future', 'Past', 'Unknown']),
  certainty: z.enum(['Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown']),
  sent: instant, effective: instant, onset: instant.nullable(), expires: instant, ends: instant.nullable(),
  status: z.enum(['Actual', 'Exercise', 'System', 'Test', 'Draft']),
  messageType: z.enum(['Alert', 'Update', 'Cancel', 'Ack', 'Error']),
  description: z.string(), instruction: z.string().nullable(), areaDesc: z.string(), senderName: z.string().min(1),
  web: httpUrl.nullable().optional(), affectedZones: z.array(httpUrl),
  references: z.array(z.object({ identifier: z.string().min(1), sent: instant, sender: z.string(), '@id': httpUrl.optional() })).default([]),
});
const collection = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.object({ type: z.literal('Feature'), id: httpUrl.optional(), geometry, properties })).max(500),
  pagination: z.object({ next: httpUrl.nullable().optional() }).optional(),
});
function malformed() { return new ProviderError('provider_error', 'NWS returned malformed or incomplete alerts.'); }
function retryAfter(value: string | null) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, Math.ceil((time - Date.now()) / 1000)) : undefined;
}
async function request(url: URL, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('NWS timed out', 'TimeoutError')), 8_000);
  try {
    let response: Response;
    // NWS documents redirects for common active-alert queries. Bound redirects and origin.
    for (let redirects = 0; ; redirects++) {
      response = await fetch(url, { signal: controller.signal, redirect: 'manual', headers: {
        Accept: 'application/geo+json', 'User-Agent': 'ZindyCast/0.1 (private family weather application)',
      } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects >= 2) throw malformed();
      const next = new URL(location, url);
      if (next.origin !== 'https://api.weather.gov' || !['/alerts', '/alerts/active'].includes(next.pathname) ||
          next.searchParams.get('point') !== url.searchParams.get('point') ||
          (next.pathname === '/alerts' && next.searchParams.get('active') !== 'true')) throw malformed();
      url = next;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(response.status === 429 ? 'rate_limited' : 'provider_error',
        response.status === 429 ? 'NWS request limit reached.' : 'NWS alerts are unavailable.',
        response.status, retryAfter(response.headers.get('retry-after')));
    }
    if (!/^application\/(geo\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel(); throw malformed();
    }
    const reader = response.body?.getReader();
    if (!reader) throw malformed();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw malformed(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('provider_error', controller.signal.aborted ? 'NWS alerts request timed out.' : 'NWS alerts request failed.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function getAlerts(latitude: number, longitude: number, signal?: AbortSignal): Promise<AlertsData> {
  signal?.throwIfAborted();
  const input = CoordinatesSchema.safeParse({ latitude, longitude });
  if (!input.success) throw new ProviderError('invalid_request', 'Valid latitude and longitude are required.');
  const url = new URL('https://api.weather.gov/alerts/active');
  url.searchParams.set('point', `${latitude},${longitude}`);
  const parsed = collection.safeParse(await request(url, signal));
  // Never turn a truncated response into an authoritative empty/partial success.
  if (!parsed.success || parsed.data.pagination?.next) throw malformed();
  const now = Date.now();
  const current = new Map<string, z.infer<typeof collection>['features'][number]>();
  for (const feature of parsed.data.features) {
    const p = feature.properties;
    if (p.status !== 'Actual' || Date.parse(p.sent) > now || Date.parse(p.effective) > now) continue;
    const previous = current.get(p.id);
    if (!previous || Date.parse(previous.properties.sent) < Date.parse(p.sent)) current.set(p.id, feature);
  }
  const superseded = new Set<string>();
  for (const { properties: p } of current.values()) {
    if (p.messageType !== 'Update' && p.messageType !== 'Cancel') continue;
    for (const ref of p.references) {
      const target = current.get(ref.identifier)?.properties;
      if (target && ref.identifier !== p.id && Date.parse(target.sent) <= Date.parse(p.sent) && Date.parse(ref.sent) <= Date.parse(p.sent)) {
        superseded.add(ref.identifier);
      }
    }
  }
  const alerts = [...current.values()].filter(({ properties: p }) =>
    !superseded.has(p.id) && (p.messageType === 'Alert' || p.messageType === 'Update') &&
    Date.parse(p.expires) > now && (p.ends === null || Date.parse(p.ends) > now),
  ).map(({ properties: p, geometry: shape, id }) => {
    const { references: _references, ...official } = p;
    // API feature links are authoritative source links when CAP omits its optional web field.
    const source = id && new URL(id).origin === 'https://api.weather.gov' ? id : `https://api.weather.gov/alerts/${encodeURIComponent(p.id)}`;
    return { ...official, web: p.web ?? source, geometry: shape };
  }).sort((a, b) => b.sent.localeCompare(a.sent) || a.id.localeCompare(b.id));
  return AlertsDataSchema.parse({ coordinates: input.data, retrievedAt: new Date(now).toISOString(), provider: 'NWS',
    alerts, attribution: 'Official alerts from the NOAA National Weather Service (https://www.weather.gov/).' });
}
