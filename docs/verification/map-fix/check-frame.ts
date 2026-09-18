import {readFileSync,writeFileSync} from 'node:fs';
import {fetchMapImage,buildMapRequest,type MapCatalog} from '../../../packages/maps/src/index.js';
const catalog=JSON.parse(readFileSync('docs/verification/map-fix/catalog.json','utf8')).data as MapCatalog;
const time=catalog.products[0]!.times.at(-1)!;
const frame=await fetchMapImage('radar-conus',[-125,24,-66,50],800,500,time,catalog);
writeFileSync('docs/verification/map-fix/conus.png',frame.bytes);
writeFileSync('docs/verification/map-fix/conus-metadata.json',JSON.stringify({url:buildMapRequest('radar-conus',[-125,24,-66,50],800,500,time,catalog).href,...frame,bytes:frame.bytes.length,imageBase64Length:frame.bytes.toString('base64').length},null,2));
console.log({...frame,bytes:frame.bytes.length});
