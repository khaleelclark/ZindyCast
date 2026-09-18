# Future timeline playback — September 12, 2026

Fixed in `apps/web/src/forecast-map.tsx` with focused coverage in `forecast-map.test.ts`. No other application files changed.

The previous Play selection sliced a contiguous prefix of up to six frames (or fewer for the visible tile count), while the manual slider exposed twelve. Its loop therefore omitted the advertised horizon end. Play now starts from the first eligible advertised frame and evenly samples actual array members across the entire available horizon, including the last. With twelve frames the six-frame loop is indices 0,2,4,7,9,11; the four-frame loop is 0,4,7,11. Each loop is chronological, with only its end-to-start reset going backward. A late manual selection still starts full-horizon Play from the beginning. Manual selection retains every available time and local-time endpoints.

Visible copy says “Playback samples N forecast times”; details explain skipped quarter-hour times. No synthesized time, interpolation, advection, smoothing or source changes. This fixes temporal range coverage, not HRRR's spatial resolution. Playback still waits for completed visible frames at the existing 900ms interval. The existing six-frame/32-tile bound, cache expiry and memory limits, cooldown, request serialization and provider budgets are unchanged. If capacity shrinks, resampling retains the loop endpoints and picks the next later sampled frame.

## Evidence

- `typecheck.log`: `npm run typecheck` passed.
- `build.log`: isolated build passed (existing MapLibre dynamic-import warning), with token disabled via whitespace to prevent dotenv restoring the local key. No production build/output changed.
- `tests.tap`: seven of seven tests passed, including the existing actual Chrome regression. Unit coverage includes six/four/two-frame capacity, sparse advertised times, empty/single frame, expiry, cancellation, exact cache reuse, bounded memory and quota fencing. Existing browser regression covers manual keyboard/debounce, cached loops, 429 stop/cooldown recovery, hidden/offline, polling, regions and lifecycle.
- `results.json`: actual Chrome mobile 390×844 loads four visible tiles/frame, samples six frames; desktop 1440×1000 loads eight visible tiles/frame, samples four. Both start at zero after manual End selection, repeatedly reach slider max 11, remain chronological per loop, and add zero tile GETs during a further 6.5-second warm loop. Same canvas/marker-camera and no horizontal overflow. Offline adds no tile requests. No uncaught errors.
- `edge-results.json`: actual Chrome rejects an empty/missing-frame catalog without tiles; advancing an active loop past model eligibility stops Play and shows expired/unavailable without further tile requests.
- `mobile.png`, `desktop.png`: screenshots visually inspected. External basemaps are intentionally blocked, so their unavailable notice is expected. Identical retained HRRR PNG repeated across XYZ/time is a lifecycle fixture, not geographic or storm-motion evidence.
- `regression-results.json`: retained full existing browser audit.

All API responses came from local fixtures; all external URLs were blocked. No live weather, LibreWXR, Mapbox, admission-counter or production requests. No physical-device or integrated-release claim.

## Reproduce

From repository root:

```sh
npm run typecheck
PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm exec --workspace @zindycast/web -- rsbuild build --distPath /tmp/zindycast-future-timeline-dist
FORECAST_MAP_DIST=/tmp/zindycast-future-timeline-dist npx tsx --test apps/web/src/forecast-map.test.ts
FORECAST_MAP_DIST=/tmp/zindycast-future-timeline-dist node docs/verification/future-timeline/browser.mjs
```

The dedicated browser audit initially ran desktop/mobile; missing/expired cases were then added and run with `EDGE_ONLY=1`, retaining separate edge output. A normal reproduction runs all four cases. Research/source limitations remain documented in `docs/decisions/future-radar.md`; no new provider research or live requests were needed for this bounded client selection fix.
