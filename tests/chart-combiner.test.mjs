// Chart Combiner (issue #33): section picking, tuning compatibility,
// clip extraction/placement, leading-silence trim, and audio assembly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeProject,makeArrangement,makeNote} from '../src/model.js';
import {sourceSections,checkTuning,arrangementClip,placeArrangementClip,detectLeadingSilence,assembleCombinedAudio,buildCombinedProject,categoryForArrangement,PART_CATEGORIES} from '../src/chart-combiner.js';

function song({sections=[{name:'Intro',start_time:0},{name:'Solo',start_time:10}],duration=20}={}){
 const p=makeProject();p.duration=duration;p.sections=sections;
 const lead=makeArrangement('guitar');lead.name='Lead';lead.notes=[[0,0,3],[10,1,5],[11,1,7]].map(([t,s,f])=>makeNote(lead,t,s,f,.25));
 const bass=makeArrangement('bass');bass.name='Bass';bass.role='bass';bass.notes=[[0,0,1],[10,0,3]].map(([t,s,f])=>makeNote(bass,t,s,f,.25));
 p.arrangements=[lead,bass];
 return p;
}

test('sourceSections widens each section to the span it actually covers',()=>{
 const p=song();
 assert.deepEqual(sourceSections(p).map(s=>[s.name,s.start_time,s.end]),[['Intro',0,10],['Solo',10,20]]);
});

test('checkTuning: exact match, constant-semitone transpose, and incompatible',()=>{
 const a=makeArrangement('guitar'),b=makeArrangement('guitar');
 assert.deepEqual(checkTuning(a,b),{status:'match',semitones:0});
 const down=makeArrangement('guitar');down.tuning=down.tuning.map(()=>-2);
 assert.deepEqual(checkTuning(down,a),{status:'transpose',semitones:-2});
 const openish=makeArrangement('guitar');openish.tuning=[-2,-2,-2,-2,0,0];
 assert.deepEqual(checkTuning(openish,a),{status:'incompatible',semitones:0});
 const fourString=makeArrangement('bass');
 assert.deepEqual(checkTuning(fourString,a),{status:'incompatible',semitones:0});
});

test('arrangementClip/placeArrangementClip: markers only land once per clip across several arrangements',()=>{
 const source=song(),dest=makeProject();dest.arrangements=[];
 const destLead=makeArrangement('guitar');destLead.name='Lead';
 const destBass=makeArrangement('bass');destBass.name='Bass';destBass.role='bass';
 dest.arrangements=[destLead,destBass];dest.sections=[];
 const leadClip=arrangementClip(source,source.arrangements[0].id,0,20);
 const bassClip=arrangementClip(source,source.arrangements[1].id,0,20);
 placeArrangementClip(dest,destLead,leadClip,0,{includeMarkers:true});
 placeArrangementClip(dest,destBass,bassClip,0,{includeMarkers:false});
 assert.deepEqual(dest.sections.map(s=>s.name),['Intro','Solo']); // not duplicated per arrangement
 assert.equal(destLead.notes.length,3);
 assert.equal(destBass.notes.length,2);
});

test('placeArrangementClip re-frets notes when a constant-semitone transpose is requested',()=>{
 const source=song(),dest=makeProject();
 const destLead=makeArrangement('guitar');destLead.tuning=destLead.tuning.map(()=>0);
 dest.arrangements=[destLead];dest.sections=[];
 const clip=arrangementClip(source,source.arrangements[0].id,0,20);
 placeArrangementClip(dest,destLead,clip,0,{semitones:2});
 assert.deepEqual(destLead.notes.map(n=>n.fret),[5,7,9]);
});

test('detectLeadingSilence finds the first loud window, caps a fully silent buffer, and returns 0 with no lead-in',()=>{
 const sampleRate=1000;
 const make=samples=>({sampleRate,length:samples.length,numberOfChannels:1,getChannelData:()=>samples});
 const silentThenLoud=new Float32Array(5000);for(let i=3000;i<5000;i++)silentThenLoud[i]=0.9;
 assert.ok(Math.abs(detectLeadingSilence(make(silentThenLoud),0)-3)<0.05);
 const allSilent=new Float32Array(50000);
 assert.equal(detectLeadingSilence(make(allSilent),0,{maxSeconds:10}),10);
 const loudImmediately=new Float32Array(1000).fill(0.9);
 assert.equal(detectLeadingSilence(make(loudImmediately),0),0);
});

function fakeCtx(){return {createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{numberOfChannels:channels,length,sampleRate,getChannelData:i=>data[i]};}};}
function toneBuffer(sampleRate,seconds,amplitude=1){const data=new Float32Array(Math.round(seconds*sampleRate)).fill(amplitude);return{sampleRate,length:data.length,numberOfChannels:1,getChannelData:()=>data};}

test('assembleCombinedAudio places clips back to back with padding and crossfades at the joins',()=>{
 const ctx=fakeCtx(),sampleRate=1000;
 const clips=[
  {buffer:toneBuffer(sampleRate,2),start:0,end:2,padBefore:0,fadeIn:0,fadeOut:0.1},
  {buffer:toneBuffer(sampleRate,2),start:0,end:2,padBefore:0.5,fadeIn:0.1,fadeOut:0},
 ];
 const out=assembleCombinedAudio(ctx,clips);
 assert.equal(out.length,Math.round(4.5*sampleRate));
 const data=out.getChannelData(0);
 assert.ok(Math.abs(data[0]-1)<1e-6); // first clip starts at full amplitude (no track fade requested)
 const secondClipStart=Math.round(2.5*sampleRate);
 assert.ok(data[secondClipStart]<0.1); // second clip's own fade-in starts near silent
});

test('assembleCombinedAudio applies the whole-track fade in/out exactly once, at the very start and end',()=>{
 const ctx=fakeCtx(),sampleRate=1000;
 const clips=[
  {buffer:toneBuffer(sampleRate,1),start:0,end:1,padBefore:0,fadeIn:0,fadeOut:0},
  {buffer:toneBuffer(sampleRate,1),start:0,end:1,padBefore:0,fadeIn:0,fadeOut:0},
 ];
 const out=assembleCombinedAudio(ctx,clips,{trackFadeIn:0.2,trackFadeOut:0.2});
 const data=out.getChannelData(0);
 assert.ok(data[0]<0.1); // track fade-in at the very start
 assert.ok(Math.abs(data[Math.round(0.5*sampleRate)]-1)<1e-6); // mid first clip: full volume, no bleed from track fade
 assert.ok(data[data.length-1]<0.1); // track fade-out at the very end
});

test('buildCombinedProject: three clips with three distinct tones all survive, tagged and selectable',()=>{
 const make=(toneName)=>{
  const p=makeProject();p.duration=4;p.sections=[];
  const lead=makeArrangement('guitar');lead.name='Lead';lead.notes=[makeNote(lead,0,0,3,.25)];
  lead.tones={base:toneName,changes:[{time:0,name:toneName}],definitions:{[toneName]:{GearList:{Amp:{Key:'amp1',Type:'amp',KnobValues:{}}}}}};
  p.arrangements=[lead];return p;
 };
 const songA=make('Crunch'),songB=make('Clean'),songC=make('Lead boost');
 const clips=[
  {sourceProject:songA,label:'A - Full song',start:0,end:4},
  {sourceProject:songB,label:'B - Full song',start:0,end:4},
  {sourceProject:songC,label:'C - Full song',start:0,end:4},
 ];
 const {project}=buildCombinedProject(clips,{padding:0,fadeIn:0,fadeOut:0});
 const lead=project.arrangements.find(a=>a.name==='Lead');
 assert.deepEqual(Object.keys(lead.tones.definitions).sort(),['Clean','Crunch','Lead boost']);
 assert.equal(project.sections.length,3);
 assert.deepEqual(project.sections.map(s=>s.name),['A - Full song','B - Full song','C - Full song']);
});

test('buildCombinedProject: a differently-tuned source gets its own destination track with a warning, not mixed in',()=>{
 const main=makeProject();main.duration=2;main.sections=[];
 const mainLead=makeArrangement('guitar');mainLead.name='Lead';mainLead.notes=[makeNote(mainLead,0,0,3,.25)];
 main.arrangements=[mainLead];
 const alt=makeProject();alt.duration=2;alt.sections=[];
 const altLead=makeArrangement('guitar');altLead.name='Lead';altLead.tuning=[-2,-2,-2,-2,0,0];altLead.notes=[makeNote(altLead,0,0,3,.25)];
 alt.arrangements=[altLead];
 const {project,warnings}=buildCombinedProject([
  {sourceProject:main,label:'Main - Full song',start:0,end:2},
  {sourceProject:alt,label:'Alt - Full song',start:0,end:2},
 ],{padding:0,fadeIn:0,fadeOut:0});
 assert.equal(project.arrangements.length,2);
 assert.ok(project.arrangements.some(a=>a.name.includes('alt tuning')));
 assert.ok(warnings.some(w=>w.includes('different tuning')));
});

test('categoryForArrangement matches the folder-browser panel\'s own six categories',()=>{
 assert.equal(categoryForArrangement(makeArrangement('guitar')),'lead'); // role defaults to 'lead'
 const rhythm=makeArrangement('guitar');rhythm.role='rhythm';
 assert.equal(categoryForArrangement(rhythm),'rhythm');
 assert.equal(categoryForArrangement(makeArrangement('bass')),'bass');
 assert.equal(categoryForArrangement(makeArrangement('keys')),'piano');
 assert.equal(categoryForArrangement(makeArrangement('drums')),'drums');
});

test('buildCombinedProject: includeParts builds a Lead-only chart from a full multi-instrument source, vocals included',()=>{
 const p=makeProject();p.duration=4;p.sections=[];p.vocals=[{id:'v1',time:0,length:1,lyric:'la'}];
 const lead=makeArrangement('guitar');lead.name='Lead';lead.notes=[makeNote(lead,0,0,3,.25)];
 const bass=makeArrangement('bass');bass.name='Bass';bass.role='bass';bass.notes=[makeNote(bass,0,0,1,.25)];
 p.arrangements=[lead,bass];
 const clips=[{sourceProject:p,label:'Song - Full song',start:0,end:4}];
 const leadOnly=buildCombinedProject(clips,{padding:0,fadeIn:0,fadeOut:0,includeParts:['lead','vocals']});
 assert.deepEqual(leadOnly.project.arrangements.map(a=>a.name),['Lead']);
 assert.equal(leadOnly.project.vocals?.length,1);
 const everything=buildCombinedProject(clips,{padding:0,fadeIn:0,fadeOut:0,includeParts:[...PART_CATEGORIES,'other']});
 assert.deepEqual(everything.project.arrangements.map(a=>a.name).sort(),['Bass','Lead']);
});

test('categoryForArrangement falls back to a name-text check when role is missing entirely (real-world bug: a third-party FeedPak conversion omitting role merged a source\'s own Lead and Rhythm into one track)',()=>{
 const lead=makeArrangement('guitar');lead.name='Lead';delete lead.role;
 const rhythm=makeArrangement('guitar');rhythm.name='Rhythm';delete rhythm.role;
 assert.equal(categoryForArrangement(lead),'lead');
 assert.equal(categoryForArrangement(rhythm),'rhythm');
});

test('buildCombinedProject: a source whose arrangements have no role field keeps Lead and Rhythm as separate destination tracks',()=>{
 const p=makeProject();p.duration=4;p.sections=[];
 const lead=makeArrangement('guitar');lead.name='Lead';delete lead.role;lead.anchors=[{time:1,fret:3,width:4}];
 const rhythm=makeArrangement('guitar');rhythm.name='Rhythm';delete rhythm.role;rhythm.anchors=[{time:1,fret:3,width:4}];
 p.arrangements=[lead,rhythm];
 const {project}=buildCombinedProject([{sourceProject:p,label:'Song - Full song',start:0,end:4}],{padding:0,fadeIn:0,fadeOut:0});
 assert.deepEqual(project.arrangements.map(a=>a.name).sort(),['Lead','Rhythm']);
 const combinedArr=project.arrangements.find(a=>a.name==='Lead');
 assert.equal(combinedArr.anchors.length,1); // not merged with Rhythm's identical-looking anchor
});
