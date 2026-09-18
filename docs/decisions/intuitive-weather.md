# Intuitive family weather redesign — September 11, 2026

User reports clutter, dropdown-heavy radar, confusing graphs, slow playback and missing future radar. They explicitly identify adults aged 55+ as intended users. This is an interaction redesign, not another cosmetic card refresh.

Acceptance:
- Direct Radar/Satellite choices; location determines the regional source. No default region/product/time dropdowns.
- One familiar Play/Pause control and time slider. Bounded preparation with visible progress, followed by smooth cached playback. No automatic unbounded prefetch.
- Clear current, next-hours and daily planning hierarchy, readable primary text and touch targets. Heat remains immediately beneath current metrics, with the requested reference scale and clearly labeled trend. No new heat safety thresholds.
- Default graphs have obvious metric, units, local time and missing-value treatment. Optional source explanations remain accessible without dominating the page.
- Future precipitation imagery requires an independently verified provider and explicitly modeled/forecast timestamps. Observed frames must never be extrapolated or relabeled as future to meet the request. Source evaluation is in progress; free-service constraint remains.
- Browser checks include desktop/mobile, keyboard, loading/failure, playback request bounds, visual overlap and actual completion time rather than only helper tests.

Lead performance work: public build artifacts now get Brotli and gzip variants; the existing static server negotiates them with Vary: Accept-Encoding. Installed @fastify/static documentation confirmed support. Current build artifacts total 2,418,922 eligible bytes, Brotli 627,530 bytes (74% smaller). This measures transfer bytes, not a claim about total load-time improvement. Three static tests passed, including exact decoded bytes for Brotli, gzip and identity. API payloads, credentials and preferences are unaffected. Integration restart and final build follow the coordinated UI/provider handoff.

## Integrated direction after specialist review

Simplified observed map interaction and readable charts are implemented; future-layer implementation is now tracked separately. IEM's pinned HRRR simulated reflectivity endpoint was verified and accepted for an initial CONUS-only forecast layer. Keep its model run and future valid time separate from observed imagery. Use existing shared NOAA-family quota pool plus additional IEM admission constraints initially, avoiding an unsafe persisted quota-configuration migration.

Lead removed the inherited negative margin on Save place (could overlap search controls with larger text). On desktop, radar now occupies the first right-hand row beside current weather; hourly/period planning follows it. Tablet/mobile remain readable single-column. These integration changes still require the final combined browser pass after forecast-layer delivery.
