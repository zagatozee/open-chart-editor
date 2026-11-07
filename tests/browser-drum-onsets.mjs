import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote,DRUMS} from '../src/model.js';

const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell.exe'}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
let report;

// A synthetic drum kit: short decaying bursts for kick/snare/hats/toms at known times, so detected
// onsets and the pitch-free band lanes can be checked against ground truth, mirroring the synthesis
// in tests/drum-onset-analysis.test.mjs.
const rate=48000,hits=[[.5,'kick',60,1.2,0],[1.2,'snare',200,.4,.5],[1.9,'hats',0,0,.9],[2.6,'toms',260,.9,0]];
function kitWav(){
 const samples=new Float32Array(rate*4);let state=0x1234abcd;const noise=()=>{state=(1664525*state+1013904223)>>>0;return (state/0x80000000)-1;};
 for(const [time,,freq,amp,noiseAmp] of hits){
  const start=Math.round(time*rate),length=Math.round(.12*rate);
  for(let i=0;i<length&&start+i<samples.length;i++){const env=Math.exp(-i/(rate*.02));let value=freq?Math.sin(2*Math.PI*freq*(start+i)/rate)*amp:0;if(noiseAmp)value+=noise()*noiseAmp;samples[start+i]+=env*value;}
 }
 const buffer=Buffer.alloc(44+samples.length*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples.length*2,40);
 for(let i=0;i<samples.length;i++)buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32000),44+i*2);
 return buffer;
}
async function open(project){
 await page.locator('#ws-open-file').setInputFiles({name:'drums-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});if(await page.locator('#ws-dialog[open]').count())await page.locator('#ws-dialog-submit').click();await page.waitForFunction(title=>document.querySelector('#ws-title').textContent.includes(title),project.title);
}
const analyzed=()=>page.waitForFunction(()=>document.querySelector('#ws-spectrum-status').textContent.includes('Analyzed'),null,{timeout:60000});
const lanePixel=(bandIndex,time)=>page.locator('#ws-spectrum-canvas').evaluate((element,[bandIndex,time])=>{const context=element.getContext('2d'),scale=element.width/element.clientWidth,x=Math.round((52+time*50)*scale),y=Math.round((232+bandIndex*42+21)*scale),[r,g,b]=context.getImageData(x,y,1,1).data;return [r,g,b];},[bandIndex,time]);
const brightness=([r,g,b])=>r+g+b;

try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');await page.waitForSelector('#ws-app[data-mounted="true"]');
 const drums=makeArrangement('drums');
 drums.notes=hits.map(([time,band])=>makeNote(drums,time,DRUMS.indexOf({kick:'kick',snare:'snare',hats:'hh_closed',toms:'tom_low'}[band])));
 const project=makeProject();project.title='Drum onsets browser test';project.duration=4;project.beats=project.beats.filter(beat=>beat.time<=4);project.arrangements=[drums];
 project._pack={manifest:{stems:[{id:'full',file:'stems/full.wav',default:true},{id:'drums',file:'stems/drums.wav',name:'Drums'}]},entries:{'stems/full.wav':kitWav().toString('base64'),'stems/drums.wav':kitWav().toString('base64')}};
 await open(project);

 await page.locator('#ws-spectrum-button').click();
 const stem=page.locator('[data-spectrum-stem]');
 await page.waitForFunction(()=>document.querySelector('[data-spectrum-stem]')?.value==='drums',null,{timeout:10000});
 assert.equal(await stem.inputValue(),'drums','A drum arrangement with a "drums" stem should auto-select it, with no backing track present');
 await analyzed();
 assert.match(await page.locator('#ws-spectrum-status').textContent(),/onsets detected/,'Drum analysis status should report onset count, not pitch-window details');

 for(const [bandIndex,[time]] of [[0,hits[0]],[1,hits[1]],[2,hits[2]],[3,hits[3]]]){
  const hit=await lanePixel(bandIndex,time),quiet=await lanePixel(bandIndex,3.5);
  assert.ok(brightness(hit)>brightness(quiet)+20,`Lane ${bandIndex} at its hit time (${JSON.stringify(hit)}) should be brighter than a quiet moment (${JSON.stringify(quiet)})`);
  const [r,g,b]=hit;
  assert.ok(Math.abs(r-0x58)<40&&Math.abs(g-0xc5)<40&&Math.abs(b-0xe8)<40,`Lane ${bandIndex} should show the authored-hit overlay marker colour at its own hit time, got rgb(${r},${g},${b})`);
 }

 // Explicitly picking the backing track instead must stick, not bounce back to the auto-picked stem.
 await stem.selectOption('');await analyzed();
 await page.locator('#ws-tab-button').click();await page.locator('#ws-spectrum-button').click();
 assert.equal(await stem.inputValue(),'','An explicit audio choice survives leaving and returning to the view');

 assert.deepEqual(errors,[]);report={ok:true};
}catch(error){report={ok:false,error:error.stack,status:await page.locator('#ws-spectrum-status').textContent().catch(()=>null),appStatus:await page.locator('#ws-status').textContent().catch(()=>null),errors};process.exitCode=1;}finally{console.log(JSON.stringify(report,null,2));await browser.close();}
