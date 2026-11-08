import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {makeProject,makeNote} from '../src/model.js';
import {faderPosition,faderTopDb} from '../src/mixer-meter.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.OCE_PLAYWRIGHT||'C:/Users/zagat/AppData/Roaming/npm/node_modules/rea-agents/node_modules/playwright-core');
const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio'],executablePath:process.env.OCE_CHROMIUM||'C:/Users/zagat/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'});
const context=await browser.newContext({viewport:{width:1700,height:1050}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let report={ok:false,checks:[],errors};
try{
 await page.goto(process.env.OCE_URL||'http://127.0.0.1:8766');
 const values=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/api/plugins/open_chart_editor/src/audio.js'),{SignalMeters}=await import('/api/plugins/open_chart_editor/src/signal-meters.js');
  const engine=new AudioEngine(),meters=new SignalMeters();await engine.init(false);
  // Keep the actual output silent; measurements tap upstream stereo buses.
  const mute=engine.context.createGain();mute.gain.value=0;engine.getBusOutput('master').disconnect(engine.context.destination);engine.getBusOutput('master').connect(mute);mute.connect(engine.context.destination);
  const buffer=engine.context.createBuffer(2,48000,48000);for(let i=0;i<buffer.length;i++){const wave=Math.sin(2*Math.PI*440*i/48000);buffer.getChannelData(0)[i]=.8*wave;buffer.getChannelData(1)[i]=-.4*wave;}
  const source=engine.context.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(engine.buses.song);
  for(const name of ['song','master'])meters.attach(name,engine.getBusOutput(name),engine.context);
  source.start();await engine.context.resume();const wait=()=>new Promise(resolve=>setTimeout(resolve,200));await wait();const normal={song:meters.read('song'),master:meters.read('master')};
  engine.setMute('song',true);await wait();const muted=meters.read('master');
  engine.setMute('song',false);engine.setGain('song',2);await wait();const loud=meters.read('master');
  meters.attach('song:in',engine.getBusInput('song'),engine.context);engine.setGain('song',.5);await wait();const split={pre:meters.read('song:in'),post:meters.read('song')};
  // A mono source (like the click and guide oscillators) reads the same after fader and pan whether heard or muted; only the output goes silent.
  const osc=engine.context.createOscillator(),half=engine.context.createGain();half.gain.value=.5;osc.connect(half);half.connect(engine.buses.metronome);engine.setEnabled('metronome',true);engine.setGain('metronome',1);meters.attach('metronome',engine.getBusLevel('metronome'),engine.context);meters.attach('metronome:out',engine.getBusOutput('metronome'),engine.context);osc.start();await wait();const monoHeard=meters.read('metronome');engine.setMute('metronome',true);await wait();const mono={heard:monoHeard,muted:meters.read('metronome'),mutedOut:meters.read('metronome:out')};osc.stop();
  const tap=meters.channels.get('song');meters.attach('song',engine.getBusOutput('song'),engine.context);const stableTap=tap===meters.channels.get('song');
  source.stop();await wait();const stopped=meters.read('song');meters.dispose();const released=meters.channels.size===0;mute.disconnect();await engine.dispose();
  return {normal,muted,loud,split,mono,stopped,stableTap,released};
 });
 const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.02,`${actual} versus ${expected}`);
 close(values.normal.song.left.peak,.8);close(values.normal.song.right.peak,.4);close(values.normal.master.left.peak,.64);close(values.normal.master.right.peak,.32);close(values.normal.song.left.rms,.8/Math.sqrt(2));close(values.normal.song.right.rms,.4/Math.sqrt(2));report.checks.push('Actual stereo analysers retain phase-opposed left/right signals and measure post-fader levels without audible output');
 assert.ok(values.muted.left.peak<.00001&&values.muted.right.peak<.00001);assert.ok(values.loud.left.peak>1.2&&values.loud.clipped);assert.ok(values.loud.left.peakDb>0);assert.ok(values.stopped.left.peak<.00001);report.checks.push('Mute, signal stop, positive dBFS overload and clipping hold follow the real audio graph');
 close(values.split.pre.left.peak,.8);close(values.split.post.left.peak,.4);report.checks.push('The input tap sits before the fader: song at 50% reads 6 dB lower after the fader than before it');
 close(values.mono.heard.left.peak,values.mono.heard.right.peak);close(values.mono.muted.left.peak,values.mono.heard.left.peak);close(values.mono.muted.right.peak,values.mono.heard.right.peak);assert.ok(values.mono.heard.left.peak>.3&&values.mono.mutedOut.left.peak<.00001);report.checks.push('A mono bus reads the same level, on both sides, whether heard or muted; muting silences only its output');
 assert.ok(values.stableTap&&values.released);report.checks.push('Repeated attachment reuses taps and disposal releases every analyser branch');
 const p=makeProject();p.title='Original stereo meter UI study';p.duration=8;p.beats=p.beats.slice(0,17);p.arrangements[0].notes=[makeNote(p.arrangements[0],0,0,3,6)];await page.locator('#ws-open-file').setInputFiles({name:'own-meters.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.waitForFunction(()=>document.querySelector('#ws-title').textContent.includes('Original stereo meter UI study'));
 const wav=Buffer.alloc(44+48000*8*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(48000*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<48000*8;i++){const wave=Math.sin(2*Math.PI*440*i/48000);wav.writeInt16LE(Math.round(.8*32767*wave),44+i*4);wav.writeInt16LE(Math.round(-.4*32767*wave),46+i*4);}
 await page.locator('#ws-audio-file').setInputFiles({name:'own-stereo.wav',mimeType:'audio/wav',buffer:wav});await page.waitForFunction(()=>document.querySelector('#ws-status').textContent.includes('Audio ready'));
 await page.locator('[data-action="mixer"]').first().evaluate(el=>el.click());await page.waitForSelector('[data-signal-meter="song"]');await page.waitForTimeout(120);await page.locator('#ws-play').click();await page.waitForFunction(()=>document.querySelector('[data-signal-meter="song"][data-signal-channel="0"]').getAttribute('aria-valuenow')>-10&&document.querySelector('[data-signal-meter="guide"][data-signal-channel="0"]').getAttribute('aria-valuenow')>-60);
 await page.locator('[data-bus="song"]').fill(String(Math.round(faderPosition(.5,faderTopDb('song'))*1000)));await page.waitForTimeout(900);const ui=await page.locator('[data-signal-meter="song"][data-signal-channel="0"]').getAttribute('aria-valuetext');assert.match(ui,/dBFS/);const pair=await page.locator('[data-signal-meter="song"]').evaluateAll(nodes=>nodes.map(node=>Number(node.getAttribute('aria-valuenow'))));assert.ok(Math.abs(pair[0]-pair[1]-6.0206)<.15,JSON.stringify({pair,ui}));
 await page.locator('[data-mixer-mute="song"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('[data-signal-meter="song"]')].every(node=>node.closest('.muted')));await page.locator('#ws-play').click();report.checks.push('Actual mixer UI displays independent stereo dBFS, follows mute, and retains guide metering after tone-effect routing');
 await page.locator('#ws-app').evaluate(el=>el.remove());await page.waitForTimeout(160);report.checks.push('Editor unmount tears down mixer polling and audio without page errors');
 assert.deepEqual(errors,[]);report={...report,ok:true,measurements:values};
}finally{await mkdir(new URL('../verification/',import.meta.url),{recursive:true});await writeFile(new URL('../verification/browser-signal-meters.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
