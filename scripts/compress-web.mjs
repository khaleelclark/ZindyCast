import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {brotliCompressSync,gzipSync,constants} from 'node:zlib';
// Public build artifacts only. API data, credentials and user files never enter this path.
const root=resolve('apps/web/dist');let before=0,after=0,count=0;
async function visit(path){for(const entry of await readdir(path,{withFileTypes:true})){const target=join(path,entry.name);if(entry.isDirectory())await visit(target);else if(entry.isFile()&&/\.(?:js|mjs|css|html|svg|json|webmanifest|txt)$/.test(entry.name)){const bytes=await readFile(target);if(bytes.length<1024)continue;const br=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}),gz=gzipSync(bytes,{level:6});if(br.length<bytes.length)await writeFile(target+'.br',br);if(gz.length<bytes.length)await writeFile(target+'.gz',gz);before+=bytes.length;after+=Math.min(bytes.length,br.length);count++;}}}
await visit(root);console.log(`Compressed ${count} public assets: ${before} → ${after} bytes (Brotli).`);
