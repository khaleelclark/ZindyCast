# Current conditions priority — September 11, 2026

Changed desktop dashboard column ratio from 1:1.5 (current:radar) to1.6:1, maintaining340px minimum radar width. Below1001px existing single-column stack remains. No other layout/content/source changes.

Typecheck and production build passed (known MapLibre warning). Actual fixture Chrome measured current/radar widths839.4/524.6 at1440px and642.5/401.5 at1100px; desktop top edges align, current is wider, map remains usable. Mobile390px retains equal-width stacked cards. All three viewports pass no page overflow,20 chart hovers+61s clock advance without new radar requests/readiness changes, same canvas and no page errors. Fixture-only APIs/external resources intercepted: zero live provider calls. Screenshots inspected; no physical-device claim.

Reproduce node docs/verification/current-width/browser.mjs against apps/web/dist. This frontend release is published; existing PWA clients use Update and reload.
