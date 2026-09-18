# R5 evidence index

Audit date: September 10, 2026. All upstream actions were bounded public HTTP GETs. No credentials, subscriptions, app development, or installations. Python scripts here are offline research evidence analyzers using the existing Python 3 standard library; they are not application components.

## Files

- `downloads.json`, `downloads-hourly.json`, `downloads-curl.json`: initial/repeated metadata retrieval attempts. The first inventory attempt stopped at a deliberate 25 MB cap; the later full attempt timed out at 9,745,662 bytes. **Neither incomplete inventory was used for ranking.** Retained manifests record this history; HTTP 200 alone does not establish complete download.
- `sample-downloads.json`: complete daily-file GETs, six hourly byte-range attempts, and inventory-tail retrieval. Five hourly requests returned 206 with exactly 262,144 bytes. `USW00093198-2020-head.psv` is the preserved 404 HTML response, not a data file, and is excluded by the analyzer.
- `inventory-mid-headers.txt`: response headers for the additional contiguous inventory byte range 18,000,000–24,999,999, retrieved in this audit with curl. Adjacent range 25,000,000–35,999,415 is in the sample manifest. These were concatenated **before** splitting lines; the first incomplete line was discarded. The concatenated region starts inside US1TNSR0023 and contains the conventional USC/USW inventory records used for daily temperature screening. Earlier precipitation-network inventory is not fully retained. The complete global station list was used for spatial screening.
- `source-subsetting.json`: exact byte lengths/SHA-256 of global scratch downloads and inventory ranges before their removal. Derived subsets retain original metadata rows for stations within 75 km of any listed center: 5,307 daily station rows, 25,452 inventory rows, 357 hourly station rows. This is a research subset, not an entire US inventory. Daily station IDs without retained inventory must be treated as unknown.
- `ghcnd-stations-subset.txt`, `ghcnd-inventory-subset.txt`, `ghcnh-station-list-subset.csv`: spatial metadata evidence. Inventory start/end is variable-specific, not a coverage percentage. `candidates.json` contains approximate input centers, raw nearest-five hourly candidates, daily nearest-four candidates with all three core inventory elements, and nearest-three daily candidates whose three core endpoint spans cover both windows.
- `USC00427516.dly`, `USW00003184.dly`, `USW00012854.dly`, `USW00026451.dly`, `USW00022521.dly`: exact complete downloaded daily files. Bounded selection is five station period-of-record files (approximately 13.7 MB total), not a global archive. Keep original units/flags; monthly padding can include future dates with missing values.
- `*-2020-head.psv`: unmodified hourly prefixes, including final partial row. Analyzer discards that row; samples run from January 1 through differing January dates. They do not establish warm-season, annual, or decade completeness.
- `ghcnd-readme.txt`, `ghcnh_DOCUMENTATION.pdf`, `ghcnh-documentation.txt`: NOAA documentation and pdftotext extraction of the PDF. The PDF remains authoritative if extraction differs.
- `homr-st-george.json`: exact HOMR `name=ST GEORGE&nameMod=starts&state=UT&date=all&phrData=false` response. Six returned records, with definitions. Full latitude/longitude epochs are retained. This one query is not a nationwide HOMR audit.
- `daily-summary.json`, `hourly-summary.json`: reproducible counts and actual example values/flags.
- `validation.json`: local verification and checksums for retained evidence files, excluding itself.

## Reproduce offline counts

From repository/workspace root:

```sh
python3 docs/research/history/analyze-samples.py
python3 docs/research/history/rank-metadata.py
```

The analyzer validates daily fixed-width line length (269), actual calendar-day lengths, unique valid daily counts, expected-period denominators, and complete PSV rows. Daily acceptance for this audit is `value != -9999` and blank QFLAG, with measurement/source flags preserved. All other counts and flags remain available in JSON. It does not treat unknown QC as accepted, impute gaps, sum precipitation, or perform heat calculations. Hourly summary counts are presence counts, **not QC eligibility**.

The metadata screening script consumes only retained files. Great-circle formula is `2*6371*asin(sqrt(sin((lat2-lat1)/2)^2 + cos(lat1)*cos(lat2)*sin((lon2-lon1)/2)^2))`, with angles in radians. Nearest sorting uses distance then station ID. Daily endpoint candidates require TMAX, TMIN, PRCP start year ≤1991 and end year ≥2025; final manual review priorities in the report also account for available audited coverage and exposure concerns. No arbitrary numerical score is applied to unknown elevation agreement, quality, or hourly history.

## Reproduce upstream requests

Use exact URLs and ranges in the manifests. For hourly sample station `USW00003184`, the request was:

```sh
curl --range 0-262143 'https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2020/psv/GHCNh_USW00003184_2020.psv'
```

For a complete daily file:

```sh
curl 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/all/USW00003184.dly'
```

Re-running live requests later can produce revised files. Save retrieval time, response status/headers and checksum, then rederive summaries rather than mixing revisions. Metadata URLs appear in download manifests; source documentation links appear in the main report. No unattended polling or bulk archive retrieval is proposed.


## Bounded follow-up (v2)

Four additional complete daily files (`USC00087982`, `USC00021282`, `USW00023271`, `USW00024234`) add 5,864,400 bytes. `followup-downloads.json` records seven successful bounded GETs: those four files and three exact-ID HOMR responses with element-level PHR enabled. No hourly samples were expanded. `followup-doc-downloads.json` records two 404s for the by-year documentation URLs named in NOAA's daily readme; no daily observation-time rows were retrieved.

- `daily-coverage-v2.json`: all nine stations, baseline/recent totals, individual calendar years and months, per-variable present/blank-QFLAG/rejected/missing counts and raw flag frequencies; same-date joint TMAX/TMIN/PRCP counts and longest joint gaps. Presence/blank-QFLAG is only a QC screen, not a measurement-status eligibility rule: presumed-zero P and trace T remain distinguished, not converted to ordinary measured zeros.
- `homr-*-v2.json`: complete exact-ID histories for St. George airport, St. George COOP and Sanford COOP. `homr-summary-v2.json` extracts relevant exact fields; it does not infer time-zone conversion or relocation dates. Read the raw JSON for all definitions and history.
- `analyze-daily-v2.py`, `analyze-homr-v2.py`: offline standard-library research analyzers. Run each from the workspace root. They generate only the versioned summaries above. The daily analyzer checks fixed-width records, station ID, valid calendar dates, duplicate keys, count partitions, month/year-to-period reconciliation, and agreement with the five original daily totals.
- `followup-original-hashes.json`: pre-follow-up checksums for existing evidence, report and plan. `validation-v2.json`: preservation checks, deterministic re-run checks and new/changed file list. The prior validation manifest remains historical evidence of the first audit.

The original `analyze-samples.py` now names its original five daily stations explicitly; its original daily/hourly outputs are unchanged. `rank-metadata.py` and `candidates.json` still express the initial metadata screen; the main report records revised manual audit priorities from v2 coverage. Do not use initial metadata ordering as a verified final ranking.

```sh
python3 docs/research/history/analyze-daily-v2.py
python3 docs/research/history/analyze-homr-v2.py
```

Run `python3 docs/research/history/verify-v2.py` to reproduce the complete follow-up verification and refresh `validation-v2.json`; this also reruns the original five-station analyzer and checks unchanged original summary hashes.
