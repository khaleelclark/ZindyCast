// Manual bounded live check: exactly two archive GETs, no retries. Not part of npm test.
import { writeFile } from 'node:fs/promises';
import { getReanalysis, renderReanalysisCsv } from '../../../packages/history/src/index.js';

const nativeFetch = globalThis.fetch;
let count = 0;
const requests: unknown[] = [];
globalThis.fetch = async (input, init) => {
  if (++count > 2) throw new Error('Live sample budget exhausted');
  const beganAt = new Date().toISOString();
  const response = await nativeFetch(input, init);
  requests.push({ url: String(input), beganAt, headersAt: new Date().toISOString(), status: response.status,
    contentType: response.headers.get('content-type'), date: response.headers.get('date') });
  return response;
};
const results: unknown[] = [];
try {
  for (const [name, query] of [
    ['new-york-march-2020', { latitude: 40.7128, longitude: -74.006, startDate: '2020-03-01', endDate: '2020-03-31' }],
    ['honolulu-january-1940', { latitude: 21.3069, longitude: -157.8583, startDate: '1940-01-01', endDate: '1940-01-01' }],
  ] as const) {
    try {
      const data = await getReanalysis(query);
      await writeFile(new URL(`./${name}.json`, import.meta.url), JSON.stringify(data, null, 2) + '\n');
      await writeFile(new URL(`./${name}.csv`, import.meta.url), renderReanalysisCsv(data, name));
      results.push({ name, outcome: 'success', completeness: data.completeness, sourceCoordinates: data.provenance.sourceCoordinates,
        firstTime: data.hours[0].time, lastTime: data.hours.at(-1)?.time });
    } catch (error) {
      results.push({ name, outcome: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
} finally { globalThis.fetch = nativeFetch; }
await writeFile(new URL('./live-manifest.json', import.meta.url), JSON.stringify({ completedAt: new Date().toISOString(), count, requests, results }, null, 2) + '\n');
console.log(JSON.stringify({ count, results }, null, 2));
