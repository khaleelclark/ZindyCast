# Forecast radar backend verification — September 11, 2026

Implemented separate **Forecast radar — HRRR simulation** backend. This is modeled reflectivity 1000 m above ground, not radar observations, extrapolation, rainfall probability, or an assurance of rain at a location. Source decision and primary citations remain in [future-radar.md](../../decisions/future-radar.md), including [IEM service documentation](https://mesonet.agron.iastate.edu/GIS/model.phtml) and [official XYZ example](https://mesonet.agron.iastate.edu/ogc/openlayers_example.html). No paid service or account required.

## Interface ready for lead integration

`registerForecastRadar(app, cached)` from `apps/api/src/forecast-radar.ts` registers:

- `GET /api/v1/maps/forecast/catalog` → `ForecastRadarCatalogResponseSchema`: success `{status:'success',freshness:'fresh',data}` or structured error. No query parameters accepted. Catalog includes source/version, original retrieval, evaluation time, pinned model run, horizon end, defaultFrameId and 1–12 future quarter-hour frames within the next three hours. Schema checks frame identities and exact run+lead arithmetic. Frame IDs use `hrrr-YYYYMMDDHHmm-fNNNN`.
- `GET /api/v1/maps/forecast/tiles/:frameId/:z/:x/:y.png` → raw 256×256 PNG, or structured JSON error. No query parameters accepted. `z=0..7`, canonical integer XYZ addresses, northern-origin y. Tile must intersect application CONUS rectangle `[-125,24,-66,50]` and match the current metadata-derived future catalog. Arbitrary archive runs, past frames and unsupported regions fail before tile GET.

Catalog fields and inferred types exported from contracts entry point: `ForecastRadarFrameSchema`, `ForecastRadarMetadataSchema`, `ForecastRadarCatalogSchema`, `ForecastRadarCatalogResponseSchema`, associated frame/catalog/response types. Adapter exports through maps entry point: `getForecastRadarMetadata`, `parseForecastRadarMetadata`, `buildForecastRadarCatalog`, `validateForecastRadarTile`, `buildForecastRadarTileRequest`, `fetchForecastRadarTile`, `validateForecastRadarPng`, `ForecastRadarError`, limits and the gate class.

Both routes, including errors, set `Cache-Control: private, no-store`. Successful PNG headers: `X-Forecast-Product`, `Frame`, `Model-Run`, `Valid-Time`, `Lead-Minutes`, `Retrieved-At`, `Metadata-Retrieved-At`, `Evaluated-At`, `Source-Time-Status`, `Coverage`, `Attribution`, `Freshness`, each prefixed `X-Forecast-`; also `X-Content-Type-Options: nosniff`. Retrieval remains original on cache hit. Source-time status is `pinned_model_run_requested`; catalog `actualSourceTime` remains null. PNG content does not independently verify meteorological valid time.

Lead owns application registration, UI and service-worker integration. These backend paths do not modify existing observed map routes/contracts. UI must restrict the forecast layer to CONUS, display model/run/valid time and attribution, preserve unknown coverage and illustrative legend, and exclude these API responses from service-worker weather caching. Coarse tiles intersecting the admission rectangle include pixels outside it: rectangle admission is not a raster mask or an AK/HI entitlement. No quantitative palette interpretation is exposed; blank pixels cannot establish no precipitation. No live browser or device acceptance claimed here.

## Bounds and cache behavior

Only the fixed IEM metadata URL and generated HTTPS pinned-run tile path are fetched. Metadata must have exact hourly UTC initialization, `forecast_minute:1080`, exact run+18h end and run no later than retrieval. Strict calendar round-trip rejects normalized impossible dates. Runs over four hours old fail on every catalog/tile read, including cache hits. Evaluation rejects future retrieval; time passing during tile fetch is checked again before response. Cache stores raw validated metadata, so future selection is recalculated on every read instead of freezing a past frame list.

Both metadata and tiles use existing `CachedRequests` with provider pool **noaa**, reservation weight **1 per cache miss**, TTL **300000 ms**, stale grace **0**. IEM attribution stays distinct from the accounting pool. Keys include source/version and tile run/lead/z/x/y. Exact cached identity and PNG signature/dimensions are revalidated. Binary bytes are base64 only inside the existing server JSON cache; clients receive PNG. No added databases, persisted provider names, configuration or migrations. Existing global SQLite cache admission/disk limitations apply; no dedicated partition or stricter filesystem cap is claimed.

A process-wide shared adapter gate allows at most **30 starts in a sliding minute**, **2 concurrent GETs**, and applies upstream 429 Retry-After cooldown (bounded 1–86400 s; default 60). No retries or redirects. The persistent shared NOAA pool applies in addition and can be stricter; gate refusals can consume a previously reserved NOAA unit without fetching (conservative accounting). The 30/minute/concurrency guard is process-local, not a multi-process IEM-global quota. Existing single API process is the deployment assumption; multiple API processes would each have a local gate but still share the existing NOAA quota.

Each GET has 12 s abort timeout, omitted credentials, strict response content type, declared and streamed cap: metadata 64 KiB, image 1 MiB. PNG signature/IHDR and 256 dimensions are validated without decoding full untrusted raster or claiming CRC/pixel correctness. AbortSignal is supported by direct adapters; pre-aborted work never fetches and in-flight abort releases its gate slot. Shared route cache work is deliberately not bound to one consumer's disconnect: cancellation of one UI tile does not cancel another coalesced consumer, and an already started shared GET may complete/cache within its timeout. No upstream cancellation claim for browser disconnection.

Full cold animation costs metadata plus visible tiles per frame, not one request per frame. UI should load only selected frame, optionally one next frame on explicit play, stop when hidden/switched and show throttling. No prefetch was added.

## Validation and evidence

Focused plus retained maps regression command:

```sh
node_modules/.bin/tsx --test packages/maps/src/*.test.ts apps/api/src/forecast-radar.test.ts
npm run typecheck
npm run build --workspace @zindycast/web -- --distPath /tmp/zindy-forecast-radar-build-20260911
```

`tests.tap` records **27/27 passing**: 15 forecast-specific tests and 12 existing observed-map tests. Coverage includes source/identity arithmetic, midnight horizon, quarter-hour exclusion at now, four-hour edge, invalid calendar/units/lead/horizon, fake archive/past IDs, XYZ y, AK/HI tile bounds, original retrieval/cache singleflight, exact cache identity, expired frame rejection on cached read, zero stale fallback, shared quota, local rate/concurrency/cooldown, redacted outages, byte caps, PNG signature/dimensions and abort. Tests use synthetic metadata and explicitly retained historical sample PNG; no fixture is presented as live. All SQLite test stores are `:memory:`.

Initial tests found an adapter retrieval parser rejecting nonzero milliseconds; fixed before the live check. Additional time-travel test setup initially used a storage clock captured before mocking Date.now, then read an entry after simulated expiry; corrected the isolated test clock/setup. These were not ignored assertions. Final typecheck passes. Production Rsbuild web build passes using isolated temporary output, removed afterward. Existing MapLibre dynamic-dependency warning and expected external-output-directory warning remain. Served artifacts were untouched. Root compression step was not run because it targets served assets.

Exactly **two live upstream GETs** were made after initial deterministic mocks, through isolated Fastify injection and in-memory SharedStorage using the real new route/adapter (not running application services):

1. Fixed metadata, HTTP 200 application/json; run **2026-09-11 14:00 UTC**, horizon end **2026-09-12 08:00 UTC**; fetch-to-headers sample 340.45 ms.
2. Pinned `REFD-F0180-202609111400/4/3/6.png`, HTTP 200 image/png, **5576 bytes**, 256×256, valid **2026-09-11 17:00 UTC**; fetch-to-headers sample 329.22 ms. Audit recorded **16:20:32.641 UTC**, about 39 minutes before valid time. Inspected image shows nonblank colored structures. SHA256 `b73d55a8f5293bece3e42965353c5fdd7a36fc671c0df59d9b6beebe35601cab` (same model-run tile as retained feasibility sample).

Exact catalog, selected frame, timing samples and response headers are in `live.json`; exact PNG is `live.png`. `live.ts` reproduces the manual audit with a hard two-fetch ceiling and no redirects/retries; **do not rerun without a new live request budget**. Timings are samples, not SLA. No application provider calls, production DB opens, services, notifications, accounts, remote mutations or delegation. Final live actions stopped at two GETs.
