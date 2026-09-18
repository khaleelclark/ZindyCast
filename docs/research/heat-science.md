# R1/R2 — heat policy proposal and Liljegren reference audit

Research date: 2026-09-10. Owner: Heat science. Research/documentation only; no DEVELOP authorization, application implementation, reference execution, installs, accounts, or notifications. The entire implementation plan was read. Its thirteen-location forecast/ERA5 availability checks remain valid as recorded availability evidence; this audit neither repeats them nor upgrades them to accuracy evidence.

**Outcome:** a numerical implementation target and usable educational policy are proposed. R1 categorical family policy is **unresolved**. R2 source/license/convention inspection is complete for the pinned reference below; independent numerical validation and several provider-to-model assumptions remain gates. Do not mark either backlog item fully verified from this document alone.

## 1. Proposed product policy

Separate three outputs: environmental WBGT estimate, activity advice, and a user's personal threshold. Selecting an activity never changes WBGT, ordinary wet-bulb, or notification preferences. A personal threshold is a preference, not an evidence-backed safety limit.

Proposed policy ID: `zindy-heat-education-2026-09-10-draft1`. Before category approval, show “Estimated outdoor WBGT” with source/time/model details and no safety color or “safe” label. Show educational advice below for all US locations, including Alaska and Hawaii. Keep automatic categorical heat notifications disabled. An official NWS alert is a separate official product and must not be inferred from a WBGT band.

| Selection | Proposed educational wording, not a numeric workload assignment |
|---|---|
| Relaxing outside | Choose a cooler place and make shade or indoor cooling available. Pay attention to how everyone feels. |
| Walking/light activity — default | Plan for breaks and cooling; ease the pace or choose a cooler time when conditions feel taxing. |
| Strenuous activity | Exercise adds substantial heat load. Reduce intensity and use cooler times and places; organized activities should follow their own heat procedures. |

These are editorial adaptations of general precautions in [NWS heat safety](https://www.weather.gov/safety/heat-during), not a validated mapping to watts, work/rest ratios, or safe durations. The selector does not collect fitness, health, clothing, acclimatization, terrain, pace, or supervision, so it cannot determine an occupational or athletic prescription. Do not infer acclimatization from residence or current coordinates, particularly during travel.

Proposed persistent explanation: “This is an estimate for outdoor weather conditions. Sun exposure, nearby surfaces, shelter, clothing, exertion and individual health can change heat stress. It does not tell you how long it is safe to stay outside.” This is a product limitation statement, not a confidence interval. Do not add a universal ordinary-wet-bulb danger threshold.

## 2. Published boundaries and their applicability

### Regional athletics: useful context, not the family default

[Grundstein et al., Applied Geography 56 (2015), DOI 10.1016/j.apgeog.2014.10.014, Table 2](https://www.sciencedirect.com/science/article/abs/pii/S0143622814002513) concerns low-risk, acclimatized individuals in CONUS. Its three climate regions do not establish individual acclimatization or Alaska/Hawaii categories. Below are all published Celsius intervals; compact interpretation codes are paraphrases.

| Region 1 °C | Region 2 °C | Region 3 °C | Interpretation |
|---|---|---|---|
| ≤6.7 | ≤8.7 | ≤10.0 | A |
| 6.8–15.0 | 8.8–17.0 | 10.1–18.3 | A |
| 15.1–18.9 | 17.1–20.9 | 18.4–22.2 | A |
| 19.0–22.3 | 21.0–24.3 | 22.3–25.6 | B |
| 22.4–24.5 | 24.4–26.5 | 25.7–27.8 | B |
| 24.6–26.7 | 26.6–28.7 | 27.9–30.0 | C |
| 26.8–28.9 | 28.8–30.9 | 30.1–32.2 | D |
| >29.0 | >31.0 | >32.3 | E |

A: ordinary exercise; B: also monitor hydration; C: exercise discretion for intense/prolonged exertion; D: restrict intense exertion and overall heat exposure; E: cancel exercise. The narrative starts cancellation at 29/31/32.3°C, whereas the table uses `>`. Decimal gaps also exist. **Do not silently fill them.** Region assignment needs a defensible geographic dataset, not guessed state boundaries. The paper's alternative Table 3 is a different school-sports policy and is not interchangeable.

This is a complete transcription of the source's rows, **not a complete executable classifier**. No Fahrenheit thresholds are independently invented; any eventual conversion must operate on approved canonical Celsius comparisons. Automated region assignment, exact equality handling, rounding/quantization, and eligible population remain unresolved. No region has been assigned to the reference cities in this audit.

### NWS Albany example: visual table checked

The [NWS Albany fact sheet](https://www.weather.gov/media/aly/FactSheets/WBGT.pdf) explicitly identifies its table as Region 2 for NYS graphics. The bands embedded as an image were inspected visually because PDF text extraction omits them. [Local evidence PDF](heat/nws-albany-wbgt.pdf).

| Printed value, °F context | Printed label |
|---|---|
| <75.9 | Low Threat |
| 75.9–78.7 | Elevated Threat |
| 78.8–83.7 | Moderate Threat |
| 83.8–87.6 | High Threat |
| >87.6 | Extreme Threat |

There are sub-tenth gaps unless a quantization convention is supplied. The band image itself does not print a unit beside the values; Fahrenheit is the contextual interpretation, consistent with the cited Celsius research. Do not promote this regional graphic into a universal family policy or claim NWS endorsement of ZindyCast. The separate [Tulsa calculator](https://www.weather.gov/tsa/wbgt) explicitly labels itself a nonoperational prototype and contains exposure-time language; it is not the proposed policy or numerical oracle.

### NIOSH: stronger workload context, still not a family classifier

[NIOSH 2016-106, chapter 8, printed pp. 93–96](https://www.cdc.gov/niosh/docs/2016-106/pdfs/2016-106.pdf) defines RAL for unacclimatized workers and REL for acclimatized workers. Equations are `RAL = 59.9 − 14.1 log10(M)` and `REL = 56.7 − 11.5 log10(M)`, with M in watts and output °C-WBGT. Assumptions include healthy, fit workers, conventional one-layer clothing and workload/exposure assessment; the source says these limits may not protect everyone. Work/rest schedules matter. The app's three informal activities cannot supply the required inputs. Do not substitute an arbitrarily chosen wattage, extend these equations to arbitrary workloads, or display their schedules as a family countdown. NIOSH is retained for context, not adopted as the default categorical framework.

### Decision recommended to lead

Approve the educational policy for later implementation review, retain numeric WBGT separately, and keep categorical release gated. A future category proposal must settle source, eligible population, geography, every equality/decimal boundary, rounding, uncertainty wording and activity applicability. The current sources do not justify one US-wide family boundary table. This is a scientific applicability gap; the operator should not be asked to invent cutoff numbers to close it.

## 3. Metric definitions and ordinary-wet-bulb method

- Outdoor WBGT in the audited reference is `0.7 × Tnwb + 0.2 × Tg + 0.1 × Ta`, all component temperatures in Celsius. It models environmental heat load; it is not a feels-like temperature or a personal core temperature.
- Natural wet-bulb, Tnwb, is the wetted-sensor heat/mass balance including radiation and natural ventilation. Globe temperature, Tg, supplies radiative/convective context.
- Ordinary/psychrometric wet-bulb excludes that natural sensor radiation exposure. The reference computes `Tpsy` using its wet-bulb solver with radiation disabled. Never insert a provider ordinary wet-bulb field as Tnwb.
- Retain the outdoor formulation at night with actual zero shortwave; do not silently switch to a different indoor/shade formula. There is no sun/shade selector in the agreed product.

[Open-Meteo Meteorology.swift, pinned revision 7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84, lines 332–340](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Helper/Meteorology.swift#L332) identifies its helper as Stull's approximation, accepting only temperature/RH and capping the result at air temperature. It does not use pressure. This establishes the helper's method; the entire production routing and currently deployed API revision were not audited, so field-to-deployment provenance remains a check before claiming exact method parity.

[Stull 2011, DOI 10.1175/JAMC-D-11-0143.1](https://doi.org/10.1175/JAMC-D-11-0143.1) gives a sea-level approximation for −20 to 50°C and RH 5–99%, excluding jointly cold/dry conditions. Therefore label the provider value as an estimated ordinary wet-bulb, record method limitations, and do not treat it as a pressure-corrected physical oracle at altitude. In-range availability is not established merely because a field is non-null. Values outside the documented method domain need an explicit quality state, rather than a newly invented fallback formula.

## 4. Reference provenance, version and full notices

Implementation target proposed: the **original C reference**, not an arbitrary modern package named Liljegren. The exact retained file is [wbgt.c.original at cd672a886880b67f3f27bdbf75038d8f7ff0bac2](https://github.com/mdljts/wbgt/blob/cd672a886880b67f3f27bdbf75038d8f7ff0bac2/src/wbgt.c.original), mirrored by an R-package repository. Its header identifies WBGT **1.1**, copyright 2008 UChicago Argonne, with a 2-Nov-2009 nonconvergence revision. [Local unchanged research source](heat/wbgt.c.original.txt), SHA-256 `1bd6bd3a8365225dc9f872e8674c5f76b6fcd62a6edda08df087010e44617d90`. All 1,144 lines, including notices, solarposition and stability helpers, were inspected. Nothing was compiled or executed.

This is a mirror of author-attributed reference code, not verified direct Argonne distribution provenance. The [original paper abstract](https://pubmed.ncbi.nlm.nih.gov/18668404/) establishes the heat/mass-transfer model and reports sub-1°C performance in its depot comparisons. Full original paper text and measurement datasets were not obtained. That abstract does not justify a universal ±1°C forecast uncertainty bound.

The entire four-condition license and disclaimer are retained at the top of the local source. Obligations, paraphrased: retain copyright/conditions/disclaimer in source; identify modifications and their author/organization; reproduce notices in binary-distribution documentation/materials; do not use Argonne/DOE/contributor names as endorsement; include the prescribed Argonne/DOE acknowledgment in the software and distributed end-user documentation. There is an as-is warranty/liability/noninfringement disclaimer. Preserve the source's exact wording in a future notices file rather than this paraphrase. Preserve the embedded Nels Larson/PNNL solarposition v3.0 (20-Feb-1992) and daynum authorship comments as well.

[OSHA OTM chapter 4 Appendix A](https://www.osha.gov/otm/section-3-health-hazards/chapter-4) was read through its complete indexed appendix after direct fetch returned HTTP 403. It labels the utility **1.2**, with the same four obligations in substance and a disclaimer containing typographical differences. The [OSHA web calculator](https://www.osha.gov/heat-exposure/wbgt-calculator) instead attributes original software **1.1**. These are distinct version claims, not proof that the desktop utility, web code and mirrored C file are bit-identical. The desktop ZIP was not obtained or executed.

The mirror's [DESCRIPTION](https://github.com/mdljts/wbgt/blob/cd672a886880b67f3f27bdbf75038d8f7ff0bac2/DESCRIPTION) calls the R package version 1.2 and declares MIT + LICENSE; its [LICENSE](https://github.com/mdljts/wbgt/blob/cd672a886880b67f3f27bdbf75038d8f7ff0bac2/LICENSE) supplies Max Lieblich/University of Washington attribution. Neither supersedes the embedded original C obligations. Do not infer an MIT-only license for the calculation from package metadata. Proposed target excludes the R wrapper and modified double-precision `src/wbgt.c`; porting the original float calculations to TypeScript numbers is itself a documented numerical change.

## 5. Audited numerical conventions and failure behavior

The following are direct observations of the pinned C reference unless marked proposal.

| Area | Observed behavior and implication |
|---|---|
| Input units | Ta °C, RH percent, pressure millibar/hPa, wind m/s, wind height m, global horizontal solar W/m², latitude north-positive and longitude east-positive. Use surface pressure, not sea-level pressure. Helper comments saying Ta °C are misleading: callers convert it to kelvin before heat-balance functions. |
| Time | Local-standard hour/minute, integer LST-minus-GMT offset, and averaging minutes. Solar geometry subtracts **half the averaging period**: the timestamp is effectively the period end. Proposal: normalize UTC date/time with offset 0 before calling; never pass local DST time as standard time. Normalize midnight/month/year crossings explicitly. |
| Geometry | Low-precision solarposition has a 1950–2049 input-year restriction. Return code is ignored by its caller; reject unsupported dates before geometry. This affects historical ranges even when upstream ERA5 data exist. It adds standard-atmosphere refraction to altitude. |
| Radiation split | GHI/top-of-atmosphere ratio capped at 0.85 when sun is sufficiently above horizon; direct fraction derived empirically and clamped to 0–0.9. CZA threshold is 0.00873. These are reference numerical conventions, not meteorological validity rules. |
| Horizon/night subtlety | Below the CZA cutoff, top-of-atmosphere solar becomes zero and direct fraction becomes zero, but **input solar is not forcibly zeroed** in that branch. Thus a nonzero preceding-hour mean at sunset must not be described as an instantaneous nighttime irradiance. Expressions include division by CZA and tan(zenith); finite handling near singularities needs tests. |
| Wind conversion | Reference height 2 m. Other heights use a stability-dependent power law. Urban exponents for classes 1–6: 0.15, 0.15, 0.20, 0.25, 0.30, 0.30; rural: 0.07, 0.07, 0.10, 0.15, 0.35, 0.55. Nighttime class depends on sign of upper-minus-lower temperature difference dT. No universally valid default follows from location alone. |
| Low wind | Heat-transfer correlations floor speed at 0.13 m/s; estimated 2 m wind also floors at 0.13. Zero wind must be flagged as floored, not confused with missing data. `est_speed` is not assigned when input is already 2 m; caller must not expose an uninitialized value. |
| Sensor/surface assumptions | Globe diameter 0.0508 m; wick diameter 0.007 m/length 0.0254 m. Emissivities wick/globe 0.95, surface 0.999; albedos wick 0.4/globe 0.05/surface 0.45. Surface temperature is assumed equal to air temperature. Ground/reflected and atmospheric longwave terms are modeled, not provider surface observations. |
| Solver | Globe starts at Ta, wet-bulb at dew point. Up to 50 iterations; convergence is absolute candidate-minus-previous <0.02 K. Previous iterate updates with 0.9 previous + 0.1 candidate. Return converged candidate in °C, not damped value. |
| Nonconvergence | Component failure sentinel −9999; Tg or Tnwb failure yields status −1 and WBGT sentinel. Tpsy failure alone is not included in top-level failure status. Validate each field independently. Do not serialize sentinel as weather. |
| Additional limits | RH zero reaches log(0) in dew point; NaN/Inf, nonpositive pressure, negative wind/radiation, zero height and bad calendar inputs require explicit validation. Saturation vapor pressure uses fixed 1.004 enhancement documented for pressure >800 mb; lower-pressure alternative is commented out. Evaporation linearization is documented for 283–313 K. These are altitude/cold/hot extrapolation concerns, not proof of model validity everywhere. |

### Proposed provider alignment, pending validation

[Open-Meteo hourly definitions](https://open-meteo.com/en/docs#hourly-parameter-definition) specify temperature/RH/surface pressure/10 m wind as instantaneous, but shortwave/direct/diffuse radiation as preceding-hour averages. Direct normal irradiance is not the same as direct horizontal irradiance.

Use supplied GHI rather than OSHA's unconditional clear-sky estimate. For strict reference parity, allow its empirical direct fraction. Using the available direct/diffuse fields in place of that fraction is a separately versioned model modification needing comparison, not an unnoticed improvement. Do not pass DNI as GHI or as a horizontal direct fraction.

Preferred proposal to investigate: provider instantaneous GHI, if documented and available consistently in forecast and history, with `avg=0` and same-instant meteorology. Availability of those extra fields is **not** established by the plan's sample checks. Alternative: interval-representative meteorology aligned to preceding-hour radiation with geometry at midpoint; interpolation/averaging is an approximation and nonlinear WBGT of mean inputs is not mean WBGT. Do not set `avg=60` against endpoint meteorology and claim exact alignment. Missing first neighbor must be explicit.

Wind remains a gate: obtain/justify a 2 m estimate or a versioned conversion that acknowledges missing terrain and nighttime dT. Do not silently set dT=0 and rural/urban globally, replace wind with gusts, or copy the apparent-temperature helper's 0.75 factor into WBGT. Sensitivity comparisons can bound effects of assumptions but do not establish the true local exposure.

## 6. Independent reference-case specification — not generated results

These are **synthetic test inputs**, not observed weather or completed fixtures. They are designed now; expected Tg/Tnwb/Tpsy/WBGT and statuses must be generated independently after DEVELOP. Unless changed below: UTC offset 0, `avg=0`, wind height 2 m, dT=−0.5°C, rural=0. At 2 m, dT/terrain should not affect the heat calculation. Date/time is UTC; pressures are hPa, temperatures °C, RH %, wind m/s, GHI W/m².

| Case | UTC | Lat, lon | Ta / RH / p / wind / GHI | Purpose |
|---|---|---|---|---|
| D dry heat | 2020-07-15 20:00 | 33.86, −112.14 | 42 / 15 / 950 / 2 / 900 | Dry-hot daytime |
| H humid heat | 2020-07-15 18:00 | 28.90, −81.26 | 33 / 75 / 1010 / 2 / 800 | Humid daytime |
| N humid night | 2020-07-16 06:00 | 28.90, −81.26 | 28 / 90 / 1010 / 1 / 0 | Zero solar with modeled longwave |
| L calm sweep | D time/location | D | replace wind with 0, 0.12, 0.13, 0.14 | Low-wind floor and continuity |
| P pressure sweep | D time/location | D | replace p with 1013.25, 850, 750 | Altitude sensitivity and documented enhancement-factor limitation |
| W height/stability | N time/location | N | wind 2 at height 10; dT −0.5 and +0.5; rural and urban | Four nighttime conversion paths |
| S sunrise | 2020-07-15 11:00, 11:30, 12:00 | 28.90, −81.26 | 27 / 90 / 1010 / 1 / 0, 20, 100 respectively | Horizon sensitivity, finite outputs |
| E sunset interval | 2020-07-16 00:00, 01:00, 02:00 | 28.90, −81.26 | 29 / 80 / 1010 / 1 / 100, 20, 0 respectively | Repeat avg 0 and 60; demonstrate temporal mismatch |
| A Alaska summer | 2020-06-21 22:00 | 61.22, −149.90 | 24 / 50 / 1000 / 2 / 650 | High-latitude summer geometry |
| K Alaska winter | 2020-12-21 22:00 | 61.22, −149.90 | −10 / 80 / 1000 / 2 / 0 | Extrapolation/failure characterization, no cold-safety guidance |
| I Hawaii | 2020-07-15 23:00 | 21.31, −157.86 | 31 / 70 / 1010 / 3 / 850 | Low-latitude geometry, categories unavailable |

Add deterministic edge variants: invalid RH −1/0/101 and valid 100; missing/NaN/Inf each required field; p≤0, negative radiation/wind, height≤0; leap day; year boundary; 1949/1950/2049/2050; equivalent UTC and local-standard instants; nonzero GHI below horizon; numerical values just below/at/above CZA and solar/stability thresholds. Test invalidity separately from legitimate nonconvergence. Do not assert all synthetic extreme cases converge.

Independent oracle plan:

1. Use the frozen original C calculation in an isolated offline verification harness after authorization. Preserve source bytes/notices, document any necessary harness/compiler compatibility edits separately, compiler/flags and floating precision, all input values and raw outputs. Do not use a TypeScript translation to generate its own expected values. Read the original demonstration `main` critically: it has an uninitialized dT passed in the 2 m call, and printed rounding loses precision; use a documented minimal caller instead of trusting demo output blindly.
2. Independently verify selected cases against OSHA's user-specified-irradiance calculator after obtaining and inspecting its exact calculation/conversion code. Match time, wind height, pressure and solar assumptions first. A mismatch with a clear-sky result is not a solver defect. OSHA execution and full web script audit remain unperformed because direct access returned 403.
3. Record component temperatures and status, not just the weighted total. Propose a **provisional** 0.05°C component/WBGT comparison tolerance for the float-to-double port, then justify or tighten it from observed compiler/precision effects; this is not measured error or a forecast accuracy claim. A wrong status, nonfinite result or sentinel leak always fails. No numerical reference outputs or test passes are claimed here.
4. Validate weighted-sum reconstruction, unit equivalence, UTC equivalence, missingness and floor diagnostics. Avoid universal monotonicity assertions across changing wind/stability/radiation regimes. Compare policy boundaries independently of numerical tests once a policy is approved.

## 7. Contract implications for lead review — no shared files changed

Provide distinct metric IDs for ordinary wet-bulb, natural wet-bulb (diagnostic) and WBGT. A derived result needs calculation version, method/source revision, input-source identity, source interval semantics, solar-geometry time, wind measurement/reference height and conversion assumptions, pressure basis, quality flags, and component failure reasons. Preserve provider data separately from adjusted/clamped inputs. Policy ID/version, applicable population/region and category-unavailable reason must be separate from the numeric metric. A successful WBGT computation does not make guidance applicable.

Suggested unavailable reasons to reconcile with lead-owned contracts: missing input; unsupported source/method domain; unsupported date; temporal alignment unavailable; wind assumption unresolved; nonconvergence; nonfinite result; category policy unapproved; regional mapping unavailable. These are proposals, not newly mandated schema names.

## 8. Checks completed and remaining gates

Completed: full plan read; complete pinned 1,144-line C source and license inspected; pinned/source-master byte comparison passed; SHA-256 recorded; wrapper DESCRIPTION/LICENSE read; full OSHA indexed Appendix A inspected; original paper abstract reviewed; NIOSH chapter 8 assumptions/equations reviewed; Grundstein Table 2 and narrative compared; Albany PDF downloaded, text extracted and visually rendered; Open-Meteo definitions/helper inspected and pinned helper/master byte comparison passed. Reference source is saved as `.txt` research evidence, not executable application code. No reference outputs were calculated.

Evidence PDF SHA-256: `82e8d6b67de2568dbd881635aed6502a5a513214043494c8ef4701c0ad8ee813`.

Remaining gates: (1) categorical family applicability and complete machine boundaries; (2) defensible regional mapping if athletics context is used; (3) wind/temporal/direct-radiation policy; (4) numerical oracle outputs/tolerance and invalid-domain handling; (5) mirrored reference versus direct utility/web version provenance; (6) deployed ordinary-wet-bulb routing/version. Direct OSHA HTTP access and UConn paper-PDF retrieval failed; indexed OSHA text and publisher regional tables were available. Full Liljegren paper/data and utility ZIP were not reviewed. None of these limitations invalidates the plan's earlier provider availability checks.

## 9. Bounded follow-up: instantaneous radiation and wind policy

Follow-up performed 2026-09-10, 23:36–23:40 UTC. This section advances the earlier provider-alignment proposal; it does not replace prior evidence or close numerical validation. Exactly **four city/day weather requests** were made, no retries, all HTTP 200. No WBGT calculation, reference execution, application code or installation occurred.

### Availability evidence

The [forecast documentation](https://open-meteo.com/en/docs#hourly-parameter-definition) and [historical documentation](https://open-meteo.com/en/docs/historical-weather-api#hourly-parameter-definition) both advertise instantaneous GHI/direct/diffuse/DNI. The forecast page distinguishes backward hourly averages from values at the indicated instant. Neither page lists a 2 m wind-speed field; forecast lists 10/80/120/180 m, history 10/100 m. This is a documented-interface finding, not a live rejection test of an undocumented field.

Each request used UTC, wind in m/s, and ten fields: temperature_2m, relative_humidity_2m, surface_pressure, wind_speed_10m, shortwave_radiation, shortwave_radiation_instant, direct_radiation_instant, diffuse_radiation_instant, direct_normal_irradiance_instant, wet_bulb_temperature_2m. All ten returned 24 finite numeric values, with expected °C, %, hPa, m/s and W/m² units and 00:00–23:00 timestamps. Forecast used default best match; archive explicitly used `models=era5`.

| Request location | Dataset and UTC day | Returned coordinates | Instant GHI min/max W/m² | Raw response and exact request URL/time |
|---|---|---|---|---|
| Anchorage 61.22, −149.90 | Forecast 2026-09-11 | 61.265377, −149.92735 | 0 / 526.3 | [response](heat/instant-anchorage-forecast.json), [request](heat/instant-anchorage-forecast-request.json) |
| Honolulu 21.31, −157.86 | Forecast 2026-09-11 | 21.335676, −157.88991 | 0 / 808.6 | [response](heat/instant-honolulu-forecast.json), [request](heat/instant-honolulu-forecast-request.json) |
| Anchorage 61.22, −149.90 | ERA5 2020-07-15 | 61.25, −149.75 | 0 / 741.0 | [response](heat/instant-anchorage-era5.json), [request](heat/instant-anchorage-era5-request.json) |
| Honolulu 21.31, −157.86 | ERA5 2020-07-15 | 21.5, −158.0 | 0 / 910.1 | [response](heat/instant-honolulu-era5.json), [request](heat/instant-honolulu-era5-request.json) |

Examples demonstrating that mean and instant fields differ: Anchorage forecast at 2026-09-11 05:00 UTC has GHI mean 6.0 and instant 0.0 W/m²; Honolulu forecast at that hour has 20.0 and 0.0; Honolulu ERA5 at 2020-07-15 06:00 has 2.0 and 0.0. These are returned values, not measured sunset validation. The four checks establish bounded availability in AK/HI; they do not establish 14-day completeness, every city/season, irradiance accuracy, or within-hour cloud behavior. The plan's previous thirteen-city audit remains unchanged.

### Pinned public routing: what “instant” means

All following source links are pinned to the earlier audited Open-Meteo revision **7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84**. Complete retrieved source files are retained as `.txt` research evidence with a [manifest](heat/followup-evidence-manifest.json); no source was executed. This pin is public repository evidence, **not a verified production deployment revision**.

- Forecast domain construction calls `makeDerivedHourly`, which constructs `VariableHourlyDeriver`: [controller](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Controllers/ForecastapiController.swift#L1137), [constructor](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Controllers/VariableHourly.swift#L537). Its [GHI instant branch at 1579](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Controllers/VariableHourly.swift#L1579) multiplies the mapped mean GHI by `Zensun.backwardsAveragedToInstantFactor`. Direct and diffuse use that factor too; DNI has a separate conversion. Exact production best-match constituent models for these responses were not identified.
- [ERA5 branch at 447](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Era5/Era5Controller.swift#L447) performs the same GHI multiplication. [ERA5 raw variable metadata](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Era5/Era5Variables.swift#L123) converts solar energy to W/m² using domain step duration.
- [Zensun lines 491–549](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Helper/Solar/Zensun.swift#L491) uses model coordinates, timestamp and time-step duration. It computes the ratio of instantaneous solar elevation sine to the backward interval's averaged elevation sine, with sunrise/set clipping; nonpositive instantaneous or averaged sine returns factor zero. **Inference:** the resulting instantaneous field estimates the endpoint irradiance from the interval mean using solar geometry. It cannot reconstruct unresolved within-hour cloud changes and is not an independent instantaneous observation. Diffuse radiation receiving the same scaling is an additional approximation to retain in provenance.
- The [forecast ordinary-wet-bulb route](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Controllers/VariableHourly.swift#L1619) calls the previously audited Stull helper with temperature and derived RH. [ERA5](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Era5/Era5Controller.swift#L463) derives RH from temperature/dew point then calls that helper. Public field-to-helper routing is now checked; deployed revision and all best-match paths remain unverified.

A historical provenance nuance: [explicit ERA5 selection](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Controllers/ForecastapiController.swift#L2164) constructs [ERA5 plus ensemble readers](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Era5/Era5Controller.swift#L78), with ERA5 higher priority. The [generic mixer](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Helper/Reader/GenericReaderMixerRaw.swift#L120) can fill missing higher-priority values from lower-priority data. The comment says the ensemble supports spread variables, but the generic mechanism alone does not guarantee that no ordinary field ever falls back. These responses do not expose per-value fallback provenance. Preserve `models=era5` as the requested dataset; do not claim the pin proves every returned value is exclusively deterministic ERA5. Assess this before strict seasonal homogeneity claims; it is not evidence that fallback occurred in these four responses.

The [Open-Meteo source LICENSE](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/LICENSE) is GNU AGPL v3. It is preserved with snapshots. This audit recommends consuming documented API values and recording transformations, not copying server routines into the application. Any future source reuse needs its own license review; the Argonne reference license and provider data/API terms are separate.

### Wind alternatives and explicit recommendation

Public [forecast variable enumeration](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Controllers/VariableHourly.swift#L184) and [ERA5 enumeration](https://github.com/open-meteo/open-meteo/blob/7988e4de62a3bf4e2ef4f3034a793af6e3bb3e84/Sources/App/Era5/Era5Controller.swift#L7), together with ERA5 raw variables, contain no 2 m wind field. The four requests used documented 10 m wind so that an undocumented variable could not invalidate the entire request. No extra city/day request was made to probe 2 m wind.

[FAO Irrigation and Drainage Paper 56, chapter 3, equation 47 and Example 14](https://www.fao.org/4/X0490E/x0490e07.htm#wind%20speed) supplies `u2 = uz × 4.87 / ln(67.8z − 5.42)` for wind above a short grassed surface; its 10 m example uses a factor approximately 0.75. This is a source-supported reference-surface option, not validation for urban yards, sheltered paths, forests or stable nighttime boundary layers. FAO also describes agrometeorological 2 m measurements: a co-located, height-documented observation would avoid that height conversion, but no such nationwide forecast/history source was verified here.

**Proposed temporal policy, for lead review:** use provider `shortwave_radiation_instant` with temperature/RH/surface pressure/wind at the identical UTC timestamp; pass reference `avg=0` and UTC offset 0. Keep mean GHI as provenance, tag instantaneous GHI as provider-derived from a backward interval, and use the original reference's direct-fraction treatment. Do not feed provider DNI into GHI. Use returned source coordinates for geometry when they reliably identify the selected series, retaining requested coordinates separately. Best-match multi-grid geometry and the provider/reference solar-horizon difference remain validation concerns. If the instant field is missing/nonfinite, report temporal-input unavailability; do not silently substitute preceding-hour radiation. A midpoint/interval product would need a separate method version and must not be labeled mean hourly WBGT merely because inputs are means.

**Proposed wind policy, for lead review:** retain the audited Liljegren conversion only when its required terrain and nighttime temperature-gradient inputs are supported. Otherwise, the concrete candidate for later comparison is a separately versioned **short-grass reference exposure** using FAO equation 47 on 10 m wind, passed to Liljegren at height 2 m; preserve raw wind and the derived wind before the solver floor, and record conversion/formula/assumed surface. This bypasses the reference's stability-based height conversion and is therefore a model-input modification. It is not yet accepted for general family release. Do not present it as measured local 2 m wind or imply that the identical approximate factor in apparent-temperature code establishes WBGT validity. Pending comparison and acceptance, a production WBGT result that needs an unapproved wind assumption should be unavailable, with educational guidance still possible.

After DEVELOP, compare this explicit candidate against the reference's rural/urban stability cases, especially calm/night/high-wind conditions; add temporal cases using these preserved raw responses, sunrise/sunset and rapidly varying radiation. Sensitivity is evidence about differences between assumptions, not a confidence interval or local-exposure validation. None of those WBGT calculations was performed in this follow-up.

### Revised gates and contract implications

Availability of instantaneous radiation is now verified for the four bounded samples, and pinned forecast/ERA5 routes are inspected. Remaining gates are physical temporal approximation/geometry, approved wind policy, numerical reference validation, and production/per-value provenance. R1 category gates are unchanged. Proposed contract additions clarify `radiationTemporalMethod`, original averaging interval, requested versus geometry coordinates, raw versus converted wind with assumed surface, requested dataset versus known constituent provenance, and a quality/unavailable reason when a needed assumption is unapproved. Names are illustrative; no shared contract was edited.
