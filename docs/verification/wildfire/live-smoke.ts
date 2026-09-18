/** Manual only. At most two GETs; no retry, no automatic test invocation. */
import { writeFileSync } from 'node:fs';
import { getWildfires } from '../../../packages/providers/src/wildfire.js';
const original = globalThis.fetch;
const requests: unknown[] = [];
const directory = new URL('./', import.meta.url);
globalThis.fetch = async (input, init) => {
  if (requests.length >= 2) throw new Error('Two live GET limit reached');
  const record: Record<string, unknown> = { url: String(input), requestedAt: new Date().toISOString() };
  requests.push(record);
  try {
    const response = await original(input, init);
    record.status = response.status; record.contentType = response.headers.get('content-type');
    return response;
  } catch (error) { record.error = String(error); throw error; }
};
try {
  const data = await getWildfires({ west: -152, south: 64, east: -149, north: 66 });
  writeFileSync(new URL('live-result.json', directory), JSON.stringify(data, null, 2) + '\n');
  console.log({ incidents: data.incidents.length, perimeters: data.perimeters.length, retrievedAt: data.retrievedAt });
} catch (error) { console.error(String(error)); process.exitCode = 1; }
finally {
  globalThis.fetch = original;
  writeFileSync(new URL('live-manifest.json', directory), JSON.stringify({ note: 'Normalized output, not raw upstream. At most two live requests.', requests }, null, 2) + '\n');
}
