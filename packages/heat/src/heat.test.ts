import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateWbgt, heatEducation, type Component, type HeatInput } from './index';
const cases = JSON.parse(readFileSync(new URL('../../../docs/verification/heat/oracle-cases.json', import.meta.url), 'utf8')) as {
  id: string; input: HeatInput; expected: { globeC: number; naturalWetBulbC: number; psychrometricWetBulbC: number; wbgtC: number; originalStatus: number; cosineSolarZenith: number; directFraction: number; ghiUsedWm2: number }
}[];
const toleranceC = 0.01; // Float C versus double TS; see verification report, not a weather accuracy bound.
for (const c of cases) test(`independent C oracle: ${c.id}`, () => {
  const actual = calculateWbgt(c.input);
  assert.ok(actual.status === 'success' || actual.status === 'component_failure');
  assert.ok(Math.abs(actual.diagnostics.cosineSolarZenith-c.expected.cosineSolarZenith)<1e-6);
  assert.ok(Math.abs(actual.diagnostics.directFraction-c.expected.directFraction)<1e-5);
  assert.ok(Math.abs(actual.diagnostics.ghiUsedWm2-c.expected.ghiUsedWm2)<0.001);
  for (const [component, key] of [['globe','globeC'], ['naturalWetBulb','naturalWetBulbC'], ['psychrometricWetBulb','psychrometricWetBulbC']] as const) {
    const expected = c.expected[key];
    const result: Component = actual.diagnostics[component];
    if (expected === -9999) { assert.notEqual(result.status,'success'); assert.equal(result.temperatureC,null); }
    else {
      assert.equal(result.status,'success');
      assert.ok(Math.abs(result.temperatureC! - expected) <= toleranceC, `${component}: ${result.temperatureC} vs ${expected}`);
    }
  }
  if (c.expected.originalStatus === 0 && c.expected.psychrometricWetBulbC !== -9999) {
    assert.equal(actual.status,'success');
    assert.ok(Math.abs(actual.wbgtC! - c.expected.wbgtC) <= toleranceC);
    const d=actual.diagnostics;
    assert.equal(actual.wbgtC, 0.1*c.input.temperatureC + 0.2*d.globe.temperatureC! + 0.7*d.naturalWetBulb.temperatureC!);
  } else { assert.equal(actual.status,'component_failure'); assert.equal(actual.wbgtC,null); }
});
const base = cases[0].input;
test('invalid, missing, unsupported and temporal inputs are explicit', () => {
  for (const patch of [
    { humidityPercent: 0 }, { humidityPercent: 101 }, { surfacePressureHpa: 0 }, { wind2mMs: -1 },
    { ghiWm2: -1 }, { temperatureC: NaN }, { wind2mMs: undefined }, { latitude: Infinity },
    { longitude: 181 }, { windAssumption: '' }, { radiationAssumption: 'preceding-hour' }, { source: '' },
    { time: '2020-02-30T00:00:00Z' }, { time: '2020-01-01T24:00:00Z' },
    { time: '2020-07-15T13:00:00-07:00' }, { time: '2020-07-15T20:00:01Z' },
  ]) assert.equal(calculateWbgt({ ...base, ...patch } as HeatInput).status,'invalid_input',JSON.stringify(patch));
  for (const patch of [{ time:'1949-12-31T23:59:00Z' }, { time:'2050-01-01T00:00:00Z' }, { temperatureC:61 }, { surfacePressureHpa:199 }])
    assert.equal(calculateWbgt({...base,...patch}).status,'unsupported_domain');
});
test('floor, cap, extrapolation and provenance remain visible', () => {
  const calm=calculateWbgt({...base,wind2mMs:0}), floor=calculateWbgt({...base,wind2mMs:0.13});
  assert.equal(calm.status,'success'); assert.equal(floor.status,'success');
  if (calm.status !== 'success' || floor.status !== 'success') return;
  assert.equal(calm.wbgtC,floor.wbgtC); assert.equal(calm.diagnostics.windUsedMs,0.13);
  assert.equal(calm.diagnostics.windFloored,true); assert.equal(floor.diagnostics.windFloored,false);
  assert.equal(calm.diagnostics.input.wind2mMs,0);
  const cap=calculateWbgt({...base,ghiWm2:2000,surfacePressureHpa:750});
  assert.ok(cap.status==='success'||cap.status==='component_failure');
  assert.equal(cap.diagnostics.ghiCapped,true);
  assert.equal(cap.diagnostics.input.ghiWm2,2000);
  assert.ok(cap.diagnostics.warnings.some(w=>w.includes('<=800')));
});
test('activity guidance is separate from metrics and never creates a category', () => {
  for (const activity of ['relaxing','walking','strenuous'] as const) {
    const guidance=heatEducation(activity);
    assert.equal(guidance.category,null); assert.equal(guidance.categoricalNotificationsEnabled,false);
    assert.equal(guidance.categoryUnavailableReason,'policy_unapproved');
    assert.ok(guidance.message.length>0);
  }
  assert.throws(()=>heatEducation('unknown' as never),RangeError);
});
