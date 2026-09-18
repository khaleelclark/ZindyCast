# Radar flashing investigation — September 11, 2026

Confirmed an application layout/lifecycle feedback loop in actual Chrome with local fixtures. This was not evidence of a meteorological provider refresh storm or a MUI chart rendering defect.

## Causes and fix

- MapLibre 6.9.0 `resize()` emits movement events even with unchanged dimensions/bounds (`node_modules/maplibre-gl/src/ui/map.ts`, resize implementation). The app also registered a second ResizeObserver although MapLibre already observes its container. Its unconditional movestart handler hid imagery, cleared the viewport, and caused cache invalidation. Removed the duplicate observer; compare rounded geographic bounds before invalidation, and suppress identical settled-view notifications. Real pan/zoom/resize still invalidates and reloads the changed view.
- Today uses a flex-sized map alongside a variable-height weather card. Clearing the result on viewport invalidation removed last-frame stale/partial notices. Loading then restored those notices, changing map height again. A fixture with stale/partial imagery produced repeated identical requests and true/false readiness transitions (11 requests versus 5 at start of the hover/clock check) even after the first movement guard. Preserve last-frame notices and bounded cache through viewport settlement, and reserve the loading status row's height. Imagery remains hidden when the actual view changes; old notices explicitly refer to the last retrieved frame.
- Overlay decoding now depends on URL/bounds values, and map construction on region coordinates, rather than object identities. Parent renders alone cannot reset the canvas or decode the same raster again.
- Cache remains at most six observed blob URLs across views. Evict before creating the replacement URL, including the instantaneous allocation peak. Layer/city/offline/revision/unmount cleanup remains intact.

## Reproduction and checks

```sh
npm run typecheck
npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-flashing-dist
FORECAST_MAP_DIST=/tmp/zindycast-flashing-dist RADAR_CONTROLS_DIST=/tmp/zindycast-flashing-dist npx tsx --test apps/web/src/forecast-map.test.ts apps/web/src/maps.test.ts
RADAR_CONTROLS_DIST=/tmp/zindycast-flashing-dist node docs/verification/radar-flashing/today-browser.mjs
```

The Maps browser regression injects repeated identical ResizeObserver notifications, crosses the app's one-minute clock tick, and asserts no extra frame requests, observed image decode, readiness mutations, forecast bitmap copies, or canvas replacement. Forecast also checks no-op Recenter. The added observed test fails against `/tmp/zindycast-future-play-dist`: two image requests instead of one after identical notifications. `before.tap` retains that result.

The Today audit loads the real current dashboard and MUI charts at 1440×1000 and 390×844, performs twenty chart hover movements per viewport, advances the browser clock 61 seconds, and asserts stable raster readiness/canvas, no added map requests, and no horizontal overflow. Screenshots and `today.json` retain results. Three total startup frame requests across the two navigations are legitimate initial layout settlement, not ongoing idle requests.

The full map suites retain observed cached animation, keyboard scrub, layer/viewport/hidden/offline transitions, 429 no-retry behavior, six-URL cleanup, forecast chronological cached playback, 450ms scrub debounce, pinned XYZ/headers, shared cooldown and automatic recovery, catalog polling, AK/HI gating, and mobile/desktop overflow checks. Future network remains serialized; no source/backend behavior changed.

All browser APIs are local retained/synthetic fixtures and all external requests are blocked. Today weather times are explicitly adapted synthetic values; map advertised timestamps remain retained values. Images are not live or spatial-accuracy evidence. Resize notification injection is a deterministic lifecycle stressor; actual chart hover/resize and DOM geometry are checked separately. Physical devices and the integrated deployed release remain lead acceptance gates. Production output and services were not changed.

Final results: typecheck and isolated production build passed (existing MapLibre dependency warning); combined node:test suite **14/14 passed**, including both real Chrome browser audits. Today browser audit passed separately; desktop/mobile screenshots inspected. `after.tap`, `observed.json`, `forecast.json`, `today.json`, `build.log`, and `typecheck.log` are retained here.

## Integrated release

Lead built the served release and reran typecheck plus all web tests: 80 passed, 2 opt-in browser tests skipped. Both opt-in map/browser suites were then run explicitly against apps/web/dist: 14/14 passed (release-tests.tap). Earlier source evidence retained above. Chart cleanup and the reordered Heat precautions are included. The separately discussed Current conditions/Closer look layout proposal was not implemented in this release.
