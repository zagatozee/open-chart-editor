// Inside a running FeedBack, a keys part's guide plays through FeedBack's own synth.
// Needs a FeedBack build with chartPlayback (core main after 2026-10-20) with OCE installed as a
// plugin and its floor soundfont: OCE_FEEDBACK_URL=http://127.0.0.1:8000. Skips without it.
// Audio starts are recorded per AudioContext: OCE's guide is oscillators on OCE's context, the
// synth's notes are buffer sources on FeedBack's. The fixture has no backing audio, so no grains.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const url=process.env.OCE_FEEDBACK_URL;
if(!url){console.log('SKIP: set OCE_FEEDBACK_URL to a FeedBack server with OCE installed');process.exit(0);}
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1600,height:1000}});
await context.addInitScript(()=>{
 const ids=new WeakMap();let next=0;const id=c=>{if(!ids.has(c))ids.set(c,++next);return ids.get(c);};
 window.__starts=[];
 for(const [Node,kind] of [[AudioBufferSourceNode,'buffer'],[OscillatorNode,'osc']]){const start=Node.prototype.start;Node.prototype.start=function(...args){window.__starts.push({kind,context:id(this.context),when:args[0]??this.context.currentTime,length:this.buffer?.length});return start.apply(this,args);};}
});
const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
const beats=Array.from({length:17},(_,i)=>({time:i*.5,measure:i%4===0?i/4+1:-1}));
const project={version:1,title:'FeedBack sound fixture',artist:'Local test author',duration:8,beats,sections:[],arrangements:[{id:'piano',name:'Piano',type:'keys',notes:Array.from({length:12},(_,i)=>({id:`k${i}`,time:.25+i*.5,pitch:60+i%5,sustain:.3,velocity:100})),chords:[],anchors:[],handshapes:[],phrases:[{id:'a',name:'A',time:0}],toneChanges:[]}]};
const starts=()=>page.evaluate(()=>window.__starts.splice(0));
// One note can start several sample zones at one instant: group them by time.
const onsets=list=>[...new Set(list.map(s=>s.when.toFixed(2)))].map(Number).sort((a,b)=>a-b);
async function action(name){
 const locator=page.locator(`[data-action="${name}"]:visible`);
 if(!await locator.count())await page.locator(`[data-action="${name}"]`).first().evaluate(el=>{const details=el.closest('details');if(details)details.open=true;});
 await page.locator(`[data-action="${name}"]:visible`).first().click();
}
async function play(seconds){
 await page.locator('.ws-transport [data-action="start"]').click();await starts();
 await page.locator('#ws-play').click();await page.waitForTimeout(seconds*1000);await page.locator('#ws-play').click();await page.waitForTimeout(200);
 return starts();
}
const results=[];
async function run(name,fn){try{results.push({name,ok:true,detail:await fn()});console.log('PASS',name);}catch(error){results.push({name,ok:false,error:error.message});console.log('FAIL',name,error.message);}}
try{
 await page.goto(url);await page.waitForFunction(()=>window.feedBack?.chartPlayback?.version===1&&typeof window.showScreen==='function');
 await page.evaluate(()=>window.feedBack.synth.ready());
 // A fresh FeedBack profile opens its onboarding over everything.
 await page.evaluate(()=>document.getElementById('v3-onboarding')?.remove());
 await page.evaluate(()=>window.showScreen('plugin-open_chart_editor'));await page.waitForSelector('#ws-app[data-mounted="true"]');
 await page.locator('#ws-open-file').setInputFiles({name:'feedback-sound.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
 if(await page.locator('#ws-dialog[open]').count())await page.locator('#ws-dialog-submit').click();
 await page.waitForFunction(title=>document.querySelector('#ws-title')?.textContent.includes(title),project.title);
 let oceContext,pianoSamples;
 await run('The switch shows inside FeedBack, on by default',async()=>{
  await page.locator('[data-inspector="settings"]').click();assert.equal(await page.locator('#ws-feedback-sound').isChecked(),true);
 });
 await run('The first Play voices the keys guide through FeedBack, in time',async()=>{
  const list=await play(3.2),synth=list.filter(s=>s.kind==='buffer'),guide=list.filter(s=>s.kind==='osc');
  assert.equal(guide.length,0,'OCE voiced guide notes too');assert.ok(synth.length,'FeedBack played nothing');
  const times=onsets(synth),gaps=times.slice(1).map((t,i)=>t-times[i]);pianoSamples=new Set(synth.map(s=>s.length));
  assert.ok(times.length>=5,`only ${times.length} onsets`);assert.ok(gaps.every(g=>Math.abs(g-.5)<.03),`gaps ${gaps}`);
  return {onsets:times.length,gaps:gaps.map(g=>+g.toFixed(3))};
 });
 await run('At half speed the notes are twice as far apart',async()=>{
  await page.locator('#ws-speed').fill('50');
  const times=onsets((await play(3.5)).filter(s=>s.kind==='buffer')),gaps=times.slice(1).map((t,i)=>t-times[i]);
  await page.locator('#ws-speed').fill('100');
  assert.ok(times.length>=3,`only ${times.length} onsets`);assert.ok(gaps.every(g=>Math.abs(g-1)<.04),`gaps ${gaps}`);
  return {gaps:gaps.map(g=>+g.toFixed(3))};
 });
 await run('Switched off, OCE voices the guide again',async()=>{
  await page.locator('#ws-feedback-sound').uncheck();
  const list=await play(1.6);await page.locator('#ws-feedback-sound').check();
  assert.equal(list.filter(s=>s.kind==='buffer').length,0);const guide=list.filter(s=>s.kind==='osc');assert.ok(guide.length>=2);oceContext=guide[0].context;
  return {oceVoices:guide.length};
 });
 await run('Muting the guide bus silences FeedBack too',async()=>{
  if(!await page.locator('[data-mixer-mute="guide"]:visible').count())await action('mixer');
  await page.locator('[data-mixer-mute="guide"]').click();const list=await play(1.6);await page.locator('[data-mixer-mute="guide"]').click();
  assert.deepEqual(list.map(s=>s.kind),[]);
 });
 await run('A guide instrument pick plays that GM program',async()=>{
  await page.locator('[data-inspector="settings"]').click();await page.locator('#ws-guide-family').selectOption('organ');
  const list=await play(1.6),synth=list.filter(s=>s.kind==='buffer');assert.ok(synth.length);
  assert.ok(synth.every(s=>s.context!==oceContext));assert.ok(synth.every(s=>!pianoSamples.has(s.length)),'still the piano samples');
 });
 assert.deepEqual(errors,[]);
}finally{
 const ok=results.length===6&&results.every(r=>r.ok)&&!errors.length;console.log(JSON.stringify({ok,results,errors},null,2));await browser.close();if(!ok)process.exitCode=1;
}
