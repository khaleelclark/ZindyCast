import { z } from 'zod';
export const STATION_DISCOVERY_SOURCE = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt';
export const StationDiscoveryQuerySchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
});
export type StationDiscoveryQuery = z.infer<typeof StationDiscoveryQuerySchema>;
export const StationCandidateSchema = z.strictObject({
  id: z.string().regex(/^US[A-Z0-9]{9}$/), name: z.string().min(1).max(30).nullable(),
  coordinates: StationDiscoveryQuerySchema, elevationM: z.number().finite().min(-999.8).max(9999.9).nullable(),
  distanceKm: z.number().finite().min(0).max(150),
});
export type StationCandidate = z.infer<typeof StationCandidateSchema>;
/** Spherical proximity only, matching the retained station audit's 6371 km radius. */
export function stationDistanceKm(a: StationDiscoveryQuery, b: StationDiscoveryQuery): number {
  const r = Math.PI / 180;
  const h = Math.sin((b.latitude-a.latitude)*r/2)**2 + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2;
  return 12742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1,h))));
}
export const StationDiscoveryDataSchema = z.strictObject({
  query: StationDiscoveryQuerySchema, candidates: z.array(StationCandidateSchema).max(10),
  radiusKm: z.literal(150), limit: z.literal(10), countryScope: z.literal('US'),
  ordering: z.literal('distance_then_id'), metadataRetrievedAt: z.iso.datetime(),
  sourceUrl: z.literal(STATION_DISCOVERY_SOURCE), provider: z.literal('NOAA NCEI'), dataset: z.literal('GHCN-Daily station metadata'),
  adapterVersion: z.literal('ghcnd-discovery-v1'), sourceUpdatedAt: z.null(),
  completeness: z.literal('not_assessed'), timeHistory: z.literal('not_assessed'), eligibility: z.literal('not_assessed'),
  proximityMeaning: z.literal('not_a_scientific_recommendation'),
}).superRefine((d,ctx) => {
  const seen = new Set<string>();
  d.candidates.forEach((c,i) => {
    const p = d.candidates[i-1];
    if (seen.has(c.id) || Math.abs(c.distanceKm-stationDistanceKm(d.query,c.coordinates)) > 1e-8 ||
      (p && (p.distanceKm > c.distanceKm || (p.distanceKm === c.distanceKm && p.id >= c.id))))
      ctx.addIssue({code:'custom',message:'Inconsistent candidate identity, distance or ordering.'});
    seen.add(c.id);
  });
});
export type StationDiscoveryData = z.infer<typeof StationDiscoveryDataSchema>;
export const StationDiscoveryResponseSchema = z.strictObject({ status:z.literal('success'), freshness:z.literal('fresh'), data:StationDiscoveryDataSchema });
export type StationDiscoveryResponse = z.infer<typeof StationDiscoveryResponseSchema>;
