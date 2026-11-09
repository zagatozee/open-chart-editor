// Inside FeedBack, a keys part's guide plays through FeedBack's own synth (chartPlayback,
// soundResolver, soundTimeline, soundFallback), so the editor sounds like the player: the same
// GM bank, the exact program, velocity, the part's rig binding and the player's fallback sound.
// Standalone OCE, drums, the live MIDI monitor and the offline guide render keep OCE's synth.
// OCE's own guide plays until FeedBack's sound bank has loaded, so nothing goes silent.
// Limits: the level is FeedBack's (its Instruments fader), not OCE's guide fader or pan; mute,
// solo and the guide switch still apply, by stopping it. No bends or slides (keys rarely use
// them), no centOffset, and core's own: a loop shorter than 0.3 s, no re-strike of a note held
// across a loop start, a tone change voicing from the next note on.
import {notePitch} from './model.js';
import {guideNotes,guideDuration} from './guide-synthesis.js';

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
export class FeedbackGuide{
 constructor(engine,host=feedbackHost()){this.engine=engine;this.host=host;this.enabled=true;this.ready=false;this.live=false;this.playback=null;this.notesKey=null;}
 get available(){return !!this.host&&this.engine.arrangement?.type==='keys';}
 // True while it voices the guide: OCE's own guide then leaves keys notes to it. Decided at
 // each Play (begin), so the bank arriving mid-run doesn't double the notes around the switch.
 get active(){return !this.dead&&this.live&&this.enabled&&this.available;}
 begin(){this.live=this.ready;}
 // Called when a project or part is set, so the bank's state is known by the first Play.
 prepare(){
  if(this.playback||this.dead||!this.enabled||!this.available)return;
  // A host that throws here leaves the guide on OCE; it is never retried.
  try{this.playback=this.host.chartPlayback.create();}catch{this.dead=true;return;}
  Promise.resolve().then(()=>this.host.synth.ready()).then(()=>{this.ready=true;},()=>{});
 }
 // Called on each transport tick (rate: the playback speed now) and on pause (rate 0).
 update(rate=0){
  const engine=this.engine;
  if(this.dead||!this.enabled||!this.available){this.playback?.stop();return;}
  this.prepare();if(!this.playback)return;
  if(!this.active||!engine.playing||!(rate>0)||!(engine.getOutputGain('guide')>0)){this.playback.update(NaN,0);return;}
  const arrangement=engine.arrangement;
  if(this.notesKey?.arrangement!==arrangement||this.notesKey.pitch!==engine.pitch){
   const notes=feedbackGuideNotes(arrangement,engine.pitch),json=JSON.stringify(notes);
   // An edit elsewhere in the project makes a new arrangement object: only new notes reset playback.
   if(json!==this.notesKey?.json)this.playback.setNotes(notes);
   this.notesKey={arrangement,pitch:engine.pitch,json};
  }
  const time=engine.currentTime;
  this.playback.setSound(feedbackGuideSound(this.host,engine.project,arrangement,time));
  this.playback.update(time,rate,engine.loop.enabled?engine.loop.end:undefined);
 }
 setEnabled(value){this.enabled=!!value;this.prepare();this.update();}
 // Final: the engine pauses after this while disposing, which must not make a new part.
 destroy(){this.dead=true;this.playback?.destroy();this.playback=null;this.notesKey=null;}
}
