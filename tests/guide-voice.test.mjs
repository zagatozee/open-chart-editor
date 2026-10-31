import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GUIDE_VOICE_FAMILIES,guideVoiceSetting,guideRigAt,sourceGmIntent,resolveGuideVoice,guideVoiceRig,guideVoiceDTO,guideVoiceTimelineDTO,guideVoiceAtTimeline,guideHarmonics} from '../src/guide-voice.js';
const source=(gm,extra={})=>({id:'own',blocks:[{role:'source',intent:{kind:'instrument',gm},...extra}]});
test('all 128 zero-based programs map to the correct complete immutable coarse GM family',()=>{
 assert.equal(GUIDE_VOICE_FAMILIES.length,16);
 for(let program=0;program<128;program++){
  const family=GUIDE_VOICE_FAMILIES[Math.floor(program/8)];
  assert.equal(sourceGmIntent(source({program})).family,family.id);
  assert.deepEqual(guideVoiceSetting(family.id,{program}),{version:1,family:family.id,program});
  assert.ok(Object.isFrozen(family)&&Object.isFrozen(family.harmonics));
 }
 assert.throws(()=>guideVoiceSetting('piano',{program:73}),/belong/);
 for(const program of [-1,128,.5,NaN,'0'])assert.equal(sourceGmIntent(source({program})).supported,false);
});
test('simple original profiles provide distinguishable offline spectra/envelopes without asset references',()=>{
 const profiles=GUIDE_VOICE_FAMILIES.map(p=>JSON.stringify([p.harmonics,p.attack,p.decay,p.release]));assert.equal(new Set(profiles).size,16);
 for(const p of GUIDE_VOICE_FAMILIES){assert.ok(p.harmonics.every(Number.isFinite));assert.ok(p.attack>0&&p.release>0&&p.decay>=0);assert.ok(!JSON.stringify(p).includes('https:'));}
});
test('arbitrary instrument names never imply a guessed timbre; explicit per-part choice wins intentionally',()=>{
 const a={type:'keys',instrument:'Any user name',tones:{base_rig:'own'}},before=structuredClone(a);
 assert.equal(resolveGuideVoice(a).source,'native-unsupported');assert.deepEqual(a,before);
 delete a.tones;assert.equal(resolveGuideVoice(a).family,'piano');a.guideVoice=guideVoiceSetting('pipe',{program:73});
 const voice=resolveGuideVoice(a,{rigLibrary:{rigs:[source({program:0},{bypassed:true})]}});assert.equal(voice.source,'editor-override');assert.equal(voice.program,73);assert.equal(voice.profile.id,'pipe');
 assert.equal(resolveGuideVoice({type:'bass'}).program,32);assert.equal(resolveGuideVoice({type:'guitar'}).program,24);
 const future={type:'keys',guideVoice:{version:2,family:'future',opaque:{retain:1}}},original=structuredClone(future);assert.equal(resolveGuideVoice(future).silent,true);assert.deepEqual(future,original);
});
test('tone timeline accepts native t and model time with stable ties, and a change with no rig field keeps the rig already in effect',()=>{
 const tones={base_rig:'a',changes:[{t:3,name:'C',rig:'c'},{time:1,name:'B',rig:'b'},{time:3,name:'D',rig:'d'},{t:4,name:'Legacy'},{t:NaN,rig:'bad'}]},before=structuredClone(tones);
 assert.equal(guideRigAt(tones,0).rig,'a');assert.equal(guideRigAt(tones,1).rig,'b');assert.equal(guideRigAt(tones,3).rig,'d');
 // The change at t:4 has no `rig` field at all (an OCE-native tone edit, not a rig binding) —
 // matching FeedBack core's soundTimeline.rigAt, that keeps the rig already in effect ('d').
 assert.equal(guideRigAt(tones,4).rig,'d');assert.equal(guideRigAt(tones,0).warnings.length,1);assert.deepEqual(tones,before);
 assert.throws(()=>guideRigAt(tones,-1));
 const interleaved={base_rig:'a',changes:[{t:3,rig:'c'},{t:NaN},{t:1,rig:'b'}]};assert.equal(guideRigAt(interleaved,3).rig,'c');
 // An explicit empty-string rig, unlike an absent field, deliberately clears the binding.
 const cleared={base_rig:'a',changes:[{t:2,rig:''}]};assert.equal(guideRigAt(cleared,2).rig,null);assert.equal(guideRigAt(cleared,2).unboundChange,true);
 // At t:4 the carried-forward rig 'd' is still unresolved with no rigLibrary passed, so the
 // guide is silent for a different reason now (rig not found) rather than having no rig at all.
 assert.equal(resolveGuideVoice({type:'keys',tones},{time:4}).silent,true);
});
test('native source bypass is author mute, not fallback even with valid GM or unsupported realizations',()=>{
 const rig=source({program:73},{bypassed:true,realizations:[{engine:'soundfont',ref:'https://must-never-be-loaded.invalid/bank.sf2'}]}),before=structuredClone(rig);
 const voice=resolveGuideVoice({type:'keys',tones:{base_rig:'own'}},{rigLibrary:{rigs:[rig]}});assert.equal(voice.source,'native-gm');assert.equal(voice.silent,true);assert.equal(voice.profile,null);assert.deepEqual(rig,before);
});
test('unsupported native graph/source/intent and unresolved ids stay silent with actionable warnings',()=>{
 const unsupported=[{...source({program:0}),graph:{nodes:[],edges:[]}},{id:'own',blocks:[{role:'amp'}]},source(undefined),{id:'own',blocks:[{role:'source',intent:{gm:{program:1}}},{role:'source'}]}];
 for(const rig of unsupported){const voice=resolveGuideVoice({type:'keys',tones:{base_rig:'own'}},{rigLibrary:{rigs:[rig]}});assert.equal(voice.source,'native-unsupported');assert.equal(voice.silent,true);assert.ok(voice.warnings.length);}
 for(const rigs of [[],[source({program:1}),source({program:2})]]){const voice=resolveGuideVoice({type:'keys',tones:{base_rig:'own'}},{rigLibrary:{rigs}});assert.equal(voice.silent,true);assert.ok(voice.warnings.length);}
});
test('unavailable realizations fall back to GM without loading assets; effect chains are disclosed, never modified',()=>{
 const rig=source({program:73},{realizations:[{engine:'soundfont',format:'sf2',ref:'private/bank.sf2'}]});rig.blocks.push({role:'reverb',ext:{secret:'exact'}});const before=structuredClone(rig);
 const voice=resolveGuideVoice({type:'keys',tones:{base_rig:'own'}},{rigLibrary:{rigs:[rig]}});assert.equal(voice.family,'pipe');assert.equal(voice.source,'native-gm');assert.ok(voice.warnings[0].includes('not applied'));assert.deepEqual(rig,before);
});
test('percussion identity uses kit zero by default and remains separate from pitched profile',()=>{
 for(const kit of [undefined,0,8,16,24,127]){const intent=sourceGmIntent(source({percussion:true,...(kit===undefined?{}:{kit})}));assert.equal(intent.kit,kit??0);assert.equal(intent.percussion,true);}
 assert.equal(sourceGmIntent(source({percussion:true,kit:-1})).supported,false);
 assert.deepEqual(resolveGuideVoice({type:'drums',guideVoice:guideVoiceSetting('piano')}),{source:'drum-guide',profile:null,percussion:true,warnings:[]});
});
test('portable adapter returns a new source rig with explicit GM and no local audio implementation or source mutation',()=>{
 const setting=guideVoiceSetting('strings',{program:42}),before=structuredClone(setting),rig=guideVoiceRig(setting,{id:'own-new-guide',name:'Original strings guide'});
 assert.deepEqual(setting,before);assert.equal(rig.id,'own-new-guide');assert.deepEqual(rig.blocks,[{role:'source',intent:{kind:'instrument',family:'strings',gm:{program:42}}}]);assert.equal(rig.realizations,undefined);
 assert.equal(sourceGmIntent(rig).family,'strings');assert.throws(()=>guideVoiceRig(setting,{id:' padded '}));assert.throws(()=>guideVoiceRig({version:2,family:'strings',program:42},{id:'x'}));
});
test('legacy RS2014 named tone changes never imply a native source, and keep a bound rig playing instead of going silent',()=>{
 const arrangement={type:'keys',tones:{base:'Clean',changes:[{time:.5,name:'Drive'},{time:1,name:'Clean'}],definitions:{Clean:{opaque:true}}}};
 for(const time of [0,.5,1,2]){const voice=resolveGuideVoice(arrangement,{time});assert.equal(voice.source,'editor-default');assert.equal(voice.legacy,true);assert.equal(voice.profile,null);assert.equal(voice.silent,undefined);assert.deepEqual(voice.warnings,[]);assert.equal(guideVoiceDTO(voice),null);}
 assert.equal(guideVoiceTimelineDTO(arrangement),null);
 arrangement.tones.base_rig='original';const timeline=guideVoiceTimelineDTO(arrangement,{rigLibrary:{rigs:[{...source({program:73}),id:'original'}]}});
 // Neither legacy named change at .5 or 1 carries a `rig` field, so (matching FeedBack core)
 // the rig bound by base_rig keeps playing through both of them instead of the guide going
 // silent — a single timeline entry covers every time, since the resolved voice never changes.
 assert.deepEqual(guideVoiceAtTimeline(timeline,0),{version:1,family:'pipe',program:73});assert.deepEqual(guideVoiceAtTimeline(timeline,.5),{version:1,family:'pipe',program:73});assert.deepEqual(guideVoiceAtTimeline(timeline,1),{version:1,family:'pipe',program:73});
});
test('resolved minimal timeline follows native GM switches and strips all native opaque state',()=>{
 const a={type:'keys',tones:{base:'Own',base_rig:'a',changes:[{time:.5,rig:'b',name:'New',opaque:'private'}]}};
 const library={rigs:[{...source({program:0}),id:'a',ext:{private:'retained'}},{...source({program:73}),id:'b'}]},before=structuredClone({a,library});
 const timeline=guideVoiceTimelineDTO(a,{rigLibrary:library});assert.deepEqual(timeline,{version:1,changes:[{time:0,voice:{version:1,family:'piano',program:0}},{time:.5,voice:{version:1,family:'pipe',program:73}}]});assert.equal(JSON.stringify(timeline).includes('private'),false);assert.deepEqual({a,library},before);
});
test('shared harmonic coefficients are normalized, bounded and omit every harmonic at or above Nyquist',()=>{
 const profile=GUIDE_VOICE_FAMILIES.find(p=>p.id==='brass');
 const full=guideHarmonics(profile,440,48000);assert.ok(Math.abs(full.reduce((n,v)=>n+Math.abs(v),0)-1)<1e-12);
 const high=guideHarmonics(profile,2637,8000);assert.equal(high[0],1);assert.ok(high.slice(1).every(value=>value===0));
 const boundary=guideHarmonics(profile,2000,8000);assert.equal(boundary[1],0);assert.ok(guideHarmonics(profile,4000,8000).every(v=>v===0));assert.deepEqual(guideHarmonics(profile,NaN,8000),[]);
});
