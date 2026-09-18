import { z } from 'zod';

// Primary evidence: docs/research/maps/nifc-{incidents,perimeters}{,-item}.json
// Both authoritative WFIGS layers support sorted pagination and UTC date fields.
const base = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/';
export const wildfireLayers = {
  incidents: `${base}WFIGS_Incident_Locations_Current/FeatureServer/0`,
  perimeters: `${base}WFIGS_Interagency_Perimeters_Current/FeatureServer/0`,
} as const;
export const WILDFIRE_MAX_PAGES = 4, WILDFIRE_PAGE_SIZE = 500, WILDFIRE_MAX_VERTICES = 100_000;
const wildfireLon = z.number().finite().min(-180).max(180);
const wildfireLat = z.number().finite().min(-90).max(90);
export const WildfireBboxSchema = z.strictObject({ west: wildfireLon, south: wildfireLat, east: wildfireLon, north: wildfireLat })
  .refine(b => b.east > b.west && b.north > b.south && b.east - b.west <= 10 && b.north - b.south <= 10,
    'Use a non-wrapping viewport no larger than 10 degrees on either axis.');
export type WildfireBbox = z.infer<typeof WildfireBboxSchema>;
const text = z.string().max(500).nullable();
const guid = z.string().regex(/^(?:\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i);
const rawTime = z.number().int().min(0).max(8_640_000_000_000_000).nullable();
const instant = z.iso.datetime().nullable();
const category = z.enum(['WF', 'RX', 'CX']).nullable();
const id = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const position = z.tuple([wildfireLon, wildfireLat]);
const ring = z.array(position).min(4).max(WILDFIRE_MAX_VERTICES).refine(p =>
  p.length >= 4 && p[0][0] === p.at(-1)![0] && p[0][1] === p.at(-1)![1] &&
  new Set(p.slice(0, -1).map(v => v.join(','))).size >= 3, 'Closed ring needs three distinct vertices.');
// Retain Esri ring order/winding; these are NOT GeoJSON Polygon coordinates.
export const WildfirePolygonSchema = z.object({ rings: z.array(ring).min(1).max(1000) }).nullable();
const point = z.object({ x: wildfireLon, y: wildfireLat }).nullable();
export const wildfireIncidentAttributes = z.object({
  OBJECTID: id, GlobalID: guid, SourceGlobalID: guid.nullable(), IrwinID: guid.nullable(),
  UniqueFireIdentifier: text, IncidentName: text, IncidentTypeCategory: category, ModifiedOnDateTime_dt: rawTime,
});
export const wildfirePerimeterAttributes = z.object({
  OBJECTID: id, GlobalID: guid, poly_SourceGlobalID: guid.nullable(), attr_SourceGlobalID: guid.nullable(),
  poly_IRWINID: guid.nullable(), attr_IrwinID: guid.nullable(), attr_UniqueFireIdentifier: text,
  attr_IncidentName: text, attr_IncidentTypeCategory: category, attr_ModifiedOnDateTime_dt: rawTime,
  poly_PolygonDateTime: rawTime, poly_DateCurrent: rawTime, poly_CreateDate: rawTime,
}).refine(p => !p.poly_IRWINID || !p.attr_IrwinID || wildfireNormalizeId(p.poly_IRWINID) === wildfireNormalizeId(p.attr_IrwinID),
  'Conflicting polygon and incident IRWIN identifiers.');
export const wildfireIncidentFeature = z.object({ attributes: wildfireIncidentAttributes, geometry: point });
export const wildfirePerimeterFeature = z.object({ attributes: wildfirePerimeterAttributes, geometry: WildfirePolygonSchema });
const timePair = z.object({ epochMs: rawTime, utc: instant }).refine(t => t.utc === wildfireIso(t.epochMs));
const common = {
  objectId: id, globalId: guid, irwinId: guid.nullable(), normalizedIrwinId: guid.nullable(),
  uniqueFireIdentifier: text, name: text, category, incidentUpdatedAt: timePair,
};
export const WildfireIncidentSchema = z.object({ ...common, sourceGlobalId: guid.nullable(), geometry: point });
export const WildfirePerimeterSchema = z.object({ ...common,
  polygonIrwinId: guid.nullable(), attributeIrwinId: guid.nullable(),
  polygonSourceGlobalId: guid.nullable(), incidentSourceGlobalId: guid.nullable(),
  polygonCapturedAt: timePair, polygonUpdatedAt: timePair, polygonCreatedAt: timePair,
  geometry: WildfirePolygonSchema,
});
const layerMetadata = z.object({
  sourceUrl: z.enum([wildfireLayers.incidents, wildfireLayers.perimeters]), retrievedAt: z.iso.datetime(),
  pages: z.number().int().min(1).max(WILDFIRE_MAX_PAGES), publishedRecords: z.number().int().min(0).max(WILDFIRE_PAGE_SIZE * WILDFIRE_MAX_PAGES),
  availability: z.enum(['published_records', 'no_published_records']),
  pagination: z.literal('complete'), snapshotConsistency: z.literal('not_atomic'), sourceUpdatedAt: z.null(),
});
export const WildfireDataSchema = z.object({
  bbox: WildfireBboxSchema, provider: z.literal('NIFC / WFIGS'), retrievedAt: z.iso.datetime(),
  coordinateReferenceSystem: z.literal('EPSG:4326'), geometryFormat: z.literal('esri_json'),
  classification: z.literal('published_incident_mapping'), coverage: z.literal('unknown'),
  incidents: z.array(WildfireIncidentSchema).max(WILDFIRE_PAGE_SIZE * WILDFIRE_MAX_PAGES),
  perimeters: z.array(WildfirePerimeterSchema).max(WILDFIRE_PAGE_SIZE * WILDFIRE_MAX_PAGES),
  sources: z.object({ incidents: layerMetadata, perimeters: layerMetadata }),
  attribution: z.string(), limitations: z.array(z.string()),
}).superRefine((d, ctx) => {
  let vertices = 0;
  for (const kind of ['incidents', 'perimeters'] as const) {
    const meta = d.sources[kind], rows = d[kind];
    if (meta.sourceUrl !== wildfireLayers[kind] || meta.publishedRecords !== rows.length ||
      meta.availability !== (rows.length ? 'published_records' : 'no_published_records'))
      ctx.addIssue({ code: 'custom', message: 'Inconsistent layer metadata.' });
    const seen = new Set<string>();
    let last = -1;
    for (const row of rows) {
      if (row.normalizedIrwinId !== wildfireNormalizeId(row.irwinId) || row.objectId <= last || seen.has(wildfireNormalizeId(row.globalId)!))
        ctx.addIssue({ code: 'custom', message: 'Inconsistent or duplicate source identity.' });
      last = row.objectId; seen.add(wildfireNormalizeId(row.globalId)!);
    }
  }
  for (const p of d.perimeters) {
    if (p.irwinId !== (p.polygonIrwinId ?? p.attributeIrwinId) ||
      (p.polygonIrwinId && p.attributeIrwinId && wildfireNormalizeId(p.polygonIrwinId) !== wildfireNormalizeId(p.attributeIrwinId)))
      ctx.addIssue({ code: 'custom', message: 'Inconsistent perimeter identity.' });
    for (const r of p.geometry?.rings ?? []) vertices += r.length;
  }
  if (vertices > WILDFIRE_MAX_VERTICES) ctx.addIssue({ code: 'custom', message: 'Geometry vertex limit exceeded.' });
});
export type WildfireData = z.infer<typeof WildfireDataSchema>;
export type WildfireIncident = z.infer<typeof WildfireIncidentSchema>;
export type WildfirePerimeter = z.infer<typeof WildfirePerimeterSchema>;
export function wildfireNormalizeId(value: string | null) { return value?.replace(/[{}]/g, '').toLowerCase() ?? null; }
export function wildfireIso(value: number | null) {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function wildfireTime(value: number | null) { return { epochMs: value, utc: wildfireIso(value) }; }

export const WildfireResponseSchema = z.object({ status: z.literal('success'), freshness: z.literal('fresh'), data: WildfireDataSchema });
export type WildfireResponse = z.infer<typeof WildfireResponseSchema>;
