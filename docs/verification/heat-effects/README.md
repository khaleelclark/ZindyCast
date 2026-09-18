# Heat effects revision — September 11, 2026

The latest bounded assignment supersedes the earlier no-duration presentation recorded in docs/research/heat-effects.md; that research evidence is preserved unchanged.

[Primary source: NWS Tulsa WBGT](https://www.weather.gov/tsa/wbgt), rechecked September 11, 2026. The effects column describes direct-sun work/exercise bodily stress at source reference durations 45/30/20/15 minutes for 80–85/85–88/88–90/>90°F. The below-80 effects cell is blank. No distinct symptoms or personalized thresholds are supported. The UI paraphrases heat strain, labels durations as source references, and says these are not safe exposure limits or personal predictions. Individual responses vary; boundary ambiguity and source prototype status remain explicit.

Removed the requested “Reference ticks in … · not personal safety limits” line. Numerical ticks, conversions, current-marker eligibility and ambiguous exact-boundary handling remain unchanged. Break schedules are absent. Below 80 remains unspecified, not risk-free.

Owned application files: apps/web/src/heat-guidance.tsx and test; apps/web/src/wbgt-panel.tsx and test; tests/browser/heat-interaction.mjs. No contracts, formulas, dependencies, services, served assets or other UI files changed in this assignment.

Verification:
- `npx tsx --test apps/web/src/heat-guidance.test.ts apps/web/src/wbgt-panel.test.ts`: 8/8 PASS. Source durations/order, all five bands, F/C, exact boundaries, missingness, freshness, co-timed marker, DST and graph gaps.
- `npm run typecheck`: PASS.
- `npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-heat-effects-final-build`: PASS; existing MapLibre dependency-expression warning.
- Browser command: `ZINDYCAST_TEST_DIST=/tmp/zindycast-heat-effects-final-build node tests/browser/heat-interaction.mjs`. Uses system Chrome, 390×844 touch emulation, intercepted fixture-only traffic and isolated assets; no live provider calls or running-service mutation. Result recorded below.

Browser result: PASS, no page errors. Hover/focus/tap marker and chart values, unavailable graph point, F/C tick nonoverlap and no mobile horizontal overflow, exact-boundary zero-highlight, Effects on body + all four source durations, removed break/tick wording, disclosure keyboard close/reopen, and offline marker removal verified. Browser screenshots remain temporary under /tmp; this is emulation, not physical phone/Safari/PWA or production deployment acceptance.
