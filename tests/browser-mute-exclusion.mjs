// Prepared before/after real UI proof; never run during another owner's soak.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
if(process.env.OCE_MUTE_RELEASE!=='1')throw Error('Parent sole-browser release required after frozen endurance');
const phase=process.env.OCE_MUTE_PHASE||'after';assert.ok(['before','after'].includes(phase));
let root=dirname(fileURLToPath(import.meta.url));while(!existsSync(join(root,'src/model.js'))){const parent=dirname(root);if(parent===root)throw Error('OCE root unavailable');root=parent;}
const stage=join(root,'research/staging/mute-exclusion'),plan=JSON.parse(await readFile(join(stage,'plan.json'),'utf8'));
const {muteFixture,activeNotes,expectedMute}=await import(pathToFileURL(join(stage,'fixture.mjs')).href);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sourceHashes=Object.fromEntries(await Promise.all(['src/main.js','src/technique-tags.js','src/model.js','src/history.js','src/difficulty.js'].map(async name=>[name,sha(await readFile(join(root,name)))])));
assert.equal(sourceHashes['src/main.js'],phase==='before'?plan.baseSha256:plan.stagedSha256,'Exact reviewed main for phase; no overlays');
for(const [name,expected]of Object.entries(plan.dependencies))assert.equal(sourceHashes['src/'+name],expected,name);
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core'),browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio']}),context=await browser.newContext({viewport:{width:1700,height:1050}});
const checks=[],errors=[],observations=[];let ok=false,failure=null,hardware=null,nativeXml=null;
await context.addInitScript(()=>{
 window.__muteProof={writes:[],contexts:0,capture:0,midi:0};window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>window.__muteProof.writes.push(await blob.text()),close:async()=>{}})});
 const Native=window.AudioContext;window.AudioContext=class extends Native{constructor(){window.__muteProof.contexts++;throw Error('No AudioContext permitted in mute authoring proof');}};
 Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>{window.__muteProof.midi++;throw Error('Physical MIDI forbidden');}});if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{window.__muteProof.capture++;throw Error('Physical capture forbidden');}});
});
await context.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().evaluate(element=>element.click());
async function save(format='json'){const count=await page.evaluate(()=>window.__muteProof.writes.length);await action('saveas');await page.locator('#ws-export-format').selectOption(format);await page.locator('#ws-dialog-submit').click();await page.waitForFunction(count=>window.__muteProof.writes.length>count,count);const data=await page.evaluate(()=>window.__muteProof.writes.at(-1));return format==='json'?JSON.parse(data):data;}
const note=(project,id)=>activeNotes(project.arrangements[0]).find(note=>note.id===id);
async function region(start,end,count){await action('selectregion');await page.locator('#ws-region-start').fill(String(start));await page.locator('#ws-region-end').fill(String(end));await page.locator('#ws-dialog-submit').click();await page.locator('[data-inspector="properties"]').click();await page.waitForFunction(count=>document.querySelector('#ws-inspector-content h3')?.textContent.startsWith(count+' selected'),count);}
async function key(value){await page.locator('#ws-canvas').focus();await page.keyboard.press(value);}
async function command(label,baseline,ids,select,keyName,enabled,input,{xml=false}={}){
 await select();const before=await save();assert.deepEqual(before,baseline,label+': selection itself is read-only');
 if(input==='keyboard')await key(keyName==='palm_mute'?'p':'m');else await page.locator(`[data-technique="${keyName}"]`).click();
 const actual=await save(),expected=expectedMute(baseline,ids,keyName,enabled);assert.notDeepEqual(expected,baseline,label+': real change required');assert.deepEqual(actual,expected,label+': only intended selected flags change');
 observations.push({label,ids,key:keyName,enabled,input,before:ids.map(id=>note(before,id)),after:ids.map(id=>note(actual,id))});
 if(xml){
  const source=await save('xml');nativeXml=await page.evaluate(xml=>{const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid saved XML');const level=doc.querySelector('level[difficulty="0"]');return{notes:[...level.querySelectorAll('notes > note')].map(note=>Object.fromEntries([...note.attributes].map(attribute=>[attribute.name,attribute.value]))),chordVoices:[...level.querySelectorAll('chordNote')].map(note=>({fret:Number(note.getAttribute('fret')),string:Number(note.getAttribute('string'))})),chordMuteFlags:[...level.querySelectorAll('chordNote')].map(note=>({string:Number(note.getAttribute('string')),palmMute:Number(note.getAttribute('palmMute')),mute:Number(note.getAttribute('mute'))})),levels:[...doc.querySelectorAll('levels > level')].map(level=>Number(level.getAttribute('difficulty')))};},source);
  const target=nativeXml.notes.find(row=>Number(row.time)===1&&Number(row.string)===0);assert.equal(Number(target.fret),5);assert.equal(Number(target.palmMute),1);assert.equal(Number(target.mute),0);assert.equal(target.fretHandMute,undefined);assert.equal(target.ownSource,'own-fhm');const positive=nativeXml.notes.find(row=>Number(row.time)===2&&Number(row.string)===1);assert.equal(Number(positive.palmMute),1,'Positive legacy PM is binary on in native output');const negative=nativeXml.chordMuteFlags.find(row=>row.string===3);assert.deepEqual(negative,{string:3,palmMute:0,mute:0},'Negative inactive PM/legacy mute must remain inactive on output');const retained=nativeXml.chordMuteFlags.find(row=>row.string===2);assert.deepEqual(retained,{string:2,palmMute:1,mute:1},'Untouched authored contradictory flags retain their meaning until explicit command');assert.deepEqual(nativeXml.chordVoices.sort((a,b)=>a.string-b.string),[{fret:9,string:2},{fret:10,string:3}]);assert.deepEqual(nativeXml.levels,[0,3]);checks.push('Native XML overrides original contradictory mute attributes with explicit false while retaining fret, opaque note attribute, both chord voices and inactive level');
 }
 await action('undo');assert.deepEqual(await save(),baseline,label+': one Undo restores entire project');await action('redo');assert.deepEqual(await save(),expected,label+': one Redo restores exact intended project');await action('undo');assert.deepEqual(await save(),baseline,label+': return to baseline');checks.push(label+': exact full JSON, active DD mirror, inactive DD/native source/frets preserved and one Undo/Redo');
}
try{
 const fixture=muteFixture();await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');await page.locator('#ws-open-file').setInputFiles({name:'own-mute-command.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Own mute command isolation'));
 const baseline=await save();assert.deepEqual(baseline._pack,fixture._pack);assert.deepEqual(note(baseline,'own-contradictory').techniques,note(fixture,'own-contradictory').techniques);assert.deepEqual(note(baseline,'own-fhm')._xml,note(fixture,'own-fhm')._xml);checks.push('Editable JSON import preserves contradictory flags and original native XML/opaque data until an explicit mute command');
 if(phase==='before'){
  await region(.9,1.1,1);await key('p');const actual=await save(),before=note(baseline,'own-fhm'),after=note(actual,'own-fhm');observations.push({label:'baseline PM enable',id:'own-fhm',before,after,contradictoryAfter:after.techniques.palm_mute===true&&(after.techniques.fret_hand_mute>0||after.techniques.mute>0)});
  assert.equal(after.techniques.palm_mute,true);assert.equal(after.fret,before.fret);assert.equal(after._xml,before._xml);assert.equal(after.techniques.fret_hand_mute,false,'Expected baseline counterexample: PM enable must clear FHM');throw Error('Baseline unexpectedly satisfied fixed behavior; inspect exact source before promotion');
 }
 await command('Keyboard P enables PM and clears positive FHM/legacy alias',baseline,['own-fhm'],()=>region(.9,1.1,1),'palm_mute',true,'keyboard',{xml:true});
 await command('Keyboard M enables FHM and clears positive PM',baseline,['own-pm'],()=>region(1.9,2.1,1),'fret_hand_mute',true,'keyboard');
 await command('PM checkbox disable leaves imported FHM active',baseline,['own-contradictory'],()=>region(7.9,8.1,1),'palm_mute',false,'button');
 await command('FHM checkbox disable leaves imported PM active',baseline,['own-contradictory'],()=>region(7.9,8.1,1),'fret_hand_mute',false,'button');
 await command('Mixed-selection aggregate enable keeps already-active PM on and clears opposite flags',baseline,['own-fhm','own-pm'],()=>region(.9,2.1,2),'palm_mute',true,'keyboard');
 const selectChild=async()=>{await action('tab');const position=await page.evaluate(()=>{const scroll=document.querySelector('#ws-timeline-scroll'),height=scroll.clientHeight,row=Math.max(26,Math.min(45,(height-174-40)/6));return{x:112+3*Number(document.querySelector('#ws-zoom').value)-scroll.scrollLeft,y:174+(5-3+.5)*row-scroll.scrollTop};});await page.locator('#ws-canvas').click({position});await page.waitForFunction(()=>document.querySelector('#ws-inspector-content h3')?.textContent.startsWith('1 selected'));assert.equal(await page.locator('#ws-note-fret').inputValue(),'10');};
 await command('Partial chord-child FHM button changes only selected child',baseline,['own-child-b'],selectChild,'fret_hand_mute',true,'button');
 // Aggregate disable after two PM enables, rather than toggling each original note.
 await region(.9,2.1,2);await key('p');const enabled=expectedMute(baseline,['own-fhm','own-pm'],'palm_mute',true);assert.deepEqual(await save(),enabled);await key('p');assert.deepEqual(await save(),expectedMute(enabled,['own-fhm','own-pm'],'palm_mute',false));await action('undo');assert.deepEqual(await save(),enabled);await action('undo');assert.deepEqual(await save(),baseline);checks.push('Second aggregate key press disables all selected PM flags; two independent Undo steps restore each exact prior state');
 assert.deepEqual(errors,[]);ok=true;
}catch(error){failure=error.stack;process.exitCode=1;}
finally{
 try{hardware=await page.evaluate(()=>({contexts:window.__muteProof.contexts,capture:window.__muteProof.capture,midi:window.__muteProof.midi}));assert.deepEqual(hardware,{contexts:0,capture:0,midi:0});for(const [name,expected]of Object.entries(sourceHashes))assert.equal(sha(await readFile(join(root,name))),expected,name+' unchanged during proof');}catch(error){ok=false;failure??=error.stack;process.exitCode=1;}
 await browser.close();const report={ok,phase,checks,errors,failure,observations,sourceHashes,nativeXml,hardware,scope:'Actual original UI command behavior on own synthetic JSON/native XML; prerelease command field evidence only. Retains original aggregate-every policy; no current-retail ordering/modal/DSP/physical hardware equivalence.'};const path=join(root,'verification','browser-mute-exclusion-'+phase+'.json');await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok,phase,path,checks,failure,hardware},null,2));
}
