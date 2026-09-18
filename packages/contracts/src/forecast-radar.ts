import { z } from 'zod';
export const FORECAST_RADAR_SOURCE_URL='https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json';
export const ForecastRadarFrameSchema=z.object({
  id:z.string().regex(/^hrrr-\d{12}-f\d{4}$/), modelRunTime:z.iso.datetime(),
  forecastLeadMinutes:z.number().int().min(0).max(1080).multipleOf(15), validTime:z.iso.datetime(),
}).refine(f=>Date.parse(f.modelRunTime)%3600000===0 && Date.parse(f.validTime)===Date.parse(f.modelRunTime)+f.forecastLeadMinutes*60000 && f.id===`hrrr-${f.modelRunTime.replace(/[-:]/g,'').replace('T','').slice(0,12)}-f${String(f.forecastLeadMinutes).padStart(4,'0')}`,'Frame identity must match pinned run and valid time');
export type ForecastRadarFrame=z.infer<typeof ForecastRadarFrameSchema>;
export const ForecastRadarMetadataSchema=z.object({modelRunTime:z.iso.datetime(),horizonEnd:z.iso.datetime(),retrievedAt:z.iso.datetime()})
 .refine(m=>Date.parse(m.modelRunTime)%3600000===0 && Date.parse(m.horizonEnd)===Date.parse(m.modelRunTime)+1080*60000 && Date.parse(m.modelRunTime)<=Date.parse(m.retrievedAt),'Invalid pinned model horizon');
export const ForecastRadarCatalogSchema=z.object({
 provider:z.literal('Iowa Environmental Mesonet'),sourceModel:z.literal('NOAA/NCEP HRRR'),version:z.literal('iem-hrrr-refd-v1'),productId:z.literal('forecast-hrrr-conus'),
 classification:z.literal('modeled'),temporalKind:z.literal('forecast'),quantity:z.literal('simulated_reflectivity_1000m_agl'),units:z.literal('dBZ'),region:z.literal('CONUS'),coverageState:z.literal('unknown'),
 retrievedAt:z.iso.datetime(),evaluatedAt:z.iso.datetime(),modelRunTime:z.iso.datetime(),horizonEnd:z.iso.datetime(),frames:z.array(ForecastRadarFrameSchema).min(1).max(12),defaultFrameId:z.string(),
 sourceUrl:z.literal(FORECAST_RADAR_SOURCE_URL),attribution:z.literal('NOAA/NCEP HRRR; Iowa Environmental Mesonet'),
 legend:z.object({kind:z.literal('illustrative'),explanation:z.literal('Simulated reflectivity; quantitative palette not independently verified. Blank pixels do not establish no precipitation or model coverage.')}),
 sourceTimeStatus:z.literal('pinned_model_run_requested'),actualSourceTime:z.null(),
}).refine(c=>{
 const run=Date.parse(c.modelRunTime),now=Date.parse(c.evaluatedAt),retrieved=Date.parse(c.retrievedAt);
 return run%3600000===0 && run<=retrieved && retrieved<=now && now-run<=4*3600000 && Date.parse(c.horizonEnd)===run+1080*60000 && c.defaultFrameId===c.frames[0].id && c.frames.every((f,i)=>f.modelRunTime===c.modelRunTime && Date.parse(f.validTime)>now && Date.parse(f.validTime)<=now+3*3600000 && (i===0 || Date.parse(f.validTime)>Date.parse(c.frames[i-1].validTime)));
},'Catalog times and frame identities must be consistent');
export type ForecastRadarCatalog=z.infer<typeof ForecastRadarCatalogSchema>;
export const ForecastRadarErrorSchema=z.object({status:z.literal('error'),code:z.enum(['invalid_request','outside_supported_region','invalid_metadata','model_run_too_old','no_future_frames','provider_error','rate_limited']),message:z.string()});
export const ForecastRadarCatalogResponseSchema=z.discriminatedUnion('status',[z.object({status:z.literal('success'),freshness:z.literal('fresh'),data:ForecastRadarCatalogSchema}),ForecastRadarErrorSchema]);
export type ForecastRadarCatalogResponse=z.infer<typeof ForecastRadarCatalogResponseSchema>;
