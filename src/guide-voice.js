/** Original offline guide-voice descriptions; no audio context, asset loading,
 * hardware or network access. These coarse synthesized families approximate
 * GM intent, not a sampled GM bank or physical instrument/R+ Workshop DSP.
 * Native evidence: local Feedpak 1.19 spec §§5.2,6.9,7.9 and rigs.schema.json.
 * A bypassed source is silent, not GM fallback; unknown effects/realizations
 * remain opaque. Only a simple serial source head can be interpreted here.
 * Explicit guideVoice is an editor audition override; it never rewrites source
 * tone bindings. Portable export is a separate explicit adapter operation.
 */
const definitions=[
 ['piano','Piano','sine',[1,.3,.12,.05],.003,2.3,.12],
 ['bell','Bells / mallets','sine',[1,.08,.45,.02,.18],.002,4,.22],
 ['organ','Organ','sine',[1,.55,.3,.2,.1],.008,0,.055],
 ['guitar','Plucked strings','triangle',[1,.3,.14,.06],.003,3.5,.08],
 ['bass','Bass','sine',[1,.25,.06],.006,2,.08],
 ['strings','Bowed strings','sawtooth',[1,.45,.25,.15,.08],.09,.2,.18],
 ['ensemble','Ensemble','sawtooth',[1,.25,.2,.1,.08],.12,.15,.25],
 ['brass','Brass','sawtooth',[1,.5,.33,.2,.1],.025,.35,.08],
 ['reed','Reeds','square',[1,.08,.38,.04,.16],.018,.3,.06],
 ['pipe','Flute / pipes','sine',[1,.08,.02],.035,.15,.09],
 ['synth-lead','Synth lead','square',[1,.05,.3,.02,.14],.005,.25,.07],
 ['synth-pad','Synth pad','triangle',[1,.22,.08],.2,.1,.4],
 ['synth-fx','Synth effects','sine',[1,.1,.4,.02,.28],.045,.6,.3],
 ['ethnic','Plucked folk strings','triangle',[1,.15,.4,.06,.12],.002,5,.13],
 ['percussive','Tuned percussion','sine',[1,.1,.5,.04,.25],.001,7,.05],
 ['sound-effects','Sound effects guide','square',[1,.1,.08,.04],.01,3,.1],
];
export const GUIDE_VOICE_FAMILIES=Object.freeze(definitions.map(([id,label,waveform,harmonics,attack,decay,release],index)=>Object.freeze({id,label,program:index*8,waveform,harmonics:Object.freeze(harmonics),attack,decay,release})));
const byFamily=new Map(GUIDE_VOICE_FAMILIES.map(profile=>[profile.id,profile]));
function programFamily(program){if(!Number.isInteger(program)||program<0||program>127)throw Error('Guide GM program must be an integer from 0 to 127');return GUIDE_VOICE_FAMILIES[Math.floor(program/8)];}
export function guideVoiceSetting(family,{program=byFamily.get(family)?.program}={}){
 if(!byFamily.has(family))throw Error('Choose an available offline guide voice family');
 if(programFamily(program).id!==family)throw Error('GM program does not belong to the selected guide family');
 return {version:1,family,program};
}
function explicit(setting){
 if(!setting||setting.version!==1)throw Error('Unsupported guide voice setting version');
 return guideVoiceSetting(setting.family,{program:setting.program});
}
/** Resolve public tone bindings at one chart attack. FeedBack core's own
 * soundTimeline.rigAt (settled for core #1033) keeps whichever rig was already
 * in effect across a tone change with no `rig` field, rather than unbinding
 * it; the guide matches that so auditioning a project in OCE does not go
 * silent at every change an OCE-native (non-rig) tone edit writes, when
 * FeedBack itself would keep playing. An explicit `rig` — including a
 * deliberately empty/non-string one an author wrote by hand — still takes
 * over, even to clear the binding; only an absent `rig` field carries the
 * prior value forward. Imported model time and native t are accepted;
 * equal-time ties use source order. Negative/nonfinite changes are ignored
 * with a disclosed warning.
 */
export function guideRigAt(tones,time=0){
 if(!Number.isFinite(time)||time<0)throw Error('Guide time must be nonnegative seconds');
 const warnings=[];let rig=typeof tones?.base_rig==='string'?tones.base_rig.trim():null;
 const changes=(Array.isArray(tones?.changes)?tones.changes:[]).map((change,index)=>({change,index,time:change?.time??change?.t}));
 const nativeVocabulary=!!tones&&Object.hasOwn(tones,'base_rig')||changes.some(row=>row.change&&Object.hasOwn(row.change,'rig'));
 for(const row of changes.filter(row=>!Number.isFinite(row.time)||row.time<0))warnings.push('Invalid tone-change time was not interpreted for guide audition');
 const valid=changes.filter(row=>Number.isFinite(row.time)&&row.time>=0).sort((a,b)=>a.time-b.time||a.index-b.index);
 for(const row of valid)if(row.time<=time&&Object.hasOwn(row.change,'rig'))rig=typeof row.change.rig==='string'?row.change.rig.trim():null;
 const unboundChange=!rig;
 if(unboundChange&&nativeVocabulary)warnings.push('Current legacy tone change has no portable rig binding');
 return {rig:rig||null,unboundChange,nativeVocabulary,warnings};
}
/** Resolve only a simple source-headed serial rig's GM floor. Unsupported
 * topology/source intent is reported, not guessed from a name or realized by
 * downloading the first soundfont/plugin URI. Bypassed head stays silent.
 */
export function sourceGmIntent(rig){
 if(!rig||!Array.isArray(rig.blocks))return {supported:false,reason:'Missing or invalid rig'};
 if(rig.graph)return {supported:false,reason:'Explicit rig graph is not interpreted by the guide'};
 const head=rig.blocks[0];
 if(head?.role!=='source'||rig.blocks.slice(1).some(block=>block?.role==='source'))return {supported:false,reason:'Guide requires one source block at the serial head'};
 if(head.bypassed===true)return {supported:true,silent:true,reason:'Source block is bypassed'};
 const gm=head.intent?.gm;
 if(!gm||typeof gm!=='object')return {supported:false,reason:'No GM fallback intent; native realizations are not loaded'};
 if(gm.percussion===true){const kit=gm.kit??0;return Number.isInteger(kit)&&kit>=0?{supported:true,percussion:true,kit}:{supported:false,reason:'Invalid GM percussion kit'};}
 try{const profile=programFamily(gm.program);return {supported:true,percussion:false,program:gm.program,family:profile.id};}catch{return {supported:false,reason:'Invalid or missing melodic GM program'};}
}
/** Result profile is read-only and suitable for an original oscillator or
 * harmonic renderer. Native GM selection is approximate at family granularity;
 * imported source realization/effects/automation are never claimed applied.
 */
export function resolveGuideVoice(arrangement,{rigLibrary=null,time=0}={}){
 if(!arrangement||typeof arrangement!=='object')throw Error('Choose a guide arrangement');
 if(arrangement.type==='drums')return {source:'drum-guide',profile:null,percussion:true,warnings:[]};
 if(arrangement.guideVoice!==undefined){
  try{const setting=explicit(arrangement.guideVoice);return {source:'editor-override',...setting,profile:byFamily.get(setting.family),warnings:[]};}
  catch(error){return {source:'editor-unsupported',silent:true,profile:null,warnings:[error.message]};}
 }
 const binding=guideRigAt(arrangement.tones,time),warnings=[...binding.warnings];
 if(binding.rig){
  const matches=(Array.isArray(rigLibrary?.rigs)?rigLibrary.rigs:[]).filter(rig=>typeof rig?.id==='string'&&rig.id.trim()===binding.rig);
  if(matches.length===1){
   const intent=sourceGmIntent(matches[0]);
   if(intent.supported){if(matches[0].blocks.length>1)warnings.push('Native rig effects/automation are retained but not applied by the offline guide');return {source:'native-gm',rig:binding.rig,...intent,profile:intent.family?byFamily.get(intent.family):null,warnings};}
   warnings.push(intent.reason);
  }else warnings.push(matches.length?'Ambiguous duplicate rig id; no native guide voice selected':'Referenced rig is unavailable; no native guide voice selected');
  return {source:'native-unsupported',rig:binding.rig,silent:true,profile:null,warnings};
 }
 if(binding.unboundChange&&binding.nativeVocabulary)return {source:'native-unsupported',silent:true,profile:null,warnings};
 const family=arrangement.type==='bass'?'bass':arrangement.type==='guitar'?'guitar':'piano';
 return {source:'editor-default',legacy:true,version:1,family,program:byFamily.get(family).program,profile:null,warnings};
}
/** Minimal resolved descriptor for the practice worker. No native libraries,
 * source tone state, asset URIs or arbitrary extension objects are transferred.
 * null preserves the pre-feature legacy guide exactly. */
export function guideVoiceDTO(voice){
 if(voice.silent||voice.percussion&&voice.source!=='drum-guide')return {version:1,silent:true};
 if(!voice.profile)return null;
 return {version:1,family:voice.profile.id,program:voice.program};
}
export function resolvedGuideVoiceDTO(dto){
 if(dto===null||dto===undefined)return {source:'editor-default',legacy:true,profile:null,warnings:[]};
 if(dto.version===1&&dto.silent===true)return {source:'resolved-worker',silent:true,profile:null,warnings:[]};
 const checked=explicit(dto);return {source:'resolved-worker',...checked,profile:byFamily.get(checked.family),warnings:[]};
}
/** Resolve at binding boundaries once on the editor thread. Only small known
 * voice descriptors and chart times cross to the worker, never raw rig data.
 * A wholly legacy/default part needs no extra DTO field. */
export function guideVoiceTimelineDTO(arrangement,{rigLibrary=null}={}){
 const first=guideRigAt(arrangement.tones,0);
 if(arrangement.guideVoice===undefined&&!first.nativeVocabulary)return null;
 const toneChanges=Array.isArray(arrangement.tones?.changes)?arrangement.tones.changes:[];
 const times=arrangement.guideVoice!==undefined?[0]:[...new Set([0,...toneChanges.map(change=>change?.time??change?.t).filter(time=>Number.isFinite(time)&&time>=0)])].sort((a,b)=>a-b);
 const changes=[];let previous;
 for(const time of times){const voice=guideVoiceDTO(resolveGuideVoice(arrangement,{rigLibrary,time})),key=JSON.stringify(voice);if(key!==previous){changes.push({time,voice});previous=key;}}
 return {version:1,changes};
}
export function guideVoiceAtTimeline(timeline,time){
 if(timeline===null||timeline===undefined)return null;
 if(timeline.version!==1||!Array.isArray(timeline.changes))throw Error('Unsupported resolved guide voice timeline');
 let lo=0,hi=timeline.changes.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(timeline.changes[mid].time<=time)lo=mid+1;else hi=mid;}
 return timeline.changes[lo-1]?.voice??null;
}
/** Normalized sine-harmonic coefficients shared by offline PCM and the live
 * PeriodicWave adapter. Coefficients at/above Nyquist are excluded; normalization
 * by absolute sum bounds the waveform to [-1,1] even near a cutoff. Frequency
 * may be the maximum of an authored pitch curve for a stable live voice bank.
 */
export function guideHarmonics(profile,frequency,sampleRate){
 if(!profile||!Number.isFinite(frequency)||frequency<=0||!Number.isFinite(sampleRate)||sampleRate<=0)return [];
 const raw=profile.harmonics.map((value,index)=>(index+1)*frequency<sampleRate/2?value:0),sum=raw.reduce((total,value)=>total+Math.abs(value),0);
 return sum>0?raw.map(value=>value/sum):raw.map(()=>0);
}
/** Explicit portable-export building block. Caller must allocate an unused id,
 * preserve the original opaque rigs.json bytes, create a NEW sidecar path, and
 * bind only this part. No legacy tone or native source object is mutated here.
 */
export function guideVoiceRig(setting,{id,name}={}){
 const checked=explicit(setting);
 if(typeof id!=='string'||!id.trim()||id!==id.trim())throw Error('Guide rig needs a nonblank exact id');
 if(name!==undefined&&(typeof name!=='string'||!name.trim()))throw Error('Guide rig name must be nonblank');
 return {id,name:name||byFamily.get(checked.family).label,blocks:[{role:'source',intent:{kind:'instrument',family:checked.family,gm:{program:checked.program}}}]};
}
