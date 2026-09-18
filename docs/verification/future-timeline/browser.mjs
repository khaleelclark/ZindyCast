const { chromium, expect } = await import('@playwright/test');
const { createServer } = await import('node:http');
const { readFile, writeFile } = await import('node:fs/promises');
const { resolve, extname } = await import('node:path');
const raw=JSON.parse(await readFile('docs/verification/future-radar-review/catalog.json'));
const run='2026-09-11T14:00:00Z';
raw.data.modelRunTime=run;raw.data.evaluatedAt='2026-09-11T16:15:00Z';raw.data.retrievedAt='2026-09-11T16:00:00Z';raw.data.horizonEnd='2026-09-12T08:00:00Z';
raw.data.frames=Array.from({length:12},(_,i)=>({id:'hrrr-202609111400-f'+String(150+i*15).padStart(4,'0'),modelRunTime:run,forecastLeadMinutes:150+i*15,validTime:new Date(Date.parse(run)+(150+i*15)*60000).toISOString()}));raw.data.defaultFrameId=raw.data.frames[0].id;
const root = process.env.FORECAST_MAP_DIST;
const catalog=JSON.parse(await readFile('docs/verification/map-fix/catalog.json'));
const observed=JSON.parse(await readFile('docs/verification/map-fix/frame.json'));
const doc=await readFile('docs/decisions/future-radar.md','utf8');
const png=Buffer.from(doc.split('base64\n')[1].split('\n' + String.fromCharCode(96).repeat(3))[0],'base64');
const requests=[],errors=[],catalogRequests=[],observedCatalogRequests=[]; let fail=false,active=0,maxActive=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');if(u.pathname==='/api/v1/maps'){observedCatalogRequests.push(Date.now());return res.end(JSON.stringify(catalog));}if(u.pathname==='/api/v1/maps/frame'){const f=structuredClone(observed);Object.assign(f.data,{projection:'EPSG:3857',productId:u.searchParams.get('product'),requestedTime:u.searchParams.get('time')});return res.end(JSON.stringify(f));}if(u.pathname==='/api/v1/maps/forecast/catalog'){catalogRequests.push(Date.now());return res.end(JSON.stringify(raw));}if(u.pathname.startsWith('/api/v1/maps/forecast/tiles/')){requests.push(u.pathname);maxActive=Math.max(maxActive,++active);await new Promise(r=>setTimeout(r,50));active--;if(fail){res.statusCode=429;res.setHeader('Retry-After','60');return res.end('{}');}const f=raw.data.frames.find(f=>u.pathname.includes('/'+f.id+'/'));for(const [k,v] of Object.entries({'Content-Type':'image/png','X-Forecast-Product':'forecast-hrrr-conus','X-Forecast-Frame':f.id,'X-Forecast-Model-Run':f.modelRunTime,'X-Forecast-Valid-Time':f.validTime,'X-Forecast-Source-Time-Status':'pinned_model_run_requested'}))res.setHeader(k,v);return res.end(png);}res.statusCode=503;return res.end(JSON.stringify({status:'error',code:'provider_error',message:'Explicit fixture unavailable'}));}const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html'})[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch(e){res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});

const results=[];
try {
 if (!process.env.EDGE_ONLY) for (const [name,width,height] of [['mobile',390,844],['desktop',1440,1000]]) {
  const c=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});
  await c.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:'+server.address().port?r.continue():r.abort());
  await c.addInitScript(()=>{const l={id:'roseville',name:'Roseville',country:'US',latitude:38.75,longitude:-121.29,timezone:'America/Los_Angeles'};localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[l],selected:l}));});
  const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-09-11T16:15:00Z')});
  await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');
  await p.evaluate(()=>{window.originalCanvas=document.querySelector('.maplibregl-canvas');window.markerTransform=document.querySelector('.maplibregl-marker')?.style.transform;});
  const begin=requests.length;await p.getByRole('button',{name:'Future radar',exact:true}).click();const slider=p.getByRole('slider',{name:'Future forecast time',exact:true});await expect(slider).toHaveAttribute('max','11');await expect(p.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  const tileCount=requests.length-begin;const capacity=Math.min(6,Math.floor(32/tileCount));expect([4,6]).toContain(capacity);
  // A late manual choice does not restrict Play to a partial horizon.
  await slider.focus();await slider.press('End');await p.waitForTimeout(1300);await expect(p.getByRole('button',{name:'Play',exact:true})).toBeEnabled();
  await p.getByRole('button',{name:'Play',exact:true}).click();await expect(slider).toHaveValue('0');
  const expected=Array.from({length:capacity},(_,i)=>String(Math.round(i*11/(capacity-1))));
  const indices=[];for(let i=0;i<160;i++){const value=await slider.inputValue();if(indices.at(-1)!==value)indices.push(value);await p.waitForTimeout(100);}
  expect([...new Set(indices)]).toEqual(expected);expect(indices.filter(x=>x==='11').length).toBeGreaterThanOrEqual(2);
  await expect(p.getByText('Playback samples '+capacity+' forecast times',{exact:true})).toBeVisible();
  const warm=requests.length;await p.waitForTimeout(6500);expect(requests.length).toBe(warm);
  expect(await p.evaluate(()=>window.originalCanvas===document.querySelector('.maplibregl-canvas')&&window.markerTransform===document.querySelector('.maplibregl-marker')?.style.transform)).toBe(true);
  expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await p.screenshot({path:'docs/verification/future-timeline/'+name+'.png',fullPage:true});
  await c.setOffline(true);await expect(p.getByText('Offline — future radar unavailable.',{exact:true})).toBeVisible();const off=requests.length;await p.waitForTimeout(1100);expect(requests.length).toBe(off);await c.setOffline(false);await expect(p.getByRole('button',{name:'Play',exact:true})).toBeVisible();
  results.push({name,tileCount,capacity,expected,indices,warmCacheExtraRequests:requests.length-off,sameCanvasCamera:true});await c.close();
 }
 if (!process.env.EDGE_ONLY) expect(results.map(r=>r.capacity).sort()).toEqual([4,6]);
 const advertised=raw.data.frames;
 for(const mode of ['missing','expired']) {
  raw.data.frames=mode==='missing'?[]:advertised;
  const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await c.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:'+server.address().port?r.continue():r.abort());
  await c.addInitScript(()=>{const l={id:'roseville',name:'Roseville',country:'US',latitude:38.75,longitude:-121.29,timezone:'America/Los_Angeles'};localStorage.setItem('zindycast.preferences.v1',JSON.stringify({units:'us',activity:'walking',saved:[l],selected:l}));});
  const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-09-11T16:15:00Z')});await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('tab',{name:'Maps',exact:true}).click();await expect(p.locator('.interactive-map')).toHaveAttribute('data-weather-ready','true');const before=requests.length;await p.getByRole('button',{name:'Future radar',exact:true}).click();
  if(mode==='missing'){await expect(p.getByRole('alert').filter({hasText:'Future radar unavailable'})).toBeVisible();expect(requests.length).toBe(before);}
  else{await expect(p.getByRole('button',{name:'Play',exact:true})).toBeEnabled();await p.getByRole('button',{name:'Play',exact:true}).click();await p.clock.fastForward(2*3600000);await expect(p.getByText('Selected forecast time has expired or is unavailable. Refresh forecast times.',{exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Pause',exact:true})).not.toBeVisible();}
  const stopped=requests.length;await p.waitForTimeout(1200);expect(requests.length).toBe(stopped);results.push({name:mode,noFurtherTileRequests:true});await c.close();
 }
 expect(errors).toEqual([]);
} finally {await writeFile('docs/verification/future-timeline/'+(process.env.EDGE_ONLY?'edge-results.json':'results.json'),JSON.stringify({results,errors,requests,fixtureOnly:true},null,2));await browser.close();await new Promise(r=>server.close(r));}
