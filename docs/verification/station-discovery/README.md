# Assisted GHCN-Daily station discovery — September 11, 2026

Implemented and verified with retained NOAA regional metadata and synthetic cases; **live acceptance failed and remains a release gate**. One permitted live metadata GET returned a generic invalid/oversized-metadata error. The adapter does not expose raw provider content, and this attempt did not retain headers/body, so the exact full-catalog incompatibility (headers, body bounds, or record validation) is not known. No second request was made. See [live attempt](live.json). Do not claim that live discovery works or label retained research fixtures as live.

## Interface and ownership

- `packages/contracts/src/station-discovery.ts`: pure shared `StationDiscoveryQuerySchema`, `StationCandidateSchema`, `StationDiscoveryDataSchema`, `StationDiscoveryResponseSchema`, inferred types, fixed source URL and great-circle distance helper. Authorized append to contracts root export completed.
- `packages/stations/src/discovery.ts`: `parseStationDiscovery(text, query, metadataRetrievedAt)` and `getStationDiscovery(query, signal?)`. Authorized stations entry-point export completed.
- `apps/api/src/station-discovery.ts`: `registerStationDiscovery(app, cached)`, registering `GET /api/v1/stations/nearby?latitude=&longitude=`. **Lead still owns app registration/UI integration.** No manifest or DB schema migration.
- Dedicated parser/adapter and API test files; this evidence directory. No services, production DBs, API registration, UI, notifications, root manifests or research evidence changed.

Successful REST shape: `{status:'success', freshness:'fresh', data:{query, candidates, ...metadata}}`. `query` contains numeric latitude/longitude. Each candidate has `id`, nullable `name`, `coordinates:{latitude,longitude}`, nullable `elevationM`, and unrounded `distanceKm`. Data has `metadataRetrievedAt`, fixed `sourceUrl`, null `sourceUpdatedAt`, provider/dataset/version, fixed radius/limit/country scope/order and explicit `completeness`, `timeHistory`, `eligibility` = `not_assessed`; `proximityMeaning` = `not_a_scientific_recommendation`.

US-only identifiers match the existing daily history endpoint; foreign candidates are excluded, including near international borders. Coordinates may be anywhere valid on Earth. At most ten candidates within 150 km are returned, sorted by spherical distance then ID. No candidate is selected automatically. Empty candidates means no matching catalog candidates under these bounds, not no observations. Distance is geometric, not an exposure/elevation/coverage ranking. The radius is an engineering search bound, not a scientific representativeness threshold.

## Source semantics

Format follows NOAA's [GHCN-Daily readme, section IV](https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt), already preserved in [research evidence](../../research/history/ghcnd-readme.txt). The fixed source is [ghcnd-stations.txt](https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt). Parser enforces 85-column ASCII rows, decimal fields/ranges, IDs, separators and documented flag values; duplicates fail closed. LF, CRLF and a final unterminated line are accepted. Blank names remain null; elevation -999.9 remains null. Missing/invalid coordinates reject rather than inventing a position. Retrieval time does not mean source update time.

The [station research](../../research/station-history.md) and [retained metadata](../../research/history/ghcnd-stations-subset.txt) remain unchanged. Their coverage and HOMR findings show why nearby stations and long inventory endpoints cannot establish complete or homogeneous climate records. Discovery does not retrieve inventory, HOMR, observations, time zones, observation intervals or climate normals, and does not splice IDs. Station history results retain their separate existing metadata semantics.

## Bounds and cache

Fixed HTTPS URL only; redirect mode `error`; no retries. Declared and streamed body size capped at 20 MiB, required HTTP 200/plain text/non-range body, fatal UTF-8 decode followed by strict ASCII record validation. Adapter deadline 12 seconds covers fetch/read; elapsed-time check also rejects completion after synchronous parsing crosses the deadline. Synchronous parsing itself cannot be preempted, so this is not a strict CPU/RSS bound. Only ten candidate objects are retained, but full text and a duplicate-ID set are held during parsing; the byte cap is not a heap cap.

`CachedRequests` reserves provider `noaa`, weight 1 before every uncached fetch; selected JSON only is persisted, TTL 86,400,000 ms, stale 0. Key `stations:ghcnd-discovery-v1:US:150km:10:{normalized query JSON}` and runtime schema enforce exact coordinates, distances, ordering, IDs and source semantics. Same-key concurrent requests coalesce through existing cache behavior. No raw module cache is implemented: each distinct uncached coordinate pair can transfer the entire bounded catalog, under existing shared quota/concurrency limits. A later bounded raw-catalog cache needs separately reviewed freshness/concurrency and must not bypass route quota.

Invalid/blank/repeated/unknown query fields return 400 without fetch. Upstream/shared rate refusal returns 429 and available Retry-After. Invalid provider data/outage returns redacted 502; stale candidates are never returned as success.

## Checks

`npx tsx --test packages/stations/src/*.test.ts apps/api/src/station-discovery.test.ts`: **20/20 pass**, [TAP evidence](tests.tap). Covers retained NOAA fixed-width metadata; null names/elevation; geometry/dateline; nearest-ten/radius/US filtering/ties; malformed rows/IDs/flags/coordinates/duplicates; query and timestamp rejection; response consistency; fixed URL/no redirects; invalid status/type and declared/streamed byte cap; pre-abort and noncooperative stalled-fetch deadline; exact-query cache/coalescing; one-day expiry; cache mismatch; stale outage; quota-before-fetch; Retry-After. Existing station history adapter/route regressions included. All SQLite tests use `:memory:`.

`npm run typecheck`: pass. Initial `npm run build -- --output ...` forwarding attempt failed at CLI argument validation without building. Production build then passed through the installed Rsbuild API using the existing config and an isolated `/tmp/zindycast-station-discovery-build` output, removed afterward. Existing MapLibre dynamic dependency warning remains; served assets untouched.

## Required next gate

Lead must diagnose the full-catalog validation failure with **a newly authorized bounded capture** of status/headers/body and exact rejected-record diagnostics, then add the real incompatible case as a regression and fix only if supported by NOAA source semantics. Do not loosen IDs, coordinates or missingness blindly. Retain the failure evidence. After that, register the route and verify browser location identity, candidate selection into the explicit daily-history ID field, outages, empty results and scientific-limit wording. No browser/live success, full nationwide catalog compatibility or scientific station recommendation is claimed here.

## Lead integration diagnosis — September 11, 2026

One additional bounded diagnostic GET retrieved the complete official catalog (11.4 MB, 132,501 rows). The original parser wrongly treated UTF-8 character offsets as byte columns and rejected actual international hyphen IDs and US lowercase/underscore IDs. Parsing now preserves byte columns and decodes names as UTF-8. Only the pre-existing uppercase US ID subset is offered, so unsupported history IDs are excluded rather than rewriting their identities. Four exact public catalog rows are retained in catalog-regression.txt and exercised by a regression test; the normalized ten-candidate Honolulu result is diagnostic-result.json. Full catalog validation now passes without relaxing coordinate, field-width, flag, duplicate or response-bound checks. No assertion of historical suitability follows from discovery.
