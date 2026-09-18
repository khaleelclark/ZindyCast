# Forecast WBGT producer verification

September 11, 2026. Changes are confined to `packages/providers/src/index.ts`, its existing test, and this directory. Heat helper, shared contracts/dependency and REST key/budget were supplied by their respective owners. No services, deployment, shared/root/API/UI edits, installs or delegation.

`getForecast(location, signal?)` retains its signature and now requests 17 hourly fields: the prior 15 plus `shortwave_radiation_instant` and `shortwave_radiation`. Both require W/m² when present, matching array length and nonnegative finite values. Their independent nullable values become `shortwaveInstantWm2` and `shortwaveMeanWm2`; missing arrays/null cells are retained in `missingFields`. Invalid supplied units or malformed data continue to reject the response rather than become silently missing.

Each validated hour is passed to the shared `deriveForecastWbgt(hour, sourceCoordinates, source)` heat helper and revalidated through shared `HourSchema`/`WbgtEstimateSchema`. Solar geometry uses returned series latitude/longitude, while requested city identity remains unchanged. The exact dataset source string accompanies diagnostics. Missing instantaneous radiation produces unavailable WBGT without dropping the forecast or substituting the mean. Missing pressure behaves similarly. Legitimate zero nighttime radiation/calm wind remain zero in raw input; solver floor is separately recorded. Ordinary wet-bulb and activity do not enter the calculation.

Method and accepted scope: [lead input-policy decision](../../decisions/tulsa-wbgt.md#lead-integration-decision), [preserved radiation/wind research](../../research/heat-science.md#9-bounded-follow-up-instantaneous-radiation-and-wind-policy), [independent numerical reference verification](../heat/README.md). This is a modeled outdoor short-grass reference exposure, not measured local WBGT, an official heat alert or individualized safe time. Instantaneous GHI is a provider-derived endpoint estimate; preceding-hour mean stays separate. Best-match constituent model/per-field grid identity and source issue time are not supplied. No scientific category change was made.

## Deterministic checks

- `npx tsx --test packages/providers/src/index.test.ts`: 15/15 passed.
- Combined providers/index, alerts, wildfire and heat/forecast tests: 41/41 passed.
- Added checks cover exact 17-field request; both radiation units and lengths; negative radiation rejection; FAO equation 47 conversion independently evaluated; outdoor weighting from natural-wet-bulb/globe/air components; source-grid coordinates/time; mean-radiation and ordinary-wet-bulb changes do not change WBGT; absent/null radiation preserves weather; missing mean does not disable WBGT; calm night and missing pressure.
- Existing cancellation, 8-second fetch/body deadline, 1 MB upstream response bound, sanitized errors/429, location snapshot and time/unit tests remain passing. No adapter request, retry or timeout expansion was made.
- Production `npm run build --workspace @zindycast/web -- --distPath <temporary-directory>` passed. This is the root build's workspace command with isolated output so the active preview is untouched. Output was removed by `TemporaryDirectory`. Existing MapLibre dynamic-dependency warning and expected outside-root temporary-output warning remain.
- Final full `npm run typecheck` passed. Initial run reported only concurrent web errors (missing new WBGT panel test props and missing `Provenance` type export), subsequently resolved by their owners; no owned-file errors occurred.

## One live request

Exactly one new Open-Meteo GET, no retry: Honolulu request21.31/−157.86, HTTP200, started2026-09-11T01:57:12.565Z, normalized result retrieved01:57:13.425Z. Returned series grid21.335676/−157.88991. All336 hours had both radiation values and successful schema-validated WBGT; missingFields empty. Source issue time remains null. Serialized normalized JSON is601423 bytes, below the shared2MiB cache-entry limit in this sample. No second live request was made.

See [exact request and summary](live-manifest.json), [normalized result](live-result.json), and [opt-in one-request script](live-smoke.ts). The result is normalized evidence, not raw upstream. Re-running requires an explicit live-call budget: `ZINDY_WBGT_LIVE=1 npx tsx docs/verification/forecast-wbgt/live-smoke.ts`. Successful availability and calculation do not validate actual local exposure, every location/season or browser rendering. Prior research evidence is preserved.

Lead retains REST keyv3/17-field/policy identity, shared budget2, cache/schema integration and browser acceptance. Verify current-hour selection, stale/offline handling, old-schema cache invalidation, chart and unit display with numerical WBGT separate from ordinary wet-bulb and activity. No categorical notifications are enabled by this producer.
