import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createApp} from './app.js';
import {serveWeb} from './static.js';
test('production shell revalidates, API bypasses caches and unknown data never becomes HTML',async()=>{
 const app=createApp({searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');}});
 await serveWeb(app,resolve('apps/web/dist'));
 for(const url of ['/', '/?shell-release-check=1','/sw.js','/manifest.webmanifest']) { const r=await app.inject(url);assert.equal(r.statusCode,200,url);assert.equal(r.headers['cache-control'],'no-cache');assert.equal(r.headers['x-frame-options'],'DENY');assert.match(String(r.headers['content-security-policy']), /script-src 'self';/);assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/);assert.equal(r.headers['referrer-policy'],'strict-origin-when-cross-origin'); }
 const health=await app.inject('/api/v1/health');assert.equal(health.headers['cache-control'],'no-store');
 const missing=await app.inject('/api/v1/missing');assert.equal(missing.statusCode,404);assert.ok(!missing.body.includes('<html'));
 await app.close();
});

test('oversized and malformed request bodies remain client errors without reflecting payloads',async()=>{
 const app=createApp({searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');}});
 const large=await app.inject({method:'POST',url:'/api/v1/installations',headers:{'content-type':'application/json'},payload:JSON.stringify({value:'private'.repeat(4000)})});
 assert.equal(large.statusCode,413);assert.ok(!large.body.includes('private'));
 const bad=await app.inject({method:'POST',url:'/api/v1/installations',headers:{'content-type':'application/json'},payload:'{'});
 assert.equal(bad.statusCode,400);await app.close();
});

test('compressed public assets negotiate encoding with exact decoded bytes and cache variation',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {gzipSync,gunzipSync,brotliCompressSync,brotliDecompressSync}=await import('node:zlib');
 const root=await mkdtemp(resolve(tmpdir(),'zindy-encoding-'));const bytes=Buffer.from('console.log("weather");\n'.repeat(100));
 const app=createApp({searchLocations:async()=>[],getForecast:async()=>{throw Error('unused');}});
 try{await writeFile(resolve(root,'app.js'),bytes);await writeFile(resolve(root,'app.js.br'),brotliCompressSync(bytes));await writeFile(resolve(root,'app.js.gz'),gzipSync(bytes));await serveWeb(app,root);
 for(const encoding of ['br','gzip','identity']){const r=await app.inject({url:'/app.js',headers:{'accept-encoding':encoding}});assert.equal(r.statusCode,200);assert.match(String(r.headers.vary),/accept-encoding/i);const decoded=encoding==='br'?brotliDecompressSync(r.rawPayload):encoding==='gzip'?gunzipSync(r.rawPayload):r.rawPayload;assert.deepEqual(decoded,bytes);assert.equal(r.headers['content-encoding'],encoding==='identity'?undefined:encoding);}
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
