// Offline visual comparison only: retained forecast PNG magnified 3x.
import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const png=(await readFile('docs/verification/forecast-radar/live.png')).toString('base64');
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {const page=await browser.newPage({viewport:{width:1600,height:940}});await page.route('https://**/*',r=>r.abort());await page.setContent(`<style>body{font:20px sans-serif;background:#edf1f3}section{display:flex;gap:20px}img{width:768px;height:768px;display:block;background:#dce3e6}p{max-width:1500px}</style><h1>Retained forecast tile · display interpolation comparison</h1><p>Offline historical image; enlarged 3×. This compares display edges, not meteorological resolution or current Florida conditions.</p><section><div>Linear/smooth display<img src="data:image/png;base64,${png}"></div><div>Nearest-neighbor/pixelated display<img style="image-rendering:pixelated" src="data:image/png;base64,${png}"></div></section>`);await page.screenshot({path:'docs/verification/map-quality/forecast-interpolation.png'});}finally{await browser.close();}
