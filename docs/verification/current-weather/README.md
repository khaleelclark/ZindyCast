# Separate modeled current block — September 12, 2026

Provider implementation only: `packages/providers/src/index.ts`, `index.test.ts`, and the explicitly delegated new `packages/contracts/src/current-weather.ts`. Lead owns the contracts index insertion, API cache version/three-unit weighting, web selection/freshness and release. No service, production build, dependency, API, web or root configuration changes by this task.

The existing 14-day request retains 18 hourly and two daily variables and adds eight current variables in the same fetch: temperature_2m, apparent_temperature, relative_humidity_2m, wind_speed_10m, wind_direction_10m, weather_code, is_day, cloud_cover. No extra periodic request. Parent grid and modeled provenance cover this block. Source issue time remains unknown.

`CurrentWeatherSchema` exports the agreed ISO time, positive integer intervalSeconds ≤3600 and eight required nullable measurements. Current validation is isolated from hourly validation. Missing/malformed blocks, absent fields or incorrect units omit current and append `current` to missingFields. Valid null measurements retain null and add `current.<localField>`; zero values remain numbers. All-null current stays explicit, for the consumer to reject as unusable. Future/old valid times are preserved exactly; consumer freshness policy must reject or label them rather than the adapter relabeling timestamps. Ordinary wet-bulb and WBGT continue to use their original hourly values and timestamps.

## Documentation checked

[Official Open-Meteo Forecast docs](https://open-meteo.com/en/docs), read September 12: current conditions use 15-minute modeled data. The time is the valid instant; interval describes aggregation duration, not model issue frequency. North America has HRRR 15-minute support, but some variables/regions interpolate hourly data. This change does not claim native 15-minute measurements for every requested field, station observations or smoother continuous weather. Retrieval cannot force a new model run.

## One bounded live shape probe

Exactly one current-only upstream GET after reading docs, at 20:09:05.480Z; HTTP 200 at 20:09:06.358Z in 874ms. No retries or other weather/map requests. Budget: one request, one weighted unit; direct research probe did not mutate the production application counter. Exact URL, headers and timing are in `live-request.json`; exact payload is `live-current.json`.

Requested Deltona 28.858,-81.17; returned grid 28.86714,-81.1616. Valid time 20:00Z, interval 900 seconds. Air 27.6°C (81.68°F), apparent 32.2°C (89.96°F), humidity 89%, wind 4.90m/s from 92°, WMO code 51, isDay 1, cloud 100%. Payload current_units matches strict checks: time unixtime, interval seconds, °C, %, m/s, °, wmo code, empty day flag unit. This confirms a usable response shape, not measured weather accuracy, every-city coverage, a changed model run, or a reproduction of the earlier 88°F/102–104°F user report. At this probe the 20:00 current temperature/apparent pair equals the earlier retained 20:00 hourly pair.

## Verification

- `node --import tsx --test packages/providers/src/index.test.ts`: 22/22 PASS (`provider-tests.log`). Includes existing units, hourly/daylight/astronomy, WBGT, cancellation, error handling and new single-fetch current, isolated malformed units/values/missing block, null/zero and old/future timestamp checks. All test fetches mocked; no live test calls.
- `npm run typecheck`: PASS (`typecheck.log`).
- `PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm exec --workspace @zindycast/web -- rsbuild build --distPath /tmp/zindycast-current-weather-dist`: isolated empty-token build PASS (`build.log`), existing MapLibre warning. Does not modify served assets or service state.
- `node --import tsx docs/verification/current-weather/replay.ts`: retained live block passes shared schema; results in `live-parsed.json`. Offline replay only.

Web fallback/freshness, refresh cache behavior, browser acceptance, integrated release and physical devices remain lead-owned gates. No browser/UI claim is made by these provider checks.
