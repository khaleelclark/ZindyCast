# LibreWXR opt-in trial — September 12, 2026

User explicitly authorized trying LibreWXR after the radar audit. First gate is a bounded actual-image comparison; keep NOAA observed and IEM HRRR available. No new account or self-hosted Python service is required for the initial public-instance experiment.

Public [terms](https://librewxr.net/terms) permit personal apps and prototypes and encourage caching. Service is best effort and may throttle. Preserve LibreWXR and underlying source attribution. US-focused trial avoids an unsupported blanket attribution claim for global mosaics. Do not resell/re-expose a commercial weather API. No public API numeric quota is asserted; apply a conservative app ceiling. General integration docs claiming no rate limits do not override public service terms.

Scientific distinction: Xweather raster fradar uses HRRR/NAM/GFS atmospheric models. LibreWXR documents an experimental 60-minute optical-flow projection of radar with configurable model blending; it is also a forecast, and developing convection can defeat it. Neither is a future observation. Sources: https://www.xweather.com/docs/maps/layers and https://github.com/JoshuaKimsey/LibreWXR .

Integration gates after the live comparison:
- Pin advertised nonzero frame timestamps and validate returned X-Frame-Timestamp; never infer source freshness from HTTP retrieval alone.
- Same MapLibre camera/base map and independent weather source. Provider switch clears only weather imagery, not basemap or Mapbox budget.
- Explicit observed versus experimental nowcast timeline and source attribution; unavailable/stale/expired nowcast must not be relabeled observed or replaced silently with HRRR.
- Same-origin bounded cache with fixed upstream host/path, schema/body/time limits and backoff. No client-selected upstream host, arbitrary archive access or bulk prefetch.
- Buffer a bounded visible-frame loop; test cold and warm playback, failures, hidden/offline, location changes and phone width. Do not assume twelve requested frames are twelve tile requests.
- User can return to current radar. Automatic fallback must name the replacement source and must not retry continuously.

Current gate: delegated live comparison in docs/verification/librewxr-trial; no application migration published yet.

## Supported-client follow-up and implementation gate

At18:12–18:15 UTC, one ordinary Chrome catalog request and one advertised18:20Z nowcast point image returned200. Ordinary Node fetch then returned200 for the catalog and same image, without custom browser headers or challenge handling. Image X-Frame-Timestamp matched1789237200. Four additional data GETs, no retries. The Python403 was client-specific in these samples; it does not establish a universal server restriction. Captures under ../verification/librewxr-trial/chrome-catalog-check.json and node-tile-check.json. Nowcast PNG visually inspected; source-specific per-pixel mode remains unverified.

API implementation: fixed same-origin catalog and512px XYZ tile routes, strict advertised timestamp membership and response timestamp match,60sec metadata/five-minute tile cache,20min catalog age gate, past2h20min and future up to one hour after generation. Bounded stream bodies and12sec timeouts; no stale fallback. Shares the existing imagery quota bucket (internally named noaa), ceiling60/min,1000/hr,5000/day,100000/rollingmonth, charged only on uncached fetch. These are conservative app values, not provider promises. Attribution and UI classification remain integration gates. No direct client upstream requests needed.

Lead API4tests + storage11tests pass, typecheck passes. UI/source selector and isolated browser integration delegated; final build/publication pending that result.

Release correction: adding a provider key to the durable storage configuration triggered its intentional configuration-mismatch startup guard. Removed the new key and charged Libre against the existing shared imagery bucket instead, preserving the stored configuration/counters/cache. API tests4/4 pass after correction. Service restored after clearing its restart-limit state. No database metadata edit, quota reset or deletion.
