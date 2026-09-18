# Satellite rendering and map quality — September 11, 2026

## Fresh browser reproduction

Actual system Chrome at 1440×1000, isolated web build and existing local API on 4311, selected Deltona/Florida **28.858, -81.17**. Other weather APIs returned explicit audit unavailability, so no forecast/weather data was fabricated for the initial live check. Only visible OSM tiles were permitted. No autoplay, map movements, provider retries, service-worker use or deployment.

The local API received **three GETs**, at 21:36:02–04Z: catalog, one radar frame, one satellite frame. Catalog cache TTL is two minutes; both frame calls followed within two seconds. This is at most three newly triggered NOAA requests assuming normal cached-catalog reuse, with a conservative four-request upper budget accounting for a catalog refresh race. Upstream cache-hit count was not instrumented; no claim of an exact upstream count. All subsequent map responses were retained/replayed in the audit harness. See [request log](live-results.json) and exact [responses](responses.json), including original request URLs, freshness, retrieval and advertised times. These files are diagnostic evidence only, never application live data.

Satellite advertised **21:28:00Z / 5:28 PM EDT**. HTTP200 returned an 800×500 PNG; browser decoding found all 400,000 pixels opaque and grayscale, 169 distinct shades, range63–233. Actual MapLibre image readiness was true, cloud texture visible, no page errors. Radar→Satellite→Future(unavailable)→Satellite retained the same canvas and restored the image. This does **not** reproduce a satellite transport/render failure and does not establish the cause of a different user's session failure or absolute cloud geolocation.

The actual satellite image substantially dims roads at the old65% weather opacity. Compare [before65%](satellite-before.png) and [45% comparison](satellite-45.png).45% improves place-name/road legibility while keeping cloud structure visible. The original slider had one shared setting: changing satellite to45% also changed radar to45%, and radar75% then changed satellite75%. That behavior is recorded in the live results.

## Changes

- `apps/web/src/interactive-map.tsx`: satellite default45%; radar/forecast retain65%. Keep explicit adjustments independently by exact product while the map is mounted. No camera/source reset or imagery refetch for opacity changes.
- `apps/web/src/maps.tsx`: passes exact selected product even during loading; concise infrared label includes nominal regional~2km/global~3km source detail. Source/cadence evidence remains in [prior NOAA content audit](../map-imagery-diagnosis/README.md), with actual retained capabilities. No color substitution or new provider.
- `apps/web/src/maps.test.ts`: more useful text/parent diagnostics for overflow failures.

[Replay results](replay-results.json) verify45% satellite default,65% independent radar default, restored45% satellite and75% radar adjustment, same canvas and no uncaught errors. The replay also uses a **synthetic forecast catalog and historical retained256px PNG**, through validated XYZ routes/headers, to test Satellite→rendered Future→Satellite. Eight visible fixture tile requests; no live IEM calls. [Forecast fixture screenshot](future-fixture.png) is lifecycle evidence only, not current Florida forecast or geographic accuracy.

## Forecast blur comparison

Retained source evidence documents a0.02° HRRR reflectivity raster, approximately2km at Florida. Existing forecast source maxzoom7 and raster linear resampling remain unchanged. [Offline comparison](forecast-interpolation.png) magnifies one historical provider tile3×: smooth rendering softens edges; nearest-neighbor produces harder but more visibly blocky pixels. It adds no model detail. This comparison uses browser image interpolation outside the application, not a newly validated map renderer or forecast.

Recommendation to the forecast owner: keep current smooth display and manual zoom; add a concise **coarse model grid** label. Do not claim sharper data from nearest-neighbor or increase tile budgets to cure source resolution. No automatic camera change is needed; the current zoom7 Florida view already shows regional context.

## Reproduce and limits

Build isolated:

```sh
npm run typecheck
npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-map-quality-dist
MAP_QUALITY_DIST=/tmp/zindycast-map-quality-dist node docs/verification/map-quality/browser.mjs
node docs/verification/map-quality/interpolation.mjs
FORECAST_MAP_DIST=/tmp/zindycast-map-quality-dist RADAR_CONTROLS_DIST=/tmp/zindycast-map-quality-dist npx tsx --test apps/web/src/maps.test.ts apps/web/src/forecast-map.test.ts packages/maps/src/maps.test.ts
```

The default quality browser command uses retained NOAA responses, synthetic future metadata and visible live OSM tiles; it does not call NOAA/IEM. Do not set `LIVE_MAP_QUALITY=1` without a new authorized provider budget. That manual mode makes at most three local map API GETs within90seconds and retains replies. Replays keep exact old metadata; they do not relabel retained NOAA imagery as current.

No backend/source changes justified by this reproduction. No forecast-owner files, root/shared configuration, dependencies, services or production assets changed. Physical devices, integrated release and the user's original failed session remain separate acceptance gates.

## Validation results

Typecheck and isolated production build pass (existing MapLibre dynamic-dependency warning). Combined23 checks initially passed22: forecast browser/cache/playback/cooldown and all provider checks passed, but the older observed browser audit counted the newly animated weather background's intentionally oversized spans as horizontal overflow. They are aria-hidden inside a fixed, overflow-hidden backdrop; screenshots show no visible overflow. Updated **only the owned test** to exclude that exact clipped decoration and explicitly check document scroll width, while preserving all content/map overflow checks and adding diagnostic text/parent fields. The observed suite is rerun separately after this test correction; logs retained alongside this record. No background or shared layout changes.

Final observed suite: **9/9 pass**, including actual Chrome cached Play/Pause, keyboard scrub, satellite/radar switches, idle resize stability, offline/hidden pauses,429, bounded six URLs and disposal, desktop/mobile content overflow. Forecast suite **6/6 pass** (actual Chrome cached Play/cooldown/autorecovery, polling, XYZ/pinned headers, same canvas, regional gating plus cache/time unit checks); maps provider **8/8 pass**. Thus all23 relevant checks pass across the initial run plus the corrected observed rerun. Retained [observed TAP](observed-final.tap), [observed browser results](observed-results.json), [forecast browser results](forecast-results.json), [initial combined TAP](combined-initial.tap) and typecheck/build logs preserve exactly what ran. All forecast/provider tests use fixtures. Quality screenshots inspected; no physical-device claim.
