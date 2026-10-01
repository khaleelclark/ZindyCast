# Mobile UI and perceived choppiness review

Date: 2026-10-01. Scope: web UI used by the Android WebView, with bounded changes to `apps/web/**`. No native Android, dependency, contract, deployment, signing, or release edits. No physical Android device was available; findings below distinguish demonstrated code behavior from profiling hypotheses.

## Prioritized findings

1. **High: unnecessary dashboard work during pull-to-refresh — fixed.** `App` owned the pull-distance hook, so each touchmove changed root state and reevaluated the dashboard, time formatting, forecast grouping, and chart/map component tree. The indicator now owns gesture state in `PullRefreshIndicator`; display updates are coalesced with `requestAnimationFrame`. The isolated Chromium regression check proves parent render count stays unchanged during a pull.
2. **High: document-wide blocking touch handling and page translation — fixed.** A non-passive touchmove listener remained attached whenever a location was selected, including unrelated tabs and ordinary scrolling. The listener now exists only during an eligible top-of-page touch and is removed when direction, scrolling, cancellation, or multitouch hands the gesture back to the browser. Controls, tab strips, maps, tables, and chart scrollers are excluded. The small fixed indicator moves instead of transforming the entire shell and its fixed weather backdrop. Tests confirm listener cleanup, unchanged shell transform, threshold behavior, and cancellation while a frame is pending.
3. **Medium: hidden refresh control / misleading gesture scope — fixed.** Mobile CSS hid the current-weather Refresh button, making refresh depend on discovering a gesture. The button is visible again. Pull-to-refresh is limited to Today, where it refreshes the displayed forecast/observations, and is disabled during an in-flight weather refresh. Previously pulling in History or Settings refreshed Today data without updating the active page.
4. **Medium: initial JavaScript cost — remaining candidate.** The generated HTML loads three initial JS chunks totaling approximately 1,298 kB uncompressed / 396 kB gzip (build report). History, comparison, settings, and climate modules are statically imported by the entry point. A separate follow-up should measure cold-start scripting on the affected WebView and then consider route-level code splitting with accessible loading/error states. MapLibre itself already uses dynamic import, so it should not be described as fully eager in the entry bundle. Bundle size alone does not prove this is the reported scrolling problem.
5. **Medium: decorative SVG and maps compete for rendering resources — profiling needed.** Weather backgrounds contain continuously animated SVG clouds, gradients, rain/snow, and stars. A mounted online map initializes MapLibre without viewport visibility gating. Existing hidden-document pause/reduced-motion handling and chart `skipAnimation` are good safeguards. Compare real-device scroll traces with weather animation paused and map visible/offscreen before changing visual identity or map loading. No frame-rate or GPU improvement is claimed from these hypotheses.

## Changed application files

- `apps/web/src/pull-to-refresh.ts`: scoped blocking listener, nested-control exclusions, frame-coalesced updates, complete gesture cleanup.
- `apps/web/src/pull-refresh-indicator.tsx`: isolated indicator component.
- `apps/web/src/index.tsx`: move gesture state out of App; enable refresh gesture only on Today and outside active refreshes.
- `apps/web/src/connected-grid.css`: move the indicator only; reveal current-weather Refresh on phones.

## Verification

- `npm run typecheck` — passed.
- `npm run build --workspace @zindycast/web` — passed; MapLibre reports a dependency-expression build warning from its distributed module. Root compression/release scripts were not run.
- `node --import tsx --test apps/web/src/pull-to-refresh.test.ts apps/web/src/refresh.test.ts apps/web/src/weather-appearance.test.ts` — 7 passed.
- `node docs/verification/mobile-ux/gesture-browser.mjs` — 11 isolated browser assertions/groups passed; details in `gesture-results.json`. Synthetic touch events cover threshold, subthreshold, horizontal/upward gestures, multitouch, noncancelable browser-owned gestures, nested controls, cancellation, disabled cleanup, scrolled document, desktop, parent renders, and shell transform.
- `node docs/verification/mobile-ux/app-browser.mjs` — built-app fixtures at 360/390/430 px: no horizontal document overflow, visible Refresh button, verified refresh request, Settings navigation, zero uncaught page errors. Details in `app-results.json`. Initial load-event wait timed out in the test environment; rerun using DOMContentLoaded plus explicit UI readiness checks passed.
- `git diff --check -- apps/web` — passed.

Browser scripts intercept all traffic; forecast responses are clearly named fixtures and other providers return deliberate unavailable responses. They do not contact live providers or send notifications. Browser version is stored in each JSON report. These checks do not establish successful map imagery, live provider behavior, native scrolling smoothness, or physical-device compatibility.

## Device follow-up

Use the affected Android phone/WebView version to compare cold start, continuous Today scrolling, pull-to-refresh, and map pan/animation. Record long tasks and frame timing with weather motion enabled and paused. Confirm pull interruption, two-finger gestures, and native WebView interaction after the web change is delivered. A native APK rebuild alone will not publish these web changes: the shell renders the deployed PWA. Deployment remains with the manager and was not performed here.

## Lead delivery verification — October 1, 2026

The accepted web changes are committed as `2b29e8a`. The existing private API serves `apps/web/dist` directly from the canonical checkout, so the integrated production build published the changed assets without a service restart. The previous handoff's pending-deployment note is superseded by this verification. No API/worker restart, database change, network configuration change, or new APK was needed.

Certificate-verified private HTTPS returned the exact local build bytes for HTML, service worker, manifest, and all four initial JS/CSS assets; health returned HTTP 200 / `ok`. HTML/worker/manifest revalidate, and hashed JS/CSS retain immutable caching. `delivery-results.json` records hashes and the checks.

Run `ZINDYCAST_VERIFY_ORIGIN=<private-HTTPS-origin> node docs/verification/mobile-ux/live-delivery.mjs` to reproduce. A disposable Chromium profile at 390 px loaded the served app, installed the current service worker, and reloaded under its control. A browser-only inert marker then simulated a subsequent shell identity: the actual Update button preserved the open Settings view until clicked, loaded the changed shell, and retained preferences. Zero uncaught page errors. All browser API requests returned intercepted unavailable fixtures; this check made no live weather/provider calls and changed no real installation state.

Installed clients should reopen ZindyCast while connected to Tailscale and use the existing **Update** button when offered. The gesture fixes are delivered by the web shell; the 0.1.3 APK remains the Android logo update. Physical-phone smoothness and Android WebView frame timing remain unverified.
