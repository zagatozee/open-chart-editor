// Actual main UI import handlers with held native File.text; no test-owned bridge.
import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote,applyGrid} from '../src/model.js';
import {createTone,importTone,registerGearCatalog} from '../src/tone-rack.js';
if(process.env.OCE_IMPORT_RACES_RELEASE!=='1')throw Error('Parent release required before real import-race browser proof');
registerGearCatalog(JSON.parse(await readFile(new URL('../assets/tone-rack-data.json',import.meta.url),'utf8')).gears);
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core'),browser=await chromium.launch({headless:true,executablePath:'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio']}),context=await browser.newContext({viewport:{width:1700,height:1050}});
await context.addInitScript(()=>{
 const p=window.__fileRace={pending:[],saves:[],capture:0,midi:0},nativeText=File.prototype.text;
 File.prototype.text=function(){if(!this.name.startsWith('hold-'))return nativeText.call(this);const file=this;return new Promise((resolve,reject)=>p.pending.push({name:file.name,done:false,release(){nativeText.call(file).then(value=>{this.done=true;resolve(value);},error=>{this.done=true;reject(error);});}}));};
 p.release=name=>{const row=p.pending.find(row=>row.name===name&&!row.done);if(!row)throw Error('Held native file not found: '+name);row.release();};
 window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async blob=>p.saves.push(await blob.text()),close:async()=>{}})});
 Object.defineProperty(navigator,'requestMIDIAccess',{value:async()=>{p.midi++;throw Error('Hardware MIDI forbidden');},configurable:true});if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{p.capture++;throw Error('Hardware capture forbidden');},configurable:true});const C=window.AudioContext;if(!('sinkId'in C.prototype))throw Error('Strict silent sink unavailable');window.AudioContext=class extends C{constructor(options={}){super({...options,sinkId:{type:'none'}});}};
});
const page=await context.newPage(),checks=[],errors=[],heldCharts=new Map(),chartResponses=[];page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));let report;
await page.route('**/api/plugins/open_chart_editor/load',async route=>{
 const filename=route.request().postDataBuffer()?.toString('utf8').match(/filename="([^"]+)"/)?.[1];
 if(!filename?.startsWith('chart-hold-'))return route.continue();
 const response=await route.fetch();const row={filename,status:response.status(),ready:true,released:false,response,async release(){await route.fulfill({response});this.released=true;}};heldCharts.set(filename,row);chartResponses.push({filename,status:row.status});
});
async function action(name){await page.locator(`[data-action="${name}"]`).first().evaluate(el=>el.click());}
async function submit(){const closed=page.locator('#ws-dialog').evaluate(el=>new Promise(resolve=>el.addEventListener('close',resolve,{once:true})));await page.locator('#ws-dialog-submit').click();await closed;}
async function snapshot(){const count=await page.evaluate(()=>window.__fileRace.saves.length);await action('saveas');await page.locator('#ws-export-format').selectOption('json');await submit();await page.waitForFunction(count=>window.__fileRace.saves.length>count,count);return page.evaluate(()=>JSON.parse(window.__fileRace.saves.at(-1)));}
function fixture(title){const p=makeProject();p.title=title;p.duration=30;p.beats=p.beats.slice(0,61);const a=p.arrangements[0];a.notes=[{...makeNote(a,1,0,3,.5),opaque:{original:'visible note'}}];a.activeDifficulty=0;a.difficulties=[{difficulty:0,notes:structuredClone(a.notes),chords:[],anchors:[],handshapes:[]},{difficulty:3,notes:[{...makeNote(a,12,2,8,.5),opaque:{original:'hidden DD'}}],chords:[],anchors:[],handshapes:[]}];const bass=makeArrangement('bass',5);bass.notes=[makeNote(bass,3,4,7,1)];bass.opaque={original:'other arrangement'};p.arrangements.push(bass);p.vocals=[{id:'own-race-vocal',time:2,length:.5,text:'Own words',opaque:{original:'vocal'}}];return p;}
async function load(title){const p=fixture(title);await page.locator('#ws-open-file').setInputFiles({name:'own-race-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});if(await page.locator('#ws-dialog-title').textContent().catch(()=>null)==='Replace unsaved project?')await submit();await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),title);return snapshot();}
async function startFile(kind,name,value){await page.locator('#ws-'+kind+'-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});if(name.startsWith('hold-')){await page.waitForFunction(name=>window.__fileRace.pending.some(row=>row.name===name&&!row.done),name);assert.equal(await page.locator('#ws-'+kind+'-file').inputValue(),'','Captured file input clears before read completes');}}
async function release(name){await page.evaluate(name=>window.__fileRace.release(name),name);await page.waitForFunction(name=>window.__fileRace.pending.some(row=>row.name===name&&row.done),name);await page.waitForTimeout(40);}
async function newProject(){await action('new');await page.waitForFunction(()=>document.querySelector('#ws-dialog-title').textContent==='New project');await submit();await page.waitForFunction(()=>!document.querySelector('#ws-title').textContent.includes('Own race'));return snapshot();}
const ownTone=name=>{const tone=createTone(name);tone.opaque={original:'source definition'};return tone;};
const grid=(spacing=.4)=>Array.from({length:61},(_,i)=>({time:i*spacing,measure:i%4===0?i/4+1:-1,numerator:4,denominator:4,own:'imported-'+i}));
function incomingChart(label){const p=fixture('Own source '+label);p.arrangements[0].name='Own incoming selected '+label;p.arrangements[1].name='Own incoming excluded '+label;return p;}
async function startChart(name,source){await page.locator('#ws-import-file').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});if(name.startsWith('chart-hold-')){await page.waitForFunction(()=>true);const deadline=Date.now()+20000;while(!heldCharts.has(name)){if(Date.now()>deadline)throw Error('Real backend response not held: '+name);await page.waitForTimeout(10);}assert.equal(heldCharts.get(name).status,200,'Own original project loads through real backend');}}
async function releaseChart(name){const row=heldCharts.get(name);assert.ok(row?.ready&&!row.released);await row.release();await page.waitForTimeout(60);}
async function noImportModal(){assert.equal(await page.locator('#ws-dialog[open]').count(),0,'Obsolete response must not open an import modal');}
async function acceptSelectedChart(){await page.waitForFunction(()=>document.querySelector('#ws-dialog[open] #ws-dialog-title')?.textContent==='Import arrangements');const choices=page.locator('[data-import-arr]');assert.equal(await choices.count(),2);await choices.nth(1).uncheck();await page.locator('#ws-import-offset').fill('0');await page.locator('#ws-import-align').selectOption('time');const merged=page.waitForResponse(response=>response.url().endsWith('/api/plugins/open_chart_editor/merge')&&response.request().method()==='POST');await submit();const response=await merged;assert.equal(response.status(),200);await page.waitForFunction(()=>/^Imported 1 arrangements/.test(document.querySelector('#ws-status').textContent));}
function checkMergedTarget(merged,baseline,label){assert.equal(merged.arrangements.length,baseline.arrangements.length+1);assert.deepEqual(merged.arrangements.slice(0,baseline.arrangements.length),baseline.arrangements,'Existing target arrangements/hidden DD stay exact');assert.equal(merged.arrangements.at(-1).name,'Own incoming selected '+label);assert.ok(!merged.arrangements.some(a=>a.name==='Own incoming excluded '+label));for(const key of ['title','artist','album','year','duration','beats','audio','vocals'])assert.deepEqual(merged[key],baseline[key],key+' backing project stays exact');}
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 // Normal success is one real authoring transaction, including complete Undo.
 {
  const baseline=await load('Own race normal tone');await action('tones');const tone=ownTone('Own normal imported');await startFile('tone','normal-tone.json',tone);await page.waitForFunction(name=>[...document.querySelectorAll('#ws-tone-library option')].some(el=>el.value===name),tone.name);const expected=structuredClone(baseline);expected.arrangements[0].tones.definitions[tone.name]=importTone(tone);assert.deepEqual(await snapshot(),expected);await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Normal tone File.text import adds exactly one native definition; one Undo restores complete JSON/hidden DD');
 }
 {
  const baseline=await load('Own race tone arrangement');await startFile('tone','hold-tone-arr.json',ownTone('Own stale arrangement tone'));await page.locator('#ws-arrangement').selectOption(baseline.arrangements[1].id);await release('hold-tone-arr.json');assert.deepEqual(await snapshot(),baseline);checks.push('Tone pending File.text is discarded after arrangement switch, without touching either arrangement');
 }
 {
  await load('Own race tone new');await startFile('tone','hold-tone-new.json',ownTone('Own stale new tone'));const blank=await newProject();await release('hold-tone-new.json');assert.deepEqual(await snapshot(),blank);checks.push('Tone pending File.text cannot mutate a replacement New project');
 }
 {
  const baseline=await load('Own race tone unmount');await startFile('tone','hold-tone-unmount.json',ownTone('Own stale unmount tone'));const html=await page.locator('#ws-app').evaluate(el=>el.outerHTML.replace(' data-mounted="true"',''));await page.locator('#ws-app').evaluate(el=>el.remove());await page.waitForTimeout(80);await release('hold-tone-unmount.json');await page.evaluate(html=>document.body.insertAdjacentHTML('beforeend',html),html);await page.waitForSelector('#ws-app[data-mounted="true"]');assert.deepEqual(await snapshot(),baseline);checks.push('Unmounted tone continuation cannot mutate retained History recovered by actual DOM remount');
 }
 {
  const baseline=await load('Own race latest tone');const old=ownTone('Own older tone'),latest=ownTone('Own latest tone');await startFile('tone','hold-tone-older.json',old);await startFile('tone','hold-tone-latest.json',latest);await release('hold-tone-latest.json');await release('hold-tone-older.json');const expected=structuredClone(baseline);expected.arrangements[0].tones.definitions[latest.name]=importTone(latest);assert.deepEqual(await snapshot(),expected);await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Latest tone request wins out-of-order reads; stale older request adds no extra transaction');
 }
 {
  const baseline=await load('Own race normal tempo');await action('tempo');await page.locator('#ws-move-notes').uncheck();const beats=grid();await startFile('tempo','normal-beats.json',{beats});const expected=structuredClone(baseline);applyGrid(expected,beats,false);await page.waitForTimeout(60);assert.deepEqual(await snapshot(),expected);await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Normal beat-map JSON import changes only intended grid; one Undo preserves complete source/hidden DD');
 }
 {
  await load('Own race tempo edit');await action('tempo');await page.locator('#ws-move-notes').uncheck();await startFile('tempo','hold-tempo-edit.json',{beats:grid()});await page.locator('[data-inspector="settings"]').click();await page.locator('#ws-bpm').fill('143');await page.locator('#ws-bpm').press('Tab');const edited=await snapshot();await release('hold-tempo-edit.json');assert.deepEqual(await snapshot(),edited);checks.push('Tempo pending File.text cannot overwrite an intervening beat-map/BPM edit');
 }
 {
  await load('Own race tempo new');await action('tempo');await startFile('tempo','hold-tempo-new.json',{beats:grid()});const blank=await newProject();await release('hold-tempo-new.json');assert.deepEqual(await snapshot(),blank);checks.push('Tempo pending File.text cannot mutate a replacement New project');
 }
 {
  const baseline=await load('Own race latest tempo');await action('tempo');await page.locator('#ws-move-notes').uncheck();const latest=grid(.375);await startFile('tempo','hold-tempo-older.json',{beats:grid(.45)});await startFile('tempo','hold-tempo-latest.json',{beats:latest});await release('hold-tempo-latest.json');await release('hold-tempo-older.json');const expected=structuredClone(baseline);applyGrid(expected,latest,false);assert.deepEqual(await snapshot(),expected);await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Latest tempo request wins out-of-order reads; one Undo restores original grid and opaque/chart data');
 }
 {
  const baseline=await load('Own race captured tempo preference');await action('tempo');await page.locator('#ws-move-notes').uncheck();const beats=grid(.425);await startFile('tempo','hold-tempo-preference.json',{beats});await page.locator('#ws-move-notes').check();await release('hold-tempo-preference.json');const expected=structuredClone(baseline);applyGrid(expected,beats,false);assert.deepEqual(await snapshot(),expected);await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Tempo import uses the Move-notes preference captured at request start; later UI toggle cannot silently retime notes');
 }
 // Arrangement imports traverse the real /load and /merge adapters. Only the
 // completed /load response is held; no synthetic payload/handler replacement.
 {
  const baseline=await load('Own race normal arrangement import');await startChart('chart-normal.json',incomingChart('normal'));await acceptSelectedChart();checkMergedTarget(await snapshot(),baseline,'normal');await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Real /load and /merge import only the selected arrangement, preserve backing/hidden DD, and one Undo restores exact complete project');
 }
 {
  await load('Own race chart after New');await startChart('chart-hold-new.json',incomingChart('stale-new'));const blank=await newProject();await releaseChart('chart-hold-new.json');await noImportModal();assert.deepEqual(await snapshot(),blank);checks.push('Real held /load response after New is discarded without obsolete arrangement dialog or replacement-project mutation');
 }
 {
  await load('Own race chart after edit');await startChart('chart-hold-edit.json',incomingChart('stale-edit'));await page.locator('[data-inspector="settings"]').click();await page.locator('#ws-bpm').fill('139');await page.locator('#ws-bpm').press('Tab');const edited=await snapshot();await releaseChart('chart-hold-edit.json');await noImportModal();assert.deepEqual(await snapshot(),edited);checks.push('Real held /load response after an authoring edit cannot open an obsolete modal or overwrite the edited project');
 }
 {
  const baseline=await load('Own race latest arrangement import');await startChart('chart-hold-older.json',incomingChart('older'));await startChart('chart-hold-latest.json',incomingChart('latest'));await releaseChart('chart-hold-latest.json');await acceptSelectedChart();await releaseChart('chart-hold-older.json');await noImportModal();const merged=await snapshot();checkMergedTarget(merged,baseline,'latest');assert.ok(!merged.arrangements.some(a=>a.name.includes('older')));await action('undo');assert.deepEqual(await snapshot(),baseline);checks.push('Latest real arrangement /load wins out of order; older completion opens no second modal and adds no transaction');
 }
 assert.equal(await page.evaluate(()=>window.__fileRace.capture),0);assert.equal(await page.evaluate(()=>window.__fileRace.midi),0);assert.deepEqual(errors,[]);report={ok:true,checks,errors,chartResponses,scope:'Actual main input change handlers, native File.text promises held; actual backend /load responses route.fetch then delayed unchanged fulfill; real /merge, UI transactions/Undo/JSON; original data, memory save picker, no hardware'};
}catch(error){report={ok:false,error:error.stack,checks,errors,chartResponses,status:await page.locator('#ws-status').textContent().catch(()=>null),pending:await page.evaluate(()=>window.__fileRace?.pending.map(row=>({name:row.name,done:row.done}))).catch(()=>null)};process.exitCode=1;}finally{await writeFile(new URL('../verification/browser-import-file-races.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
