# Automatic refresh and forecast-radar request control

September 11, 2026. User requests automatic current weather and future-radar slider rate-limit correction.

Main forecast: refresh five minutes after each completed request, coalesce focus/visibility events, pause hidden/offline, check immediately on return if due, and reconnect through the existing online handler. Keep the previous same-city snapshot during refresh. On failure retain it explicitly stale and retry automatically at the bounded cadence. City changes still clear old data and abort prior work. No timer catch-up bursts. Current-hour selection clock advances on resume. Initial loading remains visible; background refresh does not insert a layout-shifting loading banner or unmount maps.

Focused scheduler test verifies in-flight coalescing, hidden pause, overdue resume, no catch-up and disposal. Typecheck passes. Slider debounce, bounded tile reuse, cooldown recovery and radar catalog polling are assigned separately; combined browser time-advance/request-count acceptance and build remain before release. No quota increase or limit bypass is proposed.
