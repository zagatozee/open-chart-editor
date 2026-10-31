// Original atomic semitone editing. Audio audition pitch shift is independent.
import {clone,notePitch,synchronizeChordVoicings} from './model.js';
import {validCapo} from './fret-display.js';
const bounded=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw Error(`${label} must remain between ${min} and ${max}; transpose was not applied`);return value;};
export function transposeSelection(arrangement,selectedIds,semitones){
 if(arrangement.type==='drums')throw Error('Drum hits cannot be transposed; choose a different kit piece instead');
 const ids=new Set(selectedIds);if(!ids.size)throw Error('Select one or more notes to transpose');
 if(!Number.isSafeInteger(semitones))throw Error('Transpose must use a whole number of semitones');
 if(!['keys','guitar','bass'].includes(arrangement.type))throw Error('This instrument has no supported pitch mapping for transposition');
 const notes=[...arrangement.notes||[],...(arrangement.chords||[]).flatMap(c=>c.notes||[])],chosen=notes.filter(n=>ids.has(n.id));
 if(chosen.length!==ids.size||new Set(chosen.map(n=>n.id)).size!==chosen.length)throw Error('Transpose selection contains missing or ambiguous note IDs');
 if(!semitones)return {count:0,semitones:0};
 const maxFret=24-validCapo(arrangement.capo||0),updates=new Map();
 for(const note of chosen){
  const next=clone(note);
  if(arrangement.type==='keys'){
   bounded(notePitch(arrangement,note),0,127,'MIDI pitch');const pitch=bounded(notePitch(arrangement,note)+semitones,0,127,'MIDI pitch');
   next.pitch=pitch;next.string=Math.floor(pitch/24);next.fret=pitch%24;
  }else{
   bounded(note.string,0,arrangement.stringCount-1,'String index');bounded(note.fret,0,maxFret,'Fret');
   const base=arrangement.basePitches?.[note.string];if(!Number.isFinite(base))throw Error('Fretted transposition needs an explicit base pitch for every selected string');
   const pitch=base+(arrangement.tuning?.[note.string]||0)+(arrangement.capo||0)+note.fret;
   if(Object.hasOwn(note,'pitch')){
    if(!Number.isInteger(note.pitch)||note.pitch!==pitch)throw Error('Fretted note has conflicting explicit pitch and fret/tuning values; resolve its pitch mapping before transposing');
    next.pitch=note.pitch+semitones;
   }
   next.fret=bounded(note.fret+semitones,0,maxFret,'Fret');
   for(const key of ['slide_to','slide_unpitch_to'])if(Object.hasOwn(next.techniques||{},key)){
    const destination=next.techniques[key];if(destination===-1)continue;
    bounded(destination,0,maxFret,'Slide destination');next.techniques[key]=bounded(destination+semitones,0,maxFret,'Slide destination');
   }
  }
  updates.set(note.id,next);
 }
 // Build isolated mutable chord containers so template/zone synchronization
 // cannot partially change the original if an imported chord is malformed.
 const candidate={...arrangement,notes:(arrangement.notes||[]).map(n=>updates.get(n.id)||n),
  chords:(arrangement.chords||[]).map(c=>(c.notes||[]).some(n=>ids.has(n.id))?{...c,notes:c.notes.map(n=>updates.get(n.id)||n)}:c),
  chord_templates:[...arrangement.chord_templates||[]],handshapes:(arrangement.handshapes||[]).map(h=>({...h}))};
 if(arrangement.type!=='keys')synchronizeChordVoicings(candidate,ids);
 for(const key of ['notes','chords','chord_templates','handshapes'])arrangement[key]=candidate[key];
 return {count:chosen.length,semitones};
}
