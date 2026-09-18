/*
               Copyright © 2008, UChicago Argonne, LLC
                       All Rights Reserved

                        WBGT, Version 1.1

			     James C. Liljegren
              Decision & Information Sciences Division

			     OPEN SOURCE LICENSE

Redistribution and use in source and binary forms, with or without modification, 
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, 
   this list of conditions and the following disclaimer.  Software changes, 
   modifications, or derivative works, should be noted with comments and 
   the author and organization’s name.

2. Redistributions in binary form must reproduce the above copyright notice, 
   this list of conditions and the following disclaimer in the documentation 
   and/or other materials provided with the distribution.

3. Neither the names of UChicago Argonne, LLC or the Department of Energy 
   nor the names of its contributors may be used to endorse or promote products 
   derived from this software without specific prior written permission.

4. The software and the end-user documentation included with the 
   redistribution, if any, must include the following acknowledgment:

   "This product includes software produced by UChicago Argonne, LLC 
   under Contract No. DE-AC02-06CH11357 with the Department of Energy.”

******************************************************************************************
DISCLAIMER

THE SOFTWARE IS SUPPLIED "AS IS" WITHOUT WARRANTY OF ANY KIND.

NEITHER THE UNITED STATES GOVERNMENT, NOR THE UNITED STATES DEPARTMENT OF ENERGY, 
NOR UCHICAGO ARGONNE, LLC, NOR ANY OF THEIR EMPLOYEES, MAKES ANY WARRANTY, EXPRESS 
OR IMPLIED, OR ASSUMES ANY LEGAL LIABILITY OR RESPONSIBILITY FOR THE ACCURACY, 
COMPLETENESS, OR USEFULNESS OF ANY INFORMATION, DATA, APPARATUS, PRODUCT, OR 
PROCESS DISCLOSED, OR REPRESENTS THAT ITS USE WOULD NOT INFRINGE PRIVATELY OWNED RIGHTS.

******************************************************************************************/


/* TypeScript adaptation by OpenAI Codex for ZindyCast, 2026-09-10.
 * Original: James C. Liljegren, Argonne; solar geometry: Nels Larson, PNNL,
 * solarposition v3.0, 20-Feb-1992. See reference/README.md for all changes.
 */
const { sin, cos, tan, asin, acos, atan2, sqrt, exp, log, pow, abs, max, min } = Math;
const DEG = 0.017453292519943295, RAD = 57.295779513082323, PI = Math.PI;
const R_AIR = 8314.34 / 28.97, CP = 1003.5, PR = CP / (CP + 1.25 * R_AIR);
const SB = 5.6696e-8, RATIO = CP * 28.97 / 18.015;
export const CALCULATION_VERSION = 'liljegren-1.1-zindy-ts-1';
export const REFERENCE_REVISION = 'cd672a886880b67f3f27bdbf75038d8f7ff0bac2';
export const ACKNOWLEDGMENT = 'This product includes software produced by UChicago Argonne, LLC under Contract No. DE-AC02-06CH11357 with the Department of Energy.';

export interface HeatInput {
  /** Canonical UTC ISO instant, minute precision (seconds must be zero). */
  time: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  humidityPercent: number;
  surfacePressureHpa: number;
  wind2mMs: number;
  ghiWm2: number;
  /** Explicit caller assertion; no height conversion occurs in this package. */
  windAssumption: string;
  radiationAssumption: 'instantaneous';
  /** Source/derivation identity supplied by the caller, retained unchanged. */
  source: string;
}
export type Component = { status: 'success'; temperatureC: number; iterations: number } |
  { status: 'nonconvergence' | 'nonfinite'; temperatureC: null; iterations: number };
export interface HeatDiagnostics {
  calculationVersion: string;
  referenceRevision: string;
  input: HeatInput;
  windUsedMs: number;
  windFloored: boolean;
  ghiUsedWm2: number;
  ghiCapped: boolean;
  cosineSolarZenith: number;
  directFraction: number;
  warnings: string[];
  globe: Component;
  naturalWetBulb: Component;
  psychrometricWetBulb: Component;
}
export type HeatResult = { status: 'invalid_input' | 'unsupported_domain'; reason: string } |
 { status: 'success'; wbgtC: number; diagnostics: HeatDiagnostics } |
 { status: 'component_failure'; wbgtC: null; diagnostics: HeatDiagnostics };

// Calendar-only subset of Larson solarposition; preserves C integer truncation
// and signed modf semantics, standard-atmosphere refraction. Unused azimuth omitted.
function solarGeometry(date: Date, latitude: number, longitude: number) {
  const year = date.getUTCFullYear();
  const dayNumber = (Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 0)) / 86400000;
  const years = year - 2000;
  const deltaDays = years * 365 + Math.trunc(years / 4) + dayNumber + (year > 2000 ? 1 : 0);
  const baseDays = deltaDays - 1.5, centuries = baseDays / 36525;
  // Match original day.fraction construction (and its floating-point rounding).
  const day = date.getUTCDate() + (date.getUTCHours() + date.getUTCMinutes() / 60) / 24;
  const fraction = day - Math.trunc(day), ut = fraction * 24, days = baseDays + fraction;
  const anomaly = ((357.528 + 0.9856003 * days) / 360 % 1) * 2 * PI;
  const meanLongitude = ((280.460 + 0.9856474 * days) / 360 % 1) * 2 * PI;
  const obliquity = (23.439 - 4e-7 * days) * DEG;
  const ecliptic = (1.915 * sin(anomaly) + 0.020 * sin(2 * anomaly)) * DEG + meanLongitude;
  const distance = 1.00014 - 0.01671 * cos(anomaly) - 0.00014 * cos(2 * anomaly);
  let ra = atan2(cos(obliquity) * sin(ecliptic), cos(ecliptic));
  if (ra < 0) ra += 2 * PI;
  ra = (ra / (2 * PI) % 1) * 24;
  const dec = asin(sin(obliquity) * sin(ecliptic));
  let gmst = (24110.54841 + centuries * (8640184.812866 + centuries * (0.093104 - centuries * 6.2e-6))) / 3600 / 24 % 1 * 24;
  if (gmst < 0) gmst += 24;
  let lmst = (gmst + ut * 1.00273790934 + longitude / 15) / 24 % 1 * 24;
  if (lmst < 0) lmst += 24;
  let ha = lmst - ra;
  if (ha < -12) ha += 24;
  else if (ha > 12) ha -= 24;
  ha = ha / 24 * 2 * PI;
  const lat = latitude * DEG;
  let altitude = asin(sin(dec) * sin(lat) + cos(dec) * cos(ha) * cos(lat));
  const tangent = abs(altitude) < 1.57079615 ? tan(altitude) : 6e6;
  altitude *= RAD;
  let refraction = 0;
  if (altitude >= -1 && tangent !== 6e6) {
    refraction = altitude < 19.225
      ? (0.1594 + altitude * (0.0196 + 0.00002 * altitude)) * 1013.25 /
        ((1 + altitude * (0.505 + 0.0845 * altitude)) * 288)
      : 0.00452 * (1013.25 / 288) / tangent;
  }
  return { cza: cos((90 - altitude - refraction) * DEG), distance };
}
function esat(k: number) { return 1.004 * 6.1121 * exp(17.502 * (k - 273.15) / (k - 32.18)); }
function viscosity(k: number) {
  const omega = (k / 97 - 2.9) / 0.4 * -0.034 + 1.048;
  return 2.6693e-6 * sqrt(28.97 * k) / (3.617 * 3.617 * omega);
}
function conductivity(k: number) { return (CP + 1.25 * R_AIR) * viscosity(k); }
function diffusivity(k: number, p: number) {
  return 3.640e-4 * pow(k / sqrt(132 * 647.3), 2.334) * pow(36.4 * 218, 1 / 3) *
    pow(132 * 647.3, 5 / 12) * sqrt(1 / 28.97 + 1 / 18.015) / (p / 1013.25) * 1e-4;
}
function convection(k: number, p: number, speed: number, sphere: boolean) {
  const diameter = sphere ? 0.0508 : 0.007;
  const re = max(speed, 0.13) * p * 100 / (R_AIR * k) * diameter / viscosity(k);
  const nu = sphere ? 2 + 0.6 * sqrt(re) * pow(PR, 0.3333) : 0.281 * pow(re, 0.6) * pow(PR, 0.44);
  return nu * conductivity(k) / diameter;
}
function solve(initial: number, step: (previous: number) => number): Component {
  let previous = initial;
  for (let iterations = 1; iterations <= 50; iterations++) {
    const candidate = step(previous);
    if (!Number.isFinite(candidate)) return { status: 'nonfinite', temperatureC: null, iterations };
    if (abs(candidate - previous) < 0.02) return { status: 'success', temperatureC: candidate - 273.15, iterations };
    previous = 0.9 * previous + 0.1 * candidate;
  }
  return { status: 'nonconvergence', temperatureC: null, iterations: 50 };
}
/** Pure outdoor WBGT calculation. Successful numerics do not approve input assumptions or heat categories. */
export function calculateWbgt(input: HeatInput): HeatResult {
  if (!input || typeof input !== 'object') return { status: 'invalid_input', reason: 'input required' };
  const { temperatureC: tc, humidityPercent: humidity, surfacePressureHpa: p, wind2mMs: wind, ghiWm2: rawSolar, latitude, longitude } = input;
  if (![tc, humidity, p, wind, rawSolar, latitude, longitude].every(Number.isFinite))
    return { status: 'invalid_input', reason: 'all meteorological inputs and coordinates must be finite numbers' };
  if (humidity <= 0 || humidity > 100 || p <= 0 || wind < 0 || rawSolar < 0 || abs(latitude) > 90 || abs(longitude) > 180)
    return { status: 'invalid_input', reason: 'humidity, pressure, wind, radiation or coordinates outside physical input bounds' };
  if (typeof input.windAssumption !== 'string' || !input.windAssumption.trim() || input.radiationAssumption !== 'instantaneous' || typeof input.source !== 'string' || !input.source.trim())
    return { status: 'invalid_input', reason: 'explicit 2m wind, instantaneous radiation and source provenance required' };
  if (typeof input.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(input.time))
    return { status: 'invalid_input', reason: 'canonical UTC ISO instant with zero seconds required' };
  const date = new Date(input.time);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().replace('.000Z', 'Z') !== input.time.replace('.000Z', 'Z'))
    return { status: 'invalid_input', reason: 'invalid calendar date' };
  if (date.getUTCFullYear() < 1950 || date.getUTCFullYear() > 2049)
    return { status: 'unsupported_domain', reason: 'reference solar geometry supports 1950–2049' };
  // Deliberate engineering envelope, not a claimed validated meteorological range.
  if (tc < -50 || tc > 60 || p < 200 || p > 1100 || wind > 100 || rawSolar > 2000)
    return { status: 'unsupported_domain', reason: 'outside bounded implementation envelope; see reference documentation' };
  const tk = tc + 273.15, rh = humidity * 0.01, eair = rh * esat(tk);
  if (eair >= p) return { status: 'invalid_input', reason: 'water vapor pressure must be below total pressure' };
  const { cza, distance } = solarGeometry(date, latitude, longitude);
  let solar = rawSolar, fdir = 0;
  const toa = cza < 0.00873 ? 0 : 1367 * max(0, cza) / (distance * distance);
  if (toa > 0) {
    const normalized = min(solar / toa, 0.85);
    solar = normalized * toa;
    if (normalized > 0) fdir = max(min(exp(3 - 1.34 * normalized - 1.65 / normalized), 0.9), 0);
  }
  const warnings = ['modeled outdoor sensors; surface temperature equals air temperature'];
  if (p <= 800) warnings.push('fixed vapor-pressure enhancement extrapolated at pressure <=800 hPa');
  if (cza < 0.00873 && rawSolar > 0) warnings.push('nonzero instantaneous GHI at reference horizon; retained as supplied');
  if (input.wind2mMs < 0.13) warnings.push('reference heat-transfer wind floor applied');
  const longwave = 0.5 * (0.575 * pow(eair, 0.143) + 0.999) * pow(tk, 4);
  const globe = solve(tk, previous => {
    const h = convection(0.5 * (previous + tk), p, wind, true);
    // The zero-direct branch avoids 0 * Infinity at exact horizon without changing the limit.
    const beam = fdir === 0 ? 0 : fdir * (1 / (2 * cza) - 1);
    return pow(longwave - h / (SB * 0.95) * (previous - tk) + solar / (2 * SB * 0.95) * 0.95 * (beam + 1 + 0.45), 0.25);
  });
  const z = log(eair / (6.1121 * 1.004)), dew = 273.15 + 240.97 * z / (17.502 - z);
  let evaporationExtrapolated = false;
  const wet = (radiative: boolean) => solve(dew, previous => {
    const ref = 0.5 * (previous + tk);
    if (ref < 283 || ref > 313) evaporationExtrapolated = true;
    const h = convection(ref, p, wind, false);
    const beam = fdir === 0 ? 0 : fdir * (tan(acos(cza)) / PI + 0.25 * 0.007 / 0.0254);
    const flux = SB * 0.95 * (longwave - pow(previous, 4)) + 0.6 * solar *
      ((1 - fdir) * (1 + 0.25 * 0.007 / 0.0254) + beam + 0.45);
    const ewick = esat(previous);
    if (ewick >= p) return NaN;
    const density = p * 100 / (R_AIR * ref), schmidt = viscosity(ref) / (density * diffusivity(ref, p));
    const evaporation = (313.15 - ref) / 30 * -71100 + 2.4073e6;
    return tk - evaporation / RATIO * (ewick - eair) / (p - ewick) * pow(PR / schmidt, 0.56) + (radiative ? flux / h : 0);
  });
  const naturalWetBulb = wet(true), psychrometricWetBulb = wet(false);
  if (evaporationExtrapolated) warnings.push('evaporation linearization evaluated outside documented 283–313 K range');
  const diagnostics: HeatDiagnostics = {
    calculationVersion: CALCULATION_VERSION, referenceRevision: REFERENCE_REVISION,
    input: { ...input }, windUsedMs: max(wind, 0.13), windFloored: wind < 0.13,
    ghiUsedWm2: solar, ghiCapped: rawSolar > solar + 1e-10,
    cosineSolarZenith: cza, directFraction: fdir, warnings, globe, naturalWetBulb, psychrometricWetBulb,
  };
  if (globe.status !== 'success' || naturalWetBulb.status !== 'success' || psychrometricWetBulb.status !== 'success')
    return { status: 'component_failure', wbgtC: null, diagnostics };
  return { status: 'success', wbgtC: 0.1 * tc + 0.2 * globe.temperatureC + 0.7 * naturalWetBulb.temperatureC, diagnostics };
}
