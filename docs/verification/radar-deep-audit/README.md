# Observed radar temporal and spatial audit — September 12, 2026

No application changes: the measured browser does not reproduce a playback scheduling/decode stall or repeated-fetch loop. It does reproduce two product limitations: hard switching between observations roughly four minutes apart, and close-up blocky edges already present in the returned NOAA PNG.

## Fresh source images

Three local API GETs at 17:35:46Z: catalog and two 800×500 EPSG:3857 radar frames centered on Deltona (28.858, −81.17), at the geographic extents equivalent to MapLibre zoom 7 and 10 for an 800×500 viewport. All HTTP200, 70/374/217 ms respectively. No retry, autoplay, satellite, forecast, Mapbox, admission/counter, or remote service mutation. Conservative maximum four new upstream NOAA data requests allows one catalog refresh race; API cache hits were not instrumented. Catalog caches for two minutes; frames for five minutes, keyed by requested viewport/size/time/product/projection. Calls completed within one second.

Exact responses, timestamps, URLs and PNGs are retained as catalog.json, zoom7.json/png, zoom10.json/png, live-requests.json. Advertised requested time was 17:28:04Z; actual returned source time remains unconfirmed, exactly as returned by the API. These are diagnostic captures, never live fixtures in production.

[Zoom 7 native PNG](zoom7.png) shows regional storm structure. [Zoom 10 native PNG](zoom10.png) already has roughly 15-pixel steps on transparency boundaries, with colored contours internally smoothed. This is before MapLibre or React processing. The zoom10 extent is about53.5 km across, or67 m per output pixel; a1 km grid cell projects to about15 pixels. NOAA describes [MRMS grids at1 km](https://www.nssl.noaa.gov/projects/mrms/) and [SHSR mosaics at1 km](https://vlab.noaa.gov/web/wdtd/-/seamless-hybrid-scan-reflectivity-shsr-). The observed step size is consistent with this source grid, an inference rather than an independent geolocation/grid validation. Transparent black as displayed in the native image viewer is not a no-rain claim.

The fresh catalog's final six times are17:08:12,17:12:07,17:16:15,17:20:21,17:24:12,17:28:04Z: gaps231–248 seconds and19m52s total. A700 ms hard swap advances nearly four minutes of weather; the six-frame loop repeats in4.2 seconds and jumps almost20 minutes backward on wrap. This naturally looks discontinuous even with perfect rendering. A finer rendering timer cannot supply missing intermediate observations.

## Actual Chrome rendering measurement

Isolated current-source build /tmp/zindycast-radar-deep-before, empty public token, actual system Chrome using SwiftShader. Today dashboard with current CSS/MUI charts and a synthetic storm weather scene, desktop1440×1000 and phone viewport390×844. API replies are retained observed imagery and catalog plus explicitly synthetic weather timing; all outside requests return fixture failures, all other API paths are intercepted. Each advertised frame reuses the same retained PNG, so this measures scheduling/lifecycle cost and does not pretend to reproduce real storm evolution. Native source images above independently establish spatial behavior.

After a5.5s cache warmup, two8.5s samples per viewport compare storm scene running and paused. Each sample performs12 swaps through all six frames with **zero further frame GETs**. Raw instrumentation is in timings.json; summary.json contains computed quantiles. Every image's src assignment/onload, WebGL texImage2D/texSubImage2D call duration for blob images, RAF interval, timeline index transition and long task is recorded.

| View / scene | Index interval median / max | Image onload median / max | Upload API call median / max |
|---|---|---|---|
| Desktop running |700 /716.8 ms|0.3 /5.3 ms|4.8 /7.9 ms|
| Desktop paused |700 /716.7 ms|0.3 /2.8 ms|3.9 /4.4 ms|
| Phone running |700 /716.6 ms|0.3 /1.5 ms|4.8 /6.7 ms|
| Phone paused |700 /716.7 ms|1.2 /2.5 ms|4.1 /7.2 ms|

RAF median16.7 ms, max16.8 ms; zero >50ms long tasks in all four windows. Twelve image assignments and twelve texture upload calls per12 swaps confirm work repeats on backtracking, but onload is very cheap because the browser can reuse its decoded image resource. New Image creation does **not** prove full PNG decoding repeats. Upload call duration measures CPU/API submission under software GL, **not GPU completion or physical-device cost**. Background pause did not improve700ms scheduling. Another isolated regression process began near the end of the phone paused sample; no long task or missed RAF was observed. Do not generalize these small timing samples to physical phone GPUs or the user's browser session.

Existing source/layer IDs are reused; image update is atomic, raster fade is0, interpolation is linear. Parent rerenders do not recreate the map or reassign unchanged URLs. There is no observed performance benefit large enough here to justify a second decoded cache, GPU texture cache, image interpolation, or another lifecycle change.

## Concrete next step

Keep regional initial framing (already zoom7), allow manual zoom, and explain coarse source resolution when users zoom into the mosaic. For temporal smoothness, evaluate a genuinely finer-cadence observed feed and a longer retained history together with provider budgets; more history alone does not reduce four-minute gaps. A loop-end dwell and user speed setting could improve orientation, but are presentation choices, not fixes for an observed timing defect. Crossfading would blend reflectivity colors from distinct times and must not be sold as new meteorological detail. No fabricated advection/intermediate scans were implemented. Forecast data/provider alternatives belong to the lead's parallel audit.

## Reproduce and checks

```sh
PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-radar-deep-before
RADAR_CONTROLS_DIST=/tmp/zindycast-radar-deep-before node docs/verification/radar-deep-audit/browser.mjs
node docs/verification/radar-deep-audit/summarize.mjs
npm run typecheck
RADAR_CONTROLS_DIST=/tmp/zindycast-radar-deep-before npx tsx --test apps/web/src/maps.test.ts
```

Do not rerun live.mjs without another authorized live budget. It caps itself at three localAPI GETs and has no retries. Browser reproduction makes no real weather/basemap/admission calls. Build and typecheck pass; observed node:test result is retained in observed-tests.tap. Playback screenshots desktop/phone and both native source PNGs were inspected. No physical-device, live-animation fidelity, exact source-time or integrated deployment acceptance claim.
