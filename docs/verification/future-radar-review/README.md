# Radar review — September 12, 2026

Status: investigation, not a provider migration or claimed repair. User screenshot selects observed Radar, so its pixelated edges must not be attributed to HRRR. Observed browser/source measurements are owned separately in ../radar-deep-audit.

## Future findings

One local catalog GET at 17:35 UTC succeeded. It exposed a 14:00 UTC HRRR run, already 3h35 old, with quarter-hour future frames. Two requests for the same Florida tile (18:00 valid time, XYZ7/35/53) returned identical 6200-byte PNGs in 8ms and 1ms. Both carried the earlier 17:33:34 retrieval timestamp: these were server cache hits, not measurements of cold upstream latency. Retained catalog.json, tile-check.json and tile-0.bin/tile-1.bin are evidence. This small sample did not reproduce a provider outage and does not establish all frames work.

Code inspection: ForecastTileClient serializes visible tile requests, retains 32 decoded tiles for at most five minutes and never past eligibility. Play advances 900ms AFTER each frame becomes ready; first-pass cadence therefore includes network/decode delay. At eight visible tiles, at most four frames fit the cache. A cold four-frame loop requires 32 tiles, exceeding the application ceiling of 30 uncached starts/minute if requested within a minute. These are app limits, not an IEM entitlement. Previous browser fixtures verify warm playback and cooldown recovery, but that is weaker than smooth cold playback acceptance.

MapLibre caps this forecast raster at zoom7 with linear resampling. Increasing zoom would not create model detail. IEM publishes a 0.02-degree raster of HRRR simulated reflectivity, at 15-minute steps; its documented typical publication lag is about 1h50. Our four-hour run-age gate can intentionally make Future unavailable when publication is late. Do not silently loosen freshness or label old model output current radar. [IEM documentation](https://mesonet.agron.iastate.edu/GIS/model.phtml), existing ../../decisions/future-radar.md.

## Alternatives checked against primary sources

| Candidate | Assessment |
|---|---|
| Keep NOAA observed + IEM forecast | No account; retain as baseline/fallback. Improve first-pass buffering and explicit loading before changing providers. Simulated model fields remain different from short-term radar extrapolation. |
| LibreWXR | Most interesting no-subscription experiment. Open-source self-hostable service and public demo; experimental 60-minute optical-flow nowcast with model blending. Its authors specifically caution about developing convection, which matters for Florida. Needs current API terms/availability, resource use and side-by-side actual imagery checks before adoption. Software AGPL and upstream data attribution need preserving. [Official project](https://github.com/JoshuaKimsey/LibreWXR), [site](https://librewxr.net/). No installation or live image acceptance yet. |
| Xweather | US/Canada pricing offers 15,000 shared accesses/month without a card; raster tiles are 1x, MapsGL five-minute sessions 150x. Raster catalog has observed radar and fradar based on HRRR/NAM/GFS. Thus buying different delivery does not itself replace the underlying forecast model. Exact account layer access, cache terms, quality and hard no-spend cutoff need validation; no account created. [Pricing](https://www.xweather.com/pricing/weather-api-pay-as-you-go), [layers](https://www.xweather.com/docs/maps/layers). |
| RainViewer | Explicit transition docs removed public nowcast and satellite January 2026. Remaining past radar has zoom7 and ten-minute intervals. Poor fit for solving these two complaints. Generic landing-page FAQs conflict; prefer the specific transition/API docs. [Transition](https://www.rainviewer.com/api/transition-faq.html), [API](https://www.rainviewer.com/api/weather-maps-api.html). |
| Raw HRRR / another renderer | Would add ingestion, storage and reprojection work without changing the model physics. More operational scope than a tile-source swap; not the first recommendation. [NOAA model](https://emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/hrrr.php). |

## Next acceptance

Measure observed cadence and spatial source limits independently. For Future, reproduce a cold viewport with controlled tile delays and the actual request ceiling, compare buffered start versus current sequential playback, and preserve frame/run identity and automatic cooldown. A source comparison should use the same location/time/zoom and show observation, extrapolation and numerical forecast separately. Do not claim smoother-looking motion is more accurate. No production source, quota, service or app code changed in this lead research pass.

## Integrated conclusion

Observed audit completed: fresh NOAA images confirm the close-up stairsteps precede rendering. Six advertised scans span 19m52s with 231–248s gaps. Warm fixture playback is regular (700ms median; maximum717ms), no added image GETs, no long tasks; weather background pause does not materially change cadence. This establishes source/display discontinuities, not a reproduced browser stall. Physical-device and real multi-image playback remain unmeasured. See ../radar-deep-audit/README.md for scope and evidence.

Recommendation: retain current map basemap, evaluate a bounded LibreWXR comparison for observed plus explicitly experimental near-term nowcast, and separately buffer Future playback within existing budgets. Do not adopt Xweather merely expecting different forecast physics: its documented fradar is also model-based. No production migration is warranted solely from this audit.
