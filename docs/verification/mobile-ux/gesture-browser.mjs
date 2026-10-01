// Run from repository root. Isolated UI fixtures; no weather/network services used.
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const bundle = await build({ stdin: { contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PullRefreshIndicator} from './apps/web/src/pull-refresh-indicator';
window.refreshes = 0; window.parentRenders = 0;
function App() {
 window.parentRenders++;
 const [enabled, setEnabled] = useState(true);
 window.setEnabled = setEnabled;
 return <div className="app-shell" data-weather="sunny"><PullRefreshIndicator enabled={enabled} refreshing={false} refresh={()=>window.refreshes++}/><h1 id="surface">Gesture test fixture</h1><button id="control">Control</button><div className="table-scroll"><div id="nested">Nested scroll</div></div><div style={{height:2000}}>Scrollable fixture</div></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const css = await readFile('apps/web/src/connected-grid.css', 'utf8');
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true});
const context = await browser.newContext({viewport: {width:390,height:844},hasTouch:true,serviceWorkers:'block'});
const page = await context.newPage();
const checks=[];
try {
 await page.route('**/*',route=>route.fulfill({body:`<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,contentType:'text/html'}));
 await page.goto('http://fixture.invalid');
 await page.evaluate(() => {
   window.blocking = new Set();
   const add=document.addEventListener.bind(document), remove=document.removeEventListener.bind(document);
   document.addEventListener=(type,callback,options)=>{if(type==='touchmove' && options?.passive===false)window.blocking.add(callback);add(type,callback,options);};
   document.removeEventListener=(type,callback,options)=>{if(type==='touchmove')window.blocking.delete(callback);remove(type,callback,options);};
 });
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForSelector('#surface');
 const event=async (type,x,y,target='#surface',count=1,cancelable=true)=>page.evaluate(({type,x,y,target,count,cancelable})=>{
   const element=document.querySelector(target);
   const touches=Array.from({length:count},(_,identifier)=>new Touch({identifier,target:element,clientX:x+identifier,clientY:y}));
   const event=new TouchEvent(type,{bubbles:true,cancelable,touches:type==='touchend'?[]:touches});
   element.dispatchEvent(event); return event.defaultPrevented;
 },{type,x,y,target,count,cancelable});
 const idle=async()=>assert.equal(await page.evaluate(()=>window.blocking.size),0);
 const distance=async value=>page.waitForFunction(value=>document.querySelector('.pull-refresh-indicator').style.getPropertyValue('--pull-distance')===value+'px',value);
 await idle();
 const renders=await page.evaluate(()=>window.parentRenders);
 await event('touchstart',100,100);
 assert.equal(await event('touchmove',100,200),true);
 await distance(55.00000000000001);
 assert.equal(await page.locator('.app-shell').evaluate(el=>getComputedStyle(el).transform),'none');
 await event('touchmove',100,280);
 await distance(96);
 assert.equal(await page.locator('.pull-refresh-indicator').textContent(),'Release to refresh');
 assert.equal(await page.evaluate(()=>window.parentRenders),renders);
 await event('touchend',100,280);
 await distance(0); await idle();
 assert.equal(await page.evaluate(()=>window.refreshes),1);
 checks.push('Threshold refresh fires once; indicator moves without rerendering or transforming dashboard; listener removed after release');
 await event('touchstart',100,100); await event('touchmove',100,130); await event('touchend',100,130); await idle();
 assert.equal(await page.evaluate(()=>window.refreshes),1);
 checks.push('Subthreshold release does not refresh');
 for(const [name,x,y,count,cancelable] of [['horizontal',200,110,1,true],['upward',100,80,1,true],['multitouch',100,280,2,true],['browser-owned',100,280,1,false]]) {
   await event('touchstart',100,100); assert.equal(await event('touchmove',x,y,'#surface',count,cancelable),false); await idle();
   await event('touchend',x,y); assert.equal(await page.evaluate(()=>window.refreshes),1); checks.push(`${name} gesture releases listener without refresh`);
 }
 for(const target of ['#control','#nested']) {await event('touchstart',100,100,target);await idle();assert.equal(await event('touchmove',100,280,target),false);}
 checks.push('Controls and nested scrollers keep gestures');
 await event('touchstart',100,100);await event('touchmove',100,280);await event('touchcancel',100,280);await distance(0);await idle();
 assert.equal(await page.evaluate(()=>window.refreshes),1);checks.push('Touch cancellation clears pending animation frame without refreshing');
 await event('touchstart',100,100);await event('touchmove',100,280);await page.evaluate(()=>window.setEnabled(false));await distance(0);await idle();
 await event('touchend',100,280);assert.equal(await page.evaluate(()=>window.refreshes),1);checks.push('Disabling during gesture cancels pending refresh');
 await page.evaluate(()=>window.setEnabled(true));await page.waitForTimeout(50);
 await page.evaluate(()=>scrollTo(0,200));await event('touchstart',100,100);await idle();checks.push('Scrolled document does not install a blocking move listener');
 await page.evaluate(()=>scrollTo(0,0));await page.setViewportSize({width:1024,height:768});await event('touchstart',100,100);await idle();checks.push('Desktop viewport does not start pull-to-refresh');
 await writeFile('docs/verification/mobile-ux/gesture-results.json',JSON.stringify({browser:await browser.version(),checks,passed:checks.length,scope:'Synthetic touch events in Chromium; not physical-device frame timing'},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
} finally {await browser.close();}
