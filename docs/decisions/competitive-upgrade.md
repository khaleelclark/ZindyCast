# Competitive upgrade — September 14, 2026

The user explicitly authorized implementing the competitive/accuracy review. Existing private deployment and zero-paid-service constraints remain. Implementation does not confer measured forecast superiority or physical-device acceptance.

## Delivered implementation boundaries

- Daily hierarchy, shared metric presentation and explicit air/feels-like/highest-hourly-rain definitions are web-owned. Advanced data remains available without dominating Today.
- Nearby NWS observations are a separate, explicitly loaded station view. No station is silently substituted for modeled conditions. Station quality flags, position, elevation and observation time remain visible.
- NOAA station monthly normals (1991–2020) are separate from recent-year reanalysis comparisons. Source measurements/flags are retained, and converted once from °F/inches. Standard normals can contain NOAA estimates and adjustments.
- A private, opted-in verification archive saves forecasts before their valid times, with reference station and source provenance. Baseline best-match capture runs at most every six hours; two explicit model candidates at most daily, subject to shared quota. The baseline is not automatically replaced. Held-out scoring is an evaluation aid, not a claim of a calibrated confidence percentage or future performance.
- Warning notifications require device permission AND an authenticated saved subscription. They cover only official NWS severe/extreme Warning events. A separate worker loop prevents long comparison jobs from intentionally blocking notification polling; all paths remain bounded and share request quotas. Free, exact-pinned web-push is used; no external account or paid provider.

## Notification behavior and limits

Quiet hours follow each monitored place's local timezone (start inclusive, end exclusive); equal hours disable quiet time. Default 22:00–07:00, with immediate severe/extreme warnings allowed during quiet hours. No heat categories, custom calculated thresholds, lightning or rain-start promises were invented.

Subscriptions are installation-owned, expire with installation or browser expiry, and are removed on explicit disable or 404/410. Only known browser push destinations are admitted. Endpoint/key material stays in the private database and never appears in status responses or logs. A subscription endpoint cannot be claimed by two installations. Revoked/expired installation membership is rechecked before sending.

Send identity is official alert ID + sent time. Duplicates across overlapping places and restarts are suppressed. Reservation occurs before network send: ambiguous failures are not retried, avoiding duplicate delivery at the cost of possible missed warnings. Maximum five attempts per subscription pass; 8-second transport timeout and 120-second delivery TTL. No old send queue is replayed after restart. Fresh active-source checks exclude cancelled/expired/superseded alerts; a warning already delivered cannot be reliably recalled from every device. Notification tap opens current app information, never an arbitrary incoming URL. This is best-effort supplementary delivery, not guaranteed emergency delivery.

VAPID configuration is generated locally with deploy/configure-notifications.mjs, preserving existing values and a private prior-config copy. Generation neither subscribes devices nor sends messages. Existing app permission must never be mistaken for user opt-in to a category.

## Verification and remaining evidence

Initial full deterministic suite: 441 passed, 5 optional tests skipped (446 total). This precedes final integration edits; final evidence must supersede it. New-panel actual Chrome fixture tests at 390/1440 exercise notification enable/disable, observation station selection, F conversion, normals load and scorecard start/stop. Four explicit POSTs per width, no registration, no external/provider calls and no page exceptions. Fixtures are not weather verification.

A true rain-nowcasting source must supply that product and its coverage/entitlement. Hourly interpolation or HRRR simulated reflectivity cannot be labeled a verified minute-by-minute local rain forecast. Model correction/uncertainty cannot be activated honestly without sufficient held-out evidence. Local station mismatch, seasonality and extremes remain evaluation concerns.

Physical iPhone/Android/Safari, actual push delivery, and a family usability study require user devices/participants. They are not replaced by viewport emulation. Broad public distribution remains outside the existing private hosting/zero-paid constraints.

## User correction: WBGT stays visible

The user explicitly rejected hiding useful WBGT information behind a disclosure. The current WBGT value, five-band reference graph, current marker and band status must remain visible by default on phone and desktop. Do not collapse this information in future layout gardening to meet an above-fold summary target. Supporting heat precautions, forecast trend and method details retain their own controls.

Implemented by removing the outer interpretation disclosure. Typecheck/root production build and 9 focused WBGT/guidance tests pass. Actual Chrome at 390/1440 confirms the band track is visible without a details ancestor, unit changes work, and there are no page errors or horizontal overflow. Published to the existing served web assets; no backend restart required.

## User correction: daily plan above radar

Today/Tomorrow occupies the right-hand desktop column, with the local weather map directly beneath it. Current conditions and the always-visible WBGT reference bands occupy the left column. The shared daily-summary component remains single-instance; map DOM order now follows it, matching the visual flow. Phones follow the same summary → radar order, and both Today and Tomorrow summaries are visible. Typecheck and production build pass; actual Chrome fixture checks validate right-column alignment/vertical order at 1440px and phone order at 390px, with no page exceptions or horizontal overflow. No live map/provider calls or backend changes.
