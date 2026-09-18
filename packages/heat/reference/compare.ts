/** Reports TS errors against stored C expectations; never generates expectations. */
import { readFileSync, writeFileSync } from 'node:fs';
import { calculateWbgt } from '../src/index';
const cases = JSON.parse(readFileSync(new URL('../../../docs/verification/heat/oracle-cases.json', import.meta.url),'utf8'));
const maxima: Record<string, number> = { globeC:0, naturalWetBulbC:0, psychrometricWetBulbC:0, wbgtC:0, cosineSolarZenith:0, directFraction:0, ghiUsedWm2:0 };
const failures: unknown[] = [];
for (const c of cases) {
  const r=calculateWbgt(c.input);
  if (r.status!=='success' && r.status!=='component_failure') throw Error(c.id);
  const d=r.diagnostics;
  const fields={ globeC:d.globe.temperatureC,naturalWetBulbC:d.naturalWetBulb.temperatureC,psychrometricWetBulbC:d.psychrometricWetBulb.temperatureC,wbgtC:r.wbgtC,cosineSolarZenith:d.cosineSolarZenith,directFraction:d.directFraction,ghiUsedWm2:d.ghiUsedWm2 };
  for (const [key,value] of Object.entries(fields)) if (value!==null && c.expected[key]!==-9999) maxima[key]=Math.max(maxima[key],Math.abs(value-c.expected[key]));
  if(r.status==='component_failure') failures.push({id:c.id,status:r.status,globe:d.globe,naturalWetBulb:d.naturalWetBulb,psychrometricWetBulb:d.psychrometricWetBulb});
}
const report={cases:cases.length,toleranceC:0.01,maxAbsoluteDifference:maxima,failures};
writeFileSync(new URL('../../../docs/verification/heat/comparison.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
