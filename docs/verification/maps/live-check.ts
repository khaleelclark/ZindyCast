// Explicit bounded live audit: exactly one metadata GET and one frame GET, no retries.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CAPABILITIES_URL, getMapCatalog, fetchMapImage, buildMapRequest } from '../../../packages/maps/src/index.js';
const nativeFetch = globalThis.fetch;
const requests: unknown[] = [];
globalThis.fetch = async (input, init) => {
  const requestedAt = new Date().toISOString();
  const response = await nativeFetch(input, init);
  requests.push({url:String(input),requestedAt,status:response.status,headers:Object.fromEntries(response.headers)});
  return response;
};
try {
  const catalog = await getMapCatalog();
  await writeFile(new URL('live-catalog.json',import.meta.url),JSON.stringify(catalog,null,2));
  const product = catalog.products.find(p => p.id === 'radar-alaska')!;
  if (product.status !== 'available') throw Error(product.unavailableReason ?? 'Unavailable');
  const time = product.times.at(-1)!;
  const bbox = [-170,52,-130,72] as const;
  const image = await fetchMapImage(product.id,bbox,800,500,time,catalog);
  await writeFile(new URL('live-alaska-radar.png',import.meta.url),image.bytes);
  const {bytes,...metadata} = image;
  await writeFile(new URL('live-result.json',import.meta.url),JSON.stringify({catalogSource:CAPABILITIES_URL,requestUrl:buildMapRequest(product.id,bbox,800,500,time,catalog).href,...metadata,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
  console.log(JSON.stringify({products:catalog.products.map(p=>({id:p.id,status:p.status,frames:p.times.length})),imageBytes:bytes.length,warning:image.warning,requestedTime:time,actualSourceTime:image.actualSourceTime}));
} finally {
  await writeFile(new URL('live-requests.json',import.meta.url),JSON.stringify(requests,null,2));
  globalThis.fetch = nativeFetch;
}
