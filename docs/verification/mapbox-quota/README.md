# Shared Mapbox request admission — browser verification

September 12, 2026. This frontend change requires a fresh same-origin `POST /api/v1/maps/mapbox/admission` before each Mapbox tile fetch. The POST has no body, uses same-origin credentials, bypasses HTTP caching, rejects redirects, and combines tile/session cancellation with a five-second timeout covering response-body decoding. Only HTTP 200 JSON with `allowed: true`, `limit: 190000`, and safe-integer `used` from 1 through 190000 permits a fetch. Cancellation is checked again after admission; permits are never reused or refunded. Every attempted tile fetch, including failed and browser-HTTP-cached responses, obtains admission.

A validated limit denial shows “Mapbox request budget reached — using standard map.” Other admission failures show “Mapbox request counting unavailable — using standard map.” Existing base-only fallback preserves the map, camera, and weather sources. Failure and its reason remain sticky across map remounts; explicit retry must obtain another server permit. Standard OSM requests and disabled/missing-token Mapbox perform no admission. Existing weather protocols are independent.

The lead owns the authoritative shared deployment host counter, its conservative rolling 32-day accounting window, persistence/atomicity, API tests, and deployment. These browser fixtures do not verify the real server's counter and never call it. All network origins are intercepted. Mapbox tiles are synthetic grid PNGs; weather uses retained imagery and synthetic forecast metadata, not live weather or actual Mapbox street appearance. No credentials, production artifacts, services, or dependencies changed.

## Reproduce

```sh
npm run typecheck
PUBLIC_MAPBOX_ACCESS_TOKEN=pk.fixture npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-mapbox-quota-dist
PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-mapbox-quota-no-key-dist
BASEMAP_DIST=/tmp/zindycast-mapbox-quota-dist BASEMAP_QUOTA_DIST=/tmp/zindycast-mapbox-quota-dist BASEMAP_NO_KEY_DIST=/tmp/zindycast-mapbox-quota-no-key-dist BASEMAP_EVIDENCE_DIR=docs/verification/mapbox-quota/fallback-regression npx tsx --test apps/web/src/basemap.test.ts
RADAR_CONTROLS_DIST=/tmp/zindycast-mapbox-quota-no-key-dist FORECAST_MAP_DIST=/tmp/zindycast-mapbox-quota-no-key-dist npx tsx --test apps/web/src/maps.test.ts apps/web/src/forecast-map.test.ts
```

`browser.mjs` covers no-key/standard bypass, quota exhaustion, unavailable/malformed/invalid-JSON admission, real five-second admission timeout, cancellation while a permit is pending, one admission per successful visible tile fetch, and two browser installations sharing a fixture counter. Denial/retry/remount checks require zero Mapbox requests. Desktop and phone-width screenshots record visible fallback and weather. The existing Mapbox fallback harness now stubs successful admission locally and writes its regression evidence to this directory when requested; it retains manual switches, forecast preservation, HTTP failure and twelve-second image-loading timeout coverage.

The no-key isolated build uses a whitespace environment override, which trims to disabled. An empty environment value allowed Rsbuild dotenv loading to rehydrate the local public key; the first fixture attempt detected that before any real network requests (all routes were intercepted). `.env.local` is untouched.

## Final results

Typecheck and both isolated builds pass (existing MapLibre dynamic-dependency warning). All 20 relevant test cases pass across the focused runs: three controller/admission unit tests, the existing Mapbox Chrome audit, the new quota Chrome audit, and 15 observed/future tests including their actual Chrome audits. The first combined run passed the existing fallback audit but exposed a quota-test selector that incorrectly expected the status paragraph to exclude its nested retry button. The corrected status-role selector passes; `first-combined-test.log` preserves that failure and `browser.log` records the final quota pass. The upper-bound permit unit assertion was added and verified separately in `unit.log`.

Quota Chrome recorded six initial admission calls per denied visible viewport and **zero Mapbox fetches** for limit, 503, invalid count, invalid JSON, timeout and pending-permit cancellation. Timeout fallback occurred about 5.8 seconds after navigation, including startup. Eight successful permits matched eight actual tile fetches; a second installation sharing the exhausted fixture counter fetched zero Mapbox tiles. Manual standard selection bypassed admission; retry and remount could not bypass denial. Canvas identity, marker position, weather readiness and observed request count were preserved when an already loaded Mapbox map hit exhaustion. No uncaught page errors; 390×844 had no document overflow. Desktop/mobile screenshots inspected. Existing forecast selection/cache/play/cooldown/refresh regression remains passing.

No live Mapbox, NOAA, IEM or production admission/counter requests occurred. Integrated server persistence/atomicity and deployment host deployment remain lead acceptance gates; physical devices and real-provider appearance are not claimed.

## Integrated release

Lead reviewed admission, controller cancellation and atomic server storage. Final typecheck, root production build, and17 server/storage/client unit cases pass (two browser cases skipped in this final unit command; their separate successful Chrome runs are above). Published web build and restarted only zindycast-api.service. Local health succeeded and one bodyless admission POST returned allowed=true, used=1, limit=190000, Cache-Control:no-store. This deliberately consumes one conservative production reservation without contacting Mapbox. No counter resets or quota-exhaustion experiments on production. Users need the new app update on every device; old open versions predate admission. Existing MapLibre build warning remains.
