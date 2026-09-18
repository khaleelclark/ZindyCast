import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WbgtEstimateSchema } from '@zindycast/contracts';
import { deriveForecastWbgt, FAO56_WIND_10M_TO_2M, type ForecastWbgtHour, type HeatInput } from './index';
const coordinates = { latitude: 28.90, longitude: -81.26 };
const hour: ForecastWbgtHour = { time: '2020-07-15T18:00:00Z', temperatureC: 33, humidityPercent: 75, surfacePressureHpa: 1010, windSpeedMs: 3, shortwaveInstantWm2: 800, shortwaveMeanWm2: 700 };
const derive = (patch: Partial<ForecastWbgtHour> = {}) => WbgtEstimateSchema.parse(deriveForecastWbgt({ ...hour, ...patch }, coordinates, 'synthetic verification'));
test('FAO conversion, raw inputs, geometry and separate components survive the REST contract', () => {
  assert.ok(Math.abs(FAO56_WIND_10M_TO_2M - 0.7479510751679441) < 1e-15);
  const result = derive(); assert.equal(result.status, 'success');
  assert.equal(result.wind10mMs, 3); assert.equal(result.wind2mMs, 3 * FAO56_WIND_10M_TO_2M);
  const d = result.diagnostics!;
  assert.equal(d.input.latitude, coordinates.latitude); assert.equal(d.input.longitude, coordinates.longitude);
  assert.equal(d.input.ghiWm2, 800); assert.equal(d.input.source, 'synthetic verification');
  assert.equal(d.input.radiationAssumption, 'instantaneous');
  assert.equal(result.valueC, .1 * hour.temperatureC! + .2 * d.globe.temperatureC! + .7 * d.naturalWetBulb.temperatureC!);
  assert.notEqual(d.psychrometricWetBulb.temperatureC, d.naturalWetBulb.temperatureC);
  assert.deepEqual(derive({ shortwaveMeanWm2: null }), result);
});
test('calm night retains legitimate zeros and the solver floor', () => {
  const result = derive({ time: '2020-07-16T06:00:00Z', windSpeedMs: 0, shortwaveInstantWm2: 0 });
  assert.equal(result.status, 'success'); assert.equal(result.wind2mMs, 0);
  assert.equal(result.diagnostics!.windUsedMs, .13); assert.equal(result.diagnostics!.windFloored, true);
  assert.equal(result.diagnostics!.input.ghiWm2, 0);
});
test('missing inputs never use mean GHI or ordinary wet bulb as substitutes', () => {
  for (const field of ['temperatureC','humidityPercent','surfacePressureHpa','windSpeedMs','shortwaveInstantWm2'] as const) {
    const result = derive({ [field]: null }); assert.equal(result.status, 'unavailable');
    assert.equal(result.valueC, null); assert.equal(result.diagnostics, null); assert.match(result.reason!, new RegExp(field));
  }
  assert.match(derive({ shortwaveInstantWm2: undefined }).reason!, /missing_input/);
});
test('invalid dates, unsupported years/domain and malformed values fail explicitly', () => {
  for (const patch of [{ time: '2020-02-30T00:00:00Z' }, { time: '2020-07-15T18:00:01Z' }, { temperatureC: NaN }, { humidityPercent: 0 }, { windSpeedMs: -1 }, { windSpeedMs: Infinity }, { shortwaveInstantWm2: -1 }]) {
    assert.match(derive(patch).reason!, /^invalid_input:/);
  }
  for (const patch of [{ time: '2050-01-01T00:00:00Z' }, { temperatureC: 61 }, { surfacePressureHpa: 199 }]) assert.match(derive(patch).reason!, /^unsupported_domain:/);
  assert.match(deriveForecastWbgt(hour, { ...coordinates, latitude: 91 }, 'synthetic').reason!, /^invalid_input:/);
  assert.match(deriveForecastWbgt(hour, coordinates, '').reason!, /^invalid_input:/);
});
test('adapter preserves independent C oracle horizon, cap, domain and failure diagnostics', () => {
  const cases = JSON.parse(readFileSync(new URL('../../../docs/verification/heat/oracle-cases.json', import.meta.url), 'utf8')) as { id: string; input: HeatInput; expected: { wbgtC: number; originalStatus: number; psychrometricWetBulbC: number } }[];
  for (const c of cases) {
    const i = c.input;
    // Invert the accepted conversion only to reuse independent C solver inputs.
    const result = WbgtEstimateSchema.parse(deriveForecastWbgt({ time: i.time, temperatureC: i.temperatureC, humidityPercent: i.humidityPercent, surfacePressureHpa: i.surfacePressureHpa, windSpeedMs: i.wind2mMs / FAO56_WIND_10M_TO_2M, shortwaveInstantWm2: i.ghiWm2 }, i, i.source));
    if (c.expected.originalStatus === 0 && c.expected.psychrometricWetBulbC !== -9999) {
      assert.equal(result.status, 'success', c.id); assert.ok(Math.abs(result.valueC! - c.expected.wbgtC) < .01, c.id);
    } else {
      assert.equal(result.status, 'unavailable', c.id); assert.match(result.reason!, /^component_failure:/);
      assert.equal(result.diagnostics!.globe.status, 'nonconvergence');
      assert.equal(result.diagnostics!.psychrometricWetBulb.status, 'success');
    }
  }
});
