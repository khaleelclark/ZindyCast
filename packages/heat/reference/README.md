# Liljegren reference and changes

This product includes software produced by UChicago Argonne, LLC under Contract No. DE-AC02-06CH11357 with the Department of Energy.

The full copyright, four conditions and disclaimer appear in [NOTICE.txt](NOTICE.txt), the unchanged [C reference](wbgt-original.c), and the TypeScript derivative. Redistribution must retain those notices and include this acknowledgment in software and end-user documentation. This is not an MIT-only implementation; repository-wrapper metadata does not override the embedded reference license. The lead must include the full notice and acknowledgment in release materials before distribution.

Original source: [James C. Liljegren WBGT 1.1, mirror pinned at cd672a886880b67f3f27bdbf75038d8f7ff0bac2](https://github.com/mdljts/wbgt/blob/cd672a886880b67f3f27bdbf75038d8f7ff0bac2/src/wbgt.c.original). SHA-256: `1bd6bd3a8365225dc9f872e8674c5f76b6fcd62a6edda08df087010e44617d90`. Contains the 2-Nov-2009 failure change and Nels Larson/PNNL solarposition v3.0, 20-Feb-1992. Original research remains unchanged in [heat-science.md](../../../docs/research/heat-science.md).

## Modifications

TypeScript adaptation and independent test caller authored by OpenAI Codex for ZindyCast, 2026-09-10. Version `liljegren-1.1-zindy-ts-1`.

- Original C file is byte-for-byte unchanged. `oracle.c` uses a preprocessor macro to rename its demonstration `main` and supplies an initialized, separate caller. At 2 m the original leaves estimated wind uninitialized; the harness initializes it and does not expose it. It passes initialized dT and urban arguments, which do not affect the selected 2 m path. No calculation function is replaced. The caller prints nine significant digits instead of the demonstration's two decimals; component sentinels remain visible in oracle evidence only. GCC uses old C syntax mode to accept K&R definitions.
- TS uses IEEE-754 double numbers instead of C's float intermediate values. Algebraically equivalent expressions combine some constants and reuse atmospheric longwave; validation measures resulting differences. Convergence remains candidate-minus-previous <0.02 K, damping 0.9/0.1, max 50 iterations, returning the converged candidate.
- Port includes only explicit 2 m wind, liquid-water wet-bulb solver and outdoor WBGT. No wind-height/stability conversion, optional ice helper, standalone day-number/days-since-1900 interface or unused solar azimuth output is exported. Omitting unused azimuth avoids an irrelevant pole singularity. Internal Gregorian day-number logic preserves original C truncation toward zero and signed fractional remainders. UTC, minute-resolution ISO calendar time replaces local-standard-time/GMT/averaging arguments; seconds must be zero, avg and GMT offset are fixed at zero.
- Strict runtime validation rejects missing/nonfinite values, malformed/rolled calendar dates, unsupported years and absent input assumptions. Seconds and local offsets are rejected rather than silently truncated. All input units are explicit in field names: Celsius, hPa **surface** pressure, m/s at 2 m, instantaneous global horizontal W/m², degrees north/east. No Fahrenheit/Pa/mph conversions happen here; callers must normalize first. WindAssumption and source are caller assertions, not automatic scientific approval.
- A deliberate bounded engineering envelope accepts air −50…60°C, pressure 200…1100 hPa, wind 0…100 m/s and GHI 0…2000 W/m². These are conservative implementation exclusions, **not source-certified scientific validity bounds or safety thresholds**. RH is (0,100]; vapor pressure must be below total pressure. Outside-envelope results are unsupported. Elevation itself is not an input. Low-pressure fixed-enhancement and evaporative-temperature extrapolation warnings remain visible within the envelope.
- C's reference wind floor (0.13 m/s) and radiation normalization cap (0.85 of top-of-atmosphere horizontal irradiance, when CZA ≥0.00873) remain unchanged. Raw inputs, effective values, floor/cap flags and direct fraction are retained. Nonzero GHI below the horizon threshold is preserved with a warning, as in the source; this is not physical validation of that input.
- Explicit zero-direct-beam branches avoid `0 × Infinity` at the exact horizon and have the same limiting value. Nonfinite iterations fail immediately instead of exhausting 50 iterations. An iterate vapor pressure at or above total pressure fails explicitly. Failure never leaks −9999 as weather. Each component, including psychrometric wet-bulb, must succeed for a successful result, stricter than the original top-level status that ignores psychrometric failure.
- Result diagnostics include component convergence/iteration counts, original input snapshot, method/revision and caveats. Activity education is an independent module with no numeric categories, notification evaluation, fetching, side effects, or mutation of WBGT.

## Reproduce

From repository root, using already-installed tools:

```sh
python3 packages/heat/reference/generate-oracle.py
node_modules/.bin/tsx packages/heat/reference/compare.ts
node_modules/.bin/tsx --test packages/heat/src/heat.test.ts
npm run typecheck
npm run build
```

Python is only an offline reference-fixture generator, never an application runtime. The generator compiles the original C in a temporary directory using the existing `cc`, removes the executable at exit and writes cases/raw input/raw output/compiler evidence only under `docs/verification/heat`. It imports no TS and computes no expected temperature itself. `compare.ts` compares against those stored independent outputs. No compiler or package is installed. See [verification report](../../../docs/verification/heat/README.md).
