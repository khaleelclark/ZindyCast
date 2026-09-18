# Implementation status

DEVELOP authorized September 10, 2026. Workspace confirmed local to the intended deployment host; the private host identity and checkout path are omitted. The earlier assumption that a new remote connection was required was corrected. Local service inspection found 4310/4311 unused; unrelated listeners are preserved.

| Work | Owner | Status / acceptance |
|---|---|---|
| F1 root workspace, contracts, API/worker lifecycle | Boston | Created; focused API tests pass; whole workspace typecheck/build awaits incoming modules |
| F2/F3 public weather/search adapters | Providers and maps | First implementation assigned |
| F2/F4 dashboard and local settings | Station history | First implementation assigned |
| F5 numerical heat/reference validation | Heat science | First implementation assigned; no category approval |
| Shared SQLite cache/job coordination | Boston | Not started; API process cache is explicitly temporary |
| PWA/install/device testing | Team | Not started |
| Private HTTPS supervised deployment | Boston | Not started; no existing service changes |
| Maps/history/environment/notifications | Team | Later waves, research gates preserved |

Root dependencies pinned; initial production dependency installation reported zero vulnerabilities. Full dev-tool installation and compatibility checks are required. Tests run so far: invalid coordinates/timezones prevented provider calls; upstream error details sanitized; health remained independent after search failure. No application UI, physical-device or numerical heat pass claimed yet.

Three tracked disjoint implementation requests will return for lead integration. Implementation is ongoing, not a completed release.

Initial full compatibility check: TypeScript currently reports the not-yet-delivered provider entry module; web build is awaiting the assigned src/index.tsx. These are open wave dependencies, not passing checks. Dev dependencies installed with --include=dev; npm reported zero vulnerabilities across 86 packages.

## First wave integrated September 11

Lead review: npm run typecheck and production build passed; 42 package/API tests plus five web tests passed. Added API Retry-After/rate-limit propagation test and fix (three API tests now pass). Corrected shared interval wording for preceding-hour probability and gust maximum; added GeoNames attribution. Read provider/UI and numerical verification reports; C-reference parity is accepted for the supplied 2m/instant-input API only, not forecast input policy or physical accuracy.

Owned-browser integration at 1280×720: opened local Rsbuild, searched Honolulu, selected Hawaii match, observed live API-backed feels-like/air/wet-bulb values, Hawaii local time and 48 hourly rows. WBGT remained explicitly unavailable. Saved screenshot artifact ec47aa17-02fd-418e-bb35-17cb72f88250. This is a desktop browser smoke check, not physical-device or installation evidence.

Second wave assigned: provider detail fields and coordinate timezone resolution; web detail rendering/geolocation/PWA/offline/update behavior; storage SQLite shared cache/leases/weighted quotas. Lead expanded nullable fields and added the optional resolution route, pending provider completion. Storage ownership explicitly delegated for this wave; root package manifest remains lead-owned. API integration of persistent storage follows its handoff.

## Second wave integrated September 11

Provider details and geographic IANA timezone resolution implemented. Web renders five new detail fields, distinguishes preceding-hour rain intervals including DST, uses browser request deadlines, and has a production-only shell service worker/update UI. Physical-device installation, offline navigation and multi-tab release checks remain open.

Lead replaced temporary forecast process cache with SharedStorage-backed refresh orchestration for forecasts, search and timezone lookup. API and worker use the same configurable coordination database; worker runs bounded cleanup each minute. Fifteen-variable forecast reserves two weighted Open-Meteo calls; search/resolution reserve one. No quota-denied unbudgeted fallback. Cached JSON is schema-validated, writes lease-fenced, stale fallback bounded, parallel local requests coalesced. Root runtime minimum raised to Node22.22.1. API responses use no-store.

Checks: typecheck/build and 68 tests passed on the returned wave; three added cache-integration tests then passed (coalescing/cache reuse, quota blocks fetch, stale fallback). Production static host added with shell/sw/manifest revalidation and immutable hashed assets. Initial static test revealed changed plugin header API; corrected to FastifyReply.header and rerun. No supervised deployment or Tailscale change yet.

Next tracked wave: independent official NWS alerts, alerts panel/48h chart/PWA lifecycle improvements, and allowlisted NOAA catalog/image module. Lead owns integration/production host. Existing maps/history/notifications gates remain visible.

## Third wave integrated September 11

NWS adapter and independent alerts panel, accessible air/feels-like chart, and revised PWA multi-release cache behavior reviewed. Root added static lang=en template. NOAA map catalog/frame REST contracts and routes now validate only server-owned catalogs; images capped at 800x600 and 1.5M base64 characters for bounded SQLite storage, explicit warning/unknown actual time retained. Frame errors fail independently; map viewer is the next web assignment.

API alert snapshots use shared cache/lease, replace snapshots and filter expired/ended/cancelled/non-Actual records on every read. NWS/NOAA have separate conservative application admission budgets (60/min,1000/hour,5000/day,100000/31days), not claims about provider quotas. APP_PROVIDER_LIMITS shared by API/worker. Persistent coordination database first created during this round with this configuration; preserve its quota records across restart.

Validation: typecheck/build and 98 tests passed after integration; new cached-alert expiry/reuse API test also passed. Three bounded live production-host checks returned HTTP200/no-store: Roseville-area NWS snapshot with one alert, Honolulu coordinate resolution Pacific/Honolulu, and all five NOAA products with advertised times. Browser opened production shell at loopback4311 (1280x720); this does not establish installation or offline lifecycle. Test server/browser closed afterward. Existing unrelated services untouched.

Next tracked wave: map viewer; bounded ERA5 history adapter/CSV; persistent job state machine. Remaining full map interaction/basemap, history UI/stations/compare jobs, heat production policy, environment accounts, notifications, supervised private HTTPS and physical-device gates are open. No full-release claim.

## Fourth wave integrated September 11

Map viewer integrated with fixed regional CRS:84 imagery, independent time/product selectors, manual frame stepping and three-frame browser cache. Lead production-browser smoke opened Maps and confirmed a CONUS PNG figure with source-time uncertainty/unknown-coverage labels. Screenshot a7797067-d195-4f69-a8b8-bf14f6fffcdc saved. No pan/zoom/basemap/antimeridian or physical-device acceptance claimed.

Reanalysis schemas moved into browser-safe contracts/history.ts; history adapter reexports them without duplicate source of truth. Added bounded GET /api/v1/history JSON/CSV route with validation, cached identical selection and conservative date-weighted budget. Live Honolulu 2020-07-15 returned HTTP200,24 complete hours, ERA5 requested provenance. UTC date and precipitation interval caveats remain. Export route shares fetched data/cache key. Fixed Rsbuild history schema import resolution; full typecheck/build and121 tests then passed.

JobRepository reviewed and tests accepted for bounded persisted state transitions only. Job REST and worker execution remain pending installation authorization and result schemas; no job IDs exposed as credentials. Next assigned wave: History UI; installation credential/ownership repository; pure bounded same-period comparison planner/aggregation. Full multidecade comparison/stations/heat and notifications remain open.

Production preview server and browser stopped after bounded verification; unrelated deployment host services unchanged. Private HTTPS/supervision and offline/device lifecycle verification remain outstanding.

## Fifth wave integration September 11

History UI and bounded pure comparison module reviewed; returned wave typecheck/build and139 tests passed. Shared comparison query/result/job/registration schemas added to contracts; comparison query definition centralized. Added installation registration and owned comparison enqueue/read/cancel REST routes. Server generates job IDs, reserves ownership first, sets seven-day maximum retention, limits registration to10/hour per API process plus repository global cap, requires mutation header and same-origin Origin when present, and redacts worker leases/payload internals. Registration limiter is process-local and not a distributed admission claim. No same-ID retry route; a retry must create/reserve a new job.

Added trusted installation isJobActive check for worker execution without persisting bearer in job payload. Production API opens dedicated jobs/installations paths; worker integration assigned and pending. Comparison closing-day availability enforced; initial <=366day selection remains short of requested multidecade product. Failure responses sanitized at API boundary.

Typecheck and focused API tests after wiring passed, including two-installation isolation/ID-only denial, job cancellation, lease-secret omission, mutation-origin/header and registration admission bounds. Existing repository tests retain hash-only secrets, expiry and cross-connection semantics. No completed end-to-end worker job claimed yet.

Next tracked work: Compare browser interface, quota/cache-backed comparison worker, explicit-station daily adapter. Private HTTPS/device verification, production heat policy, full station/time selection, multi-decade comparisons, complete maps and environmental/notification scope remain outstanding.

## Sixth wave integration September 11

Compare UI, persistent worker and station adapter reviewed. Root npm test now includes apps/worker/src tests; 167/167 tests pass, TypeScript and production build pass (405.1 kB uncompressed,124.1 kB gzip). Station adapter remains pending shared REST/UI integration; its flags and unknown observation-time basis are preserved, not silently treated as accepted observations.

Manual live API-to-worker smoke (`npx tsx docs/verification/comparison-live-smoke.ts`) completed an owned Honolulu/Anchorage comparison for2020-07-15 via Fastify injection and the real worker/archive adapter. Both cities had24 valid temperature hours and24 fully contained precipitation intervals. Exactly two archive chunks were needed, using persistent shared quota/cache; temporary installation/job databases were removed after closing. Result evidence: comparison-live-smoke.json. Checks also covered credential-free access denial, lease redaction, terminal admission release and queued cancellation. No browser lifecycle, separate supervised processes or abrupt-crash guarantee is inferred from this smoke.

Worker independent tests cover cancellation/revocation abort, quota/storage failures, stale lease fencing and shutdown recovery. Cross-database orphan admission can remain charged until expiry after a crash or exhausted attempt; reconciliation remains open. Full1991–2020/recent-decade comparisons, distributions, station hourly history, production WBGT input policy, environmental layers and notifications remain incomplete.

Next tracked wave: explicit-station daily REST/schema and History UI; operations preparation with read-only local service/Tailscale inspection and isolated backup/restore verification. No service activation or Tailscale configuration change authorized by this wave. Browser/device testing and private HTTPS activation remain outstanding; no full-project completion claimed.

## Seventh wave integration September 11

Station shared contracts/REST and explicit-ID daily History UI integrated. registerStations is registered in app.ts; source flags, trace/presumed-zero, unknown observation-time and metadata remain explicit. One live registered-route smoke fetched Carefree2020-01 through the persistent NOAA quota/cache and returned200 with31 calendar rows; evidence stations-runtime/lead-route-smoke.json. No physical-device station UI claim.

Typecheck/build passed;175/175 application tests and1/1 isolated backup/restore test passed. Full Argonne reference notice now ships byte-identically in public/notices/argonne-wbgt.txt with a footer link, verified against production output. Final bundle425.0kB/129.6kB gzip.

Reviewed separate user units and scoped private HTTPS21443 proposal. No units/Serve mappings activated. Deployment approval requested because original plan explicitly excludes deployment authorization; unrelated feature work continues. Ops preparation's missing-export build failure is superseded by these passing integrated checks. DNS/HTTPS, supervised process/resource/shutdown and physical devices remain unverified.

Next tracked work: NIFC adapter, bounded terminal-job admission reconciliation, comparison snapshot CSV. Existing scientific/account/full-baseline/hourly-station/notification/map-framework gaps remain.

## Private preview activation September 11, 01:04 UTC

User approved the prepared deployment decision. Rechecked unused4311/21443 and absence of scoped runtime/units. Typecheck/build and192/192 tests passed before activation (includes newer concurrently completed module tests; full handoff review still pending). Installed only zindycast-api/worker user units and private runtime.env, enabled both. Both active/running, zero restarts, approximately70MB/50MB memory; configured512MiB memory caps and100% CPU quotas visible. Local API health200.

Added only Tailscale Serve HTTPS21443 ->127.0.0.1:4311. Unprivileged command denied, exact approved command succeeded with sudo -n; operator permissions/DNS were not altered. Programmatically verified every previous Serve config entry identical and only21443 TCP addition. HTTPS health and root both200 with normal certificate verification using curl --resolve to deployment host's Tailscale IP. Expected address https://weather.example.invalid:21443/.

Ordinary hostname lookup fails on the deployment host; owned browser reports DNS_PROBE_FINISHED_NXDOMAIN. tailscale dns status says MagicDNS enabled and expected hostname present; existing host DNS health issue remains. No global DNS/tailnet configuration changed. Thus transport/certificate/serving verified but normal client DNS/device access remains unverified. Browser closed. Services deliberately remain running under approved supervision. Further code integration requires reviewed rebuild/restart; source edits are not automatically accepted deployed behavior.

## Eighth wave integration September 11

Comparison summary CSV reviewed; exports exact completed displayed result in SI with source-chunk metadata, safe text/null/count rules, never bearer or provider-request URL. Browser download/spreadsheet/device verification remains open. NIFC adapter accepted as bounded server module only, not exposed as completed map feature; independent incident/perimeter times and unknown coverage retained, eight-call worst-case budget and native Esri geometry noted for integration.

Reviewed terminal-admission reconciliation and changed API cancellation release to committed jobs.closeTerminalAdmission fence before installations.releaseJob. Queued/running/absent rows retain admission; terminal fence disallows same-ID retry and makes crash-before-release recoverable on next bounded sweep. Both API/worker stopped together and started together under approved preview supervision to avoid mixed-version rollout. Typecheck/build and192/192 tests passed. Certificate-verified HTTPS health via explicit hostname resolution returned200; both services active with zero automatic restarts. Existing deployment host DNS limitation unchanged.

Next tracked wave: browser-safe wildfire REST and independent location display, plus concrete budgeted long-baseline climate-job design. No categorical heat/push/account-dependent capabilities released. Long baseline, map framework and devices remain unfinished.

## Browser-priority follow-up September 11

Consumed compact layout, map429 error fix, and History/settings browser evidence. Actual source rate-limit error incorrectly returned502; fix retains429/Retry-After, awaiting coordinated runtime rollout. Registered completed wildfire route in app.ts, also pending restart. Browser History selection forcedToday, assigned web fix with location saving available outsideToday. Actual History CSV downloaded/inspected for displayed-selection identity/SI.

MapLibre6.9.0 installed and shared frame projection contract added (CRS84 default, EPSG3857 explicit). Tracked provider Mercator WMS conversion and web interactive basemap work; output projections must match before overlay, no direct CRS84 stretch. Compare real registration/completion/cancel/download test now tracked with Playwright. No blanket every-functionality acceptance and no physical-device claim; baseline/deep-history/notifications remain unavailable features.

## Interactive radar integration September 11,01:36 UTC

Typecheck/build and206/206 unit/integration tests pass. API+worker updated together; projection-aware frame route and wildfire route now active. Compact UI and active-tab location selection integrated. Required MapLibre worker was not automatically packaged; lead copied worker/shared module/license into versioned vendor directory and set explicit worker URL, added favicon, source-readiness tracking and zoom/resize viewport reporting.

Actual browser accepted nine map groups including Mercator raster rendered over OSM labels, pan/zoom, opacity, previous-time, AK/global infrared,HI, offline/reconnect and390px layout; zero console/page errors. Screenshot interactive-radar.png visually inspected and imported to Project files. Browser comparison eight-check lifecycle including actual CSV downloads/completion/cancellation/reload passes; History CSV selection/SI passes. No claims of fully complete product, physical-device installation, sensor accuracy, or complete radar coverage. Detailed evidence in docs/verification/browser and browser-comparison.md.

## MUI / WBGT revision — September 11, 02:00 UTC

User-requested MUI dashboard, Today local radar, colorful hourly/daily visuals and separate ordinary-wet-bulb range delivered. Numerical modeled outdoor short-grass WBGT now derived server-side with explicit FAO wind/instant-radiation policy, full diagnostics and source grid. Current marker, Tulsa written reference ticks and 48-hour graph delivered; no personal danger categories or safe times. Forecast cache version changed to v3/17 fields; two-unit provider reservation retained. All 223 automated tests/typecheck/build pass. Live Chrome six-check integration and installed-shell migration pass; evidence docs/verification/mui-wbgt and update-migration. Physical-device and broader unfinished backlog gates remain open. Services restarted together; health ok.
