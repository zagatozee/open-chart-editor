// Inside FeedBack, a keys part's guide plays through FeedBack's own synth (chartPlayback,
// soundResolver, soundTimeline, soundFallback), so the editor sounds like the player: the same
// GM bank, the exact program, velocity, the part's rig binding and the player's fallback sound.
// Standalone OCE, drums, the live MIDI monitor and the offline guide render keep OCE's synth.
// OCE's own guide plays until FeedBack's sound bank has loaded, so nothing goes silent.
// Limits: the level is FeedBack's (its Instruments fader), not OCE's guide fader or pan; mute,
// solo and the guide switch still apply, by stopping it. No bends or slides (keys rarely use
// them), no centOffset. From core: a note edit during playback releases what sounds (setNotes),
// a note held across a loop start isn't re-struck, and loops under about 0.1 s aren't supported.
import {notePitch} from './model.js';
import {guideNotes,guideDuration} from './guide-synthesis.js';
import {resolveGuideVoice} from './guide-voice.js';

export function feedbackHost(host=globalThis.window?.feedBack){
 return host?.chartPlayback?.version===1&&host.soundResolver?.version===1&&host.soundTimeline?.version===1&&host.soundFallback?.version===1&&typeof host.synth?.ready==='function'?host:null;
}
// OCE's guide notes as chartPlayback wants them. Velocity 0 is left out (core would play it at
// 96), and so is a note the pitch shift takes outside MIDI 0-127 (clamped it would sound wrong).
export function feedbackGuideNotes(arrangement,pitchShift=0){
 const notes=[];
 for(const note of guideNotes(arrangement||{})){
  const pitch=notePitch(arrangement,note),velocity=note.velocity??100,midi=Math.round(pitch+pitchShift);
  if(!Number.isFinite(note.time)||!Number.isInteger(midi)||midi<0||midi>127||!(velocity>0))continue;
  notes.push({t:note.time,midi,durS:guideDuration(note,'keys'),vel:Math.min(127,Math.max(1,velocity))});
 }
 return notes;
}
// The sound FeedBack would play at `time`. OCE's guide instrument is an audition override, as
// it is for OCE's own guide (which also ignores its author mute, an export setting).
export function feedbackGuideSound(host,project,arrangement,time){
 const tones=arrangement.tones||{},changes=(Array.isArray(tones.changes)?tones.changes:[]).map(change=>({...change,t:change?.time??change?.t}));
 const program=arrangement.guideVoice?.version===1?arrangement.guideVoice.program:undefined;
 return host.soundResolver.resolveSound({rig:host.soundTimeline.rigAt(changes,time,tones.base_rig)},{rigs:project?.rigLibrary?.rigs,override:Number.isInteger(program)?{gm:{program}}:null,defaultGm:host.soundFallback.get('keys')});
}
// How far ahead core schedules onsets (chart-playback.js AHEAD_S): the sound is resolved there,
// so a note on a tone change gets the new sound.
const AHEAD_S=.1;
export class FeedbackGuide{
 constructor(engine,host=feedbackHost()){this.engine=engine;this.host=host;this.enabled=true;this.ready=false;this.live=false;this.dead=false;this.playback=null;this.notesKey=null;this.resumeAt=null;this.lastTime=null;}
 // A keys part, unless its guide instrument is one OCE rejects (OCE's own guide is then silent).
 get available(){const a=this.engine.arrangement;return !!this.host&&a?.type==='keys'&&(a.guideVoice===undefined||resolveGuideVoice(a).source==='editor-override');}
 // True while it voices the guide: OCE's own guide then leaves keys notes to it. Decided at each
 // Play, so the bank arriving mid-run doesn't double notes; the switch restarts the transport.
 get active(){return !this.dead&&this.live&&this.available;}
 // Called when a project or part is set, so the bank's state is known by the first Play.
 prepare(){
  if(this.playback||this.dead||!this.enabled||!this.available)return;
  // A host that throws here leaves the guide on OCE; it is never retried.
  try{this.playback=this.host.chartPlayback.create();}catch{this.dead=true;return;}
  Promise.resolve().then(()=>this.host.synth.ready()).then(()=>{this.ready=true;},()=>{});
 }
 // From the engine's pause(), which every seek, stop, setting change and play() goes through:
 // only a pause of a running transport marks where a Play may resume.
 pause(wasPlaying=false){if(wasPlaying)this.resumeAt=this.active?this.engine.position:null;this.update(0);}
 // From the engine's play(). Core resumes after where it paused when the playhead is within
 // 0.3 s of it, so anywhere but that spot is a seek of OCE's own: stop() first, as core asks.
 begin(){
  if(this.resumeAt!==this.engine.position)this.playback?.stop();
  // voices() is [] until the bank has loaded: known now, where ready() answers a few ticks late
  // (the switch's restart comes right after the part is made).
  if(this.playback&&!this.ready)try{this.ready=this.host.synth.voices?.()?.length>0;}catch{}
  this.resumeAt=null;this.lastTime=null;this.live=this.ready&&this.enabled;
 }
 // Called on each transport tick with the playback speed now.
 update(rate=0){
  try{this.tick(rate);}catch{this.dead=true;try{this.playback?.destroy();}catch{}this.playback=null;}
 }
 tick(rate){
  const engine=this.engine;
  if(this.dead||!this.enabled||!this.available){this.playback?.stop();return;}
  this.prepare();if(!this.playback)return;
  // Rounded: a speed ramp changes the rate every tick, and core re-times every queued onset at
  // each change, which fills the synth's voices.
  rate=Math.round(rate*100)/100;
  if(!this.active||!engine.playing||!(rate>0)||!(engine.getOutputGain('guide')>0)){this.lastTime=null;this.playback.update(NaN,0);return;}
  const arrangement=engine.arrangement;
  if(this.notesKey?.arrangement!==arrangement||this.notesKey.pitch!==engine.pitch){
   const notes=feedbackGuideNotes(arrangement,engine.pitch),json=JSON.stringify(notes);
   // An edit elsewhere in the project makes a new arrangement object: only new notes reset playback.
   if(json!==this.notesKey?.json)this.playback.setNotes(notes);
   this.notesKey={arrangement,pitch:engine.pitch,json};
  }
  // Play starts the transport 25 ms ahead; until then the time runs up to the cursor.
  const lead=engine.startedAt-engine.context.currentTime,time=lead>0?engine.position-lead*rate:engine.currentTime;
  // OCE's clock only steps back at a loop wrap: tell core, which would read a short step as jitter.
  if(this.lastTime!==null&&time<this.lastTime)this.playback.stop();
  this.lastTime=time;
  this.playback.setSound(feedbackGuideSound(this.host,engine.project,arrangement,time+AHEAD_S*rate));
  this.playback.update(time,rate,engine.loop.enabled?engine.loop.end:undefined);
 }
 // Through the engine's updateSetting while playing, so it takes effect at a fresh Play.
 setEnabled(value){this.enabled=!!value;this.prepare();}
 // Final: the engine pauses after this while disposing, which must not make a new part.
 destroy(){this.dead=true;this.playback?.destroy();this.playback=null;this.notesKey=null;}
}
