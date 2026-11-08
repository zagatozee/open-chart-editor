// Mixer compact channel-strip rework (issue #4): verifies each channel renders as a
// narrow vertical strip with a full-height VU meter and fader rather than the old wide
// 220px card, and regression-guards the flex-shrink bug that once squashed the
// rotated meter/fader down to their well's width before the CSS fix.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
try{
 const page=await browser.newPage({viewport:{width:1700,height:1050}}),errors=[],results=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');
 await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('footer [data-action="mixer"]').click();
 await page.waitForSelector('[data-mixer-channel="master"]');

 const channelWidth=(await page.locator('[data-mixer-channel="song"]').boundingBox()).width;
 assert.ok(channelWidth<120,`channel strip is compact: ${channelWidth}px wide (old card layout was 220px)`);
 results.push(`channel strip is compact (${Math.round(channelWidth)}px, was 220px)`);

 // All five default buses fit in one row without wrapping at a normal viewport width.
 const tops=await page.locator('[data-mixer-channel]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
 assert.ok(tops.every(t=>Math.abs(t-tops[0])<1),'all channels share one row: '+JSON.stringify(tops));
 results.push('all five buses sit in a single row, not wrapped across multiple rows');

 // The rotated meter/fader must not be squashed by flex-shrink inside their well.
 const meter=await page.locator('[data-signal-meter="master"][data-signal-channel="0"]').evaluate(e=>e.getBoundingClientRect());
 assert.ok(meter.height>80,`VU meter renders at full strip height, not squashed: ${meter.height}px`);
 results.push(`VU meter renders at full strip height (${Math.round(meter.height)}px)`);
 const fader=await page.locator('[data-bus="master"]').evaluate(e=>e.getBoundingClientRect());
 assert.ok(fader.height>80,`fader renders at full strip height, not squashed: ${fader.height}px`);
 results.push(`fader renders at full strip height (${Math.round(fader.height)}px)`);

 // Mute/Solo, pan and the dBFS readout are all still present and wired on the compact strip.
 await page.locator('[data-mixer-mute="song"]').click();
 assert.ok(await page.locator('[data-mixer-mute="song"].active').count(),'Mute toggles the compact button');
 await page.locator('[data-mixer-mute="song"]').click();
 await page.locator('[data-pan="song"]').fill('-50');
 assert.equal(await page.locator('[data-pan-value="song"]').textContent(),'-50');
 assert.match(await page.locator('[data-signal-meter="song"][data-signal-channel="0"]').getAttribute('aria-label'),/peak dBFS/);
 results.push('Mute, pan and the labelled stereo meters remain wired on the compact strip');

 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
