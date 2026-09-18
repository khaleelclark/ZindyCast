# Current conditions source correction — 2026-09-17

User reported Wunderground 88°F / feels-like95°F versus ZindyCast83°F / apparent85.5°F in simultaneous screenshots. Source code showed Open-Meteo modeled current conditions in the headline and a gauge whose blue/orange palette represented the day's range. Screenshots do not identify Wunderground's station or ZindyCast's exact coordinates, so they cannot establish a local accuracy ranking or systematic temperature bias.

## Delivered behavior

- One shared current observation request stream for Today and the station explorer. Existing NWS resource, five-minute visible-page cadence, coalesced visibility/focus refresh, cancellation and synchronous geography binding. No account/registration, notification, or verification opt-in is created.
- Prefer the nearest **available candidate** within25km whose latest report contains a passing temperature and is at most90minutes old. This operational radius/age rule does not establish neighborhood representativeness, terrain/elevation equivalence or globally nearest station coverage. The service inspects at most five candidates and returns at most three histories. Station name/ID, distance, report local time and age remain visible.
- Source response must be fresh, fetched and queried within10minutes, not future-dated; old city/future/failed QC/invalid values rejected. Latest report only: never backfill its missing fields from older reports, another station or a model. The main observed card remains usable when forecast service fails.
- Feels-like derived with NWS heat-index/wind-chill equations from the same accepted report; heat index identified as shade. Missing relevant humidity/wind leaves feels-like unavailable, retaining observed air temperature. See [scientific method and independent numeric evidence](../../research/observed-feels-like.md). No WBGT or new heat categories derived from observations.
- Model fallback visibly labeled, including unavailable nearby observation status. Hourly/daily series stay Open-Meteo. Forecast extras (UV/clouds/astronomy/rain chance) and modeled outdoor heat are explicitly distinguished from station readings. No observed sky is replaced with a contradictory model icon/animation.
- Main gauge has one neutral fixed numeric scale (−40..60°C / −40..140°F) for both station and model modes. Its scale is display geometry, not a comfort/safety scale. Values outside scale stay numeric with no fabricated endpoint marker. Mobile full arc retained. Compatibility daily-range mode is also neutral and reports outside-range values truthfully.
- Shared observation QC/range parsing reused by main card and existing station explorer. Wind widget accepts its source height label; station wind no longer silently claims10m.

## Provider findings

A bounded local observations request for approximate public Osteen center initially returned502. Adapter audit identified NWS wind `wmoUnit:km_h-1` versus SI contract `wmoUnit:m_s-1`, and blanket rejection of `pagination.next` on otherwise useful current pages. The adapter now explicitly converts km/h wind/gusts to m/s, preserves quality flags, and returns the first bounded page with per-station `observationHistoryTruncated` metadata instead of claiming complete history. The existing500record/5MB/10s bounds and source/time/geography validation remain. No pagination links are followed. Backward compatible schema defaultfalse reflects prior accepted responses (which could not have continuation links). Two typed verification fixtures were updated for the new flag.

## Evidence

- `apps/web/src/observed-current.test.ts`: same-report provenance, numeric/QC gates, future/stale/old/wrong-city/distant rejection, no hidden data splice, next eligible station, rendering source labels, independent forecast outage and missing derived metric.
- `apps/web/src/observed-feels-like.test.ts`: official formula domain and independently calculated reference cases. 88°F/58% yields94.25074074°F, displayed94.3°F; we do not force a match to a rounded commercial screenshot.
- `apps/web/src/feels-like-gauge.test.ts`: range/scale, units, missingness, outside-scale and no misleading gradient.
- `tests/browser/observed-current.mjs`: actual Chrome at320/390/768/1440, all APIs intercepted with explicit synthetic fixtures; external attempts blocked. Tests observed primary display, Fahrenheit/Celsius without new requests, station expiry/stale/badquality/outage fallbacks, missing humidity, complete forecast outage, delayed previous-city response, offline withholding, hidden-page refresh pause and clock expiry. Screenshots `station-*.png` are fixture evidence, not live weather. No physical-device claim.

## Sources and reliability interpretation

[Open-Meteo features](https://open-meteo.com/en/features) documents national weather-service model inputs; [forecast documentation](https://open-meteo.com/en/docs) explicitly describes current conditions as model-based. This supports keeping it as a forecast source, not presenting it as a local thermometer or claiming an independently verified accuracy ranking. [NWS API](https://www.weather.gov/documentation/services-web-api) documents observation QC ingestion delays up to20minutes. [Wunderground data](https://www.wunderground.com/about/data) describes station-based current conditions. Nearest station observations can still differ from a home's exposure; no fixed offset or automatic forecast bias correction was introduced.

## Integrated release

Typecheck and required `npm run build` passed. Integrated relevant run:172tests,168passed,4existing opt-in tests skipped,0failures (`tests.tap`). Browser fixture suite passed on the isolated build; the same suite also passed on served production assets; release evidence is in `browser.json`. Existing MapLibre bundle warning remains.

Built served assets and gracefully restarted only existing ZindyCast API/worker user services; no configuration, schema migration, account, Tailscale mapping or notification settings changed. API health returned200/ok. At2026-09-17T20:26:58Z, a bounded live GET for approximate public Osteen center returned200 and selected KSFB (Orlando/Sanford Airport),11.05km away, observation20:10Z, air87.8°F, humidity58.81%, wind6.69m/s, derived heat index94.2°F. Source passed V quality flags and advertised partial history. This is a later nearby-station check, not a reconstruction of the screenshot or the user's exact coordinates. Raw canonical result and concise check retained in `live-observations.json` and `live-check.json`.

The previous served static build is retained at `/tmp/zindycast-web-before-observed-current.tgz` for scoped rollback. Existing PWA users receive the update through “Update and reload.” Physical-device acceptance is still not claimed.
