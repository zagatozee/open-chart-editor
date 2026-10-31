// Prepared future PRODUCTION actual-main UI gate; explicit promotion/release required.
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {createTone,setGear,registerGearCatalog} from '../src/tone-rack.js';
if(process.env.OCE_SWOLE_EDEN_PRODUCTION_UI_RELEASE!=='1')throw Error('Candidate UI browser held for final0.7 gates/endurance; explicit parent release required');
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio']});
const errors=[];let ui,report;
try{await runUI();assert.deepEqual(errors,[]);report={ok:true,production:true,physicalAudio:false,overlayOnly:[],method:'Actual production main UI and existing factories without module overlays; generic Swole compressor and partial Eden EQ only',ui,errors};}
catch(error){process.exitCode=1;report={ok:false,production:true,error:error.stack,ui,errors};}
finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-tone-swole-eden-production-ui.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}

async function runUI(){
 ui={checks:[],pendingState:null,readyState:null};
 const context=await browser.newContext({viewport:{width:1700,height:1050}});
 await context.addInitScript(()=>{
  const p=window.__swoleUI={catalogGates:[],contexts:[],capture:0,midi:0,saves:[],instances:[],calls:[]},nativeFetch=window.fetch.bind(window),NativeContext=window.AudioContext;
  window.fetch=(input,...args)=>{const url=input?.url??String(input);return url.includes('/assets/tone-rack-data.json')?new Promise((resolve,reject)=>p.catalogGates.push(()=>nativeFetch(input,...args).then(resolve,reject))):nativeFetch(input,...args);};p.releaseCatalog=()=>{for(const release of p.catalogGates.splice(0))release();};
  if(!('sinkId'in NativeContext.prototype))throw Error('Strict silent sink unavailable');window.AudioContext=class extends NativeContext{constructor(options={}){super({...options,sinkId:{type:'none'}});if(this.sinkId?.type!=='none')throw Error('Silent sink not selected');p.contexts.push(this);}};
  Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>{p.midi++;throw Error('Physical MIDI access forbidden');},configurable:true});
  if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{p.capture++;throw Error('Physical capture forbidden');},configurable:true});
  window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>p.saves.push(await blob.text()),close:async()=>{}})});
 });
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
 const action=async name=>page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());
 const snapshot=async()=>{const count=await page.evaluate(()=>window.__swoleUI.saves.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await page.locator('#ws-dialog-submit').click();await page.waitForFunction(count=>window.__swoleUI.saves.length>count,count);return page.evaluate(()=>JSON.parse(window.__swoleUI.saves.at(-1)));};
 const state=()=>page.evaluate(()=>{const p=window.__swoleUI,preview=p.instances.at(-1);return{playing:p.engine?.isPlaying??false,capture:p.capture,midi:p.midi,filterChildren:preview?[preview.preEffects,preview.postEffects].filter(Boolean).flatMap(r=>r.childRacks).filter(child=>child.constructor.name==='ToneFilterRack').length:0,preKinds:preview?.preEffects?.stages.map(s=>s.kind)||[],postKinds:preview?.postEffects?.stages.map(s=>s.kind)||[],disclosures:preview?.getDisclosures()??[]};});
 try{
  await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');ui.loadedHashes=await verifyProductionBytes(page);await page.waitForFunction(()=>window.__swoleUI.catalogGates.length===1);
  await page.evaluate(async()=>{const base='/api/plugins/open_chart_editor/src/',{TonePreview}=await import(base+'tone-rack.js'),{AudioEngine}=await import(base+'audio.js'),set=TonePreview.prototype.setTone,init=AudioEngine.prototype.init;TonePreview.prototype.setTone=function(tone){const result=set.call(this,tone),p=window.__swoleUI;if(!p.instances.includes(this))p.instances.push(this);p.calls.push({pre:this.preEffects,post:this.postEffects});return result;};AudioEngine.prototype.init=function(...args){window.__swoleUI.engine=this;return init.apply(this,args);};});
  const catalog=JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears;registerGearCatalog(catalog);const p=makeProject();p.title='Own candidate delayed Swole Eden catalog';p.duration=30;p.beats=p.beats.slice(0,61);const a=p.arrangements[0],tone=createTone('Own candidate partial Eden and Swole');setGear(tone,'PrePedal1','Pedal_Swole');setGear(tone,'PrePedal2','Bass_Pedal_EdenWTDI');setGear(tone,'PostPedal1','Pedal_AnalogueDelay');tone.opaque={original:['retained native metadata']};a.notes=[makeNote(a,1,0,3,2)];a.tones={base:tone.name,changes:[],definitions:{[tone.name]:tone}};a.activeDifficulty=0;a.difficulties=[{difficulty:0,notes:structuredClone(a.notes),chords:[],anchors:[],handshapes:[]},{difficulty:3,notes:[{...makeNote(a,12,1,7,.5),opaque:{original:'hidden DD unchanged'}}],chords:[],anchors:[],handshapes:[]}];const hidden=makeArrangement('bass',5);hidden.opaque={original:'hidden bass'};p.arrangements.push(hidden);
  await page.locator('#ws-open-file').setInputFiles({name:'own-static-ui.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Own candidate delayed Swole Eden catalog'));const baseline=await snapshot();await action('tones');assert.match(await page.locator('[data-tone-disclosure="PrePedal1"]').textContent(),/unknown|bypassed/i);await action('play');await page.waitForFunction(()=>window.__swoleUI.engine?.isPlaying);ui.pendingState=await state();assert.equal(ui.pendingState.filterChildren,0);assert.ok(ui.pendingState.postKinds.includes('delay'));assert.equal(ui.pendingState.playing,true);ui.checks.push('Before factual catalog resolves, unknown candidate gear remains retained/bypassed and actual working delay/transport plays');
  await page.evaluate(()=>window.__swoleUI.releaseCatalog());await page.waitForFunction(()=>{const v=window.__swoleUI.instances.at(-1);return v?.preEffects?.childRacks.filter(c=>c.constructor.name==='ToneFilterRack').length===1&&v.preEffects.stages.some(s=>s.kind==='compressor');});ui.readyState=await state();assert.equal(ui.readyState.filterChildren,1);assert.match(await page.locator('[data-tone-disclosure="PrePedal1"]').textContent(),/Original generic compressor/i);assert.match(await page.locator('[data-tone-disclosure="PrePedal2"]').textContent(),/PARTIAL.*3-band EQ/i);ui.checks.push('Catalog registration refresh creates one actual owned three-band filter plus one existing compressor stage and truthful approximation/peak-reduction disclosures');await action('play');

  const knob=(slot,key)=>page.locator(`[data-knob-slot="${slot}"][data-knob-key="${key}"]`);
  const definition=()=>page.locator('[data-tone-definition]').inputValue().then(JSON.parse);
  const expected=structuredClone(baseline),native=expected.arrangements[0].tones.definitions[tone.name];
  for(const [slot,key,value,unit]of [
   ['PrePedal1','Pedal_Swole_Smash',37.125,'%'],
   ['PrePedal1','Pedal_Swole_Rate',73.625,'number'],
   ['PrePedal2','Bass_Pedal_EdenWTDI_Bass',-3.125,'dB'],
   ['PrePedal2','Bass_Pedal_EdenWTDI_Mid',2.375,'dB'],
   ['PrePedal2','Bass_Pedal_EdenWTDI_Treble',4.875,'dB']
  ]){
   const field=knob(slot,key),catalogUnit=catalog.find(gear=>gear.key===native.GearList[slot].Key).knobs.find(control=>control.key===key).unit;assert.equal(await field.locator('xpath=..').locator('small').textContent(),catalogUnit);assert.equal(catalogUnit.toLowerCase(),unit.toLowerCase());
   await field.focus();await field.evaluate(el=>window.__swoleUI.focused=el);await field.fill(String(value));await field.dispatchEvent('change');
   assert.equal(await page.evaluate(()=>document.activeElement===window.__swoleUI.focused),true);
   assert.equal((await definition()).GearList[slot].KnobValues[key],value);native.GearList[slot].KnobValues[key]=value;
  }
  const disclosure=await page.locator('[data-tone-disclosure="PrePedal2"]').textContent();
  const edenDefinition=catalog.find(item=>item.key==='Bass_Pedal_EdenWTDI'),unmodeledLabels=['Gain','Enhance','LoShift','MidShift','Compression'].map(suffix=>edenDefinition.knobs.find(knob=>knob.key==='Bass_Pedal_EdenWTDI_'+suffix).label);
  for(const label of unmodeledLabels)assert.ok(disclosure.includes(label));
  const actualUnmapped=await page.evaluate(()=>window.__swoleUI.instances.at(-1).auditionPlan.disclosures.find(item=>item.key==='Bass_Pedal_EdenWTDI').unmappedControls);
  assert.deepEqual([...actualUnmapped].sort(),[...unmodeledLabels].sort());assert.equal(actualUnmapped.length,5);
  assert.match(disclosure,/NOT heard|NOT modeled|stored controls/i);
  const beforeUnmodeled=await page.evaluate(()=>window.__swoleUI.instances.at(-1).auditionPlan.effects.find(e=>e.key==='Bass_Pedal_EdenWTDI'));
  await knob('PrePedal2','Bass_Pedal_EdenWTDI_Gain').fill('99.125');await knob('PrePedal2','Bass_Pedal_EdenWTDI_Gain').dispatchEvent('change');
  native.GearList.PrePedal2.KnobValues.Bass_Pedal_EdenWTDI_Gain=99.125;
  assert.deepEqual(await page.evaluate(()=>window.__swoleUI.instances.at(-1).auditionPlan.effects.find(e=>e.key==='Bass_Pedal_EdenWTDI')),beforeUnmodeled);
  const swolePlan=await page.evaluate(()=>window.__swoleUI.instances.at(-1).auditionPlan.effects.find(e=>e.key==='Pedal_Swole'));
  assert.ok(Math.abs(swolePlan.release-.5*(.05/.5)**((73.625-1)/99))<1e-12);
  assert.deepEqual(await snapshot(),expected);
  ui.checks.push('Actual native fractional Smash/Rate and all three dB controls retain focus/units; original unitless Rate recovery and five unmodeled Eden controls are explicit');
  for(let index=0;index<6;index++)await action('undo');
  assert.deepEqual(await snapshot(),baseline);
  ui.checks.push('Six actual field edits Undo exactly; unmodeled native Gain is durable but leaves the audible EQ plan identical, hidden DD/arrangement/opaque data preserved');
  await page.evaluate(()=>{const v=window.__swoleUI.instances.at(-1);window.__swoleUI.beforeVolume={pre:v.preEffects,post:v.postEffects};});await page.locator('#ws-tone-volume').fill('-6');await page.locator('#ws-tone-volume').dispatchEvent('change');assert.equal(await page.evaluate(()=>{const p=window.__swoleUI,v=p.instances.at(-1);return v.preEffects===p.beforeVolume.pre&&v.postEffects===p.beforeVolume.post;}),true);const volumeExpected=structuredClone(baseline);volumeExpected.arrangements[0].tones.definitions[tone.name].volume=-6;volumeExpected.arrangements[0].tones.definitions[tone.name].Volume='-6';assert.deepEqual(await snapshot(),volumeExpected);ui.checks.push('Volume-only edit preserves actual child graphs and changes only volume aliases in durable JSON');
  await page.locator('#ws-app').evaluate(el=>el.remove());await page.waitForFunction(()=>window.__swoleUI.instances.every(v=>v.disposed)&&window.__swoleUI.engine.context===null);assert.equal(await page.evaluate(()=>window.__swoleUI.capture),0);assert.equal(await page.evaluate(()=>window.__swoleUI.midi),0);ui.checks.push('Actual unmount disposes preview/context; no microphone/MIDI hardware requests');return ui;
 }finally{await context.close();}
}


async function verifyProductionBytes(page){
 const names=['tone-rack.js','tone-swole-eden.js','tone-effects.js','tone-filters.js'];
 const served=await page.evaluate(async names=>Object.fromEntries(await Promise.all(names.map(async name=>{
  const response=await fetch('/api/plugins/open_chart_editor/src/'+name);if(!response.ok)throw Error('Missing actual production module '+name);
  const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
  return[name,Array.from(new Uint8Array(digest)).map(value=>value.toString(16).padStart(2,'0')).join('')];
 }))),names),local={};
 for(const name of names){local[name]=createHash('sha256').update(await readFile(new URL('../src/'+name,import.meta.url))).digest('hex');assert.equal(served[name],local[name],name+' actual served bytes equal on-disk production');}
 return{served,local};
}
