# M5 bounded NIFC wildfire adapter — 2026-09-11

Implemented in `packages/providers/src/wildfire.ts` and tested in `wildfire.test.ts`. Browser-safe shared validation now lives in `packages/contracts/src/wildfire.ts`; the adapter imports/reexports the same schema objects. `apps/api/src/wildfire.ts` supplies the REST registration function. Only the explicitly authorized contracts/providers root exports were appended; manifests and app registration remain lead-owned. Research remains intact: [provider/map research](../../research/providers-maps.md), [incident metadata](../../research/maps/nifc-incidents.json), [perimeter metadata](../../research/maps/nifc-perimeters.json), and their item metadata/attribute samples.

## Interface

```ts
getWildfires(bbox: { west: number; south: number; east: number; north: number }, signal?: AbortSignal): Promise<WildfireData>
```

Exports `WildfireBboxSchema`, `WildfirePolygonSchema`, `WildfireIncidentSchema`, `WildfirePerimeterSchema`, `WildfireDataSchema` and inferred `WildfireBbox`, `WildfireIncident`, `WildfirePerimeter`, `WildfireData` types. Browser clients import schemas/types from `@zindycast/contracts`; server clients import `getWildfires` from `@zindycast/providers`. Existing `ProviderError` codes: `invalid_request`, `provider_error`, `rate_limited`; caller cancellation preserves the original reason. Errors never return an empty successful response or a partial layer pair.

Result contains snapshotted bbox, `provider='NIFC / WFIGS'`, EPSG:4326, `geometryFormat='esri_json'`, `classification='published_incident_mapping'`, `coverage='unknown'`, independent arrays, source URLs and per-layer retrieval/pagination metadata, attribution and interpretation limitations. Per-layer `sourceUpdatedAt=null` is explicitly unknown. Do not substitute retrieval for feature age.

Each row retains raw source OBJECTID/GlobalID/IRWIN IDs and source GlobalIDs; `normalizedIrwinId` only lowercases/removes braces for a potential join. It does not merge records. OBJECTID is only layer-local pagination identity, not globally stable identity. Polygon IRWIN/attribute IRWIN disagreement fails validation. Missing IRWIN remains null; never join by name. WF/RX/CX/null stay distinct (wildfire/prescribed fire/complex/unknown); a wildfire-only UI must explicitly filter WF. Null geometry remains null. Polygon timestamp pairs retain exact epoch milliseconds and UTC independently for capture, last edit and creation; incident modification is separate, even when different between layers.

Geometry remains native Esri `{x,y}` / `{rings}` in requested WGS84 coordinates. Rings are bounded, finite, closed, and have at least three distinct vertices. Ring order/winding is preserved, with no polygon simplification or topology repair. **Do not pass Esri rings directly as GeoJSON Polygon coordinates:** disjoint shells and holes need a tested topology-aware conversion before MapLibre GeoJSON rendering. Validation here is structural, not a proof of non-self-intersection or geometric accuracy. Server-side `esriSpatialRelIntersects` performs selection; entire matching polygons can extend outside the viewport. No clipping or synthetic polygons.

## Request and completeness limits

Fixed two authoritative layer URLs under `services3.arcgis.com/T4QMspbfLg3qTGWY`; fixed field allowlist/query parameters, no arbitrary URL, SQL, filter, output CRS, redirect or retry input. Strict bbox accepts finite world coordinates with positive non-wrapping width/height at most 10 degrees each. Antimeridian wrapping must be split by future caller integration; no automatic split or broad-world sweep.

One 10-second deadline for both layers and all pages, including body reads; 8,000,000 decompressed bytes across the whole operation; 100,000 total polygon vertices; at most 1,000 rings per feature; 500 records/page and four pages/layer, up to eight GETs and 2,000 records/layer. Deadline races cover stalled fetch/body even in mocks; synchronous JSON/Zod processing cannot be preempted but late completion is rejected. No caches, background tasks, retries, or raw oversized cache entries.

Queries sort OBJECTID ascending and advance `where=OBJECTID>lastId`, avoiding offset skips caused by removal of earlier rows. Duplicate/non-increasing IDs and duplicate GlobalIDs fail. A true `exceededTransferLimit` continues even on a short page; empty transfer-limited page fails. Explicit false ends traversal; absent flag ends only a short page, otherwise another page is probed. Reaching the cap without a terminal response fails unavailable with a smaller-viewport message. HTTP 429 preserves Retry-After; JSON service errors, schema/CRS changes, missing required fields, unexpected types, geometry/size limits and network/timeout failures all fail the pair.

`pagination='complete'` means all pages in this bounded traversal were consumed. `snapshotConsistency='not_atomic'` is explicit: these mutable current views do not promise snapshot isolation, and rows inserted/updated during traversal can differ. Independent incident/perimeter retrievals need not agree in content/update time. Neither successful pagination nor an empty result establishes geographic coverage or absence of fires. Current-view disappearance is not extinguishment. Perimeters are not evacuation zones, spread predictions, or safe-area boundaries.

## Verification

- `npx tsx --test packages/providers/src/wildfire.test.ts`: 13/13 passed (adapter and REST).
- Previous adapter-only combined wildfire, forecast/location and alerts tests: 29/29 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Tests reuse preserved real NIFC attribute samples; geometry/pagination mutations are synthetic test data and never live app data. Cases cover RX/WF/CX, independent timestamps, null geometry/identity/time, empty, short/full pagination, repeat/cap/no-progress, malformed fields/CRS/rings/identity, bounds, query mutation, HTTP/429/redirect/JSON/bytes, caller abort, stalled fetch/body deadline, and tampered output validation.

Exactly **two live GETs** at 2026-09-11 01:02:08Z, one per layer, both HTTP 200. Viewport west=-152,south=64,east=-149,north=66 returned one Canyon WF incident and one matching perimeter, 1,500 polygon vertices. Incident update: September 5 23:48:31.857Z; polygon capture: July 8 21:47:18Z; polygon edit: July 27 22:24:56Z. Thus the fresh retrieval does not imply a freshly surveyed perimeter. [Manifest](live-manifest.json) preserves exact URLs/time/status; [normalized result](live-result.json) contains real coordinates/geometry and original timestamp values. It is not raw upstream evidence or rendered-map acceptance. [Manual smoke script](live-smoke.ts) hard-caps two calls and is excluded from unit tests. Do not rerun automatically; this task used its entire live allowance.

Primary authoritative endpoints are linked in the result/manifest; September 10 saved metadata documents UTC fields, pagination, record limits, current-view restrictions and item credit/disclaimers. September 11 live calls validate the selected-field query and real point/ring response for this single Alaska viewport only. No regional availability/accuracy warranty or phone rendering claim.

## Lead integration gates

Lead must import/register `registerWildfires(app, cached)` in app.ts. The handler reserves eight calls from the shared `noaa` pool before any fetch, uses a five-minute TTL with no stale success, validates the exact bbox on cache reads, and replaces complete snapshots. Its versioned key fixes authoritative layers, fields, EPSG:4326 and Esri geometry; bump version if these change. No unbudgeted fallback. No live request was made during REST integration.

Map implementation needs topology-aware Esri-to-GeoJSON conversion and tests for holes/disjoint shells plus live/device visual acceptance. Preserve independent point/perimeter layer states, source links/credit, unknown coverage and old geometry warnings. No notifications, evacuation information, containment conclusions, AirNow implementation, accounts, installations or services included here.

## REST integration

`GET /api/v1/wildfires?west=&south=&east=&north=` returns `{status:'success',freshness:'fresh',data:WildfireData}` validated by shared `WildfireResponseSchema`/`WildfireResponse`. Blank, repeated, nonnumeric, unknown-key and invalid/nonwrapping/oversized bbox queries fail 400 before quota/network. HTTP or shared-budget 429 retains Retry-After; other failures return 502. Error text mentions reducing the viewport; no silent truncation or partial successful layer pair.

An outer 10-second abort and monotonic elapsed check leave margin under the shared 15-second refresh lease. Synchronous JSON/schema work cannot be preempted. Exact normalized JSON UTF-8 bytes **plus cache-key bytes** must fit 2 MiB, checked before cache write and on reads. An adapter-valid geometry may exceed this narrower REST limit and is rejected whole. Raw upstream pages are never cached. Inherited stale entries may be returned internally by generic cache fallback, but fresh-only envelope validation refuses to expose them.

REST tests use Fastify injection and isolated in-memory SharedStorage, covering identical shared schema objects, strict query checks, cached repeat/TTL, full eight-call reservation (even for two empty pages), quota refusal before fetch, upstream retry/errors, wrong-bbox cache refresh, stale fallback refusal, a valid 80,001-vertex result too large for storage, and stalled-fetch outer cancellation. Existing schema tests cover independent timestamp/identity/count tampering. No service/DB/Tailscale mutation, installs, notifications or new live-provider calls.
