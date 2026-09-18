import { z } from 'zod';
import { ProviderError } from './index.js';
import { WildfireBboxSchema, WildfireDataSchema, type WildfireBbox, type WildfireData, wildfireLayers, WILDFIRE_MAX_PAGES, WILDFIRE_PAGE_SIZE, WILDFIRE_MAX_VERTICES, wildfireIncidentAttributes, wildfirePerimeterAttributes, wildfireIncidentFeature, wildfirePerimeterFeature, wildfireNormalizeId, wildfireTime } from '@zindycast/contracts';
export { WildfireBboxSchema, WildfirePolygonSchema, WildfireIncidentSchema, WildfirePerimeterSchema, WildfireDataSchema, type WildfireBbox, type WildfireData, type WildfireIncident, type WildfirePerimeter } from '@zindycast/contracts';
const MAX_BYTES = 8_000_000;
function unavailable(message = 'NIFC returned malformed or incomplete wildfire data.'): never {
  throw new ProviderError('provider_error', message);
}
function retryAfter(value: string | null) {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

/** Bounded viewport traversal. No retries, external URLs, cache, notification or evacuation semantics. */
export async function getWildfires(bbox: WildfireBbox, signal?: AbortSignal): Promise<WildfireData> {
  signal?.throwIfAborted();
  const input = WildfireBboxSchema.safeParse(bbox);
  if (!input.success) throw new ProviderError('invalid_request', 'Valid non-wrapping bbox up to 10 × 10 degrees required.');
  const query = input.data; // snapshot caller-owned object
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const deadline = Date.now() + 10_000;
  const timer = setTimeout(() => controller.abort(new DOMException('NIFC deadline', 'TimeoutError')), 10_000);
  let totalBytes = 0, totalVertices = 0;
  // Race fetch AND body reads so even an uncooperative stream cannot leave a caller waiting.
  const bounded = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(controller.signal.reason); };
    const cleanup = () => controller.signal.removeEventListener('abort', abort);
    controller.signal.addEventListener('abort', abort, { once: true });
    operation.then(v => { cleanup(); resolve(v); }, e => { cleanup(); reject(e); });
    if (controller.signal.aborted) abort();
  });
  const fetchJson = async (url: URL): Promise<unknown> => {
    controller.signal.throwIfAborted();
    const response = await bounded(fetch(url, { signal: controller.signal, redirect: 'error', headers: {
      Accept: 'application/json', 'User-Agent': 'ZindyCast/0.1 (private family weather application)',
    } }));
    if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderError(response.status === 429 ? 'rate_limited' : 'provider_error', 'NIFC wildfire data unavailable.',
        response.status, retryAfter(response.headers.get('retry-after')));
    }
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES - totalBytes) { void response.body?.cancel().catch(() => {}); unavailable('NIFC byte limit exceeded.'); }
    const reader = response.body?.getReader();
    if (!reader) unavailable();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await bounded(reader.read());
        if (done) break;
        size += value.byteLength; totalBytes += value.byteLength;
        if (totalBytes > MAX_BYTES) unavailable('NIFC byte limit exceeded.');
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  };
  async function readLayer(kind: keyof typeof wildfireLayers) {
    const features: Array<z.infer<typeof wildfireIncidentFeature> | z.infer<typeof wildfirePerimeterFeature>> = [];
    let lastId = -1;
    const seen = new Set<string>();
    for (let page = 0; page < WILDFIRE_MAX_PAGES; page++) {
      const url = new URL(`${wildfireLayers[kind]}/query`);
      const fields = kind === 'incidents' ? Object.keys(wildfireIncidentAttributes.shape) : Object.keys(wildfirePerimeterAttributes.shape);
      // Keyset pagination avoids offset skips when earlier current-view rows disappear.
      const params = { f: 'json', where: `OBJECTID>${lastId}`, outFields: fields.join(','),
        geometry: `${query.west},${query.south},${query.east},${query.north}`, geometryType: 'esriGeometryEnvelope',
        inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true',
        returnZ: 'false', returnM: 'false', orderByFields: 'OBJECTID ASC', resultRecordCount: String(WILDFIRE_PAGE_SIZE) };
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const response = await fetchJson(url);
      const envelope = z.object({
        geometryType: z.literal(kind === 'incidents' ? 'esriGeometryPoint' : 'esriGeometryPolygon'),
        spatialReference: z.object({ wkid: z.literal(4326), latestWkid: z.literal(4326).optional() }),
        exceededTransferLimit: z.boolean().optional(),
        features: z.array(kind === 'incidents' ? wildfireIncidentFeature : wildfirePerimeterFeature).max(WILDFIRE_PAGE_SIZE),
      }).safeParse(response);
      if (!envelope.success) unavailable();
      for (const feature of envelope.data.features) {
        const a = feature.attributes, global = wildfireNormalizeId(a.GlobalID)!;
        if (a.OBJECTID <= lastId || seen.has(global)) unavailable('NIFC pagination identity mismatch.');
        lastId = a.OBJECTID; seen.add(global);
        if (feature.geometry && 'rings' in feature.geometry) {
          for (const r of feature.geometry.rings) totalVertices += r.length;
          if (totalVertices > WILDFIRE_MAX_VERTICES) unavailable('NIFC geometry limit exceeded.');
        }
        features.push(feature);
      }
      // ArcGIS omits exceededTransferLimit when no more results. A full page with
      // omitted flag is probed again conservatively; explicit false is terminal.
      const more = envelope.data.exceededTransferLimit ?? envelope.data.features.length === WILDFIRE_PAGE_SIZE;
      if (!more) return { features, metadata: {
        sourceUrl: wildfireLayers[kind], retrievedAt: new Date().toISOString(), pages: page + 1,
        publishedRecords: features.length, availability: features.length ? 'published_records' : 'no_published_records',
        pagination: 'complete', snapshotConsistency: 'not_atomic', sourceUpdatedAt: null,
      } };
      if (!envelope.data.features.length) unavailable('NIFC pagination made no progress.');
    }
    unavailable('NIFC viewport exceeds the bounded pagination limit; use a smaller viewport.');
  }
  try {
    // Sequential to share one deadline/byte bound; callers budget up to eight GETs.
    const incidents = await readLayer('incidents');
    const perimeters = await readLayer('perimeters');
    const result = WildfireDataSchema.parse({
      bbox: query, provider: 'NIFC / WFIGS', retrievedAt: new Date().toISOString(),
      coordinateReferenceSystem: 'EPSG:4326', geometryFormat: 'esri_json',
      classification: 'published_incident_mapping', coverage: 'unknown',
      incidents: incidents.features.map(f => {
        const { attributes: a, geometry } = wildfireIncidentFeature.parse(f);
        return { objectId: a.OBJECTID, globalId: a.GlobalID, sourceGlobalId: a.SourceGlobalID,
          irwinId: a.IrwinID, normalizedIrwinId: wildfireNormalizeId(a.IrwinID), uniqueFireIdentifier: a.UniqueFireIdentifier,
          name: a.IncidentName, category: a.IncidentTypeCategory, incidentUpdatedAt: wildfireTime(a.ModifiedOnDateTime_dt), geometry };
      }),
      perimeters: perimeters.features.map(f => {
        const { attributes: a, geometry } = wildfirePerimeterFeature.parse(f);
        const irwinId = a.poly_IRWINID ?? a.attr_IrwinID;
        return { objectId: a.OBJECTID, globalId: a.GlobalID, irwinId, normalizedIrwinId: wildfireNormalizeId(irwinId),
          polygonIrwinId: a.poly_IRWINID, attributeIrwinId: a.attr_IrwinID,
          polygonSourceGlobalId: a.poly_SourceGlobalID, incidentSourceGlobalId: a.attr_SourceGlobalID,
          uniqueFireIdentifier: a.attr_UniqueFireIdentifier, name: a.attr_IncidentName, category: a.attr_IncidentTypeCategory,
          incidentUpdatedAt: wildfireTime(a.attr_ModifiedOnDateTime_dt), polygonCapturedAt: wildfireTime(a.poly_PolygonDateTime),
          polygonUpdatedAt: wildfireTime(a.poly_DateCurrent), polygonCreatedAt: wildfireTime(a.poly_CreateDate), geometry };
      }),
      sources: { incidents: incidents.metadata, perimeters: perimeters.metadata },
      attribution: 'NIFC / WFIGS; IRWIN / DOI, USDA Forest Service, partner agencies and NWCG. https://www.nifc.gov/fire-information/maps',
      limitations: [
        'Dynamic published incident mapping; completeness and accuracy are not guaranteed. Not a legal document.',
        'WF = wildfire; RX = prescribed fire; CX = incident complex; null = source type unknown.',
        'No matching published records does not mean no fires. Not every incident has a perimeter.',
        'Perimeters are not evacuation zones, spread predictions, or assurances of safety outside them.',
        'Disappearance from the current feed does not establish extinguishment. Source timestamps are independent.',
        'Pagination completes a changing current view, not an atomic snapshot. Incident and perimeter retrievals are independent.',
      ],
    });
    controller.signal.throwIfAborted();
    if (Date.now() >= deadline) unavailable('NIFC wildfire request timed out.');
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof ProviderError) throw error;
    return unavailable(controller.signal.aborted ? 'NIFC wildfire request timed out.' : 'NIFC returned malformed or unavailable wildfire data.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
