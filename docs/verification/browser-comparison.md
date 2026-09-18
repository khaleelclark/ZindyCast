# Browser comparison and download acceptance — September 11, 2026

The real browser run passed eight comparison acceptance checks. This is bounded current custom-mode evidence, not completion of long-baseline H3 or a physical-device release check.

Run: 2026-09-11 01:21:23.993–01:21:31.263 UTC. Installed Google Chrome 152.0.7977.75, headless Playwright 1.63.0, Linux deployment host, isolated ephemeral context, 1365×1000 viewport, http://127.0.0.1:4311. Service workers blocked to isolate the deployed page/API; this does not verify installed PWA behavior. No fixtures or response replacements. No browser storage state, credentials, headers or installation-response bodies saved. Browser closed afterward. One real installation and two real jobs were created through authorized UI actions; one completed, one cancelled, and normal server expiry remains their retention mechanism.

## Acceptance

| Action | Result |
|---|---|
| Search Roseville/Placer CA and Honolulu HI; save each via UI | Pass: two correctly distinguished places |
| Select both, July 15, 2020 through July 15, 2020; create first comparison | Pass: UI automatically registers installation, HTTP 201; job HTTP 202 |
| Wait for real worker completion | Pass: completed, 100%, attempt 1; two cities and five variable rows; 24 expected hours and valid+missing=24 |
| Change start-date input to July 14 without submitting | Pass: warning identifies differing inputs; displayed result/export retain July 15 |
| Click CSV download and use Playwright download.saveAs | Pass: actual 9,348-byte UTF-8 BOM CSV, 10 variable summaries and two source chunks; original dates, locations, SI units and every mean/min/max match returned live result |
| Blank handling | Pass for unavailable source issue/update metadata and inapplicable non-rain totals; all sampled measurements complete, so missing-measurement/null-statistic browser behavior remains untested |
| Switch Fahrenheit to Celsius and download again | Pass: files byte-identical; CSV uses SI independently of display choice |
| Actual page reload; return to Compare | Pass: completed job, two saved cities and Celsius preference persist |
| Create separate second job; click Cancel comparison | Pass: cancelled state returned; completed-before-cancel race was not encountered |
| Reload cancelled job | Pass: reference/status persist; unrelated forecast/alerts blocked by test budget guard |

CSV means (all variables 24/24 valid, zero missing):

| City | Air °C | Dew point °C | RH % | Wind m/s | Hourly rain mm |
|---|---:|---:|---:|---:|---:|
| Roseville | 25.1666666667 | 12.1208333333 | 47.1666666667 | 2.4208333333 | 0 |
| Honolulu | 27.1416666667 | 21.3708333333 | 71.375 | 5.2066666667 | 0.0333333333 |

These are available-hour ERA5 requested modeled summaries, not station observations or a city ranking. Screenshot visually confirms rounded metric air/dew/RH results and the changed-input warning. Table has internal scrolling; DOM assertion confirms five rows, while the screenshot shows its first three.

## Request accounting and budget limitation

The browser forwarded exactly **17 internal API requests**: two searches, three forecast requests, three alerts requests, one registration, two creates, five status GETs, and one cancellation. It blocked two additional API attempts (forecast/alerts on final reload). CSV downloads made no API call. One earlier alert request was aborted by navigation before a response was captured; it remains charged in accounting.

Original run guard charged one potential upstream operation per search/forecast/alerts request and two per one-day/two-city comparison: **12 logical potential upstream operations**. Actual upstream cache hits, misses and worker calls are not observable from browser traffic. Post-run source review found NWS permits up to two redirects, so the original worst-case physical HTTP bound is **18**, not 12. Consequently **this run does not establish compliance with the requested <=12 physical uncached-request ceiling**. The run stopped; no further provider actions or repeat run were made. Do not interpret the audit JSON's `providerPotential: 12` as an observed or reliable physical HTTP count.

The checked-in script was subsequently corrected to charge three for alerts, cap foreground potential at eight and reserve four for the two jobs, with total ceiling twelve. This corrected guard is syntax-checked but **not live-rerun**; audit.json and screenshots describe the original run. A future run intentionally blocks background weather when its foreground allowance would be exceeded. No live rerun is automatically authorized by this evidence.

There were zero uncaught browser exceptions. Two captured console resource errors correspond exactly to the deliberately blocked final forecast/alerts requests. They are test-induced, not evidence of an app regression. Status polling was unaffected.

## Reproduction and files

Run `node tests/browser/comparison-audit.mjs` only with an appropriate new live-test budget. Script fails nonzero on an acceptance assertion, writes a bounded failure description, and always closes the browser. It uses the existing Chrome executable and installed dependency; no installs/services needed. The cancellation test can correctly fail if the second job completes before the click; do not automatically retry it or claim running-provider cancellation from this queued/brief-job result.

- [Audit script](../../tests/browser/comparison-audit.mjs)
- [Exact original request/status log and checks](browser-comparison/results/audit.json)
- [Completed screenshot](browser-comparison/results/completed.png)
- [Cancelled screenshot](browser-comparison/results/cancelled.png)
- [Fahrenheit-display download](browser-comparison/downloads/comparison-us.csv)
- [Celsius-display download](browser-comparison/downloads/comparison-metric.csv)

`npm run typecheck` passed. `node --check tests/browser/comparison-audit.mjs` passed after guard correction. Build intentionally not run: assigned paths exclude served build artifacts, and changing the deployed web assets during acceptance would alter the target. Lead owns any integrated build. No source/package/config/service/DB-direct changes, notifications, installations of software or remote mutations were performed.

Remaining limits: no missing-statistic sample, offline comparison behavior, unauthorized second installation, cancellation during long provider work, expired registration, Safari/physical phones, private HTTPS or installed PWA verification in this run. Full baselines/distributions remain product gaps already documented elsewhere. No comparison/download app defect was found in this bounded sample; the request-budget accounting defect was in the audit itself.
