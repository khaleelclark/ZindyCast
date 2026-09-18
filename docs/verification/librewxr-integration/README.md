# LibreWXR opt-in client integration — September 12, 2026

Implemented only `apps/web/src/maps.tsx`, `maps.test.ts`, `interactive-map.tsx`, new `libre-radar.tsx`/`libre-radar.test.ts`, and this verification directory. The lead owns the shared schema, API, provider access and release. No deployment, production build, service mutation, dependency/configuration change, credential edit, or live request performed by this task.

## Behavior

Map info/settings → Radar source → LibreWXR trial opts the current panel into the trial. NOAA remains the default; the trial choice is panel-local. Radar shows advertised past composite frames; Future radar shows **Experimental nowcast · LibreWXR**, with model-blending/optical-flow explanation. Satellite remains NOAA. The explicit **Use NOAA radar** action changes to observed NOAA and announces that source/time-mode change. Errors never silently relabel nowcast as observed.

First trial deliberately provides a manual timeline, up to six advertised frames, with local timezone labels. It does **not** claim smoother animation or add Libre Play. NOAA playback is unchanged. Weather-model fallback and missing/transparent coverage caveats remain visible in expandable details. LibreWXR/CC-BY4.0, NOAA/IEM, ECMWF and Italian DPC/CC-BY-SA data attribution is included; no claim that all pixels are verified MRMS observations.

Only same-origin `/api/v1/maps/libre/catalog` and `/api/v1/maps/libre/tiles/:time/:z/:x/:y.png` are requested. Schema validation uses the lead's exported `LibreRadarCatalogSchema`. A catalog generated more than 20 minutes ago or over one minute ahead is ineligible. Past entries must be within two hours of generation and not future-dated. Nowcast must still be future-dated and within one hour of generation. No synthesized/interpolated timestamps or storm motion.

Each tile verifies HTTP200, PNG content type, exact `X-Libre-Frame`, PNG signature, 512×512 dimensions and ≤2MiB response. Custom MapLibre protocol uses tileSize512, XYZ, maxzoom10. Visible requests serialize across sessions; first failure cancels queued work. Each network request/body/decode has a 10-second timeout, and initial visible-source completion has a 15-second deadline. Frame eligibility is rechecked around async work. Protocol/source IDs are unique and callbacks are fenced by cancellation.

A shared memory cache holds at most32 decoded512px images (~32MiB; non-browser raw-byte fallback separately bounded by32 ×2MiB). Entries expire after at most five minutes, catalog expiry or the future frame's valid time. Consumers receive copies; evicted ImageBitmaps close. Only visible requested tiles load—no live autoplay or offscreen prefetch. Selecting a source/frame replaces only the weather source, never the map style, basemap, marker or camera. This manual trial removes the prior frame during loading instead of displaying it under a different time label.

## Verification

```sh
npm run typecheck
PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-librewxr-integration-dist
RADAR_CONTROLS_DIST=/tmp/zindycast-librewxr-integration-dist FORECAST_MAP_DIST=/tmp/zindycast-librewxr-integration-dist npx tsx --test apps/web/src/maps.test.ts apps/web/src/forecast-map.test.ts apps/web/src/libre-radar.test.ts
LIBRE_RADAR_DIST=/tmp/zindycast-librewxr-integration-dist node docs/verification/librewxr-integration/browser.mjs
```

Typecheck and isolated empty-token build pass (existing MapLibre bundler warning). Focused regression **18/18** passes: Libre3 plus existing observed9/future6, including existing actual Chrome playback, cached loops, keyboard, hidden/offline, quota recovery, lifecycle, camera and overflow checks. Logs retained here.

Dedicated actual system Chrome fixture audit covers desktop1440×1000 and touch/mobile390×844: NOAA default makes zero Libre requests; observed→manual previous→cached next→nowcast→satellite→observed→NOAA uses same canvas and marker transform (camera proxy); no HRRR catalog/tile or Mapbox/admission calls in those transitions; no document overflow or uncaught page errors. Initial catalog503/null/expired-generation yields zero tile requests. Expired future entries are withheld. Tile429/502/wrong-time/badPNG/10-second timeout stops after one request with no loop and explicit NOAA recovery. `results.json`, `desktop.png`, `mobile.png`, `browser.log` retain results; screenshots inspected.

Early checks exposed a premature ready label and the shared select minimum width overflowing a narrow map; fixed completed-frame identity and constrained the owned select width. The expired-catalog fixture originally allowed valid observed requests before switching to Future; corrected its past array to empty to isolate that check. The timeout assertion now waits long enough for the actual10-second timer. Final outcomes are in the retained logs/results.

## Evidence limits

**All browser network origins are intercepted**. Basemap uses a generated neutral grid. Observed PNG is `../librewxr-trial/libre-observed.png`; nowcast PNG is lead-retained `../librewxr-trial/chrome-nowcast.bin`. Both point tiles are reused at every fixture XYZ and under explicitly synthetic fresh timeline metadata. Screenshots are visibly labeled retained fixture replay. Repeated seams are a fixture limitation, not geospatial acceptance evidence. These tests establish decoded rendering, UI timing, failure behavior and map lifecycle, **not live geography, radar accuracy, storm evolution, source freshness, smooth playback or physical-device performance**.

Zero live LibreWXR, NOAA, IEM, Mapbox, production admission/counter or other weather API calls. The existing trial evidence and lead's catalog/nowcast/normal-Node access audit supply the bounded live feasibility evidence. Integrated API/provenance/XYZ matching, public-service health and release acceptance remain lead gates.

Sources already retained/reviewed in the feasibility trial: [LibreWXR API and nowcast README](https://github.com/JoshuaKimsey/LibreWXR#api-endpoints), [public data licensing](https://librewxr.net/#data-licensing). No new provider research requests made by this implementation.

## Lead integrated release

Production build and typecheck passed;18 lead focused API/storage/Libre tests passed, and API4/4 rerun after the quota correction. New provider configuration initially tripped the durable-storage config guard; corrected to share the existing NOAA imagery quota bucket, preserving database/counters, then service restarted successfully. Brief API interruption occurred during this correction.

Final actual Chrome run on served build, live Libre catalog/XYZ tiles THROUGH deployed local API: observed eight tiles and nowcast eight tiles loaded; same canvas/camera, zero pageerrors, zero Mapbox/admission/other live weather calls. Other weather and basemap were fixture responses, not a full live weather dashboard. Screenshot live-integrated.png visually inspected.16 tiles cover the wide1440px map's two frames; earlier harness ceilings8/12 stopped prematurely, corrected to16 and cached catalogue reused. Those attempts incurred at most20 tile API GETs combined, many reused server cache; final16 reused those keys except four newly needed. No blanket upstream-hit count claim. Initial attempt met service startup failure above. Final live-integrated.json is passing acceptance evidence.

Released optional manual Libre trial; no smooth-playback claim. Select Map info/settings → Radar source → LibreWXR trial. Original NOAA remains default.
