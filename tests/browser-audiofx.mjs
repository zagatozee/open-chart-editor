import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1700,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
let report;
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const dsp=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/api/plugins/open_chart_editor/src/audio.js');
  async function render({channel='stereo',eq=[0,0,0,0,0],bypass=false,pan=0,left=.4,right=.4,frequency=100,mono=false}={}){
   const context=new OfflineAudioContext(2,4800,48000),engine=new AudioEngine({context});engine.setGain('master',1);engine.setGain('song',1);engine.setPan('song',pan);engine.setSongFX({channel,eq,bypass});await engine.init(false);
   const buffer=context.createBuffer(mono?1:2,4800,48000);for(let i=0;i<4800;i++){const wave=Math.sin(2*Math.PI*frequency*i/48000);buffer.getChannelData(0)[i]=left*wave;if(!mono)buffer.getChannelData(1)[i]=right*wave;}
   const source=context.createBufferSource();source.buffer=buffer;source.connect(engine.songGraph.input);source.start();const out=await context.startRendering();return [0,1].map(c=>Math.sqrt(out.getChannelData(c).slice(1000).reduce((n,v)=>n+v*v,0)/3800));
  }
  return {mono:await render({mono:true}),flat:await render(),cancel:await render({channel:'center-cancel'}),left:await render({channel:'left',right:.1}),right:await render({channel:'right',right:.1}),panned:await render({pan:-1}),bass:await render({eq:[12,0,0,0,0]}),bypassed:await render({channel:'center-cancel',eq:[12,0,0,0,0],bypass:true})};
 });
 assert.ok(Math.abs(dsp.mono[0]-dsp.mono[1])<1e-7&&dsp.mono[0]>.2);assert.ok(dsp.cancel.every(v=>v<1e-7));assert.ok(Math.abs(dsp.left[0]-dsp.left[1])<1e-7);assert.ok(dsp.left[0]>dsp.right[0]*3.9);assert.ok(dsp.panned[1]<1e-7);assert.ok(dsp.bass[0]>dsp.flat[0]*1.8);assert.ok(Math.abs(dsp.flat[0]-dsp.bypassed[0])<1e-7);
 await page.locator('[data-action="mixer"]').first().evaluate(el=>el.click());await page.locator('[data-pan="song"]').fill('-65');assert.equal(await page.locator('[data-pan-value="song"]').textContent(),'-65');await page.locator('.ws-transcription summary').click();await page.locator('[data-song-fx-channel]').selectOption('center-cancel');await page.locator('[data-song-fx-preset]').selectOption('bass');assert.equal(await page.locator('[data-song-eq="0"]').inputValue(),'6');await page.locator('[data-song-eq="1"]').fill('7.5');assert.equal(await page.locator('[data-eq-value="1"]').textContent(),'7.5 dB');await page.locator('[data-song-fx-bypass]').check();
 const shell=await page.locator('#ws-app').evaluate(el=>el.outerHTML.replace(' data-mounted="true"',''));await page.locator('#ws-app').evaluate(el=>el.remove());await page.waitForTimeout(150);await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html),shell);await page.waitForSelector('#ws-app[data-mounted="true"]');assert.equal(await page.locator('[data-pan="song"]').inputValue(),'-65');assert.equal(await page.locator('[data-song-eq="1"]').inputValue(),'7.5');assert.equal(await page.locator('[data-song-fx-channel]').inputValue(),'center-cancel');assert.equal(await page.locator('[data-song-fx-bypass]').isChecked(),true);
 assert.deepEqual(errors,[]);report={ok:true,dsp,ui:{pan:true,channel:true,eq:true,bypass:true,remount:true},errors};
}catch(error){report={ok:false,error:error.stack,errors};process.exitCode=1;}finally{await writeFile(new URL('../verification/browser-audiofx.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}

