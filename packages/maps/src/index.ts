/** Server-only nowCOAST adapter. Never import into a browser bundle. */
import { Buffer } from 'node:buffer';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const ENDPOINT = 'https://nowcoast.noaa.gov/geoserver/ows';
export const CAPABILITIES_URL = `${ENDPOINT}?service=WMS&version=1.3.0&request=GetCapabilities`;
export const MAP_LIMITS = Object.freeze({ metadataBytes: 2 * 1024 * 1024, imageBytes: 8 * 1024 * 1024, timeoutMs: 12000, maxDimension: 1024, maxPixels: 1024 * 1024, maxTimes: 2048 });
export const PRODUCT_IDS = ['radar-conus', 'radar-alaska', 'radar-hawaii', 'satellite-goes-infrared', 'satellite-global-infrared'] as const;
export type ProductId = typeof PRODUCT_IDS[number];
export type MapProjection = 'CRS:84' | 'EPSG:3857';
export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
export type Bbox = readonly [west: number, south: number, east: number, north: number];
const DEFINITIONS = {
  'radar-conus': { layer: 'weather_radar:conus_base_reflectivity_mosaic', region: 'CONUS', kind: 'radar', cadenceMinutes: 4 },
  'radar-alaska': { layer: 'weather_radar:alaska_base_reflectivity_mosaic', region: 'Alaska', kind: 'radar', cadenceMinutes: 4 },
  'radar-hawaii': { layer: 'weather_radar:hawaii_base_reflectivity_mosaic', region: 'Hawaii', kind: 'radar', cadenceMinutes: 4 },
  'satellite-goes-infrared': { layer: 'satellite:goes_longwave_imagery', region: 'GOES East/West advertised extent', kind: 'infrared', cadenceMinutes: 5 },
  'satellite-global-infrared': { layer: 'satellite:global_longwave_imagery_mosaic', region: 'Global advertised extent', kind: 'infrared', cadenceMinutes: 60 },
} as const;
export interface MapProduct {
  id: ProductId; layer: string; title: string; description: string; region: string;
  kind: 'radar' | 'infrared'; classification: 'observed'; temporalKind: 'observed_history';
  status: 'available' | 'unavailable'; unavailableReason: string | null;
  supportedProjections?: MapProjection[];
  extent: Bbox | null; extentMeaning: 'advertised_rectangle_not_coverage_mask';
  coverageState: 'unknown'; coverageEvidence: 'none'; coverageMessage: string;
  times: string[]; defaultTime: string | null; nearestValue: boolean;
  approximateCadenceMinutes: number; documentedLatencyMinutes: readonly [number, number] | null;
  legend: { url: string; kind: 'reflectivity' | 'illustrative'; units: 'dBZ' | null; explanation: string };
  attribution: string; sourceUrl: string;
}
export interface MapCatalog {
  provider: 'NOAA nowCOAST'; version: 'nowcoast-wms-v1'; retrievedAt: string;
  sourceUrl: string; products: MapProduct[];
}
export class MapError extends Error {
  constructor(public readonly code: 'invalid_request' | 'invalid_catalog' | 'provider_error' | 'response_too_large' | 'outside_extent' | 'unavailable' | 'rate_limited', message: string, public readonly retryAfterSeconds?: number) { super(message); this.name = 'MapError'; }
}
function fail(code: MapError['code'], message: string): never { throw new MapError(code, message); }
function productId(value: string): ProductId {
  if (!(PRODUCT_IDS as readonly string[]).includes(value)) fail('invalid_request', 'Unknown map product');
  return value as ProductId;
}
function iso(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail('invalid_catalog', 'Expected UTC source instant');
  const normalized = value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z');
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== normalized) fail('invalid_catalog', 'Invalid UTC calendar instant');
  return value;
}
function validateBbox(value: Bbox): void {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite) || value[0] < -180 || value[2] > 180 || value[1] < -90 || value[3] > 90 || value[0] >= value[2] || value[1] >= value[3]) fail('invalid_request', 'Expected non-crossing CRS:84 west,south,east,north bounds; split antimeridian requests');
}
function requestUrl(params: Record<string, string>): URL {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ service: 'WMS', version: '1.3.0', ...params }).toString();
  return url;
}
function baseProduct(id: ProductId): MapProduct {
  const def = DEFINITIONS[id]; const radar = def.kind === 'radar';
  return { id, layer: def.layer, title: id, description: '', region: def.region, kind: def.kind,
    classification: 'observed', temporalKind: 'observed_history', status: 'unavailable', unavailableReason: 'Layer not advertised',
    extent: null, extentMeaning: 'advertised_rectangle_not_coverage_mask', coverageState: 'unknown', coverageEvidence: 'none',
    coverageMessage: radar ? 'Radar coverage is not verified; blank areas may have no return or missing data.' : 'Advertised extent is not a verified per-pixel coverage mask.',
    times: [], defaultTime: null, nearestValue: false, approximateCadenceMinutes: def.cadenceMinutes,
    documentedLatencyMinutes: id === 'satellite-global-infrared' ? [120, 180] : null,
    legend: { url: requestUrl({ request: 'GetLegendGraphic', format: 'image/png', layer: def.layer }).href,
      kind: radar ? 'reflectivity' : 'illustrative', units: radar ? 'dBZ' : null,
      explanation: radar ? 'Radar reflectivity, not rainfall depth or certainty of rain at the surface.' : 'Infrared cloud/surface patterns. Provider legend is illustrative, not a validated Celsius scale or surface air temperature.' },
    attribution: radar ? 'NOAA nowCOAST; NWS / OAR MRMS' : 'NOAA nowCOAST; NOAA / NESDIS satellite imagery', sourceUrl: 'https://nowcoast.noaa.gov/' };
}
type XmlNode = Record<string, unknown>;
function record(value: unknown): XmlNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_catalog', 'Invalid metadata structure');
  return value as XmlNode;
}
function list(value: unknown): unknown[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length > 20000) fail('invalid_catalog', 'Invalid metadata text');
  return value;
}
/** Parse only bounded WMS 1.3.0 metadata. Per-product defects do not disable other layers. */
export function parseMapCatalog(xml: string, retrievedAt: string): MapCatalog {
  iso(retrievedAt);
  if (Buffer.byteLength(xml, 'utf8') > MAP_LIMITS.metadataBytes) fail('response_too_large', 'Map metadata exceeds limit');
  // Reject DTD/entities entirely; bound nesting before invoking the XML library.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('invalid_catalog', 'XML DTDs and entity declarations are forbidden');
  let depth = 0; let count = 0;
  for (const match of xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '').matchAll(/<\/?[A-Za-z_][^>]*>/g)) {
    const token = match[0]; count++;
    if (token.startsWith('</')) depth--; else if (!token.endsWith('/>')) depth++;
    if (depth > 64 || count > 20000) fail('invalid_catalog', 'XML complexity exceeds limit');
  }
  if (XMLValidator.validate(xml) !== true) fail('invalid_catalog', 'Malformed XML');
  const tree = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, maxNestedTags: 64, processEntities: { enabled: true, maxTotalExpansions: 20000, maxExpandedLength: MAP_LIMITS.metadataBytes, maxEntityCount: 5 } }).parse(xml);
  const root = record(record(tree).WMS_Capabilities);
  if (root['@_version'] !== '1.3.0') fail('invalid_catalog', 'Expected WMS 1.3.0');
  const layers = new Map<string, XmlNode[]>();
  function visit(value: unknown): void {
    for (const raw of list(value)) {
      const node = record(raw);
      if (typeof node.Name === 'string') layers.set(node.Name, [...(layers.get(node.Name) ?? []), node]);
      visit(node.Layer);
    }
  }
  visit(record(root.Capability).Layer);
  const products = PRODUCT_IDS.map(id => {
    const result = baseProduct(id); const matches = layers.get(result.layer);
    if (!matches) return result;
    try {
      if (matches.length !== 1) fail('invalid_catalog', 'Duplicate layer');
      const node = matches[0];
      // Require explicit audited fields; changed inheritance/interval encoding fails closed.
      if (!list(node.CRS).includes('CRS:84')) fail('invalid_catalog', 'CRS:84 not advertised on layer');
      const bounds = record(node.EX_GeographicBoundingBox);
      const keys = ['westBoundLongitude', 'southBoundLatitude', 'eastBoundLongitude', 'northBoundLatitude'];
      const extent = keys.map(key => {
        const text = string(bounds[key]); if (!text.trim()) fail('invalid_catalog', 'Empty extent'); return Number(text);
      }) as unknown as Bbox;
      validateBbox(extent);
      const dimensions = list(node.Dimension).map(record).filter(d => d['@_name'] === 'time');
      if (dimensions.length !== 1 || dimensions[0]['@_units'] !== 'ISO8601') fail('invalid_catalog', 'Missing ISO8601 time dimension');
      const dimension = dimensions[0]; const rawTimes = string(dimension['#text']).split(',').map(t => t.trim());
      if (!rawTimes.length || rawTimes.length > MAP_LIMITS.maxTimes) fail('invalid_catalog', 'Time list exceeds limit');
      const times = rawTimes.map(iso).sort((a,b) => Date.parse(a) - Date.parse(b));
      if (new Set(times.map(Date.parse)).size !== times.length) fail('invalid_catalog', 'Duplicate time instant');
      const rawDefault = dimension['@_default'];
      const defaultTime = rawDefault === undefined ? null : times.find(t => Date.parse(t) === Date.parse(iso(rawDefault))) ?? null;
      if (rawDefault !== undefined && defaultTime === null) fail('invalid_catalog', 'Default time is not advertised');
      return { ...result, title: string(node.Title), description: string(node.Abstract), status: 'available' as const,
        unavailableReason: null, supportedProjections: (['CRS:84', 'EPSG:3857'] as const).filter(crs => list(node.CRS).includes(crs)), extent, times, defaultTime, nearestValue: dimension['@_nearestValue'] === '1' };
    } catch (error) {
      if (!(error instanceof MapError)) throw error;
      return { ...result, unavailableReason: error.message };
    }
  });
  return { provider: 'NOAA nowCOAST', version: 'nowcoast-wms-v1', retrievedAt, sourceUrl: CAPABILITIES_URL, products };
}

/** Intersection of request rectangle and advertised extent only; never a sensor coverage claim. */
export function extentRelation(bbox: Bbox, extent: Bbox): 'inside' | 'partial' | 'outside' {
  validateBbox(bbox); validateBbox(extent);
  if (bbox[2] <= extent[0] || bbox[0] >= extent[2] || bbox[3] <= extent[1] || bbox[1] >= extent[3]) return 'outside';
  return bbox[0] >= extent[0] && bbox[1] >= extent[1] && bbox[2] <= extent[2] && bbox[3] <= extent[3] ? 'inside' : 'partial';
}
/** EPSG:3857 spherical Mercator meters, x/y axis order. Reject polar or wrapping bounds rather than silently changing image corners. */
export function projectWebMercatorBbox(bbox: Bbox): Bbox {
  validateBbox(bbox);
  if (bbox[1] < -WEB_MERCATOR_MAX_LATITUDE || bbox[3] > WEB_MERCATOR_MAX_LATITUDE) fail('invalid_request', 'Web Mercator latitude exceeds 85.05112878 degrees');
  const x = (longitude: number) => 6378137 * longitude * Math.PI / 180;
  const y = (latitude: number) => latitude === 0 ? 0 : 6378137 * Math.asinh(Math.tan(latitude * Math.PI / 180));
  return [x(bbox[0]), y(bbox[1]), x(bbox[2]), y(bbox[3])];
}
export function buildMapRequest(id: string, bbox: Bbox, width: number, height: number, time: string, catalog: MapCatalog, projection: MapProjection = 'CRS:84'): URL {
  const selectedId = productId(id); validateBbox(bbox);
  if (projection !== 'CRS:84' && projection !== 'EPSG:3857') fail('invalid_request', 'Unsupported map projection');
  const projectedBbox = projection === 'EPSG:3857' ? projectWebMercatorBbox(bbox) : bbox;
  if (![width,height].every(v => Number.isInteger(v) && v >= 1 && v <= MAP_LIMITS.maxDimension) || width * height > MAP_LIMITS.maxPixels) fail('invalid_request', 'Map image dimensions exceed limit');
  const product = catalog.products.find(p => p.id === selectedId);
  if (!product || product.status !== 'available' || !product.extent) fail('unavailable', 'Map product unavailable');
  if (projection === 'EPSG:3857' && !product.supportedProjections?.includes(projection)) fail('unavailable', 'Web Mercator not explicitly advertised on layer');
  if (typeof time !== 'string' || !product.times.includes(time)) fail('invalid_request', 'Select an exact advertised source time');
  iso(time);
  if (extentRelation(bbox, product.extent) === 'outside') fail('outside_extent', 'Viewport outside advertised product extent');
  // Never use upstream URLs, styles or layer names from a passed-in catalog.
  return requestUrl({ request: 'GetMap', layers: DEFINITIONS[selectedId].layer, styles: '', crs: projection, bbox: projectedBbox.join(','), width: String(width), height: String(height), format: 'image/png', transparent: 'true', time });
}
async function boundedGet(url: URL, accept: string[], limit: number, signal?: AbortSignal): Promise<{ bytes: Buffer; warning: string | null; cacheControl: string | null; retrievedAt: string }> {
  const combined = AbortSignal.any([AbortSignal.timeout(MAP_LIMITS.timeoutMs), ...(signal ? [signal] : [])]);
  const response = await fetch(url, { signal: combined, redirect: 'error', credentials: 'omit', headers: { Accept: accept.join(', ') } });
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const size = response.headers.get('content-length');
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : NaN;
    await response.body?.cancel();
    throw new MapError('rate_limited', 'Map provider rate limit reached', Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 86400)) : 60);
  }
  if (!response.ok || !type || !accept.includes(type)) { await response.body?.cancel(); fail('provider_error', 'Unexpected map provider status or content type'); }
  if (size && (!/^\d+$/.test(size) || Number(size) > limit)) { await response.body?.cancel(); fail('response_too_large', 'Map response exceeds limit'); }
  if (!response.body) fail('provider_error', 'Empty map response');
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > limit) fail('response_too_large', 'Map response exceeds limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return { bytes: Buffer.concat(chunks), warning: response.headers.get('warning')?.slice(0,2048) ?? null, cacheControl: response.headers.get('cache-control')?.slice(0,1024) ?? null, retrievedAt: new Date().toISOString() };
}
export async function getMapCatalog(signal?: AbortSignal): Promise<MapCatalog> {
  const result = await boundedGet(new URL(CAPABILITIES_URL), ['text/xml', 'application/xml', 'application/vnd.ogc.wms_xml'], MAP_LIMITS.metadataBytes, signal);
  return parseMapCatalog(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes), result.retrievedAt);
}
export interface MapImage {
  bytes: Buffer; projection: MapProjection; contentType: 'image/png'; productId: ProductId; requestedTime: string;
  /** WMS supplies no independently confirmed actual timestamp, even without a warning. */
  actualSourceTime: null; sourceTimeStatus: 'advertised_time_requested' | 'provider_warning_actual_time_unknown';
  warning: string | null; retrievedAt: string; cacheControl: string | null; extentRelation: 'inside' | 'partial';
  coverageState: 'unknown'; attribution: string;
}
/** Fetch one validated frame. No arbitrary URL input, retries, caching, or prefetch. */
export async function fetchMapImage(id: string, bbox: Bbox, width: number, height: number, time: string, catalog: MapCatalog, signal?: AbortSignal, projection: MapProjection = 'CRS:84'): Promise<MapImage> {
  const url = buildMapRequest(id, bbox, width, height, time, catalog, projection);
  const result = await boundedGet(url, ['image/png'], MAP_LIMITS.imageBytes, signal);
  // Require PNG signature and expected IHDR dimensions; do not decode untrusted raster here.
  const b = result.bytes;
  if (b.length < 33 || !b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b.readUInt32BE(8) !== 13 || b.toString('ascii',12,16) !== 'IHDR' || b.readUInt32BE(16) !== width || b.readUInt32BE(20) !== height) fail('provider_error', 'Invalid PNG header or unexpected dimensions');
  const selectedId = productId(id); const product = catalog.products.find(p => p.id === selectedId)!;
  return { ...result, projection, contentType: 'image/png', productId: selectedId, requestedTime: time, actualSourceTime: null,
    sourceTimeStatus: result.warning ? 'provider_warning_actual_time_unknown' : 'advertised_time_requested',
    extentRelation: extentRelation(bbox, product.extent!) as 'inside' | 'partial', coverageState: 'unknown', attribution: baseProduct(selectedId).attribution };
}
export * from './forecast';
