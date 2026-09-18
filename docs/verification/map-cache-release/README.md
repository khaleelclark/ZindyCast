# Integrated map update — September 11, 2026

Published with `npm run build`; typecheck passed. Existing MapLibre dynamic-import warning remains. Local served HTML and its referenced main bundle return HTTP 200 and contain the new coarse-model-grid label. No API changes or service restart required.

Integrated the late forecast tile expiry fix (see ../forecast-cache), independent satellite opacity and source-detail labels (see ../map-quality), and concise coarse-model-grid text. Forecast spatial resolution is unchanged; no sharper source was introduced. Satellite rendered in the bounded fresh Florida audit, so the original reported failure remains unreproduced.

Integrated node:test run with actual Chrome against final apps/web/dist: 27/28 initially passed. The sole failure was an exact text assertion still expecting the old forecast label. Updated that expected label, reran all six forecast tests including the full Chrome scenario: 6/6 passed. Thus all 28 relevant checks passed across initial run and corrected rerun. API cache and provider tests use fixtures; browser scenarios cover cached playback, expiry, rate cooldown, lifecycle, regional gating and mobile/desktop overflow. No new upstream weather requests during release verification. Physical-device acceptance not claimed.
