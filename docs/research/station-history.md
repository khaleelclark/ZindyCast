# R5 — station history audit

Research only, audited September 10, 2026. No application development, dependency installation, account work, infrastructure changes, or deployment host access. The full implementation plan was read. Its existing 13-city forecast/ERA5/NWS availability evidence is preserved and is **not** treated as station-completeness evidence.

**Outcome: NOAA access and representative records verified; nationwide selection and homogeneous climate records remain unverified.** Nine daily station files and five bounded hourly samples were parsed across the initial audit and bounded follow-up. The follow-up adds monthly/yearly and joint core-variable counts for all nine daily stations and three targeted HOMR histories. All 13 reference cities have metadata candidate lists and provisional priorities below. Do not make these priorities automatic defaults yet: city elevation, hourly period coverage, and most station histories still need verification.

## Evidence and reproducibility

[Evidence index](history/README.md), [candidate metadata](history/candidates.json), [daily counts](history/daily-summary.json), [hourly counts and raw example rows](history/hourly-summary.json), and [St. George HOMR response](history/homr-st-george.json) accompany this report. Download manifests include exact URLs, timestamps, HTTP status, requested byte ranges, errors, and sizes. Offline scripts reproduce the counts and daily metadata screening. Global metadata downloads were reduced to stations within 75 km of the research centers; raw observation files remain unchanged.

The 13 centers in `candidates.json` are explicitly approximate research coordinates chosen for the named cities, **not** the exact coordinates from the plan's prior geocoding audit or saved app locations. Distances use great-circle distance with Earth radius 6,371 km. City elevation was not supplied or measured: station elevation is available, but a numeric city–station elevation difference is **unknown**, not zero. Recompute priorities when canonical coordinates/elevation are available. County labels disambiguate Roseville, Monroe, and Camas.

## Reproducible selection policy proposed for H2/H3

1. Fix requested variables, date range, calendar/time basis, and analysis purpose before looking for a station. Daily temperature/rain history and hourly humid-heat analysis require different eligibility checks.
2. Search within 25 km, then 50/75 km with an explicit widening reason; retain alternatives. A radius is an operational search bound, not a scientific representativeness guarantee. Filter inventory by variable and requested period before ranking distance. Pre-1991 start and post-2025 end are only screening criteria.
3. Retrieve candidate station-year/period files and HOMR history. Count expected valid dates or unique scheduled observation slots, nonmissing values, QC-acceptable values, longest gaps, and joint availability of every input to a derived metric. Evaluate each month/year as well as the total; inventory endpoints and raw row counts cannot establish this.
4. Establish separate eligibility tiers: audited requested-period coverage; incomplete audited coverage; inventory-only candidate; rejected for required period/variables. Within a tier, prefer appropriate terrain/coastal exposure, known elevation agreement, fewer metadata discontinuities, better joint coverage/flags, then shorter distance. Do not invent a weighted score for unknown criteria. Record tie-breaks, reason codes, and alternatives.
5. Proposed conservative initial publication rule: strict full-calendar aggregates require all expected valid inputs; otherwise show a partial descriptive result with its denominator and missingness, not a complete total. This is a product proposal, not a NOAA climatological-normal standard. A less strict scientific eligibility policy requires an explicit versioned decision, especially for percentiles and heat exceedances. Do not extrapolate counts from observed hours to an entire season.
6. One selected station identifier does not prove one homogeneous observing site. Preserve dated relocations/instrument/reporting changes. A user-selected alternative starts a separate series; never silently splice, backfill from another station, or fill observations with ERA5. An explicit composite would need a separate reviewed product and provenance contract.

## Provisional city priorities

The daily sequence is a **review priority**, incorporating endpoint coverage, proximity, station elevation, and available sample evidence. Parentheses give distance km / station elevation m; year spans are **TMAX inventory endpoints**, not completeness or uniform exposure. Hourly choices are metadata candidates except the five marked **sampled**. Raw nearest-five hourly lists, including historical/unsuitable stations, remain in the evidence so the prioritization can be inspected. None is verified for a complete 1991–2020 hourly baseline.

| Reference city | Daily priorities and alternatives | Hourly review priority / limitation |
|---|---|---|
| Roseville CA, Placer | Baseline audited priority: Sacramento 5 ESE `USW00023271` (24.6/11.6; 1877–2025), nearly complete baseline but missing recent tail. Next shared-window audit: Sacramento AP `USW00023232` (32.7/5.8; 1941–2026). Auburn `USC00040383` is equally close (24.7/393.8) but needs terrain/elevation review. | McClellan `USW00023208` (13.6/23.5 hourly catalog), then Mather `USW00023206`. Daily catalog gives McClellan elevation 25.0 m: retain dataset distinction. Nearby Citrus Heights/Rocklin daily records do not pass the baseline/recent endpoint screen. |
| St. George UT | 1 St. George COOP `USC00427516` (2.6/870.8; 1893–2026), **daily audited and incomplete**; 2 La Verkin `USC00424968` (30.0/973.5; 1950–2026), unaudited. | Municipal airport `USW00023186` **sampled**; catalog coordinate is 1.5 km away but disagrees with dated HOMR position. Resolve before ranking. `USW00093198` is a separate historical field (1948–1954 daily); 2020 hourly URL returns 404. |
| Anthem AZ | Baseline candidates: 1 Carefree `USC00021282` (23.3/771.1; 1962–2026), now audited and incomplete with substantial baseline QC failures; next audit Youngtown `USC00029634` (33.5/345.9; 1964–2026). **Recent daily**: Deer Valley `USW00003184` (21.0/453.2; 1998–2026), audited, cannot cover full baseline. | Deer Valley **sampled**, then Scottsdale `USW00003192` (35.1/436.2). Terrain/elevation differ substantially among surrounding candidates; no verified city elevation match. |
| Deltona FL | Baseline audited priority: Sanford COOP `USC00087982` (9.6/3.7; 1956–2026), stronger coverage than airport but incomplete; next audit DeLand `USC00082229` (12.6/7.6; 1892–2026). Recent: Sanford airport `USW00012854` (13.6/14.9), audited full recent TMAX/TMIN/PRCP but poor baseline coverage. | Sanford airport **sampled**, then DeLand municipal `USW00000299`. Do not confuse daily DeLand coordinates/name with the hourly catalog's DeLand 3 NE position (18.6 km). |
| Lee's Summit MO | Baseline queue: Kansas City downtown `USW00013988` (30.0/226.2; 1934–2026), ELM `USC00232568` (30.4/259.1; 1989–2025). Nearby Reed WR `USC00234850` ends TMAX in 2023. | Lee's Summit municipal `USW00053879` (5.3/304.8); daily TMAX starts 2002, so a convenient recent station is not a baseline replacement. |
| Austin TX | 1 Camp Mabry `USW00013958` (6.2/204.2; 1938–2026); 2 Bergstrom `USW00013904` (11.1/146.6; 1948–2026). | Same two candidates; audit station history and requested variables before claiming airport/urban equivalence. |
| Los Angeles CA | 1 Downtown/USC `USW00093134` (5.4/54.6; 1906–2026); 2 Pasadena `USC00046719` (14.1/263.3; 1893–2026), requiring elevation/exposure review. | Downtown/USC, then LAX `USW00023174` (18.3/29.6 in hourly catalog; daily 18.3/29.6); hourly variable coverage unverified. Coastal versus inland representativeness must be explicit. |
| San Francisco CA | 1 Downtown `USW00023272` (0.8/45.7; 1921–2026); 2 Oceanside `USC00047767` (9.2/2.4; 1958–2026), a different coastal exposure. | SFO `USW00023234` (17.9/3.0), with downtown as a variable-coverage audit candidate. Airport observations must not be labeled observations at the city center. |
| Monroe NY, Orange | 1 West Point `USC00309292` (20.0/97.5; 1890–2025); 2 Shrub Oak `USC00307742` (29.2/140.8; 1950–2026). Geography/terrain require review. | Montgomery/Orange County `USW00004789` (20.9/108.2), then Stewart `USW00014714` (20.2/177.1). Bear Mountain `USW00014797` is nearer but historical daily TMAX ends 1953. |
| Seattle WA | Baseline audit queue: Sand Point WFO `USW00094290` (10.7/18.3; 1986–2026), then SeaTac `USW00024233` (18.0/112.5; 1948–2026), both unaudited. Boeing Field `USW00024234` (6.9/7.6; 1948–2026) is now audited: large baseline gap, incomplete recent coverage; retain for recent descriptive history. | Boeing Field then SeaTac. The closest catalog entry, `USL000EBSW1`, has no verified required-variable/period coverage in this audit. |
| Camas WA, Clark | 1 Troutdale COOP `USC00358634` (3.8/10.1; 1948–2026); 2 Portland Intl `USW00024229` (16.3/6.7; 1938–2026). | Troutdale airport `USW00024242` (4.1/7.6), then Portland Intl. Troutdale airport daily TMAX starts 1998; nearby Oregon stations are legitimate alternatives but river/gorge exposure must be considered. |
| Anchorage AK | **Audited priority:** Ted Stevens `USW00026451` (8.7/38.1; 1952–2026). Closer alternative Merrill Field `USW00026409` (2.3/38.4; 1916–2026) could outrank it after equivalent coverage audit. | Ted Stevens **sampled**, Merrill Field candidate. Maritime/terrain effects and winter observation behavior remain relevant. |
| Honolulu HI | **Audited priority:** Honolulu Intl `USW00022521` (8.6/1.8; TMAX 1940–2026). Manoa Lyon Arboretum `USC00516128` (6.3/152.4; 1975–2026) is closer but a different elevation/exposure; keep separate. | Honolulu Intl **sampled**; Hickam `USI0000PHIK` (7.1/4.0) alternative. Nearby Honolulu substation `USW00022522` daily TMAX ends 1976. |

The complete raw endpoint evidence is [GHCN-Daily inventory subset](history/ghcnd-inventory-subset.txt); names/coordinates/elevations come from NOAA's [daily station list](https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt) and [hourly station list](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.csv). This is a finite candidate audit, not proof that no better station exists outside the search radius.

## Actual daily coverage and flags

All counts below are nonmissing values with **blank daily QFLAG**, counted against every valid calendar date. Blank means no failed QC check recorded, not certainty of accuracy. Baseline denominator is **10,958 days**; recent 2016–2025 denominator **3,653 days**. Missing days include absent months/elements; invalid month-end slots are excluded. Counts do not imply homogeneous instruments or comparable observation days.

| Station | 1991–2020 TMAX / TMIN / PRCP | 2016–2025 TMAX / TMIN / PRCP | Other finding |
|---|---:|---:|---|
| St. George COOP | 9,643 / 9,663 / 9,914 | 3,648 / 3,648 / 3,649 | No AWND/ADPT/RHAV/AWBT values in either window. Baseline TMAX also has 41 `I` and 4 `S` flagged values, excluded here. |
| Deer Valley | 8,103 / 8,092 / 8,141 | 3,626 / 3,614 / 3,631 | First nonmissing date 1998-09-01. No daily ADPT/RHAV/AWBT in either window. |
| Sanford airport | 7,969 / 7,968 / 7,977 | 3,653 / 3,653 / 3,653 | Long inventory endpoint span conceals baseline missingness; recent AWND 3,647. No daily ADPT/RHAV/AWBT. |
| Anchorage Ted Stevens | 10,957 / 10,958 / 10,958 | 3,653 / 3,653 / 3,653 | Baseline TMAX has one `I` flag excluded. Daily ADPT only 5,403 baseline / 3,240 recent days. |
| Honolulu Intl | 10,941 / 10,938 / 10,958 | 3,651 / 3,648 / 3,651 | Daily ADPT only 5,405 baseline / 3,215 recent days. |

Actual July 15, 2020 examples after documented unit conversion: St. George TMAX 40.6°C/TMIN 20.0°C, source `7`; Deer Valley 41.1°C/29.4°C, source `W`; Sanford rain 5.8 mm, source `W`. Anchorage and Honolulu both report PRCP raw zero with measurement flag **T (trace)**, not an ordinary measured zero. All these example QFLAGs are blank. Each of the five stations has 31 unflagged TMAX/TMIN/PRCP days in July 2020, which does not repair its other gaps.

GHCN-Daily preserves distinct measurement, QC, and source flags; `-9999` means missing. Retain them in display details and exports. Do not map all source-derived daily averages to the same definition: daily `TAVG` is not necessarily `(TMAX+TMIN)/2` (`TAXN`). Some source summaries use UTC days rather than local observation days. See the [NOAA daily format/readme](https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt) and [retained copy](history/ghcnd-readme.txt).

## Bounded daily follow-up: monthly and joint coverage

The four additional complete NOAA files total 5,864,400 bytes: [Sanford COOP](history/USC00087982.dly), [Carefree](history/USC00021282.dly), [Sacramento 5 ESE](history/USW00023271.dly), and [Boeing Field](history/USW00024234.dly). The [new download manifest](history/followup-downloads.json) records exact GET URLs, HTTP 200 responses, sizes, headers and hashes. Boeing Field was selected as Seattle's previously first-priority candidate; no fifth alternative was downloaded.

| New station | 1991–2020 TMAX / TMIN / PRCP | 2016–2025 TMAX / TMIN / PRCP |
|---|---:|---:|
| Sanford COOP `USC00087982` | 10,670 / 10,471 / 10,842 | 3,539 / 3,563 / 3,599 |
| Carefree `USC00021282` | 9,620 / 10,212 / 10,371 | 3,327 / 3,295 / 3,343 |
| Sacramento 5 ESE `USW00023271` | 10,953 / 10,954 / 10,957 | 3,406 / 3,406 / 3,408 |
| Boeing Field `USW00024234` | 8,021 / 8,023 / 8,035 | 3,615 / 3,614 / 3,629 |

[Version 2 daily coverage](history/daily-coverage-v2.json) includes every individual calendar month and year in both windows for all nine stations, including entirely absent months. Each has expected, present, blank-QFLAG, rejected-QC and missing counts per variable, original flag frequencies, joint blank-QFLAG dates, and longest joint gap with dates. Baseline/recent overlap is intentional; do not add them together.

| Station | Joint baseline / 10,958 | Joint recent / 3,653 | Fully joint-covered years baseline / recent | Longest joint gap days baseline / recent |
|---|---:|---:|---:|---:|
| St. George COOP | 9,423 | 3,647 | 5 / 8 | 475 / 4 |
| Deer Valley | 8,079 | 3,590 | 7 / 1 | 2,800 / 21 |
| Sanford airport | 7,966 | 3,653 | 12 / 10 | 2,971 / 0 |
| Anchorage Ted Stevens | 10,957 | 3,653 | 29 / 10 | 1 / 0 |
| Honolulu Intl | 10,938 | 3,648 | 27 / 7 | 17 / 2 |
| Sanford COOP | 10,374 | 3,479 | 3 / 0 | 34 / 34 |
| Carefree | 9,548 | 3,260 | 0 / 0 | 31 / 31 |
| Sacramento 5 ESE | 10,952 | 3,405 | 27 / 6 | 2 / 214 |
| Boeing Field | 8,001 | 3,602 | 7 / 0 | 2,895 / 6 |

“Joint” means TMAX, TMIN and PRCP all pass the audit's presence/blank-QFLAG screen on the **same labeled date**, not proof their physical observation intervals match. These are QC-screen counts, not final scientific eligibility. In particular measurement flag `P` means missing presumed zero: baseline PRCP has 2,652 such values at Carefree, 150 at Sanford COOP, and 4,165 at St. George COOP. They remain counted under the stated screen, visibly distinguished in the JSON, and must not be marketed as ordinary measured rainfall. Trace values are also retained separately. A stricter measurement-status policy would lower eligible counts and requires a new policy version. Source and flag definitions: [retained NOAA readme](history/ghcnd-readme.txt).

The monthly breakdown materially changes review priorities:

- **Roseville:** Sacramento 5 ESE remains the strongest *audited baseline* alternative here, with only six joint baseline dates failing the screen. It cannot provide a complete 2016–2025 window: April 2024 has 1/30 joint days, and June–December 2025 have zero joint days. The retained full file's last TMAX/TMIN date is 2025-05-31 and last PRCP date is 2025-06-01; do not infer permanent closure. Audit Sacramento AP next for a common station/window, without splicing it onto the city record.
- **Deltona:** Sanford COOP offers much better baseline joint coverage than the airport (10,374 versus 7,966), but July 2009 has zero joint days and April 2020 only 7/30. Sanford airport remains the audited recent priority (3,653/3,653). These support different descriptive products; switching stations between baseline and recent would confound change comparisons. DeLand remains an unaudited alternative.
- **Anthem:** Carefree's longer record improves temporal reach relative to Deer Valley but does not establish a good baseline. Its baseline TMAX includes 617 `I` failures and one `S`; neither window has a fully joint-covered year. July 2005 and May 2017 have zero joint days. Prioritize Youngtown for the next alternative audit, while retaining the terrain/elevation caveat and Deer Valley's stronger recent coverage.
- **Seattle:** Boeing Field's long endpoints concealed zero joint coverage in 1991–1997 and a 2,895-day initial joint gap. Move Sand Point and SeaTac ahead of it in the **baseline audit queue**, not into verified selection. Boeing has 3,602/3,653 recent joint days but no entirely joint-covered recent year.

Actual July 15, 2020 raw daily examples: Carefree TMAX `417`, TMIN `261`, PRCP `0`, source `7`; Sanford COOP `361`, `250`, `3`, source `7`; Sacramento `361`, `150`, `0`, source `W`; Boeing `278`, `156`, `0`, source `W`. All these examples have blank measurement/QC flags. Temperatures and precipitation are tenths of °C and mm respectively. Carefree's 1991-03-15 TMAX raw slot `  111 I0` is an actual excluded `I` internal-consistency flag; Boeing's 2000-03-20 TMAX `  222 SW` has `S` spatial-consistency failure. Raw files preserve exact slots and v2 JSON preserves period flag frequencies.

## Bounded hourly checks

Requests read bytes 0–262143 of the 2020 station PSV; discard the final partial row. **These are January prefix samples, not complete days, seasonal samples, or annual completeness measurements.** Counts are available values per retained row, not expected hourly slots; multiple reports occur within an hour.

| Station | Rows; UTC first→last | Temperature / pressure / wind / wet-bulb / precipitation nonmissing |
|---|---|---:|
| Deer Valley | 281; Jan 1 00:53→Jan 12 12:53 | 281 / 280 / 281 / 280 / 276 |
| Sanford | 278; Jan 1 00:53→Jan 11 09:53 | 278 / 278 / 278 / 278 / 255 |
| St. George airport | 287; Jan 1 00:56→Jan 12 18:56 | 287 / 275 / 287 / 275 / 275 |
| Anchorage | 252; Jan 1 00:00→Jan 6 01:53 | 252 / 252 / 252 / 252 / 161 |
| Honolulu | 252; Jan 1 00:00→Jan 9 18:00 | 251 / 247 / 251 / 247 / 198 |

Temperature/dew point/wind examples carry source `343` QC `5` and source `223` QC `1`; station pressure frequently has `4` (gross-limits check), not equivalent to all checks passed. RH and wet-bulb have measurement **D (derived)** throughout their populated sample rows. Preserve that classification even inside the observations dataset. Trace precipitation flags occur 1/8/3/42/56 times respectively in the table order. No sample supports claiming measured outdoor WBGT or complete radiation inputs.

NOAA documents variable-specific metadata: measurement code, quality code, report type, source code, original source station ID. QC meanings depend on source/variable: a blanket “nonblank flag is bad” rule would wrongly discard numeric accepted flags. Conversely unknown codes must not silently become “good.” GHCNh adds common checks to six variables while other fields retain legacy QC. See [GHCNh documentation](https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/doc/ghcnh_DOCUMENTATION.pdf), sections III–IX, and [local text](history/ghcnh-documentation.txt). The [NOAA product page](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly) describes its source harmonization and GHCN identifier alignment; alignment is not permission to merge datasets invisibly.

## HOMR finding: metadata conflicts need a contract

The [documented HOMR GET service](https://www.ncei.noaa.gov/access/homr/api) supports `date=all`; default requests expose latest values only. One bounded St. George name/state query returned six records. Metadata history is most extensive for COOP stations; no change entry is not proof of no change.

For airport `USW00023186`, the hourly catalog uses 37.1000, −113.6000, while HOMR's latest lat/lon pair is 37.0451, −113.50561. HOMR associates that pair with both 2001–2011 and 2011–Present segments. **Do not infer an exact physical relocation date from those conflicting records.** Expose the discrepancy and resolve against source station history before pinning location epochs. St. George COOP `USC00427516` has different coordinate epochs and metadata segments ending 2013-10-17 and restarting 2014-11-19. This reinforces the measured coverage gaps; it is not a basis to fabricate intervening observations. `USW00093198` is a different historical identifier, not the new airport or an automatic bridge.

## Targeted HOMR follow-up and observation-time limits

Three exact-ID requests used `date=all&phrData=true`: [St. George airport](history/homr-USW00023186-v2.json), [St. George COOP](history/homr-USC00427516-v2.json), and [Sanford COOP](history/homr-USC00087982-v2.json). Each returned one station. The [offline extract](history/homr-summary-v2.json) retains coordinate/elevation epochs, relocations, relevant remarks, and TEMP/PRECIP element histories. NOAA's [HOMR API documentation](https://www.ncei.noaa.gov/access/homr/api) identifies `elements` as the optional element-level PHR data omitted in the first audit. Fields are metadata schedules, not per-day proof that an observation occurred.

**St. George airport conflict remains unresolved, with a documented reason.** The 2023-03-23 HOMR remark says NWS reported an earlier move without its date, distance or direction, and that MesoWest coordinates were used to update the position. This supports retaining uncertain metadata epochs instead of interpreting the displayed 2001/2011 boundaries as verified physical move dates. No `elements` field or explicit relocation list was returned, even with PHR enabled. This absence does not prove a stable site or absent observations.

**St. George COOP has a documented observation-schedule discontinuity.** TEMP and daily PRECIP have `observationTime=1700` in baseline-overlapping segments through 2001-07-25, then `0800` from that boundary onward, with the known 2013-10-17 to 2014-11-19 metadata hiatus. HOMR also lists a 0.5-mile east relocation on 2001-07-25 and 2.5-mile WNW relocation on 2014-11-19. Hourly COOP HPD precipitation has a separate `2400` schedule in several segments; do not apply that to daily COOP SOD precipitation. These schedules and relocations are relevant discontinuities even within a single GHCND identifier.

**Sanford COOP has `0800` TEMP/daily PRECIP schedules throughout the returned baseline-overlapping segments**, but coordinates change at 1995-02-01 and 2005-03-01. The 2005 relocation entry says 12 feet east while its coordinate epochs differ by much more; metadata correction versus physical movement needs further resolution. Constant observation time alone does not establish homogeneous exposure. HOMR's long historical station identity also predates the downloaded GHCND core-variable record; metadata dates are not data availability.

Preserve raw `observationTime`, element, data program, frequency, effective dates and source UTC-offset metadata. St. George reports offset −7 and Sanford −5; neither a fixed offset nor the `0800` string alone proves how daily records align with DST civil dates. The precise local-standard/civil-time convention and day-label relationship have **not** been verified here. No timestamps or accumulation endpoints were manufactured. The daily readme points to by-year observation-time documentation, but both linked files returned HTTP 404 in this follow-up ([failure manifest](history/followup-doc-downloads.json)). A bounded actual by-year row check and an authoritative time-field definition remain needed before decoding individual daily observation instants. Do not download a national annual archive merely to fill this documentation gap.

## Time, accumulation, and comparison contracts

Propose the following additions to lead-owned contracts before H2/H3 implementation:

- `stationSelection`: requested coordinates and verified/unknown elevation; candidate radius, ranking purpose, selected ID, alternatives/reasons, evidence status and selection-policy version. Include source-specific station metadata and dated `stationEpochs`, conflict status, source station IDs, and HOMR retrieval time.
- `valueProvenance`: provider/dataset/version, station/grid ID, observation/model/derived classification **per variable**, raw flags and decoded meanings, original units, retrieval time, source report type. Derived RH/wet-bulb inside GHCNh remains derived. Missing, rejected-QC, unavailable-variable, unknown-code, and metadata-conflict must be distinguishable.
- `timeContext`: source timestamp, UTC instant where defined, calendar date where that is all the source supplies, station time basis, display IANA zone, observation time/period if known. A `.dly` date does not justify inventing a midnight timestamp. Retrieve documented by-year observation-time fields/HOMR element histories where needed; the follow-up validated two COOP schedule histories but not per-record observation times or their UTC/day-label conversion.
- `accumulation`: interval start/end or duration, trace status, overlap/running-total behavior, completeness, and documented aggregation method. GHCNh has 5/15-minute and 3–24-hour precipitation fields as well as nominal hourly amounts. NOAA's METAR examples require the last running-total report for the hour, **not summing SPECI reports**; that rule must remain source/report-specific. Do not add overlapping 1/3/6/24-hour totals. Daily multiday totals and missing-presumed-zero flags cannot become ordinary daily rainfall without explicit treatment.
- `coverage`: requested/available periods, expected/accepted/rejected/missing counts per variable and jointly, per-month/per-year denominators, cadence policy, longest gaps, and metadata discontinuities. Hourly denominator must count unique canonical slots, not report rows. Retain extra reports without biasing means toward storm/SPECI hours.
- `comparisonDefinition`: fixed dataset/model, grid selection/downscaling/elevation policy, common years, time-zone/calendar convention, aggregation, QC/coverage policy, and heat method/version. Cache/export keys include these choices. Preserve exact UTC intervals when local days have 23/25 hours; clarify leap-day weighting and December–February season assignment.

1991–2020 contains 30 fixed calendar years. On this audit date, **2016–2025 is the candidate latest ten complete calendar years**, but calendar completion does not establish data completeness. Resolve one latest common supported year across the selected cities/variables and freeze it in the job. Never silently compare city A's 2016–2025 with city B's 2014–2023; show unavailable or offer an explicitly labeled common earlier window. Do not drop a sparse year and call the remaining disjoint years “the latest decade.” If “complete available” is interpreted as zero missing records, many audited station windows fail; lead should preserve the distinction between completed calendar years and data eligibility.

For the planned seasonal comparison, explicitly request **ERA5** throughout both windows. Open-Meteo's default Best Match combines models; selecting a fixed model avoids that change in definition. ERA5-Seamless is also a mixed product and must not stand in for ERA5 silently. Preserve returned grid coordinates/elevation and downscaling choices. Label reanalysis as modeled historical estimates informed by observations, not a sensor at the requested address or independent ground truth. Radiation is a preceding-hour average unless an instant field is selected; align it with the heat calculation and precipitation intervals. These recommendations follow [Open-Meteo's historical API documentation](https://open-meteo.com/en/docs/historical-weather-api); the plan's existing one-day checks remain availability evidence only.

Daily means cannot supply hourly humid-heat distributions or historical WBGT. Computing a nonlinear metric from daily averages does not recover hourly extremes/exposure. GHCNh observation inputs plus modeled radiation would create a **hybrid derived** product, requiring an explicit method and validation; use consistently labeled reanalysis for the planned modeled comparison until that is approved. Heat category definitions and numerical validation remain R1/R2 dependencies.

## Remaining acceptance gaps

R5 should stay **in progress / partially verified**, not research closed. The next bounded work is: canonical city coordinates/elevations; warm-season and winter station-year coverage for the preferred hourly candidates; remaining HOMR histories and per-record time semantics; actual daily coverage for unsampled alternatives; a scientific eligibility policy using the now-verified nine-station monthly/yearly joint counts; resolution of St. George catalog/HOMR disagreement; and a versioned coverage policy. The audit demonstrates working free NOAA GET access and reproducible sample parsing, but not final station choices, complete decade-wide hourly data, homogeneous normals, browser behavior, or WBGT-ready station records.


## Follow-up reproducibility and preservation

Run `python3 docs/research/history/analyze-daily-v2.py` and `python3 docs/research/history/analyze-homr-v2.py` from the workspace root. These offline standard-library research analyzers write only versioned evidence in their own directory. Fixed-width/station-ID/calendar/duplicate assertions, count partitions, and monthly/yearly sums are checked; the original five-station accepted totals must match `daily-summary.json`. A second run reproduced both v2 outputs byte-for-byte. The original analyzer now explicitly fixes its five-station cohort so rerunning it cannot silently overwrite its summary with the expanded cohort; original summary and raw-evidence hashes remain preserved. See [follow-up validation](history/validation-v2.json) and [evidence index](history/README.md).

Requested contract refinements: distinguish **QC-screen coverage** from measurement-policy eligibility (especially presumed-zero `P`); preserve element/program-specific observation schedules separately from actual observation times; represent inferred/corrected/conflicting coordinate epochs; keep one station and common period for change comparisons. No final station selection, homogeneous normals, complete nationwide ranking or station WBGT readiness is claimed. No hourly archives were expanded in this follow-up.
