import { CurrentWeatherSchema } from './current-weather';
export { CurrentWeatherSchema } from './current-weather';
import { WbgtEstimateSchema } from './wbgt';
export * from './wbgt';
import { z } from 'zod';
import {CoordinatesSchema,LocationSchema} from './location';
export {CoordinatesSchema,LocationSchema,type Location} from './location';
export const ProvenanceSchema = z.object({ provider: z.string(), dataset: z.string(), classification: z.enum(['modeled','observed','derived']), retrievedAt: z.iso.datetime(), sourceIssuedAt: z.iso.datetime().nullable(), sourceCoordinates: CoordinatesSchema, sourceElevationM: z.number().finite().nullable().optional(), attribution: z.string() });
export const HourSchema = z.object({ isDay:z.union([z.literal(0),z.literal(1)]).nullable().optional(), shortwaveInstantWm2:z.number().nonnegative().nullable().optional(), shortwaveMeanWm2:z.number().nonnegative().nullable().optional(), wbgt:WbgtEstimateSchema.optional(), time: z.iso.datetime(), temperatureC: z.number().finite().nullable(), apparentTemperatureC: z.number().finite().nullable(), humidityPercent: z.number().min(0).max(100).nullable(), precipitationMm: z.number().nonnegative().nullable(), precipitationProbability: z.number().min(0).max(100).nullable(), windSpeedMs: z.number().nonnegative().nullable(), windGustMs: z.number().nonnegative().nullable(), windDirectionDeg: z.number().min(0).max(360).nullable(), weatherCode: z.number().int().nullable(), ordinaryWetBulbC: z.number().finite().nullable(), dewPointC: z.number().finite().nullable().default(null), surfacePressureHpa: z.number().positive().nullable().default(null), cloudCoverPercent: z.number().min(0).max(100).nullable().default(null), visibilityM: z.number().nonnegative().nullable().default(null), uvIndex: z.number().nonnegative().nullable().default(null) });
export const ForecastSchema = z.object({ current: CurrentWeatherSchema.optional(), astronomy:z.array(z.object({date:z.iso.date(),sunrise:z.iso.datetime().nullable(),sunset:z.iso.datetime().nullable()})).max(16).optional(), location: LocationSchema, provenance: ProvenanceSchema, hours: z.array(HourSchema).min(1).max(384), intervalSemantics: z.literal('instant meteorology; precipitation and probability preceding hour; gust preceding-hour maximum'), missingFields: z.array(z.string()) });
export type Forecast = z.infer<typeof ForecastSchema>;
export type Hour = z.infer<typeof HourSchema>;
export const ErrorCodeSchema = z.enum(['invalid_request','provider_error','rate_limited','no_data','not_configured','policy_unapproved','unauthorized','not_found','conflict']);
export const ApiErrorSchema = z.object({ status: z.literal('error'), code: ErrorCodeSchema, message: z.string() });
export const ForecastResponseSchema = z.discriminatedUnion('status', [z.object({ status: z.literal('success'), freshness: z.enum(['fresh','stale']), data: ForecastSchema }), ApiErrorSchema]);
export const SearchResponseSchema = z.object({ status: z.literal('success'), locations: z.array(LocationSchema) });
export type ForecastResponse = z.infer<typeof ForecastResponseSchema>;
export const ActivitySchema = z.enum(['relaxing','walking','strenuous']);
export type Activity = z.infer<typeof ActivitySchema>;

export const ResolvedLocationResponseSchema = z.object({ status: z.literal('success'), location: LocationSchema });
export const OfficialAlertSchema = z.object({ id:z.string(), event:z.string(), headline:z.string().nullable(), severity:z.string(), urgency:z.string(), certainty:z.string(), sent:z.iso.datetime(), effective:z.iso.datetime().nullable(), onset:z.iso.datetime().nullable(), expires:z.iso.datetime().nullable(), ends:z.iso.datetime().nullable(), status:z.string(), messageType:z.string(), description:z.string(), instruction:z.string().nullable(), areaDesc:z.string(), senderName:z.string(), web:z.string().url().nullable(), geometry:z.unknown().nullable(), affectedZones:z.array(z.string()) });
export const AlertsDataSchema=z.object({coordinates:CoordinatesSchema,retrievedAt:z.iso.datetime(),provider:z.literal('NWS'),alerts:z.array(OfficialAlertSchema),attribution:z.string()});
export const AlertsResponseSchema=z.discriminatedUnion('status',[z.object({status:z.literal('success'),freshness:z.enum(['fresh','stale']),data:AlertsDataSchema}),ApiErrorSchema]);
export type AlertsData=z.infer<typeof AlertsDataSchema>;
export const MapProductSchema=z.object({layer:z.string(),classification:z.literal('observed'),temporalKind:z.literal('observed_history'),extentMeaning:z.literal('advertised_rectangle_not_coverage_mask'),coverageEvidence:z.literal('none'),nearestValue:z.boolean(),approximateCadenceMinutes:z.number().positive(),documentedLatencyMinutes:z.tuple([z.number(),z.number()]).nullable(),id:z.enum(['radar-conus','radar-alaska','radar-hawaii','satellite-goes-infrared','satellite-global-infrared']),title:z.string(),description:z.string(),region:z.string(),kind:z.enum(['radar','infrared']),status:z.enum(['available','unavailable']),unavailableReason:z.string().nullable(),extent:z.tuple([z.number(),z.number(),z.number(),z.number()]).nullable(),coverageState:z.literal('unknown'),coverageMessage:z.string(),times:z.array(z.iso.datetime()).max(2048),defaultTime:z.iso.datetime().nullable(),legend:z.object({url:z.url(),kind:z.enum(['reflectivity','illustrative']),units:z.literal('dBZ').nullable(),explanation:z.string()}),attribution:z.string(),sourceUrl:z.url()}).passthrough();
export const MapCatalogSchema=z.object({provider:z.literal('NOAA nowCOAST'),version:z.literal('nowcoast-wms-v1'),retrievedAt:z.iso.datetime(),sourceUrl:z.url(),products:z.array(MapProductSchema).max(5)});
export const MapCatalogResponseSchema=z.object({status:z.literal('success'),freshness:z.enum(['fresh','stale']),data:MapCatalogSchema});
export const MapFrameSchema=z.object({projection:z.enum(['CRS:84','EPSG:3857']).default('CRS:84'),imageBase64:z.string().max(1500000),productId:MapProductSchema.shape.id,requestedTime:z.iso.datetime(),actualSourceTime:z.null(),sourceTimeStatus:z.enum(['advertised_time_requested','provider_warning_actual_time_unknown']),warning:z.string().nullable(),retrievedAt:z.iso.datetime(),coverageState:z.literal('unknown'),attribution:z.string(),extentRelation:z.enum(['inside','partial'])});
export const MapFrameResponseSchema=z.object({status:z.literal('success'),freshness:z.enum(['fresh','stale']),data:MapFrameSchema});

export * from './history';

export * from './comparison';
export * from './stations';

export * from './wildfire';

export * from './history-csv';
export * from './station-discovery';
export * from './forecast-radar';

export * from './libre-radar';
export * from './comparison-weather';
export * from './climate-comparison';
export * from './wet-bulb-tracker';

export * from "./notifications";
