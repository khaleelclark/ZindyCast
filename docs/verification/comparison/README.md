# H3 bounded comparison calculations — September 11, 2026

Implemented pure planning and aggregation in `packages/comparison/src/index.ts` with deterministic tests in `index.test.ts`. No network, storage, job loop, routes, clocks, installations or source research changes. This closes the bounded custom UTC comparison calculation module; it does not complete seasonal baseline/recent-decade jobs or their UI.

## Worker interface

```ts
createComparisonPlan(query: ComparisonQuery): ComparisonPlan
aggregateComparison(
  plan: ComparisonPlan,
  results: readonly { chunkId: string; data: ReanalysisData }[],
): ComparisonResult

type ComparisonQuery = {
  locations: { id: string; name: string; latitude: number; longitude: number }[];
  startDate: string; // inclusive YYYY-MM-DD, UTC
  endDate: string;   // inclusive YYYY-MM-DD, UTC
};
```

The module exports all plan/chunk/result/summary types, `ComparisonQuerySchema`, `ComparisonLocationSchema`, `ComparisonPlanSchema`, `comparisonFields`, and `ComparisonError` (`code: invalid_request | invalid_data`). Reanalysis runtime validation and types come from the lead-owned contracts package. Result types are local TypeScript types, not a new shared REST result schema.

Plans accept 2–5 distinct requested coordinate pairs with unique IDs and bounded nonempty labels; coordinates must be finite and valid. The single common selection contains 1–366 inclusive UTC dates, beginning no earlier than 1940. A final closing date must fit the four-digit date domain. Plans snapshot the query, preserve location order, and produce stable location/chunk IDs within the plan. **Chunk IDs are plan-local, not global cache keys.** Persist/cache against the full selection, source/model/units/variables/method and coordinate identity.

Each `plan.chunks[]` entry has `{id,locationId,query}`. Its `query` can be passed directly to `getReanalysis`; retain `id` as the result's `chunkId`. No chunk exceeds 31 inclusive dates. There are at most 12 chunks per location / 60 per plan. Call the aggregator only after all chunks have succeeded or returned validated partial/no-data payloads. An absent/failed request is not a successful all-null chunk; failed/cancelled jobs require explicit worker handling.

The planner deliberately does not read the current clock: the worker must check **every fetch date including `fetchEndDate`** against the adapter's UTC-today-minus-five-days availability bound when scheduling and executing. A selection ending on the adapter's latest allowed date needs a closing date not yet available, so it must be deferred/rejected explicitly. Calendar bounds alone do not guarantee populated or final archive data.

## Exact intervals and denominators

For an inclusive selection March 8–8, 2020, the analysis window is `[2020-03-08T00:00Z, 2020-03-09T00:00Z)`. Instantaneous meteorology uses the 24 timestamps March 8 00:00–23:00. Precipitation uses the 24 preceding-hour sums **ending March 8 01:00 through March 9 00:00**. The rainfall at March 8 00:00 overlaps the previous day and is excluded. The closing midnight interval is included.

The plan fetches through one additional UTC date to obtain that closing midnight rainfall. Every other padding hour is discarded in aggregation. Internal chunk midnight rainfall is included exactly once; dropping the first rainfall row of every chunk would incorrectly lose internal intervals. A 366-day plan therefore fetches 367 dates (8,808 rows per location) but analyzes 8,784 instantaneous slots and 8,784 rainfall intervals. The extra date counts toward provider budgets.

Each of five variables (`temperatureC`, `humidityPercent`, `precipitationMm`, `windSpeedMs`, `dewPointC`) returns SI `unit`, `expectedCount`, `validCount`, `missingCount`, `absentSourceCount` and `nullValueCount`. The last two partition missing slots into absent source timestamps and present rows with null values. `status` is `complete`, `partial`, or `no_data`. Numerical zero stays zero; unavailable statistics are null.

`mean`, `min`, and `max` describe available values only; denominator is `validCount`, never the expected count. Every unique hourly slot has equal weight, including leap-day hours. This is not an average of monthly means, a distribution, a climate normal or a completeness-adjusted estimate. UTC days retain 24 slots through DST; this does not implement complete local civil-day comparisons.

Rainfall additionally returns `sumAvailableMm`, null when no intervals have values, and `totalMm`, null unless **every** interval in the selected physical window has a value. A missing closing interval produces 23/24 valid intervals for a one-day selection and no complete total. `sumAvailableMm` must be labeled a partial sum when status is partial. Rainfall mean/min/max are hourly accumulation statistics, not rainfall rates or daily extremes. Compensated sums use fixed chronological order for reproducibility independent of chunk completion order.

`commonValidCounts` counts identical slots with valid data at every selected location per variable (instantaneous slots or rainfall intervals as appropriate). It exposes unequal available-hour cohorts. Individual means still use each city's own valid slots; they are not recalculated on the common intersection. Partial means/extremes must be displayed with counts and must not imply a fair ranking or an improvement caused by missing data. No imputation, sparse-year deletion, eligibility cutoff, extrapolation, ranking or heat category is introduced.

## Merge and provenance validation

The aggregator validates the canonical plan and requires all and only its chunks exactly once. Duplicate/unknown chunk IDs, missing requests, overlapping/shifted/date-inconsistent chunks, altered coordinates, malformed hourly timelines, gaps not represented by explicit null rows, inconsistent completeness, invalid units/values and non-ERA5 metadata fail. Input arrays can arrive in any order; output is deterministic in plan location/chunk and chronological hour order.

Request URLs must match the audited archive endpoint, exact request dates/coordinates, `models=era5`, all five adapter variables, GMT/Unix time, SI units and land cell selection. Unexpected/duplicate parameters (including hidden elevation overrides), other products or altered selection fail. This is consistency validation of adapter provenance, not independent proof of upstream model lineage.

Source grid coordinates and source elevation must remain identical across chunks for one requested location. Different locations may legitimately use different or identical grid cells; requested locations are never replaced with source coordinates. Existing schema literals fix classification, model request, provider elevation adjustment, time semantics and adapter version across the comparison. Unknown constituent remains null: requested ERA5 does not establish ERA5 versus ERA5T or an underlying release version.

Every contributing chunk retains query, full provenance, source coordinates/elevation, exact request URL, attribution and independent retrieval timestamp in `locations[].sources`. Retrieval times may differ and are never relabeled as source issue/update time; those remain null. Output carries `calculationVersion: era5-comparison-v1` and `classification: modeled_reanalysis`.

## Checks and remaining gates

Combined regression check `npx tsx --test packages/history/src/index.test.ts packages/comparison/src/index.test.ts`: 17/17 passed, including the history adapter after its schema move into shared contracts.

`npx tsx --test packages/comparison/src/index.test.ts`: 8/8 passed. Tests verify leap-year and maximum 60-chunk plans, 31-day boundaries, invalid dates/coordinates/location counts, duplicate selections, input snapshots, fixed common windows, pre-1970 time, both DST transition dates, precipitation at external/internal midnights, padding exclusions, missing/zero/no-data distinctions, exact denominators and common-valid slots, arrival-order determinism, malformed/missing/duplicate/overlapping chunks, source/grid/elevation/model/units/URL mismatch and independent retrieval metadata. `npm run typecheck` and `npm run build` passed.

Tests use deterministic mock values; a previously retained adapter sample provides only fixture metadata. No live requests were made. Primary-source semantics are inherited from the previously audited [Open-Meteo historical documentation](https://open-meteo.com/en/docs/historical-weather-api), [history adapter evidence](../history-runtime/README.md), and preserved [station-history comparison constraints](../../research/station-history.md). No new provider or scientific verification is claimed.

Lead integration remains responsible for shared API result schemas/routes, worker job leases/recovery/progress/cancellation, budgeted chunk retrieval, storage/cache identity, stale/error states and UI/export matching. Archive request weighting must participate in the common free-provider budget; 60 potential GETs are not 60 guaranteed billable-weight units. This module supplies neither scheduling nor retries.

1991–2020 and a latest common complete recent decade exceed the 366-day bound and remain deferred to budgeted long jobs. Station observations, monthly/seasonal distributions, local calendars, historical heat metrics, scientific eligibility and device/browser acceptance remain outside this calculation module. ERA5 results must be labeled modeled historical estimates, never observed station measurements or homogeneous ground truth.
