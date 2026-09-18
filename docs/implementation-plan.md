# ZindyCast — architecture and implementation backlog

Planning revision: September 10, 2026. Status: research and planning only. Application development must not begin until the user explicitly says “DEVELOP.” This document does not authorize purchases, account creation, or deployment.

Handoff revision: prepared for Ponderosa, including explicit concurrent-agent execution instructions and the user’s device matrix. Ponderosa may begin research, planning, and read-only provider audits immediately. Implementation instructions below become active only after the user says “DEVELOP” to authorize implementation. The request to update or hand off this plan is not that authorization.

## Ponderosa handoff and lead-agent instructions

You are the lead agent responsible for delivering ZindyCast against this document. Read the full plan and applicable repository instructions before assigning work. Use delegated subagents for bounded independent tasks, working concurrently where dependencies allow. Do not simply distribute the whole plan to several agents. Retain responsibility for shared contracts, integration, acceptance evidence, and the final delivery report.

Ponderosa identifies the intended recipient/execution context; it does not determine the planned deployment host. Determine the actual workspace and available tools before acting. Do not assume Ponderosa has this local file, deployment host credentials, or the same agent capacity. Do not create or message external tasks unless the user requests that action separately.

### First actions and parallel research (before DEVELOP)

1. Confirm the authorization state from the user’s messages. Until DEVELOP, perform research/documentation only: no app scaffolding, dependency installation, application code, infrastructure mutation, deployment, or live notification sends.
2. Create a concise research status ledger with backlog ID, owner, dependencies, evidence, and next action. Preserve confirmed findings; recheck only time-sensitive or unresolved details.
3. Delegate R1/R2 to a heat-science agent; R3/R4/R6 to a provider/maps agent; R5 to a historical-data agent, subject to available capacity. The lead reconciles decisions and contracts while those investigations run.
4. Ask for missing credentials only when an account-dependent check is ready. Do not request scientific cutoff choices from the user; present an evidence-backed proposed policy for review. Continue unrelated research when a check is blocked.
5. Return specific results, source links, limitations, and a short remaining-decision list. Do not declare research closed if scientific policy or provider access remains unverified.

### Implementation workspace (after DEVELOP)

Use one repository and a simple package workspace. Proposed layout:

```text
apps/web/                 React + TypeScript + Rsbuild
apps/api/                 Fastify REST application
apps/worker/              background job and notification entry point
packages/contracts/      runtime schemas and shared TypeScript types
packages/heat/            pure calculations and versioned guidance policy
packages/providers/      server-only external provider adapters
packages/storage/        schema, migrations, cache and job coordination
packages/testing/        small shared fixtures/reference cases when needed
docs/decisions/           source-backed architecture/scientific decisions
docs/operations/         configurationå, backup, update, recovery instructions
docs/verification/       reproducible check results and device matrix
```

The lead may simplify this layout if packages add ceremony without a useful boundary. Choose and pin compatible maintained versions and one package manager; record the choice. Keep runtime provider keys in server configuration outside source control. Provide placeholder-only configuration documentation. No frontend imports from server-only packages.

Before any remote work, read the operator-provided SSH access procedure and perform its harmless connection check. The deployment host is accessed as the service user using the dedicated SSH identity via Tailscale. Inspect repository state, applicable AGENTS.md files, existing services/ports, and available resources before choosing a project directory or service names. Do not overwrite unrelated work or change existing services. Development authorization is not permission to purchase services or publicly expose the deployment host.

### Contract-first foundation

The lead owns workspace configuration, lockfile, shared schemas, route registration, migrations, and cross-cutting configuration until explicitly handing ownership off. Establish F1 and minimal contracts before broad implementation delegation. Use schema-derived types where practical to avoid duplicate definitions.

Define route contracts under a versioned REST prefix, including coordinates, time zone, time range, source metadata, freshness, missingness, and structured error codes. Use explicit per-section success/unavailable/error states. Document location identity and cancellation behavior. Define job states (queued, running, completed, failed, cancelled), progress and expiration semantics, plus lease/recovery behavior for worker restarts.

Agree on fixtures representing valid, partial, stale, empty, and failed responses. UI agents may develop against these after DEVELOP; fixtures must never appear as live weather. Contract changes require a coordinated update to producers, consumers, and fixtures.

### Concurrent implementation waves

Use available agent capacity rather than assuming a fixed agent count. With four total slots, keep the lead plus at most three specialist agents active. Smaller environments can combine roles. Stages preserve the product priorities while allowing independent supporting work to overlap.

| Wave | Agent A | Agent B | Agent C | Lead’s useful concurrent work |
|---|---|---|---|---|
| Foundation, after minimal contracts | Weather/location providers and cache integration (F2/F3 server portions) | Dashboard and local preferences (F2/F4 web portions) | Pure WBGT implementation/reference tests (F5 numerical portion, after R2) | Shared contracts/storage, job coordination, integration |
| Core completion | Official alerts API (M4) | PWA/accessibility and dashboard refinement (F6) | Radar/satellite provider and map catalog (M1/M2 server portions) | Integrate core, failure-path checks, resolve heat policy |
| Maps/environment | Map UI and animations (M1/M2/M3 web portions) | Air quality/wildfire adapters (M5) | History retrieval and station adapters (H1/H2 server portions) | Review limits/attribution, expose routes, map integration |
| History/compare | History/Compare UI and export controls | Historical aggregation/jobs/export implementation (H3/H4) | Notification settings/subscription foundation (N1/N2; no live sends) | Dataset consistency, job/storage review, integration |
| Notifications/release | Evaluator and push delivery (N3, after scientific/alert gates) | Device/accessibility/failure verification | Operations, backup/restore and deployment preparation | End-to-end acceptance, fixes, user-visible release report |

Do not assign two agents ownership of the same files. Split web/server work by directories and named contracts. Serialize shared migration numbering and root dependency changes through the lead. Parallelize pure heat computation separately from guidance policy; unresolved categories must not be invented to unblock UI work.

### Required delegation brief

Every assignment must include: backlog IDs, concrete outcome, owned paths, shared interfaces/dependencies, prohibited edits, acceptance criteria, required checks, and expected return format. Agents must report changed files, validation evidence, unresolved issues, and any contract change requested. They must not revert others’ changes, independently upgrade shared dependencies, or expand product scope.

Use isolated branches/worktrees where supported, or disjoint file ownership in a shared checkout. Never assume worktree isolation exists. Integrate bounded completed changes frequently; avoid large diverging branches. The lead reviews each result, resolves conflicts, runs relevant checks, and updates the status ledger. A delegated agent’s completion message is not acceptance evidence by itself.

### Verification and completion discipline

Use focused unit tests for calculations, units/time semantics, policy boundaries, cache freshness, geographic alert matching, and notification transitions. Use adapter contract tests for malformed, missing, rate-limited, and stale responses. Use integration tests for cache/job coordination and restart behavior; browser tests for critical navigation and independent failure states. Keep live-provider checks bounded and separate from deterministic tests. Browser/device emulation cannot substitute for physical-device results.

Run type checking, production builds, and relevant tests before integrating a wave. Exercise high-value cases: late response from a previous city, a failed chart, a failed provider, local midnight/DST, duplicate alert updates, expired push jobs, and partial historical data. Do not add repetitive tests that only restate implementation.

Maintain statuses: not started, in progress, verified, blocked, or deferred with reason. Continue unrelated authorized work when keys, policy review, or a physical device are unavailable. Never mark blocked features complete or silently remove them. The final report includes delivered scope, exact checks run, device evidence, remaining gaps, operating instructions, and any deployment action still requiring authorization.

## User device matrix

| Device/platform | Required target | Verification notes |
|---|---|---|
| iPhone 17 | Safari and installed Home Screen PWA | Record actual iOS version; installation, push, update flow, touch/layout |
| Google Pixel 9 | Chrome and installed PWA | Record Android/Chrome versions; permissions, push, maps |
| Samsung Galaxy S23 Ultra | Chrome and installed PWA | Samsung Internet is an optional additional check, not yet a requirement |
| Samsung Galaxy S23 | Chrome and installed PWA | Check separately from Ultra; do not assume equivalent layout/performance |
| Three MacBook Airs | Safari | Record macOS/Safari versions and display differences on each available machine |
| Linux | Chrome | Distribution, browser version, and hardware to be recorded during verification |

These are user-supplied devices; versions are unknown. Android Chrome is the stated planning assumption. No further device details are needed until testing is ready. The lead may request short user-assisted checks when physical devices are inaccessible. Test geolocation granted/denied, settings independence, units, saved cities, map interactions, readable charts, service-worker updates, notification permissions and taps, offline/stale display, and Tailscale-dependent page access. Only claim the behaviors actually verified on each device. PWA installation/push/browser availability should be feature-detected on actual versions rather than assumed from device names.

## Product and constraints

ZindyCast — Weather beyond temperature. A US-wide family weather PWA emphasizing outdoor heat stress while supporting rich forecasts, maps, history, and city comparisons. Search must work beyond the reference cities. Consistent interface does not imply identical sensor coverage everywhere.

- React and TypeScript required; Rsbuild and REST selected. TypeScript backend recommended.
- Use an operator-managed deployment host; private HTTPS through Tailscale initially. No accounts or cross-device synchronization.
- Each browser installation has independent preferences, saved locations, and notification settings. Browser storage clearing can remove local preferences.
- Zero paid services. Free registration is acceptable; paid-only capabilities are deferred.
- Fahrenheit, mph, inches by default; metric option. No sun/shade selector.
- Today, Maps, History, Compare, Settings. Readable summary with expansion, responsive multicolumn desktop layout.
- Activities: relaxing outside, walking/light activity (initial selection), strenuous activity. Changing the dashboard selection does not change alert settings.
- Forecast views: 48-hour detail and 7/10/14-day horizons over one consistent source series.
- History: day/month/year, custom ranges, CSV export, station observations and reanalysis clearly distinguished. Seasonal baseline 1991–2020; recent comparison uses the latest ten complete available calendar years.
- Maps: radar, satellite, temperature, wind, official alerts. Air quality and wildfire locations/perimeters included in roadmap. Earthquakes, hurricane-specific tracking, and evacuation information deferred.

## Architecture decisions

One repository containing web app, REST API, and separately supervised background worker. Shared packages contain runtime contracts and pure heat calculations. Provider adapters remain on the server. API and worker share local SQLite storage with bounded write transactions; no Redis, additional database service, or Python application runtime initially.

Recommended libraries: Fastify for REST, TanStack Query for independent browser data requests, Apache ECharts for time-series charts, MapLibre GL JS for maps. PWA uses a manifest and a small service worker, with Workbox if useful. Exact versions and compatibility checks belong to authorized implementation.

Modules: locations, weather, heat, official alerts, environment, maps, history, notifications, operations. Heat calculations accept validated inputs and do not fetch data or send notifications.

Each result carries coordinates, location time zone, valid time/interval, retrieval time, provider/dataset, observed/modeled/derived classification, units, freshness, missing-data reason, and calculation version where applicable. Preserve source issue time when supplied; retrieval is not source freshness. Use consistent internal units and UTC instants, with local time zones for calendar views. Preserve source-specific accumulation periods and time semantics.

REST resources separate current conditions, forecast, heat, alerts, air quality, map catalog, history, comparison jobs, and installation settings. Independent resources reuse common cached upstream responses. Long jobs expose progress, cancellation, and results. Every response remains tied to its requested location.

Persistent storage holds installations, credentials, subscriptions, preferences, jobs, and bounded delivery history. Separate disposable cache holds provider responses, historical chunks, calculated results, and comparison summaries. Cache keys include source, dataset, coordinates/grid identity, interval, variables, and calculation version as relevant. Cross-process refresh coordination prevents API/worker duplication. Cleanup budgets actual database and WAL disk usage, not just live rows.

## Provider decisions and evidence

| Responsibility | Candidate/decision | Status |
|---|---|---|
| Forecast and modeled conditions | Open-Meteo | Selected foundation; sample availability checked |
| Ordinary wet-bulb | Open-Meteo field, definition checked against chosen metric | Field confirmed; method review pending |
| Estimated outdoor WBGT | Liljegren reference method, backend implementation | Selected target; numerical validation pending |
| Official alerts/current station discovery | NWS | Selected; point lookups checked |
| Seasonal history | Open-Meteo ERA5 | Selected; one historical day sampled |
| Station history | NOAA GHCNh hourly and GHCN-Daily | Selected dataset families; station audit pending |
| Air quality | AirNow observations plus clearly labeled modeled coverage | Free account/access verification pending |
| Radar/satellite | NOAA nowCOAST | Live WMS catalogs checked; visual testing pending |
| Alternative radar | RainViewer past radar | Optional fallback; no assumed nowcast/satellite entitlement |
| Temperature/wind maps | OpenWeather Maps 1.0 | Free entitlement documented; authenticated checks pending |
| Background map | OSM standard tiles for small private use, subject to policy | Proposed initial option; attribution/caching policy required |
| Wildfire | NIFC public incident/perimeter layers | Dataset candidate; schema/timestamp audit pending |
| City search | Open-Meteo geocoding | Reference locations found |

OpenWeather Maps 1.0 documents temperature and wind tile layers. Its free plan is distinct from One Call pay-as-you-call and paid Maps 2.0. Do not activate billable plans. Free basemap service is best-effort; no bulk downloading or offline map prefetch. Map frames must retain independent timelines; never relabel an old frame as current to match another layer.

Live audit on September 10: Roseville CA (Placer), St. George UT, Anthem AZ, Deltona FL, Lee’s Summit MO, Austin TX, Los Angeles CA, San Francisco CA, Monroe NY (Orange), Seattle WA, Camas WA (Clark), plus Anchorage AK and Honolulu HI. All returned 336 forecast hours with temperature, humidity, surface pressure, 10 m wind, shortwave/direct/diffuse radiation, and ordinary wet-bulb populated. All returned 24 populated hours for ERA5 on July 15, 2020. NWS point lookups returned forecast and station links for all. This is availability evidence, not accuracy validation or exhaustive coverage. Geocoding produced ambiguous Roseville and Camas matches; display county/state and persist coordinates.

Live nowCOAST catalogs advertised time-enabled CONUS, Alaska, and Hawaii radar layers and GOES visible, infrared, and water-vapor imagery. Catalog access does not establish actual image content, radar coverage, browser compatibility, or phone performance.

## Heat-policy research decision

Do not use one wet-bulb “danger limit,” conflate ordinary wet-bulb with natural wet-bulb inside WBGT, or present exposure countdowns. Estimated WBGT is a numerical environmental metric; guidance is a separate versioned policy.

Liljegren is supported by an original paper and OSHA’s calculator. OSHA’s manual includes redistribution conditions for the Argonne reference utility. Review the complete license and retain notices before adapting code. Prefer available radiation inputs over an unconditional clear-sky assumption. Account for wind height and radiation interval semantics; Open-Meteo radiation can represent the preceding-hour average.

Published regional athletic categories are not universal family thresholds. The regional research addresses low-risk acclimatized individuals in the contiguous US; do not automatically extrapolate it to all family members or Alaska/Hawaii. NIOSH occupational guidance also depends on workload, acclimatization, and other assumptions.

Required before releasing categorical heat alerts: select and document the category framework, population/context, numeric boundaries, regional handling, activity interpretation, uncertainty wording, and source/version. No arbitrary developer-selected thresholds. Until this policy is resolved, numerical heat displays can be developed only after DEVELOP, but automatic categorical heat notifications remain disabled. General educational guidance may be drafted from published sources without claiming individualized safety.

## Prioritized backlog

Priority is execution order, not removal of scope. All implementation items below await DEVELOP.

### P0 — close research dependencies

**R1 Heat-policy decision record.** Separate environmental intensity, activity advice, and personal custom thresholds. Acceptance: sourced, complete boundary table with assumptions and regional scope; no safe-time claims; no claims of official endorsement. Pending.

**R2 WBGT reference audit.** Inspect full license, formula/input conventions, convergence behavior, natural versus ordinary wet-bulb, and radiation/wind alignment. Acceptance: documented implementation target and independent reference cases spanning dry/humid heat, night, low wind, altitude, and transitions. No implementation yet.

**R3 Free-account checks.** Verify OpenWeather Maps 1.0 and AirNow access after user registration. Acceptance: usable free endpoints, attribution, limits, response examples, and no billable subscription. Keys must stay out of chat and source control; use a secure configuration mechanism during authorized setup.

**R4 Map content audit.** Inspect actual NOAA images, legends, missing-data behavior, regional bounds, time dimensions, and CORS/proxy requirements. Acceptance: correct radar/satellite interpretation across reference regions; gaps distinguished from no precipitation. Visual phone performance deferred to implementation.

**R5 Station history audit.** Rank candidate stations using distance, elevation, requested-variable completeness, quality flags, and period of record. Use HOMR metadata where relevant. Acceptance: explain station selection and alternatives, preserve source flags, and never silently splice different stations into a continuous record. No universal nearest-station assumption.

**R6 Wildfire and basemap audit.** Verify incident/perimeter identifiers, updates, timestamps, no-data semantics, attribution, and basemap usage. Acceptance: fire perimeter is never labeled evacuation area; no paid dependencies.

### P1 — application foundation and core weather

**F1 Workspace and deployment skeleton.** React/TS/Rsbuild web app, Fastify API, worker entry point, shared contracts, configuration validation. Acceptance: documented local/deployment host operation; secrets excluded; independent process health. Inspect the deployment host only when this work is authorized.

**F2 Locations and device preferences.** Search, permission-based location, saved places, units. Acceptance: ambiguous cities distinguished; denial has manual fallback; installations independent; Arizona/Hawaii/DST behavior correct.

**F3 Provider adapters and bounded caching.** Open-Meteo and NWS adapters; runtime validation, timeouts, coordinated refresh, rate budgets, source timestamps. Acceptance: malformed/limited/unavailable providers handled; concurrent requests do not duplicate refresh; cache cannot grow indefinitely.

**F4 Dashboard and forecast.** Current summary, prominent feels-like, 48-hour chart, daily 7/10/14 views, expandable detail. Include precipitation probability/amount, wind/gusts/direction, humidity/dew point, pressure, cloud cover, visibility, UV, sunrise/sunset where available. Acceptance: one source timeline; unavailable variables clear; chart and request failures isolated; no old-city response contamination.

**F5 Heat implementation.** Implement validated reference method and approved guidance policy, shared across API/worker/history. Acceptance: justified numerical tolerances; unit and time alignment; nonconvergence/missing inputs explicit; activity does not change WBGT or notification settings.

**F6 PWA and accessibility.** Installable shell, update flow, responsive layouts, keyboard access, text alternatives for charts and colors. Acceptance: installed iPhone/Android/desktop checks; service worker cannot silently serve weather as fresh; UI update cannot discard settings.

### P2 — maps and environmental information

**M1 Map framework.** MapLibre, compliant basemap, legends, attribution, independent layer states, bounded visible-frame loading. Acceptance: layer failure leaves map controls and other sections usable.

**M2 Radar/satellite.** NOAA frames and region selection; infrared default satellite view. Acceptance: observed history clearly distinguished from forecast; source timestamps preserved; actual gaps visible; no unbounded animation prefetch.

**M3 Temperature/wind overlays.** Free Maps 1.0 only after R3. Acceptance: source/timestamp clear; no promise of forecast animation or wind particles absent verified support; no paid fallback.

**M4 Official alerts.** NWS geographic filtering, polygons/zones, updates/cancellations/expiration. Acceptance: alerts lacking polygons still handled through supported geographic associations; official text identified; expired/cancelled alerts removed appropriately.

**M5 Air quality/wildfire.** Source-separated observations/model AQI, incident/perimeter layers. Acceptance: reporting-area data not presented as a sensor at user coordinates; update ages and missing coverage visible.

### P3 — history and comparisons

**H1 Reanalysis browsing.** Date/day/month/year/custom range, chunked retrieval. Acceptance: units/time zones correct; missing hours visible; size limits clear.

**H2 Station observations.** GHCNh and daily summaries, metadata and quality flags. Acceptance: accumulation periods respected; station changes explicit; observations not merged invisibly with modeled values.

**H3 Seasonal comparison jobs.** Multiple cities, 1991–2020 and recent decade, custom period, distributions, warm nights/humid conditions, and heat exposure measures supported by approved definitions. Acceptance: consistent dataset/method/time range; completeness shown; cancellation and resume/retry behavior; no apparent improvement caused by missing data.

**H4 Exports.** CSV with source/dataset, coordinates/station, units, time context, quality/missingness and calculation version. Acceptance: export matches displayed selection; safe handling of spreadsheet-interpreted text; bounded generation.

### P4 — background notifications

**N1 Installation registration.** Per-installation credential and push subscription without accounts. Acceptance: one installation cannot read/edit another’s settings; subscription can be deleted; revoked endpoints cleaned up.

**N2 Preferences.** Category switches, monitored saved places, separate activity choice, custom thresholds, lead time, morning outlook, quiet hours, urgent-official-warning exception initially enabled. Acceptance: distinguish browser permission from app category settings; no background live-location tracking assumed. Quiet-hours time-zone policy explicitly selected and displayed before release.

**N3 Evaluation and delivery.** Freshness checks, condition transitions, duplicate suppression, retry/expiration, recovery after restart. Acceptance: stale inputs cannot trigger new calculated alerts; no outdated backlog after outage; policy changes tracked; best-effort delivery described honestly. Job/delivery design acknowledges crash windows rather than promising exactly-once push.

**N4 Device verification.** Actual installed iOS, Android, desktop tests. Acceptance: permission rejection, quiet hours, taps, expired subscriptions, offline devices, and Tailscale reachability covered. App must explain when opening notification details needs tailnet connectivity.

### P5 — family release readiness

Restore persistent backup, verify cache limits, exercise provider outage/rate-limit cases, test DST and local midnight, check default privacy and logs, verify source attribution, document update/recovery procedures, and run a family usability review. Public hosting is a separate later milestone requiring access/rate/licensing review.

## Dependencies and completion rule

P0 informs implementation; P1 precedes maps/history; notifications follow validated heat and official alert behavior. Account-dependent layers may remain deferred without blocking core weather. Do not label the project fully complete while required features are deferred. Scientific policy is a release gate for heat categories and notifications, not something to conceal with a default threshold.

## Sources

- [Open-Meteo forecast](https://open-meteo.com/en/docs), [pricing](https://open-meteo.com/en/pricing), [historical dataset distinctions](https://open-meteo.com/en/docs/historical-forecast-api), [geocoding](https://open-meteo.com/en/docs/geocoding-api).
- [NWS API](https://www.weather.gov/documentation/services-web-api), [NOAA nowCOAST](https://nowcoast.noaa.gov/).
- [OpenWeather free-plan matrix](https://openweathermap.org/full-price), [official temperature/wind tile examples](https://openweathermap.org/themes/openweathermap/assets/docs/Using_OpenWeatherMap_Weather_Tiles_with_Leaflet.pdf).
- [OSHA WBGT calculator](https://www.osha.gov/heat-exposure/wbgt-calculator), [reference utility license and technical manual](https://www.osha.gov/otm/section-3-health-hazards/chapter-4), [Liljegren paper](https://pubmed.ncbi.nlm.nih.gov/18668404/).
- [NIOSH heat criteria](https://www.cdc.gov/niosh/publications/numbered/2016-106.html), [regional athletics research](https://www.sciencedirect.com/science/article/abs/pii/S0143622814002513), [NWS regional category example](https://www.weather.gov/media/aly/FactSheets/WBGT.pdf).
- [GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly), [station metadata](https://www.ncei.noaa.gov/access/homr/reports), [GHCN-Daily documentation](https://www.ncei.noaa.gov/pub/data/cdo/documentation/GHCND_documentation.pdf).
- [AirNow FAQ](https://docs.airnowapi.org/faq), [NIFC maps](https://www.nifc.gov/fire-information/maps), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Current status

Architecture and prioritized backlog recorded. Live sample availability audit completed in the conversation. Category policy, numerical verification, authenticated provider checks, full historical completeness, and actual map/device behavior are not yet verified. No application code, installations, registrations, subscriptions, or deployment host changes performed.
