/** Explicitly opt-in: exactly one Open-Meteo forecast GET; no retry. */
import { writeFile } from 'node:fs/promises';
import { getForecast } from '../../../packages/providers/src/index.js';

if (process.env.ZINDY_WBGT_LIVE !== '1') throw new Error('Set ZINDY_WBGT_LIVE=1 to authorize one forecast request.');
const realFetch = globalThis.fetch;
const requests: unknown[] = [];
globalThis.fetch = async (input, init) => {
  if (requests.length) throw new Error('Live request cap exceeded.');
  const entry = { url: String(input), startedAt: new Date().toISOString(), status: 0, contentType: '', contentLength: '' };
  requests.push(entry);
  const response = await realFetch(input, init);
  entry.status = response.status;
  entry.contentType = response.headers.get('content-type') ?? '';
  entry.contentLength = response.headers.get('content-length') ?? '';
  return response;
};
try {
  const result = await getForecast({ id: 'manual:honolulu', name: 'Honolulu', latitude: 21.31,
    longitude: -157.86, timezone: 'Pacific/Honolulu', country: 'US' });
  await writeFile(new URL('./live-result.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  const summary = { requests, completedAt: new Date().toISOString(), provenance: result.provenance,
    hours: result.hours.length, missingFields: result.missingFields,
    success: result.hours.filter(hour => hour.wbgt?.status === 'success').length,
    unavailable: result.hours.filter(hour => hour.wbgt?.status === 'unavailable').length,
    serializedBytes: Buffer.byteLength(JSON.stringify(result)),
    reasons: [...new Set(result.hours.map(hour => hour.wbgt?.reason).filter(Boolean))],
    note: 'Normalized live provider result, not raw upstream; bounded availability evidence, not observational accuracy or browser acceptance.' };
  await writeFile(new URL('./live-manifest.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally { globalThis.fetch = realFetch; }
