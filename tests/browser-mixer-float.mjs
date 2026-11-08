// Floating mixer panel (issue #4): opens over the editor, keeps metering while another
// lower-panel tab is shown, drags and keeps its place across a reload, and docks back.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
try{
 const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[],results=[];
 page.on('pageerror',error=>errors.push(error.message));
 const open=async()=>{await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');await page.waitForSelector('#ws-app[data-mounted="true"]');};
 const panel=page.locator('#ws-mixer-float'),box=async()=>panel.boundingBox();
 await open();await page.evaluate(()=>localStorage.removeItem('oce.preferences.v1'));await open();
 assert.ok(await panel.isHidden(),'the mixer starts closed');
 await page.locator('#ws-canvas').focus();await page.keyboard.press('Control+m');
 await page.waitForSelector('#ws-mixer-float:not([hidden]) [data-mixer-channel="master"]');
 results.push('Ctrl+M opens the floating mixer');

 await page.locator('footer [data-action="errors"]').click();
 assert.ok(await panel.isVisible(),'the panel stays open over another lower-panel tab');
 assert.equal(await page.locator('#ws-bottom-content [data-mixer-channel]').count(),0);
 await page.waitForFunction(()=>document.querySelector('#ws-mixer-float [data-signal-meter="song"]').style.getPropertyValue('--vu-peak')!=='');
 results.push('meters keep running while the Errors tab is shown');

 const before=await box(),head=await page.locator('#ws-mixer-float-head span').boundingBox();
 await page.mouse.move(head.x+5,head.y+5);await page.mouse.down();await page.mouse.move(head.x-295,head.y-195,{steps:5});await page.mouse.up();
 const after=await box();assert.ok(Math.abs(after.x-(before.x-300))<2&&Math.abs(after.y-(before.y-200))<2,JSON.stringify({before,after}));
 await page.locator('#ws-mixer-float-head').focus();await page.keyboard.press('ArrowRight');
 assert.ok(Math.abs((await box()).x-(after.x+10))<2,'arrow keys move the panel');
 results.push('the header drags the panel, and arrow keys nudge it');

 const placed=await box();await open();await page.waitForSelector('#ws-mixer-float:not([hidden]) [data-mixer-channel="master"]');
 const reloaded=await box();assert.ok(Math.abs(reloaded.x-placed.x)<2&&Math.abs(reloaded.y-placed.y)<2,JSON.stringify({placed,reloaded}));
 results.push('open state and position survive a reload');

 await page.locator('#ws-mixer-float [data-mixer-mute="song"]').click();
 assert.ok(await page.locator('#ws-mixer-float [data-mixer-mute="song"].active').count(),'Mute works in the floating panel');
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.mixerMute),'song','focus stays on the Mute button');
 await page.locator('#ws-mixer-float [data-mixer-mute="song"]').click();

 await page.locator('#ws-mixer-float details summary').first().click();
 await page.locator('#ws-mixer-float [data-mixer-mute="song"]').click();await page.locator('#ws-mixer-float [data-mixer-mute="song"]').click();
 assert.ok(await page.locator('#ws-mixer-float details').first().evaluate(d=>d.open),'an open section stays open when Mute rebuilds the panel');
 const pb=await box(),rb=await page.locator('#ws-app').boundingBox();assert.ok(pb.y+pb.height<=rb.y+rb.height+1,'the grown panel stays inside the editor');
 await page.locator('#ws-mixer-float details summary').first().click();
 results.push('Mute keeps an open section open, and a grown panel stays inside the editor');

 const fader=page.locator('#ws-mixer-float [data-bus="song"]'),readout=()=>page.locator('#ws-mixer-float [data-mixer-value="song"]').textContent();
 await fader.focus();const keys=[['End','+6.0 dB'],['ArrowDown','+5.0 dB'],['PageDown','-1.0 dB'],['ArrowUp','0.0 dB'],['Home','-inf dB'],['ArrowUp','-60.0 dB']];
 for(const [key,want] of keys){await page.keyboard.press(key);assert.equal(await readout(),want,key);}
 await fader.dblclick();assert.equal(await readout(),'0.0 dB');
 results.push('fader keys step in dB: arrows 1 dB, Page keys 6 dB, Home -inf, End the top');

 await fader.focus();await page.keyboard.press('Escape');assert.ok(await panel.isHidden(),'Escape closes the panel');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'ws-mixer-focus-return','focus returns to the footer Mixer button');
 await page.keyboard.press('Control+m');await page.waitForSelector('#ws-mixer-float:not([hidden]) [data-mixer-channel="master"]');
 results.push('Escape closes the panel, focus returns to the footer, Ctrl+M reopens it');

 // Both headers: title, then the move button (Dock or Float), then close, at the right end.
 const header=async selector=>page.locator(selector).evaluate(head=>{const r=head.getBoundingClientRect(),buttons=[...head.querySelectorAll('button')];return {labels:buttons.map(b=>b.textContent),gapRight:Math.round(r.right-buttons.at(-1).getBoundingClientRect().right)};});
 const floating=await header('#ws-mixer-float-head');
 await page.locator('[data-action="mixer-dock"]').click();
 assert.ok(await panel.isHidden(),'Dock hides the floating panel');
 await page.waitForSelector('#ws-bottom-content [data-mixer-channel="master"]');
 const docked=await header('#ws-bottom-content .ws-mixer-head');
 assert.deepEqual([floating.labels,docked.labels],[['Dock','×'],['Float','×']]);assert.ok(Math.abs(floating.gapRight-docked.gapRight)<=8,JSON.stringify({floating,docked}));
 await page.locator('#ws-bottom-content [data-action="mixer"]').click();
 assert.equal(await page.locator('#ws-bottom-content [data-mixer-channel]').count(),0,'the docked close button closes the mixer');
 assert.match(await page.locator('#ws-bottom-content').textContent(),/Error Finder/,'the lower panel returns to the tab shown before');
 await page.locator('footer [data-action="mixer"]').click();await page.waitForSelector('#ws-bottom-content [data-mixer-channel="master"]');
 await page.locator('footer [data-action="mixer"]').click();assert.equal(await page.locator('#ws-bottom-content [data-mixer-channel]').count(),0,'the footer Mixer button toggles the docked mixer');
 await page.locator('footer [data-action="mixer"]').click();await page.waitForSelector('#ws-bottom-content [data-mixer-channel="master"]');
 results.push('both headers end in the same buttons at the same place; the docked close and Mixer button toggle it');
 await page.locator('#ws-bottom-content [data-action="mixer-float"]').click();
 await page.waitForSelector('#ws-mixer-float:not([hidden]) [data-mixer-channel="master"]');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'ws-mixer-float-head','Float moves focus into the panel');
 assert.equal(await page.locator('#ws-bottom-content [data-mixer-channel]').count(),0,'Float leaves the lower panel');
 results.push('Dock and Float move the mixer between the lower panel and the floating panel');

 await page.locator('#ws-canvas').focus();await page.keyboard.press('Control+m');assert.ok(await panel.isHidden(),'Ctrl+M closes the floating mixer');
 assert.deepEqual(errors,[],'no page errors');
 console.log(results.map(r=>'ok - '+r).join('\n'));
}finally{await browser.close();}
