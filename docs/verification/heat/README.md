# F5 bounded numerical verification

Implemented after explicit DEVELOP authorization. This verifies a numerical reference port with explicitly supplied 2 m wind and instantaneous GHI. Production forecast WBGT, approved wind conversion and categorical family guidance remain gated.

This product includes software produced by UChicago Argonne, LLC under Contract No. DE-AC02-06CH11357 with the Department of Energy.

Full redistribution terms: [NOTICE](../../../packages/heat/reference/NOTICE.txt). Source, adaptations and reproduction instructions: [reference README](../../../packages/heat/reference/README.md). Prior [research](../../research/heat-science.md) is preserved as historical evidence.

## Evidence

[oracle-input.txt](oracle-input.txt), [oracle-output.txt](oracle-output.txt), [oracle-cases.json](oracle-cases.json), [oracle-build.json](oracle-build.json), [comparison.json](comparison.json), [tests.tap](tests.tap).

The existing GCC 15.2.0 compiled the unchanged pinned float reference with `-std=gnu89 -O0 -fno-fast-math` and `-lm`; no compiler diagnostics. A separate initialized caller bypasses its unsafe demonstration main. SHA-256 matches the previously audited research evidence. All expected values originate from C execution, never the TS port. The C compiler is not a runtime dependency.

28 synthetic cases cover dry heat, humid heat, night, wind 0/0.12/0.13/0.14, surface-pressure 1013.25/850/750 hPa, three sunrise and three sunset instants, Alaska summer/winter, Hawaii, 1950/1991/leap-day 2000/year-end 2020/end-2049 geometry, saturation, strong wind, solar cap and extreme nonconvergence. These are synthetic verification data, not live weather, sensor validation or a climatological sample. Calendar cases compare geometry directly even when their irradiance is zero.

31 node:test tests pass: 28 independent cases plus runtime invalid/domain/temporal validation, floor/cap/provenance and separate activity policy. Each reference case compares Tg, Tnwb, Tpsy, WBGT, solar cosine, empirical direct fraction and adjusted GHI. The extreme case produces nonconvergence in both Tg and Tnwb in both implementations; TS returns component_failure and null WBGT. It still records the converged psychrometric component. No sentinel is presented as a successful result.

Maximum absolute TS–C differences:

| Output | Maximum difference |
|---|---:|
| Globe °C | 0.000214450 |
| Natural wet-bulb °C | 0.000057102 |
| Psychrometric wet-bulb °C | 0.000082258 |
| WBGT °C | 0.000072138 |
| Cosine solar zenith | 0.000000030249 |
| Direct fraction | 0.000000040320 |
| Adjusted GHI W/m² | 0.000050905 |

The component/WBGT acceptance tolerance is **0.01°C**, tightened from the research proposal's provisional 0.05°C: measured float/double differences are under 0.000215°C, and 0.01°C remains below the reference solver's 0.02 K convergence stopping criterion while leaving room for compiler/libm and branch effects. This tolerance measures implementation parity, not measured-weather accuracy or forecast uncertainty. Solar cosine/direct-fraction/GHI tolerances are respectively 1e-6, 1e-5 and 0.001 W/m². Any success/failure mismatch fails regardless of numeric tolerance. No universal model accuracy claim follows from these 28 cases.

`npm run typecheck` and `npm run build` both **pass** in the completed workspace check. An earlier attempt encountered the concurrent web work's not-yet-created stylesheet; after that work arrived, both checks succeeded without changes outside heat ownership. The production Rsbuild output completed successfully. Verification finished 2026-09-11 UTC.

## API and integration gates

Package exports `calculateWbgt(HeatInput): HeatResult`, the input/result/component diagnostic types, calculation/revision/acknowledgment constants, and separate `heatEducation(activity)`, policy version and limitation text. Public types live only in the heat package; **no shared REST contract was edited**. The lead owns adapting these to shared schemas. Inputs must explicitly carry time, geometry coordinates, temperatureC, humidityPercent, surfacePressureHpa, wind2mMs, ghiWm2, windAssumption, radiationAssumption=`instantaneous`, and source identity.

Result status is success, component_failure, invalid_input or unsupported_domain. Success is reference convergence, not approval of caller assumptions. Diagnostics preserve the input snapshot, wind/radiation adjustments, source revision and every component's iteration/status. Runtime validation catches missing meteorology; a caller needing richer missingness reasons should preserve them before invoking the calculation.

Production wind conversion remains unapproved; no 10 m factor, terrain default, dT default, or gust substitution exists. Forecast contracts currently lack surface pressure/instantaneous GHI/2 m wind provenance, so **do not connect ordinary wet-bulb or the 10 m wind to this API as substitutes**. Keep numerical forecast WBGT unavailable until supported inputs and accepted temporal/wind assumptions exist. Provider instant GHI is derived from backward means; geometry/cloud and deployment/per-value provenance concerns from research remain. Sensitivity comparisons between FAO and stability-dependent conversion are deferred because the implemented API intentionally excludes height conversion.

No original OSHA web/utility cross-check, direct Argonne distribution verification, measurement-data validation or full paper review has been added. The independent oracle is the unchanged pinned mirrored C reference. Height/stability cases and avg=60 cases from the research plan are outside this API; those regimes must be tested if later introduced. The exact-horizon finite branch and early nonfinite/vapor-pressure guards are documented safety modifications, not claims that every engineering-envelope input has been independently tested.

Educational messages are the previously researched editorial adaptation of NWS heat safety, for relaxing/walking/strenuous activities. They contain no cutoffs, safe-duration claims or categories; policy output always has category=null, policy_unapproved and categoricalNotificationsEnabled=false. Activity selection cannot change calculation inputs or notification settings. Full F5 remains open for production input policy and any later approved categorical guidance.
