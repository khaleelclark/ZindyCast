# Today organization — September 12, 2026

User requested a more coherent layout. Kept React/MUI and the existing weather/provider contracts. No dependencies, thresholds, accounts, network configuration or service processes changed.

- Current conditions occupy the wider desktop column; the smaller map remains alongside. A closer look retains its adjacent position with dew point, pressure, UV and astronomy visible; other measurements expand on demand.
- Hourly then daily forecast follow current conditions. On narrow screens radar follows both forecasts, with a direct Radar jump link. The hourly/daily document order now matches their presentation.
- WBGT value, reference scale, band and unavailable/stale state remain visible. Heat precautions, trend and calculation context are grouped into expandable sections. Scientific wording and source distinctions remain available.
- Official alerts keep event, severity and expiry visible; headline, official text, instructions and source links are available in disclosures. Stale/error alerts retain visible notices.
- Background pause now affects both existing decorative layers.

Validation:
- `npm run typecheck`: passed after final changes.
- `npm run build`: passed after final changes; existing MapLibre dynamic-dependency warning persists.
- `npx tsx --test apps/web/src/*.test.ts`: 82 passed, 2 skipped on diagnostic rerun. An earlier concurrent run reported one failure; its detailed diagnostic was lost in truncated output, so this evidence does not establish that failure's cause. Saved rerun TAP here.
- Final focused alert, WBGT, heat guidance, appearance and weather tests: 24/24 passed (focused-tests.tap).
- `node tests/browser/today-organization.mjs`: live Austin forecast/official alerts and rendered radar; expand/collapse measurement, heat trend, estimate and official-text sections; 48 hourly rows, dew point units, 7/10/14 days, both-layer background pause, jump link, five main tabs. Viewports 1440/1100/800/390: no document overflow; wider current card on desktop and current/hourly/daily/radar order on narrow screens. Results and screenshots retained here.

Browser evidence uses headless Linux Chrome and viewport emulation, not physical phones or Safari. Tab checks establish navigation only, not a fresh full history/comparison audit. Static assets were rebuilt for the existing local service; installed clients may need the existing app update action or reload.
