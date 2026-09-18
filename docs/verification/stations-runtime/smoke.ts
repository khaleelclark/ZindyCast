// Manual network check: exactly one full station GET, no retries. Do not include in tests.
import { writeFile } from 'node:fs/promises';
import { getStationHistory } from '../../../packages/stations/src/index.js';
const requests: unknown[] = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const startedAt = new Date().toISOString();
  const response = await nativeFetch(input, init);
  requests.push({ url: String(input), startedAt, headersReceivedAt: new Date().toISOString(), status: response.status,
    contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length') });
  return response;
};
try {
  const data = await getStationHistory({ stationId: 'USC00021282', startDate: '2020-01-01', endDate: '2020-12-31' });
  await writeFile('docs/verification/stations-runtime/live-result.json', JSON.stringify(data,null,2)+'\n');
  console.log(JSON.stringify({retrievedAt:data.provenance.retrievedAt,coverage:data.coverage}));
} finally {
  globalThis.fetch = nativeFetch;
  await writeFile('docs/verification/stations-runtime/live-manifest.json', JSON.stringify(requests,null,2)+'\n');
}
