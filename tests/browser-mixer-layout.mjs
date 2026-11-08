import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
try{
 const page=await browser.newPage({viewport:{width:1700,height:1050}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8767');
 await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('footer [data-action="mixer"]').click();
 for(const bus of ['song','guide','metronome','live']){
  for(const value of ['0','500','1000']){
   await page.locator(`[data-bus="${bus}"]`).fill(value);
   const controls=page.locator(`[data-mixer-channel="${bus}"]`);
   const mute=await controls.locator(`[data-mixer-mute="${bus}"]`).boundingBox();
   const solo=await controls.locator(`[data-mixer-solo="${bus}"]`).boundingBox();
   const actions=await controls.locator('.ws-mixer-actions').boundingBox();
   assert.ok(Math.abs(mute.y-solo.y)<1,`${bus} Solo and Mute stay on the same row at fader position ${value}`);
   assert.ok(solo.y>=actions.y&&solo.y+solo.height<=actions.y+actions.height,`${bus} Solo remains inside its fixed action row at fader position ${value}`);
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: mixer Solo controls stay fixed beside Mute from the bottom to the top of every fader');
}finally{await browser.close();}
