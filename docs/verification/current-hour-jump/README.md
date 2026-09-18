# Deltona current-hour jump diagnosis — September 12, 2026

Bounded research only. No application changes. One local forecast GET, no retries, at most one upstream Open-Meteo request / two weighted quota units. No other weather, map, Mapbox admission, service or deployment requests. Documentation was read separately through web search.

## Finding

The displayed hero selects an hourly forecast row, not a station observation or the provider's dedicated current object. `apps/web/src/weather.ts:currentHour` holds each instant sample until the next hour; `index.tsx` updates its clock every 60 seconds and when a forecast arrives/resumes. Thus the displayed transition can occur on the first clock update after the hour, independently of fetching new weather. It can show almost hour-old valid-time samples despite a recently retrieved forecast.

One retained local response at 20:05:40Z (16:05:40 EDT) contains:

| Valid time UTC / EDT | Air °F | Feels °F | Humidity | Wind m/s | Preceding-hour rain mm | Cloud % | Instant shortwave W/m² |
|---|---:|---:|---:|---:|---:|---:|---:|
| 19:00 / 15:00 | 85.64 | 96.44 | 76% | 1.49 | 0.4 | 100 | 261.7 |
| 20:00 / 16:00 | 81.68 | 89.96 | 89% | 4.90 | 0.4 | 100 | 115.3 |
| 21:00 / 17:00 | 79.16 | 89.42 | 86% | 0.36 | 0 | 100 | 62.8 |

This reproduces the user's rounded 82°F / 90°F pair for 16:00, and shows a forecast decline from the preceding row. Increased modeled wind and decreased temperature/radiation are consistent with the lower apparent temperature; this is an interpretation of forecast inputs, not proof of a real local storm or observed cooling.

The latest retrieved 15:00 row does NOT reproduce the reported 88°F / 102–104°F. No earlier user-session response was retained in this audit. Different retrieval/model revisions, coordinates, and user-session state remain unverified. We cannot claim the weather actually dropped six degrees in one minute or establish the exact historical sequence from this single later response.

Response: HTTP 200, 844 ms; provider retrieval 20:05:40.194Z; classification modeled; source grid 28.86714,-81.1616 versus requested 28.858,-81.17. Source issue time is null; constituent model identity is not supplied. Fresh response/cache status does not establish a new model run.

## Provider contract checked

[Open-Meteo Forecast documentation](https://open-meteo.com/en/docs), read September 12:

- `current=` requests separate current values. Current conditions use 15-minute model data, not station observations.
- `current.time` is the valid instant. `current.interval` describes backward-looking aggregation duration; 900 means preceding 15 minutes for precipitation, not a guarantee of a newly issued model every 15 minutes.
- Temperature, apparent temperature, humidity, wind and cloud are instantaneous fields. Apparent temperature includes humidity, wind chill and solar radiation effects.
- North American 15-minute data use HRRR; temperature/humidity/apparent temperature have native support. Other variables or regions can use hourly interpolation.
- Hourly values generally represent instants; precipitation is a preceding-hour sum. Model update frequency varies: NOAA GFS/HRRR is documented hourly, ECMWF six-hourly. Best-match constituent identity is not guaranteed in the payload.

No live `current=` or `minutely_15=` request was made: live shape, actual Deltona current timestamp/value, coverage and availability remain to validate before acceptance.

## Recommended bounded contract change (proposal only)

Add a separately validated `current` sibling to Forecast (or dedicated REST current resource backed by the same upstream response). Request a small coherent set: temperature_2m, apparent_temperature, relative_humidity_2m, weather_code, is_day, wind_speed_10m, wind_direction_10m and cloud_cover. Keep SI units/timeformat=unixtime and validate `current_units`, finite/null values, returned time, positive interval and matching location/source grid. Retain `validTime`, `intervalSeconds`, `retrievedAt`, null source issue time and modeled classification independently of hourly rows. Missing, future or expired current data must be unavailable or explicitly labeled hourly fallback; never relabel an hourly sample current.

Use the current object's matching air/apparent/humidity/wind together in the hero, with visible valid time and modeled estimate label. Keep ordinary wet-bulb, WBGT and their inputs on the original coherent hourly row and label their own valid time. Likewise do not present hourly rain probability or UV as belonging to the current timestamp. Do not interpolate app values to disguise transitions.

Refreshing the API can retrieve the provider's latest available object; it cannot force new upstream model information. A 15-minute valid-time series improves the maximum sample age and reduces hourly stepping, but still has discrete steps and model uncertainty. Lead owns cache bypass and web refresh work; those files changed concurrently during this diagnosis and are not part of this audit's verification.

## Evidence and verification

- `forecast.json`: exact single local API body (modeled live retrieval at recorded date; not a reusable live fixture).
- `request.json`: URL, timestamps, duration, headers, bounded request accounting.
- `summary.json`: provenance and full 19/20/21Z rows including heat diagnostics.
- `check.ts`, `selection-results.json`: actual existing schema and selector replay. Run `node --import tsx docs/verification/current-hour-jump/check.ts` (no network). PASS: 15:59 selects 15:00 (86/96 rounded); 16:00 and 16:03 select 16:00 (82/90 rounded). This is a retained-response code replay, not a historical browser recording.

No app edits or build were needed for this documentation-only investigation. No production build, device/browser reproduction, station accuracy comparison or current-feed availability claim.
