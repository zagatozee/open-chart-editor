// Original editor model. Seconds on the wire; musical coordinates for grid edits.
import {createTone} from './tone-rack.js';
export const clone = value => structuredClone(value);
let sequence = 0;
export const uid = () => `event-${Date.now().toString(36)}-${++sequence}`;
export const DRUMS = ['kick','snare','hh_closed','hh_open','hh_pedal','tom_low','tom_mid','tom_hi','tom_floor','crash_l','crash_r','ride','ride_bell','splash','china','stack','bell','snare_xstick'];
export const TECHNIQUES = ['palm_mute','fret_hand_mute','hammer_on','pull_off','harmonic','harmonic_pinch','tap','slap','pluck','vibrato','tremolo','accent','ignore','link_next'];
export const SECTIONS = ['breakdown','bridge','chorus','head','hook','interlude','intro','noguitar','outro','postchorus','prechorus','riff','solo','transition','verse'];
export const FRETTED_COUNTS=Object.freeze([4,5,6,7,8]);
export function pitches(type,count){
 const layouts=type==='bass'?{4:[28,33,38,43],5:[23,28,33,38,43],6:[23,28,33,38,43,48],7:[23,28,33,38,43,48,53],8:[23,28,33,38,43,48,53,58]}:{4:[40,45,50,55],5:[40,45,50,55,59],6:[40,45,50,55,59,64],7:[35,40,45,50,55,59,64],8:[30,35,40,45,50,55,59,64]};
 if(['guitar','bass'].includes(type)&&!FRETTED_COUNTS.includes(count))throw Error('Fretted layouts support four through eight strings');
 return [...(layouts[count]||layouts[6])];
}
export function makeArrangement(type = 'guitar', count = null, {instrument=type}={}) {
  if(typeof instrument!=='string'||!instrument.trim()||instrument.length>64)throw Error('Instrument label must contain1 through64 characters');instrument=instrument.trim();
  if(!['guitar','bass','keys','drums'].includes(type)) type='keys';
  count ??= type === 'bass' ? 4 : 6;
  return {id:uid(),name:({guitar:'Lead',bass:'Bass',keys:'Piano',drums:'Drums'})[instrument] || instrument,type,instrument,role:type==='bass'?'bass':type==='guitar'?'lead':type,stringCount:count,
    basePitches:pitches(type,count),tuning:Array(count).fill(0),capo:0,centOffset:0,notes:[],chords:[],chord_templates:[],anchors:[],handshapes:[],phrases:[],toneChanges:[],tones:{base:'Clean',changes:[],definitions:{Clean:createTone('Clean')}}};
}
export function makeProject() {
  return {version:1,title:'Untitled',artist:'Local author',album:'',duration:60,
    beats:Array.from({length:121},(_,i)=>({time:i/2,measure:i%4===0?i/4+1:-1})),sections:[],arrangements:[makeArrangement()]};
}
export function demoProject() {
  const p=makeProject(); p.title='Chart study No. 1'; p.artist='Original local study'; p.duration=16;
  p.beats=p.beats.slice(0,33); p.sections=[{name:'intro',number:1,start_time:0},{name:'verse',number:1,start_time:4}];
  const a=p.arrangements[0]; a.anchors=[{time:0,fret:3,width:4},{time:4,fret:5,width:4}];
  a.phrases=[{id:uid(),name:'A',time:0},{id:uid(),name:'B',time:4}];
  for(let i=0;i<24;i++) a.notes.push({id:uid(),time:i*0.5,string:i%6,fret:[3,5,7,5][i%4],sustain:i%4===3?0.8:0.2,techniques:i%5===0?{palm_mute:true}:{}});
  return p;
}
export function normalizeProject(raw) {
  const p=clone(raw); if(!p || !Array.isArray(p.arrangements)||!p.arrangements.length) throw Error('Project needs at least one arrangement');
  p.cdlcBuildOptions ??= clone(p.importedBuildOptions||{});if(!p.cdlcBuildOptions||typeof p.cdlcBuildOptions!=='object'||Array.isArray(p.cdlcBuildOptions))throw Error('CDLC build settings must be an object');
  if(!Array.isArray(p.beats)||p.beats.length<2) p.beats=makeProject().beats;
  p.beats=p.beats.map(b=>({...b,time:Number(b.time)})); assertGrid(p.beats);
  for(const a of p.arrangements){
    if(a?._notationOnly===true){
      const entry=a._entry;
      if(a.readOnly!==true||a.type!=='notation'||!entry||typeof entry.id!=='string'||!entry.id||a.id!==entry.id||a.name!==(Object.hasOwn(entry,'name')?entry.name:entry.id)||a.instrument!==(Object.hasOwn(entry,'type')?entry.type:'notation')||typeof entry.notation!=='string'||!entry.notation||Object.hasOwn(entry,'file')||Object.hasOwn(entry,'drum_tab'))throw Error('Retained notation must keep its original read-only source identity');
      for(const key of ['notes','chords','anchors','handshapes','chord_templates','difficulties','phrases'])if(Object.hasOwn(a,key)&&(!Array.isArray(a[key])||a[key].length))throw Error('Retained notation cannot contain invented editable chart content');
      continue;
    }
    a.id ||= uid(); a.type ||= 'guitar'; a.stringCount ||= a.type==='bass'?4:a.tuning?.length||6;
    a.centOffset ??= 0;if(!Number.isFinite(a.centOffset))throw Error('Tuning reference cents must be finite');
    a.capo ??= 0;if(!Number.isInteger(a.capo)||a.capo<0||a.capo>24)throw Error('Capo must be an integer from 0 to 24');
    a.basePitches ||= pitches(a.type,a.stringCount); a.tuning ||= Array(a.stringCount).fill(0);
    for(const key of ['notes','chords','chord_templates','anchors','handshapes','phrases','toneChanges']) a[key] ||= [];
    for(const content of [a,...a.difficulties||[]]){const ids=new Set();for(const n of [...content.notes||[],...(content.chords||[]).flatMap(c=>c.notes||[])]){if(!n.id||ids.has(n.id))n.id=uid();ids.add(n.id);n.techniques ||= {};n.sustain ??= 0;}}
    a.tones ||= {base:'Clean',changes:[],definitions:{}};a.tones.changes ||= [];a.tones.definitions ||= {};
  }
  if(!Number.isFinite(p.duration)||p.duration<0){p.duration=p.beats.at(-1).time;for(const a of p.arrangements)for(const n of [...a.notes,...a.chords.flatMap(c=>c.notes||[])])p.duration=Math.max(p.duration,n.time+(n.sustain||0));}
  if(p.vocals!==undefined){if(!Array.isArray(p.vocals))throw Error('Vocals must be an array');const ids=new Set();for(const row of p.vocals){if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Each vocal syllable must be an object');if(typeof row.id!=='string'||!row.id||ids.has(row.id))row.id=uid();ids.add(row.id);row.length??=0;}}
  return p;
}
export function assertGrid(beats) {
  if(beats.length<2 || beats.some((b,i)=>!Number.isFinite(b.time)||(i>0&&b.time<=beats[i-1].time))) throw Error('Beat times must be finite and strictly increasing');
}
export function extendGrid(beats,duration,{trim=false}={}){
  assertGrid(beats);if(!Number.isFinite(duration)||duration<=0)throw Error('Audio duration must be positive');
  const result=clone(trim?beats.filter(b=>b.time<=duration):beats),step=beats.at(-1).time-beats.at(-2).time;
  if(result.length<2)return[{time:0,measure:1},{time:Math.min(step,duration),measure:-1}];
  const lastDown=result.findLastIndex(b=>b.measure>=0),meter=result.at(-1).numerator||4,denominator=result.at(-1).denominator||4;
  let beatInBar=(result.length-1-lastDown)%meter,bar=result[lastDown]?.measure||1;
  while(result.at(-1).time+step<=duration+1e-9){if(result.length>=200000)throw Error('Beat map exceeds the local marker limit');beatInBar++;if(beatInBar>=meter){beatInBar=0;bar++;}result.push({...result.at(-1),time:result.at(-1).time+step,measure:beatInBar===0?bar:-1,numerator:meter,denominator,bar,beat:beatInBar+1,meterStart:false});}
  return result;
}
function interval(beats, value, byTime) {
  if(!byTime) return Math.max(0,Math.min(beats.length-2,Math.floor(value)));
  let lo=0,hi=beats.length-1;while(lo+1<hi){const m=(lo+hi)>>1;if(beats[m].time<=value)lo=m;else hi=m;}return lo;
}
export function timeAt(beats, beat) { const i=interval(beats,beat,false);return beats[i].time+(beat-i)*(beats[i+1].time-beats[i].time); }
export function beatAt(beats,time) {const i=interval(beats,time,true);return i+(time-beats[i].time)/(beats[i+1].time-beats[i].time);}
export function snapTime(beats,time,division=4){return Math.max(0,timeAt(beats,Math.round(beatAt(beats,time)*division)/division));}
export function setTempo(project,bpm,{start=0,end=project.beats.length-1,moveNotes=false}={}) {
  if(!(bpm>=10&&bpm<=500)) throw Error('Tempo must be between 10 and 500 BPM');
  const old=clone(project.beats),next=clone(old);
  for(let i=start+1;i<=end;i++)next[i].time=next[i-1].time+60/bpm*4/(old[i-1].denominator||4);
  const delta=next[end].time-old[end].time;for(let i=end+1;i<next.length;i++)next[i].time+=delta;
  applyGrid(project,next,moveNotes);
}
export function applyGrid(project,next,moveNotes=false){
  assertGrid(next); const old=project.beats;
  const remap=t=>timeAt(next,beatAt(old,t));
  const retimeNote=n=>{const start=n.time,end=remap(start+(n.sustain||0));n.time=remap(start);n.sustain=Math.max(0,end-n.time);for(const point of n.techniques?.bend_values||[])point.t=remap(start+point.t)-n.time;};
  const retimeContent=content=>{for(const n of content.notes||[])retimeNote(n);for(const c of content.chords||[]){const start=c.time;c.time=remap(start);for(const n of c.notes||[]){n.time??=start;retimeNote(n);}}for(const anchor of content.anchors||[])anchor.time=remap(anchor.time);for(const h of content.handshapes||[]){h.start_time=remap(h.start_time);h.end_time=remap(h.end_time);}};
  if(moveNotes)for(const a of project.arrangements){
    retimeContent(a);for(const level of a.difficulties||[])retimeContent(level);
    for(const collection of ['phrases','toneChanges'])for(const item of a[collection]||[])item.time=remap(item.time);
    for(const t of a.tones?.changes||[])t.time=remap(t.time);
  }
  if(moveNotes){for(const s of project.sections)s.start_time=remap(s.start_time);for(const vocal of project.vocals||[]){const end=remap(vocal.time+(vocal.length||0));vocal.time=remap(vocal.time);vocal.length=end-vocal.time;}}
  project.beats=clone(next);project.duration=Math.max(project.duration,next.at(-1).time);
}
// Move the beat map and every timed item by the same number of seconds (the
// content set matches applyGrid). Beats pushed before zero are dropped and bar
// numbers renumbered; notes, chords, hand shapes and lyrics may not cross zero.
// Markers that would (sections, phrases, tones, anchors) collapse to the last
// one at or before zero, so whatever applied at the new start still applies.
export function shiftTimeline(project,offset){
  if(!Number.isFinite(offset))throw Error('Shift must be a finite number of seconds');
  if(offset===0)return {removedBeats:0};
  const keep=project.beats.filter(b=>b.time+offset>=-1e-9),removedBeats=project.beats.length-keep.length;
  if(keep.length<2)throw Error('That shift would leave fewer than two beats');
  const owners=project.arrangements.flatMap(a=>[a,...a.difficulties||[]]);
  const content=[...owners.flatMap(o=>[...(o.notes||[]).map(n=>n.time),...(o.chords||[]).map(c=>c.time),...(o.handshapes||[]).map(h=>h.start_time)]),...(project.vocals||[]).map(v=>v.time)];
  const earliest=Math.min(...content);
  if(earliest+offset< -1e-9)throw Error(`Notes start at ${earliest.toFixed(3)} s, so the map can move at most ${earliest.toFixed(3)} s earlier`);
  const move=t=>Math.max(0,Math.round((t+offset)*1e9)/1e9);
  const retimeNote=n=>{n.time=move(n.time);};
  const markers=(list,key='time')=>{
   if(!Array.isArray(list))return list;
   const before=list.filter(m=>m[key]+offset<=1e-9),last=before.reduce((best,m)=>!best||m[key]>=best[key]?m:best,null);
   const kept=list.filter(m=>m[key]+offset>1e-9||m===last);
   for(const m of kept)m[key]=move(m[key]);
   return kept;
  };
  for(const o of owners){
   for(const n of o.notes||[])retimeNote(n);
   for(const c of o.chords||[]){const start=c.time;c.time=move(start);for(const n of c.notes||[]){n.time??=start;retimeNote(n);}}
   for(const h of o.handshapes||[]){h.start_time=move(h.start_time);h.end_time=move(h.end_time);}
   if(o.anchors)o.anchors=markers(o.anchors);
  }
  for(const a of project.arrangements){
   for(const collection of ['phrases','toneChanges'])if(a[collection])a[collection]=markers(a[collection]);
   if(a.tones?.changes)a.tones.changes=markers(a.tones.changes);
  }
  if(project.sections)project.sections=markers(project.sections,'start_time');
  for(const v of project.vocals||[])v.time=move(v.time);
  // Bar numbers count from the first kept bar when the source numbered them in order.
  const removedBars=project.beats.filter(b=>b.time+offset< -1e-9&&b.measure>=0).length;
  const numbers=keep.filter(b=>b.measure>0).map(b=>b.measure),ordered=numbers.every((m,i)=>i===0||m===numbers[i-1]+1);
  project.beats=keep.map(b=>({...b,time:move(b.time),...(ordered&&b.measure>0&&removedBars?{measure:b.measure-removedBars}:{})}));
  project.duration=Math.max(project.duration,project.beats.at(-1).time);
  return {removedBeats};
}
export function notePitch(a,n){
  if(a.type==='drums')return null;if(Number.isInteger(n.pitch))return n.pitch;
  if(a.type==='keys')return n.string*24+n.fret;
  return (a.basePitches?.[n.string]??pitches(a.type,a.stringCount)[n.string])+(a.tuning?.[n.string]||0)+(a.capo||0)+n.fret;
}
export function makeNote(a,time,lane,fret=0,sustain=0.25){
  const n={id:uid(),time:Math.max(0,time),sustain:Math.max(0,sustain),string:lane,fret,techniques:{}};
  if(a.type==='keys'){n.pitch=lane;n.string=Math.floor(lane/24);n.fret=lane%24;n.hand='rh';}
  if(a.type==='drums'){n.piece=DRUMS[lane];n.velocity=100;n.sustain=0;}
  return n;
}
export function setStringCount(a,count){
  if(!['guitar','bass'].includes(a.type))throw Error('String counts require guitar or bass');
  const allowed=FRETTED_COUNTS;if(!allowed.includes(count)||!allowed.includes(a.stringCount))throw Error('Unsupported string count');
  if(count===a.stringCount)return;
  // Match the standard physical string positions, rather than the user's custom
  // open pitches. Bass six adds a high C; guitar seven/eight add lower strings.
  const standard=pitches(a.type,a.stringCount),next=pitches(a.type,count),old=a.basePitches||standard,tuning=a.tuning||standard.map(()=>0);
  if(old.length!==a.stringCount||tuning.length!==a.stringCount||old.some(p=>!Number.isInteger(p))||tuning.some(p=>!Number.isInteger(p)))throw Error('Resolve invalid base pitches or tuning before changing string count');
  const mapping=standard.map(p=>next.indexOf(p)),contents=[a,...a.difficulties||[]],notes=[...new Set(contents.flatMap(c=>[...c.notes||[],...(c.chords||[]).flatMap(ch=>ch.notes||[])]))];
  if(notes.some(n=>!Number.isInteger(n.string)||n.string<0||n.string>=a.stringCount))throw Error('Resolve invalid note strings before changing string count');
  const templates=(a.chord_templates||[]).map(template=>{if(!Array.isArray(template.frets)||template.frets.length!==a.stringCount)throw Error('Resolve invalid chord shapes before changing string count');const updates={};for(const key of ['frets','fingers'])if(Array.isArray(template[key]))updates[key]=next.map((_,i)=>template[key][mapping.indexOf(i)]??-1);return{template,updates};});
  if(notes.some(n=>mapping[n.string]<0)||(a.chord_templates||[]).some(c=>c.frets.some((f,i)=>f>=0&&mapping[i]<0)))throw Error('Removing a string would lose authored notes or a chord voicing');
  const baseOffset=old[0]-standard[0],bases=next.map((p,i)=>{const source=mapping.indexOf(i);return source<0?p+baseOffset:old[source];}),offsets=next.map((_,i)=>tuning[mapping.indexOf(i)]??0);
  for(const n of notes)n.string=mapping[n.string];for(const {template,updates}of templates)Object.assign(template,updates);
  a.tuning=offsets;a.basePitches=bases;a.stringCount=count;
}
// One string's tuning offset from the inspector: any whole number of semitones (the pack rule).
export function setStringOffset(a,string,text){
  const value=Number(text);
  if(!Number.isInteger(string)||string<0||string>=a.stringCount)throw Error('That string is not part of this arrangement');
  if(String(text).trim()===''||!Number.isInteger(value))throw Error('A string offset must be a whole number of semitones');
  const tuning=a.tuning||(a.tuning=[]);while(tuning.length<string)tuning.push(0);tuning[string]=value;
}
function selectedChordShape(a,notes){
  if(notes.length<2)throw Error('Select at least two notes');
  if(notes.some(n=>Math.abs(n.time-notes[0].time)>0.001))throw Error('Chord notes must start together');
  if(new Set(notes.map(n=>n.string)).size!==notes.length)throw Error('One note per string in a chord');
  const frets=Array(a.stringCount).fill(-1),fingers=Array(a.stringCount).fill(-1);
  for(const n of notes){frets[n.string]=n.fret;const finger=n.techniques?.left_hand;if(Number.isInteger(finger)&&finger>=0&&finger<=4)fingers[n.string]=finger;}
  return {frets,fingers};
}
// Exact fingering match avoids replacing an entered finger with library data.
export function matchingChordTemplate(a,notes){
  const shape=selectedChordShape(a,notes);
  return a.chord_templates.findIndex(t=>t.frets?.length===a.stringCount&&shape.frets.every((f,i)=>t.frets[i]===f)&&shape.fingers.every((f,i)=>(t.fingers?.[i]??-1)===f));
}
export function chordFromSelection(a,notes,name='Chord',{reuseTemplate=true}={}){
  const {frets,fingers}=selectedChordShape(a,notes);let index=reuseTemplate?matchingChordTemplate(a,notes):-1;
  if(index<0){index=a.chord_templates.length;a.chord_templates.push({name,displayName:name,frets,fingers});}
  const chord={time:notes[0].time,chord_id:index,notes:clone(notes)};a.chords.push(chord);
  a.notes=a.notes.filter(n=>!notes.some(x=>x.id===n.id));
  a.handshapes.push({chord_id:chord.chord_id,start_time:chord.time,end_time:Math.max(...notes.map(n=>n.time+Math.max(n.sustain,0.25)))});
  return chord;
}
export function updateChordTemplate(a,index,updates){
  const template=a.chord_templates[index];if(!template)throw Error('Chord template not found');
  if(!Array.isArray(updates.frets)||!Array.isArray(updates.fingers)||updates.frets.length!==a.stringCount||updates.fingers.length!==a.stringCount||updates.frets.some(f=>!Number.isInteger(f)||f< -1||f>24)||updates.fingers.some(f=>!Number.isInteger(f)||f< -1||f>4))throw Error('Invalid chord frets or fingering');
  const next=clone(updates),oldFingers=template.fingers||[],replacements=[];
  for(const content of [a,...a.difficulties||[]])for(const chord of (content.chords||[]).filter(c=>c.chord_id===index)){
    const previous=chord.notes||[];
    const notes=next.frets.flatMap((f,string)=>{
      if(f<0)return[];
      const old=previous.find(n=>n.string===string),note=old?{...clone(old),time:chord.time,string,fret:f}:makeNote(a,chord.time,string,f,.25);
      // Original inheritance policy: equality with the previous template (or
      // absence) follows its new finger. Different prescriptions, including
      // explicit -1, remain per-instance overrides. Equality cannot recover
      // historical author intent; this is not an R+ Workshop algorithm.
      const previousFinger=oldFingers[string]??-1;
      if(!old||(next.fingers[string]!==previousFinger&&(old.techniques?.left_hand===undefined||old.techniques.left_hand===previousFinger)))note.techniques={...note.techniques,left_hand:next.fingers[string]};
      return[note];
    });
    replacements.push({chord,notes});
  }
  // Prepare every current/hidden-level replacement before changing the source.
  Object.assign(template,next);
  for(const {chord,notes}of replacements)chord.notes=notes;
}
// Editing one strum must not rewrite every occurrence of its reusable template.
// Child techniques and opaque records stay on the original note objects.
export function synchronizeChordVoicings(a,changedIds){
 const changed=new Set(changedIds),replacements=[];
 for(const chord of a.chords||[]){
  if(!(chord.notes||[]).some(n=>changed.has(n.id)))continue;
  const oldIndex=chord.chord_id,old=a.chord_templates[oldIndex];if(!old)throw Error('Chord refers to a missing template');
  const template=clone(old),byString=new Map(chord.notes.map(n=>[n.string,n]));
  if(byString.size!==chord.notes.length)throw Error('Chord needs one voice per string');
  template.frets=Array.from({length:a.stringCount},(_,s)=>byString.get(s)?.fret??-1);
  template.fingers=Array.from({length:a.stringCount},(_,s)=>{const n=byString.get(s);return n?(n.techniques?.left_hand??old.fingers?.[s]??-1):-1;});
  const serialized=JSON.stringify(template);let index=a.chord_templates.findIndex(t=>JSON.stringify(t)===serialized);
  if(index<0){index=a.chord_templates.length;a.chord_templates.push(template);}
  chord.chord_id=index;replacements.push({oldIndex,index,chord});
 }
 for(const zone of a.handshapes||[]){
  const affected=replacements.filter(r=>r.oldIndex===zone.chord_id&&r.chord.time>=zone.start_time&&r.chord.time<zone.end_time);
  if(!affected.length)continue;
  const voices=(a.chords||[]).filter(c=>c.time>=zone.start_time&&c.time<zone.end_time&&(c.chord_id===zone.chord_id||affected.some(r=>r.chord===c)));
  if(voices.length&&voices.every(c=>c.chord_id===affected[0].index))zone.chord_id=affected[0].index;
 }
 return replacements;
}
export function validate(project,target='feedpak'){
  const out=[];const issue=(a,n,message,severity='error')=>out.push({arrangement:a.id,note:n?.id,time:n?.time??0,message,severity});
  try{assertGrid(project.beats);}catch(e){out.push({severity:'error',message:e.message,time:0});}
  for(const a of project.arrangements){
    if(a._notationOnly===true){if(target==='xml'||target==='cdlc')issue(a,null,`${a.name}: retained notation has no established stock RS2014 chart conversion`);continue;}
    if(target==='xml'||target==='cdlc'){
      if(!['guitar','bass'].includes(a.type))issue(a,null,`${a.name}: ${a.type} requires a separate game mod/export adapter`);
      if(a.stringCount!==(a.type==='bass'?4:6))issue(a,null,`${a.name}: stock RS2014 requires exactly six-string guitar or four-string bass`);
    }
    const cells=new Set();for(const n of a.notes){
      if(!Number.isFinite(n.time)||n.time<0||!Number.isFinite(n.sustain)||n.sustain<0)issue(a,n,'Invalid note timing');
      if(a.type==='guitar'||a.type==='bass'){
        if(!Number.isInteger(n.string)||n.string<0||n.string>=a.stringCount)issue(a,n,'Note refers to a missing string');
        if(!Number.isInteger(n.fret)||n.fret<0||n.fret>24)issue(a,n,'Fret must be 0–24');
        const anchor=[...a.anchors].reverse().find(x=>x.time<=n.time);
        if(n.fret>0&&(!anchor||n.fret<anchor.fret||n.fret>=anchor.fret+(anchor.width||4)))issue(a,n,'Note outside an anchor zone','warning');
      }
      if(a.type==='keys'&&!(notePitch(a,n)>=0&&notePitch(a,n)<=127))issue(a,n,'Pitch outside MIDI range');
      if(a.type==='drums'&&!n.piece)issue(a,n,'Drum hit needs a kit piece');
      const key=`${n.time}:${a.type==='drums'?n.piece:a.type==='keys'?notePitch(a,n):n.string}`;
      if(cells.has(key))issue(a,n,'Duplicate note or hit');cells.add(key);
    }
    for(const phrase of a.phrases||[])if(['guitar','bass'].includes(a.type)&&!a.anchors.some(x=>Math.abs(x.time-phrase.time)<0.001))issue(a,phrase,'Phrase needs an anchor at its start','warning');
  }return out;
}
export {History} from './history.js';
