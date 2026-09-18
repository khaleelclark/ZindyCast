# Competitive improvements integration

September 11, 2026. First wave implements compact mobile current conditions, partial-window period summaries, source-derived night icons and sunrise/sunset, relative hourly WBGT planning, and six-frame opt-in radar playback. Compare now supports city search without leaving the tab.

Validation before the follow-up discovery/export slice: typecheck and production build passed; root suite 246 passed, one optional browser test skipped. Focused map suite after compact-layout integration: eight passed, one optional browser test skipped. MapLibre's existing optional dynamic-import build warning persists.

`tests/browser/competitive-improvements.mjs` exercises the actual local release using Honolulu forecasts, inline comparison selection (no job submitted), and desktop radar readiness. It asserts current temperature fits within the 390×844 first viewport, desktop map starts above 800px at 1440×1000, and no page exceptions. Results and screenshots alongside this file are live application evidence, not physical-device or accuracy certification. Search-result accessible labels changed during shared city-picker integration; the test selector was updated accordingly.

Compact Today now places the interactive image before playback/product controls so those controls do not push the entire map below the desktop fold. Warnings, timing and legend remain available. The map continues to expand with its card.

Assisted station discovery and exact displayed-history exports are a separate in-progress integration slice. No multidecade baseline, notifications, universal heat safety or general-market competitiveness claim is made.

## Final integration

Station discovery and exact displayed-snapshot history CSV are integrated. Typecheck and production build passed; full suite 258 passed, one opt-in browser test skipped (259 total). Both API and worker restarted together. NOAA catalog parser regression and its corrected byte-column behavior are documented in ../station-discovery/README.md. No IDs are normalized into different source identities.

The first live station browser assertion used Playwright's default five-second expect timeout while the bounded catalog request was still loading; it was increased to 20 seconds to cover the endpoint's 12-second deadline. This was a test timeout, not evidence of a failed provider response.
