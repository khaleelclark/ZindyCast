import {readFile,writeFile} from 'node:fs/promises';
const raw=JSON.parse(await readFile('docs/verification/radar-deep-audit/timings.json'));
function stats(a){a=a.filter(Number.isFinite).sort((a,b)=>a-b);return {n:a.length,min:a[0],median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)};}
const results=raw.results.map(r=>({width:r.width,scenePaused:r.paused,frameRequests:r.frameRequests,swaps:r.indices.length,indexIntervalsMs:stats(r.indices.slice(1).map((v,i)=>v.at-r.indices[i].at)),imageLoads:r.loads.length,loadMs:stats(r.loads.map(e=>e.duration)),uploads:r.uploads.length,uploadCallMs:stats(r.uploads.map(e=>e.duration)),rafMs:stats(r.raf),longTasks:stats(r.long.map(e=>e.duration))}));
await writeFile('docs/verification/radar-deep-audit/summary.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
