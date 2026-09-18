# Lead research and contract notes

September 10, 2026. Proposed design notes only; no implementation or version selection.

## Verified public documentation

The [Open-Meteo pricing page](https://open-meteo.com/en/pricing), read September 10, lists free noncommercial access without an uptime guarantee, limits of 600 calls/minute, 5,000/hour, 10,000/day and 300,000/month, and attribution requirements. Requests exceeding ten variables or two weeks can count as multiple calls. Historical Weather is listed as available through free open access. Service access conditions and data licensing are distinct.

Implication (design proposal): maintain a shared provider budget across API and worker, count estimated weighted usage rather than HTTP requests alone, and reserve capacity for current weather before historical jobs. Chunking controls memory/retry size but must not be represented as eliminating usage cost. Pause or queue work when budget is unavailable; no automatic paid fallback. Exact accounting, practical concurrency and cache budgets need implementation-time checks.

The [Historical Weather documentation](https://open-meteo.com/en/docs/historical-weather-api), read September 10, recommends explicitly selecting ERA5 or ERA5-Land for consistency over decades. Its default historical combination can include newer models from 2017.

Implication (design proposal): pin the comparison dataset to ERA5 as selected in the plan. Do not use an automatic model blend across the baseline and recent decade. Record dataset, grid selection, elevation treatment and derivation version with every comparison and export. The candidate recent decade on the planning date is 2016–2025, subject to actual availability/completeness checks; a calendar year ending does not prove dataset completeness.

## Shared contract decisions to reconcile

1. Separate requested location identity from provider grid/station coordinates. Preserve both along with IANA time zone; stale city responses must remain identifiable.
2. Every independent section needs availability state, retrieval time, source issue time when supplied, valid interval, units, provenance and missingness. Retrieval cannot substitute for source issue time.
3. Heat output should independently describe numeric calculation and guidance availability/version. An unresolved category policy must not invalidate a usable numerical metric or become an invented default category. R1/R2 determine precise semantics.
4. Preserve interval semantics for radiation, precipitation and station accumulations. Store unambiguous UTC instants; local calendar grouping must handle DST and date boundaries. R2/R5 determine special cases.
5. Map layers need independent observation times, coverage/no-data semantics, attribution and legends. A transparent image does not by itself establish absence of precipitation. R4/R6 determine provider-specific states.
6. Historical jobs need requested and usable counts, missing/flagged counts, dataset identity, selection method and reproducible ranges. Define completeness rules per measure before ranking cities; never hide missingness behind a score. R5 informs station selection.
7. Credential-dependent providers need explicit unavailable states. Document free-registration instructions only when the next authenticated check is concrete; secrets must not enter chat or source control.

## Evidence standard

Documentation establishes advertised capabilities. Public sample responses establish only the sampled content at retrieval time. Neither proves authenticated entitlement, scientific validity, all-date coverage, installed-PWA performance or physical-device behavior. Final research acceptance requires reviewing the specialist evidence and recording remaining limits in the ledger.

## Integrated R3/R4/R6 findings

Accepted from the [provider/maps audit](providers-maps.md), with saved primary-source evidence:

- Configure fast GOES and global infrared as separate satellite products. Use global infrared for sampled Alaska coverage; preserve its hourly cadence and documented latency rather than implying five-minute updates everywhere.
- Model advertised extent separately from verified coverage. A blank radar overlay must retain unknown-coverage wording unless an authoritative coverage mask establishes more. Legends need explicit quantitative versus explanatory classification.
- NOAA nearest-time warnings may contain the only selected-time correction and are not exposed through sampled browser CORS headers. A backend metadata adapter should preserve warnings and source times. No fabricated exact frame time when selection cannot be resolved.
- OpenWeather tile quotas apply to individual requests; budget visible frame/viewport loading. Keys remain server-side. Actual layer palettes, source times and free account entitlement remain unverified.
- AirNow adapter design must use replacement service documentation, not legacy lat/long URLs scheduled for retirement in fall 2026. Preserve reporting-area identity and preliminary-data labeling. Resolve published onboarding notification requirements before release; no external message authorized or sent.
- Wildfire identity joins should retain normalized and original IRWIN/source IDs. Store polygon capture, polygon edit and incident update separately. Filter or label prescribed fires and complexes explicitly; current-feed disappearance does not mean extinguishment. Empty viewport results mean no matching published records.
- Keep standard OSM tiles out of service-worker offline prefetch. Honor attribution, Referer and cache policy. Browser behavior and provider fallback mechanics remain implementation checks.

## Integrated R1/R2 findings

Accepted source inspection and proposed educational policy from the [heat audit](heat-science.md); category policy and numerical validation remain open.

- Separate estimated WBGT, estimated ordinary wet-bulb and diagnostic natural wet-bulb. The provider's ordinary-wet-bulb helper uses a pressure-independent approximation; deployed field routing/version still needs confirmation. It cannot supply the natural wet-bulb component of WBGT.
- Store metric version independently from guidance-policy version and applicability. Proposed initial guidance is three educational activity messages without categorical safety colors or safe exposure durations. This preserves the unresolved category requirement; it does not remove it from scope.
- Preserve input temporal intervals, solar geometry time, original versus adjusted inputs, wind measurement/reference height, conversion assumptions and component diagnostics. A non-null upstream field does not establish valid model input.
- The audited reference requires more information for wind-height conversion than the prior availability samples provide. Preceding-hour radiation and instantaneous meteorology also need an explicit alignment policy. Do not silently supply global terrain/stability defaults or claim exact temporal alignment.
- Retain the original source notices and document modifications. Mirrored C, desktop utility and wrapper version labels differ; direct provenance remains a research gate.
- The original solar geometry supports 1950–2049. Historical weather outside that range may remain browsable, but this WBGT method must report unsupported date unless a separately validated geometry change is adopted. A synthetic scenario table is a future validation specification, not evidence of numeric correctness.
- Validate each component for sentinels, nonfinite values and nonconvergence. Do not expose uninitialized wind diagnostics or infer psychrometric success from top-level WBGT status. Proposed port tolerances must be justified by independent reference runs after DEVELOP.

## Integrated R5 findings

Accepted the reproducible bounded evidence in the [station-history audit](station-history.md). All 13 city priorities remain provisional; five complete daily files and five January hourly prefixes do not establish nationwide station eligibility.

- Preserve requested coordinates separately from station coordinates and dated metadata epochs. Unknown city elevation and conflicting catalog/HOMR positions require explicit status; do not substitute zero elevation difference or infer a relocation date. Selection records need purpose, search radius, alternatives, evidence tier and policy version.
- Classify provenance per variable. GHCNh RH and wet-bulb can be derived even within an observations dataset. Retain raw and decoded measurement/source/QC flags; daily blank-QFLAG rules cannot be reused for hourly numeric codes.
- Keep daily calendar dates as dates when observation times are unknown. Store known observation/accumulation intervals, trace rainfall and overlapping/running-total semantics. Multiple hourly reports must not inflate coverage or double-count precipitation.
- Include expected and accepted counts per variable and jointly, by month/year, with longest gaps and a cadence rule. Inventory endpoints are screening evidence only. The proposed complete-input rule for full-calendar aggregates remains a policy proposal; partial results must show their denominators.
- Freeze one common comparison window across all selected cities/variables. The candidate recent period is 2016–2025, subject to eligibility; do not silently shift only one city's decade or discard sparse years. Keep fixed ERA5 selection, time/calendar conventions and coverage policy in job/cache/export definitions.
- Never silently splice station IDs, substitute daily averages for hourly heat distributions, or fill observation-only WBGT inputs with modeled radiation. A hybrid derived product requires its own explicit method and validation.

These are planning requirements for future shared schemas, not implemented contracts. R5 remains open for canonical coordinates/elevations, unsampled alternatives, full seasonal/hourly coverage, observation-time histories and metadata conflict resolution.

## Second-round refinements

The follow-up reports refine earlier proposals without approving numerical heat policy or closing coverage gates:

- Prefer identical UTC instant meteorology and provider instant GHI with reference `avg=0` as the candidate temporal method. Preserve the backward radiation interval and geometry-derived transformation: the instant field is not an independent observation. Missing instant radiation must not silently fall back to an hourly mean. Wind conversion over short grass is a separately versioned candidate needing comparison and acceptance after DEVELOP.
- Record requested ERA5 selection separately from known constituent provenance. Pinned source includes a lower-priority ensemble reader and generic missing-value fallback. This is not evidence fallback occurred in the samples, but prevents asserting deterministic-only per-value provenance without further verification.
- Keep radar request success, frame age, advertised extent, coverage evidence and visible return independent. Accept persistent unknown-coverage wording as a limited-mode design. Native flags require a verified product/time/grid transformation before use; site status and transparent pixels cannot define coverage polygons.
- Separate presence/QC-screen counts from final measurement eligibility. In particular, presumed-zero precipitation must retain its measurement status even with blank QFLAG. Joint calendar-date counts do not establish matching physical accumulation intervals.
- Preserve observation schedules by element/program separately from actual observation times and date-label conventions. HOMR corrections can explain catalog conflicts without supplying a verified relocation date. A constant station identifier or schedule does not prove a homogeneous climate record.
- Retain one station and common period for station change comparisons. Better baseline data at one station and better recent data at another must remain separately labeled descriptive series. Updated station audit priorities are research queues, not automatic selections.
