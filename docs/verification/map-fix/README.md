# Map failure investigation — September 11, 2026

Bounded server investigation while lead browser-tests the application. Owned changes: `packages/maps/src/index.ts`, new `packages/maps/src/route.test.ts`, `apps/api/src/maps.ts`, this directory. No shared-contract, basemap geometry, root, service or dependency changes.

## Findings

Local `http://127.0.0.1:4311/api/v1/maps` returned HTTP200 at01:12:21Z. Saved [catalog](catalog.json)/[headers](catalog.headers): all five products available, catalog originally retrieved01:12:00.027Z. The requested latest CONUS time was01:04:07Z. Catalog cache freshness refers to retrieval/cache age; source age remains separate.

Local `/api/v1/maps/frame` query `product=radar-conus&west=-123&south=37&east=-119&north=40&width=800&height=500&time=2026-09-11T01%3A04%3A07.000Z` returned HTTP200. [Normalized frame](frame.json):5516 base64 characters, retrieved01:12:33.789Z, no provider Warning. No actual source time confirmation.

One direct adapter request used the same catalog/time and actual browser CONUS bounds[-125,24,-66,50],800x500. [PNG](conus.png) was saved and opened visually: colored echoes on mostly transparent background, with no geographic basemap. [Metadata](conus-metadata.json):22871 PNG bytes,30496 base64 characters, retrieved01:13:09.448Z; upstream cache-control `max-age=600, public`, no Warning. Exact fixed NOAA request is reproducible by [check-frame.ts](check-frame.ts), which must NOT run in ordinary tests. It selects the SAVED rolling source time, which may expire. No retries were made.

Live request upper bound3: local catalog could reuse cache; local frame could fetch once; direct full-regional frame fetched once. No further live calls. No server-wide catalog/image outage or image-size failure reproduced. Current REST schema allows1.5M base64 characters, storage2MiB; both live PNGs are far below those bounds. Adapter permits up to8MiB but larger frames can still fail the stricter REST limit; no arbitrary limit increase applied.

UI code at inspection rendered raw CRS:84 radar in SVG, explicitly without basemap/labels/pan/zoom. The image's transparency gives little geographic context. This is an observed implementation limitation and plausible contributor to the reported experience, not proof of the user's exact failure. Browser root-cause/acceptance belongs to the lead. Blank pixels never establish dry conditions or sensor coverage.

## Confirmed server bug and fix

Both map route catches mapped a shared NOAA quota denial to502 `provider_error`, hiding a recoverable rate-limit condition and its Retry-After. The adapter also collapsed upstream429 into generic provider error. Added typed MapError `rate_limited` with optional retry delay, bounded parsing of numeric/HTTP-date Retry-After (fallback60s), and both routes now return429 `rate_limited` plus Retry-After for shared or upstream limits. No automatic retry or unbudgeted fallback.

Unchanged cache policy: catalog120s, frames300s, stale0, NOAA weight1 for each uncached catalog/frame. Provider frame max-age600 does not imply a new observation. Existing schema/time/extent/PNG limits unchanged. No claim that this error-reporting fix supplies a basemap or completes map functionality.

## Validation

- `npx tsx --test packages/maps/src/*.test.ts`:10/10 passed.
- `npm run typecheck`:passed.
- `npm run build`:passed.

Three new REST tests use Fastify injection and in-memory shared storage: exhausted quota with zero network; upstream429 retry preservation on catalog/frame and malformed-image502; successful regional PNG/runtime schema/cache reuse plus independent source Warning and invalid extent rejection. Existing seven adapter tests preserve strict provider validation, geometry and cancellation behavior. Tests use saved research fixtures explicitly; none served as live data.

## Projection correction — September 11, 2026

Added explicit EPSG:3857 support for placing NOAA rasters on a Web Mercator basemap. Old default CRS:84 URL semantics remain exact. Request bbox is always geographic west/south/east/north; only the WMS GetMap bbox is converted to spherical Mercator meters with radius6378137, x/y order. Latitudes outside±85.05112878 and dateline-crossing bounds are rejected, not silently clamped (which would change image corners). Client supplies geographic image corners corresponding to the same bbox; browser visual alignment remains the lead's acceptance responsibility.

Interfaces:

- `buildMapRequest(id,bbox,width,height,time,catalog,projection:MapProjection='CRS:84'):URL`
- `fetchMapImage(id,bbox,width,height,time,catalog,signal?,projection:MapProjection='CRS:84'):Promise<MapImage>`
- `projectWebMercatorBbox(bbox:Bbox):Bbox` and `WEB_MERCATOR_MAX_LATITUDE` exported; `MapProjection='CRS:84'|'EPSG:3857'`.
- `MapImage.projection` is explicit. Per-product optional `supportedProjections` derives only from explicit layer CRS advertisement; absent advertisement refuses EPSG:3857. No extra metadata call per frame. Lead owns shared contract promotion.

`GET /api/v1/maps/frame` accepts optional projection with defaultCRS:84 and rejects unsupported values. Catalog key is now `noaa:catalog:v2` to discard metadata predating advertisement retention. Frame key is now `noaa:frame:v2` and includes projection. Cached/result schema additionally matches requested projection/product/time. Geographic bbox and dimensions remain in exact cache identity. Existing quota429/Retry-After behavior and catalog120s/frame300s/stale0/weight1 remain.

Exactly two new NOAA GETs: capabilities HTTP200 at01:21:47Z and EPSG:3857 CONUS image HTTP200 at01:21:48Z. All five selected products explicitly advertise EPSG:3857. Bbox[-125,24,-66,50] became[-13914936.349159196,2753408.1093649794,-7347086.392356055,6446275.841017161]meters. Independently checked with log(tan(pi/4+latitude/2)) against adapter asinh(tan(latitude)). Selected source time01:12:09Z; retrieval01:21:48.246Z, Warning absent, actual source time still unconfirmed. Image20653bytes. Opened [mercator.png](mercator.png): visible echoes with transparent areas; no dry/coverage claim. Full normalized catalog/request/timestamps in [mercator-evidence.json](mercator-evidence.json). [check-mercator.ts](check-mercator.ts) is opt-in and enforces a two-request cap; not an ordinary test. Original evidence preserved.

Validation: maps tests12/12 pass, including independent known world/45° corners to micro-meter tolerance, zero/equator, latitude edge rejection, axis order, missing advertisement, exact old default URL, projection fetch metadata, separate cache entries and deliberate wrong-projection cache repair. `npm run build` passes with concurrent MapLibre dependency-expression warning. Initial `npm run typecheck` reports only concurrent UI errors in apps/web/src/interactive-map.tsx (ErrorEvent.sourceId and four-coordinate tuple); reported to lead, no cross-owned edit. No new services, manifests, shared schemas, root or browser code changed here.

Final typecheck rerun after concurrent UI corrections: `npm run typecheck` passes. No backend changes were required for those corrections.
