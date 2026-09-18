# Forecast day/night and astronomy verification

September 11, 2026. Scope: packages/providers/src/index.ts and index.test.ts; this evidence document. No contracts, cache, API, UI, root configuration, services or production database edits.

## Interface and semantics

`getForecast` now requests 18 hourly variables (existing 17 plus `is_day`) and two daily variables (`sunrise,sunset`) in the same single-location, 14-day, GMT/unixtime request. It still validates exactly 336 contiguous UTC hourly instants starting at UTC midnight. Existing SI units, requested location identity, returned grid provenance and WBGT derivation remain intact.

`Hour.isDay` preserves upstream 0/1/null; absent array yields null and `missingFields` includes `isDay`. Present arrays require 336 entries and the exact empty-string dimensionless unit. Invalid values, units and lengths reject with the existing sanitized provider error. Neither wall-clock noon/midnight nor missing sunrise/sunset substitutes for this flag. A daylight flag alone cannot make an otherwise all-null weather response successful.

`Forecast.astronomy`, when daily data is returned, has exactly 14 rows `{date,sunrise,sunset}`. The date is the **upstream UTC calendar label**, not a local date. Daily times must match every 24th hourly instant exactly, with `unixtime` units. Event arrays are optional; when present they must match all 14 dates and use `unixtime`. Event values must be bounded integer epoch seconds or null. Missing array/entry-null and zero yield null; zero is treated conservatively as unavailable, never displayed as 1970 midnight. This is defensive handling, not live verification of a polar sentinel. Missing/null daily block leaves astronomy undefined, without failing valid weather. Present malformed daily data rejects rather than silently changing dates or units.

Events retain their absolute epochs as UTC ISO strings. Validation allows the prior, same or next UTC calendar date relative to the label, rejecting unrelated epochs; it does not force sunrise before sunset or force both onto the label date. Consumers must format each event in `forecast.location.timezone` and select/group by the event's actual local date as appropriate. Do not apply an offset twice or label the UTC row date as a local day. Missing events alone cannot distinguish polar day, polar night and unavailable data. No midnight event, daylight duration, moon data or solar algorithm is invented.

## Primary sources and quota

Rechecked [Open-Meteo forecast documentation](https://open-meteo.com/en/docs) September 11: `is_day` is instantaneous daylight 1/night 0; daily sunrise/sunset are supported, and requested Unix time conveys UTC epochs. Units were additionally confirmed by the one live response below.

[Open-Meteo pricing, “How is one API call defined?”](https://open-meteo.com/en/pricing) describes fractional charging beyond ten variables and periods beyond two weeks. Counting all 18 hourly + 2 daily variables gives **20 variables / 10 × 14 days / 14 = 2 weighted calls** for one location and best-match request. Existing reservation of 2 remains sufficient under that published rule; adding a 21st variable would exceed 2 and requires quota review. The live endpoint does not expose actual account charging, so this is conservative application accounting, not a billing measurement. No retries or secondary requests were added.

## Checks and live sample

- `node --import tsx --test packages/providers/src/index.test.ts`: **19/19 pass**, including four new astronomy/day-night tests. Covers DST fall-back epoch formatting (07:30 before / 06:31 after in America/New_York), adjacent-UTC-date sunset, absent daily block, absent arrays, polar all-day/all-night flags at noon/midnight, null/zero events, field missingness, strict units/arrays/calendar/epoch validation and no-weather detection. All such cases are explicit synthetic fixtures, never represented as live weather. Existing WBGT and provider error/cancellation checks pass.
- `npm run typecheck`: **pass**.
- `npm run build --workspace @zindycast/web -- --distPath /tmp/zindy-astronomy-build-bsDZVR`: **pass**, isolated temporary output; existing MapLibre dynamic dependency warning and expected external-output-path warning. Served assets unchanged. Temporary output remains outside the workspace. Initial build command with a cleanup trap was rejected by the shell's rm-style-command policy before execution; plain isolated build then succeeded.
- **Exactly one live provider request**, no retries, through the actual adapter after mocked tests. Honolulu requested 21.31,-157.86; HTTP 200; retrieved `2026-09-11T08:01:54.138Z`. Returned `hourly_units.is_day=""`; all daily time/sunrise/sunset units `unixtime`; 336 hours, 14 astronomy rows, 168 daylight and 168 night flags. First UTC row `2026-09-11`: sunrise `2026-09-11T16:17:40.000Z`, sunset `2026-09-12T04:38:01.000Z` (06:17:40 / 18:38:01 Honolulu local September 11). Sample confirms adjacent UTC event date and usable current units, not astronomical accuracy, polar behavior, every location or browser display acceptance.

Lead integration: use the already-added optional contracts and update the cache key before serving this request shape. UI must retain unavailable states for older cached forecasts and apply the local-event-date rule above. No new public provider function or schema migration. No live application/browser request, service restart, notification or production DB access occurred.
