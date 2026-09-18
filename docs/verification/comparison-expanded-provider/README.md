# Expanded comparison provider feasibility

Research/design only, September 13, 2026. No application edits. One authorized archive request, no retry, no application quota/counter mutation, services, maps, or production calls. Raw response and request metadata are retained beside this file; `python3 docs/verification/comparison-expanded-provider/verify.py` validates them offline.

## Outcome and evidence

Explicit `models=era5` accepted all proposed fields in a single Deltona request (28.858,-81.17), UTC July 15, 2025. HTTP 200, 2,287 bytes, 737 ms, retrieved 2026-09-13 05:25:05Z. Returned grid 28.75,-81.25, elevation 21m. All 11 hourly variables have 24 values and zero nulls in this sample. This verifies this place/day's API support, not all dates, locations, accuracy, or completeness. Exact URL and headers: `live-request.json`; raw values: `live-response.json`; ranges: `live-summary.json`.

Wet bulb is supported directly: 23.2–25.9°C. Air 23.8–28.2°C; cloud 45–100%; sunshine 0–3,600s per hourly interval; precipitation 0–7.2mm. These ranges are the returned UTC rows, not a complete Deltona local-day summary. The initial accumulation ends at opening midnight and the closing midnight is outside this probe. No fabricated day totals.

## Primary documentation checked

[Official archive documentation](https://open-meteo.com/en/docs/historical-weather-api) lists wet bulb, sunshine, cloud, code and solar/daylight fields. ERA5 is hourly, approximately 25km, with a five-day delay. Reanalysis combines observations and modeling. Sunshine counts preceding-hour seconds exceeding 120 W/m² direct normal irradiance; precipitation is preceding-hour total including snow. Shortwave radiation is a preceding-hour mean. Codes are derived; thunderstorm estimation is unavailable. Daily code is the most severe condition. Default best-match can combine datasets; retain explicit ERA5.

[Official pricing](https://open-meteo.com/en/pricing) scales calls above ten variables and fourteen days, including fractional counts. Free access supports noncommercial use with rate limits; data attribution is required under CC BY 4.0. This family-use feasibility check requires no subscription/account.

## Proposed contract (lead approval before implementation)

Keep existing five nullable SI measurements and append the following nullable fields. This table's exact units were verified in the retained response.

| Remote hourly parameter | Proposed local field | Exact upstream unit | Validation |
| --- | --- | --- | --- |
| wet_bulb_temperature_2m | wetBulbTemperatureC | °C | finite, bounded consistently with temperature |
| sunshine_duration | sunshineDurationSeconds | s | 0–3600 |
| cloud_cover | cloudCoverPercent | % | 0–100 |
| weather_code | weatherCode | wmo code | integer known WMO code; unknown code must not become clear |
| is_day | isDay | empty string | 0 or 1 |
| shortwave_radiation | shortwaveRadiationWm2 | W/m² | finite nonnegative |

Minimal dashboard extension needs only the first four (nine hourly variables total). `is_day` enables day/night filtering; shortwave is optional supporting detail, not a sunshine substitute. Probe also verified daily `sunrise`/`sunset` units `unixtime` and `daylight_duration` unit `s`; recommend separate nullable astronomy rows only if exact daylight totals are required. Counting hourly `is_day` samples is not exact daylight duration. Probe requested eleven hourly plus three daily variables: conservative reservation ceil(14/10)=2, actual provider accounting not exposed.

Preserve per-field nulls, absent-hour flags, validCounts, missingFields and independent completeness. Strictly reject wrong units/array lengths/nonfinite or out-of-range non-null values; missing arrays expand to null. Expand the existing field enum and counts together. Keep absolute UTC ISO instants and existing requested/source coordinates, ERA5-requested designation, null constituent/issue/update timestamps, retrieval time, land-cell/elevation policy and attribution. Version adapter, CSV and comparison calculation/cache identities together. Label ordinary provider wet bulb explicitly; never substitute WBGT or silently switch to an app formula. Provider calculation algorithm was not independently audited here.

## Aggregation and time design

Existing history allows 31 UTC days/744 rows and a 1MB response; comparison fetches an extra closing UTC date, validates exact remote field list, and supports only UTC windows. Lead must update that URL validator, result contract, CSV mappings and worker cache/quota policy alongside adapter fields.

For local calendars, add each location's validated IANA timezone to comparison identity. Compute local midnight bounds as absolute instants, with each location's own window. Fetch all UTC dates covering those bounds, including closing accumulation endpoint; chunk into the same nonoverlapping ≤31-day requests. A conservative previous/next UTC date pad covers whole-day offsets but must be trimmed, deduplicated and counted in cost. Retain 23/25-hour DST days. For non-hour offsets, do not prorate rain/sunshine or infer subhour weather: use fully contained intervals and disclose uncovered boundary duration, or explicitly retain UTC aggregation until a boundary policy is approved.

Use [start,end) for instant samples; accumulations require the entire [time−1h,time] within the window (thus include end and exclude opening overlap). Apply the same rule to sunshine; integrate shortwave means over valid intervals only. No partial sum becomes a complete total. Averages of daily highs/lows should equally weight complete local days, distinct from hourly average and absolute min/max. Report valid-day denominators and separate partial-day extrema. Monthly totals/means must preserve those definitions and missingness. Count weather-code hours by documented code groups; a day can contain multiple conditions, so day counts overlap unless a separate explicit classification policy is adopted. No thunderstorm-day claim from unavailable ERA5 codes, and no invented sunny-day threshold.

Cost proposal: reserve ceil(max(1,variables/10) × max(1,inclusiveUTCdays/14)) per actual location/chunk. Nine fields for 31 days =>3; eleven or fourteen =>3 or4 respectively. Sum per-chunk ceilings including padding/cache misses. Do not reuse five-field cached records as complete expanded records. Keep bounded jobs and serialized upstream work; payload growth and new export sizes need implementation tests before changing limits.

## Acceptance still required

Retained-response verification passes. No app typecheck/build was needed for documentation-only work. Adapter work awaits assignment. Required implementation fixtures: missing/null/unknown codes, malformed units, complete and absent timestamps, closing intervals/chunk joins, DST and fractional offsets, leap days, daily-average versus hourly-average distinction, partial coverage, cache invalidation, weighted admission and CSV parity. This probe provides no browser/dashboard acceptance and no station-observation equivalence.

## Implemented adapter — September 13, 2026

Authorized bounded implementation is now complete; the earlier feasibility findings above remain historical evidence. New files only: `packages/contracts/src/comparison-weather.ts`, `packages/history/src/comparison-weather.ts`, and `packages/history/src/comparison-weather.test.ts`. Existing five-field history adapter, fixtures and exports were not edited by this task. Lead owns barrel exports and integration.

Contract exports `ComparisonWeatherHourSchema`, `ComparisonWeatherDataSchema`, corresponding types, `ComparisonWeatherField`, `comparisonWeatherFields` (remote/local/unit tuples), `comparisonWeatherFieldNames`, and `comparisonWeatherRequestUrl(query): string`. Adapter exports `fetchComparisonWeather(query, signal?)` and the URL helper. Uses existing `HistoryError` class identity. Calculation version is `comparison-weather-adapter-v2`; exact interval semantics: `instant meteorology; precipitation and sunshine duration sums over preceding hour ending at time`.

Exactly nine fields: original temperature/humidity/precipitation/wind/dew point plus ordinary provider wet bulb, sunshine seconds, cloud percent and code. The fixed ERA5 GMT/SI URL is checked against query identity by the data schema, preventing five-field or changed-model snapshot reuse. One fetch per 1–31 inclusive UTC-day query (at most 744 rows), same conservative five-day availability exclusion. No aggregate/day/month calculations or CSV added here. Local-day padding/chunk boundaries and preceding-hour inclusion remain aggregator responsibilities.

Absent variables and null values remain null. Missing timestamps expand to fully null rows with `sourceHourPresent: false`. Canonical per-hour missing fields, independent valid counts, expected/source/complete/missing-hour counts and status are checked. Zero remains a value. Present unit metadata must match exactly, including when its variable is absent; present arrays require units and matching lengths. Temperatures use existing −150..80°C bound, humidity/cloud 0..100%, sunshine 0..3600s, precipitation 0..3000mm and wind 0..200m/s. Integer weather codes 0..99 remain unclassified; unknown codes such as 4 are preserved for explicit downstream unknown handling, never silently clear. This differs from the earlier suggested known-code-only validation to retain upstream evidence. Noninteger/out-of-range codes fail.

Network handling retains 8-second fetch/body deadline, 1MB decompressed byte cap, JSON content checks, rejected redirects, caller cancellation and HTTP/Retry-After error semantics. No retries. Transport logic is independently copied to avoid changing the established history path.

Verification: `npx tsx --test packages/history/src/index.test.ts packages/history/src/comparison-weather.test.ts` **21/21 pass** (12 expanded + 9 original). Covers 31-day/leap/DST UTC slots, timestamp holes/null/absent variables, zero and unknown codes, malformed/range/unit/length failures, date/coordinate bounds without fetch, HTTP429/503/Retry-After, payload size/content, stalled fetch/body timeout, cancellation, canonical snapshot tampering, and offline replay of the retained live response selecting the exact nine requested hourly fields. `npm run typecheck` **pass**. Isolated `PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-comparison-weather-dist` **pass**, with existing MapLibre dynamic-import warning. Logs: `tests.log`, `typecheck.log`, `build.log`.

All test requests intercepted; **zero additional live provider, Mapbox, quota/counter, service, deployment or production calls**. Retained live evidence unchanged. Root/config/dependency/API/web/existing-barrel files are outside this task. Lead still owns cache/calculation version identities, chunk admission (31 days × nine fields reserves three units), exports, worker/dashboard aggregation, CSV and browser/release verification. Adapter success does not establish provider accuracy or complete geographical coverage.
