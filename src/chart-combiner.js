// Chart Combiner (issue #33): splice chosen sections from multiple loaded
// source projects into one new standalone project. Reuses region.js's
// copyRegion/pasteRegion for the actual per-arrangement content move (same
// id/template/tone-name dedup already proven there) rather than
// reimplementing it; this module only adds what's genuinely new: picking a
// bounded section per source, matching/creating destination arrangements
// across many different sources, a tuning-compatibility gate, and the
// backing-audio assembly (slice/crossfade/leading-silence trim), none of
// which existed anywhere in the app before.
import {clone,uid,makeProject,normalizeProject,extendGrid} from './model.js';
import {copyRegion,pasteRegion} from './region.js';

// --- Section picking ---------------------------------------------------

// Every real section in a source project, widened with the span it actually
// covers (up to the next section, or the end of the song). A source with no
// sections at all returns [] - the UI then only offers "All song" for it.
export function sourceSections(project){
 const sections=[...(project.sections||[])].sort((a,b)=>a.start_time-b.start_time);
 return sections.map((section,index)=>({...section,end:index+1<sections.length?sections[index+1].start_time:project.duration}));
}

// --- Tuning compatibility ------------------------------------------------

// Generalizes combine.js's same-project per-string check: stringCount must
// match for anything but 'incompatible'. Every string off by the exact same
// constant number of semitones is a safe, lossless auto-transpose; anything
// else can't be adapted automatically.
export function checkTuning(sourceArr,destArr){
 if(sourceArr.stringCount!==destArr.stringCount)return{status:'incompatible',semitones:0};
 const diffs=Array.from({length:sourceArr.stringCount},(_,s)=>
  (sourceArr.basePitches[s]+sourceArr.tuning[s]+(sourceArr.capo||0))-(destArr.basePitches[s]+destArr.tuning[s]+(destArr.capo||0)));
 const constant=diffs.every(d=>d===diffs[0]);
 if(!constant)return{status:'incompatible',semitones:0};
 return{status:diffs[0]===0?'match':'transpose',semitones:diffs[0]};
}

function transposeClipboard(clipboard,semitones){
 if(!semitones)return clipboard;
 const shiftFret=n=>({...n,fret:n.fret+semitones});
 return {...clone(clipboard),
  notes:clipboard.notes.map(shiftFret),
  chords:clipboard.chords.map(chord=>({...chord,notes:(chord.notes||[]).map(shiftFret)})),
  templates:clipboard.templates.map(template=>({...template,frets:template.frets.map(fret=>fret<0?fret:fret+semitones)}))};
}

// A clip's fret values are only safe to place if none land out of range
// after an auto-transpose; otherwise this clip's content is kept on its own
// separate destination track rather than silently producing broken frets.
function fitsFretRange(clipboard,destArr){
 const max=destArr.type==='keys'?Infinity:24;
 const allFrets=[...clipboard.notes,...clipboard.chords.flatMap(c=>c.notes||[])].map(n=>n.fret);
 return allFrets.every(fret=>fret>=0&&fret<=max);
}

// --- Per-arrangement clip extraction/placement --------------------------

// Thin wrapper around region.js's copyRegion: the arrangement-only content
// (notes/chords/chord_templates/anchors/handshapes/tones) for one source
// arrangement's picked range. Also carries copyRegion's own `.sections`/
// `.vocals` fields, which callers must apply from only ONE arrangement per
// clip (see buildCombinedProject) - copyRegion itself is unmodified.
export function arrangementClip(project,arrangementId,start,end){
 return copyRegion({...project,sections:project.sections||[]},arrangementId,start,end);
}

// Places a clip into a destination arrangement at `time`, reusing
// pasteRegion's id/template/tone-name dedup wholesale. `semitones` (from
// checkTuning) re-frets the clip first. `includeMarkers` controls whether
// this call's `.sections`/`.vocals` are actually pushed into the
// destination project - callers pass true for exactly one arrangement per
// clip (see buildCombinedProject) so section/vocal markers aren't
// duplicated once per instrument track.
export function placeArrangementClip(destProject,destArr,clipboard,time,{semitones=0,includeMarkers=false}={}){
 const transposed=transposeClipboard(clipboard,semitones);
 const toPlace=includeMarkers?transposed:{...transposed,sections:[],vocals:[]};
 return pasteRegion(destProject,destArr.id,toPlace,time);
}

// --- Leading-silence detection/trim --------------------------------------

// How many seconds, starting at `fromSeconds`, stay below `thresholdDb`
// before the first window that doesn't - capped at `maxSeconds`. Targets
// the common RS2014 CDLC convention of a long silent lead-in (often ~10s)
// before the song audio actually starts.
export function detectLeadingSilence(buffer,fromSeconds,{thresholdDb=-50,windowMs=20,maxSeconds=20}={}){
 const threshold=Math.pow(10,thresholdDb/20);
 const windowSamples=Math.max(1,Math.round(buffer.sampleRate*windowMs/1000));
 const startSample=Math.max(0,Math.round(fromSeconds*buffer.sampleRate));
 const maxSample=Math.min(buffer.length,startSample+Math.round(maxSeconds*buffer.sampleRate));
 const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
 for(let sample=startSample;sample<maxSample;sample+=windowSamples){
  const windowEnd=Math.min(maxSample,sample+windowSamples);
  for(const data of channels)for(let i=sample;i<windowEnd;i++)if(Math.abs(data[i])>threshold)return (sample-startSample)/buffer.sampleRate;
 }
 return (maxSample-startSample)/buffer.sampleRate;
}

// --- Audio assembly -------------------------------------------------------

function equalPowerGain(t){return Math.cos((1-t)*Math.PI/2);} // t: 0 (silent) .. 1 (full)

// clips: [{buffer, start, end, padBefore, fadeIn, fadeOut}] in final order
// (seconds; padBefore/fadeIn/fadeOut are the gap/crossfade before this clip,
// 0 for the first). trackFadeIn/trackFadeOut shape the very start of the
// first clip and the very end of the last clip once each - independent of
// any inter-clip fades, and needed even when those are 0 (e.g. a leading
// -silence trim down to 0s would otherwise start at an abrupt full-volume
// attack).
export function assembleCombinedAudio(ctx,clips,{trackFadeIn=0,trackFadeOut=0}={}){
 if(!clips.length)throw Error('No clips to assemble');
 const sampleRate=clips[0].buffer.sampleRate,channelCount=Math.max(...clips.map(c=>c.buffer.numberOfChannels));
 let cursor=0;const placements=[];
 for(const clip of clips){cursor+=clip.padBefore||0;placements.push({...clip,placedAt:cursor});cursor+=clip.end-clip.start;}
 const totalLength=Math.ceil(cursor*sampleRate);
 const out=ctx.createBuffer(channelCount,totalLength,sampleRate);
 const outChannels=Array.from({length:channelCount},(_,i)=>out.getChannelData(i));
 placements.forEach((clip,index)=>{
  const clipSamples=Math.round((clip.end-clip.start)*sampleRate),startSample=Math.round(clip.start*clip.buffer.sampleRate);
  const placedSample=Math.round(clip.placedAt*sampleRate);
  const fadeInSamples=Math.round((index===0?trackFadeIn:clip.fadeIn||0)*sampleRate);
  const fadeOutSamples=Math.round((index===placements.length-1?trackFadeOut:clip.fadeOut||0)*sampleRate);
  for(let channel=0;channel<channelCount;channel++){
   const source=clip.buffer.getChannelData(Math.min(channel,clip.buffer.numberOfChannels-1)),dest=outChannels[channel];
   for(let i=0;i<clipSamples;i++){
    const destIndex=placedSample+i;if(destIndex<0||destIndex>=dest.length)continue;
    let gain=1;
    if(fadeInSamples>0&&i<fadeInSamples)gain*=equalPowerGain(i/fadeInSamples);
    if(fadeOutSamples>0&&i>=clipSamples-fadeOutSamples)gain*=equalPowerGain((clipSamples-i)/fadeOutSamples);
    dest[destIndex]+=(source[startSample+i]||0)*gain;
   }
  }
 });
 return out;
}

// --- Orchestration ---------------------------------------------------------

// The same six user-facing categories the folder-browser panel already
// tags songs with (issue #31) - reused here so "Include parts" means the
// same thing in both places, not a second vocabulary. Also the single
// classifier destination-track matching keys on (see buildCombinedProject
// below) - using one function for both means a role-detection fix here
// automatically fixes merging too, instead of the two staying able to
// silently disagree.
export const PART_CATEGORIES=['lead','rhythm','bass','vocals','piano','drums'];
export function categoryForArrangement(sourceArr){
 if(sourceArr.type==='bass')return 'bass';
 if(sourceArr.type==='keys')return 'piano';
 if(sourceArr.type==='drums')return 'drums';
 if(sourceArr.type==='guitar'){
  if(sourceArr.role==='rhythm')return 'rhythm';
  if(sourceArr.role==='lead')return 'lead';
  // Some real-world sources (third-party FeedPak conversions, not authored
  // by OCE itself) omit an explicit role entirely. Falling back to "lead"
  // unconditionally would silently merge a Rhythm track into Lead whenever
  // role is missing (confirmed: this merged two real Tool songs' Lead and
  // Rhythm tracks into one, producing hundreds of duplicate-looking
  // anchors) - fall back to the same name-text heuristic already used
  // elsewhere in this codebase for exactly this ambiguity (rplus_io.py,
  // pack_io.py's XML role derivation).
  return /rhythm/i.test(sourceArr.name||'')?'rhythm':'lead';
 }
 return 'other';
}

// clips: the flat, user-ordered list from the dialog - each
// {sourceProject, label, start, end}. Several clips may share the same
// sourceProject (e.g. two different sections of the same song).
// includeParts: which of PART_CATEGORIES to keep - e.g. ['lead'] alone
// builds a Lead-only solos/album chart from the same picked clips, instead
// of every instrument together. Defaults to all of them (today's behavior).
export function buildCombinedProject(clips,{padding=1,fadeIn=0.5,fadeOut=0.5,silenceTrimSeconds=null,trackFadeIn=1,trackFadeOut=1,includeParts=[...PART_CATEGORIES,'other'],decodedAudio,ctx}={}){
 if(!clips.length)throw Error('Add at least one clip before building a combined project');
 const parts=new Set(includeParts);
 const project=makeProject();project.arrangements=[];project.sections=[];project.title='Combined chart';project.artist='';
 const warnings=[];
 const destinations=new Map(); // categoryForArrangement(sourceArr) -> {arr, tuningSignature}
 let cursor=0;const audioClips=[];
 clips.forEach((clip,clipIndex)=>{
  let start=clip.start;
  const buffer=decodedAudio?.get(clip);
  if(silenceTrimSeconds!=null&&buffer){
   const detected=detectLeadingSilence(buffer,start);
   start+=Math.max(0,detected-silenceTrimSeconds);
  }
  const padBefore=clipIndex===0?0:padding;
  cursor+=padBefore;
  const placedAt=cursor;
  let markersApplied=false;
  for(const sourceArr of clip.sourceProject.arrangements){
   if(sourceArr.readOnly||sourceArr._notationOnly||sourceArr.editorOnly)continue;
   if(!parts.has(categoryForArrangement(sourceArr)))continue;
   const key=categoryForArrangement(sourceArr);
   let destArr=destinations.get(key)?.arr;
   let compat=destArr?checkTuning(sourceArr,destArr):null;
   if(destArr&&compat.status==='incompatible'){
    const altKey=key+':alt:'+sourceArr.stringCount+':'+sourceArr.tuning.join(',')+':'+(sourceArr.capo||0);
    destArr=destinations.get(altKey)?.arr;
    if(destArr)compat=checkTuning(sourceArr,destArr);
    if(!destArr){
     destArr={...clone(sourceArr),id:uid(),name:sourceArr.name+' (alt tuning)',notes:[],chords:[],chord_templates:[],anchors:[],handshapes:[],phrases:[],tones:{base:sourceArr.tones?.base||'Clean',changes:[],definitions:{}}};
     project.arrangements.push(destArr);destinations.set(altKey,{arr:destArr});
     warnings.push(`"${sourceArr.name}" from ${clip.label} uses a different tuning than the main ${sourceArr.type} track; placed on its own "${destArr.name}" track instead of mixed in.`);
    }
    compat={status:'match',semitones:0};
   }
   if(!destArr){
    destArr={...clone(sourceArr),id:uid(),notes:[],chords:[],chord_templates:[],anchors:[],handshapes:[],phrases:[],tones:{base:sourceArr.tones?.base||'Clean',changes:[],definitions:{}}};
    project.arrangements.push(destArr);destinations.set(key,{arr:destArr});compat={status:'match',semitones:0};
   }
   const region=arrangementClip(clip.sourceProject,sourceArr.id,start,clip.end);
   if(!parts.has('vocals'))region.vocals=[];
   if(compat.status==='transpose'){
    const transposed=transposeClipboard(region,compat.semitones);
    if(!fitsFretRange(transposed,destArr)){
     warnings.push(`"${sourceArr.name}" from ${clip.label} could not be safely retuned (frets would go out of range); imported as-is - check it against "${destArr.name}"'s tuning.`);
    }
   }
   placeArrangementClip(project,destArr,region,placedAt,{semitones:compat.status==='transpose'?compat.semitones:0,includeMarkers:!markersApplied});
   markersApplied=true;
  }
  project.sections.push({name:clip.label,start_time:placedAt});
  cursor=placedAt+(clip.end-start);
  audioClips.push({buffer,start,end:clip.end,padBefore,fadeIn:clipIndex===0?0:fadeIn,fadeOut:clipIndex===clips.length-1?0:fadeOut});
 });
 project.sections.sort((a,b)=>a.start_time-b.start_time);
 project.duration=cursor;
 if(decodedAudio&&!audioClips.every(c=>c.buffer))warnings.push('One or more source songs had no backing audio to splice; the combined project was built without backing audio.');
 // Each source's own tempo map isn't preserved (notes keep their absolute
 // second-based times regardless, so playback stays correct) - this is a
 // generic beat grid wide enough to cover the combined duration, purely so
 // the measure/bar display and snap-to-beat editing have something valid to
 // show across the whole combined project.
 project.beats=extendGrid(makeProject().beats,Math.max(cursor,1),{trim:true});
 const result={project:normalizeProject(project),warnings:[...new Set(warnings)]};
 if(ctx&&audioClips.every(c=>c.buffer))result.audio=assembleCombinedAudio(ctx,audioClips,{trackFadeIn,trackFadeOut});
 return result;
}
