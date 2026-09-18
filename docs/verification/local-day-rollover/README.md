# Local day coverage at UTC rollover

September 13, 2026. Provider change; deterministic fixture verification only. No live weather requests, browser calls, production counters, served assets or services changed.

## Cause and bounded fix

The prior request used timezone=GMT, forecast_days=14 and no past_days, with exactly 336 hourly values and 14 astronomy rows. The series begins at today's UTC midnight. At September 13 00:01Z, Deltona is still September 12 20:01 EDT: nearly all September 12 temperatures and its sunrise have already dropped out of a newly fetched series. Conversely, positive-offset cities can lose the early hours of their current local date even before a UTC rollover. A refresh cannot recover fields excluded by the request.

The adapter now adds past_days=1 to the same request, preserving forecast_days=14, all 18 hourly/two daily/eight current fields, SI units, GMT and absolute UNIX timestamps. Validation requires 360 contiguous hourly values and, when present, 15 aligned UTC daily rows. Exactly one previous UTC day plus the existing forward window is sufficient to contain the entire current local day across the tested offsets and DST changes. Astronomy labels remain UTC dates; consumers must select events by each event's local calendar date. No timestamp shifting, event synthesis or interpolation is introduced. Null/missing astronomy, polar sentinels, current isolation and heat provenance remain as before.

The previous day is modeled weather, not station observations or an immutable record of yesterday's forecast. This change restores coverage; it does not prove forecast accuracy or reproduce the user's historical screen. It guarantees neither complete arbitrary yesterday browsing nor complete terminal local days at the far forecast boundary. The web owner must group all current local-day hours for extremes, not only remaining hours, and select sunrise/sunset by event instant in the location's timezone.

## Contract/cache/budget coordination

No shared schema edit needed: ForecastSchema already allows up to 384 hours and 16 astronomy rows. Lead's observed key is:

`forecast:v6:28-fields:current:astronomy:wbgt-fao-instant-v1:360h:past1:utc:si:${JSON.stringify(location)}`

Invalidate the former 336-hour cache via that new key. Provider now rejects a 336-hour upstream response rather than silently accepting truncated coverage. Existing cache TTL and freshness policy remain lead-owned.

One HTTP request remains. Conservative variable/day weighting is 28/10 × 15/14 = 3 weighted units; keep the existing three-unit reservation. That estimate counts all eight current fields across the whole requested window and is not a measurement from a live usage counter. No new provider call was spent to test it.

## Evidence and checks

- `node --import tsx --test packages/providers/src/index.test.ts`: **24/24 pass**, including all existing current/missingness/units/rate-limit/cancellation/WBGT/astronomy regressions.
- Added fixture cases: New York immediately before/after UTC midnight, Los Angeles and Honolulu after sunset, Tokyo and Kiritimati positive offsets; New York spring-forward 23-hour and fall-back 25-hour local days. Each verifies full local-day sample count, retained morning low and afternoon high, exactly one sunrise/sunset on that local date, and continuous one-hour UTC steps. Synthetic values/events are not live forecasts.
- Added rejection of an old 336-hour response to a past_days=1 request; existing malformed-length and astronomy alignment tests now use 360/15 fixtures.
- `npm run typecheck`: **pass**.
- `PUBLIC_MAPBOX_ACCESS_TOKEN=' ' npm run build --workspace @zindycast/web -- --distPath /tmp/zindycast-local-day-rollover-dist`: **pass**, existing MapLibre worker warning. Isolated output only; root compression/served production build not run.
- Logs: [tests.log](tests.log), [typecheck.log](typecheck.log), [build.log](build.log).

Owned edits: `packages/providers/src/index.ts`, `packages/providers/src/index.test.ts`, this new evidence directory. No API/web/contracts/root/dependency/configuration changes by this worker. Integrated browser, release and live provider shape verification are not claimed.

## Primary documentation reviewed

[Open-Meteo Forecast API](https://open-meteo.com/en/docs), parameter table: GMT is the default day boundary; past_days includes preceding dates; forecast_days controls the forward days; unixtime retains GMT epochs. Keeping GMT avoids introducing a second timezone-offset interpretation into existing astronomy and hourly contracts.

[Open-Meteo pricing](https://open-meteo.com/en/pricing), “How is one API call defined?”: requests over ten variables or two weeks use fractional weighted calls. The example doubles usage between two and four weeks for the same variable count, supporting the conservative proportional estimate above.
