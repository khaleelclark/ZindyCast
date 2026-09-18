# Shareable documentation and browser evidence — September 18, 2026

Historical records retain their original dates, results, scientific statements and limitations. Personal checkout paths, deployment usernames/hostnames and private tailnet addresses have been replaced with portable paths or placeholders. `<repository-root>` means the local checkout, `$HOME` means the current operator's home, and `weather.example.invalid` is a non-routable example, not a deployed service. These substitutions do not constitute new live verification. Public NOAA station names, geographic coordinates, provider contacts and research citations remain source evidence.

Run retained browser scripts from the repository root after installing locked dependencies. Package imports resolve locally; source imports resolve relative to each script. File reads/build paths formerly tied to a personal checkout now use `process.cwd()`. The retained `competitive-upgrade/panels-build.mjs` uses its checked-in `panels-entry.tsx`. Some historical scripts still require their documented temporary fixture builds and installed Chrome at `/usr/bin/google-chrome`; this pass does not modernize every historical harness or rerun live audits. `mapbox-live/browser.mjs` requires `ZINDYCAST_TEST_ORIGIN` explicitly; it fails before opening a browser when unset. Setting an origin does not authorize new provider use.

Validation: edited JavaScript/TypeScript scripts parsed and their imports resolved (including bundler-resolved TypeScript extensions); repository typecheck and an isolated blank-token web build passed. No provider calls, browser audits, service changes, commits or production builds were performed by this sanitation pass.

Binary evidence was preserved byte-for-byte. There are 133 tracked PNG/PDF/BIN artifacts in the assigned documentation scope. Four screenshots were spot-checked: competitive onboarding/settings, the weather.com review, and observed-current station-390. No machine identity was visible in those four; they do contain selected public or fixture cities. This is not an exhaustive pixel/metadata audit. In particular, `docs/reviews/competitive/*-browser.png` and saved-location/settings screenshots merit review before public publication because website personalization can be visible even without a machine hostname. Git history, ignored runtime files and files outside docs/browser-test ownership are outside this pass; sanitizing the working tree does not erase prior revisions.

Changed existing files in this pass:

- `docs/decisions/climate-jobs.md`
- `docs/decisions/foundation.md`
- `docs/decisions/mapbox-basemap.md`
- `docs/decisions/mapbox-request-budget.md`
- `docs/implementation-plan.md`
- `docs/operations/README.md`
- `docs/research/station-history.md`
- `docs/research/status.md`
- `docs/reviews/competitive-review.md`
- `docs/verification/browser-comparison.md`
- `docs/verification/browser/README.md`
- `docs/verification/city-search/search-after.mjs`
- `docs/verification/city-search/search-audit.mjs`
- `docs/verification/climate-dashboard/README.md`
- `docs/verification/competitive-upgrade/daily-browser.mjs`
- `docs/verification/competitive-upgrade/panels-browser.mts`
- `docs/verification/competitive-upgrade/panels-build.mjs`
- `docs/verification/competitive-upgrade/panels-entry.tsx`
- `docs/verification/current-display/browser.mjs`
- `docs/verification/current-width/browser.mjs`
- `docs/verification/daily-simplification/browser.mjs`
- `docs/verification/hardening-operations.md`
- `docs/verification/hardening/README.md`
- `docs/verification/heat/forecast-integration.md`
- `docs/verification/implementation-status.md`
- `docs/verification/independent-map/browser.mjs`
- `docs/verification/map-quality/combined-initial.tap`
- `docs/verification/mapbox-live/browser.mjs`
- `docs/verification/mapbox-quota/README.md`
- `docs/verification/mui-wbgt/README.md`
- `docs/verification/radar-deep-audit/browser.mjs`
- `docs/verification/radar-flashing/before.tap`
- `docs/verification/radar-flashing/today-browser.mjs`
- `docs/verification/responsive-resize/resize-after.mjs`
- `docs/verification/responsive-resize/resize-before.mjs`
- `docs/verification/ui-gardening/ui-garden-climate.mts`
- `docs/verification/ui-gardening/ui-garden-history.mts`
- `docs/verification/ui-gardening/ui-garden-screens.mjs`
- `docs/verification/ui-gardening/ui-garden-search.mjs`
- `docs/verification/weather-appearance/browser.mjs`
- `tests/browser/connected-grid.mjs`
- `tests/browser/heat-interaction.mjs`
- `tests/browser/hourly-interaction.mjs`
- `tests/browser/reload-position.mjs`
- `tests/browser/weather-scene.mjs`

## Final sharing preparation

Historical screenshots under docs/verification and docs/reviews are retained in the original local workspace but excluded from the shareable Git tree pending complete visual privacy review. References to those images in historical reports describe the original evidence; images may be absent in a fresh clone. Public research raster tiles, scientific PDFs, fixtures and textual evidence remain. A provider affinity cookie was removed from captured HTTP headers. The unpublished initial commit is replaced with the sanitized tree and a project-only Git identity. This does not remove private runtime files from the operator’s machine.
