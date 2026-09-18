# Browser verification: History, Compare and settings

September 11, 2026, approximately 01:12–01:16 UTC. Actual private Ponderosa browser at `http://127.0.0.1:4311/`, disposable profile, 1280×720 viewport. This is browser interaction evidence, not a physical-device, private HTTPS, or fixture test. Initial profile had no location, saved cities or registration. No application, service, database, deployment or configuration files were changed by this task. Only this document is owned/edited.

Read the implementation plan, foundation, original complete pasted plan, and relevant UI/provider code. A new app-update prompt appeared after reload, so this run spans a concurrently changing preview; it is not evidence for a single frozen release. No update button was activated.

## Results

| Function | Result | Browser evidence / reproduction |
|---|---|---|
| Empty History | Pass | Click History before selecting a city. City prompt appears and Load is disabled. Source and UTC semantics are explicit. |
| City search | Pass | Search Austin; results distinguish Travis/Texas from Mower/Minnesota and others, with coordinates and timezone. Select Travis/Texas (`30.26715,-97.74306`). |
| Keep History context on city selection | Usability issue | Selection immediately navigates to Today, starts forecast and NWS requests, and requires another History click. `select()` in `apps/web/src/index.tsx` calls `setTab('Today')`. Saving is available only from Today. This adds navigation and unrelated provider work to History/Compare setup. |
| Reanalysis day | Pass | Select Day; enter `2020-07-15`; Load. Actual service result: 24/24 expected hours with all five fields and zero missing source hours. Requested ERA5 model, source grid `30.25,-97.75`, elevation157m and retrieval `2026-09-11T01:13:37.412Z` displayed in provenance. First hour 104°F,25% humidity,0.00in,14mph,61°F dew point. This verifies availability/rendering, not independent accuracy. |
| Reanalysis month | Pass | Select Month. Default September2026 is disabled because it exceeds latest available September6. Change to August2026; Load. Result dates August1–31 and744/744 hours, with chart, missingness counts and table. |
| Changed-input result identity | Pass | Changing Day→Month or Month→Custom preserves previous result with explicit requested dates and “Inputs changed” notice. CSV explicitly stays associated with displayed result. |
| Custom range limit | Pass | Select Custom; start August6/end September6 (32inclusive days), then July6/end September6. Both disable Load and show allowed1–31day range. No request submitted for invalid selections. Reversed custom dates and valid custom retrieval were not separately exercised. |
| Native date entry | Tool limitation resolved | Generic `fill` with ISO date left native control empty temporarily; this was not counted as an app failure. Clicking date and using month/day/year arrow navigation plus individual digit keys worked. Entered year2020 using digits2,0,2,0; inspected actual resulting date before submitting. |
| Reanalysis CSV | Partial | Click “Download CSV for displayed UTC selection” after the successful day. Button changes to “Preparing CSV…” then back, with no visible error. Browser capability exposes no downloads list/content, so saved filename, bytes, rows and CSV parsing were not verified. No direct API request substituted for browser download evidence. |
| Station source / ID | Pass | Choose “Station daily summaries · explicit station ID.” No station automatically selected. Explicit ID `USW00013904` comes from preserved station research, not a nearest-station claim. ID field was also entered with malformed text before replacement; no invalid request submitted, but disabled state was not retained as standalone evidence. |
| Station daily result | Pass | Enter `USW00013904`, September11,2020 for both source dates; Load. Result1/1 dates with all three blank-QC values. TMAX85°F (raw294 tenths°C), TMIN64°F (raw178), PRCP0.00in(raw0), source flagW. Retrieval `2026-09-11T01:15:20.530Z`. Coverage table distinguishes missing/flag categories. Metadata and observation intervals explicitly unavailable. No independent source-value audit claimed. |
| Station CSV/hourly/metadata | Unavailable feature | UI explicitly states station CSV, hourly data and WBGT unavailable. No station name/coordinate/elevation metadata or discovery/ranking UI. These are product gaps, not successful tests. |
| Compare minimum selection | Pass | With only saved Austin, Compare shows its coordinates and requires2–5distinct places. Checking Austin leaves Create comparison disabled with explanatory text. |
| Compare registration / completion / cancellation / CSV | Not exercised | Fresh profile plus six-new-call constraint prevented safely setting up another city and running the two-city worker after live History tests. No registration or comparison job created. These workflows remain browser acceptance gaps; mocked worker tests do not substitute. |
| Baselines / distributions | Unavailable feature | Compare accurately labels1991–2020, recent-decade comparisons and distributions forthcoming. Custom mode is1–366days with closing-rain allowance throughSeptember5,2026. No baseline functionality claimed. |
| Save / persist / remove | Pass | Save Austin on Today. Settings lists it. Actual page reload retains selected Austin and saved state. Settings Remove clears saved chip/list and shows empty explanation. |
| Unit persistence | Pass | Click header°C in Settings, reload page, return Settings. Inspection of `.units button[aria-pressed=true]` returns°C. Removal of saved city does not prevent remaining Settings controls. |
| Notifications | Unavailable feature | Settings explains notifications are not available; no subscription/permission/send action performed. |

## Budget and environment limits

The planned conservative allocation was search1 + forecast1 + alerts1 + reanalysis day1 + reanalysis month1 + station1 =6potential new provider calls. History CSV reuses the just-loaded day cache. Actual upstream request counts were not instrumented, and some initial requests may have hit shared cache.

Reload for preference persistence automatically returned Today and showed a newer NWS retrieval time (01:15 versus01:12). The route has a60second fresh-cache TTL, so this may have added a seventh provider request despite the intended six-call limit. This was reported to the lead immediately; no further provider-capable browser actions were performed. Do not cite this run as measured compliance with≤6new calls. Future bounded testing needs cache-aware accounting and allowance for automatic tab/reload/focus requests.

Snapshots can inspect named regions including offscreen table content; that does not establish visual layout of every row. Settings screenshot captured as Project artifact `ponderosa://artifact/ad067416-582a-41ad-a67d-2b31fb3cdbef` at1280×720; it was not separately pixel-reviewed. No mobile resize/emulation, physical-device, offline, failure injection, cross-installation ownership, direct download-file access or browser-console/network trace capability was used. No fixtures injected into live UI. Browser closed after verification to stop automatic refreshes.

## Reviewable next work

1. Preserve the active History/Compare tab when selecting a city and offer Save directly where selection is needed. Coordinate ownership of `apps/web/src/index.tsx` before edits.
2. Complete two-city registration→one historical day→result→CSV and a separate cancellation flow with an explicit budget that includes setup and automatic requests. Freeze deployed assets during the test; record exact upstream totals and downloaded bytes when tooling allows.
3. Reduce up-front explanatory text using compact summaries and expandable source/quality details while preserving scientific distinctions. At this viewport, History form already reaches below the initial fold after saving a city; a month creates744table rows. This agrees with the user's “a lot of reading” concern, though no alternate visual framework was evaluated here.
4. Retain year/long-baseline, station discovery/metadata/hourly/CSV and notifications as open work rather than marking unavailable controls tested successfully.

No typecheck/build/test command was run for this evidence-only edit: build writes currently served assets, and no executable implementation changed. Browser checks above are the validation performed.
