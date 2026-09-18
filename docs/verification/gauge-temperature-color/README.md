# Temperature gauge color restoration — September 18, 2026

Restored the full colored arc and matching numeric/marker color. Palette interpolation uses fixed Celsius temperature anchors, independent of location, today's range, and displayed F/C units. These are decorative colors, not invented heat categories or safety thresholds. The fixed internal numeric scale remains unchanged, but its oversized −40°F/140°F endpoints and redundant caption are removed from the main gauge. Today's forecast high/low remains separately labeled in CurrentOverview.

Missing or stale readings stay neutral. Out-of-range numeric values are retained without a fabricated marker. Existing optional daily-range rendering remains compatible, with its gradient also drawn from actual temperature values. No data/provider/source-selection, heat calculation, backend service, or notification changes.

Required typecheck/build and11 relevant node tests passed. Four-width actual Chrome fixture regression checks the colored SVG arc, absent endpoint labels, Fahrenheit/Celsius, observation/model fallback, missing readings, expiry, previous-city cancellation and offline behavior. All API responses in that suite are synthetic; external requests are blocked. No physical device claim.
