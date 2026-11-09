import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackHost,feedbackGuideNotes,feedbackGuideSound,FeedbackGuide} from '../src/feedback-sound.js';
import {AudioEngine} from '../src/audio.js';

// A stand-in for window.feedBack: rigAt as core documents it, resolveSound echoing its inputs.
function fakeHost({ready=Promise.resolve()}={}){
 const calls=[],playback={setNotes:notes=>calls.push(['notes',notes]),setSound:sound=>calls.push(['sound',sound]),update:(...args)=>calls.push(['update',...args]),stop:()=>calls.push(['stop']),destroy:()=>calls.push(['destroy'])};
 const rigAt=(changes,t,base)=>{let rig=base||'';for(const change of [...changes].sort((a,b)=>a.t-b.t))if(change.t<=t&&change.rig!==undefined)rig=change.rig;return rig;};
 return {calls,host:{chartPlayback:{version:1,create:()=>{calls.push(['create']);return playback;}},soundResolver:{version:1,resolveSound:(identity,options)=>({identity,options})},soundTimeline:{version:1,rigAt},soundFallback:{version:1,get:instrument=>({instrument,program:4})},synth:{ready:()=>ready}}};
}
const keys=(notes,extra={})=>({type:'keys',notes,chords:[],...extra});
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

test('only a host with every version 1 sound API is used',()=>{
 const {host}=fakeHost();
 assert.equal(feedbackHost(host),host);
 assert.equal(feedbackHost(undefined),null);
 assert.equal(feedbackHost({...host,chartPlayback:{version:2,create(){}}}),null);
 assert.equal(feedbackHost({...host,soundFallback:undefined}),null);
 assert.equal(feedbackHost({...host,synth:{}}),null);
});
test('guide notes map to chart playback notes',()=>{
 const arrangement=keys([{time:1,pitch:60,sustain:.5,velocity:90},{time:2,pitch:62},{time:3,pitch:64,velocity:0},{time:4,pitch:127,sustain:.2}]);
 arrangement.chords=[{time:5,notes:[{pitch:67,sustain:1},{pitch:71,sustain:1,velocity:70}],velocity:110}];
 assert.deepEqual(feedbackGuideNotes(arrangement),[
  {t:1,midi:60,durS:.5,vel:90},{t:2,midi:62,durS:.12,vel:100},{t:4,midi:127,durS:.2,vel:100},
  {t:5,midi:67,durS:1,vel:110},{t:5,midi:71,durS:1,vel:70}]);
 // The preview pitch shift moves every note; one shifted out of MIDI range is left out.
 assert.deepEqual(feedbackGuideNotes(arrangement,2).map(n=>n.midi),[62,64,69,73]);
 assert.deepEqual(feedbackGuideNotes(keys([{time:0,pitch:60,velocity:.4},{time:1,pitch:60,velocity:200}])).map(n=>n.vel),[1,127]);
});
test('the sound follows the tone binding, the guide instrument and the fallback',()=>{
 const {host}=fakeHost(),project={rigLibrary:{rigs:[{id:'ep'}]}};
 const arrangement=keys([],{tones:{base_rig:'grand',changes:[{time:10,rig:'ep'},{time:20,name:'Verse'}]}});
 let sound=feedbackGuideSound(host,project,arrangement,5);
 assert.deepEqual(sound.identity,{rig:'grand'});
 assert.equal(sound.options.rigs,project.rigLibrary.rigs);
 assert.equal(sound.options.override,null);
 assert.deepEqual(sound.options.defaultGm,{instrument:'keys',program:4});
 assert.deepEqual(feedbackGuideSound(host,project,arrangement,15).identity,{rig:'ep'});
 assert.deepEqual(feedbackGuideSound(host,project,arrangement,25).identity,{rig:'ep'},'a change without a rig keeps the sound');
 sound=feedbackGuideSound(host,project,{...arrangement,guideVoice:{version:1,family:'organ',program:17}},5);
 assert.deepEqual(sound.options.override,{gm:{program:17}});
 assert.deepEqual(feedbackGuideSound(host,{},keys([]),0).identity,{rig:''});
});

function fakeEngine(arrangement){
 return {arrangement,project:{rigLibrary:{rigs:[]}},playing:false,pitch:0,position:0,currentTime:0,startedAt:0,context:{currentTime:100},loop:{enabled:false,start:0,end:4},gain:.25,getOutputGain(){return this.gain;}};
}
test('it takes over from the first Play after the sound bank loads',async()=>{
 let release;const {host,calls}=fakeHost({ready:new Promise(resolve=>release=resolve)}),engine=fakeEngine(keys([{time:1,pitch:60,sustain:.5}]));
 const guide=new FeedbackGuide(engine,host);
 assert.equal(guide.active,false);
 guide.update(0);assert.deepEqual(calls[0],['create']);
 guide.begin();engine.playing=true;guide.update(1);await flush();
 assert.equal(guide.active,false,'still loading at Play: OCE keeps the guide');
 release();await flush();guide.update(1);
 assert.equal(guide.active,false,'loaded mid-run: OCE keeps the guide until the next Play');
 guide.begin();assert.equal(guide.active,true);
 calls.length=0;engine.currentTime=2;engine.loop={enabled:true,start:1,end:3};guide.update(.75);
 assert.deepEqual(calls.map(c=>c[0]),['notes','sound','update']);
 assert.deepEqual(calls[0][1],[{t:1,midi:60,durS:.5,vel:100}]);
 assert.deepEqual(calls[2],['update',2,.75,3]);
 calls.length=0;guide.update(1);
 assert.deepEqual(calls.map(c=>c[0]),['sound','update'],'notes are sent once');
 assert.equal(calls[1][3],3);
});
test('mute, pause, other parts and the switch stop it',async()=>{
 const {host,calls}=fakeHost(),engine=fakeEngine(keys([{time:1,pitch:60}]));
 const guide=new FeedbackGuide(engine,host);guide.update(0);await flush();guide.begin();engine.playing=true;
 calls.length=0;guide.update(1);assert.equal(calls.at(-1)[0],'update');assert.equal(calls.at(-1)[2],1);
 engine.gain=0;calls.length=0;guide.update(1);assert.deepEqual(calls,[['update',NaN,0]],'muted or soloed away');
 engine.gain=.25;calls.length=0;guide.update(0);assert.deepEqual(calls,[['update',NaN,0]],'paused');
 engine.playing=false;calls.length=0;guide.update(1);assert.deepEqual(calls,[['update',NaN,0]],'not playing');
 engine.playing=true;guide.setEnabled(false);calls.length=0;guide.update(1);assert.deepEqual(calls,[['stop']],'switched off');
 guide.setEnabled(true);engine.arrangement={type:'guitar',notes:[],chords:[]};calls.length=0;guide.update(1);
 assert.equal(guide.active,false);assert.deepEqual(calls,[['stop']]);
 guide.destroy();assert.deepEqual(calls.at(-1),['destroy']);
});
test('new notes, not every new project object, reset the playback',async()=>{
 const {host,calls}=fakeHost(),engine=fakeEngine(keys([{time:1,pitch:60}]));
 const guide=new FeedbackGuide(engine,host);guide.update(0);await flush();guide.begin();engine.playing=true;guide.update(1);
 const sent=()=>calls.filter(c=>c[0]==='notes').length;assert.equal(sent(),1);
 engine.arrangement=keys([{time:1,pitch:60}]);guide.update(1);assert.equal(sent(),1,'an edit elsewhere');
 engine.arrangement=keys([{time:1,pitch:61}]);guide.update(1);assert.equal(sent(),2);
 engine.pitch=-12;guide.update(1);assert.equal(sent(),3);assert.equal(calls.filter(c=>c[0]==='notes').at(-1)[1][0].midi,49);
});
test('a failed sound bank leaves the guide on OCE',async()=>{
 const {host}=fakeHost({ready:Promise.reject(Error('404'))}),guide=new FeedbackGuide(fakeEngine(keys([])),host);
 guide.update(0);await flush();guide.begin();assert.equal(guide.active,false);
});
test('the engine leaves keys guide notes to FeedBack while it voices them',async()=>{
 const engine=new AudioEngine(),{host}=fakeHost();engine.feedback=new FeedbackGuide(engine,host);
 engine.setProject({duration:8,beats:[{time:1,measure:1}]},keys([{time:1,pitch:60,sustain:.5}]));engine.setEnabled('metronome',true);engine.startedAt=0;
 const events=[];engine.voice=(...args)=>events.push(args);
 engine.scheduleGuide(.99,1.01,0,.02);assert.deepEqual(events.map(e=>e[0]).sort(),[60,88],'not loaded: OCE plays the guide');
 engine.feedback.update(0);await flush();engine.feedback.begin();events.length=0;
 engine.scheduleGuide(.99,1.01,0,.02);assert.deepEqual(events.map(e=>e[0]),[88],'the metronome stays on OCE');
 engine.setProject({duration:8,beats:[]},{type:'drums',notes:[{time:1,piece:'snare'}],chords:[]});
 assert.equal(engine.feedback.active,false,'drums stay on OCE');
});
test('setting a keys project starts the sound bank before the first Play',async()=>{
 const engine=new AudioEngine(),{host,calls}=fakeHost();engine.feedback=new FeedbackGuide(engine,host);
 engine.setProject({duration:8},{type:'guitar',notes:[],chords:[]});assert.equal(calls.length,0);
 engine.setProject({duration:8},keys([]));assert.deepEqual(calls,[['create']]);await flush();
 engine.feedback.begin();assert.equal(engine.feedback.active,true);
 const off=new FeedbackGuide(engine,host);off.enabled=false;engine.feedback=off;engine.setProject({duration:8},keys([]));assert.equal(calls.filter(c=>c[0]==='create').length,1,'switched off: nothing loads');
});
test('the switch is saved as a preference, on unless turned off',async()=>{
 const {readPreferences}=await import('../src/preferences.js');
 const store=value=>({getItem:()=>JSON.stringify(value)});
 assert.equal(readPreferences(store({})).feedbackSound,true);
 assert.equal(readPreferences(store({feedbackSound:false})).feedbackSound,false);
});
test('disposing the engine leaves no FeedBack part behind',async()=>{
 const engine=new AudioEngine(),{host,calls}=fakeHost();engine.feedback=new FeedbackGuide(engine,host);
 engine.setProject({duration:8},keys([]));await engine.dispose();
 assert.deepEqual(calls.map(c=>c[0]),['create','destroy']);
});

test('a Play elsewhere than the pause stops first; resuming in place does not',async()=>{
 const {host,calls}=fakeHost(),engine=fakeEngine(keys([{time:1,pitch:60}]));
 const guide=new FeedbackGuide(engine,host);guide.update(0);await flush();guide.begin();engine.playing=true;guide.update(1);
 engine.playing=false;engine.position=1.2;guide.pause(true);guide.pause(false);calls.length=0;guide.begin();assert.deepEqual(calls,[],'resume in place, through play()\'s own pause');
 engine.playing=true;guide.update(1);engine.playing=false;guide.pause(true);engine.position=1.0;guide.pause(false);calls.length=0;guide.begin();assert.deepEqual(calls,[['stop']],'a seek back while paused, then Play');
});
test('a loop wrap, the start lead, the tone lookahead and a rounded rate',async()=>{
 const {host,calls}=fakeHost(),engine=fakeEngine(keys([{time:1,pitch:60}],{tones:{base_rig:'a',changes:[{time:2.05,rig:'b'}]}}));
 const guide=new FeedbackGuide(engine,host);guide.update(0);await flush();guide.begin();engine.playing=true;
 engine.position=1;engine.startedAt=100.025;calls.length=0;guide.update(1);
 assert.ok(Math.abs(calls.find(c=>c[0]==='update')[1]-.975)<1e-9,'before the transport starts, time runs up to the cursor');
 engine.startedAt=0;engine.currentTime=2;calls.length=0;guide.update(1.004);
 assert.deepEqual(calls.find(c=>c[0]==='sound')[1].identity,{rig:'b'},'resolved where core schedules');assert.equal(calls.find(c=>c[0]==='update')[2],1);
 engine.currentTime=1.7;calls.length=0;guide.update(1);assert.deepEqual(calls.map(c=>c[0]),['stop','sound','update'],'a wrap is a seek');
});
test('a rejected guide instrument leaves the part to OCE, which is silent for it',()=>{
 const {host}=fakeHost(),engine=fakeEngine(keys([],{guideVoice:{version:1,family:'organ',program:3}}));
 assert.equal(new FeedbackGuide(engine,host).available,false);
 engine.arrangement=keys([],{guideVoice:{version:1,family:'organ',program:17}});assert.equal(new FeedbackGuide(engine,host).available,true);
});
test('a host that throws mid-run falls back to OCE instead of breaking the transport',async()=>{
 const {host}=fakeHost(),engine=fakeEngine(keys([{time:1,pitch:60}]));host.soundResolver={version:1,resolveSound(){throw Error('host bug');}};
 const guide=new FeedbackGuide(engine,host);guide.update(0);await flush();guide.begin();engine.playing=true;
 assert.doesNotThrow(()=>guide.update(1));assert.equal(guide.active,false);
});
test('switched on while the bank is already loaded, the next restart uses it',()=>{
 const {host,calls}=fakeHost({ready:new Promise(()=>{})}),engine=fakeEngine(keys([{time:1,pitch:60}]));
 const guide=new FeedbackGuide(engine,host);guide.enabled=false;guide.setEnabled(true);
 host.synth.voices=()=>[];guide.begin();assert.equal(guide.active,false,'bank still loading');
 host.synth.voices=()=>[{bank:0,program:0}];guide.begin();assert.equal(guide.active,true);
});
