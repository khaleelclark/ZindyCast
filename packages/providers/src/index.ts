import { z } from 'zod';
import { CoordinatesSchema, CurrentWeatherSchema, ForecastSchema, HourSchema, LocationSchema, type Forecast, type Hour, type Location } from '@zindycast/contracts';
import { deriveForecastWbgt } from '@zindycast/heat';

/** Server-only Open-Meteo adapters. API/cache owns freshness and shared rate budgets. */
export class ProviderError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'provider_error' | 'rate_limited' | 'no_data',
    message: string,
    public readonly httpStatus?: number,
    public readonly retryAfterSeconds?: number,
  ) { super(message); this.name = 'ProviderError'; }
}

const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
// One prior UTC day retains the whole current local day on either side of UTC
// midnight. Keep absolute UTC steps across DST; consumers group by location zone.
const FORECAST_DAYS = 14;
const PAST_DAYS = 1;
const SERIES_DAYS = FORECAST_DAYS + PAST_DAYS;
const SERIES_HOURS = SERIES_DAYS * 24;
export type ForecastModel = 'gfs_seamless' | 'ecmwf_ifs025';
const forecastModelOptions = {
  gfs_seamless: {
    upstream: 'ncep_gfs_seamless',
    dataset: 'Forecast API (explicit NCEP GFS Seamless)',
  },
  ecmwf_ifs025: {
    upstream: 'ecmwf_ifs025',
    dataset: 'Forecast API (explicit ECMWF IFS 0.25°)',
  },
} as const satisfies Record<ForecastModel, { upstream: string; dataset: string }>;
const ForecastModelSchema = z.enum(['gfs_seamless', 'ecmwf_ifs025']);
// Units and periods: https://open-meteo.com/en/docs#hourly-parameter-definition
const fields = [
  ['temperature_2m', 'temperatureC', '°C'],
  ['apparent_temperature', 'apparentTemperatureC', '°C'],
  ['relative_humidity_2m', 'humidityPercent', '%'],
  ['precipitation', 'precipitationMm', 'mm'],
  ['precipitation_probability', 'precipitationProbability', '%'],
  ['wind_speed_10m', 'windSpeedMs', 'm/s'],
  ['wind_gusts_10m', 'windGustMs', 'm/s'],
  ['wind_direction_10m', 'windDirectionDeg', '°'],
  ['weather_code', 'weatherCode', 'wmo code'],
  ['wet_bulb_temperature_2m', 'ordinaryWetBulbC', '°C'],
  ['dew_point_2m', 'dewPointC', '°C'],
  ['surface_pressure', 'surfacePressureHpa', 'hPa'],
  ['cloud_cover', 'cloudCoverPercent', '%'],
  ['visibility', 'visibilityM', 'm'],
  ['uv_index', 'uvIndex', ''],
  ['shortwave_radiation_instant', 'shortwaveInstantWm2', 'W/m²'],
  ['shortwave_radiation', 'shortwaveMeanWm2', 'W/m²'],
  ['is_day', 'isDay', ''],
] as const satisfies ReadonlyArray<readonly [string, Exclude<keyof Hour, 'time'>, string]>;

const currentFields = fields.filter(([, local]) => local in CurrentWeatherSchema.shape);
const UpstreamCurrentSchema = z.object({
  time: z.number().int().min(0).max(253402300799),
  interval: z.number().int().positive().max(3600),
}).catchall(z.number().finite().nullable());
const CurrentUnitsSchema = z.record(z.string(), z.string());

// Isolate current validation: a bad optional block must not discard valid hourly data.
function readCurrent(current: unknown, units: unknown): Forecast['current'] {
  const parsed = UpstreamCurrentSchema.safeParse(current);
  const parsedUnits = CurrentUnitsSchema.safeParse(units);
  if (!parsed.success || !parsedUnits.success || parsedUnits.data.time !== 'unixtime' ||
      parsedUnits.data.interval !== 'seconds' || currentFields.some(([name, , unit]) =>
        !(name in parsed.data) || parsedUnits.data[name] !== unit)) return undefined;
  const result = CurrentWeatherSchema.safeParse({
    time: new Date(parsed.data.time * 1000).toISOString(), intervalSeconds: parsed.data.interval,
    ...Object.fromEntries(currentFields.map(([upstream, local]) => [local, parsed.data[upstream]])),
  });
  return result.success ? result.data : undefined;
}

const TimezoneSchema = z.string().refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid time zone');
const GeocodingSchema = z.object({
  results: z.array(CoordinatesSchema.extend({
    id: z.number().int().nonnegative(), name: z.string().min(1),
    timezone: TimezoneSchema, country: z.string().optional(), country_code: z.string().optional(),
    admin1: z.string().optional(), admin2: z.string().optional(),
  })).max(20).optional(),
  generationtime_ms: z.number().finite().nonnegative().optional(),
}).refine(value => value.results !== undefined || value.generationtime_ms !== undefined,
  'Missing geocoding response metadata');
const ResolvedCoordinatesSchema = CoordinatesSchema.extend({ timezone: TimezoneSchema });
const UpstreamForecastSchema = CoordinatesSchema.extend({
  elevation: z.number().finite().min(-1000).max(10000).nullable().optional(),
  current: z.unknown().optional(),
  current_units: z.unknown().optional(),
  utc_offset_seconds: z.literal(0),
  daily_units: z.record(z.string(), z.string()).optional(),
  daily: z.object({
    time: z.array(z.number().int().min(0).max(253402300799)).max(SERIES_DAYS),
    sunrise: z.array(z.number().int().min(0).max(253402300799).nullable()).max(SERIES_DAYS).optional(),
    sunset: z.array(z.number().int().min(0).max(253402300799).nullable()).max(SERIES_DAYS).optional(),
  }).nullable().optional(),
  hourly_units: z.record(z.string(), z.string()),
  hourly: z.object({ time: z.array(z.number().int().min(0).max(253402300799)).max(SERIES_HOURS) })
    .catchall(z.array(z.number().finite().nullable()).max(SERIES_HOURS)),
});

function malformed(): ProviderError { return new ProviderError('provider_error', 'Open-Meteo returned malformed data.'); }
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw malformed();
  return result.data;
}
function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

async function requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Provider timed out', 'TimeoutError')), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(response.status === 429 ? 'rate_limited' : 'provider_error',
        response.status === 429 ? 'Open-Meteo request limit reached.' : 'Open-Meteo is unavailable.',
        response.status, retryAfter(response.headers.get('retry-after')));
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      await response.body?.cancel();
      throw malformed();
    }
    const reader = response.body?.getReader();
    if (!reader) throw malformed();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw malformed(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (data && typeof data === 'object' && 'error' in data && data.error === true) throw malformed();
    return data;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('provider_error', controller.signal.aborted ? 'Open-Meteo request timed out.' : 'Open-Meteo request failed.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Geocoding attribution: Open-Meteo and GeoNames (https://open-meteo.com/en/docs/geocoding-api). */
export async function searchLocations(query: string, signal?: AbortSignal): Promise<Location[]> {
  signal?.throwIfAborted();
  const parsed = z.string().trim().max(200).safeParse(query);
  if (!parsed.success) throw new ProviderError('invalid_request', 'Search must be at most 200 characters.');
  if (parsed.data.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name: parsed.data, count: '20', language: 'en', format: 'json' }).toString();
  const response = parse(GeocodingSchema, await requestJson(url, signal));
  return (response.results ?? []).map(item => parse(LocationSchema, {
    id: `open-meteo:${item.id}`, name: item.name, latitude: item.latitude, longitude: item.longitude,
    timezone: item.timezone, country: item.country ?? item.country_code ?? '',
    ...(item.admin1 ? { admin1: item.admin1 } : {}), ...(item.admin2 ? { admin2: item.admin2 } : {}),
  }));
}

/** Forecast API timezone=auto resolves coordinate time zones without a browser-zone fallback.
 * https://open-meteo.com/en/docs (timezone parameter). No weather arrays are requested.
 * Response coordinates describe a model grid; location identity retains the requested point.
 */
export async function resolveLocation(latitude: number, longitude: number, signal?: AbortSignal): Promise<Location> {
  signal?.throwIfAborted();
  const input = CoordinatesSchema.safeParse({ latitude, longitude });
  if (!input.success) throw new ProviderError('invalid_request', 'Valid latitude and longitude are required.');
  const requested = input.data;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(requested.latitude), longitude: String(requested.longitude), timezone: 'auto', forecast_days: '1',
  }).toString();
  const response = parse(ResolvedCoordinatesSchema, await requestJson(url, signal));
  return parse(LocationSchema, {
    ...requested, id: `coordinates:${requested.latitude},${requested.longitude}`,
    name: 'Current location', country: '', timezone: response.timezone,
  });
}

async function requestForecast(location: Location, signal?: AbortSignal, model?: ForecastModel): Promise<Forecast> {
  signal?.throwIfAborted();
  const input = LocationSchema.safeParse(location);
  if (!input.success || !TimezoneSchema.safeParse(input.data.timezone).success) {
    throw new ProviderError('invalid_request', 'A valid location and time zone are required.');
  }
  // Snapshot the requested identity before awaiting; caller mutations cannot relabel results.
  const requested = input.data;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  const parameters = new URLSearchParams({
    latitude: String(requested.latitude), longitude: String(requested.longitude),
    hourly: fields.map(([upstream]) => upstream).join(','), daily: 'sunrise,sunset', forecast_days: String(FORECAST_DAYS), past_days: String(PAST_DAYS),
    current: currentFields.map(([upstream]) => upstream).join(','),
    timezone: 'GMT', timeformat: 'unixtime', temperature_unit: 'celsius', wind_speed_unit: 'ms', precipitation_unit: 'mm',
  });
  if (model !== undefined) parameters.set('models', forecastModelOptions[model].upstream);
  url.search = parameters.toString();
  const response = parse(UpstreamForecastSchema, await requestJson(url, signal));
  const times = response.hourly.time;
  if (times.length === 0) throw new ProviderError('no_data', 'No forecast hours were published.');
  if (times.length !== SERIES_HOURS || response.hourly_units.time !== 'unixtime' || times[0] % 86400 !== 0 ||
      times.some((time, index) => index > 0 && time - times[index - 1] !== 3600)) throw malformed();
  const missingFields: string[] = [];
  for (const [upstream, local, unit] of fields) {
    const values = response.hourly[upstream];
    if (values !== undefined && (values.length !== times.length || response.hourly_units[upstream] !== unit)) throw malformed();
    if (values === undefined || values.some(value => value === null)) missingFields.push(local);
  }
  const current = readCurrent(response.current, response.current_units);
  if (current === undefined) missingFields.push('current');
  else for (const [, local] of currentFields) {
    if (current[local as keyof typeof current] === null) missingFields.push(`current.${local}`);
  }
  // Daily labels are UTC calendar dates, NOT the city's local calendar dates.
  // Event epochs remain absolute instants (an event may lie on an adjacent UTC date).
  let astronomy: Forecast['astronomy'];
  if (response.daily != null) {
    const daily = response.daily;
    if (daily.time.length !== SERIES_DAYS || response.daily_units?.time !== 'unixtime' ||
        daily.time.some((time, index) => time !== times[index * 24])) throw malformed();
    for (const field of ['sunrise', 'sunset'] as const) {
      const values = daily[field];
      if (values !== undefined && (values.length !== daily.time.length ||
          response.daily_units?.[field] !== 'unixtime')) throw malformed();
    }
    astronomy = daily.time.map((time, index) => {
      const event = (field: 'sunrise' | 'sunset') => {
        const value = daily[field]?.[index];
        // Do not display an absent/polar epoch-zero sentinel as Jan 1 1970.
        if (value == null || value === 0) return null;
        // Allow neighboring UTC dates, but reject unrelated calendar epochs.
        if (value < time - 86400 || value >= time + 2 * 86400) throw malformed();
        return new Date(value * 1000).toISOString();
      };
      return { date: new Date(time * 1000).toISOString().slice(0, 10), sunrise: event('sunrise'), sunset: event('sunset') };
    });
  }
  const sourceCoordinates = { latitude: response.latitude, longitude: response.longitude };
  const dataset = model === undefined
    ? 'Forecast API (best match; constituent models not supplied)'
    : forecastModelOptions[model].dataset;
  const hours = times.map((time, index) => {
    const values = Object.fromEntries(fields.map(([upstream, local]) => [local, response.hourly[upstream]?.[index] ?? null]));
    const hour = parse(HourSchema, { time: new Date(time * 1000).toISOString(), ...values });
    // Geometry follows the returned series grid. Ordinary wet bulb and activity
    // are not inputs; absent instantaneous radiation must never fall back to mean.
    return parse(HourSchema, { ...hour, wbgt: deriveForecastWbgt(hour, sourceCoordinates, `Open-Meteo ${dataset}`) });
  });
  if (hours.every(hour => fields.every(([, local]) => local === 'isDay' || hour[local] === null))) {
    throw new ProviderError('no_data', 'No forecast measurements were published.');
  }
  return parse(ForecastSchema, {
    location: requested,
    provenance: {
      provider: 'Open-Meteo', dataset, classification: 'modeled',
      retrievedAt: new Date().toISOString(), sourceIssuedAt: null,
      sourceCoordinates, sourceElevationM: response.elevation ?? null,
      attribution: 'Weather data by Open-Meteo (https://open-meteo.com/), CC BY 4.0',
    },
    ...(astronomy === undefined ? {} : { astronomy }),
    ...(current === undefined ? {} : { current }),
    hours, intervalSemantics: ForecastSchema.shape.intervalSemantics.value, missingFields,
  });
}

/** Default best-match forecast. This intentionally omits the models parameter. */
export async function getForecast(location: Location, signal?: AbortSignal): Promise<Forecast> {
  return requestForecast(location, signal);
}

/** Explicit comparison candidate using Open-Meteo's published model identifier. */
export async function getModelForecast(location: Location, model: ForecastModel, signal?: AbortSignal): Promise<Forecast> {
  const parsed = ForecastModelSchema.safeParse(model);
  if (!parsed.success) {
    throw new ProviderError('invalid_request', 'A supported forecast model is required.');
  }
  return requestForecast(location, signal, parsed.data);
}

export { getAlerts } from './alerts.js';

export { getWildfires } from './wildfire.js';
