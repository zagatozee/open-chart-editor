import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveInput} from '../src/live-input.js';
function harness(){
 const events=[],tracks=[];let constraints;
 const audio={disposers:new Set(),buses:{live:{}},context:{createMediaStreamSource(){return {connect:()=>events.push('connect'),disconnect:()=>events.push('disconnect')};}},async init(){events.push('init');}};
 const stream=()=>{const track={label:'Original fake guitar input',stopped:false,getSettings:()=>({deviceId:'guitar'}),stop(){this.stopped=true;},addEventListener(name,fn){this.ended=fn;},removeEventListener(){this.ended=null;}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};};
 const mediaDevices={async enumerateDevices(){return [{kind:'audioinput',deviceId:'guitar',label:'Guitar'},{kind:'audiooutput',deviceId:'speaker'}];},async getUserMedia(value){constraints=value;return stream();}};
 const effect={input:{},connect:()=>events.push('effect-connect'),dispose:()=>events.push('effect-dispose')};
 const monitor=new LiveInput({audio,mediaDevices,createEffect:()=>effect});return {audio,monitor,mediaDevices,stream,tracks,events,get constraints(){return constraints;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('live monitor is permission-free until start and selects local unprocessed input',async()=>{
 const h=harness();assert.deepEqual(h.events,[]);assert.deepEqual(await h.monitor.listDevices(),[{id:'guitar',label:'Guitar'}]);assert.equal(h.constraints,undefined);
 await h.monitor.start('guitar');assert.equal(h.monitor.active,true);assert.deepEqual(h.constraints,{audio:{deviceId:{exact:'guitar'},echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:1}},video:false});assert.equal(h.monitor.label,'Original fake guitar input');assert.ok(h.events.includes('effect-connect'));
 h.monitor.stop();assert.equal(h.monitor.active,false);assert.equal(h.tracks[0].stopped,true);assert.ok(h.events.includes('effect-dispose'));
});
test('cancelled permission and newer selections stop stale streams before connecting',async()=>{
 const h=harness(),pending=[];h.mediaDevices.getUserMedia=()=>new Promise(resolve=>pending.push(resolve));
 const first=h.monitor.start();await flush();h.monitor.stop();const second=h.monitor.start('guitar');await flush();const latest=h.stream();pending[1](latest);await second;const old=h.stream();pending[0](old);assert.equal((await first).stale,true);assert.equal(h.tracks[1].stopped,true);assert.equal(h.tracks[0].stopped,false);assert.equal(h.monitor.stream,latest);assert.equal(h.events.filter(e=>e==='connect').length,1);
});
test('input ending and engine disposal release tracks and preview graph',async()=>{
 const h=harness();await h.monitor.start();h.tracks[0].ended();assert.equal(h.monitor.active,false);assert.equal(h.tracks[0].stopped,true);await h.monitor.start();for(const dispose of h.audio.disposers)dispose();assert.equal(h.tracks[1].stopped,true);assert.equal(h.monitor.active,false);h.monitor.dispose();assert.equal(h.audio.disposers.size,0);
});
test('rejected permission and cancelled audio resume never leave input running',async()=>{
 const h=harness();h.mediaDevices.getUserMedia=async()=>{throw Error('Denied');};await assert.rejects(h.monitor.start(),/Denied/);assert.equal(h.monitor.pending,false);assert.equal(h.monitor.active,false);
 let resume;h.audio.init=()=>new Promise(resolve=>{resume=resolve;});const pending=h.monitor.start();h.monitor.stop();resume();assert.equal((await pending).stale,true);assert.equal(h.tracks.length,0);
});

test('tone engine preparation finishes before requesting input or constructing its graph',async()=>{
 const h=harness(),order=[];let complete;
 h.monitor.prepareEffect=context=>{assert.equal(context,h.audio.context);order.push('prepare');return new Promise(resolve=>complete=()=>{order.push('ready');resolve();});};
 const get=h.mediaDevices.getUserMedia;h.mediaDevices.getUserMedia=async value=>{order.push('input');return get(value);};
 const create=h.monitor.createEffect;h.monitor.createEffect=context=>{order.push('effect');return create(context);};
 const pending=h.monitor.start();await Promise.resolve();assert.deepEqual(order,['prepare']);assert.equal(h.constraints,undefined);assert.equal(h.monitor.pending,true);complete();await pending;assert.deepEqual(order,['prepare','ready','effect','input']);h.monitor.dispose();assert.equal(h.tracks[0].stopped,true);
});

test('cancel while the native host is loading aborts it before requesting input',async()=>{
 const h=harness(),order=[];let finish,disposed=0;
 h.monitor.createEffect=(_context,{signal})=>new Promise((resolve,reject)=>{
  order.push('host-start');signal.addEventListener('abort',()=>{order.push('host-abort');reject(new DOMException('cancelled','AbortError'));},{once:true});
  finish=()=>resolve({input:{},connect(){},dispose(){disposed++;}});
 });
 const pending=h.monitor.start('',{engine:'at5-vst3'});await Promise.resolve();await Promise.resolve();h.monitor.stop();finish();assert.equal((await pending).stale,true);assert.deepEqual(order,['host-start','host-abort']);assert.equal(h.constraints,undefined);assert.equal(h.tracks.length,0);assert.equal(disposed,0);
});

test('cancel during effect preparation never acquires input, even when preparation later succeeds or fails',async()=>{
 for(const rejectLate of [false,true]){const h=harness();let complete;h.monitor.prepareEffect=()=>new Promise((resolve,reject)=>complete=()=>rejectLate?reject(Error('Late preparation failure')):resolve());const pending=h.monitor.start();await Promise.resolve();h.monitor.stop();complete();assert.equal((await pending).stale,true);assert.equal(h.constraints,undefined);assert.equal(h.tracks.length,0);assert.equal(h.monitor.pending,false);}
});

test('failed preparation stops cleanly before hardware; a newer prepared request remains authoritative',async()=>{
 const h=harness();h.monitor.prepareEffect=async()=>{throw Error('Own module unavailable');};await assert.rejects(h.monitor.start(),/Own module unavailable/);assert.equal(h.constraints,undefined);assert.equal(h.monitor.active,false);assert.equal(h.monitor.pending,false);
 const pending=[];h.monitor.prepareEffect=()=>new Promise(resolve=>pending.push(resolve));const first=h.monitor.start();await Promise.resolve();const second=h.monitor.start('guitar');await Promise.resolve();assert.equal(pending.length,2);pending[1]();await second;pending[0]();assert.equal((await first).stale,true);assert.equal(h.tracks.length,1);assert.equal(h.monitor.active,true);h.monitor.dispose();assert.equal(h.tracks[0].stopped,true);
});

function terminalAudio(h){
 h.audio.disposeCalls=0;
 h.audio.dispose=async()=>{h.audio.disposeCalls++;for(const dispose of h.audio.disposers)dispose();h.audio.disposers.clear();if(h.audio.context?.close)await h.audio.context.close();h.audio.context=null;};
}
test('terminal disposal before deferred original init closes the late context and never requests input',async()=>{
 const h=harness();terminalAudio(h);h.audio.context=null;let complete,closed=0;
 h.audio.init=()=>new Promise(resolve=>complete=()=>{h.audio.context={async close(){closed++;}};resolve();});
 const pending=h.monitor.start();await h.audio.dispose();assert.equal(h.monitor.disposed,true);assert.equal(h.audio.context,null);complete();assert.equal((await pending).stale,true);assert.equal(closed,1);assert.equal(h.audio.context,null);assert.equal(h.tracks.length,0);assert.equal(h.constraints,undefined);assert.equal(h.audio.disposers.size,0);await assert.rejects(h.monitor.start(),/disposed/);
});
test('ordinary cancellation of deferred init keeps the engine reusable instead of closing it',async()=>{
 const h=harness();terminalAudio(h);const context=h.audio.context;let complete;h.audio.init=()=>new Promise(resolve=>complete=resolve);const pending=h.monitor.start();h.monitor.stop();complete();assert.equal((await pending).stale,true);assert.equal(h.audio.disposeCalls,0);assert.equal(h.audio.context,context);assert.equal(h.monitor.disposed,false);h.audio.init=async()=>{};await h.monitor.start();assert.equal(h.monitor.active,true);h.monitor.stop();
});
test('terminal disposal during effect preparation suppresses late success and failure without capture',async()=>{
 for(const rejectLate of [false,true]){const h=harness();terminalAudio(h);let complete;h.monitor.prepareEffect=()=>new Promise((resolve,reject)=>complete=()=>rejectLate?reject(Error('Late module failure')):resolve());const pending=h.monitor.start();await Promise.resolve();await h.audio.dispose();complete();assert.equal((await pending).stale,true);assert.equal(h.audio.context,null);assert.equal(h.tracks.length,0);assert.equal(h.constraints,undefined);assert.equal(h.monitor.disposed,true);}
});
test('terminal disposal while capture is pending stops the late stream before any graph is attached',async()=>{
 const h=harness();terminalAudio(h);let complete;h.mediaDevices.getUserMedia=()=>new Promise(resolve=>complete=resolve);const pending=h.monitor.start();await flush();await h.audio.dispose();const stream=h.stream();complete(stream);assert.equal((await pending).stale,true);assert.equal(h.tracks[0].stopped,true);assert.equal(h.monitor.stream,null);assert.equal(h.monitor.source,null);assert.equal(h.monitor.effect,null);assert.equal(h.audio.context,null);assert.equal(h.events.includes('connect'),false);
});
test('overlapping stale requests share terminal context cleanup and idempotent disposal',async()=>{
 const h=harness();terminalAudio(h);let closeCount=0,finishClose;h.audio.context.close=()=>{closeCount++;return new Promise(resolve=>finishClose=resolve);};const pending=[];h.audio.init=()=>new Promise(resolve=>pending.push(resolve));const first=h.monitor.start(),second=h.monitor.start();h.monitor.dispose();h.monitor.dispose();pending[0]();pending[1]();await Promise.resolve();await Promise.resolve();assert.equal(closeCount,1);finishClose();assert.equal((await first).stale,true);assert.equal((await second).stale,true);assert.equal(h.audio.context,null);assert.equal(h.audio.disposeCalls,1);assert.equal(h.tracks.length,0);
});
test('stale preparation does not double-close the context while outer engine disposal finishes',async()=>{
 const h=harness();terminalAudio(h);let finishClose,finishPrepare,closeCount=0;h.audio.context.state='running';h.audio.context.close=()=>{closeCount++;h.audio.context.state='closed';return new Promise(resolve=>finishClose=resolve);};h.monitor.prepareEffect=()=>new Promise(resolve=>finishPrepare=resolve);
 const pending=h.monitor.start();await Promise.resolve();const disposing=h.audio.dispose();finishPrepare();assert.equal((await pending).stale,true);assert.equal(closeCount,1);finishClose();await disposing;assert.equal(h.audio.context,null);assert.equal(h.audio.disposeCalls,1);assert.equal(h.constraints,undefined);
});
