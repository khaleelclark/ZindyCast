# Observed feels-like helper

Reviewed 2026-09-17. Owns only a pure client calculation; integration remains lead-owned.

`observedFeelsLike(temperatureC: number|null, humidityPercent: number|null, windSpeedMs: number|null): {valueC:number|null; method:'heat-index'|'wind-chill'|'air-temperature'|'unavailable'}`

The caller must supply quality-eligible, fresh, co-timed measurements from one observed station and retain station/time attribution. Numeric arguments cannot enforce provenance. Never backfill with forecast/model values or another station/time. Output is derived from observations, not a measured apparent temperature, ordinary wet bulb or WBGT.

## Sources and selection

- [NWS WPC heat-index equation](https://www.wpc.ncep.noaa.gov/html/heatindex_equationbody.html), search-index text retrieved today (direct fetch returned 403); corroborating [NWS Tampa Bay](https://www.weather.gov/tbw/heatindex). Implements the averaged simple screening formula, Rothfusz regression and both humidity corrections. Uses Fahrenheit internally, Celsius externally; no rounding or air-temperature floor.
- [NWS wind-chill definition and formula](https://www.weather.gov/safety/cold-wind-chill-chart), fetched today. Applies at air temperature ≤50°F and wind >3 mph; exact conversion 1 mph = 0.44704 m/s. No additional wind-height conversion. The formula already accounts for standard anemometer height. No solar adjustment.

Application selection: cold domain takes precedence and missing wind returns unavailable. Above it, use heat index if air temperature is ≥80°F OR its screened estimate reaches 80°F; this preserves high-humidity screening below 80°F. At ≥80°F a screened estimate below 80°F remains the simple averaged result. Otherwise return air temperature with that explicit method label. With missing RH, return unavailable if screening at RH=100% could reach 80°F (or air is ≥80°F); otherwise air temperature. These selection rules are product behavior, not heat categories.

Defensive input bounds are temperature −100..60°C, humidity 0..100%, wind 0..150 m/s, all finite. They reject malformed weather inputs and are **not** a validated scientific applicability rectangle. Any supplied invalid argument makes the result unavailable; unused nullable arguments are allowed. Zero humidity/wind are values, not missingness. NWS warns the regression is unsuitable beyond the conditions studied by Steadman; this implementation does not validate extreme-condition physiology or individualized exposure. The UI should label the method and retain its estimated/derived context.

## Verification

Focused node:test covers regression, dry/humid corrections and endpoints, simple screening, humid 79°F, 50°F/3 mph boundaries, SI conversion, null/zero and invalid ranges. Heat-index references were independently evaluated using Python Decimal at precision 40: 88°F/58% gives **94.25074074°F**, so “roughly 95°F” is approximate and should not be forced to 95. NWS publishes 0°F/15 mph as approximately −19°F wind chill. Deterministic formula precision does not imply equivalent measurement or physiological accuracy.

Run: `npx tsx --test apps/web/src/observed-feels-like.test.ts`. No provider data calls, dependencies, services or deployment.
