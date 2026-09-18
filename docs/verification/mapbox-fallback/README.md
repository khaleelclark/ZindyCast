# Mapbox basemap with standard fallback

September 12, 2026. Owned implementation: `apps/web/src/interactive-map.tsx`, new `basemap.ts` and `basemap.test.ts`. Lead owns public-token configuration, CSP and operational documentation. No production build/deployment, credentials, new dependencies or live Mapbox/weather requests in this task.

MapLibre remains the renderer. A base-only controller adds Streets v12 raster tiles beneath the existing weather layers, retaining map/camera/source identities. Switching never calls setStyle. Unique base source/protocol IDs fence late callbacks. Requests use the public token only in the fetch boundary, with generic errors returned to MapLibre so token URLs cannot enter application errors or console logging. Browser developer-network records necessarily contain the browser-visible public token.

Failed Mapbox requests or incomplete visible loading after 12 seconds cancel the active base session and select standard OSM. Failure is sticky for the page session, including map remounts. Explicit Try Mapbox/Use Mapbox clears that fence. Use standard map persists in a dedicated localStorage key; unavailable storage is harmless. Weather/source errors cannot cause Mapbox fallback. Standard-tile failures remain independently visible. No key means standard tiles and no Mapbox network requests.

Mapbox/OSM text links and Improve this map are shown when Mapbox is selected. The feedback link follows camera coordinates/zoom. The unmodified Mapbox logo embedded in the official attribution example is retained as a data SVG and displayed in a top-left map control below the scale (clear of mobile attribution wrapping). Standard maps retain OSM credit/reporting. No generated or reconstructed logo.

## Official source checks

- [Static Tiles API](https://docs.mapbox.com/api/maps/static-tiles/): raster tiles from classic styles; Standard is unsupported. Streets v12, 512 tile size, @2x high-density response. This changes basemap appearance only and does not add meteorological resolution.
- [Attribution guidance](https://docs.mapbox.com/help/dive-deeper/attribution/): Mapbox logo plus Mapbox/OSM/feedback links required with other renderers; logo must not be altered. Embedded SVG copied exactly from that page's attribution example, with no remote logo request.
- [Official Leaflet integration example](https://docs.mapbox.com/help/ja/dive-deeper/mapbox-in-leaflet/): matching Streets v12 `/tiles/512/{z}/{x}/{y}@2x` pattern for a raster renderer.

## Reproduce, using fixtures only

```sh
npm run typecheck
PUBLIC_MAPBOX_ACCESS_TOKEN=pk.fixture npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-mapbox-dist
PUBLIC_MAPBOX_ACCESS_TOKEN= npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-basemap-no-key-dist
BASEMAP_DIST=/tmp/zindycast-mapbox-dist BASEMAP_NO_KEY_DIST=/tmp/zindycast-basemap-no-key-dist npx tsx --test apps/web/src/basemap.test.ts
RADAR_CONTROLS_DIST=/tmp/zindycast-basemap-no-key-dist FORECAST_MAP_DIST=/tmp/zindycast-basemap-no-key-dist npx tsx --test apps/web/src/maps.test.ts apps/web/src/forecast-map.test.ts
```

The browser script intercepts every origin. Mapbox/OSM are synthetic grid PNGs; observed APIs use retained NOAA responses with request-adapted metadata, future uses a synthetic catalog with retained historical PNGs, and other APIs explicitly fail as fixtures. Images are lifecycle/attribution/layout evidence, **not actual Mapbox street style or current weather**. No physical-device or real token/entitlement assertion. The user-supplied URL-restricted public token and integrated CSP/deployment acceptance remain lead gates.

## Verification record

Final typecheck passes. Both isolated production builds pass with the existing MapLibre dynamic-dependency warning. Focused tests cover pinned XYZ URL validation, source-scoped failure, standard preference/storage denial, stale callback fencing and controller cleanup without touching weather sources.

Actual system Chrome exercises missing token and stored standard preference (zero Mapbox requests), accepted 512/1024 PNGs, same canvas/marker transform across manual switches, no additional observed/forecast GETs, selected forecast time and imagery preserved through a 429 basemap failure, and 401/403/429/500/12-second startup fallback. Initial failures start at most six concurrent visible image requests, then cancel and stop. Remounting does not retry Mapbox; explicit retry recovers. A previously successful source that stalls after zoom also falls back while preserving the resulting camera and weather. Desktop 1440×1000 and mobile 390×844 screenshots were inspected; the scale and official logo use the upper-left corner to avoid attribution wrapping at the bottom.

`results.json` records the dedicated browser outcomes; `desktop.png` and `mobile.png` are fixture screenshots. Existing observed/future Chrome regression checks also cover cached Play, cooldown/recovery, polling, idle resize stability, selected-only forecast loading, same canvas and object-URL cleanup. Logs: `/tmp/zindycast-basemap-test.log`, `/tmp/zindycast-basemap-regression.log`, `/tmp/zindycast-mapbox-build.log` and `/tmp/zindycast-basemap-no-key-build.log`.

Lead integration: root typecheck/build and seven configuration/controller/CSP/static tests passed. Dedicated Chrome basemap test rerun against the reviewed synthetic-token build and final no-token production build: all three tests pass, zero real upstream calls. Retained integration logs included here. Current published build has no token, so standard OSM remains active. Real-token street appearance and API CSP service reload are activation gates.
