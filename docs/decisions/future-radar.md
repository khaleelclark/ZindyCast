# Future radar — free source decision and integration proposal

Audited 2026-09-11. Scope: documentation only; no implementation, service changes, accounts, paid access, or application provider requests. Exactly two live weather-data GETs were performed, separately from documentation/source reads. Existing research is preserved.

## Decision

**A viable free source was verified: Iowa Environmental Mesonet (IEM) HRRR simulated reflectivity.** One metadata response and one explicit-run future PNG succeeded. Implement a separate **Forecast radar — HRRR simulation** layer; retain observed radar as a separate timeline. This is model output, not extrapolated radar observations, rainfall probability, rainfall accumulation, or a promise that rain reaches a particular yard. [NOAA HRRR model description](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php) describes its numerical prediction and assimilation system.

This is source feasibility, not release/browser acceptance. No application feature is claimed complete by this audit.

## Source comparison

| Source | Primary evidence and decision |
|---|---|
| IEM HRRR | [Official service documentation](https://mesonet.agron.iastate.edu/GIS/model.phtml): REFD is simulated reflectivity 1000 m above ground; PNGs are provided with explicit initialization time and lead minutes. Quarter-hour steps through 18 hours, raster spacing 0.02 degrees. Typical processing availability about 1h50m after initialization. Service explicitly permits commercial use; no registration/payment was needed for our sample. Use REFD initially; REFP precipitation-type styling is a separate product. |
| NOAA nowCOAST | [2023 migration notice](https://www.weather.gov/media/notification/pdf_2023_24/scn23-12_nowcoast_aab.pdf) replaced the old ArcGIS services with WMS. The retained [September 10 capabilities](../research/maps/followup-nowcoast-capabilities.xml) contain observed regional reflectivity and NDFD 6-hour precipitation amount/12-hour probability for CONUS/AK/HI; no HRRR or simulated-reflectivity layer was found. NDFD precipitation forecasts may be useful overlays, but cannot be labeled future radar. No new live nowCOAST request spent. |
| RainViewer | [Current transition summary](https://www.rainviewer.com/api/transition-faq.html) says public nowcast and satellite API data ended January 1, 2026. Remaining personal/educational radar is past two hours in ten-minute intervals, capped zoom 7 and 100 requests/IP/minute. Consumer-app nowcast advertising is not a free API entitlement. Reject as future source. |
| NOAA GSL graphics/raw HRRR | [GSL page](https://rapidrefresh.noaa.gov/hrrr/) warns automated graphic scrapers may be blocked. [NCEP inventory](https://www.nco.ncep.noaa.gov/pmb/products/hrrr/) distinguishes CONUS/Alaska model products. Raw GRIB processing would need a separate renderer/resource design; neither is an immediate replacement for the verified tile service. |

IEM use permission is service-specific, not a claim that its whole website has a blanket public-domain license. Proposed visible attribution: **NOAA/NCEP HRRR; Iowa Environmental Mesonet** with links to the model and IEM service. No numeric HRRR tile quota or SLA was found in reviewed official documentation; do not invent unlimited entitlement. Apply our own conservative shared budget below and respect provider errors/Retry-After.

## Endpoints and actual evidence

Allowlist only HTTPS host `mesonet.agron.iastate.edu`, with these fixed paths:

- Metadata: `/data/gis/images/4326/hrrr/refd_1080.json`.
- Pinned tile: `/cache/tile.py/1.0.0/hrrr::REFD-F{MMMM}-{YYYYMMDDHHmm}/{z}/{x}/{y}.png`.
- Documented WMS alternative: `/cgi-bin/wms/hrrr/refd.cgi`, layers `refd_MMMM`. Not selected: this audit did not establish explicit-run locking through WMS; independently updated latest layers could mix runs.

Never use initialization `0` (mutable latest), accept arbitrary provider URLs, or infer initialization from HTTP Date. The [IEM OGC catalog](https://mesonet.agron.iastate.edu/ogc/) advertises five-minute caching for `/cache/` and the HRRR template. Its [official OpenLayers example](https://mesonet.agron.iastate.edu/ogc/openlayers_example.html) calculates y from `(maxExtent.top - bounds.top)`, x from the left, with EPSG:3857: use **XYZ/north-origin y**, despite the generic TMS name. Do not flip y. Our PNG is 256×256.

Live GET 1, response Date **2026-09-11 16:08:46 GMT**, HTTP 200 `application/json`, 115 bytes, elapsed 0.4124 seconds, Last-Modified 15:40:27 GMT, CORS `*`:

```json
{"model_init_utc": "2026-09-11T14:00:00Z", "forecast_minute": 1080.0, "model_forecast_utc": "2026-09-12T08:00:00Z"}
```

Live GET 2, response Date **2026-09-11 16:09:10 GMT**, HTTP 200 `image/png`, 5576 bytes, elapsed 0.3319 seconds, cache max-age 300, CORS `*`:

```text
https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0180-202609111400/4/3/6.png
SHA256 b73d55a8f5293bece3e42965353c5fdd7a36fc671c0df59d9b6beebe35601cab
```

The image was opened with the image inspection tool: colored echo-like structures on a blank background, not an empty/error graphic. Initialization 14:00Z plus 180 minutes gives **17:00Z**, about 51 minutes after retrieval. That time is derived from documented URL semantics and metadata; the PNG itself carries no independently verified meteorological timestamp. These single-request timings are samples, not a latency SLA. The initial command used unavailable `python`; it made zero requests. Retried execution with `python3` performed the two requests above without redirect responses observed. Documentation/source fetches are excluded from the explicitly separate two-data-GET budget. No additional tile, legend, Alaska/Hawaii or application requests were made.

## Coverage and legend limits

Release scope should initially be **CONUS only**, with Alaska/Hawaii explicitly unavailable for this forecast product. The two-request check established one central/southwestern CONUS tile, not every mainland pixel. The IEM documentation does not advertise a separate Alaska/Hawaii HRRR tile identifier. NOAA having an Alaska model and experimental Hawaii graphics does not establish that IEM serves them. Do not derive worldwide coverage from a global XYZ address space.

A proposed initial admission rectangle `[-125,24,-66,50]` is an **application CONUS viewport restriction**, not a provider-advertised extent or coverage mask. Preserve `coverageState: unknown`; return outside-supported-region for Anchorage/Honolulu. Exact raster/domain bounds and boundary behavior remain a source-code/capabilities follow-up if required for a broader viewport. Inside the admitted region, transparent/blank pixels cannot prove no precipitation or valid model coverage.

The IEM REFD docs say its palette follows N0Q. Do not reuse NOAA nowCOAST's unrelated 0–80 legend. A matching N0Q legend/palette must be sourced and checked before displaying a quantitative color scale; an explicitly illustrative legend plus dBZ explanatory text is honest interim behavior. No pixel-to-rainfall conversion or precipitation-type classification is supported by this sample.

## Concrete shared interfaces (proposal; lead owns changes)

Keep existing observed schemas invariant: currently MapCatalog requires NOAA/nowcoast-wms-v1, max five products, observed classification/history, and MapFrame has null actualSourceTime. Prefer new schemas/routes instead of weakening those invariants:

```ts
type ForecastRadarFrame = {
  id: string;                       // generated run+lead identity
  modelRunTime: string;             // validated UTC ISO
  forecastLeadMinutes: number;      // integer multiple of 15, 0..1080
  validTime: string;                // exact run + lead
};
type ForecastRadarCatalog = {
  provider: 'Iowa Environmental Mesonet';
  sourceModel: 'NOAA/NCEP HRRR';
  version: 'iem-hrrr-refd-v1';
  productId: 'forecast-hrrr-conus';
  classification: 'modeled';
  temporalKind: 'forecast';
  quantity: 'simulated_reflectivity_1000m_agl';
  units: 'dBZ';
  region: 'CONUS';
  coverageState: 'unknown';
  retrievedAt: string;
  modelRunTime: string;
  horizonEnd: string;
  frames: ForecastRadarFrame[];      // <=12, strictly ascending
  defaultFrameId: string | null;
  sourceUrl: string;                // fixed metadata URL
  attribution: string;
};
```

Wrap with existing success/freshness convention and explicit unavailable/error reasons (`outside_supported_region`, `invalid_metadata`, `model_run_too_old`, `no_future_frames`, `provider_error`, `rate_limited`). Proposed `GET /api/v1/maps/forecast/catalog` and `GET /api/v1/maps/forecast/tiles/{frameId}/{z}/{x}/{y}.png`. A tile response binds product, run, lead, valid time, retrieval, attribution and request-time status in headers or an associated validated manifest; the opaque PNG is not proof of actual source time. Return `sourceTimeStatus: pinned_model_run_requested`, `actualSourceTime: null`. Server validates frame membership against its catalog; no arbitrary run/archive proxy.

Metadata validation: exact calendar UTC timestamps, run at hour boundary, run <= retrieval, forecast_minute exactly 1080 (accept JSON numeric 1080.0), model_forecast_utc exactly run+1080min. Set a versioned engineering maximum run age of four hours and metadata refresh cache of five minutes; stale cached output keeps its original retrieval/run labels and cannot become current on cache hit. A provider delay exceeding this is unavailable, not a newer run fabricated from wall clock.

Proposed initial **next three hours / up to 12 quarter-hour frames**: for integer k in 0..72, compute valid=run+k*15min, retain valid>now and valid<=min(now+3h,horizonEnd), take first 12. Re-evaluate eligibility as time passes, including on cache hits. One pinned run for the whole animation. This is an application horizon, not the model's full advertised horizon. Never stretch twelve past frames into the future or smoothly interpolate invented forecast imagery.

Request builder after catalog/frame validation:

```ts
const lead = frame.forecastLeadMinutes.toString().padStart(4, '0');
const run = frame.modelRunTime.replace(/[-:]/g, '').replace('T', '').slice(0, 12);
// z integer 0..7, x/y integer 0..2**z-1; region restriction applied separately
const url = new URL(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${lead}-${run}/${z}/${x}/${y}.png`);
```

Zoom 7 is our initial load/detail bound, not a documented IEM limit. HTTP fetch: credentials omitted, redirects rejected, 12-second timeout, no automatic retries, metadata <=64KiB, PNG <=1MiB with streamed cap/signature/IHDR256×256 checks. Key caches by source/version/product/run/lead/z/x/y; never key a future frame by lead alone. Singleflight, shared quota and cooldown must include both catalog and tiles.

## Resource and acceptance gates

Proposed shared IEM ceiling **30 uncached requests/minute**, concurrency two, metadata at most once per five minutes, with existing global disk-cache admission and an initial 16MiB product partition. These are app choices, not provider guarantees. Render only the selected frame; optionally one next frame after an explicit play action, and stop on hidden page/location/layer change. Do not prefetch all twelve frames or offscreen tiles. If V visible tiles change for each frame, a cold full pass costs `1+12*V` requests (e.g. V=4 =>49), not 12; 30/minute therefore deliberately throttles cold animation. Cached replay is smoother. Expose loading/limited state instead of bypassing quota for animation.

Lead should integrate the contracts, adapter/quota/cache and UI together, or assign disjoint ownership. Required checks: malformed dates/lead/run identity, stale and expired frames, missing future horizon, XYZ y regression, duplicate refresh, bounded body/content type, 429/cooldown, cancellation, no arbitrary URL/archive query, and CONUS/AK/HI gating. Real browser checks must demonstrate correct geographic overlay, explicit observed/forecast switching, visible run+valid time, <=12frames, actual future frame, unit-independent dBZ, stale retention with labels, old-location rejection, attribution/legend, offline and provider failure. Current audit does not substitute for those checks.

Documentation-only validation: sample time arithmetic, PNG signature/dimensions/hash and embedded evidence round-trip checked offline; no typecheck/build run because no code changed and served assets must remain untouched.

## Embedded sample evidence

The following is the exact historical sample PNG, retained inside the sole owned file. Decode locally for review; never ship it as live data.

```base64
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
```
