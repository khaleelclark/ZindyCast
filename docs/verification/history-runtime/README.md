# H1/H4 bounded reanalysis adapter — September 11, 2026

Implemented only `packages/history/src/index.ts`, `index.test.ts`, and this evidence directory. The lead owns the package manifest, shared schemas, API routes, cache, jobs and storage. Research evidence is preserved unchanged. This is a server adapter and bounded export implementation, not completion of the History UI, annual browsing, station history or seasonal comparisons.

## Interface

```ts
getReanalysis(query: ReanalysisQuery, signal?: AbortSignal): Promise<ReanalysisData>
renderReanalysisCsv(data: ReanalysisData, locationName?: string): string

type ReanalysisQuery = {
  latitude: number;
  longitude: number;
  startDate: string; // inclusive YYYY-MM-DD, UTC
  endDate: string;   // inclusive YYYY-MM-DD, UTC
};
```

`ReanalysisQuerySchema`, `ReanalysisHourSchema`, `ReanalysisDataSchema`, their inferred types and `ReanalysisField` are exported locally. `HistoryError` exposes `code` (`invalid_request`, `provider_error`, `rate_limited`), optional `httpStatus`, and optional `retryAfterSeconds`. Cancellation preserves the caller's original reason. No shared contract imports or dependency beyond the lead-installed Zod are required.

Valid coordinates are finite WGS84 latitude −90…90, longitude −180…180. Date strings must be real calendar dates, beginning no earlier than 1940-01-01, with 1–31 inclusive days. The live function also limits the end date to UTC today minus five days. This conservative recency bound does not guarantee data completeness or finality. The exported query schema checks stable calendar/range rules; the rolling bound is checked at request time, so previously retrieved exports remain valid.

The request explicitly selects `models=era5`, `timezone=GMT`, `timeformat=unixtime`, Celsius, m/s, mm and `cell_selection=land`. Default provider elevation adjustment remains enabled and is recorded; returned elevation is not a measured elevation at the requested address. Requested coordinates are snapshotted before awaiting and kept separately from source grid coordinates.

Each result contains:

- `query`, `timezone: UTC`, and `hours`: one row for every requested hourly UTC instant, at most 744.
- `temperatureC`, `humidityPercent`, `precipitationMm`, `windSpeedMs`, `dewPointC`: finite validated numbers or null. Units are explicit. Broad input plausibility bounds reject corrupt values; these bounds are not heat guidance or scientific eligibility criteria.
- `sourceHourPresent` and `missingFields`: distinguish absent timestamps from present rows with null/absent variables. Array lengths must agree with the source time array. Non-monotonic, duplicate, off-hour and out-of-selection timestamps fail; actual gaps are expanded to null rows. Missing is never zero-filled or interpolated.
- `completeness`: `expectedHours`, `sourceHours`, `completeHours`, `missingHours` (absent timestamps only), and `validCounts` per variable. `status` is `complete`, `partial`, or `no_data`. All-null and empty-but-valid hourly arrays return `no_data` with the expected null timeline. Missing/malformed structural objects produce an error. Counts, flags and timeline are cross-validated by the result schema.
- `provenance`: Open-Meteo, `dataset: ERA5 (requested)`, `requestedModel: era5`, `constituent: null`, `classification: modeled_reanalysis`, source coordinates/elevation, retrieval time, exact request URL, source link, attribution, grid/elevation choices and adapter version. The response does not identify ERA5 versus ERA5T or underlying source release. `sourceIssuedAt` and `sourceUpdatedAt` remain null; server Date and generation duration are not source issue times.

Temperature, humidity, wind and dew point are instantaneous at the labeled hour. Precipitation is the sum over the preceding hour ending at that label. The first row's rainfall interval begins one hour before the selected start. A sum of all row precipitation therefore does **not** cover the same interval as midnight-to-midnight instantaneous samples. Aggregation/UI must respect this distinction rather than labeling an unadjusted sum as local-day rainfall.

UTC month/day boundaries remain UTC even across DST. A selected UTC day is not a full civil day in New York, Alaska or Hawaii. Local-calendar selection needs explicit conversion, adjacent chunks and interval filtering in future integration; the adapter makes no browser-zone assumption.

## Bounds and export behavior

Requests have an eight-second deadline covering fetch and streamed body, one megabyte maximum decompressed body (also checks declared size), JSON-only response validation, no redirects and no retries. The deadline races stalled fetch/read operations as well as aborting the actual network. HTTP 429 retains valid numeric or date-based Retry-After. Cleanup removes listeners and releases/cancels the stream. Upstream errors are not exposed as raw provider text.

CSV is deterministic for a given validated result and optional label (max 200 characters). It has a single header and one row per selected hour, CRLF endings and quoted/escaped text. Numeric SI values, including negative temperatures, are unchanged. Nulls are empty cells; missing-field/source-presence columns preserve their interpretation. It repeats source/request/time/coordinate metadata per row and includes explicit precipitation interval start/end. Unknown constituent/source times remain empty, not retrieval time. `calculation_version` is the adapter version, not a heat algorithm or provider model release.

Spreadsheet-like text beginning with `=`, `+`, `-`, `@` (including after whitespace/control prefixes), or beginning with tab/CR/LF, receives an apostrophe prefix before CSV quoting. Quotes, commas and newlines are escaped. Runtime schema validation rejects inconsistent timelines, counts and missingness before export. Spreadsheet behavior after users edit/re-save the CSV has not been tested on physical devices.

## Verification

`npx tsx --test packages/history/src/index.test.ts` passed 9/9 tests. Coverage includes both DST transitions, 1940/pre-epoch time, leap day, 31-day maximum and invalid date/range/coordinate rejection; explicit model/units and requested versus source coordinates; missing timestamps versus null values; zero-preserving precipitation; malformed payloads, values, lengths, units, duplicate/off-grid times; rate limits, non-JSON/oversized bodies; pre-abort/in-flight cancellation and caller mutation; stalled fetch/stream deadlines; deterministic CSV, negative numbers, nulls, selection consistency and formula injection. `npm run typecheck` and `npm run build` passed. These are adapter/build checks, not browser/device acceptance.

Exactly two live GETs were issued, with no retries, on 2026-09-11 at 00:26:46–47Z. [The manifest](live-manifest.json) records exact URLs, request/header times and status. The retained JSON files are validated adapter results, **not raw upstream payloads**. [The manual smoke script](smoke.ts) reproduces the two bounded calls and exports; do not run it as a routine unit test.

| Sample | Actual outcome |
|---|---|
| [New York, March 1–31, 2020 JSON](new-york-march-2020.json), [CSV](new-york-march-2020.csv) | HTTP 200; all 744 UTC hours and all five variables populated. Requested 40.7128/−74.006; source 40.75/−74. March DST does not duplicate/drop UTC hours. |
| [Honolulu, January 1, 1940 JSON](honolulu-january-1940.json), [CSV](honolulu-january-1940.csv) | HTTP 200; all 24 timestamps, but precipitation only 19/24, producing `partial` with 19 complete hours and zero absent timestamps. Other four fields 24/24. Requested 21.3069/−157.8583; source 21.5/−158. Missing precipitation stays null. |

These establish bounded access, actual historical missingness and UTC export behavior, not nationwide accuracy, homogeneous climate records, current archive availability or complete seasonal baselines. No third live request was made.

## Primary sources and remaining gates

Checked September 11, 2026: [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api), especially Data Sources, API Documentation, Hourly Parameter Definition and JSON Return Object. It documents ERA5 from 1940, hourly resolution, an approximately five-day delay, units, source grid coordinates, elevation adjustment and precipitation's preceding-hour interval. Provider documentation recommends fixed ERA5/ERA5-Land rather than changing model mixtures for long comparisons; choosing ERA5 here is not proof of observational homogeneity. Attribution is retained in JSON/CSV. Prior [station-history research](../../research/station-history.md) remains controlling evidence for station selection, source/QC flags, unknown observation periods and no silent station/model splicing.

Lead integration must add a coordinated REST schema/route, budget and bounded cache. A 31-day request may have weighted provider usage; do not count every archive GET as equal to a one-day request or independently bypass the shared free-service budget. Cache keys must include requested model, coordinates, dates, variables, units, time basis and elevation/grid choice. Retrieval time remains distinct from source age; archive values can be revised.

H1 still needs calendar-aware display, multi-chunk/year retrieval and browser failure/stale states. H4 still needs UI selection matching and download route/headers. H2 observations, H3 long jobs/consistent comparison periods/completeness policy, aggregation and all heat calculations remain outside this implementation. No installs, root edits, services, jobs, storage, notifications, accounts or delegation were performed.
