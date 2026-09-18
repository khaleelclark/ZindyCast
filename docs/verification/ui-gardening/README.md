# UI gardening — September 13, 2026

The user requested simpler, consistent UI/UX and reusable implementation.

## Changes

- `ui-controls.css` is the shared control contract for button sizes, native form fields, MUI text fields, focus, disabled states and disclosures. MUI theme shares the radius token. Standard actions have 44px targets, native fields use 16px text. MapLibre widgets and the WBGT marker retain their specialized geometry. Feature sheets retain layout rather than independent copies of these control styles.
- Removed duplicate control recipes from comparison visual sheets and explore layout.
- Fixed comparison form fieldset selectors that were accidentally removing MUI TextField outlines. Form grouping styles exclude the internal outline fieldset.
- `metric-display.ts` now owns comparison unit conversions, exact formatting and city colors. Both comparison implementations reuse it; history uses its temperature conversion. No dataset/statistical/CSV changes.
- Climate high/low bars, cards and table columns appear only for the three temperature fields. Humidity, wind and cloud cover no longer suggest unavailable daily-temperature statistics. Totals only appear for accumulation fields.
- History/station actions use consistent “Load …” labels; history average labels and disclosure headings are simpler.

## Verification

Typecheck passed. All web node tests: 120 passed, 4 optional browser tests skipped in the general run. One new meaningful test checks the metric-specific daily-range gate; existing tests validate conversions/null/zero/negative inputs.

Actual Chrome fixture audits at 390px touch and 1440px desktop:

- All five tabs: no page overflow, standard visible controls at least 44px (subpixel tolerance), keyboard focus visible. Before/after visual inspection confirmed the city search outline repair.
- Climate: create/status/cancel/reload/offline/detail flows, units, no spurious high/low fields for humidity, temperature retains them, no overflow/errors.
- History: day/month, station quality flags, units, missing values, keyboard/touch charts and offline clearing; no overflow/errors.
- Search: local-only input renders, debounce/cache/stale-response/clear/select checks, same map canvas and no extra weather calls while typing.

All network requests intercepted; retained weather imagery and synthetic values clearly fixtures. External attempts fulfilled fixture failures; zero live provider or production quota requests. Physical iOS/Android, Safari and screen-reader acceptance are not claimed.

Reproduce against isolated `/tmp/zindycast-ui-garden-dist` (build with PUBLIC_MAPBOX_ACCESS_TOKEN=' '): node the .mjs harnesses and npx tsx the .mts harnesses in this directory. They use installed system Chrome and workspace fixture evidence. Screenshots in /tmp/ui-garden-{Today,Maps,History,Compare,Settings}-{390,1440}.png and reused climate/history screenshot paths. Do not run fixture servers as production data.

The old stylesheet still contains historical layout rules; this pass deliberately consolidates control presentation without rewriting forecast/map layout and rendering logic.

Separate map suite: 16/16 passed with RADAR_CONTROLS_DIST and FORECAST_MAP_DIST set to the isolated build, including actual Chrome observed playback/keyboard/pause/quota/cleanup and forecast XYZ/same-canvas/stale/regional/cooldown checks. Final typing audit: no App rerenders; input-to-next-frame maxima 51ms desktop / 18ms phone emulation (not physical-device guarantees).

Release: root npm run build passed and compressed 18 assets; frontend published to existing served dist. Existing MapLibre optional dynamic import warning retained. Read-only local API health returned ok. No API/worker restart or persistent configuration change was needed.
