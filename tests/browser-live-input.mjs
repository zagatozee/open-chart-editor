import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:1700,height:1050}});await context.addInitScript(()=>{
 const listeners={};window.feedBack={on:(name,fn)=>{(listeners[name]??=[]).push(fn);return()=>{listeners[name]=(listeners[name]||[]).filter(f=>f!==fn);};}};window.__screen=id=>(listeners['screen:changed']||[]).forEach(fn=>fn({id}));
 const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__inputs=[];window.__requests=[];navigator.mediaDevices.getUserMedia=async options=>{window.__requests.push(options);const stream=await get(options);window.__inputs.push(stream);return stream;};
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let report;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');assert.equal(await page.evaluate(()=>window.__requests.length),0);
 await page.locator('[data-action="mixer"]').first().evaluate(el=>el.click());
 async function start(){await page.locator('[data-action="live-input"]').click();await page.locator('#ws-dialog[open]').waitFor();assert.ok((await page.locator('#ws-dialog').textContent()).includes('headphones'));await page.locator('#ws-dialog-submit').click();await page.waitForFunction(()=>document.querySelector('.ws-live-input span')?.textContent.startsWith('Monitoring:'));}
 await start();assert.equal(await page.evaluate(()=>window.__requests.length),1);assert.equal(await page.evaluate(()=>window.__requests[0].audio.echoCancellation),false);assert.equal(await page.evaluate(()=>window.__inputs[0].getAudioTracks()[0].readyState),'live');
 await page.locator('[data-bus="live"]').fill('35');await page.locator('[data-pan="live"]').fill('40');await page.locator('[data-mixer-mute="live"]').click();assert.equal(await page.locator('[data-mixer-output="live"]').textContent(),'0%');await page.locator('[data-mixer-mute="live"]').click();
 await page.locator('[data-action="live-input"]').click();assert.equal(await page.evaluate(()=>window.__inputs[0].getAudioTracks()[0].readyState),'ended');
 await start();await page.evaluate(()=>window.__screen('library'));assert.equal(await page.evaluate(()=>window.__inputs[1].getAudioTracks()[0].readyState),'ended');
 await start();await page.locator('#ws-app').evaluate(el=>el.remove());await page.waitForFunction(()=>window.__inputs[2].getAudioTracks()[0].readyState==='ended');assert.deepEqual(errors,[]);
 report={ok:true,fakeDeviceOnly:true,noRequestAtStartup:true,explicitSelection:true,processingDisabled:true,liveMixer:true,explicitStop:true,screenExitStops:true,unmountStops:true,errors};
}catch(error){report={ok:false,error:error.stack,errors};process.exitCode=1;}finally{console.log(JSON.stringify(report,null,2));await writeFile(new URL('../verification/browser-live-input.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();}
