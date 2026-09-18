# Dashboard refinement — September 11, 2026

Delivered current location name in the current-hour card; removed the WBGT reference-tick footnote; replaced hourly Rain amount with Dew point (rain chance retained); placed A closer look alongside the wider current-hour card on desktop, with radar beneath details. On narrow screens, details and radar follow current conditions. Added decorative condition-specific background animation, pause/resume control, and automatic reduced-motion suppression. Stale/missing/offline weather retains the neutral atmosphere. No application data or provider contracts changed.

Heat table uses the supplied NWS Tulsa Effects reference with attributed source durations and explicit non-personal qualification; see ../../research/heat-effects.md.

Verification:
- npm run typecheck: passed.
- npm run build: passed, existing MapLibre dynamic-dependency warning.
- npx tsx --test apps/web/src/heat-guidance.test.ts apps/web/src/wbgt-panel.test.ts apps/web/src/weather-appearance.test.ts apps/web/src/weather.test.ts: 21/21 passed.
- node tests/browser/dashboard-refinement.mjs: Chrome headless, real Austin forecast and successfully rendered radar. Checked location label, body-effects disclosure, absent removed text, 48 hourly rows, dew point unit conversion (66°F / 19°C), pause/resume, all seven decorative weather states, no animation for neutral/reduced motion, and neutral offline state. No uncaught browser errors.
- Layout at 1440, 1100, 800, 390 CSS pixels: no document overflow, desktop details aligned with wider main card and radar below, narrow layout stacked. Images and measured bounds in this directory. Decorative CSS scenarios temporarily change only the background attribute in the isolated test browser, never forecast values; screenshots restore real weather state.

This checks the changed dashboard functionality, not all project features or physical device behavior. Existing served static assets were rebuilt; no service restart or network configuration change was needed. Installed clients may need the existing app-update action to load the new shell.
