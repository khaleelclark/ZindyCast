# R3/R4/R6 — provider and map audit

Research only, 2026-09-10. Full implementation plan read. No registrations, subscriptions, keys, application changes, installations, deployment, or notifications. Evidence is under [maps/](maps/); raw response sidecars retain reproducible URLs, status and headers. Imagery retrieval was around 22:37 UTC. These are samples, not an uptime or geographic completeness guarantee.

## Status and proposed free-only approach

| Item | Finding | Gate remaining |
|---|---|---|
| R3 OpenWeather | Public free-plan entitlement confirmed | Authenticated tiles, actual account limits and billing state unverified |
| R3 AirNow | Public documentation reviewed; replacement-service migration required | Account activation, replacement endpoint docs/limits and sample results unverified |
| R4 NOAA | Seven actual regional images and three legends downloaded and visually inspected | Radar coverage mask/zero-return interpretation unresolved; physical-device/rendering tests await DEVELOP |
| R6 NIFC | Public schema, metadata and three records from each service checked | Pagination/geometry integration tests await DEVELOP |
| R6 OSM | Standard tile policy reviewed; feasible for small interactive private use | Actual browser Referer/cache behavior awaits implementation |

Propose NOAA regional radar plus GOES longwave for CONUS/Hawaii, and the slower global longwave mosaic for Alaska. Expose radar coverage as unknown wherever no authoritative coverage mask is available. Use NIFC public points/perimeters with independent timestamps. Keep OpenWeather/AirNow disabled until account-dependent checks succeed. OSM is best-effort and must be replaceable without a paid fallback.

## R4 — actual NOAA content

[Live WMS capabilities](https://nowcoast.noaa.gov/geoserver/ows?service=WMS&version=1.3.0&request=GetCapabilities) were saved as [nowcoast-capabilities.xml](maps/nowcoast-capabilities.xml). Requests used WMS 1.3.0, CRS:84 (longitude/latitude ordering), 800 × 500 PNGs, transparency enabled, and an explicit advertised time. Every image returned HTTP 200/image/png. All seven images and three legends were opened with the image inspection tool.

| Image | Requested bbox west,south,east,north | Source time UTC on Sep 10 | Visual result |
|---|---|---|---|
| [CONUS radar](maps/conus-radar.png) | -125,24,-66,50 | 22:28:20 | Colored reflectivity structures, extensive blank background |
| [Alaska radar](maps/alaska-radar.png) | -170,52,-130,72 | 22:28:57 | Localized cyan/blue structures with very large blank regions |
| [Hawaii radar](maps/hawaii-radar.png) | -161,18,-154,23 | 22:28:55 | Sparse small echoes, especially eastern/southeastern image |
| [CONUS GOES longwave](maps/conus-goes.png) | -125,24,-66,50 | 22:33:00 | Grayscale cloud/surface structure throughout requested region |
| [Alaska GOES longwave](maps/alaska-goes.png) | -170,52,-130,72 | 22:33:00 | Blank: the request is outside this layer's northern extent |
| [Alaska global longwave](maps/alaska-global.png) | -170,52,-130,72 | 21:00:00 | Grayscale land/cloud structure; Alaska and Aleutian outline visible |
| [Hawaii GOES longwave](maps/hawaii-goes.png) | -161,18,-154,23 | 22:33:00 | Grayscale cloud/ocean structure and island outlines |

These are raw overlays without basemap labels; the bbox is the geographic reference. No precipitation amount, surface rain certainty, city-level accuracy, or per-pixel coverage can be inferred solely from these images. Black/white display backgrounds are not a validated missing-value classification.

### Regional bounds and meaning

Capabilities advertise these approximate geographic extents, which are rectangular image extents, **not sensor coverage masks**:

| Layer name | Advertised lon/lat extent | Time semantics |
|---|---|---|
| `weather_radar:conus_base_reflectivity_mosaic` | -130,20.003 to -59.997,55 | Discrete times, approximately 4-minute updates |
| `weather_radar:alaska_base_reflectivity_mosaic` | -176,49.996 to -125.994,72 | Separate discrete timeline |
| `weather_radar:hawaii_base_reflectivity_mosaic` | -164,14.998 to -151.001,26 | Separate discrete timeline |
| `satellite:goes_longwave_imagery` | -179.503,10.911 to -50.750,50.553 | 5-minute updates; 2 km; Band 14, 11.2 μm |
| `satellite:global_longwave_imagery_mosaic` | -180,-72.745 to 179.955,72.737 | Hourly; approximately 3 km; documented latency 2–3 hours |

The Alaska GOES blank is corroborated by the advertised 50.553°N maximum. Do not promise the fast GOES layer for Anchorage or Alaska generally. The global mosaic sample is useful, but does not verify all Alaska pixels, far-west antimeridian handling, or all seasons. Split antimeridian bboxes in implementation. Global infrared is a different product with its own age; do not label it as a synchronized 5-minute GOES frame. Infrared depicts radiative cloud/surface patterns, not a surface air-temperature overlay. Visible and water-vapor catalogs were inspected but their actual content was not separately validated; default infrared is the audited path.

### Legends and missingness

[CONUS radar legend](maps/conus_base_reflectivity_mosaic-legend.png) is a color ramp with endpoints rendered as 0 and 80; capabilities identify reflectivity units as dBZ. It is not rainfall depth/rate. [GOES legend](maps/goes_longwave_imagery-legend.png) shows grayscale 0–255, not a validated temperature scale. [Global legend](maps/global_longwave_imagery_mosaic-legend.png) is a checkerboard/swatch and is inadequate as a quantitative legend. Use explanatory text for infrared rather than inventing Celsius labels.

No reliable coverage/no-echo distinction was obtained from these PNGs. The app must say “No visible radar return; coverage may be unavailable” or show a separate unknown-coverage state, never “No precipitation” solely because the overlay is blank. Outside advertised extent can be marked unavailable. Inside extent remains unknown unless separately validated coverage data are added. This unresolved mask issue means R4 must not be marked fully closed.

### Time, HTTP, CORS and proxy

Capabilities list explicit times and `nearestValue="1"`. Responses included a `Warning: 99 Nearest value used` header even when the selected timestamp matched the requested catalog time. Preserve the actual selected source time; never use retrieval time as frame time or force radar/satellite onto one implied common timestamp. Reject arbitrary unavailable times; select an advertised value and preserve source warnings. Catalog history is a rolling window, not a permanent archive; the saved URLs may cease to return their original frame later.

Sample requests sent `Origin: https://zindycast.example`; NOAA returned `Access-Control-Allow-Origin: *`, allowing a simple credential-free cross-origin GET at HTTP level. It exposed only Content-Length/Content-Range, **not Warning**. A same-origin backend adapter is therefore useful for reading provider time warnings and bounding/cache-coordinating requests, though CORS alone does not require it. Observed `Cache-Control: max-age=600` is cache lifetime, not source freshness. Browser WebGL/canvas behavior, MapLibre integration, private HTTPS access, and phone memory/animation performance have not been tested.

Reproduce each exact saved request with its JSON sidecar, for example:

```sh
python3 - <<'PY'
import json, urllib.request
m=json.load(open('docs/research/maps/conus-radar.png.headers.json'))
r=urllib.request.urlopen(m['url'], timeout=30)
print(r.status, r.headers)
PY
```

For a new audit, refresh capabilities first and select a current advertised timestamp. Do not silently treat a later nearest-time image as the saved original.

## R3 — OpenWeather Maps 1.0

The [current price matrix](https://openweathermap.org/full-price) includes Maps 1.0 in the permanent free column: 60 calls/minute, 1,000,000 calls/month, map updates every three hours, attribution required, and ODbL licensing. Maps 2.0 is excluded. The pay-as-you-call One Call column is distinct; do not activate it. These published quotas are a planning ceiling, not proof of this user's account entitlement. Count tile requests against an aggregate budget, not merely page visits. Show visible “Weather data © OpenWeather” attribution.

[Maps 1.0 documentation](https://openweathermap.org/api/weathermaps) currently rendered a loading shell to the text fetcher. The plan's [official Leaflet PDF URL](https://openweathermap.org/themes/openweathermap/assets/docs/Using_OpenWeatherMap_Weather_Tiles_with_Leaflet.pdf) returned 404 when opened, despite its indexed example mentioning `temp_new` and `wind_new`. Preserve these as candidate layer names, not an authenticated success claim.

Candidate request shape for later secure testing:

```text
https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=<server-configured-key>
https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=<server-configured-key>
```

Remaining: user-controlled free account/activation and zero billable subscriptions; one PNG per layer for CONUS/AK/HI; content and supported zoom; current documented palette/units; exact valid-time metadata or honest unknown source-time; response cache/CORS/error semantics; authenticated quota statement. No keys were requested or tested. Use a bounded server-side tile adapter to keep keys out of URLs exposed to clients/logs. No forecast animation, wind particles, paid upgrade, or synthesized frame timestamps are authorized by this evidence.

## R3 — AirNow

[Public documentation](https://docs.airnowapi.org/) permits public account requests; the [fact sheet](https://docs.airnowapi.org/docs/AirNowAPIFactSheet.pdf) describes email activation and a key on the Web Services page. No account was created and no billable service was activated. Public access is documented; this audit did not verify an activated account's free entitlement or numeric replacement-endpoint quotas.

**Migration finding:** [Web Services](https://docs.airnowapi.org/webservices) explicitly groups old ZIP and lat/long observations/forecasts under retirement in fall 2026. It lists replacement current observations by reporting area and by ZIP/lat-long. Do not implement the old familiar endpoint simply from earlier examples. An attempted [old detailed documentation page](https://docs.airnowapi.org/CurrentObservationsByLatLon/docs) redirected to login. Exact replacement URL/schema and quota must be read after authorized registration; do not promote third-party “500/hour” statements into verified current limits.

The [FAQ](https://docs.airnowapi.org/faq) says quotas are service-specific, per-key and hourly; exhausting them suppresses data until the next hour. Observations generally refresh hourly, forecasts daily. Cache per reporting area/pollutant/time. Reporting-area observations reflect the maximum station AQI within the area, not a sensor at requested coordinates. Forecast availability and pollutants vary. Empty responses mean unavailable reporting coverage/data, never clean air. Avoid ZIP loops or bulk history through end-user web services; file products are the suggested bulk route.

The [August 2025 Data Exchange Guidelines](https://docs.airnowapi.org/docs/DataUseGuidelines.pdf) require preliminary-data labeling, agency and EPA AirNow credit, unchanged forecasts/advisories, and AQI-consistent colors. They also say products relying on the data must be made known to the relevant agencies and EPA, contact information kept current, and provide a form to return by email. Record this as an onboarding obligation to resolve with the user, not authorization to send email. These data are unsuitable as a validated historical trend source.

Remaining account audit: inspect replacement documentation; record free access/no payment requirement and endpoint quotas; retrieve small current samples across the reference locations including Anchorage/Honolulu; preserve reporting-area identity, pollutant, local observation time/time zone, AQI/category, source agency and missingness; verify empty/error/XML behavior and caching. Use a server adapter for secret isolation irrespective of CORS. Modeled coverage must be a separate labeled product, never silently substituted for AirNow observations.

## R6 — NIFC wildfire

Verified public, unauthenticated JSON metadata and three attribute records per service:

- [Current perimeter layer](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0?f=pjson), [authoritative item](https://www.arcgis.com/sharing/rest/content/items/d1c32af3212341869b3c810f1a215824?f=pjson).
- [Current incident layer](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0?f=pjson), [authoritative item](https://www.arcgis.com/sharing/rest/content/items/4181a117dc9e43db8598533e29972015?f=pjson).

Raw `nifc-*.json` includes fields/types, aliases, time reference, record limit, capabilities, item descriptions and attribution/disclaimer. Query sidecars record `where=1=1`, `outFields=*`, `returnGeometry=false`, `resultRecordCount=3`. These bounded attribute samples do not verify polygon rendering. Both layers advertise maximum 2,000 records per response and UTC date fields. Future viewport queries must respect pagination/`exceededTransferLimit`, validate geometry, and distinguish request failure from a successful empty set.

| Meaning | Incident field | Perimeter field |
|---|---|---|
| Incident identity | `IrwinID` | `poly_IRWINID`, `attr_IrwinID` |
| Human-facing identifier | `UniqueFireIdentifier` | `attr_UniqueFireIdentifier` |
| Source record identity | `SourceGlobalID`, `GlobalID`, `OBJECTID` | `poly_SourceGlobalID`, `attr_SourceGlobalID`, `GlobalID`, `OBJECTID` |
| Incident update | `ModifiedOnDateTime_dt` | `attr_ModifiedOnDateTime_dt` |
| Polygon captured time | Not applicable | `poly_PolygonDateTime` |
| Polygon source last edit | Not applicable | `poly_DateCurrent` |
| Polygon record created | Not applicable | `poly_CreateDate` |
| Type | `IncidentTypeCategory` | `attr_IncidentTypeCategory` |

Use normalized IRWIN identity for incident joins, retaining raw identifiers and source IDs. Do not join by name or treat OBJECTID as globally stable. Capture time, edit time and incident update are distinct. Sample Kilolitna had polygon capture `1781905334000` but incident modification `1789058884433`: a refreshed service does not make an old perimeter newly surveyed. Preserve nulls and source date values; retrieval/service edit time cannot replace feature age.

Authoritative item metadata says current incidents include WF, RX and CX; the perimeter selection includes WF/RX and approved public visible source polygons. The first three incident samples were prescribed fires: the app must explicitly filter WF for a wildfire-only view or label RX/CX separately. Perimeters do not exist for every incident.

The current views exclude various contained/controlled/out/certified/invalid records and apply size/update fall-off rules (3, 8, or 14 days), enforced hourly. Therefore disappearing from “current” is not evidence of extinguishment. Incident data refresh every five minutes; perimeter source changes can take up to fifteen minutes to display. Those are feed refresh characteristics, not promises of new field surveys.

Show “NIFC / WFIGS” with a source link and retain the item credits to IRWIN/DOI, USDA Forest Service, partner agencies and NWCG. Item disclaimers state dynamic data, no completeness/accuracy warranty, and no legal-document status. A perimeter is an incident mapping product, **never an evacuation zone**, prediction of spread, or assurance of safety outside it. A successful empty viewport means no matching published records, not no fires.

## R6 — OSM standard basemap

The [OSMF standard tile policy](https://operations.osmfoundation.org/policies/tiles/) supports modest interactive use, with best-effort availability and possible blocking. Use `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, visible linked “© OpenStreetMap contributors,” valid browser Referer, and normal browser User-Agent. Honor HTTP cache headers; where unreadable, cache at least seven days. Do not force no-cache, hide attribution, bulk-download, pre-seed cities, or offer offline map downloads. A PWA installation does not exempt map requests. Keep provider configuration replaceable. OSM discourages a caching proxy; if used, retain Referer and identify the service with a contactable User-Agent. No tile sweep was performed.

## Contract implications for lead

Add per-layer provider/product/region, advertised bounds versus coverage state, explicit frame time and retrieval time, available times, native cadence, approximate latency, legend type/units, source-warning status and attribution. Missingness needs `outside_extent`, `coverage_unknown`, `no_published_records`, `provider_error`, `stale`, and `account_unverified` distinctions. Global infrared must be its own product. Keep AQI reporting areas separate from point sensors and modeled products. Preserve wildfire incident and polygon timestamps independently and avoid converting disappearance into a resolved incident.

Research acceptance remains partial: R3 is account-blocked; R4 has real visual evidence but unresolved radar coverage semantics and deferred device checks; R6 public documentation/schema checks are complete with integration tests deferred until DEVELOP.

## Bounded R4 follow-up — coverage semantics, 2026-09-10

**Outcome: blank nowCOAST radar pixels still cannot be safely classified as no precipitation.** Public native MRMS flags and a quality product exist, but this audit did not establish a compatible per-frame coverage mask for the sampled nowCOAST CONUS/Alaska/Hawaii mosaics. R4 remains partial. The follow-up closes the narrower documentation question about candidate quality/status sources and establishes that the tested WMS interface does not itself supply an explained coverage classification.

Checks ran approximately 23:36–23:40 UTC. Six sample GETs beyond documentation/catalog reads: one official live radar-status page, one combined GetStyles request, and four GetFeatureInfo point requests. No new image was fetched; earlier visual checks remain the image evidence. Every locally saved response has a URL/time/header sidecar. [Public-source notes](maps/followup-public-source-notes.json) identify web-tool evidence and failed native fetches explicitly.

### What NOAA documents, and where it applies

The [NSSL operational MRMS table](https://www.nssl.noaa.gov/projects/mrms/operational/tables.php) labels native `ReflectivityAtLowestAltitude` missing as `-99` and no coverage as `-999`; `RadarQualityIndex` uses `-1` and `-3` respectively. The page identifies version 12.2. These flags belong to native GRIB2 products; applying them to WMS `Band1` without a documented transformation would be an error. The indexed [NOAA MRMS guide, page 13](https://vlab.noaa.gov/documents/96675/0/MRMS_ALL.pdf/e410f6ce-7833-b434-e342-fec3a577c35f?t=1696004704287) explains that missing can include either no reflectivity return within coverage or return removed by quality control. It therefore does not establish dry conditions. Evidence limitation: this wording was available in the search index; direct web opening failed and a native download was stopped at the 12 MB bound, below the advertised 42.4 MB. The partial PDF was removed and the full document was not inspected.

The [NOAA RQI guide](https://vlab.noaa.gov/web/wdtd/-/radar-quality-index-rqi-?selectedFolder=668045) describes a 1 km, two-minute product reflecting QPE uncertainty from terrain blockage, beam geometry and freezing level. It can help identify coverage voids, but is not a binary assurance of usable surface precipitation detection. Do not invent an RQI cutoff or mark every positive RQI pixel fully covered. Public MRMS CONUS/ALASKA/HAWAII directory requests returned 403 in this environment; regional availability and alignment of native RQI with these exact WMS frames remain unverified. This is an access limitation here, not evidence that the products do not exist.

The [NWS radar FAQ](https://www.weather.gov/radarfaq), saved as [HTML](maps/followup-radar-faq.html), describes regional quality-controlled base reflectivity and links the [official site-status page](https://radar3pub.ncep.noaa.gov/). The status sample included mainland, Alaska and Hawaii station receipts; PHKI was last received at 17:08:45 UTC, compared with the page's approximately 23:00–23:03 UTC status. This supports a station-delay indicator, not a Hawaii-wide outage declaration. Site receipt status does not establish which radar contributed to a historical mosaic, overlapping coverage, terrain blockage or surface detection. Keep it separate from frame coverage and preserve its own timestamp.

### Actual nowCOAST checks

The refreshed [capabilities](maps/followup-nowcoast-capabilities.xml) still identify the three regional radar mosaics as MRMS-sourced. [Catalog audit](maps/followup-catalog-audit.json) found no named radar coverage, status or quality-mask layer. Unrelated S-100 coverage layers cannot be used for radar.

The [combined GetStyles response](maps/followup-radar-style.xml) gives the same style for all three products: visible color quantities 1–80, with 81 and 255 explicitly labeled `nodata` and zero opacity. It provides no separate no-echo versus no-coverage legend category and no explanation of quantity 0. This shows why transparent map rendering is insufficient; it does not prove the provider collapses every native missing flag in a particular way.

| Point query | Coordinates lon,lat | Response |
|---|---|---|
| [Roseville-area CONUS](maps/followup-conus-featureinfo.json) | -121.29,38.75 | One feature, `Band1: 0` |
| [Anchorage-area Alaska](maps/followup-alaska-featureinfo.json) | -149.90,61.22 | One feature, `Band1: 0` |
| [Honolulu-area Hawaii](maps/followup-hawaii-featureinfo.json) | -157.86,21.31 | One feature, `Band1: 0` |
| [Arctic Alaska](maps/followup-alaska-arctic-featureinfo.json) | -160.00,71.00 | One feature, `Band1: 0` |

Each query used the last advertised regional timestamp, CRS:84, a 0.02° square bbox and center pixel of a 3 × 3 request. All returned HTTP 200 JSON. `timeStamp` in the FeatureCollection is response-generation time, not an independently validated radar observation time. Four unexplained zero values do not demonstrate no rain, valid coverage, or a mapping from native MRMS missing flags. The Arctic location is a contrast sample, not independently established ground truth for a coverage boundary. Exact request URLs are in the corresponding `.headers.json` files.

### Concrete UI and contract proposal

Use independent fields for request status, frame freshness, extent, coverage evidence and visible return. A successful image can coexist with unknown coverage; a stale frame can contain visible echoes. Proposed wording:

| Evidence/state | User-facing wording/behavior |
|---|---|
| Successful frame, coverage not validated | Persistent “Radar coverage is not verified; blank areas may have no return or missing data.” |
| Blank selected location with unknown coverage | “No visible radar return here. Coverage is unknown.” Never “No precipitation.” |
| Outside advertised layer extent | “This radar layer is unavailable here.” Shade only the known outside-extent area. |
| Request failed | “Radar could not be loaded.” Keep basemap and other sections usable. |
| Last good frame retained after failure | “Showing radar from [source time]; latest update unavailable.” Preserve failure and age independently. |
| Separately observed station delay | “Radar station [ID] data delayed; last received [time].” Do not paint its nominal radius as uncovered. |
| Future validated native no-coverage flag | “No radar coverage reported for this frame.” Requires exact product/time/grid mapping. |
| Future validated native missing/QC flag | “Radar return unavailable or removed by quality control.” Do not translate to dry conditions. |

For M1/M2, retain `coverageEvidence: none | validated_mask`, optional mask source/product/time/grid metadata, `coverageState: unknown | reported_no_coverage | reported_coverage`, and a separate missing/QC reason where supported. These are proposed names for lead-owned contracts, not new shared code. Even reported coverage does not guarantee precipitation reaches the ground. Do not create geographic gap polygons from transparent PNG pixels or generic radar-radius circles.

Free-only path: keep the audited WMS imagery with explicit unknown-coverage wording. To satisfy the stronger R4 acceptance of actually distinguishing gaps, validate an authoritative native flag/mask transformation for each region and frame, including no-return, QC-removed and known unavailable cases; preserve mask freshness and grid alignment. Until then, this proposal is an honest limited mode and **does not close the gap-distinction gate**. Device rendering remains deferred until DEVELOP.

### AirNow public follow-up

The [public service catalog](https://docs.airnowapi.org/webservices) remains readable through the web tool, although native GET returned 403. It lists replacement forecasts by reporting area/lat-long/ZIP and current observations by reporting-area code or ZIP/lat-long; the latter still returns reporting-area information. Logged-out content exposed service descriptions without detailed endpoint links or numeric quotas. The [public home page](https://docs.airnowapi.org/) still directs public account acquisition through login. No account, key, contact or activation action was performed.

The public primary-source retirement wording remains “fall of 2026”; this follow-up did not independently verify an exact retirement day from an accessible official announcement. Existing account-dependent schema, free-entitlement, limits and regional sample checks remain open, as does the previously recorded data-use onboarding obligation. Preserve these gates rather than implementing legacy endpoints or adopting third-party replacement URL/limit claims.
