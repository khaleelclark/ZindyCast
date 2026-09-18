# LibreWXR bounded feasibility trial — September 12, 2026

Result: observed imagery is browser-accessible and worth an opt-in experiment, but this bounded trial does **not** yet establish reliable server access, catalog/nowcast availability, cadence, or per-pixel provenance. No app integration or deployment was performed.

## Requests and access limitation

Exactly **one catalog + two tile HTTP requests** to public LibreWXR. No new NOAA, Mapbox, quota admission, basemap, other weather API, health/MCP, or production requests. Documentation/source GETs are separate research, not weather requests. No live autoplay.

1. Python urllib GET `https://api.librewxr.net/public/weather-maps.json` returned403. Traceback observed; body/headers were not retained because urllib raised before the original recorder. Never retried under the one-catalog budget.
2. Python urllib GET `https://api.librewxr.net/v2/radar/0/512/10/28.858/-81.17/6/1_0.png` returned403,147ms,17bytes, Cloudflare `error code: 1010`. Exact response and headers retained.
3. Actual headless Chrome navigation to that same latest point-tile URL returned200,81,009bytes,image/png,512×512. `X-Frame-Timestamp:1789236000` = **2026-09-12 18:00Z**; retrieved18:09:19.649Z, about9m20s old. `Cache-Control:public,max-age=300`; edge MISS, origin duration2179ms. Real image has substantial colored precipitation and transparent areas.

The different result is consistent with HTTP-client fingerprint filtering, not a blanket outage. It does not prove which server-client headers are supported, and no attempt was made to bypass a browser challenge or change the Python fingerprint. Lead needs a fresh bounded catalog check with a supported client before integration. No unknown/guessed future timestamps were requested.

`requests.json`, `latest-response.bin`, `chrome-latest-response.bin`, `libre-observed.png` retain available evidence. `fetch-latest.py` and `browser-live.mjs` are one-request capture scripts; **do not rerun without a new live budget**.

## API contract and meaning

[Official README](https://github.com/JoshuaKimsey/LibreWXR#api-endpoints) documents catalog `{version,generated,host,radar:{past:[{time,path}],nowcast:[{time,path}],colorSchemes},satellite:{infrared}}`. This is a documented schema, **not a successfully sampled catalog**. Use actual entries, not a synthesized timeline. Point-tile paths use decimal lat/lon; integer strings mean XYZ indexes. Sizes256/512; palette6=NEXRAD Level III; `1_0` enables smoothing and disables snow colors. Timestamp0 resolves latest past and returns the timestamp header. Unknown timestamps are documented404; no-data areas can be transparent200, so transparent does not independently establish no rain.

[Official project](https://github.com/JoshuaKimsey/LibreWXR#features) describes experimental60min optical-flow extrapolation, by default blended toward a regional numerical model (HRRR over CONUS), pure model beyond60min. Developing convection is a stated weakness. CONUS is documented MRMS with IEM fallback; global observed satellite estimates and model fallbacks also exist. Our tile has no region/model/fallback/expiry flags in response headers. Therefore label it **LibreWXR composite, latest-past timestamp**, not independently confirmed pure MRMS pixels. Current public instance mode, nowcast horizon, cadence and source health remain unverified.

## Terms

[Public site data licensing](https://librewxr.net/#data-licensing) explicitly permits attributed public API data under CC-BY4.0, including commercial use. Italian DPC tiles carry a separate CC-BY-SA obligation; this sample is Florida. Software AGPL3.0-or-later is distinct from API data licensing. No registration, purchase or installation used. No numeric public request limit or service-level commitment established in reviewed pages; retain bounded caching and NOAA fallback. Standalone replay credits LibreWXR/CC-BY4.0 and NOAA, and declares its crop modification.

## Spatial comparison and Chrome replay

Open `trial.html` through a local static file server rooted at `docs/verification` (do not serve production app assets), or run:

```sh
node docs/verification/librewxr-trial/browser.mjs
```

All browser requests are intercepted and fulfilled from exact retained local files. No server is needed for this harness. No external network escapes. It loads PNGs, computes matching Mercator overlap, checks the nowcast-unavailable control, document width, and uncaught errors at1440×1000 and390×844. Both pass. Screenshots `desktop.png`/`mobile.png` visually inspected.

The NOAA source is the existing800×500 `../radar-deep-audit/zoom10.png`, requested17:28:04Z (exact source time unconfirmed). Libre is512×512 at18:00Z. Matching512×500 overlap is about34km wide. Upstream `coordinates.window_origin` uses a512×2^10 world and integer-snapped window origin; replay crops NOAA at fractional offsets to that same origin and Libre at y6. Formula and crop numbers retained in `trial.html`/`browser-results.json`. This establishes matching computed extents, not independent geographic ground truth.

Libre has smoother colored contours with stepped transparency edges still visible. Different times (~32min advertised separation), palettes, products and processing mean this is **not** a storm accuracy or source-resolution comparison. The catalog failure prevents animation/cadence or nowcast visual acceptance. The documented500m CONUS storage grid is not independently proven effective spatial resolution.

Only NEW `docs/verification/librewxr-trial` files changed. Typecheck and isolated empty-token Rsbuild build to `/tmp/zindycast-librewxr-trial-dist` checked separately; no production build or service mutation. No app/node:test changes warranted for documentation and standalone replay. Public provider availability, supported server-client access, nowcast labels, source health, real-device behavior and integrated acceptance remain lead gates.
