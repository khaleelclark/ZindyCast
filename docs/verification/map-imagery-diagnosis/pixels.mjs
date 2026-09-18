// Offline browser canvas decoding only; no external requests.
import {chromium} from '@playwright/test';import {readFileSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome'});const page=await browser.newPage();const results=[];
for(const name of ['florida-satellite.png','forecast-z9.png']){
const data=readFileSync('docs/verification/map-imagery-diagnosis/'+name).toString('base64');
results.push({name,...await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let opaque=0,transparent=0,gray=0,min=255,max=0;const colors=new Set();for(let i=0;i<p.length;i+=4){if(p[i+3]===255)opaque++;if(p[i+3]===0)transparent++;if(p[i]===p[i+1]&&p[i+1]===p[i+2])gray++;min=Math.min(min,p[i]);max=Math.max(max,p[i]);colors.add([p[i],p[i+1],p[i+2],p[i+3]].join(','))}return {width:c.width,height:c.height,opaque,transparent,gray,uniqueRgba:colors.size,redRange:[min,max]};},data)});
}await browser.close();writeFileSync('docs/verification/map-imagery-diagnosis/pixels.json',JSON.stringify(results,null,2));console.log(results);
for(const z of [7,8,9])console.log('metres per tile pixel',z,156543.033928*Math.cos(28.858*Math.PI/180)/2**z);
