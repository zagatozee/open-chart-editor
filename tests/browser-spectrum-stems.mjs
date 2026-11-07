import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {makeProject} from '../src/model.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell.exe'}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
let report;

const rate=48000;
function tone(frequency,seconds=4){
 const buffer=Buffer.alloc(44+rate*seconds*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(rate*seconds*2,40);
 for(let i=0;i<rate*seconds;i++)buffer.writeInt16LE(Math.round(14000*Math.sin(2*Math.PI*frequency*i/rate)),44+i*2);
 return buffer;
}
async function open(project){
 await page.locator('#ws-open-file').setInputFiles({name:'stems-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});if(await page.locator('#ws-dialog[open]').count())await page.locator('#ws-dialog-submit').click();await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),project.title);
}
const analyzed=()=>page.waitForFunction(()=>document.querySelector('#ws-spectrum-status').textContent.includes('Analyzed'),null,{timeout:60000});
const energy=pitch=>page.locator('#ws-spectrum-canvas').evaluate((element,pitch)=>{const context=element.getContext('2d'),scale=element.width/element.clientWidth,x=Math.round((52+1*50)*scale),y=Math.round((232+(108-pitch)*4+2)*scale),[r,g,b]=context.getImageData(x,y,1,1).data;return r+g+b;},pitch);
async function shows(lit,dark,message){
 assert.ok(await energy(lit)>100,`${message}: MIDI ${lit} should show energy, got ${await energy(lit)}`);
 assert.ok(await energy(dark)<100,`${message}: MIDI ${dark} should stay dark, got ${await energy(dark)}`);
}

try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const project=makeProject();project.title='Spectrum stems browser test';project.duration=4;project.beats=project.beats.filter(beat=>beat.time<=4);project.arrangements[0].notes=[];
 project._pack={manifest:{stems:[{id:'full',file:'stems/full.wav',default:true},{id:'bass',file:'stems/bass.wav',name:'Bass DI',description:'Direct input'},{id:'lead',file:'stems/lead.wav'},{id:'broken',file:'stems/broken.ogg'},{id:'gone',file:'stems/gone.ogg'}]},
  entries:{'stems/full.wav':tone(440).toString('base64'),'stems/bass.wav':tone(110).toString('base64'),'stems/lead.wav':tone(880).toString('base64'),'stems/broken.ogg':Buffer.from('not audio').toString('base64')}};
 await open(project);
 await page.locator('#ws-audio-file').setInputFiles({name:'backing.wav',mimeType:'audio/wav',buffer:tone(440)});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready'),null,{timeout:30000});
 await page.locator('#ws-spectrum-button').click();await analyzed();
 const stem=page.locator('[data-spectrum-stem]');
 assert.deepEqual(await stem.locator('option').allTextContents(),['Backing track','Bass DI','lead','broken','gone'],'Every stem but full is offered, by name then id');
 assert.equal(await stem.locator('option[value="bass"]').getAttribute('title'),'Direct input');
 await shows(69,45,'Backing track');

 const scroll=page.locator('#ws-spectrum-scroll'),zoom=value=>page.locator('[data-spectrum-zoom]').evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await zoom(400);await scroll.evaluate(element=>{element.scrollLeft=200;});assert.equal(await scroll.evaluate(element=>element.scrollLeft),200,'The zoomed view should scroll');
 await stem.selectOption('bass');await analyzed();
 assert.equal(await scroll.evaluate(element=>element.scrollLeft),200,'Switching keeps the position');assert.equal(await page.locator('[data-spectrum-zoom]').inputValue(),'400','Switching keeps the zoom');
 await zoom(50);await scroll.evaluate(element=>{element.scrollLeft=0;});
 const height=value=>page.locator('[data-spectrum-semitone-height]').evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));},value);
 await height(22);await scroll.evaluate(element=>{element.scrollTop=600;});assert.equal(await scroll.evaluate(element=>element.scrollTop),600,'The tall view should scroll');
 await stem.selectOption('');await analyzed();assert.equal(await scroll.evaluate(element=>element.scrollTop),600,'Switching keeps the vertical position');
 await height(4);await scroll.evaluate(element=>{element.scrollTop=0;});await stem.selectOption('bass');await analyzed();
 await page.waitForTimeout(50);await shows(45,69,'Bass stem');
 await stem.selectOption('lead');await analyzed();await shows(81,45,'Lead stem');

 // Analyses are kept: going back shows the stem at once, with no worker run.
 await page.evaluate(()=>{window.__oceWorkers=0;const Original=window.Worker;window.Worker=class extends Original{constructor(...args){super(...args);window.__oceWorkers++;}};});
 await stem.selectOption('bass');assert.match(await page.locator('#ws-spectrum-status').textContent(),/Analyzed/);await shows(45,81,'Kept bass analysis');
 await stem.selectOption('');assert.match(await page.locator('#ws-spectrum-status').textContent(),/Analyzed/);await shows(69,45,'Kept backing analysis');
 assert.equal(await page.evaluate(()=>window.__oceWorkers),0,'A kept analysis needs no new worker');

 // A failed stem returns to the backing track, which is analyzed again if nothing is kept for it.
 const failed=async id=>{await page.waitForFunction(id=>document.querySelector(`[data-spectrum-stem] option[value="${id}"]`).disabled,id,{timeout:30000});assert.match(await page.locator('#ws-status').textContent(),new RegExp(`The ${id} stem can't be analyzed`));assert.equal(await stem.inputValue(),'','A stem that fails returns to the backing track');assert.match(await stem.locator(`option[value="${id}"]`).textContent(),/unavailable/);};
 await stem.selectOption('broken');await failed('broken');await analyzed();await shows(69,45,'Back on the kept backing analysis');
 await page.locator('[data-spectrum-suppress-echo]').click();await stem.selectOption('gone');await failed('gone');await analyzed();await shows(69,45,'Backing track analyzed again');

 // Changing either analysis setting drops every kept analysis.
 for(const setting of ['[data-spectrum-suppress-echo]','[data-spectrum-bass-harmonics]']){
  await stem.selectOption('');await analyzed();await stem.selectOption('bass');await analyzed();await stem.selectOption('');await analyzed();
  await page.evaluate(()=>{window.__oceWorkers=0;});await page.locator(setting).click();assert.doesNotMatch(await page.locator('#ws-spectrum-status').textContent(),/Analyzed/);
  await stem.selectOption('bass');await analyzed();assert.equal(await page.evaluate(()=>window.__oceWorkers),1,`${setting} should make a kept analysis run again`);
 }

 // These hold one step of the analysis until the test has done what it needs to do meanwhile.
 const holdDecode=()=>page.evaluate(()=>{const decode=OfflineAudioContext.prototype.decodeAudioData;window.__oceHeld=false;OfflineAudioContext.prototype.decodeAudioData=async function(bytes){OfflineAudioContext.prototype.decodeAudioData=decode;await new Promise(resolve=>{window.__oceHeld=true;window.__oceResume=resolve;});return decode.call(this,bytes);};});
 const holdPost=()=>page.evaluate(()=>{const post=Worker.prototype.postMessage;window.__oceHeld=false;Worker.prototype.postMessage=function(...args){Worker.prototype.postMessage=post;window.__oceHeld=true;window.__oceResume=()=>post.apply(this,args);};});
 const holdPreparation=()=>page.evaluate(()=>{const original=window.setTimeout;window.__oceHeld=false;window.setTimeout=(callback,delay,...args)=>{if(delay!==0||!new Error().stack.includes('analyzeSpectrumAudio'))return original(callback,delay,...args);window.setTimeout=original;window.__oceHeld=true;window.__oceResume=callback;return 0;};});
 const held=()=>page.waitForFunction(()=>window.__oceHeld);
 const resume=()=>page.evaluate(()=>window.__oceResume());

 // A result that was still running when a setting changed may show once, but is not kept.
 await holdPost();await stem.selectOption('lead');await held();await page.locator('[data-spectrum-bass-harmonics]').click();await resume();await analyzed();
 await stem.selectOption('bass');await analyzed();await page.evaluate(()=>{window.__oceWorkers=0;});await stem.selectOption('lead');await analyzed();assert.equal(await page.evaluate(()=>window.__oceWorkers),1,'An analysis made with old settings is not kept');

 // Quickly switching away cancels the running analysis.
 await stem.selectOption('');await stem.selectOption('lead');await stem.selectOption('bass');await analyzed();await shows(45,81,'After a quick switch');

 // So does switching to a kept analysis while a decode is running: the decode must not take over the view.
 await page.locator('[data-spectrum-suppress-echo]').click();await stem.selectOption('lead');await analyzed();await holdDecode();await stem.selectOption('bass');await held();await stem.selectOption('lead');await analyzed();await resume();await page.waitForTimeout(300);
 assert.match(await page.locator('#ws-spectrum-status').textContent(),/Analyzed/);assert.equal(await stem.inputValue(),'lead');await shows(81,45,'A cancelled decode leaves the view alone');

 // New backing audio drops the kept analyses.
 await page.locator('#ws-audio-file').setInputFiles({name:'other.wav',mimeType:'audio/wav',buffer:tone(330)});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready'),null,{timeout:30000});
 await page.evaluate(()=>{window.__oceWorkers=0;});await stem.selectOption('bass');await analyzed();assert.equal(await page.evaluate(()=>window.__oceWorkers),1,'New backing audio should drop kept analyses');

 // Another project: a decode still running from this one must neither stick the view nor mark the new project's stem.
 // With no full stem the first one loads as backing, and here it can't be decoded, so this project has no backing audio.
 const other=makeProject();other.title='Second stems browser test';other.duration=4;other.beats=other.beats.filter(beat=>beat.time<=4);other.arrangements[0].notes=[];
 other._pack={manifest:{stems:[{id:'bad',file:'stems/bad.ogg'},{id:'bass',file:'stems/b.wav'},{id:'broken',file:'stems/ok.wav'},{id:'long',file:'stems/long.wav'}]},entries:{'stems/bad.ogg':Buffer.from('not audio').toString('base64'),'stems/b.wav':tone(220).toString('base64'),'stems/ok.wav':tone(220).toString('base64'),'stems/long.wav':tone(220,6).toString('base64')}};
 const openOther=async title=>{other.title=title;await open(other);await page.waitForFunction(()=>/failed|could not/i.test(document.querySelector('#ws-status').textContent),null,{timeout:30000});};
 const notStuck=async message=>{const status=page.locator('#ws-spectrum-status');await page.waitForFunction(()=>!/Decoding|Preparing|Analyzing/.test(document.querySelector('#ws-spectrum-status').textContent),null,{timeout:10000}).catch(()=>{});assert.match(await status.textContent(),/Import backing audio/,message);assert.equal(await page.locator('[data-action="spectrum-analyze"]').isDisabled(),true,`${message}: no backing and no stem, so nothing to analyze`);};
 await holdDecode();await stem.evaluate(element=>{element.querySelector('option[value="broken"]').disabled=false;element.value='broken';element.dispatchEvent(new Event('change',{bubbles:true}));});await held();
 await openOther('Second stems browser test');assert.match(await page.locator('#ws-spectrum-status').textContent(),/Decoding/,'The decode should still be running');await resume();
 assert.equal(await stem.inputValue(),'','Another project starts on its backing track');await notStuck('After a decode from the old project');
 assert.equal(await stem.locator('option[value="broken"]').evaluate(option=>option.disabled),false,"An old project's failure must not mark this project's stem");
 assert.doesNotMatch(await page.locator('#ws-status').textContent(),/can't be analyzed/);

 // The same during preparation, after its last chunk: this stem is short enough to be one chunk.
 await holdPreparation();await stem.selectOption('bass');await held();await openOther('Third stems browser test');assert.match(await page.locator('#ws-spectrum-status').textContent(),/Preparing/,'Preparation should still be running');await resume();await notStuck('After preparing a stem from the old project');

 // A stem works with no backing track, and asking for the missing backing track is not an error.
 await page.evaluate(()=>{window.__oceWorkers=0;});await stem.selectOption('bass');await analyzed();await shows(57,45,'Stem without backing audio');assert.equal(await page.evaluate(()=>window.__oceWorkers),1,"Another project's kept analysis must not be reused");
 assert.equal(await page.locator('[data-action="spectrum-analyze"]').isDisabled(),false);

 // Coming back to the view analyzes the selected stem again, even with no backing track.
 await page.locator('[data-spectrum-bass-harmonics]').click();await page.locator('#ws-tab-button').click();await page.locator('#ws-spectrum-button').click();await analyzed();await shows(57,45,'Analyzed on coming back');
 await page.locator('#ws-status').evaluate(element=>{element.textContent='';});await stem.selectOption('');
 assert.match(await page.locator('#ws-spectrum-status').textContent(),/Import backing audio/);assert.doesNotMatch(await page.locator('#ws-status').textContent(),/Import backing audio/);

 // The same during preparation, between chunks: this stem is long enough to be two.
 await holdPreparation();await stem.selectOption('long');await held();
 const plain=makeProject();plain.title='No stems browser test';await open(plain);assert.match(await page.locator('#ws-spectrum-status').textContent(),/Preparing/,'Preparation should still be running');await resume();await notStuck('After preparing a long stem from the old project');
 assert.equal(await page.locator('[data-spectrum-stem]').count(),0,'A project without stems shows no selector');
 assert.deepEqual(errors,[]);report={ok:true};
}catch(error){report={ok:false,error:error.stack,status:await page.locator('#ws-spectrum-status').textContent().catch(()=>null),appStatus:await page.locator('#ws-status').textContent().catch(()=>null),errors};process.exitCode=1;}finally{console.log(JSON.stringify(report,null,2));await browser.close();}
