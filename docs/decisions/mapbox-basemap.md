# Mapbox styled basemap with standard-map fallback — September 12, 2026

User requested Mapbox for a more natural map, asked for automatic fallback, and authorized proceeding after discussion of free allowance and overages. No account or token existed; setup instructions requested and supplied. Activation awaits a user-provided public token and live validation. No paid subscription, account creation or payment is performed by this implementation.

Use Mapbox Static Tiles API streets-v12 with 512-pixel tiles (retina @2x), keeping MapLibre and the existing weather rendering. This improves base-map styling while preserving the custom forecast protocol/decoded cache. It is not a switch to Mapbox GL JS, a new radar provider, or improved source-weather resolution. Mapbox Standard is not supported by the Static Tiles endpoint.

**Pricing correction communicated during implementation:** the earlier 50,000 map-load free allowance applies to Mapbox GL JS, not this architecture. Static Tiles API currently includes 200,000 requests/month, then $0.50/1,000 in the first paid tier. Loads can request multiple tiles. Mapbox offers no account hard spending cap. Fallback handles provider failures; it does not stop valid paid usage at the free allowance. No guaranteed-zero-cost claim.

Configure `PUBLIC_MAPBOX_ACCESS_TOKEN` in ignored `apps/web/.env.local`, or the build environment. Use only a URL-restricted public `pk.` token with `styles:tiles`; never a secret `sk.` token. Build rejects malformed/secret tokens before emitting assets. Allow the actual app origin with port, currently `https://weather.example.invalid:21443`. Mapbox restrictions do not accept IP addresses or wildcard characters. Separate localhost restriction is optional for local live validation. Do not broaden restriction for fixture tests, which intercept all requests and use synthetic tokens.

Token is intentionally browser-visible. Configuration is not a server provider credential or an API proxy. The existing strict-origin-when-cross-origin Referrer-Policy supplies the origin required for URL restrictions. CSP adds only https://api.mapbox.com to image/connect origins; scripts/workers remain same-origin. No service-worker external tile prefetch/cache added. Live tokens must not enter evidence/logs; redact request query strings in retained evidence.

Automatic fallback and manual standard-map selection must change only base sources/layers, preserving the map instance, camera, selected weather layer and forecast caches. No retry loop; explicit user retry can reattempt Mapbox. Missing token means standard map and no Mapbox requests. Required Mapbox/OSM attribution and Mapbox logo must remain visible while Mapbox tiles are displayed. Separate NOAA/IEM weather attribution retained.

Sources checked September 12, 2026:
- https://docs.mapbox.com/api/maps/static-tiles/ — 512 pixels, @2x, scope, errors, standard-style incompatibility, request-based billing.
- https://www.mapbox.com/pricing — Static Tiles free and paid tiers.
- https://docs.mapbox.com/accounts/guides/invoices/#spending-cap — no hard cap.
- https://docs.mapbox.com/accounts/guides/tokens/ — styles:tiles public scope and URL restrictions.

Implementation/browser evidence belongs under docs/verification/mapbox-fallback. Live appearance/credentials and integrated release are separate from fixture fallback tests.

## Integration review

The implementation is integrated and the no-token production bundle is built. Typecheck passes; seven configuration/headers/static/controller tests pass (browser test separately enabled). Reviewed retained dedicated Chrome evidence and mobile screenshot: synthetic tiles explicitly identified, same camera/canvas and weather sources preserved; source-only fallback tested for request errors and timeouts. No user token exists at apps/web/.env.local at review time. The API CSP change is in source and will require the app API process to reload during activation. Do not claim Mapbox live until the token-bearing build, CSP reload and bounded real-Mapbox browser verification complete. Existing standard map remains selected without the token.
