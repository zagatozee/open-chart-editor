// Actual editor UI/production DSP, silent synthetic input only. Parent release required.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {createTone,setGear,setKnob,registerGearCatalog} from '../src/tone-rack.js';
if(process.env.OCE_ADAPTIVE_UI_RELEASE!=='1')throw Error('Parent browser handoff required before adaptive UI proof');
registerGearCatalog(JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears);
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const checks=[],errors=[],observations=[];let report;
function fixture(title){const p=makeProject();p.title=title;p.duration=30;p.beats=p.beats.slice(0,61);const a=p.arrangements[0],A=createTone('Own allocated A'),B=createTone('Own unrelated B');for(const tone of [A,B]){setGear(tone,'PrePedal1','Pedal_NoiseGate');setGear(tone,'PostPedal1','Pedal_AnalogueDelay');}setKnob(B,'PrePedal1','Pedal_NoiseGate_Thresh',-42);a.notes=[makeNote(a,1,0,3,2)];a.tones={base:A.name,changes:[],definitions:{[A.name]:A,[B.name]:B}};const hidden=makeArrangement('bass',5);hidden.tones=structuredClone(a.tones);hidden.notes=[makeNote(hidden,2,4,5,1)];p.arrangements.push(hidden);return p;}
async function fresh(mode,title){
 const context=await browser.newContext({viewport:{width:1700,height:1050}});
 await context.addInitScript(({mode})=>{
  const p=window.__adaptiveUI={mode,contexts:[],nodes:[],gates:[],moduleRequests:[],gum:[],stoppedTracks:0};
  const NativeContext=window.AudioContext,NativeWorklet=window.AudioWorkletNode;
  if(!('sinkId'in NativeContext.prototype))throw Error('Strict silent AudioContext unavailable');
  window.AudioContext=class extends NativeContext{constructor(options={}){super({...options,sinkId:{type:'none'}});if(this.sinkId?.type!=='none')throw Error('Silent context not selected');p.contexts.push(this);const add=this.audioWorklet.addModule.bind(this.audioWorklet);Object.defineProperty(this.audioWorklet,'addModule',{value:url=>{if(!String(url).includes('/tone-adaptive-worklet.js'))return add(url);p.moduleRequests.push(String(url));if(p.mode==='fail')return add(new URL('/api/plugins/open_chart_editor/src/own-missing-adaptive-ui-worklet.js',location.href).href);if(p.mode==='hold')return new Promise((resolve,reject)=>p.gates.push(()=>add(url).then(resolve,reject)));return add(url);}});}};
  window.AudioWorkletNode=class extends NativeWorklet{constructor(context,name,options){super(context,name,options);if(name==='oce-adaptive-v1')p.nodes.push(this);}};
  p.release=()=>{p.mode='pass';for(const release of p.gates.splice(0))release();};
  Object.defineProperty(navigator,'mediaDevices',{value:{enumerateDevices:async()=>[{kind:'audioinput',deviceId:'own-synthetic',label:'Own synthetic signal'}],getUserMedia:async constraints=>{
   p.gum.push(structuredClone(constraints));const context=p.engine?.context;if(!context)throw Error('No prepared editor context');const oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();oscillator.frequency.value=220;oscillator.connect(destination);oscillator.start();const stream=destination.stream;for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{p.stoppedTracks++;try{oscillator.stop();oscillator.disconnect();destination.disconnect();}catch{}stop();};}return stream;
  }},configurable:true});
 },{mode});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push({title,message:e.message}));await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.evaluate(async()=>{
  const base='/api/plugins/open_chart_editor/src/',{TonePreview}=await import(base+'tone-rack.js'),{AudioEngine}=await import(base+'audio.js');const p=window.__adaptiveUI;p.previews=[];p.playCalls=0;
  const set=TonePreview.prototype.setTone,init=AudioEngine.prototype.init,play=AudioEngine.prototype.play;
  TonePreview.prototype.setTone=function(tone){const result=set.call(this,tone);if(!p.previews.includes(this))p.previews.push(this);return result;};
  AudioEngine.prototype.init=function(...args){p.engine=this;return init.apply(this,args);};AudioEngine.prototype.play=function(...args){p.playCalls++;return play.apply(this,args);};
 });
 const project=fixture(title);await page.locator('#ws-open-file').setInputFiles({name:'own-adaptive-ui.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),title);await action(page,'tones');return{context,page,project};
}
async function action(page,name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}
const disclosure=page=>page.locator('[data-tone-disclosure="PrePedal1"]');
async function monitor(page){await action(page,'mixer');await action(page,'live-input');await page.locator('#ws-dialog-submit').click();}
async function state(page){return page.evaluate(()=>{const p=window.__adaptiveUI;return{playing:p.engine?.isPlaying??false,playCalls:p.playCalls,nodeCount:p.nodes.length,moduleRequests:p.moduleRequests.length,gum:p.gum.length,stoppedTracks:p.stoppedTracks,pending:p.gates.length,previews:p.previews.map(v=>({disposed:v.disposed,preChildren:v.preEffects?.childRacks.length??0,postChildren:v.postEffects?.childRacks.length??0,disclosures:v.getDisclosures()}))};});}
try{
 // A pending guide start can be cancelled without later transport/audio start.
 {
  const {context,page}=await fresh('hold','Own adaptive guide preparation cancellation');assert.match(await disclosure(page).textContent(),/preparation pending/i);await action(page,'play');await page.waitForFunction(()=>window.__adaptiveUI.gates.length===1);assert.match(await disclosure(page).textContent(),/in progress/i);await action(page,'play');await page.evaluate(()=>window.__adaptiveUI.release());await page.waitForFunction(()=>window.__adaptiveUI.previews.length===1);let s=await state(page);assert.equal(s.playCalls,0);assert.equal(s.playing,false);assert.equal(s.gum,0);
  checks.push('Pending guide module displays progress; cancelling Play prevents late transport start and microphone requests');
  await action(page,'play');await page.waitForFunction(()=>window.__adaptiveUI.engine?.isPlaying);assert.match(await disclosure(page).textContent(),/Guide preview:.*adaptive/i);await action(page,'play');
  // Normal volume/ACK notifications preserve graph ownership and focused controls.
  const nodeCount=(await state(page)).nodeCount;await page.locator('#ws-tone-volume').fill('-6');await page.locator('#ws-tone-volume').dispatchEvent('change');assert.equal((await state(page)).nodeCount,nodeCount);
  const knob=page.locator('[data-knob-slot="PrePedal1"]').first();await knob.focus();await knob.evaluate(el=>window.__adaptiveUI.focused=el);
  await page.evaluate(()=>{const p=window.__adaptiveUI,guide=p.previews[0];p.failedGuide=guide;guide.preEffects.childRacks[0].processor.onprocessorerror();});await page.waitForFunction(()=>document.querySelector('[data-tone-disclosure="PrePedal1"]')?.textContent.includes('Guide preview: Original envelope processor failed'));
  assert.equal(await page.evaluate(()=>document.activeElement===window.__adaptiveUI.focused),true);await page.waitForTimeout(150);assert.equal((await state(page)).nodeCount,nodeCount);assert.equal(await page.evaluate(()=>window.__adaptiveUI.failedGuide.preEffects.childRacks[0].bypassed),true);
  checks.push('Guide processor error has a prefixed stable bypass disclosure, preserves focused knob and does not rebuild on volume or retirement ACK');
  // An unrelated library tone using the same gear must not inherit the failure.
  await page.locator('#ws-tone-library').selectOption('Own unrelated B');assert.doesNotMatch(await disclosure(page).textContent(),/failed|bypassed/i);await page.locator('#ws-tone-audition-selected').uncheck();assert.doesNotMatch(await disclosure(page).textContent(),/Guide preview:|Live input:/i);
  checks.push('Unrelated same-gear library tone does not inherit guide failure or allocation-owner disclosures');
  // Start actual synthetic MediaStream, then fail ONLY the live processor.
  await page.locator('#ws-tone-audition-selected').check();await page.locator('#ws-tone-library').selectOption('Own allocated A');await monitor(page);await page.waitForFunction(()=>window.__adaptiveUI.gum.length===1&&window.__adaptiveUI.previews.filter(p=>!p.disposed).length===2);
  await page.evaluate(()=>{const p=window.__adaptiveUI,live=p.previews.at(-1);p.failedLive=live;live.preEffects.childRacks[0].processor.onprocessorerror();});await page.waitForFunction(()=>document.querySelector('[data-tone-disclosure="PrePedal1"]')?.textContent.includes('Live input: Original envelope processor failed'));assert.equal(await page.evaluate(()=>window.__adaptiveUI.previews[0].preEffects.childRacks[0].bypassed),false);
  const constraints=await page.evaluate(()=>window.__adaptiveUI.gum[0]);assert.equal(constraints.audio.echoCancellation,false);assert.equal(constraints.audio.noiseSuppression,false);assert.equal(constraints.audio.autoGainControl,false);assert.equal(constraints.video,false);
  await action(page,'live-input');assert.equal((await state(page)).stoppedTracks,1);await page.locator('#ws-arrangement').selectOption(await page.locator('#ws-arrangement option').nth(1).getAttribute('value'));assert.doesNotMatch(await disclosure(page).textContent(),/failed/i);
  checks.push('Synthetic live channel uses explicit unprocessed constraints; live-only failure is prefixed and leaves guide healthy; Stop releases track and arrangement routing clears stale failure');observations.push(await state(page));await context.close();
 }
 // Live cancellation while preparation is held never reaches getUserMedia.
 {
  const {context,page}=await fresh('hold','Own live preparation cancellation');await monitor(page);await page.waitForFunction(()=>window.__adaptiveUI.gates.length===1);await action(page,'live-input');await page.evaluate(()=>window.__adaptiveUI.release());await page.waitForTimeout(150);const s=await state(page);assert.equal(s.gum,0);assert.equal(s.previews.length,0);assert.equal(s.playCalls,0);assert.match(await page.locator('.ws-live-input').textContent(),/Live input off/i);checks.push('Cancel live input during module preparation prevents microphone request, effect creation and late monitoring');observations.push(s);await context.close();
 }
 // A true local native loader failure remains visible while working delay survives.
 {
  const {context,page}=await fresh('fail','Own adaptive failed module isolation');await action(page,'play');await page.waitForFunction(()=>window.__adaptiveUI.engine?.isPlaying);assert.match(await disclosure(page).textContent(),/unavailable|failed|bypassed/i);assert.equal(await page.evaluate(()=>window.__adaptiveUI.previews[0].postEffects.stages[0].kind),'delay');assert.equal((await state(page)).nodeCount,0);await action(page,'play');checks.push('Native missing-module failure is visible per adaptive gear while actual generic delay and transport remain operational');observations.push(await state(page));await context.close();
 }
 // Replacing the project during await invalidates the old request.
 {
  const {context,page}=await fresh('hold','Own replaced adaptive request');await action(page,'play');await page.waitForFunction(()=>window.__adaptiveUI.gates.length===1);const replacement=fixture('Own replacement after pending prepare');await page.locator('#ws-open-file').setInputFiles({name:'own-replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(replacement))});await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Own replacement after pending prepare'));await page.evaluate(()=>window.__adaptiveUI.release());await page.waitForTimeout(150);const s=await state(page);assert.equal(s.playCalls,0);assert.equal(s.previews.length,0);checks.push('Project replacement during pending preparation prevents stale preview creation and playback');observations.push(s);await context.close();
 }
 // Defer BEFORE original AudioEngine.init, unmount while no context exists,
 // then permit the native init. Terminal LiveInput owns the late cleanup.
 {
  const {context,page}=await fresh('pass','Own terminal late original live init');
  await page.evaluate(async()=>{const {AudioEngine}=await import('/api/plugins/open_chart_editor/src/audio.js'),init=AudioEngine.prototype.init;AudioEngine.prototype.init=function(...args){const p=window.__adaptiveUI;p.lateEngine=this;return new Promise((resolve,reject)=>p.releaseOriginalInit=()=>init.apply(this,args).then(resolve,reject));};});
  await monitor(page);await page.waitForFunction(()=>typeof window.__adaptiveUI.releaseOriginalInit==='function');assert.equal(await page.evaluate(()=>window.__adaptiveUI.lateEngine.context),null);
  await page.locator('#ws-app').evaluate(el=>el.remove());await page.waitForTimeout(50);await page.evaluate(()=>window.__adaptiveUI.releaseOriginalInit());await page.waitForFunction(()=>window.__adaptiveUI.contexts.length>0&&window.__adaptiveUI.contexts.every(context=>context.state==='closed')&&window.__adaptiveUI.lateEngine.context===null);
  const s=await state(page);assert.equal(s.gum,0);assert.equal(s.previews.length,0);assert.equal(s.playCalls,0);assert.equal(await page.evaluate(()=>window.__adaptiveUI.lateEngine.disposers.size),0);checks.push('Unmount before original live init closes the late native context, leaves engine.context null and never requests microphone or creates effects');observations.push(s);await context.close();
 }
 assert.deepEqual(errors,[]);report={ok:true,physicalAudio:false,physicalCapture:false,checks,observations,errors};
}catch(error){report={ok:false,error:error.stack,checks,observations,errors};process.exitCode=1;}finally{await writeFile(new URL('../verification/browser-tone-adaptive-ui.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
