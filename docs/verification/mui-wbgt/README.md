# MUI and live WBGT acceptance — September 11, 2026

User-requested MUI conversion, Today map and WBGT context are integrated and deployed. Typecheck and production build pass; 223 unit/integration tests pass. The existing MapLibre optional dynamic-import build warning remains; the explicitly packaged worker and live map rendering were tested.

`node tests/browser/mui-wbgt-audit.mjs` passed six checks in actual local Chrome: live current WBGT matches the API number/source grid; Today displays one interactive map and WBGT forecast; Fahrenheit/Celsius reference ticks and number match; Maps/Today transitions render; 390px viewport has no overflow; offline removes current WBGT and reconnect restores it. `results.json` records internal API statuses and zero page exceptions. Actual upstream call count is not inferred from internal cached requests. Desktop screenshot visually inspected and shows radar returns over labeled Hawaiian islands and the live scale/graph.

`node tests/browser/update-migration-audit.mjs` also passed against this production build, including actual current UI update activation and saved-preference preservation. Legacy shell is synthetic, not the user's exact retained bundle; fixtures are confined to the test. Query-bearing recovery link: `https://weather.example.invalid:21443/?update-recovery=1`. No clearing of user storage is required by that tested recovery path.

Numerical method: independently C-checked Liljegren with explicit FAO-56 short-grass wind conversion and provider instantaneous radiation. See ../../decisions/tulsa-wbgt.md. This is a modeled reference exposure, not measured yard WBGT. NWS Tulsa written bands are informational reference ticks; no universal categories or safe-time claims. Ordinary wet-bulb is separate. Missing/stale/co-time/boundary/unit behavior has deterministic coverage; physical phone/Safari/touch and full accessibility remain unverified.

Both existing API and worker services were restarted together after successful checks. Local health returned ok. No new Tailscale mapping, notifications, accounts or provider subscriptions were created.

## Heat placement revision

Moved heat context inside the current-metrics card, directly after humidity/wind/rain, with a continuous green-to-red WBGT reference line, current marker and forecast plot beneath. Ordinary wet-bulb stays separate. Typecheck/build and five focused rendering tests pass; seven live browser checks pass, including placement/gradient, units and mobile width. Mobile screenshot visually inspected. A pre-existing intermittent map inline error (`There is no tile manager with ID weather`) appeared in this screenshot despite rendered tiles and source-ready state; this run does not certify map-error absence. No backend or calculation changes.

## Map fills available height

Today map now uses a flex column with the viewport consuming remaining card space. Desktop card is constrained to its grid area to avoid intrinsic sizing feedback; mobile retains a bounded viewport. ResizeObserver calls MapLibre resize on container changes and is cleaned up on unmount. Loading text reserves space so changing request state cannot oscillate viewport height. Initial browser attempts exposed frame readiness churn before these corrections; final eight-check browser run passes, including map height >650px, footer gap <160px, matching canvas dimensions, desktop/mobile, units and offline recovery. Final desktop screenshot visually inspected: map fills the previously blank card. Typecheck/build and five map tests pass. No backend changes.
