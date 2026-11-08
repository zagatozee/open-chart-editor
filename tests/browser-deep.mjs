// Local Chromium end-to-end research. Uses installed tooling; no downloads.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {faderPosition,faderTopDb} from '../src/mixer-meter.js';
const fp=(gain,bus)=>String(Math.round(faderPosition(gain,faderTopDb(bus))*1000));
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true});
await context.addInitScript(()=>{
 Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});
 const listeners={};window.feedBack={on:(name,fn)=>{(listeners[name]??=[]).push(fn);return()=>{listeners[name]=(listeners[name]||[]).filter(item=>item!==fn);};},off:(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(item=>item!==fn);}};
 window.__deepEmit=(name,event)=>{for(const fn of listeners[name]||[])fn(event);};
 const midiListeners=new Set(),stateListeners=new Set();
 const input={id:'original-test-controller',name:'Original simulated controller',manufacturer:'Local test',state:'connected',async open(){},async close(){},addEventListener:(name,fn)=>{if(name==='midimessage')midiListeners.add(fn);},removeEventListener:(name,fn)=>{if(name==='midimessage')midiListeners.delete(fn);}};
 const access={inputs:new Map([[input.id,input]]),addEventListener:(name,fn)=>{if(name==='statechange')stateListeners.add(fn);},removeEventListener:(name,fn)=>{if(name==='statechange')stateListeners.delete(fn);}};
 window.__deepMidiRequests=0;Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async options=>{if(options.sysex!==false)throw Error('Unexpected sysex request');window.__deepMidiRequests++;return access;}});
 window.__deepMidiEmit=data=>{for(const fn of midiListeners)fn({data:new Uint8Array(data)});};
});
const page=await context.newPage(),results=[],runtimeErrors=[],consoleErrors=[];
page.setDefaultTimeout(7000);page.on('pageerror',error=>runtimeErrors.push(error.message));
page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
page.on('dialog',dialog=>dialog.accept());
const out=new URL('../verification/',import.meta.url);await mkdir(out,{recursive:true});
let serial=0;
const tone=()=>({name:'Original clean',key:'Original_clean',volume:-12,Name:'Original clean',Key:'Original_clean',Volume:'-12',GearList:{Amp:{Key:'Amp_AT120',KnobValues:{Amp_AT120_Gain:20,Amp_AT120_Bass:50,Amp_AT120_Mid:50,Amp_AT120_Treble:50}},Cabinet:{Key:'Cab_AT0112C_57_Cone',KnobValues:{}}}});
function fixture(notes=null){
 const beats=Array.from({length:17},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1}));
 return {version:1,title:`Original browser fixture ${++serial}`,artist:'Local test author',duration:8,beats,sections:[],arrangements:[{id:'lead',name:'Lead',type:'guitar',stringCount:6,basePitches:[40,45,50,55,59,64],tuning:[0,0,0,0,0,0],capo:0,notes:notes??Array.from({length:12},(_,i)=>({id:`n${i}`,time:i*.5,string:i%6,fret:3+i%3,sustain:.2,techniques:{}})),chords:[],chord_templates:[],anchors:[{time:0,fret:3,width:5}],handshapes:[],phrases:[{id:'a',name:'A',time:0}],toneChanges:[],tones:{base:'Original clean',changes:[],definitions:{'Original clean':tone()}}}]};
}
async function run(name,fn){
 const before=runtimeErrors.length;
 try{const detail=await fn();results.push({name,ok:true,...(detail?{detail}:{})});console.log('PASS',name);}
 catch(error){results.push({name,ok:false,error:error.message,status:await page.locator('#ws-status').textContent().catch(()=>null),newRuntimeErrors:runtimeErrors.slice(before)});console.log('FAIL',name,error.message);if(await page.locator('#ws-dialog[open]').count())await page.locator('#ws-dialog button[value="cancel"]').click().catch(()=>{});}
}
async function openMixer(){if(!await page.locator('[data-bus="song"]:visible').count())await action('mixer');}
async function mixerOutput(bus){return (await page.locator(`[data-mixer-channel="${bus}"]`).getAttribute('title')).match(/output (\d+%)/)[1];}
async function action(name){
 const locator=page.locator(`[data-action="${name}"]:visible`);
 if(!await locator.count())await page.locator(`[data-action="${name}"]`).first().evaluate(el=>{const details=el.closest('details');if(details)details.open=true;});
 await page.locator(`[data-action="${name}"]:visible`).first().click();
}
async function submit(){const closed=page.locator('#ws-dialog').evaluate(el=>new Promise(resolve=>el.addEventListener('close',()=>resolve(true),{once:true})));await page.locator('#ws-dialog-submit').click();await closed;}
async function openInput(file){
 await page.locator('#ws-open-file').setInputFiles(file);
 if(await page.locator('#ws-dialog[open]').count()&&await page.locator('#ws-dialog-title').textContent()==='Replace unsaved project?')await submit();
}
async function load(project){
 await openInput({name:'original-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),project.title);
 await page.locator('#ws-tab-button').click();
}
async function download(format='json'){
 const pending=page.waitForEvent('download');
 await action('saveas');await page.locator('#ws-export-format').selectOption(format);await submit();
 const file=await pending,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
 return {name:file.suggestedFilename(),buffer:Buffer.concat(chunks)};
}
async function snapshot(){return JSON.parse((await download()).buffer.toString());}
async function settings(){await page.locator('[data-inspector="settings"]').click();}
async function addTrack(type,name){await action('track');await page.locator('#ws-new-arr-family').selectOption(type);await page.locator('#ws-new-arr-name').fill(name);await submit();await page.waitForFunction(name=>document.querySelector('#ws-arrangement option:checked').textContent.includes(name),name);}
function wav(duration=8){
 const rate=8000,frames=Math.round(rate*duration),b=Buffer.alloc(44+frames*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);
 for(let beat=0;beat<Math.floor(duration*2);beat++)for(let i=0;i<64;i++){const frame=Math.round((.125+beat*.5)*rate)+i;if(frame<frames)b.writeInt16LE(Math.round((1-i/64)*22000*(i%2?1:-1)),44+frame*2);}
 return b;
}
async function upload(){await page.locator('#ws-audio-file').setInputFiles({name:'original-transient-study.wav',mimeType:'audio/wav',buffer:wav()});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready:'));}

try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 await run('Note keyboard entry, drag and sustain properties',async()=>{
  await load(fixture([]));const canvas=page.locator('#ws-canvas');await canvas.click({position:{x:222,y:205}});await page.keyboard.press('5');
  let p=await snapshot();assert.equal(p.arrangements[0].notes.length,1);const n=p.arrangements[0].notes[0];assert.equal(n.fret,5);
  const box=await canvas.boundingBox();await page.mouse.move(box.x+222,box.y+205);await page.mouse.down();await page.mouse.move(box.x+277,box.y+205,{steps:6});await page.mouse.up();
  await page.locator('[data-inspector="properties"]').click();await page.locator('#ws-note-sustain').fill('1.25');await page.locator('#ws-note-sustain').press('Tab');
  p=await snapshot();assert.ok(p.arrangements[0].notes[0].time>n.time);assert.equal(p.arrangements[0].notes[0].sustain,1.25);return p.arrangements[0].notes[0];
 });
 await run('Tempo marker drag changes beat and leaves notes fixed by default',async()=>{
  await load(fixture());const before=await snapshot();await page.locator('#ws-tempo-button').click();const box=await page.locator('#ws-canvas').boundingBox();
  await page.mouse.move(box.x+167,box.y+65);await page.mouse.down();await page.mouse.move(box.x+181,box.y+65,{steps:5});await page.mouse.up();
  const after=await snapshot();assert.ok(after.beats[1].time>before.beats[1].time);assert.deepEqual(after.arrangements[0].notes,before.arrangements[0].notes);return {before:before.beats[1].time,after:after.beats[1].time};
 });
 await run('Chord creation, fingering and template edit preserve child techniques',async()=>{
  const p=fixture([{id:'c1',time:.5,string:0,fret:3,sustain:.4,techniques:{palm_mute:true}},{id:'c2',time:.5,string:1,fret:5,sustain:.4,techniques:{hammer_on:true}}]);
  await load(p);await action('selectall');await action('chord');await page.locator('#ws-chord-name').fill('Original two-string chord');await submit();
  await action('chord-library');await page.locator('[data-chord-edit="0"]').click();await page.locator('#ws-chord-edit-name').fill('Edited chord');await page.locator('#ws-chord-finger-0').fill('1');await submit();
  const saved=await snapshot(),a=saved.arrangements[0];assert.equal(a.chord_templates[0].fingers[0],1);assert.equal(a.chords.length,1);assert.equal(a.chords[0].notes[0].techniques.palm_mute,true);assert.equal(a.chords[0].notes[1].techniques.hammer_on,true);return {notes:a.notes.length,chords:a.chords.length};
 });
 await run('Extended guitar strings preserve chord pitches and shapes',async()=>{
  const p=fixture([]),a=p.arrangements[0];a.chord_templates=[{name:'Shape',displayName:'Shape',frets:[3,5,-1,-1,-1,-1],fingers:[1,3,-1,-1,-1,-1]}];a.chords=[{time:1,chord_id:0,notes:[{id:'x',time:1,string:0,fret:3,sustain:.5,techniques:{}}]}];
  await load(p);await settings();await page.locator('#ws-string-count').selectOption('8');const saved=await snapshot(),next=saved.arrangements[0];
  assert.equal(next.stringCount,8);assert.equal(next.chord_templates[0].frets.length,8);assert.equal(next.chords[0].notes[0].string,2);assert.equal(next.chord_templates[0].frets[2],3);return next.chord_templates[0];
 });
 await run('Generated dynamic difficulty levels switch and preserve authored edits',async()=>{
  await load(fixture());await action('difficulty-generate');await page.locator('#ws-difficulty-count').fill('4');await submit();
  await page.waitForFunction(()=>document.querySelectorAll('#ws-difficulty option').length===4);await page.locator('#ws-difficulty').selectOption('0');
  const low=await snapshot();await action('selectall');await page.locator('#ws-note-fret').fill('9');await page.locator('#ws-note-fret').press('Tab');
  await page.locator('#ws-difficulty').selectOption('3');const high=await snapshot();assert.ok(high.arrangements[0].notes.length>=low.arrangements[0].notes.length);
  await page.locator('#ws-difficulty').selectOption('0');const edited=await snapshot();assert.ok(edited.arrangements[0].notes.every(n=>n.fret===9));return {low:low.arrangements[0].notes.length,high:high.arrangements[0].notes.length};
 });
 await run('Original WAV upload, tempo estimate and accepted map',async()=>{
  await load(fixture());await upload();await action('tempo-detect');await page.locator('#ws-tempo-min').fill('100');await page.locator('#ws-tempo-max').fill('140');await submit();
  await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Suggested'));
  const status=await page.locator('#ws-status').textContent();assert.match(status,/120/);await action('tempo-accept');const p=await snapshot();assert.ok(Math.abs(p.beats[0].time-.125)<.015);assert.ok(p._pack||p.audio);return status;
 });
 await run('Feedpak export and reload retain source audio and authored chart',async()=>{
  await load(fixture());await upload();const before=await snapshot(),file=await download('feedpak');assert.ok(file.buffer.length>1000);
  await openInput({name:file.name,mimeType:'application/zip',buffer:file.buffer});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Opened'));
  const after=await snapshot();assert.equal(after.title,before.title);assert.equal(after.arrangements[0].notes.length,before.arrangements[0].notes.length);assert.ok(Object.keys(after._pack?.entries||{}).some(name=>name.endsWith('.wav')),'Embedded original WAV missing after Feedpak reload');return {bytes:file.buffer.length,entries:Object.keys(after._pack.entries)};
 });
 await run('Editable JSON save/reload retains embedded original audio',async()=>{
  await load(fixture());await upload();const file=await download();const saved=JSON.parse(file.buffer.toString());
  assert.ok(Object.keys(saved._pack?.entries||{}).some(name=>name.endsWith('.wav')),'JSON save references temporary audio without embedding source');
  await openInput({name:'saved-original.json',mimeType:'application/json',buffer:file.buffer});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Opened saved-original.json');
  await action('play');await page.waitForTimeout(180);await action('play');assert.notEqual(await page.locator('#ws-time').textContent(),'00:00.00');return {bytes:file.buffer.length};
 });
 await run('Piano and drums authoring plus five-string bass',async()=>{
  await load(fixture([]));await addTrack('keys','Original piano');await page.locator('#ws-canvas').click({position:{x:250,y:400}});await page.keyboard.press('3');
  await page.locator('[data-inspector="properties"]').click();await page.locator('#ws-note-pitch').fill('60');await page.locator('#ws-note-pitch').press('Tab');
  await addTrack('drums','Original drums');await page.locator('#ws-canvas').click({position:{x:250,y:205}});await page.keyboard.press('1');await page.locator('[data-inspector="properties"]').click();await page.locator('#ws-note-piece').selectOption('kick');await page.locator('#ws-note-velocity').fill('115');await page.locator('#ws-note-velocity').press('Tab');
  await addTrack('bass','Original five-string');await settings();await page.locator('#ws-string-count').selectOption('5');const p=await snapshot();assert.equal(p.arrangements.find(a=>a.type==='keys').notes[0].pitch,60);assert.equal(p.arrangements.find(a=>a.type==='drums').notes[0].piece,'kick');assert.equal(p.arrangements.find(a=>a.type==='drums').notes[0].velocity,115);assert.equal(p.arrangements.find(a=>a.type==='bass').stringCount,5);return p.arrangements.map(a=>a.type);
 });
 await run('Loop, speed ramp, pitch, resize and leave/reenter transport',async()=>{
  await load(fixture());await settings();await page.locator('#ws-loop-start').fill('0.5');await page.locator('#ws-loop-end').fill('1.5');await action('loop');await settings();
  await page.locator('#ws-ramp-enabled').check();await page.locator('#ws-ramp-start').fill('60');await page.locator('#ws-ramp-start').press('Tab');await page.locator('#ws-ramp-end').fill('90');await page.locator('#ws-ramp-end').press('Tab');
  await page.locator('#ws-speed').fill('75');await page.locator('#ws-pitch').fill('-3');await page.locator('#ws-pitch').press('Tab');await page.locator('#ws-play').click();await page.waitForTimeout(300);
  const playingTime=await page.locator('#ws-time').textContent();assert.notEqual(playingTime,'00:00.00','Playback clock did not advance');
  await page.evaluate(()=>window.__deepEmit('screen:changed',{screen:'library'}));const paused=await page.locator('#ws-time').textContent();assert.notEqual(paused,'00:00.00','Leaving the editor loses transport position');await page.waitForTimeout(220);assert.equal(await page.locator('#ws-time').textContent(),paused);
  await page.evaluate(()=>window.__deepEmit('screen:changed',{screen:'open_chart_editor'}));await page.locator('#ws-play').click();await page.waitForTimeout(180);await page.locator('#ws-play').click();
  await page.setViewportSize({width:1100,height:760});await page.waitForTimeout(100);assert.ok((await page.locator('#ws-canvas').boundingBox()).width>400);await page.setViewportSize({width:1700,height:1050});return {paused};
 });
 await run('Tempo ramp and mixed meter user authoring',async()=>{
  await load(fixture());await action('tempo-ramp');await page.locator('#ws-tempo-ramp-start').fill('0');await page.locator('#ws-tempo-ramp-end').fill('8');await page.locator('#ws-tempo-ramp-from').fill('80');await page.locator('#ws-tempo-ramp-to').fill('160');await submit();
  await action('meter');await page.locator('#ws-meter-num').fill('6');await page.locator('#ws-meter-den').selectOption('8');await submit();
  const p=await snapshot(),gaps=p.beats.slice(1,9).map((beat,index)=>beat.time-p.beats[index].time);
  assert.ok(gaps.every((gap,index)=>index===0||gap<gaps[index-1]));assert.equal(p.beats[0].numerator,6);assert.equal(p.beats[0].denominator,8);assert.equal(p.beats[6].bar,2);return {firstGap:gaps[0],lastGap:gaps.at(-1),signature:await page.locator('#ws-signature').textContent()};
 });
 await run('Tone rack structured gear/knob editing and allocation',async()=>{
  await load(fixture());await page.locator('#ws-tones-button').click();
  await page.waitForSelector('[data-gear-slot="Amp"]');
  await action('tone-definition');await page.locator('#ws-tone-new-name').fill('Original overdrive');await submit();
  await page.waitForFunction(()=>document.querySelector('#ws-tone-library')?.value==='Original overdrive');
  await page.locator('[data-gear-slot="PrePedal1"]').selectOption('Pedal_Distortion');
  await page.locator('[data-knob-key="Pedal_Distortion_Gain"]').fill('75');await page.locator('[data-knob-key="Pedal_Distortion_Gain"]').press('Tab');
  await page.locator('#ws-tone-volume').fill('-18');await page.locator('#ws-tone-volume').press('Tab');
  await action('tone');await page.locator('#ws-tone-name').selectOption('Original overdrive');await submit();
  const saved=await snapshot(),tones=saved.arrangements[0].tones;
  assert.equal(tones.definitions['Original overdrive'].GearList.PrePedal1.KnobValues.Pedal_Distortion_Gain,75);
  assert.equal(tones.definitions['Original overdrive'].volume,-18);assert.equal(tones.changes[0].name,'Original overdrive');
  await action('tone-copy');await page.locator('#ws-tone-copy-name').fill('Independent clone');await submit();
  await page.waitForFunction(()=>document.querySelector('#ws-tone-library')?.value==='Independent clone');
  await page.locator('[data-knob-key="Pedal_Distortion_Gain"]').fill('40');await page.locator('[data-knob-key="Pedal_Distortion_Gain"]').press('Tab');
  const cloned=await snapshot();assert.equal(cloned.arrangements[0].tones.definitions['Original overdrive'].GearList.PrePedal1.KnobValues.Pedal_Distortion_Gain,75);return {ampChoices:await page.locator('[data-gear-slot="Amp"] option').count(),cabinetChoices:await page.locator('[data-gear-slot="Cabinet"] option').count(),allocated:tones.changes[0]};
 });
 await run('Silent audio gives a useful tempo-analysis result',async()=>{
  await load(fixture());const silent=wav();silent.fill(0,44);
  await page.locator('#ws-audio-file').setInputFiles({name:'original-silence.wav',mimeType:'audio/wav',buffer:silent});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready: original-silence.wav'));
  await action('tempo-detect');await submit();await page.waitForFunction(()=>{const text=document.querySelector('#ws-status').textContent;return !text.startsWith('Analyzing')&&!text.startsWith('Audio ready:');});
  const status=await page.locator('#ws-status').textContent();assert.ok(!/toFixed|null|undefined/i.test(status),'Silent analysis exposes implementation error: '+status);assert.ok(/no|insufficient|could not|unable|silence|not enough/i.test(status),'Silent analysis should explain that no beat was detected: '+status);return status;
 });
 await run('Region copy, paste, clear and undo retain notes/chords/all structure',async()=>{
  const p=fixture([{id:'region-n0',time:.5,string:0,fret:3,sustain:.25,techniques:{palm_mute:true}},{id:'region-n1',time:1.5,string:2,fret:7,sustain:.25,techniques:{}}]),a=p.arrangements[0];
  a.chord_templates=[{name:'Original shape',displayName:'Original shape',frets:[-1,5,-1,7,-1,-1],fingers:[-1,1,-1,3,-1,-1]}];a.chords=[{time:1,chord_id:0,notes:[{id:'child1',time:1,string:1,fret:5,sustain:.4,techniques:{}},{id:'child2',time:1,string:3,fret:7,sustain:.4,techniques:{}}]}];a.anchors.push({time:1,fret:5,width:4});a.handshapes=[{chord_id:0,start_time:.9,end_time:1.6}];a.tones.changes=[{time:1,name:'Original clean'}];p.sections=[{name:'intro',number:1,start_time:0}];p.vocals=[{id:'syllable',time:1,length:.25,text:'Original'}];
  await load(p);await action('selectregion');await page.locator('#ws-region-start').fill('0');await page.locator('#ws-region-end').fill('2');await submit();await action('copy');
  await page.locator('#ws-canvas').click({position:{x:552,y:160}});await action('paste');const pasted=await snapshot(),b=pasted.arrangements[0];
  assert.equal(b.notes.length,4);assert.equal(b.chords.length,2);assert.equal(b.anchors.length,4);assert.equal(b.phrases.length,2);assert.equal(b.handshapes.length,2);assert.equal(b.tones.changes.length,2);assert.equal(pasted.sections.length,2);assert.equal(pasted.vocals.length,2);assert.equal(b.chords[1].time,5);
  await action('delete');const cleared=await snapshot();assert.deepEqual(cleared.arrangements[0].notes,p.arrangements[0].notes);assert.equal(cleared.arrangements[0].chords.length,1);assert.equal(cleared.sections.length,1);assert.equal(cleared.vocals.length,1);
  await action('undo');const restored=await snapshot();assert.deepEqual(restored.arrangements[0].notes,b.notes);assert.equal(restored.arrangements[0].handshapes.length,2);await action('redo');assert.equal((await snapshot()).arrangements[0].chords.length,1);return {copiedNotes:2,copiedChords:1,copiedStructures:['anchors','phrases','handshapes','tones','sections','vocals']};
 });
 await run('Timeline phrase and anchor inspector rename, drag, delete and undo',async()=>{
  await load(fixture());await page.locator('#ws-canvas').click({position:{x:145,y:91}});await page.locator('#ws-marker-name').fill('Original renamed phrase');await page.locator('#ws-marker-name').press('Tab');
  await page.locator('#ws-canvas').click({position:{x:145,y:137}});await page.locator('#ws-marker-fret').fill('6');await page.locator('#ws-marker-fret').press('Tab');
  const box=await page.locator('#ws-canvas').boundingBox();await page.mouse.move(box.x+120,box.y+137);await page.mouse.down();await page.mouse.move(box.x+175,box.y+137,{steps:5});await page.mouse.up();
  const edited=await snapshot();assert.equal(edited.arrangements[0].phrases[0].name,'Original renamed phrase');assert.equal(edited.arrangements[0].anchors[0].fret,6);assert.ok(edited.arrangements[0].anchors[0].time>0);
  await action('marker-delete');assert.equal((await snapshot()).arrangements[0].anchors.length,0);await action('undo');assert.deepEqual((await snapshot()).arrangements[0].anchors,edited.arrangements[0].anchors);return edited.arrangements[0].anchors[0];
 });
 await run('Original lyric phrase editing and native vocal XML export/reload',async()=>{
  await load(fixture([]));await action('vocals');await action('vocal-phrase');await page.locator('#ws-vocal-phrase').fill('Soft morning light');await page.locator('#ws-vocal-step').fill('0.4');await submit();await page.waitForFunction(()=>document.querySelectorAll('[data-vocal-field="text"]').length===3);
  await page.locator('[data-vocal-field="text"]').first().fill('Bright');await page.locator('[data-vocal-field="text"]').first().press('Tab');await page.locator('[data-vocal-field="length"]').first().fill('0.35');await page.locator('[data-vocal-field="length"]').first().press('Tab');await page.locator('[data-vocal-field="pitch"]').first().fill('60');await page.locator('[data-vocal-field="pitch"]').first().press('Tab');
  const file=await download('vocal_xml');assert.match(file.buffer.toString(),/Bright/);assert.match(file.buffer.toString(),/vocals/);
  await openInput({name:'original-vocals.xml',mimeType:'application/xml',buffer:file.buffer});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Opened original-vocals.xml');
  const p=await snapshot();assert.equal(p.vocals.length,3);assert.equal(p.vocals[0].text,'Bright');assert.equal(p.vocals[0].length,.35);assert.equal(p.vocals[0].pitch,60);return {xmlBytes:file.buffer.length,syllables:p.vocals.length};
 });
 await run('MIDI device choice and live piano recording use only injected controller',async()=>{
  await load(fixture([]));await addTrack('keys','Recorded original piano');await settings();await page.locator('#ws-ramp-enabled').uncheck();if(await page.locator('#ws-loop.active').count())await action('loop');await page.locator('#ws-speed').fill('100');await page.locator('#ws-snap').selectOption('0');
  assert.equal(await page.evaluate(()=>window.__deepMidiRequests),0);await action('midi-input');await page.locator('#ws-midi-device').selectOption('original-test-controller');await submit();assert.equal(await page.evaluate(()=>window.__deepMidiRequests),1);
  await action('record-midi');await page.waitForSelector('#ws-record-midi.active');await page.evaluate(()=>window.__deepMidiEmit([0x90,60,103]));await page.waitForTimeout(170);await page.evaluate(()=>window.__deepMidiEmit([0x80,60,0]));
  await page.evaluate(()=>{window.__deepMidiEmit([0xb0,64,127]);window.__deepMidiEmit([0x90,64,88]);});await page.waitForTimeout(110);await page.evaluate(()=>window.__deepMidiEmit([0x80,64,0]));await page.waitForTimeout(100);await page.evaluate(()=>window.__deepMidiEmit([0xb0,64,0]));await action('record-midi');
  const p=await snapshot(),notes=p.arrangements.find(a=>a.name==='Recorded original piano').notes;assert.deepEqual(notes.map(n=>n.pitch),[60,64]);assert.deepEqual(notes.map(n=>n.velocity),[103,88]);assert.ok(notes.every(n=>n.sustain>.08));assert.equal(await page.evaluate(()=>window.__deepMidiRequests),1);return notes.map(n=>({pitch:n.pitch,sustain:n.sustain,velocity:n.velocity}));
 });
 await run('Sparse undo/redo across arrangement creation and difficulty editing',async()=>{
  await load(fixture());await addTrack('bass','Undoable bass');await action('undo');assert.equal(await page.locator('#ws-arrangement option').count(),1);await action('redo');assert.equal(await page.locator('#ws-arrangement option').count(),2);
  await page.locator('#ws-arrangement').selectOption('lead');await action('difficulty-generate');await page.locator('#ws-difficulty-count').fill('3');await submit();await page.waitForFunction(()=>document.querySelectorAll('#ws-difficulty option').length===3);await action('undo');assert.equal(await page.locator('#ws-difficulty option').count(),1);await action('redo');assert.equal(await page.locator('#ws-difficulty option').count(),3);
  await page.locator('#ws-difficulty').selectOption('0');await action('selectall');const before=await snapshot();await page.locator('#ws-note-fret').fill('12');await page.locator('#ws-note-fret').press('Tab');await action('undo');assert.deepEqual((await snapshot()).arrangements[0].notes,before.arrangements[0].notes);await action('redo');assert.ok((await snapshot()).arrangements[0].notes.every(n=>n.fret===12));return {arrangements:2,levels:3};
 });
 await run('Original practice audio render attaches valid portable WAV',async()=>{
  await load(fixture());await action('render-guide');await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Original practice backing rendered and attached');const p=await snapshot(),entry=Object.entries(p._pack?.entries||{}).find(([name])=>name.endsWith('.wav'));
  assert.ok(entry,'Rendered WAV not embedded');const bytes=Buffer.from(entry[1],'base64');assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.ok(bytes.length>10000);return {wavBytes:bytes.length};
 });
 await run('Single chord-member copy/delete preserves shared templates without fingering arrays',async()=>{
  const p=fixture([]),a=p.arrangements[0];a.chord_templates=[{name:'Original triple',displayName:'Original triple',frets:[3,5,7,-1,-1,-1],authorMetadata:{original:true}}];
  a.chords=[1,3].map((time,index)=>({time,chord_id:0,notes:[0,1,2].map(string=>({id:`member-${index}-${string}`,time,string,fret:[3,5,7][string],sustain:.4,techniques:{palm_mute:string===0,hammer_on:string===1},memberData:{preserve:string}}))}));
  await load(p);const row=await page.locator('#ws-timeline-scroll').evaluate(el=>Math.max(26,Math.min(45,(el.clientHeight-174-40)/6)));
  await page.locator('#ws-canvas').click({position:{x:222,y:174+(5-1+.5)*row}});assert.equal(await page.locator('#ws-note-fret').inputValue(),'5');await page.locator('#ws-canvas').focus();await page.keyboard.press('c');await action('copy');
  await page.locator('#ws-canvas').click({position:{x:552,y:160}});await action('paste');const copied=await snapshot();assert.equal(copied.arrangements[0].notes.length,1);assert.equal(copied.arrangements[0].notes[0].techniques.hammer_on,true);assert.equal(copied.arrangements[0].notes[0].techniques.accent,true);assert.equal(copied.arrangements[0].notes[0].memberData.preserve,1);await action('delete');
  await page.locator('#ws-canvas').click({position:{x:222,y:174+(5+.5)*row}});await action('delete');const partial=await snapshot(),changed=partial.arrangements[0];
  assert.equal(changed.chords.length,2);assert.equal(changed.chords[0].notes.length,2);assert.notEqual(changed.chords[0].chord_id,0);assert.equal(changed.chords[1].chord_id,0);assert.deepEqual(changed.chord_templates[0],a.chord_templates[0]);assert.deepEqual(changed.chord_templates[1].fingers,[-1,-1,-1,-1,-1,-1]);assert.deepEqual(changed.chord_templates[1].frets,[-1,5,7,-1,-1,-1]);
  await page.locator('#ws-canvas').click({position:{x:222,y:174+(5-1+.5)*row}});await action('delete');const dissolved=await snapshot();assert.equal(dissolved.arrangements[0].chords.length,1);assert.equal(dissolved.arrangements[0].notes.length,1);assert.equal(dissolved.arrangements[0].notes[0].memberData.preserve,2);await action('undo');assert.equal((await snapshot()).arrangements[0].chords[0].notes.length,2);return {sharedTemplateUnchanged:true,unfingeredTemplateSupported:true};
 });
 await run('Whole chord-member selection copies native chord and edits preserve child data',async()=>{
  const p=fixture([]),a=p.arrangements[0];a.chord_templates=[{name:'Original pair',displayName:'Original pair',frets:[3,5,-1,-1,-1,-1]}];a.chords=[{time:1,chord_id:0,notes:[0,1].map(string=>({id:`whole-${string}`,time:1,string,fret:string?5:3,sustain:.375,techniques:{vibrato:true},opaque:{preserve:true}}))}];
  await load(p);await action('selectall');await action('copy');await page.locator('#ws-canvas').click({position:{x:552,y:160}});await action('paste');const pasted=await snapshot();assert.equal(pasted.arrangements[0].chords.length,2);assert.equal(pasted.arrangements[0].notes.length,0);assert.equal(pasted.arrangements[0].chords[1].time,4);assert.notEqual(pasted.arrangements[0].chords[1].notes[0].id,'whole-0');
  await action('chord');await page.waitForFunction(()=>document.querySelector('#ws-dialog-title').textContent==='Edit chord');assert.equal(await page.locator('#ws-chord-finger-0').inputValue(),'-1');await page.locator('#ws-chord-edit-name').fill('Renamed original pair');await submit();const edited=await snapshot();assert.ok(edited.arrangements[0].chords.every(chord=>chord.notes.every(note=>note.techniques.vibrato&&note.opaque.preserve&&note.sustain===.375)));return {nativeChords:2,standaloneNotes:0,optionalFingeringEditable:true};
 });
 await run('Role and priority controls survive native arrangement XML roundtrip',async()=>{
  await load(fixture());await settings();await page.locator('#ws-arr-role').selectOption('rhythm');await page.locator('#ws-arr-priority').selectOption('bonus');const authored=await snapshot();assert.equal(authored.arrangements[0].role,'rhythm');assert.equal(authored.arrangements[0].priority,'bonus');
  const file=await download('xml');assert.match(file.buffer.toString(),/pathRhythm="1"/);assert.match(file.buffer.toString(),/bonusArr="1"/);
  await openInput({name:'original-bonus-rhythm.xml',mimeType:'application/xml',buffer:file.buffer});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.startsWith('Opened original-bonus-rhythm.xml'));const imported=await snapshot();assert.equal(imported.arrangements[0].role,'rhythm');assert.equal(imported.arrangements[0].priority,'bonus');return {role:'rhythm',priority:'bonus'};
 });
 await run('Piano full MIDI range authors both endpoints through vertical scrolling',async()=>{
  await load(fixture([]));await addTrack('keys','Full range piano');await settings();await page.locator('#ws-piano-low').fill('0');await page.locator('#ws-piano-low').press('Tab');await page.locator('#ws-piano-high').fill('127');await page.locator('#ws-piano-high').press('Tab');
  await page.locator('#ws-canvas').click({position:{x:222,y:183}});await page.keyboard.press('3');await page.locator('#ws-timeline-scroll').evaluate(el=>el.scrollTop=el.scrollHeight-el.clientHeight);await page.waitForTimeout(50);const box=await page.locator('#ws-canvas').boundingBox();await page.mouse.click(box.x+332,box.y+174+127.5*18-await page.locator('#ws-timeline-scroll').evaluate(el=>el.scrollTop));await page.keyboard.press('1');
  const p=await snapshot(),keys=p.arrangements.find(a=>a.type==='keys');assert.deepEqual(keys.notes.map(note=>note.pitch).sort((a,b)=>a-b),[0,127]);return {lowest:0,highest:127};
 });
 await run('Long original audio extends beat map without moving existing chart notes',async()=>{
  const source=fixture();await load(source);await page.locator('#ws-audio-file').setInputFiles({name:'original-long-study.wav',mimeType:'audio/wav',buffer:wav(25.25)});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Audio ready: original-long-study.wav');const p=await snapshot();assert.equal(p.duration,25.25);assert.ok(p.beats.at(-1).time>=25);assert.ok(p.beats.every((beat,index)=>index===0||beat.time>p.beats[index-1].time));assert.deepEqual(p.arrangements[0].notes,source.arrangements[0].notes);return {audioSeconds:p.duration,lastBeat:p.beats.at(-1).time,beatCount:p.beats.length};
 });
 await run('Lossy exports retain unsaved marker while complete JSON save clears it',async()=>{
  await load(fixture());await upload();await settings();await page.locator('#ws-meta-artist').fill('Edited original artist');await page.locator('#ws-meta-artist').press('Tab');assert.ok((await page.locator('#ws-dirty').textContent()).trim());
  await download('xml');assert.ok((await page.locator('#ws-dirty').textContent()).trim(),'XML export falsely marks complete project saved');await download('feedpak');assert.ok((await page.locator('#ws-dirty').textContent()).trim(),'Feedpak export falsely marks complete project saved');await download('json');assert.equal((await page.locator('#ws-dirty').textContent()).trim(),'');return {xmlRetainsDirty:true,feedpakRetainsDirty:true,jsonClearsDirty:true};
 });
 await run('Edits made while a JSON save is pending remain marked unsaved',async()=>{
  await load(fixture());await settings();await page.locator('#ws-meta-artist').fill('Before network save');await page.locator('#ws-meta-artist').press('Tab');let release;const gate=new Promise(resolve=>{release=resolve;});
  const intercept=async route=>{await gate;await route.continue();};await page.route('**/api/plugins/open_chart_editor/save',intercept);
  try{
   const requested=page.waitForRequest(request=>request.url().endsWith('/api/plugins/open_chart_editor/save')&&request.method()==='POST'),pending=page.waitForEvent('download');
   await action('saveas');await page.locator('#ws-export-format').selectOption('json');await submit();await requested;
   await page.locator('#ws-meta-artist').fill('After save was requested');await page.locator('#ws-meta-artist').press('Tab');release();
   const file=await pending,stream=await file.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const saved=JSON.parse(Buffer.concat(chunks).toString());
   assert.equal(saved.artist,'Before network save');assert.equal(await page.locator('#ws-meta-artist').inputValue(),'After save was requested');assert.ok((await page.locator('#ws-dirty').textContent()).trim(),'A stale JSON response clears newer edits');return {savedArtist:saved.artist,currentArtist:'After save was requested'};
  }finally{release();await page.unroute('**/api/plugins/open_chart_editor/save',intercept);}
 });
 await run('Local count-in cancels on pause/navigation and starts from cursor without retiming charts',async()=>{
  await load(fixture());await settings();await page.locator('#ws-ramp-enabled').uncheck();if(await page.locator('#ws-loop.active').count())await action('loop');await page.locator('#ws-speed').fill('100');await action('start');const before=await snapshot();
  await action('count-in');await page.locator('#ws-count-in-enabled').check();await page.locator('#ws-count-in-mode').selectOption('beats');await page.locator('#ws-count-in-count').fill('2');await submit();
  await page.locator('#ws-play').click();await page.waitForFunction(()=>/^Count-in \d+ \/ \d+$/.test(document.querySelector('#ws-status').textContent));assert.equal(await page.locator('#ws-time').textContent(),'00:00.00');await page.locator('#ws-play').click();await page.waitForTimeout(1150);assert.equal(await page.locator('#ws-time').textContent(),'00:00.00');
  await page.locator('#ws-play').click();await page.waitForFunction(()=>/^Count-in \d+ \/ \d+$/.test(document.querySelector('#ws-status').textContent));await page.evaluate(()=>window.__deepEmit('screen:changed',{screen:'library'}));await page.waitForTimeout(1150);assert.equal(await page.locator('#ws-time').textContent(),'00:00.00');await page.evaluate(()=>window.__deepEmit('screen:changed',{screen:'open_chart_editor'}));
  await action('forward');await action('forward');await action('count-in');await page.locator('#ws-count-in-count').fill('1');await submit();await page.locator('#ws-play').click();await page.waitForFunction(()=>document.querySelector('#ws-status').textContent==='Playing - count-in complete');await page.waitForTimeout(160);await page.locator('#ws-play').click();assert.ok(Number((await page.locator('#ws-time').textContent()).split(':')[1])>1);
  await action('count-in');await page.locator('#ws-count-in-enabled').uncheck();await submit();const after=await snapshot();assert.deepEqual(after.beats,before.beats);assert.deepEqual(after.arrangements,before.arrangements);return {pauseCancels:true,navigationCancels:true,startCursor:1,sourceTimesUnchanged:true};
 });
 await run('Mixer mute, solo, routing and master retain independent desired faders',async()=>{
  await load(fixture());await openMixer();await page.locator('[data-bus="song"]').fill(fp(.6,'song'));await page.locator('[data-bus="guide"]').fill(fp(.4,'guide'));await page.locator('[data-bus="metronome"]').fill(fp(.35,'metronome'));await page.locator('[data-bus="master"]').fill(fp(.75,'master'));
  await page.locator('[data-mixer-solo="guide"]').click();assert.equal(await mixerOutput('song'),'0%');assert.equal(await mixerOutput('guide'),'30%');assert.equal(await page.locator('[data-bus="song"]').inputValue(),fp(.6,'song'));
  await page.locator('[data-mixer-mute="guide"]').click();assert.equal(await mixerOutput('guide'),'0%');await page.locator('[data-mixer-mute="guide"]').click();assert.equal(await mixerOutput('guide'),'30%');
  await page.locator('[data-mixer-mute="master"]').click();assert.equal(await mixerOutput('guide'),'0%');await page.locator('[data-mixer-mute="master"]').click();await page.locator('[data-mixer-solo="guide"]').click();
  if(await page.locator('#ws-click.active').count())await action('metronome');await action('metronome');assert.equal(await page.locator('[data-bus="metronome"]').inputValue(),fp(.35,'metronome'));assert.equal(await mixerOutput('metronome'),'26%');await action('metronome');assert.equal(await page.locator('[data-bus="metronome"]').inputValue(),fp(.35,'metronome'));assert.equal(await mixerOutput('metronome'),'0%');return {songDesired:60,guideDesired:40,metronomeDesired:35,master:75};
 });
 await run('Draft recovery after browser reload restores authored notes and audio',async()=>{
  const source=fixture([]);await load(source);await upload();await page.locator('#ws-canvas').click({position:{x:300,y:230}});await page.keyboard.press('8');await page.waitForTimeout(900);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#ws-status')?.textContent.startsWith('Recovered local working draft'));const p=await snapshot();assert.equal(p.title,source.title);assert.equal(p.arrangements[0].notes.length,1);assert.equal(p.arrangements[0].notes[0].fret,8);assert.ok(Object.keys(p._pack?.entries||{}).some(name=>name.endsWith('.wav')));return {title:p.title,audio:p.audio?.name};
 });
 await run('Host screen DOM detach/reinsert remounts and retains working project',async()=>{
  const source=fixture();await load(source);await upload();
  await page.locator('#ws-canvas').click({position:{x:400,y:220}});await page.keyboard.press('8');await page.locator('[data-inspector="properties"]').click();assert.equal(await page.locator('#ws-note-fret').inputValue(),'8');await page.locator('#ws-zoom').fill('140');await page.locator('#ws-snap').selectOption('8');await openMixer();await page.locator('[data-bus="song"]').fill(fp(.57,'song'));await page.locator('[data-mixer-mute="song"]').click();await page.locator('[data-mixer-solo="guide"]').click();const before=await snapshot();
  await page.evaluate(async()=>{
   window.__deepEmit('screen:changed',{screen:'library'});
   const html=await(await fetch('/')).text(),fragment=new DOMParser().parseFromString(html,'text/html').querySelector('#ws-app');
   document.getElementById('ws-app').remove();await new Promise(resolve=>setTimeout(resolve,25));document.body.appendChild(document.importNode(fragment,true));
   window.__deepEmit('screen:changed',{screen:'open_chart_editor'});
  });
  await page.waitForSelector('#ws-app[data-mounted="true"]');await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),source.title);
  const after=await snapshot();assert.deepEqual(after.arrangements[0].notes,before.arrangements[0].notes);assert.ok(after.audio||after._pack);assert.equal(await page.locator('#ws-zoom').inputValue(),'140');assert.equal(await page.locator('#ws-snap').inputValue(),'8');assert.equal(await page.locator('#ws-note-fret').inputValue(),'8');assert.equal(await page.locator('[data-bus="song"]').inputValue(),fp(.57,'song'));assert.equal(await page.locator('[data-mixer-mute="song"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-mixer-solo="guide"]').getAttribute('aria-pressed'),'true');await action('undo');assert.equal((await snapshot()).arrangements[0].notes.length,12);await action('redo');assert.equal((await snapshot()).arrangements[0].notes.length,13);return {title:after.title,notes:after.arrangements[0].notes.length,selectionRetained:true,undoRetained:true,mixerRetained:true,zoom:140,snap:8};
 });
 await page.screenshot({path:new URL('browser-deep.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
}finally{
 const report={ok:results.every(result=>result.ok)&&runtimeErrors.length===0&&consoleErrors.length===0,url:process.env.OCE_URL||'http://127.0.0.1:8766',timestamp:new Date().toISOString(),results,runtimeErrors,consoleErrors};
 await writeFile(new URL('browser-deep.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();if(!report.ok)process.exitCode=1;
}
