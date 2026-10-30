import {installOceLibraryAction,createLibraryRequestInbox,createLibraryOpenController,readOceLibrarySource} from './library-open.js';
import {planAnchorCoverage,applyAnchorCoverage} from './anchor-fit.js';
import {chordDiagram} from './chord-diagram.js';
import {EDITOR_COLORS,PIANO_PALETTES,pianoNoteColor,pianoPaletteId} from './piano-colors.js';
import {planZoneFit,applyZoneFit} from './zone-fit.js';
import {VocalTimeline} from './vocal-timeline.js';
import {combineProblem,findOverlaps,combineArrangements} from './combine.js';
import {sheetText,suggestSheet,syllables,reconcileSheet,TapSession,commitTaps,karaoke,lineOf,snapStarts,longLines,LINE_CHARACTERS} from './lyric-sync.js';
import {MAX_VOCAL_EVENTS,createVocalIndex,planVocalMove,planVocalResize,copyVocalSelection,pasteVocalSelection,createVocalPhrase} from './vocal-tools.js';
import {deriveDrumLayout,drumGuideCue} from './drum-layout.js';
import {parseGpaSync,gpaBeatMap,notesOnGrid} from './gpa-sync.js';
import {clone,uid,TECHNIQUES,SECTIONS,DRUMS,History,makeProject,demoProject,makeArrangement,normalizeProject,makeNote,notePitch,pitches as standardPitches,setStringOffset,beatAt,timeAt,snapTime,setTempo,applyGrid,shiftTimeline,extendGrid,setStringCount,chordFromSelection,matchingChordTemplate,updateChordTemplate,synchronizeChordVoicings,validate} from './model.js';
import {AudioEngine} from './audio.js';
import {LiveInput} from './live-input.js';
import {createAt5LiveEffect,prepareAt5Worklet} from './vst3-live-effect.js';
import {MidiAudition} from './midi-audition.js';
import {prepareMidiNoteAppender} from './midi-note-appender.js';
import {prepareToneEnvelope,toneEnvelopeStatus} from './tone-adaptive-rack.js';
import {SignalMeters,signalDbText} from './signal-meters.js';
import {GUIDE_VOICE_FAMILIES,guideVoiceSetting,resolveGuideVoice} from './guide-voice.js';
import {displayFret,parseFret,fretLimits,validCapo} from './fret-display.js';
import {transposeSelection} from './transpose.js';
import {ArrangementViewIndex} from './viewport.js';
import {moveStrings} from './string-move.js';
import {rangeForSelectedNotes,resizeSelectionEdges} from './selection-range.js';
import {openContextMenu} from './context-menu.js';
import {mountMenubar} from './menubar.js';
import {chooseProjectFile} from './open-dialog.js';
import {OrderedSaves} from './ordered-saves.js';
import {readFolderFiles,writeFolderTree} from './folder-files.js';
import {techniqueTags,techniqueEnabled,setTechniqueFlag} from './technique-tags.js';
import {manageArrangement} from './arrangements.js';
import {assignHands} from './piano-hands.js';
import {CountIn,planCountIn} from './count-in.js';
import {detectOnsets,suggestTempo,alignBeats,rampGrid,setMeter,addBeat,removeBeat} from './tempo.js';
import {readDraft,writeDraft} from './draft.js';
import {createRecentProjects} from './recent-projects.js';
import {findChartIssues} from './validation.js';
import {findOceIssues} from './oce-checks.js';
import {IssueFinder,issueTarget} from './issue-finder.js';
import {suggestChordNames} from './chord-names.js';
import {staveLayout,guessKey,keyFromSignature,spell,pitchAtStep,fretFor,drumStepPiece,drumPieceAt,layoutNotes,layoutRests,writtenNote,staveMetrics,drawStave,clefColumn,hitNote} from './stave-view.js';
import {readPreferences,writePreferences} from './preferences.js';
import {rollAxes,rollArrow,uprightRollContext} from './roll-geometry.js';
import {generateDifficultyLadder,snapshotDifficulty,switchDifficulty,addDifficulty,removeDifficulty,copyPhraseDifficulty,clearPhraseDifficulty} from './difficulty.js';
import {createQuantizer,resnapSelection,snapFraction} from './quantizer.js';
import {PracticeRenderer} from './render-controller.js';
import {copyRegion,clearRegion,pasteRegion,copySelection} from './region.js';
import {selectLike} from './select-like.js';
import {MidiRecorder,connectMidiInput} from './midi.js';
import {buildAndPlaytest,endPlaytest,removePreview} from './playtest.js';
import {insertChordZone,resizeChordZone,setChordZoneEnd,splitChordInstances,toggleChordStrum,deleteChordTemplate,chordZoneContents,moveChordZone,chordZoneStyle,setChordZoneStyle,applyDefaultChordName,chordStrumPresentation} from './chord-tools.js';
import {applySustainEdits,steppedSustain} from './sustain-policy.js';
import {adjustBendAtCursor} from './bend-tools.js';
import {drawLiveView,DEFAULT_LIVE_OPTIONS} from './live-view.js';
import {ACTIONS,PROFILES,PROFILE_IDS,GLOBAL_COMMANDS,baseCommand,comboFromEvent,displayCombo,buildKeymap,isStructural,BROWSER_RESERVED} from './keymaps.js';
import {generateFingerprintZones,removeFingerprintZones} from './fingerprint-zones.js';
import {SLOT_CATALOG,GEAR_CATALOG,gearsForSlot,loadGearCatalog,createTone,setGear,setKnob,importTone,exportTone,copyTone,allocateTone,removeTone,TonePreview,toneAuditionPlan} from './tone-rack.js';

const API='/api/plugins/open_chart_editor';
const COLORS=EDITOR_COLORS;
// New-project song details (as in pack_io); any other value was set by the user.
const DEFAULT_SONG_DETAILS={title:['','Untitled'],artist:['','Local author'],album:[''],year:[null,undefined,2026]};
const songYear=value=>Number.isInteger(value)&&value>=1000&&value<=9999?value:null;
function fillSongDetails(p,details={}){
 const filled=[];
 for(const [field,defaults]of Object.entries(DEFAULT_SONG_DETAILS)){
  let value=details?.[field];
  if(field==='year'){if(!Number.isInteger(value)||value<1000||value>9999||defaults.includes(value))continue;}
  else{if(typeof value!=='string'||defaults.includes(value.trim()))continue;value=value.trim().slice(0,256);}
  if(defaults.includes(p[field])){p[field]=value;filled.push(field);}
 }
 return filled;
}
// Colour follows the string, not its index: low E is always red. Strings below
// it (low B, then low F#) take the spare colours; strings above the sixth
// colour (extended bass highs) take whichever spare colour is left.
function stringColor(a,string){
 const e=Math.max(0,(a.basePitches||[]).indexOf(a.type==='bass'?28:40));
 if(string<e)return COLORS[Math.min(COLORS.length-1,5+e-string)];
 const slot=string-e;
 return COLORS[slot<6?slot:Math.min(COLORS.length-1,slot+e)];
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const noteName=p=>['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][((p%12)+12)%12]+(Math.floor(p/12)-1);
const seconds=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
const field=(label,id,value,type='text',extra='')=>`<label>${label}<input id="ws-${id}" type="${type}" value="${esc(value)}" ${extra}></label>`;
let retainedSession=null,acceptSaveCompletion=null;
const saveStates=new WeakMap(),orderedSaves=new OrderedSaves();

// Module-lifetime public action; whole-plugin upgrades remain page-reload-only.
const libraryRequestInbox=createLibraryRequestInbox();let pendingLibraryRequest=null,libraryRequestReceiver=null,libraryExplicitIntent=false;
const libraryCardRegistration=installOceLibraryAction(window.feedBack);
function receiveLibraryNavigation(event){const id=typeof event==='string'?event:event?.detail?.id||event?.id||event?.screen;if(!['open_chart_editor','plugin-open_chart_editor'].includes(id))return;const request=libraryRequestInbox.take(window.feedBack?.getNavParams?.());if(!request)return;libraryExplicitIntent=true;pendingLibraryRequest=request;libraryRequestReceiver?.();}
window.feedBack?.on?.('screen:changed',receiveLibraryNavigation);
if(document.getElementById('plugin-open_chart_editor')?.classList.contains('active'))receiveLibraryNavigation('plugin-open_chart_editor');

function mount(root){
 if(root.dataset.mounted)return;root.dataset.mounted='true';
 const $=id=>root.querySelector(`#ws-${id}`),on=(el,event,fn)=>el?.addEventListener(event,fn,{signal:abort.signal});
 const abort=new AbortController(),audio=new AudioEngine(),issueFinder=new IssueFinder();let issuePage=0,issueFilter='all';audio.disposers.add(()=>issueFinder.dispose());
 const signalMeters=new SignalMeters();
 const recentProjects=createRecentProjects();let currentRecentId=null;
 let fretConvention='relative',qualityMessage='Fast granular preview';
 let countInOptions={enabled:false,bars:1,beats:null};
 const countIn=new CountIn({audio,onTick:event=>{status(`Count-in ${event.index+1} / ${event.total}`);$('play').textContent='■';},onState:()=>updateClock()});
 let chordZoneOptions={lengthBeats:1,gutterBeats:0,fingerprintOnly:false},selectedChordTemplate=0,chordLibrarySort='created',selectedZoneIndex=null;
 let chordDrag=null,suppressChordClickUntil=0;
 let viewZoom={tab:110,tempo:110},timelineView='tab',laneScales={guitar:1,bass:1,keys:1,drums:1},rollOrientations={keys:'left',drums:'left'};
 let sustainOptions={clampNext:false,gutterEnabled:false,gutterBeats:.125},sustainProvenance=new WeakMap();
 // Keyboard profile, the user's per-profile changes and the 'each note on its own' option.
 // Mouse model: 'standard', or 'eof' (right-click adds/removes, wheel sets sustain, Ctrl+wheel the
 // fret, middle-click edits, left-click only selects).
 let mouseModel='standard',wheelCarry=0;
 let keyProfile='oce',keyOverrides={},techniqueToggleEach=false,insertHeld=false,insertUsed=false,keymapCache=null;
 const keymap=()=>{const overrides=keyOverrides[keyProfile]||{},key=keyProfile+JSON.stringify(overrides);if(keymapCache?.key!==key)keymapCache={key,...buildKeymap(keyProfile,overrides)};return keymapCache;};
 const keysFor=id=>keymap().byCommand.get(id)||[];
 let liveOptions={...DEFAULT_LIVE_OPTIONS,renderer:'oce'};
 let liveMonitorOptions={deviceId:'',engine:'software',tier:'max',frameCount:1024};
 // A FeedBack highway plugin drawing the live view (only inside FeedBack): its factory key,
 // the renderer, its canvas, the chart data it draws and the frame loop.
 let liveViz=null;
 let staveTheme='dark',showRests=true,staveMode='select',staveLength=1,staveHits=[],staveMetricsCache=null,staveKeyCache=null;
let history=new History(demoProject()),arrangementId=history.project.arrangements[0].id,view='tab',inspector='settings',bottom='errors',selection=new Set(),cursor=0,lane=0,lastFret=3,zoom=110,snap=4,tool='pointer',clipboard=[],drag=null,dirty=false,saveHandle=null,lastSaveFormat='json',exportOptions={},lastDestination='',tapTimes=[],waveform=null,loadedAudio=null,draftTimer=null;
 let toneImportGeneration=0,tempoImportGeneration=0,chartImportGeneration=0;
 let midiAppendScope=null,midiRenderFrame=null,midiRenderOwner=null;
 let midiUiPending=false,midiSetupPromise=null,recordStartGeneration=0,recordStartPending=false,transportStartGeneration=0,localStartPending=false;
 let click=false,guide=true,loop=false,ramp={enabled:false,startSpeed:0.75,endSpeed:1,duration:30},onsets=[],gridSuggestion=null,selectedTone=null,tonePreview=null,previewToneName=null,previewToneDefinition=null,previewToneArrangement=null,auditionSelectedTone=true,selectionRange=null,midiConnection=null,midiRecorder=null,midiRecording=false,midiAuditioning=false,midiConnectionGeneration=0,markerSelection=null,pianoLow=21,pianoHigh=108,invertStrings=false,preview=null;
 const midiCue=new MidiAudition({getState:()=>({enabled:guide&&audio.enabled.guide,pitchShift:audio.pitch,rigLibrary:project().rigLibrary,chartTime:audio.currentTime})});audio.disposers.add(()=>midiCue.dispose());
 const toneEffectOwners=new WeakMap();let previewAdaptiveState=null,toneDisclosurePending=false;
 let lyricMode='check',lyricSession=null,lyricPreview=null,lyricSuggestion=null,lyricOptions={scope:'rest',leadIn:2,latency:0};
 let vocalController=null,vocalUI={selection:[],scrollLeft:0},vocalClipboard=null,vocalPage=0,pendingVocalSelection=null,vocalSelectionRange=null;
 const liveInput=new LiveInput({audio,prepareEffect:async(context,options={})=>{if(options.engine==='at5-vst3')await prepareAt5Worklet(context);else await prepareLocalToneEffects(context);},createEffect:async(context,options={})=>{if(options.engine==='at5-vst3'){const{ name,tone }=localToneSelection();return createAt5LiveEffect(context,{...options,tone,toneName:name,onFailure:message=>{status(`AmpliTube live input: ${message}`,true);if(liveInput.active||liveInput.pending)liveInput.stop();},onStatus:message=>status(message),onToneStatus:(message,isWarning=false)=>status(message,isWarning)});}const effect=new TonePreview(context,{onStatus:tonePreviewStatus}),{a,tone}=localToneSelection();try{if(tone?.GearList)effect.setTone(tone);else effect.clearTone();toneEffectOwners.set(effect,{tone,arrangementId:a.id});return effect;}catch(error){effect.dispose();throw error;}},onState:()=>{if(root.isConnected&&root.dataset.mounted&&bottom==='mixer')renderBottom();}});
 const canvas=$('canvas'),scroll=$('timeline-scroll'),ctx=uprightRollContext(canvas.getContext('2d'),()=>bottomRoll());
 let connectedScroll={left:scroll.scrollLeft,top:scroll.scrollTop};
 const rememberScroll=()=>{if(root.isConnected&&!abort.signal.aborted)connectedScroll={left:scroll.scrollLeft,top:scroll.scrollTop};};
 mountMenubar(root,{signal:abort.signal,restoreFocus:canvas});
 canvas.tabIndex=0;canvas.setAttribute('aria-label','Arrangement timeline');let verticalSelectionAnchor=null,horizontalSelectionAnchor=null;
 let saveDestinations={},projectGeneration=0,openGeneration=0,activeAudioUrl=null,audioGeneration=0,validationProfile='feedpak',mainArrangementId=null,loopRegionDefined=false;
 let inspectorVisible=true,inspectorWidth=280,bottomHeight=155,bottomVisible=true,closeContextMenu=null,coverGeneration=0,shadeHands=false,pianoPalette='oce';
 abort.signal.addEventListener('abort',()=>closeContextMenu?.(),{once:true});
 // A footer tab brings a hidden lower panel back.
 function revealBottom(){if(!bottomVisible){bottomVisible=true;applyLayout();persistPreferences();draw();}}
 function applyLayout(){const aside=root.querySelector('.ws-inspector');aside.style.display=inspectorVisible?'':'none';aside.style.width=`${inspectorWidth}px`;$('inspector-divider').style.display=inspectorVisible?'':'none';$('bottom').style.height=`${bottomHeight}px`;$('bottom').style.display=$('bottom-divider').style.display=bottomVisible?'':'none';$('bottom-toggle').textContent=bottomVisible?'▾ Hide panel':'▴ Show panel';$('bottom-toggle').setAttribute('aria-expanded',String(bottomVisible));}
 for(const [id,axis]of [['inspector-divider','x'],['bottom-divider','y']]){
  const divider=$(id);let initial=null;
  on(divider,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();initial={x:e.clientX,y:e.clientY,width:inspectorWidth,height:bottomHeight};divider.setPointerCapture(e.pointerId);});
  on(divider,'pointermove',e=>{if(!initial)return;if(axis==='x')inspectorWidth=Math.max(200,Math.min(root.clientWidth*.6,initial.width+initial.x-e.clientX));else bottomHeight=Math.max(100,Math.min(root.clientHeight*.65,initial.height+initial.y-e.clientY));applyLayout();draw();});
  on(divider,'pointerup',e=>{initial=null;if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);});
  on(divider,'keydown',e=>{const direction=['ArrowLeft','ArrowUp'].includes(e.key)?1:['ArrowRight','ArrowDown'].includes(e.key)?-1:0;if(!direction)return;e.preventDefault();e.stopPropagation();if(axis==='x')inspectorWidth=Math.max(200,Math.min(root.clientWidth*.6,inspectorWidth+direction*10));else bottomHeight=Math.max(100,Math.min(root.clientHeight*.65,bottomHeight+direction*10));applyLayout();draw();});
 }
 const spacer=scroll.querySelector('[data-oce-timeline-spacer]')||document.createElement('div');spacer.dataset.oceTimelineSpacer='';spacer.style.height='1px';scroll.append(spacer);canvas.style.position='sticky';canvas.style.left='0';canvas.style.top='0';
 const chartOnlyActions=new Set(['tool','note','selectall','select-like','copy','paste','delete','marker-delete','selectphrase','selectmeasure','selectregion','selection-expand','selection-shrink','sustain-more','sustain-less','sustain-toggle','bend','bend-curve','fingerprints-generate','fingerprints-remove','handshape','gutter','zone-fit','anchor-fit','anchor','phrase','phrase-remove','section','chord','chord-zone','chord-fingerprint','chord-zone-cycle','chord-zone-hide','strum','chord-split','transpose-up','transpose-down','string-up','string-down','position-up','position-down','resnap','shift-left','shift-right']);
 const frettedActions=new Set(['bend','bend-curve','fingerprints-generate','fingerprints-remove','handshape','gutter','zone-fit','anchor-fit','anchor','chord','chord-zone','chord-fingerprint','chord-zone-cycle','chord-zone-hide','strum','chord-split','string-up','string-down','position-up','position-down']);
 const chartEditing=()=>!arrangement().readOnly&&!arrangement().locked&&(view==='tab'||view==='tempo');
 const chartCommandAllowed=name=>(!chartOnlyActions.has(name)||chartEditing())&&(!frettedActions.has(name)||['guitar','bass'].includes(arrangement().type));
 const project=()=>history.project;
 const retainedViews=new WeakMap();
 const arrangement=()=>{const raw=project().arrangements.find(a=>a.id===arrangementId)||project().arrangements[0];if(!raw.readOnly)return raw;let shown=retainedViews.get(raw);if(!shown){shown={...raw,notes:[],chords:[],chord_templates:[],anchors:[],handshapes:[],phrases:[],toneChanges:[],tones:{base:'Retained score',changes:[],definitions:{}}};retainedViews.set(raw,shown);}return shown;};
 const shownFret=value=>displayFret(value,arrangement().capo||0,fretConvention);
 const readFret=(value,allowUnused=false,minimum=0)=>parseFret(value,{capo:arrangement().capo||0,convention:fretConvention,allowUnused,minimum});
 const fretBounds=(minimum=0)=>{const {min,max}=fretLimits(arrangement().capo||0,fretConvention,minimum);return `min="${min}" max="${max}"`;};
 const fretCaption=()=>fretConvention==='physical'?'Physical fret':'Capo-relative fret';
 const editableNotes=()=>[...arrangement().notes,...arrangement().chords.flatMap(c=>c.notes||[])];
 const selected=()=>editableNotes().filter(n=>selection.has(n.id));
 const markerList=kind=>kind==='sections'?project().sections:kind==='tones'?arrangement().tones.changes:arrangement()[kind];
 const lockKey=a=>{const {locked,hidden,name,...rest}=a;return JSON.stringify(rest);};
 const change=(label,fn)=>{countIn.cancel();history.commit(label,p=>{for(const a of p.arrangements)if(a.locked&&a.difficulties?.length)snapshotDifficulty(a);const locked=new Map(p.arrangements.filter(a=>a.locked).map(a=>[a.id,[a.name,lockKey(a)]]));fn(p);for(const a of p.arrangements)if(a.difficulties?.length)snapshotDifficulty(a);for(const [id,[name,key]] of locked){const a=p.arrangements.find(x=>x.id===id);if(!a)throw Error(`${name} is locked; unlock it before deleting it`);if(a.locked&&lockKey(a)!==key)throw Error(`${a.name} is locked; Arrangement > Lock / unlock to edit it`);}});dirty=true;audio.setProject(project(),arrangement());syncProjectAudio();render();queueDraft();};
 const changeScope=(label,fn)=>{countIn.cancel();stopMidi();change(label,fn);};
 const status=(message,error=false)=>{$('status').textContent=message;$('status').title=message;$('status').style.color=error?'#ef8e80':'';};
 let errorRevision=0;
 const safe=fn=>async(...args)=>{try{return await fn(...args);}catch(e){errorRevision++;status(e.message,true);console.error(e);}};
 audio.onQualityStatus=event=>{
  if(!root.isConnected||abort.signal.aborted)return;qualityMessage=event.message||event.state;
  if($('preview-quality'))$('preview-quality').value=audio.quality;if($('quality-status'))$('quality-status').textContent=qualityMessage;
  status(qualityMessage,event.state==='error');updateClock();if(event.state==='fallback')persistPreferences();
 };
 const setCursor=(time,{keepSelectionAnchor=false}={})=>{if(midiRecording||midiAuditioning||localStartPending||recordStartPending)stopMidi();if(!keepSelectionAnchor)horizontalSelectionAnchor=null;countIn.cancel();cursor=Math.max(0,Math.min(project().duration,time));audio.seek(cursor);draw();updateClock();};
 let snapOptions={mode:'grid',swing:.5},onsetSourceGeneration=null;
 const onsetReady=()=>onsets.length>0&&!!audio.buffer&&onsetSourceGeneration===audio.decodeGeneration;
 const snapper=()=>{
  const key=`${history.stateId}|${snap}|${snapOptions.mode}|${snapOptions.swing}|${onsetReady()}`;
  if(snapper.key!==key||snapper.onsets!==onsets||snapper.history!==history){snapper.key=key;snapper.onsets=onsets;snapper.history=history;snapper.value=createQuantizer(project().beats,{division:snap,...snapOptions,onsets:onsetReady()?onsets:[]});}
  return snapper.value;
 };
 const quantize=time=>snapper()(time);
 let drumLayoutHistory=null,drumLayoutState=null,drumLayouts=new WeakMap();
 const drumLayout=(a=arrangement())=>{if(drumLayoutHistory!==history||drumLayoutState!==history.stateId){drumLayoutHistory=history;drumLayoutState=history.stateId;drumLayouts=new WeakMap();}if(!drumLayouts.has(a))drumLayouts.set(a,deriveDrumLayout(a));return drumLayouts.get(a);};
 const getNoteLane=n=>arrangement().type==='keys'?notePitch(arrangement(),n):arrangement().type==='drums'?drumLayout().indexOf(n):n.string;
 const laneInfo=()=>{const a=arrangement();if(a.type==='keys'){const [low,high]=splitActive()?fittedKeys(a):[pianoLow,pianoHigh];return Array.from({length:high-low+1},(_,i)=>bottomRoll()?low+i:high-i);}if(a.type==='drums')return drumLayout(a).ids.map((_,i)=>i);return Array.from({length:a.stringCount},(_,i)=>invertStrings?i:a.stringCount-1-i);};
 // All 88 keys (A0-C8) at least; notes beyond them widen the view. After a switch the
 // keyboard scrolls so this part's notes, or middle C, are centred.
 function focusPianoNotes(){
  if(arrangement().type!=='keys'||view!=='tab')return;
  const pitches=[...arrangement().notes,...(arrangement().chords||[]).flatMap(c=>c.notes||[])].map(n=>notePitch(arrangement(),n)).filter(Number.isFinite).sort((a,b)=>a-b);
  const y=yOf(pitches.length?pitches[pitches.length>>1]:60);
  if(Number.isFinite(y)){setLaneScroll(Math.max(0,y-axes().height/2));draw();}
 }
 function fitPianoRange(){if(arrangement().type!=='keys')return;pianoLow=Math.min(pianoLow,21);pianoHigh=Math.max(pianoHigh,108);requestAnimationFrame(focusPianoNotes);for(const n of arrangement().notes){const pitch=notePitch(arrangement(),n);pianoLow=Math.max(0,Math.min(pianoLow,pitch));pianoHigh=Math.min(127,Math.max(pianoHigh,pitch));}}
 const bottomRoll=()=>view==='tab'&&['keys','drums'].includes(arrangement().type)&&rollOrientations[arrangement().type]==='bottom'&&!splitActive();
 const axes=()=>rollAxes({bottom:bottomRoll(),width:scroll.clientWidth,height:scroll.clientHeight||500,scrollLeft:scroll.scrollLeft,scrollTop:scroll.scrollTop});
 const timeScroll=()=>axes().timeScroll,laneScroll=()=>axes().laneScroll;
 const setTimeScroll=value=>{scroll[bottomRoll()?'scrollTop':'scrollLeft']=Math.max(0,value);};
 const setLaneScroll=value=>{scroll[bottomRoll()?'scrollLeft':'scrollTop']=Math.max(0,value);};
 const pointerPoint=e=>{const r=canvas.getBoundingClientRect();return axes().logical(e.clientX-r.left,e.clientY-r.top);};
 const geometry=()=>{const bands=splitBands();if(bands){const band=bands.find(b=>b.id===arrangementId)||bands[0];return{left:112,top:band.top,row:band.row,lanes:band.lanes,height:Math.max(axes().height,bands.at(-1).bottom+20),width:axes().width,bands,band};}
  const lanes=laneInfo(),height=axes().height,strip=chordStripShown()?chordStripHeight():0,above=strip>0&&chordStrip.position==='above',below=strip>0&&!above?strip+30:0,top=(view==='tempo'?330:174)+(above?strip+8:0),baseRow=arrangement().type==='keys'?18:Math.max(26,Math.min(45,(height-top-40-below)/Math.max(lanes.length,1))),row=Math.max(arrangement().type==='keys'?10:18,Math.min(arrangement().type==='keys'?72:128,baseRow*(laneScales[arrangement().type]||1)));
  const g={left:112,top,row,lanes,height:Math.max(height,top+lanes.length*row+40+below),width:axes().width};
  if(strip)g.chordStrip={top:above?top-strip-6:top+lanes.length*row+30,height:strip,open:chordStrip.open,position:chordStrip.position};
  return g;};
 const xOf=t=>geometry().left+t*zoom-timeScroll();
 const timeOf=x=>(x-geometry().left+timeScroll())/zoom;
 const yOf=l=>{const g=geometry(),index=g.lanes.indexOf(l);return index<0?NaN:g.top+(index+0.5)*g.row;};
 const laneOf=y=>{const g=geometry();return g.lanes[Math.max(0,Math.min(g.lanes.length-1,Math.floor((y-g.top)/g.row)))];};
 // Piano keyboard in the fixed label band, in logical roll coordinates (lanes on
 // y, key depth on x), so both orientations share it. Lanes stay one semitone
 // each; white keys also cover half of each neighbouring black lane so they
 // meet edge to edge, and shorter black keys sit on top at the keyboard's back:
 // the far edge on the left layout, next to the roll on the bottom layout.
 const isBlackKey=p=>[1,3,6,8,10].includes(((p%12)+12)%12);
 function blackKeyDepth(width){return bottomRoll()?[width*.38,width]:[0,width*.62];}
 // Split view: several arrangements stacked on one timeline, each a full editor. The
 // active one takes clicks and keys; clicking another band makes it active.
 let splitIds=[],splitCache=null,paintingFor=null,chordStrip={visible:true,open:true,position:'below',upright:false};
 // While a band paints, the stack still follows the arrangement being edited (paintingFor).
 const splitBandIds=()=>{const editing=paintingFor??arrangementId;return view==='tab'?project().arrangements.filter(a=>!a.readOnly&&(a.id===editing||splitIds.includes(a.id))).map(a=>a.id):[];};
 const splitActive=()=>splitBandIds().length>1;
 function withArrangement(id,fn){const saved=arrangementId,outer=paintingFor;paintingFor??=saved;arrangementId=id;try{return fn();}finally{arrangementId=saved;paintingFor=outer;}}
 function bandIndex(a){draw.indexes??=new WeakMap();let index=draw.indexes.get(a);if(!index){index=new ArrangementViewIndex(a);draw.indexes.set(a,index);}return index;}
 // A keys part in a band shows only the range it plays (with a little room), at least an octave.
 function fittedKeys(a){const pitches=[...a.notes,...a.chords.flatMap(c=>c.notes||[])].map(n=>notePitch(a,n)).filter(Number.isFinite);if(!pitches.length)return [55,79];let low=Math.max(0,Math.min(...pitches)-2),high=Math.min(127,Math.max(...pitches)+2);while(high-low<12){if(low>0)low--;if(high<127)high++;}return [low,high];}
 function splitBands(){
  const ids=splitBandIds();if(ids.length<2)return null;
  const height=axes().height,key=[ids.join(','),history.stateId,height,JSON.stringify(laneScales),invertStrings].join('|');
  if(splitCache?.history===history&&splitCache.key===key)return splitCache.bands;
  const available=Math.max(140,(height-96)/ids.length),bands=[];let y=86;
  withArrangement(arrangementId,()=>{for(const id of ids){arrangementId=id;const a=arrangement(),lanes=laneInfo(),foot=['guitar','bass'].includes(a.type)?30:8,[low,high]=a.type==='keys'?[5,14]:a.type==='drums'?[12,30]:[16,36],fit=(available-18-foot)/Math.max(1,lanes.length),row=Math.max(low,Math.min(high,fit))*(laneScales[a.type]||1),band={id,labelY:y,top:y+18,row,lanes};band.bottom=band.top+lanes.length*row+foot;bands.push(band);y=band.bottom+4;}});
  splitCache={history,key,bands};return bands;
 }
 function focusBandAt(y){
  const g=geometry();if(!g.bands)return false;const band=g.bands.find(b=>y>=b.labelY&&y<b.bottom+4);if(!band||band.id===arrangementId)return false;
  countIn.cancel();stopMidi();arrangementId=band.id;selectedZoneIndex=null;selection.clear();selectionRange=null;markerSelection=null;lane=arrangement().type==='keys'?60:0;audio.setProject(project(),arrangement());render();return true;
 }
 function drawBandHeaders(g){
  ctx.font='11px Segoe UI';ctx.textBaseline='middle';
  for(const band of g.bands){const a=project().arrangements.find(x=>x.id===band.id),active=band.id===arrangementId;if(!a)continue;
   ctx.fillStyle=active?'#23384a':'#25262d';ctx.fillRect(0,band.labelY,g.width,17);ctx.fillStyle=active?'#3d9be0':'#3a3c46';ctx.fillRect(0,band.labelY,4,17);
   ctx.fillStyle=active?'#e8f1fa':'#aab1c0';ctx.fillText(`${a.name} · ${a.instrument&&a.instrument!==a.type?a.instrument:a.type}${active?' · editing':' · click to edit'}`,10,band.labelY+9);}
 }
 const markerKindAt=y=>splitActive()?(y>=57&&y<80?'sections':null):y>=56&&y<150?(y<80?'tones':y<103?'phrases':y<126?'sections':'anchors'):null;
 const chordStripShown=()=>view==='tab'&&chordStrip.visible&&['guitar','bass'].includes(arrangement().type)&&!splitActive();
 const chordStripHeight=()=>!chordStrip.open?16:chordStrip.upright?32+UPRIGHT_ROWS*10:34+Math.max(3,arrangement().stringCount-1)*8;
 const UPRIGHT_ROWS=6;
 // Chord diagrams beside the strings: one block per hand shape, and one per chord outside any
 // hand shape, as long as it lasts. The header names the frets the shape spans.
 const RPLUS_SHAPE_CODE=/^[X\d]+_[X\d]+$/i;
 function chordLabel(a,template,members=null){
  const named=template?.name||(RPLUS_SHAPE_CODE.test(template?.displayName||'')?'':template?.displayName);if(named)return named;
  const notes=members?.length?members:(template?.frets||[]).flatMap((fret,string)=>fret>=0?[{string,fret,techniques:{}}]:[]);
  return notes.length?suggestChordNames(a,notes,{limit:1})[0]||'':'';
 }
 function chordStripItems(a,start,end){
  const beats=project().beats,zones=[],items=[];
  a.handshapes.forEach((h,zone)=>{if(h.end_time>=start&&h.start_time<=end)zones.push({h,zone});});
  for(const {h,zone}of zones){const t=a.chord_templates[h.chord_id];if(t)items.push({start:h.start_time,end:h.end_time,frets:t.frets||[],fingers:t.fingers||[],name:chordLabel(a,t)||'Hand shape',zone});}
  const covered=time=>zones.some(({h})=>time>=h.start_time-1e-4&&time<h.end_time);
  const chords=a.chords.filter(c=>c.time>=start-8&&c.time<=end&&!covered(c.time)).sort((x,y)=>x.time-y.time);
  chords.forEach((c,i)=>{const t=a.chord_templates[c.chord_id],members=c.notes||[],frets=Array(a.stringCount).fill(-1);for(const n of members)frets[n.string]=n.fret;const length=Math.max(0,...members.map(n=>n.sustain||0)),stop=Math.min(chords[i+1]?.time??Infinity,c.time+Math.max(length,timeAt(beats,beatAt(beats,c.time)+1)-c.time));if(stop>=start)items.push({start:c.time,end:stop,frets:members.length?frets:t?.frets||frets,fingers:t?.fingers||[],name:chordLabel(a,t,members)||'Chord',chord:c});});
  return items.sort((x,y)=>x.start-y.start);
 }
 function drawChordStrip(g,xOf){
  const a=arrangement(),s=g.chordStrip,top=s.top;
  ctx.fillStyle='#18191e';ctx.fillRect(g.left,top,g.width-g.left,s.height);ctx.strokeStyle='#30313a';ctx.lineWidth=1;ctx.strokeRect(g.left,top+.5,g.width-g.left,s.height-1);
  ctx.font='10px Segoe UI';ctx.textBaseline='middle';
  const items=chordStripItems(a,timeOf(g.left),timeOf(g.width));
  for(const [index,item] of items.entries()){
   // Upright boxes keep one width: drawn outside the block's clip, into free space up to the next block.
   const x0=Math.max(g.left,xOf(item.start)),x1=Math.min(g.width,xOf(item.end)),free=Math.min(g.width,items[index+1]?xOf(items[index+1].start):g.width)-x0-10;if(x1<=x0+2)continue;
   const highlighted=item.zone!==undefined&&item.zone===selectedZoneIndex||item.chord&&(item.chord.notes||[]).some(n=>selection.has(n.id));
   const fretted=item.frets.filter(f=>f>0),low=fretted.length?Math.min(...fretted):0,high=fretted.length?Math.max(...fretted):0,span=fretted.length?high-low+1:0;
   ctx.fillStyle=highlighted?'#2f4d66':'#262b36';ctx.fillRect(x0+1,top+2,x1-x0-2,s.height-4);ctx.strokeStyle=highlighted?'#68b9ef':'#3d4656';ctx.strokeRect(x0+1.5,top+2.5,x1-x0-3,s.height-5);
   ctx.save();ctx.beginPath();ctx.rect(x0+2,top+2,x1-x0-4,s.height-4);ctx.clip();
   const room=x1-x0-14,anchor=(draw.cache?.arrangement===a?draw.cache:bandIndex(a)).anchorAt(item.start+1e-4);
   ctx.fillStyle='#d7dce7';ctx.fillText(`${item.name}${span?`${room>=90?' · fret ':' · '}${shownFret(low)}${span>1?'–'+shownFret(high):''}`:room>=90?' · open':''}`,x0+5,top+9);
   if(s.open&&!chordStrip.upright&&room>=34)drawChordDiagram(a,item,{x:x0+6,y:top+22,width:Math.min(130,room),height:s.height-30,low,high,anchor},g);
   ctx.restore();
   if(s.open&&chordStrip.upright&&free>=uprightWidth(a))drawUprightDiagram(a,item,{x:x0+6,y:top+24,height:s.height-30,low,high,anchor});
  }
 }
 // A small chord box drawn like the tab: strings across in their colours, frets down. The
 // shading is the fret-hand position (anchor) at that moment, what the lane highlight shows,
 // so the box covers the anchor's frets too, even ones the chord does not use, with a spare
 // fret either side so the highlighted band stands out.
 function drawChordDiagram(a,item,box,g){
  const {zone,base,count:columns}=diagramFrets(box);
  const order=g.lanes,rows=Math.max(1,order.length-1),gap=box.height/rows,nut=box.x+12,width=(box.width-14)/columns;
  if(zone){ctx.fillStyle='#3d8fd040';ctx.fillRect(nut+(zone[0]-base)*width,box.y-3,(zone[1]-zone[0]+1)*width,box.height+6);}
  ctx.strokeStyle='#59606e';ctx.lineWidth=1;
  for(let c=0;c<=columns;c++){const x=nut+c*width;ctx.lineWidth=c===0&&base===1?3:1;ctx.beginPath();ctx.moveTo(x,box.y-2);ctx.lineTo(x,box.y+box.height+2);ctx.stroke();}
  ctx.lineWidth=1;
  order.forEach((string,row)=>{const y=box.y+row*gap,fret=item.frets[string]??-1,color=stringColor(a,string);
   ctx.strokeStyle=color;ctx.globalAlpha=.7;ctx.beginPath();ctx.moveTo(nut,y);ctx.lineTo(nut+columns*width,y);ctx.stroke();ctx.globalAlpha=1;
   if(fret<0){ctx.fillStyle='#7d8496';ctx.fillText('×',box.x,y);}
   else if(fret===0){ctx.strokeStyle=color;ctx.beginPath();ctx.arc(box.x+4,y,3,0,Math.PI*2);ctx.stroke();}
   else{const x=nut+(fret-base+.5)*width,r=Math.max(2.5,Math.min(gap*.45,width*.4,6));ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();const finger=item.fingers[string];if(r>=4.5&&finger>=0){ctx.fillStyle='#14161b';ctx.textAlign='center';ctx.fillText(finger===0?'T':String(finger),x,y+.5);ctx.textAlign='left';}}});
 }
 // The frets a chord box shows: the chord and the anchor zone (the lane highlight), with a
 // spare fret either side; open position starts at the nut.
 function diagramFrets(box){
  const zone=box.anchor&&box.anchor.fret>0?[box.anchor.fret,box.anchor.fret+Math.max(1,box.anchor.width||4)-1]:null;
  const low=Math.min(box.high>0?box.low:Infinity,zone?.[0]??Infinity),high=Math.max(box.high,zone?.[1]??0);
  const base=!Number.isFinite(low)||high<=5?1:low-1;
  return {zone,base,count:Math.max(4,high-base+2)};
 }
 const uprightWidth=a=>(a.stringCount-1)*8+22;
 // A traditional upright chord box: strings down the page (low string on the left), frets
 // across, open / muted marks above the nut and the fret numbers on the right.
 function drawUprightDiagram(a,item,box){
  const {zone,base,count}=diagramFrets(box),rows=Math.max(UPRIGHT_ROWS,count),gap=box.height/rows,step=8,left=box.x+4,right=left+(a.stringCount-1)*step;
  if(zone){ctx.fillStyle='#3d8fd040';ctx.fillRect(left-4,box.y+(zone[0]-base)*gap,right-left+8,(zone[1]-zone[0]+1)*gap);}
  ctx.strokeStyle='#59606e';
  for(let r=0;r<=rows;r++){const y=box.y+r*gap;ctx.lineWidth=r===0&&base===1?3:1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}
  ctx.lineWidth=1;ctx.font='9px Segoe UI';ctx.textAlign='center';
  for(let string=0;string<a.stringCount;string++){
   const x=left+string*step,fret=item.frets[string]??-1,color=stringColor(a,string);
   ctx.strokeStyle=color;ctx.globalAlpha=.75;ctx.beginPath();ctx.moveTo(x,box.y);ctx.lineTo(x,box.y+rows*gap);ctx.stroke();ctx.globalAlpha=1;
   if(fret<0){ctx.fillStyle='#7d8496';ctx.fillText('×',x,box.y-5);}
   else if(fret===0){ctx.strokeStyle=color;ctx.beginPath();ctx.arc(x,box.y-5,2.5,0,Math.PI*2);ctx.stroke();}
   else if(fret>=base&&fret<base+rows){const y=box.y+(fret-base+.5)*gap,r=Math.min(4,gap*.42);ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}
  }
  ctx.textAlign='left';ctx.fillStyle='#aab5ca';
  for(let r=0;r<rows;r++)ctx.fillText(String(shownFret(base+r)),right+5,box.y+(r+.5)*gap);
  ctx.font='10px Segoe UI';
 }
 function drawChordStripLabel(g){const s=g.chordStrip;ctx.fillStyle='#aab5ca';ctx.font='10px Segoe UI';ctx.textBaseline='middle';ctx.fillText(`Chords ${s.open?'▾':'▸'}`,8,s.top+8);ctx.fillText('⟳',68,s.top+8);ctx.fillText(s.position==='above'?'⇣':'⇡',92,s.top+8);}
 function selectChordStripAt(t){
  const a=arrangement(),zone=a.handshapes.findLastIndex(h=>t>=h.start_time&&t<h.end_time);
  if(zone>=0){selectedZoneIndex=zone;selection.clear();inspector='chords';cursor=a.handshapes[zone].start_time;render();return;}
  const chord=a.chords.filter(c=>c.time<=t+1e-4).at(-1);if(chord){selection=new Set((chord.notes||[]).map(n=>n.id));cursor=chord.time;inspector='properties';render();}
 }
 function drawPianoKeyboard(g,visible){
  if(!visible.length)return;
  const width=g.left-2,step=bottomRoll()?g.row:-g.row,ref=visible[0],yOfPitch=p=>yOf(ref)+(p-ref)*step;
  const low=Math.min(...visible)-1,high=Math.max(...visible)+1,[back0,back1]=blackKeyDepth(width);
  ctx.save();ctx.beginPath();ctx.rect(0,g.top,width,g.lanes.length*g.row);ctx.clip();ctx.lineWidth=1;
  for(let p=low;p<=high;p++){
   if(isBlackKey(p))continue;
   const from=yOfPitch(p)-step/2-(isBlackKey(p-1)?step/2:0),to=yOfPitch(p)+step/2+(isBlackKey(p+1)?step/2:0);
   ctx.fillStyle=p===lane?'#9fd0f0':'#e6e8ee';ctx.fillRect(0,from,width,to-from);
   ctx.strokeStyle='#6f7480';ctx.strokeRect(0,from,width,to-from);
  }
  const inset=step*.1;
  for(let p=low;p<=high;p++)if(isBlackKey(p)){ctx.fillStyle=p===lane?'#278dc2':'#1d1f26';ctx.fillRect(back0,yOfPitch(p)-step/2+inset,back1-back0,step-2*inset);}
  ctx.font='10px Segoe UI';
  for(const p of visible){
   if(p%12!==0&&p!==lane)continue;
   const black=isBlackKey(p);ctx.fillStyle=black?'#fff':p===lane?'#0b3d5c':'#30343e';
   if(bottomRoll())ctx.fillText(noteName(p),black?(back0+back1)/2:10,yOfPitch(p),Math.max(8,Math.abs(step)*1.6));
   else{ctx.textAlign='right';ctx.fillText(noteName(p),black?back1-3:width-4,yOfPitch(p),width-8);ctx.textAlign='left';}
  }
  ctx.restore();
 }
 // A keyboard click picks the key drawn there: the front of a white key reaches
 // under half of each neighbouring black lane.
 function keyboardLaneAt(x,y){
  const l=laneOf(y),g=geometry();
  if(arrangement().type!=='keys'||!isBlackKey(l))return l;
  const [back0,back1]=blackKeyDepth(g.left-2);
  if(x>=back0&&x<=back1)return l;
  const step=bottomRoll()?g.row:-g.row,neighbour=l+((y-yOf(l))/step>0?1:-1);
  return g.lanes.includes(neighbour)?neighbour:l;
 }
 // Per-family view preference; keeps the same time in view across the flip.
 function setRollOrientation(value){const type=arrangement().type;if(!['keys','drums'].includes(type))return;const t=timeScroll();rollOrientations[type]=value==='bottom'?'bottom':'left';scroll.scrollLeft=0;scroll.scrollTop=0;draw();setTimeScroll(t);persistPreferences();draw();focusPianoNotes();if($('roll-orientation'))$('roll-orientation').value=rollOrientations[type];}
 function revealRollLane(){if(!bottomRoll())return;const g=geometry(),position=yOf(lane)-laneScroll();if(position<g.top)setLaneScroll(yOf(lane)-g.top-g.row/2);else if(position>axes().height-g.row)setLaneScroll(yOf(lane)-axes().height+g.row);}
 const notesForDraw=editableNotes;

 async function dialog(title,html,accept='Apply',{allowStateChanges=false}={}){
  if(abort.signal.aborted)return false;
  const d=$('dialog'),sourceHistory=history,sourceState=history.stateId,sourceGeneration=projectGeneration;
  $('dialog-title').textContent=title;$('dialog-content').innerHTML=html;$('dialog-submit').textContent=accept;
  d.returnValue='';d.showModal();return new Promise(resolve=>{
   let finished=false;
   const finish=accepted=>{if(finished)return;finished=true;d.removeEventListener('close',closed);d.removeEventListener('submit',submitted);d.removeEventListener('cancel',escaped);abort.signal.removeEventListener('abort',cancelled);if(accepted&&(abort.signal.aborted||history!==sourceHistory||(!allowStateChanges&&history.stateId!==sourceState)||projectGeneration!==sourceGeneration)){accepted=false;if(!abort.signal.aborted){errorRevision++;status('The project changed while this dialog was open. Reopen the command for the current project.',true);}}resolve(accepted);};
   const closed=()=>{if(!d.open)finish(d.returnValue==='ok');},cancelled=()=>{finish(false);if(d.open)d.close('cancel');};
   const submitted=event=>{event.preventDefault();const value=event.submitter?.value||'ok';d.close(value);finish(value==='ok');},escaped=event=>{event.preventDefault();d.close('cancel');finish(false);};
   d.addEventListener('close',closed);d.addEventListener('submit',submitted);d.addEventListener('cancel',escaped);abort.signal.addEventListener('abort',cancelled,{once:true});
  });
 }
 async function confirmReplace(){return !dirty||await dialog('Replace unsaved project?','<p>This project has unsaved authoring changes. Save an editable JSON project before replacing it if you want to keep those changes.</p>','Replace project');}
 async function phraseDifficultyDialog(){
  const a=arrangement(),levels=a.difficulties?.length?a.difficulties.map(l=>l.difficulty).sort((x,y)=>x-y):[a.activeDifficulty??0],phrases=a.phrases||[];
  if(!phrases.length)throw Error('Create a phrase before editing its difficulty content');
  const selectedPhrase=phrases.map((p,index)=>({p,index})).filter(({p})=>p.time<=cursor).sort((x,y)=>y.p.time-x.p.time)[0]?.index??0;
  const options=value=>levels.map(level=>`<option value="${level}" ${level===value?'selected':''}>Level ${level}</option>`).join('');
  const pending=dialog('Edit phrase difficulty',`<label>Operation<select id="ws-phrase-dd-operation"><option value="copy">Copy authored content between levels</option><option value="clear">Clear authored content at one level</option></select></label><label>Phrase<select id="ws-phrase-dd-index">${phrases.map((p,i)=>`<option value="${i}" ${i===selectedPhrase?'selected':''}>${esc(p.name||'Phrase '+(i+1))} - ${seconds(p.time)}</option>`).join('')}</select></label><label id="ws-phrase-dd-source-label">Source<select id="ws-phrase-dd-source">${options(a.activeDifficulty??levels.at(-1))}</select></label><label>Destination<select id="ws-phrase-dd-target">${options(levels.find(l=>l!==(a.activeDifficulty??levels.at(-1)))??levels[0])}</select></label><p class="ws-muted">Replaces notes, chords, anchors and hand shapes whose attacks belong to this phrase at the destination level. Sustained tails are retained; overlapping hand shapes are clipped at its boundaries. Other phrases and the source level remain unchanged. Add levels in the Difficulty menu first. This is an original authoring operation.</p>`);
  on($('phrase-dd-operation'),'change',()=>{$('phrase-dd-source-label').hidden=$('phrase-dd-operation').value==='clear';});
  if(!await pending)return;
  const operation=$('phrase-dd-operation').value,phraseIndex=Number($('phrase-dd-index').value),sourceDifficulty=Number($('phrase-dd-source').value),targetDifficulty=Number($('phrase-dd-target').value);
  change(operation==='copy'?'Copy phrase difficulty':'Clear phrase difficulty',p=>{const options={phraseIndex,sourceDifficulty,targetDifficulty,difficulty:targetDifficulty,duration:p.duration};if(operation==='copy')copyPhraseDifficulty(arrangement(),options);else clearPhraseDifficulty(arrangement(),options);selection.clear();selectionRange=null;markerSelection=null;});
  status(`${operation==='copy'?'Copied':'Cleared'} phrase content at level ${targetDifficulty}`);
 }
 // GPA bars only line up with the notes when the current map is the score's own.
 function gpaBeatsForProject(points){
  const fit=notesOnGrid(project());
  if(fit<.5)throw Error(`This project's beat map does not match its notes (${Math.round(fit*100)}% on the grid), so a GoPlayAlong sync would time the wrong bars. Use Tempo → Restore score beat map first.`);
  return gpaBeatMap(project().beats,points);
 }
 // Rebuild the beat map from the Guitar Pro score kept in the project. Notes
 // stay where they are: they were imported in score time. Applied only when the
 // score map fits the notes better than the current one.
 async function restoreScoreTempoMap(){
  const source=project()._import;
  if(source?.format!=='guitarpro'||!source.source)throw Error('This project has no retained Guitar Pro score');
  const owner=history,state=history.stateId,form=new FormData();
  form.append('file',new File([Uint8Array.from(atob(source.source),c=>c.charCodeAt(0))],source.filename||'score.gpx'));
  status('Reading the score beat map…');
  const response=await fetch(`${API}/load`,{method:'POST',body:form});if(!response.ok)throw Error(await response.text());
  const beats=(await response.json()).project.beats;
  if(history!==owner||history.stateId!==state)return;
  const before=notesOnGrid(project()),after=notesOnGrid({...project(),beats});
  if(after<=before){status(`The score beat map does not fit these notes better (${Math.round(after*100)}% vs ${Math.round(before*100)}% on the grid); nothing changed`,true);return;}
  change('Restore score beat map',p=>{p.beats=clone(beats);p.duration=Math.max(p.duration,beats.at(-1).time);});
  status(`Score beat map restored: ${Math.round(after*100)}% of notes on the grid (was ${Math.round(before*100)}%)`);
 }
 // A GPA sync file came with the score: let the user choose whether its beat
 // map replaces the score's own. Notes keep their musical positions either way.
 async function offerGpaBeatMap(){
  const {source,xml}=project()._gpaSync;let beats;
  try{beats=gpaBeatsForProject(parseGpaSync(xml).points);}catch(error){status(`GPA sync in ${source} not used: ${error.message}`,true);return;}
  const html=`<p>${esc(source)} is a Guitar Pro audio sync for this score. It times every bar to the song audio.</p><label><input type="radio" name="ws-gpa-choice" id="ws-gpa-use" checked>Use beat map from import (GoPlayAlong sync)</label><label><input type="radio" name="ws-gpa-choice" id="ws-gpa-skip">Do not import beat map (keep the existing beat map)</label><p class="ws-muted">First beat moves to ${beats[0].time.toFixed(3)} s. You can undo this, or apply it later from Tempo → Import beat map… or by right-clicking Tempo → Import beat map from file and choosing the same .xml file.</p>`;
  if(!await dialog('GoPlayAlong beat map',html,'Continue')||!$('gpa-use').checked){status('Kept the existing beat map');return;}
  change('Use GoPlayAlong beat map',p=>applyGrid(p,beats,true));
  status(`Beat map from ${source}: ${beats.length} beats timed to the audio`);
 }
 // Slide the whole beat map and chart by `offset` seconds as one undoable step.
 function shiftBeatMap(offset){
  if(!Number.isFinite(offset)||Math.abs(offset)<1e-6)return;
  try{shiftTimeline(clone(project()),offset);}catch(error){status(error.message,true);return;}
  let result;change('Shift beat map',p=>{result=shiftTimeline(p,offset);});
  status(`Moved the beat map and chart ${offset<0?'earlier':'later'} by ${Math.abs(offset).toFixed(3)} s`+(result?.removedBeats?`; removed ${result.removedBeats} lead-in beats before 0 s`:''));
 }
 // Bars are counted from the map's downbeats; default to the first bar with notes.
 async function tempoShiftDialog(){
  const beats=project().beats,bars=beats.filter(b=>b.measure>=0).map(b=>b.time);
  const owners=project().arrangements.flatMap(a=>[a,...a.difficulties||[]]);
  const starts=owners.flatMap(o=>[...(o.notes||[]).map(n=>n.time),...(o.chords||[]).map(c=>c.time)]);
  const firstNote=starts.length?Math.min(...starts):0,firstBar=Math.max(1,bars.filter(t=>t<=firstNote+1e-6).length);
  const html=`<label>Shift<select id="ws-shift-mode"><option value="bar">Move a bar to a time</option><option value="seconds">Move by seconds</option></select></label>${field('Bar','shift-bar',firstBar,'number',`min="1" max="${bars.length}" step="1"`)}${field('Starts at (seconds)','shift-target',0,'number','step="0.001"')}${field('Move by (seconds, negative = earlier)','shift-seconds',0,'number','step="0.001"')}<p id="ws-shift-preview" class="ws-muted"></p><p class="ws-muted">Notes, chords, sections, phrases, anchors, tone changes and lyrics move with the map. Beats moved before 0 s are removed; the shift is refused if notes would move before 0 s. Tip: Shift-drag a beat marker in the Tempo view to slide the whole map.</p>`;
  const offset=()=>$('shift-mode').value==='bar'?Number($('shift-target').value)-(bars[Number($('shift-bar').value)-1]??NaN):Number($('shift-seconds').value);
  const pending=dialog('Shift beat map',html);
  const preview=()=>{const value=offset(),bar=$('shift-mode').value==='bar';for(const id of ['shift-bar','shift-target'])$(id).closest('label').style.display=bar?'':'none';$('shift-seconds').closest('label').style.display=bar?'none':'';
   if(!Number.isFinite(value)){$('shift-preview').textContent='Choose a bar between 1 and '+bars.length;return;}
   if(Math.abs(value)<1e-6){$('shift-preview').textContent='No change: that bar already starts there';$('shift-preview').style.color='';return;}
   try{const r=shiftTimeline(clone(project()),value);$('shift-preview').textContent=`Everything moves ${value<0?'earlier':'later'} by ${Math.abs(value).toFixed(3)} s`+(r.removedBeats?`; ${r.removedBeats} lead-in beats before 0 s are removed`:'');$('shift-preview').style.color='';}
   catch(error){$('shift-preview').textContent=error.message;$('shift-preview').style.color='#ef8e80';}};
  for(const id of ['shift-mode','shift-bar','shift-target','shift-seconds'])on($(id),'input',preview);
  preview();
  if(await pending)shiftBeatMap(offset());
 }
 // Name source-specific drum lanes, or move every hit in a lane onto a kit piece.
 // One undoable step; the original import snapshot keeps the source lane IDs.
 async function drumLanesDialog(){
  const a=arrangement();if(a.type!=='drums')return;
  const layout=drumLayout(a),custom=layout.lanes.filter(item=>!item.canonical);
  if(!custom.length){await dialog('Drum lanes','<p>Every hit in this arrangement already uses a standard kit piece.</p>','Close');return;}
  const pieces=DRUMS.map(id=>`<option value="${esc(id)}">${esc(layout.labelFor(id))}</option>`).join('');
  const hits=new Map();
  for(const note of [...a.notes,...(a.chords||[]).flatMap(c=>c.notes||[])])hits.set(note.piece,(hits.get(note.piece)||0)+1);
  const rows=custom.map((item,i)=>`<fieldset class="ws-drum-lane"><legend>${esc(item.id)} · ${hits.get(item.id)||0} hit${hits.get(item.id)===1?'':'s'}</legend>${field('Label',`lane-name-${i}`,item.label,'text','maxlength="64"')}<label>Map hits to<select id="ws-lane-map-${i}"><option value="">Keep as its own lane</option>${pieces}</select></label></fieldset>`).join('');
  if(!await dialog('Drum lanes',`<p>Label each source lane, or map all of its hits to a standard kit piece. Velocity, ghost, flam and choke stay on each hit.</p>${rows}`))return;
  const edits=custom.map((item,i)=>({id:item.id,label:$(`lane-name-${i}`).value.trim(),target:$(`lane-map-${i}`).value}));
  changeScope('Edit drum lanes',p=>{
   const part=p.arrangements.find(x=>x.id===a.id),kit=(part._wire??={}).kit??=[];
   const moves=new Map(edits.filter(e=>e.target).map(e=>[e.id,e.target]));
   for(const owner of [part,...(part.difficulties||[])])
    for(const note of [...(owner.notes||[]),...(owner.chords||[]).flatMap(c=>c.notes||[])])if(moves.has(note.piece))note.piece=moves.get(note.piece);
   part._wire.kit=kit.filter(entry=>!moves.has(entry.id));
   for(const edit of edits.filter(e=>!e.target&&e.label)){
    const entry=part._wire.kit.find(x=>x.id===edit.id);
    if(entry)entry.name=edit.label;else part._wire.kit.push({id:edit.id,name:edit.label});
   }
   selection.clear();
  });
  status(`Updated ${edits.length} drum lane${edits.length===1?'':'s'}`);
 }
 // Arrangement > Combine: choose parts and their order, name a tone for each, review
 // overlaps and decide each one, then build one chart (src/combine.js).
 async function combineDialog(){
  const a=arrangement(),candidates=project().arrangements.filter(x=>x.type===a.type&&!x.editorOnly&&!x.readOnly);
  if(candidates.length<2)throw Error(`Combine needs at least two ${a.type} arrangements`);
  const time=t=>`${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')}`;
  const rows=candidates.map((x,i)=>`<tr><td><input type="checkbox" data-combine-id="${esc(x.id)}" ${x.hidden?'':'checked'} aria-label="Include ${esc(x.name)}"></td><td><input type="number" data-combine-order="${esc(x.id)}" min="1" max="${candidates.length}" value="${i+1}" aria-label="Priority of ${esc(x.name)}"></td><td>${esc(x.name)}${x.hidden?' <span class="ws-muted">(hidden)</span>':''}${x.locked?' <span class="ws-muted">(locked)</span>':''}</td><td><input data-combine-tone="${esc(x.id)}" value="${esc(x.name)}" maxlength="64" aria-label="Tone name for ${esc(x.name)}"></td></tr>`).join('');
  const html=`<p>Combine parts played by one player into a single chart. Each part gets its own tone; a tone change is placed wherever the playing part switches. The original arrangements are not changed.</p><table class="ws-combine"><thead><tr><th>Use</th><th>Priority</th><th>Arrangement</th><th>Tone name</th></tr></thead><tbody>${rows}</tbody></table><p class="ws-muted">Priority 1 wins overlaps by default. All parts need the same instrument, tuning and capo, and a single difficulty level.</p>${field('Name of the combined arrangement','combine-name',`${a.name} combined`,'text','maxlength="128"')}<label><input type="checkbox" id="ws-combine-hide" checked> Hide the source arrangements afterwards</label><div><button type="button" id="ws-combine-check">Check overlaps</button></div><div id="ws-combine-overlaps" class="ws-combine-overlaps"></div>`;
  const pending=dialog('Combine arrangements',html,'Combine');
  let overlaps=null,checkedIds=null;
  const chosen=()=>[...root.querySelectorAll('[data-combine-id]:checked')].map(el=>el.dataset.combineId).sort((x,y)=>Number(root.querySelector(`[data-combine-order="${CSS.escape(x)}"]`).value)-Number(root.querySelector(`[data-combine-order="${CSS.escape(y)}"]`).value));
  const label=id=>esc(project().arrangements.find(x=>x.id===id)?.name||id);
  const check=()=>{
   const ids=chosen(),box=$('combine-overlaps'),problem=combineProblem(project(),ids);overlaps=null;checkedIds=null;
   if(problem){box.innerHTML=`<p class="ws-error">${esc(problem)}</p>`;$('dialog-submit').disabled=true;return;}
   overlaps=findOverlaps(project(),ids);checkedIds=ids.join('\n');$('dialog-submit').disabled=false;
   if(!overlaps.length){box.innerHTML='<p>No overlaps: the parts never play at the same time.</p>';return;}
   const kind=o=>o.kind==='duplicate'?'Same notes in both':o.clash?'Different notes on the same string':o.sameString?'Same string, sustains overlap':'Different notes';
   const options=o=>o.sources.map(id=>`<option value="keep:${esc(id)}" ${o.decision==='keep:'+id?'selected':''}>Keep ${label(id)}</option>`).join('')+(o.clash?'':'<option value="both">Keep both</option>');
   box.innerHTML=`<p>${overlaps.length} overlap${overlaps.length===1?'':'s'} (${overlaps.filter(o=>o.kind==='duplicate').length} identical). Each is highlighted on the combined chart and listed in the Error Finder until you clear them.</p><label>Set all to<select id="ws-combine-all"><option value="">…</option><option value="priority">Keep the higher-priority part</option><option value="both">Keep both where possible</option></select></label><table class="ws-combine"><thead><tr><th>Time</th><th>Parts</th><th>What overlaps</th><th>Decision</th></tr></thead><tbody>${overlaps.slice(0,300).map(o=>`<tr><td>${time(o.start)}–${time(o.end)}</td><td>${o.sources.map(label).join(', ')}</td><td>${kind(o)}</td><td><select data-combine-decision="${o.id}">${options(o)}</select></td></tr>`).join('')}</tbody></table>${overlaps.length>300?`<p class="ws-muted">The first 300 are listed; the rest use the default (keep the higher-priority part) or the Set all choice.</p>`:''}`;
   on($('combine-all'),'change',e=>{for(const select of root.querySelectorAll('[data-combine-decision]')){const o=overlaps.find(x=>x.id===select.dataset.combineDecision);select.value=e.target.value==='both'&&!o.clash?'both':'keep:'+o.sources[0];}});
  };
  on($('combine-check'),'click',safe(async()=>check()));
  for(const input of root.querySelectorAll('[data-combine-id],[data-combine-order]'))on(input,'change',()=>{overlaps=null;$('combine-overlaps').innerHTML='<p class="ws-muted">Selection changed: Check overlaps again.</p>';});
  if(!await pending)return;
  const ids=chosen();if(!overlaps||checkedIds!==ids.join('\n'))check();if(!overlaps)throw Error(combineProblem(project(),ids)||'Check overlaps first');
  const all=$('combine-all')?.value,decisions={};
  for(const o of overlaps){const select=root.querySelector(`[data-combine-decision="${o.id}"]`);decisions[o.id]=select?select.value:all==='both'&&!o.clash?'both':o.decision;}
  const tones=Object.fromEntries(ids.map(id=>[id,root.querySelector(`[data-combine-tone="${CSS.escape(id)}"]`).value]));
  const name=$('combine-name').value.trim()||`${a.name} combined`,hide=$('combine-hide').checked;let report;
  changeScope('Combine arrangements',p=>{
   const result=combineArrangements(p,ids,{name,tones,decisions,overlaps});report=result.report;
   const at=Math.max(...ids.map(id=>p.arrangements.findIndex(x=>x.id===id)));p.arrangements.splice(at+1,0,result.arrangement);
   if(hide)for(const id of ids)p.arrangements.find(x=>x.id===id).hidden=true;
   arrangementId=result.arrangement.id;selection.clear();selectionRange=null;markerSelection=null;
  });
  status(`Combined ${report.sources.join(', ')}: ${report.notes} notes, ${report.chords} chords, ${report.toneChanges} tone change${report.toneChanges===1?'':'s'}${report.dropped?`, ${report.dropped} overlapping event${report.dropped===1?'':'s'} left out`:''}${report.missingTones.length?`; default tone created for ${report.missingTones.join(', ')}`:''}`);
 }
 async function managePartsDialog(){
  const pending=dialog('Manage arrangements',`<label>Arrangement<select id="ws-manage-arr">${project().arrangements.map(a=>`<option value="${esc(a.id)}" ${a.id===arrangementId?'selected':''}>${esc(a.name)} · ${esc(a.type)}${a.editorOnly?' · scratch':''}</option>`).join('')}</select></label><label>Action<select id="ws-manage-operation"><option value="rename">Rename</option><option value="duplicate">Duplicate</option><option value="up">Move earlier in list</option><option value="down">Move later in list</option><option value="remove">Remove arrangement and linked scratch</option></select></label>${field('Name for rename / duplicate','manage-name',arrangement().name,'text','maxlength="128"')}<p class="ws-muted">Each action can be undone. Removing a main part also removes its linked scratch. Embedded source audio and unrelated source files stay intact.</p>`);
  $('manage-operation').closest('label').insertAdjacentHTML('afterend','<p id="ws-retained-manage-warning" class="ws-muted" hidden>Retained source scores can be reordered. Rename, duplicate and removal are unavailable until an editable conversion exists; their original source entry remains preserved.</p>');
  const updateName=()=>{const operation=$('manage-operation').value,part=project().arrangements.find(a=>a.id===$('manage-arr').value),blocked=part?.readOnly&&!['up','down'].includes(operation);$('manage-name').disabled=blocked||!['rename','duplicate'].includes(operation);$('manage-name').value=(part?.name||'Part')+(operation==='duplicate'?' copy':'');$('dialog-submit').disabled=!!blocked;$('retained-manage-warning').hidden=!part?.readOnly;};
  on($('manage-arr'),'change',updateName);on($('manage-operation'),'change',updateName);
  updateName();
  if(await pending)changeScope('Manage arrangement: '+$('manage-operation').value,p=>{const part=p.arrangements.find(a=>a.id===$('manage-arr').value);if(part?.readOnly&&!['up','down'].includes($('manage-operation').value))throw Error('Retained source scores cannot be renamed, duplicated or removed before conversion');arrangementId=manageArrangement(p,$('manage-arr').value,$('manage-operation').value,{newName:$('manage-name').value});selection.clear();selectionRange=null;markerSelection=null;fitPianoRange();});
 }
 function switchProject(p){
  const normalized=normalizeProject(p);if(normalized.vocals)createVocalIndex(normalized.vocals);for(const a of normalized.arrangements)if(a.type==='drums')deriveDrumLayout(a);
  disposeVocalTimeline();lyricSession=null;lyricPreview=null;vocalUI={selection:[],scrollLeft:0};vocalPage=0;pendingVocalSelection=null;vocalSelectionRange=null;
  actions['render-guide']?.cancel?.();
  currentRecentId=null;projectGeneration++;audioGeneration++;activeAudioUrl=null;saveDestinations={};selectedZoneIndex=null;horizontalSelectionAnchor=null;verticalSelectionAnchor=null;
  countIn.cancel();stopMidi();history=new History(normalized);arrangementId=normalized.arrangements[0].id;selection.clear();selectionRange=null;markerSelection=null;cursor=0;lane=normalized.arrangements[0].type==='keys'?60:0;dirty=false;saveHandle=null;onsets=[];gridSuggestion=null;fitPianoRange();
  audio.pause();audio.clearAudio();loop=false;loopRegionDefined=false;audio.setLoop(0,Math.max(.1,Math.min(4,normalized.duration)),false);waveform=null;loadedAudio=null;lastSaveFormat='json';exportOptions=clone(normalized.sourceExportOptions||{});audio.setProject(normalized,arrangement());if(normalized.audio?.url)loadAudioUrl(normalized.audio.url).catch(e=>status(e.message,true));render();
 }
 async function loadAudioUrl(url){
  const request=++audioGeneration;activeAudioUrl=url;const response=await fetch(url);if(!response.ok)throw Error('Audio could not be loaded');const bytes=await response.arrayBuffer();if(request!==audioGeneration)return;
  await decodeBacking(bytes,url,request);if(request!==audioGeneration)return;loadedAudio=new File([bytes],project().audio?.name||'backing.wav',{type:response.headers.get('Content-Type')||'application/octet-stream'});waveform=audio.peaks||null;audio.setProject(project(),arrangement());audio.seek(cursor);draw();queueDraft();
 }
 async function decodeBacking(bytes,sourceUrl,request,isCurrent=()=>true){
  if(request!==audioGeneration||!isCurrent())return;
  try{return await audio.loadArrayBuffer(bytes,{isCurrent});}catch(originalError){
   if(request!==audioGeneration||!isCurrent())return;status('Preparing a local audio preview…');const response=await fetch(`${API}/audio-preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:sourceUrl})});
   if(!response.ok)throw Error('Audio preview failed: '+await response.text());const preview=await response.json();if(request!==audioGeneration||!isCurrent())return;const pcm=await fetch(preview.url);if(!pcm.ok)throw Error('Converted audio preview could not be loaded');const data=await pcm.arrayBuffer();if(request!==audioGeneration||!isCurrent())return;return await audio.loadArrayBuffer(data,{isCurrent});
  }
 }
 function syncProjectAudio(){const url=project().audio?.url||null;if(url===activeAudioUrl)return;countIn.cancel();stopMidi();audioGeneration++;activeAudioUrl=null;audio.clearAudio();waveform=null;loadedAudio=null;if(url)loadAudioUrl(url).catch(e=>{activeAudioUrl=null;status(e.message,true);});}
 function mainPart(){return arrangement().editorOnly?project().arrangements.find(a=>a.id===(arrangement().scratchFor||mainArrangementId)&&!a.editorOnly)||project().arrangements.find(a=>!a.editorOnly):arrangement();}
 function ensureScratch(){
  const main=mainPart();if(!main)throw Error('Create a main arrangement before adding a scratch track');mainArrangementId=main.id;let scratch=project().arrangements.find(a=>a.editorOnly&&a.scratchFor===main.id);
  if(!scratch)change('Create scratch track',p=>{scratch=makeArrangement(main.type,main.stringCount);Object.assign(scratch,{name:`Scratch · ${main.name}`,editorOnly:true,scratchFor:main.id,instrument:main.instrument,basePitches:clone(main.basePitches),tuning:clone(main.tuning),capo:main.capo,tones:clone(main.tones)});p.arrangements.push(scratch);});
  return scratch;
 }
 async function uploadAudio(file,{isCurrent=()=>true,onAttach=()=>{}}={}){
  const targetHistory=history,request=++audioGeneration;countIn.cancel();
  status('Loading audio…');const body=new FormData();body.append('file',file);const response=await fetch(`${API}/audio`,{method:'POST',body});
  if(!response.ok)throw Error(await response.text());const data=await response.json();if(history!==targetHistory||request!==audioGeneration||!isCurrent())return;await decodeBacking(await file.arrayBuffer(),data.url,request,isCurrent);if(history!==targetHistory||request!==audioGeneration||!isCurrent())return;onAttach();activeAudioUrl=data.url;loadedAudio=file;
  const {tags,...asset}=data;let filled=[];
  change('Import audio',p=>{const empty=p.arrangements.every(a=>!a.notes?.length&&!a.chords?.length)&&!p.vocals?.length;p.audio=asset;p.duration=empty?audio.audioDuration:Math.max(p.duration,audio.audioDuration);p.beats=extendGrid(p.beats,p.duration,{trim:empty});filled=fillSongDetails(p,tags);});
  waveform=audio.peaks||null;status(`Audio ready: ${file.name}`+(filled.length?`; song ${filled.join(', ')} filled from its tags`:''));if(filled.length&&inspector==='settings')renderInspector();return true;
 }
 async function openFile(file,recentId=null,internal={}){
  // Reserve before confirmation: newer Open/Recent intent supersedes old reads.
  const request=internal.request??++openGeneration;if(request!==openGeneration)return false;
  if(internal.acceptGuard){if(!internal.acceptGuard())return false;}else if(!await confirmReplace()||request!==openGeneration)return false;
  const sourceHistory=history,sourceState=history.stateId,sourceGeneration=projectGeneration;
  const obsolete=()=>request!==openGeneration||abort.signal.aborted||sourceGeneration!==projectGeneration||!!(internal.acceptGuard&&!internal.acceptGuard());
  status(`Opening ${file.name}...`);const form=new FormData();form.append('file',file);const response=await fetch(`${API}/load`,{method:'POST',body:form});
  if(obsolete())return false;if(!response.ok)throw Error(await response.text());const data=await response.json();if(obsolete())return false;
  if(history!==sourceHistory||history.stateId!==sourceState)throw Error('The current project changed while the file was being read. Open it again after saving your latest edits.');
  switchProject(data.project);
  // Trusted chooser handle belongs to this accepted source, before cache awaits.
  if(internal.editableHandle){saveHandle=internal.editableHandle;lastSaveFormat='json';lastDestination=internal.editableHandle.name;saveDestinations.json={handle:internal.editableHandle,name:lastDestination};}
  const generation=projectGeneration,openedHistory=history,openSaveSequence=saveStates.get(openedHistory)?.latest??0,cached=await recentProjects.remember(file,{id:recentId,title:data.project.title});
  if(generation!==projectGeneration||request!==openGeneration||abort.signal.aborted)return false;
  if((saveStates.get(openedHistory)?.latest??0)!==openSaveSequence)return true;if(cached.ok)currentRecentId=cached.id;status(`Opened ${file.name}${data.project.import_warnings?.length?` / ${data.project.import_warnings.length} import limitations in Error Finder`:''}${cached.ok?'':' / '+cached.message}`);return true;
 }
 async function openProjectDialog(){
  const request=++openGeneration,owner=history,generation=projectGeneration;
  const chosen=await chooseProjectFile({fallback:()=>$('open-file').click()});
  if(!chosen||request!==openGeneration||history!==owner||projectGeneration!==generation||abort.signal.aborted||!root.isConnected)return;
  await openFile(chosen.file,null,{request,editableHandle:chosen.editableHandle});
 }
 async function recentDialog(welcome=false){
  const intent=++openGeneration,owner=history,generation=projectGeneration;
  const listed=await recentProjects.list();if(intent!==openGeneration||history!==owner||projectGeneration!==generation||abort.signal.aborted)return;
  const pending=dialog(welcome?'Welcome to Open Chart Editor':'Open Recent',`${welcome?'<p>Start an original chart or reopen a complete browser-cached project.</p><p><button id="ws-welcome-new" type="button">New project</button> <button id="ws-welcome-open" type="button">Open file...</button> <button id="ws-welcome-study" type="button">Original study</button></p>':''}<p class="ws-muted">Recent files stay in this browser only: up to 12 files, 128 MiB total, 64 MiB per file. Keep saved files for permanent storage.</p>${!listed.ok?'<p>'+esc(listed.message)+'</p>':''}<div>${listed.entries.length?listed.entries.map(entry=>`<p><button type="button" data-recent-open="${esc(entry.id)}">${esc(entry.title)} / ${esc(entry.name)}</button> <small>${esc(entry.kind)} / ${(entry.bytes/1024/1024).toFixed(2)} MiB</small> <button type="button" data-recent-remove="${esc(entry.id)}" aria-label="Remove ${esc(entry.name)} from recent projects">Remove</button></p>`).join(''):'<p>No recent projects cached yet.</p>'}</div>`,'Close');
  let dialogIntent=intent;const current=request=>request===openGeneration&&history===owner&&projectGeneration===generation&&!abort.signal.aborted&&root.isConnected;
  const close=async()=>{$('dialog').close('cancel');await pending;};
  on($('welcome-new'),'click',safe(async()=>{if(!current(dialogIntent))return;const request=dialogIntent=++openGeneration;await close();if(current(request))await actions.new();}));on($('welcome-open'),'click',safe(async()=>{if(!current(dialogIntent))return;const request=dialogIntent=++openGeneration;await close();if(current(request))await openProjectDialog();}));on($('welcome-study'),'click',safe(async()=>{if(!current(dialogIntent))return;const request=dialogIntent=++openGeneration;await close();if(current(request))await actions.demo();}));
  root.querySelectorAll('[data-recent-open]').forEach(button=>on(button,'click',safe(async()=>{if(!current(dialogIntent))return;const request=dialogIntent=++openGeneration;const item=await recentProjects.read(button.dataset.recentOpen);if(!current(request))return;if(!item.ok){status(item.message,true);return;}await close();if(!current(request))return;await openFile(item.file,item.entry.id,{request});}))); 
  root.querySelectorAll('[data-recent-remove]').forEach(button=>on(button,'click',safe(async()=>{if(!current(dialogIntent))return;const request=dialogIntent=++openGeneration;const result=await recentProjects.remove(button.dataset.recentRemove);if(!current(request))return;if(!result.ok){status(result.message,true);return;}await close();if(current(request))await recentDialog(welcome);})));await pending;
 }
 async function importChart(file){
  countIn.cancel();stopMidi();const request=++chartImportGeneration,owner=history,state=history.stateId,generation=projectGeneration,part=arrangementId,openIntent=openGeneration;
  const current=()=>request===chartImportGeneration&&history===owner&&history.stateId===state&&projectGeneration===generation&&arrangementId===part&&openGeneration===openIntent&&!abort.signal.aborted&&root.isConnected;let accepting=false;
  try{
  status(`Reading ${file.name}…`);const body=new FormData();body.append('file',file);const response=await fetch(`${API}/load`,{method:'POST',body});if(!current())return;if(!response.ok)throw Error(await response.text());const {project:incoming}=await response.json();if(!current())return;
  // Optional gp-to-feedpak assistance: audio alignment needs the song audio; suggestions need the score.
  const assist=incoming._import?.format==='guitarpro'?await fetch(`${API}/assist`).then(r=>r.ok?r.json():{}).catch(()=>({})):{};if(!current())return;
  const hasAudio=!!project().audio?.url,assistAlign=(assist.ensemble&&hasAudio?'<option value="audio-ensemble">Auto-align to the song audio: beat-tracker ensemble (about 1–2 minutes)</option>':'')+(assist.syncEngine&&hasAudio?'<option value="audio-sync">Auto-align to the song audio: sync engine (about 30 seconds)</option>':''),assistSuggest=assist.suggestions?'<label><input type="checkbox" id="ws-import-suggest">Also add ML suggestion versions for comparison (anchors, fingering, techniques, piano hands)</label><p class="ws-muted">Adds extra copies of the parts with suggested data, for comparison. The originals are not changed.</p>':'';
  const html=`<p>Add arrangements from ${esc(file.name)} to the current backing project. Imported material can be undone.</p>${incoming.arrangements.map(a=>`<label><input type="checkbox" data-import-arr="${esc(a.id)}" ${a.readOnly||a._notationOnly?'disabled':'checked'}>${esc(a.name)} · ${esc(a.type)}${a.readOnly||a._notationOnly?' (retained notation; open complete project)':''}</label>`).join('')}<label>Timing<select id="ws-import-align"><option value="time">Keep source timing in seconds</option><option value="beats">Align source beat positions to current beat map</option><option value="score">Use this score's beat map for the song</option>${assistAlign}</select></label><p id="ws-import-align-help" class="ws-muted"></p>${assistSuggest}${field('Place source start at (seconds)','import-offset',0,'number','min="0" step="0.001"')}<p class="ws-muted">Shifts everything imported by this many seconds, including a replaced beat map.</p>${incoming.vocals?.length?'<label><input id="ws-import-vocals" type="checkbox">Include source lyrics / vocals</label><p class="ws-muted">Adds the file\'s lyrics, timed the same way as the notes.</p>':''}<p class="ws-muted">Retained notation can be opened as a complete project. Review the result against your backing audio; source limitations and merge warnings appear in Error Finder.</p>`;
  const pending=dialog('Import arrangements',html,'Import selected');
  if(incoming.beats?.length>1&&!project().arrangements.some(a=>a.notes?.length||a.chords?.length))$('import-align').value='score';
  const timingHelp={"time": "Notes keep their position relative to the start of the file. The song's beat map is unchanged.", "beats": "Each note goes to the same bar and beat in your song as in the file, starting at the start time below. The song's beat map is unchanged.", "score": "Replaces the song's beat map with the file's, so the imported notes sit on its grid. Notes already in the song keep their times.", "audio-ensemble": "Slower tool that aligns the score to the audio, then replaces the existing beat map with that result. Check the result.", "audio-sync": "Faster but less accurate tool that aligns the score to the audio, then replaces the existing beat map with that result. Check the result carefully."},showTimingHelp=()=>{$('import-align-help').textContent=timingHelp[$('import-align').value]||'';};on($('import-align'),'change',showTimingHelp);showTimingHelp();
  if(!await pending||!current())return;
  const ids=[...root.querySelectorAll('[data-import-arr]:checked')].map(input=>input.dataset.importArr);if(!ids.length)throw Error('Choose at least one arrangement to import');
  let align=String($('import-align').value||'time'),audioMap=null,source=incoming,assistNote='';const suggest=!!assistSuggest&&!!$('import-suggest')?.checked;
  if(align.startsWith('audio-')||suggest){
   const method=align==='audio-ensemble'?'ensemble':align==='audio-sync'?'sync-engine':null,picked=incoming.arrangements.filter(a=>ids.includes(a.id)&&Number.isInteger(a.sourceTrack)),tracks=picked.map(a=>a.sourceTrack);
   // The editor's own part roles drive the models, so every ticked part with a model gets a suggestion.
   const roles=picked.filter(a=>a.type!=='drums').map(a=>({track:a.sourceTrack,role:a.type==='keys'?'Keys':a.type==='bass'?'Bass':a.role==='rhythm'?'Rhythm':'Lead'}));
   status(method?`Aligning ${file.name} to the song audio${suggest?' and preparing ML suggestions':''}… this can take ${method==='ensemble'?'1–2 minutes':'about a minute'}`:'Preparing ML suggestions…');
   const assisted=await fetch(`${API}/assist-import`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({incoming,align:method,audio_url:project().audio?.url,suggest,tracks:roles})});
   if(!current())return;if(!assisted.ok)throw Error(await assisted.text());const help=await assisted.json();if(!current())return;
   if(help.incoming){source=help.incoming;ids.push(...source.arrangements.filter(a=>a.mlSuggestion&&tracks.includes(a.sourceTrack)).map(a=>a.id));}
   if(help.audioMap){audioMap=help.audioMap;align='audio';assistNote=`; aligned all parts to the audio with the ${audioMap.method}: ${audioMap.confidence.summary}${audioMap.confidence.good?'':', so check the beat map against the audio'}`;}
   if(help.skipped?.length)assistNote+=`; no ML suggestion for ${help.skipped.map(s=>`${s.name} (${s.reason})`).join(', ')}`;
  }
  const sourceHistory=history,sourceSnapshot=JSON.stringify(project());status('Importing arrangements…');
  const merged=await fetch(`${API}/merge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:project(),incoming:source,arrangement_ids:ids,align,offset:Number($('import-offset').value),include_vocals:$('import-vocals')?.checked||false,audio_map:audioMap})});
  if(!current())return;if(!merged.ok)throw Error(await merged.text());const result=await merged.json();if(!current())return;if(history!==sourceHistory||JSON.stringify(project())!==sourceSnapshot)throw Error('The project changed while import was running. Import again to keep your latest edits.');
  accepting=true;change('Import arrangements',p=>Object.assign(p,normalizeProject(result.project)));arrangementId=result.arrangement_ids[0]||arrangementId;selection.clear();selectionRange=null;markerSelection=null;fitPianoRange();audio.setProject(project(),arrangement());render();status(`Imported ${result.arrangement_ids.length} arrangements${assistNote}${result.warnings.length?` · ${result.warnings.length} warnings in Error Finder`:''}`);
  }catch(error){if(accepting||current())throw error;}
 }
 async function importLyrics(file){
  const request=++chartImportGeneration,owner=history,state=history.stateId,generation=projectGeneration,openIntent=openGeneration;
  const current=()=>request===chartImportGeneration&&history===owner&&history.stateId===state&&projectGeneration===generation&&openGeneration===openIntent&&!abort.signal.aborted&&root.isConnected;
  try{
   status(`Reading lyrics from ${file.name}…`);
   const body=new FormData();body.append('file',file);
   const response=await fetch(`${API}/load`,{method:'POST',body});
   if(!current())return;if(!response.ok)throw Error(await response.text());
   const {project:incoming}=await response.json();if(!current())return;
   if(!Array.isArray(incoming.vocals)||!incoming.vocals.length)throw Error('This file does not contain an existing lyrics chart');
   const sourceSnapshot=JSON.stringify(project()),sourceHistory=history;
   const replace=await dialog('Import lyrics',`<p>Import ${incoming.vocals.length} lyric syllables from ${esc(file.name)}?</p><p>This replaces the current lyrics${project().vocals?.length?' ('+project().vocals.length+' syllables)':''}. Instrument charts, audio and the beat map stay unchanged. You can undo the import.</p>`,'Import lyrics');
   if(!replace||!current())return;
   if(history!==sourceHistory||JSON.stringify(project())!==sourceSnapshot)throw Error('The project changed while the lyrics import was open. Import the file again to keep your latest edits.');
   const vocals=clone(incoming.vocals),count=vocals.length;
   stopMidi();view='vocals';vocalPage=0;pendingVocalSelection=vocals.map(vocal=>vocal.id);
   change('Import lyrics',p=>{p.vocals=vocals;p._vocalXml=incoming._vocalXml;p.duration=Math.max(p.duration,...vocals.map(vocal=>vocal.time+(vocal.length||0)));});
   status(`Imported ${count} lyric syllables from ${file.name}`);
  }catch(error){if(current())throw error;}
 }
 const receiveSaveCompletion=completion=>{
  if(abort.signal.aborted||!root.isConnected||history!==completion.history||completion.sequence!==completion.state.latest)return;
  if(completion.format==='json')saveHandle=completion.handle;lastSaveFormat=completion.format;lastDestination=completion.destination;
  saveDestinations[completion.format]={handle:completion.handle,name:completion.destination,delivery:completion.delivery||'file'};if(completion.recentId)currentRecentId=completion.recentId;
  if(completion.format==='json'&&JSON.stringify(project())===completion.projectText)dirty=false;
  render();$('target-label').textContent=completion.format==='feedpak'?'FeedBack FeedPak':completion.format==='feedback_loose'?'FeedBack loose folder':completion.format==='rs2014_sources'?'DLC Builder project':completion.format==='xml'?'RS2014 XML':completion.format==='vocal_xml'?'RS2014 vocal XML':'Editable project';
  status(`Saved ${lastDestination}${completion.warnings.length?' / '+completion.warnings.join(' / '):''}`);
 };
 acceptSaveCompletion=receiveSaveCompletion;
 async function writeDownload(response,name,handle,context){
  if(!response.ok){let text=await response.text();try{text=JSON.parse(text).detail||text;}catch{}throw Error(typeof text==='object'?JSON.stringify(text):text);}
  const blob=await response.blob();const disposition=response.headers.get('Content-Disposition');const encoded=disposition?.match(/filename\*=UTF-8''([^;]+)/i);const match=disposition?.match(/filename="?([^";]+)/);name=encoded?decodeURIComponent(encoded[1]):match?.[1]||name;
  let destination;
  if(handle){const writer=await handle.createWritable();try{await writer.write(blob);await writer.close();}catch(error){try{await writer.abort?.();}catch{}throw error;}destination=handle.name;}
  else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);destination=`Downloads / ${name}`;}
  let warnings=[];try{const header=response.headers.get('X-OCE-Export-Warnings');if(header&&header.length<=32768){const data=JSON.parse(header);warnings=(Array.isArray(data)?data:[]).map(item=>typeof item==='string'?item:item?.message).filter(Boolean);}}catch{}
  try{const header=response.headers.get('X-OCE-Build-Report');if(header&&header.length<=131072){const report=JSON.parse(header);if(report.originalAudioReused)warnings.push('Original imported full and preview audio reused unchanged');if(Array.isArray(report.warnings))warnings.push(...report.warnings.map(item=>typeof item==='string'?item:item?.message).filter(Boolean));for(const a of report.arrangements||[])if(a.centOffsetQuantized)warnings.push(`${a.role||'Arrangement'} tuning reference rounded from ${a.sourceCents} to ${a.packedCents} cents in the native package; editable formats retain the original value`);if(report.defaultedToneDefinitions?.length)warnings.push('Native build used default definitions for: '+report.defaultedToneDefinitions.join(', '));}}catch{}
  let recentId=null;
  if(/\.json$/i.test(name)&&response.headers.get('Content-Type')?.includes('application/json')){
   // Serialize cache completion per original project and discard obsolete save
   // intents before a new cache write. This never borrows the next project's id.
   const job=context.state.cache.catch(()=>{}).then(()=>context.sequence===context.state.latest?recentProjects.remember(blob,{id:context.recentId,name,title:context.title,kind:'saved editable JSON'}):null);
   context.state.cache=job.then(()=>{},()=>{});const cached=await job;if(cached?.ok)recentId=cached.id;else if(cached)warnings.push(cached.message);
  }
  return {name,destination,warnings,recentId};
 }

 async function saveAs(direct=false){
  const sourceHistory=history,sourceGeneration=projectGeneration;
  let delivery=direct?(saveDestinations[lastSaveFormat]?.delivery||'file'):'file';
  const sameProject=()=>history===sourceHistory&&projectGeneration===sourceGeneration;
  exportOptions=clone(project().sourceExportOptions||{});
  let format=direct?lastSaveFormat:'json';if(!direct){coverGeneration++;
   const html=`<label>Build style<select id="ws-export-format"><option value="feedpak">FeedBack full FeedPak (.feedpak)</option><option value="feedback_loose">FeedBack loose song folder</option><option value="rplus_folder">R+ song folder (adds new chart files; originals untouched)</option><option value="rs2014_sources">DLC Builder project (Rocksmith 2014: .rs2dlc, XML, tones, audio)</option><option value="xml">Rocksmith 2014 arrangement XML</option><option value="vocal_xml">Rocksmith 2014 vocal XML</option><option value="json">Editable chart project (.json)</option></select></label><label id="ws-delivery-label">Save to<select id="ws-export-delivery"><option value="file">ZIP / file download</option><option value="folder">Folder</option></select></label><p class="ws-muted">Each destination uses its own schema. Your complete editable project remains available as JSON. The DLC Builder project opens directly in DLC Builder: it points to every arrangement XML, the vocals, tones, audio and cover, with the song details prefilled.</p>${field('Destination name','export-name',project().title)}<div id="ws-source-options" hidden><h3>Included arrangements</h3>${project().arrangements.map(a=>{const seven=!a.hidden&&!a.editorOnly&&!a._notationOnly&&a.type==='guitar'&&a.stringCount===7,supported=seven||!a.hidden&&!a.editorOnly&&['guitar','bass'].includes(a.type)&&a.stringCount===(a.type==='bass'?4:6);return `<label><input type="checkbox" data-export-arr="${esc(a.id)}" ${supported?'checked':'disabled'}>${esc(a.name)} · ${esc(a.type)}${seven?' (7-string: RS7X layout for the rs7string mod; needs an RS7X-aware builder)':supported?'':a.hidden?' (hidden)':a.editorOnly?' (editor scratch only)':' (FeedBack / future mod target)'}</label>`;}).join('')}${project().vocals?.length?'<label><input type="checkbox" id="ws-build-vocals" checked>Vocals / lyrics</label>':''}<details open><summary>DLC Builder project details</summary>${field('Author','build-author','Local Author')}${field('DLC key (optional)','build-dlc-key','','text','maxlength="64" placeholder="Letters and digits, starting with a letter"')}</details></div><div id="ws-export-warning" class="ws-muted">Choose the output style and save destination.</div>`;
   const destinations=Object.entries(saveDestinations).map(([kind,destination])=>`<li>${esc(kind.toUpperCase())}: ${esc(destination.name)}</li>`).join('');
   const pending=dialog('Save As',html+(destinations?`<details><summary>Previous destinations in this session</summary><ul>${destinations}</ul></details>`:''),'Choose path & save',{allowStateChanges:true});
   $('build-author').closest('details').insertAdjacentHTML('afterbegin',`<label>Song year (required by DLC Builder)<input id="ws-build-year" type="number" min="1000" max="9999" step="1" value="${songYear(project().year)??''}" placeholder="e.g. 1991"></label>`);
   $('build-author').closest('details').insertAdjacentHTML('beforeend',`<label>Project cover PNG<input id="ws-build-cover" type="file" accept="image/png,.png"></label><p id="ws-build-cover-name" class="ws-muted">${esc(project().cover?.name||'Original generated cover')}</p><button id="ws-clear-cover" type="button">Clear custom cover</button>`);
   on($('build-cover'),'change',safe(async e=>{const file=e.target.files[0];if(!file)return;const targetHistory=history,request=++coverGeneration,form=new FormData(),submit=$('dialog-submit');form.append('file',file);$('build-cover-name').textContent='Loading cover…';submit.disabled=true;try{const response=await fetch(`${API}/cover`,{method:'POST',body:form});if(!response.ok)throw Error(await response.text());const data=await response.json();if(request!==coverGeneration||history!==targetHistory||!root.isConnected)return;change('Import project cover',p=>p.cover=data.cover);if($('build-cover-name'))$('build-cover-name').textContent=data.cover.name;}catch(error){if(request===coverGeneration&&$('build-cover-name'))$('build-cover-name').textContent='Cover not imported';throw error;}finally{if(request===coverGeneration)submit.disabled=false;}}));
   on($('clear-cover'),'click',()=>{coverGeneration++;$('dialog-submit').disabled=false;change('Clear project cover',p=>p.cover=null);$('build-cover-name').textContent='Original generated cover';$('build-cover').value='';});
   for(const [id,key]of [['build-author','author'],['build-dlc-key','dlcKey']])if(exportOptions[key]!==undefined)$(id).value=exportOptions[key];
   if($('build-vocals')&&exportOptions.include_vocals!==undefined)$('build-vocals').checked=exportOptions.include_vocals;
   if(exportOptions.arrangement_ids)for(const checkbox of root.querySelectorAll('[data-export-arr]'))if(!checkbox.disabled)checkbox.checked=exportOptions.arrangement_ids.includes(checkbox.dataset.exportArr);
   $('export-format').value=[...$('export-format').options].some(o=>o.value===lastSaveFormat)?lastSaveFormat:'json';$('export-delivery').value=saveDestinations[lastSaveFormat]?.delivery||'file';
   const warning=()=>{const kind=$('export-format').value;$('delivery-label').hidden=!['feedpak','feedback_loose','rs2014_sources','rplus_folder'].includes(kind);$('source-options').hidden=kind!=='rs2014_sources';const ids=[...root.querySelectorAll('[data-export-arr]:checked')].map(el=>el.dataset.exportArr),arrangements=kind==='rs2014_sources'?project().arrangements.filter(a=>ids.includes(a.id)):kind==='xml'?[arrangement()]:project().arrangements;$('export-warning').textContent=findChartIssues({...project(),arrangements},{target:kind}).filter(i=>i.severity==='error').map(x=>x.message).join(' · ')||'Ready to save';};
   $('export-format').addEventListener('change',warning,{signal:abort.signal});for(const checkbox of root.querySelectorAll('[data-export-arr]'))checkbox.addEventListener('change',warning,{signal:abort.signal});warning();if(!await pending)return;if(!sameProject())throw Error('The project changed while Save As was open; choose its destination again');format=$('export-format').value;delivery=['feedpak','feedback_loose','rs2014_sources'].includes(format)?$('export-delivery').value:'file';
   if(format==='rs2014_sources')exportOptions={arrangement_ids:[...root.querySelectorAll('[data-export-arr]:checked')].map(el=>el.dataset.exportArr),include_vocals:$('build-vocals')?.checked||false,author:$('build-author').value,...($('build-dlc-key').value.trim()?{dlcKey:$('build-dlc-key').value.trim()}:{})};
   if(format==='rs2014_sources'&&!exportOptions.arrangement_ids.length&&!exportOptions.include_vocals)throw Error('Select at least one supported arrangement, or include vocals');
   if(format==='rs2014_sources'&&$('build-year').value.trim()){const year=songYear(Number($('build-year').value));if(year===null)throw Error('Enter the song year as four digits, for example 1991');if(year!==project().year)change('Set year',p=>p.year=year);}
   if(format==='rs2014_sources')change('Set DLC Builder project details',p=>p.sourceExportOptions=clone(exportOptions));
   if(format==='rs2014_sources')change('Set source export selection',p=>p.sourceExportOptions={arrangement_ids:[...exportOptions.arrangement_ids],include_vocals:exportOptions.include_vocals,author:exportOptions.author});
  }
  if(format==='rs2014_sources'&&songYear(project().year)===null){
   if(!await dialog('Song year required',`<p>DLC Builder needs the year the song was released. This song has none yet.</p>${field('Year','required-year','','number','min="1000" max="9999" step="1" placeholder="e.g. 1991"')}<p class="ws-muted">It is saved in Song details, so you are asked only once.</p>`,'Save with this year'))return;
   const year=songYear(Number($('required-year').value));if(year===null)throw Error('Enter the song year as four digits, for example 1991');
   change('Set year',p=>p.year=year);
  }
  if(['feedpak','feedback_loose'].includes(format)){
   const check=await fetch(`${API}/save-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:project(),format})}).then(r=>r.ok?r.json():{notices:[]}).catch(()=>({notices:[]}));
   if(check.notices?.length&&!await dialog('Before saving',`<p>This save changes some parts in ways FeedBack will notice:</p><ul>${check.notices.map(n=>`<li>${esc(n)}</li>`).join('')}</ul><p class="ws-muted">Cancel to keep editing, or save anyway.</p>`,'Save anyway'))return;
  }
  const name=((direct?project().title:$('export-name')?.value)||project().title||'OCE').replace(/[<>:"/\\|?*]/g,'_');
  const extension={json:'.json',feedpak:'.feedpak',xml:'.xml',vocal_xml:'.xml',rs2014_sources:'-dlc-builder.zip',feedback_loose:'-feedback-loose.zip',rplus_folder:'-rplus-charts.zip'}[format];
  let handle=direct?(saveDestinations[format]?.handle||(format==='json'?saveHandle:null)):null;
  if(delivery==='folder'){if(!window.showDirectoryPicker)throw Error('Folder saving is unavailable in this browser; choose ZIP / file download and extract the archive');if(!handle||handle.kind!=='directory'){try{handle=await window.showDirectoryPicker({id:'open-chart-editor-'+format,mode:'readwrite'});}catch(e){if(e.name==='AbortError')return;throw e;}}}
  if(delivery!=='folder'&&window.showSaveFilePicker&&!handle){try{handle=await window.showSaveFilePicker({id:'open-chart-editor-'+format,...(saveDestinations[format]?.handle?{startIn:saveDestinations[format].handle}:{}),suggestedName:name+extension,types:[{description:format.toUpperCase(),accept:{'application/octet-stream':[['rs2014_sources','feedback_loose'].includes(format)?'.zip':extension]}}]});}catch(e){if(e.name==='AbortError')return;throw e;}}
  if(!sameProject())throw Error('The project changed while choosing its save destination; save the current project separately');
  status('Saving…');
  const endpoint=format==='rs2014_sources'?'export-sources':format==='feedback_loose'?'export-loose':format==='rplus_folder'?'export-rplus':'save';
  const savedHistory=history,savedProject=JSON.stringify(project()),destinations=saveDestinations;
  let state=saveStates.get(savedHistory);if(!state){state={latest:0,cache:Promise.resolve()};saveStates.set(savedHistory,state);}
  const context={history:savedHistory,state,sequence:++state.latest,recentId:currentRecentId,title:project().title,projectText:savedProject,format,handle,delivery};
  const response=fetch(`${API}/${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:project(),format,...(delivery==='folder'?{delivery:'entries'}:{}),...(format==='rs2014_sources'?exportOptions:{arrangement_id:arrangement().id})})});
  const result=await orderedSaves.run(handle,response,response=>delivery==='folder'?writeFolderTree(response,handle,{name,suffix:format==='feedpak'?'.feedpak':'',isCurrent:sameProject,into:format==='rplus_folder'}):writeDownload(response,name+extension,handle,context));
  if(context.sequence!==state.latest)return;
  destinations[format]={handle,name:result.destination,delivery};const completion={...context,...result};
  if(retainedSession?.history===savedHistory){retainedSession.saveDestinations[format]={handle,name:result.destination,delivery};if(format==='json')retainedSession.saveHandle=handle;retainedSession.lastSaveFormat=format;retainedSession.lastDestination=result.destination;if(result.recentId)retainedSession.currentRecentId=result.recentId;if(format==='json'&&JSON.stringify(savedHistory.project)===savedProject)retainedSession.dirty=false;}
  acceptSaveCompletion?.(completion);
 }

 function insertNote(fret=lastFret){
  if(!chartEditing())return;
  selectionRange=null;markerSelection=null;
  const a=arrangement(),time=quantize(cursor),kind=a.type;
  if(['guitar','bass'].includes(kind))fret=parseFret(fret,{capo:a.capo||0});
  const same=editableNotes().find(n=>Math.abs(n.time-time)<0.00001&&getNoteLane(n)===lane);
  change('Enter note',()=>{if(same){same.fret=fret;if(kind==='keys')same.pitch=lane;selection=new Set([same.id]);synchronizeChordVoicings(a,[same.id]);}else{const n=makeNote(a,time,lane,fret,timeAt(project().beats,beatAt(project().beats,time)+1/(snap||4))-time);if(kind==='drums'){n.piece=drumLayout(a).pieceAt(lane);if(n.piece===null)throw Error('Choose an existing drum lane');}a.notes.push(n);selection=new Set([n.id]);}a.notes.sort((x,y)=>x.time-y.time);});lastFret=fret;
 }
 function insertDisplayedFret(value){insertNote(['guitar','bass'].includes(arrangement().type)?readFret(value):value);}
 function editSelection(label,fn){if(!selected().length)throw Error('Select one or more notes first');change(label,()=>{const notes=selected(),before=new Map(notes.map(n=>[n.id,{fret:n.fret,finger:n.techniques.left_hand}]));for(const n of notes)fn(n);synchronizeChordVoicings(arrangement(),notes.filter(n=>n.fret!==before.get(n.id).fret||n.techniques.left_hand!==before.get(n.id).finger).map(n=>n.id));});}
 // Editing preferences never enter song schemas. Provenance is deliberately
 // session/state scoped: imported endpoints are never guessed to have a gutter.
 function sustainPolicy(snapped){const fretted=['guitar','bass'].includes(arrangement().type);return {enabled:fretted&&(sustainOptions.clampNext||sustainOptions.gutterEnabled),clampNext:sustainOptions.clampNext,snapped:snapped&&sustainOptions.gutterEnabled,gutterBeats:sustainOptions.gutterBeats,beats:project().beats};}
 function editSustains(label,request,{snapped=false,ids=selection}={}){
  if(!editableNotes().some(n=>ids.has(n.id)))throw Error('Select one or more notes first');
  let plans;
  change(label,()=>{plans=applySustainEdits(arrangement(),editableNotes().filter(n=>ids.has(n.id)).map(note=>({note,requested:request(note)})),sustainPolicy(snapped));});
  for(const plan of plans){if(plan.gutterApplied&&!plan.retainedOverlap&&plan.value>0)sustainProvenance.set(plan.note,{history,state:history.stateId,time:plan.note.time,sustain:plan.value,gutter:sustainOptions.gutterBeats});else sustainProvenance.delete(plan.note);}
  const limited=plans.filter(p=>p.clamped||p.retainedOverlap).length;
  if(limited)status(`${limited} sustain${limited===1?'':'s'} limited by the next attack; existing overlaps retained`);
 }
 function stepSustains(direction){
  const snapped=snap>0&&snapOptions.mode==='grid';
  editSustains(direction>0?'Lengthen sustain':'Shorten sustain',n=>{const known=sustainProvenance.get(n),gutterApplied=snapped&&sustainOptions.gutterEnabled&&known?.history===history&&known.state===history.stateId&&known.time===n.time&&known.sustain===n.sustain&&known.gutter===sustainOptions.gutterBeats;return steppedSustain(project().beats,n.time,n.sustain,direction/(snap||4),{gutterApplied,gutterBeats:sustainOptions.gutterBeats});},{snapped});
 }
 async function sustainSettings(){
  if(!await dialog('Sustain editing',`<label><input id="ws-sustain-clamp" type="checkbox" ${sustainOptions.clampNext?'checked':''}>Stop before the next attack on the same string</label><label><input id="ws-sustain-gutter" type="checkbox" ${sustainOptions.gutterEnabled?'checked':''}>Shorten snapped tails by a gutter (G)</label>${field('Gutter (beats)','sustain-gap',sustainOptions.gutterBeats,'number','min="0" max="16" step="0.03125"')}<p class="ws-muted">Applies to explicit guitar/bass sustain edits in the visible difficulty. Changing these preferences leaves existing notes unchanged. Linked notes may overlap. A bend curve is never cut. Exact numeric entry uses the collision preference but no gutter.</p>`))return;
  const gutterBeats=Number($('sustain-gap').value);if(!Number.isFinite(gutterBeats)||gutterBeats<0||gutterBeats>16)throw Error('Choose a gutter between 0 and 16 beats');
  sustainOptions={clampNext:$('sustain-clamp').checked,gutterEnabled:$('sustain-gutter').checked,gutterBeats};sustainProvenance=new WeakMap();persistPreferences();status('Sustain editing preferences updated');
 }
 function toggleTechnique(key){const all=!selected().every(n=>techniqueEnabled(n,key));editSelection(key.replaceAll('_',' '),n=>{const enabled=techniqueToggleEach?!techniqueEnabled(n,key):all;if(key==='vibrato')n.techniques[key]=enabled?80:0;else setTechniqueFlag(n,key,enabled);if(enabled&&key==='palm_mute')setTechniqueFlag(n,'fret_hand_mute',false);if(enabled&&key==='fret_hand_mute')setTechniqueFlag(n,'palm_mute',false);});}
 // Slides go to the next note on the string. With no later note there, a pitched slide goes up 2
 // frets and an unpitched one 5 (down when there is room). A note with no length gets one: up to
 // that next note, or a beat.
 function slideNotes(){const a=arrangement();if(!['guitar','bass'].includes(a.type))throw Error('Slides are for guitar and bass parts');const notes=selected();if(!notes.length)throw Error('Select one or more notes first');return notes;}
 function slideLength(n,after){const beats=project().beats;return n.sustain>0?n.sustain:after?after.time-n.time:timeAt(beats,beatAt(beats,n.time)+1)-n.time;}
 function applySlide(kind,notes=slideNotes()){
  const a=arrangement(),all=editableNotes(),top=24-(a.capo||0),plan=new Map();
  for(const n of notes){
   const after=all.filter(o=>o!==n&&o.string===n.string&&o.time>n.time+1e-4).sort((x,y)=>x.time-y.time)[0];
   const target=after&&after.fret!==n.fret?after.fret:kind==='pitched'?(n.fret+2<=top?n.fret+2:n.fret-2):(n.fret>5?n.fret-5:Math.min(top,n.fret+5));
   plan.set(n.id,{target:Math.max(0,Math.min(top,target)),sustain:slideLength(n,after)});
  }
  editSelection(kind==='none'?'Remove slide':kind==='pitched'?'Slide to next note':'Unpitched slide',n=>{
   const {target,sustain}=plan.get(n.id);n.techniques.slide_to=-1;n.techniques.slide_unpitch_to=-1;
   if(kind!=='none'){n.techniques[kind==='pitched'?'slide_to':'slide_unpitch_to']=target;n.sustain=sustain;}
  });
 }
 // Cycle: no slide -> slide to the next note -> unpitched slide -> no slide.
 function cycleSlide(){
  const notes=slideNotes(),on=(n,key)=>(n.techniques[key]??-1)>=0,state=notes.every(n=>on(n,'slide_to'))?'pitched':notes.every(n=>on(n,'slide_unpitch_to'))?'unpitched':'none';
  const next=state==='none'?'pitched':state==='pitched'?'unpitched':'none';applySlide(next,notes);
  const again=keysFor('slide-cycle')[0];
  status(next==='none'?'Slide removed':`${next==='pitched'?'Slide':'Unpitched slide'} on ${notes.length} note${notes.length>1?'s':''}${again?` · ${displayCombo(again)} again for ${next==='pitched'?'unpitched':'none'}`:''}`);
 }
 function toggleSlide(kind){const notes=slideNotes(),key=kind==='pitched'?'slide_to':'slide_unpitch_to';applySlide(notes.every(n=>(n.techniques[key]??-1)>=0)?'none':kind,notes);}
 // EOF: move the pitched slide target a fret up or down; back on the note's own fret removes it.
 function nudgeSlide(delta){
  const notes=slideNotes(),top=24-(arrangement().capo||0),all=editableNotes();
  editSelection('Move slide target',n=>{
   const current=(n.techniques.slide_to??-1)>=0?n.techniques.slide_to:n.fret,next=Math.max(0,Math.min(top,current+delta));
   n.techniques.slide_unpitch_to=-1;n.techniques.slide_to=next===n.fret?-1:next;
   if(n.techniques.slide_to>=0&&!(n.sustain>0))n.sustain=slideLength(n,all.filter(o=>o!==n&&o.string===n.string&&o.time>n.time+1e-4).sort((x,y)=>x.time-y.time)[0]);
  });
  if(notes.length)status(`Slide target ${notes.every(n=>(n.techniques.slide_to??-1)<0)?'removed':'moved'}`);
 }
 // Every keyboard command (ids from keymaps.js). Commands that are also menu items keep the
 // menu's action name.
 const MENU_COMMANDS=['save','saveas','open','new','import-chart','tempo-import','arrangement-info','undo','redo','copy','paste','selectall','select-like','selectphrase',
  'tab','tempo','vocals','split-view','mixer','scratch','errors','toggle-bottom','help','play','loop','metronome','guide','playtest-cursor','playtest-start','snap-options','resnap',
  'anchor','phrase','phrase-remove','section','tone','meter','beat-add','chord','strum','chord-zone','chord-zone-cycle','chord-zone-hide','chord-split','slide-cycle','bend',
  'sustain-toggle','sustain-less','sustain-more','sustain-gutter','shift-left','shift-right','transpose-up','transpose-down','string-up','string-down','position-up','position-down'];
 let commandTable=null;
 function commands(){
  if(commandTable)return commandTable;
  const toggle=key=>()=>toggleTechnique(key);
  return commandTable={
   ...Object.fromEntries(MENU_COMMANDS.map(id=>[id,()=>actions[id]()])),
   cut:async()=>{await actions.copy();await actions.delete();},
   'select-next-note':()=>selectNeighbourNote(1),'select-prev-note':()=>selectNeighbourNote(-1),
   'arrangement-next':()=>stepArrangement(1),'arrangement-prev':()=>stepArrangement(-1),
   'inspector-properties':()=>showInspector('properties'),'inspector-chords':()=>showInspector('chords'),'inspector-settings':()=>showInspector('settings'),
   'zoom-in':()=>nudgeInput('zoom',1.25,true),'zoom-out':()=>nudgeInput('zoom',0.8,true),
   'speed-down':()=>nudgeInput('speed',-5),'speed-up':()=>nudgeInput('speed',5),'volume-down':()=>nudgeInput('master',-5),'volume-up':()=>nudgeInput('master',5),
   'play-from-start':async()=>{setCursor(0);await actions.play();},
   ...Object.fromEntries(['grid','beat','measure','note','anchor'].flatMap(kind=>[[`cursor-next-${kind}`,()=>moveCursor(kind,1)],[`cursor-prev-${kind}`,()=>moveCursor(kind,-1)]])),
   'cursor-first-note':()=>moveCursor('first'),'cursor-last-note':()=>moveCursor('last'),
   ...Object.fromEntries(Array.from({length:8},(_,i)=>[`lane-${i+1}`,()=>pickString(i+1)])),
   'snap-finer':()=>stepSnap(1),'snap-coarser':()=>stepSnap(-1),
   ...Object.fromEntries([0,1,2,3,4].map(f=>[`finger-${f}`,()=>setFinger(f)])),
   'tech-palm-mute':toggle('palm_mute'),'tech-fret-hand-mute':toggle('fret_hand_mute'),'tech-mute-cycle':()=>cycleTechnique(['palm_mute','fret_hand_mute']),
   'tech-hopo-cycle':()=>cycleTechnique(['hammer_on','pull_off']),'tech-hammer-on':toggle('hammer_on'),'tech-pull-off':toggle('pull_off'),
   'tech-harmonic-cycle':()=>cycleTechnique(['harmonic','harmonic_pinch']),'tech-harmonic':toggle('harmonic'),'tech-pinch-harmonic':toggle('harmonic_pinch'),
   'tech-slap-pop-cycle':()=>cycleTechnique(lane<arrangement().stringCount/2?['slap','pluck']:['pluck','slap']),'tech-slap':toggle('slap'),'tech-pop':toggle('pluck'),
   'tech-tap':toggle('tap'),'tech-accent':toggle('accent'),'tech-vibrato':toggle('vibrato'),'tech-tremolo':toggle('tremolo'),'tech-ignore':toggle('ignore'),'tech-link-next':toggle('link_next'),
   'tech-slide':()=>toggleSlide('pitched'),'tech-unpitched-slide':()=>toggleSlide('unpitched'),'tech-slide-up':()=>nudgeSlide(1),'tech-slide-down':()=>nudgeSlide(-1),
   'bend-lower':()=>change('Lower bend at cursor',()=>adjustBendAtCursor(arrangement(),selection,cursor,-.5)),
   'transpose-octave-up':()=>change('Transpose up an octave',()=>transposeSelection(arrangement(),selection,12)),
   'transpose-octave-down':()=>change('Transpose down an octave',()=>transposeSelection(arrangement(),selection,-12)),
   ...Object.fromEntries(Array.from({length:23},(_,f)=>[`fret-${f}`,()=>insertDisplayedFret(f)])),
  };
 }
 // Run a keyboard command. A ':each' command is a technique toggle that sets each selected note on
 // its own. Viewing and playback commands also work while the part cannot be edited.
 async function runCommand(id){
  const base=baseCommand(id),run=commands()[base];
  if(!run)throw Error(`No keyboard command ${base}`);
  if(!chartEditing()&&!GLOBAL_COMMANDS.has(base)){status(arrangement().locked?`${arrangement().name} is locked; Arrangement > Lock / unlock to edit it`:'This part cannot be edited here',true);return;}
  if(id===base)return run();
  const saved=techniqueToggleEach;techniqueToggleEach=true;try{await run();}finally{techniqueToggleEach=saved;}
 }
 function showInspector(next){inspectorVisible=inspector!==next||!inspectorVisible;inspector=next;applyLayout();renderInspector();draw();}
 function nudgeInput(id,amount,scale=false){const el=$(id),min=Number(el.min),max=Number(el.max),value=scale?Number(el.value)*amount:Number(el.value)+amount;el.value=String(Math.max(min,Math.min(max,Math.round(value))));el.dispatchEvent(new Event('input',{bubbles:true}));}
 function stepSnap(direction){const values=[0,1,2,3,4,6,8],index=Math.max(0,values.indexOf(snap));snap=values[Math.max(0,Math.min(values.length-1,index+direction))];$('snap').value=snap;draw();}
 function moveCursor(kind,direction=1){
  const beats=project().beats,after=t=>t>cursor+.001,before=t=>t<cursor-.001,pick=times=>direction>0?times.find(after):times.findLast(before);
  let target;
  if(kind==='grid')target=timeAt(beats,beatAt(beats,cursor)+direction/(snap||4));
  else if(kind==='beat'){const b=beatAt(beats,cursor);target=timeAt(beats,direction>0?Math.floor(b+1e-6)+1:Math.ceil(b-1e-6)-1);}
  else if(kind==='measure')target=pick(beats.filter(b=>b.measure>=0).map(b=>b.time));
  else if(kind==='anchor')target=pick(arrangement().anchors.map(x=>x.time).sort((x,y)=>x-y));
  else{const times=[...new Set(editableNotes().map(n=>n.time))].sort((x,y)=>x-y);target=kind==='first'?times[0]:kind==='last'?times.at(-1):pick(times);}
  if(!Number.isFinite(target))return;
  setCursor(Math.max(0,Math.min(project().duration,target)));
  const x=xOf(cursor),g=geometry();if(x<g.left||x>g.width-40)setTimeScroll(Math.max(0,cursor*zoom-100));
 }
 function selectNeighbourNote(direction){
  const notes=editableNotes().slice().sort((x,y)=>x.time-y.time||x.string-y.string),chosen=selected(),ref=chosen.length?(direction>0?Math.max(...chosen.map(n=>n.time)):Math.min(...chosen.map(n=>n.time))):cursor;
  const next=direction>0?notes.find(n=>n.time>ref+1e-4||(!chosen.length&&n.time>=ref)):notes.findLast(n=>n.time<ref-1e-4);
  if(!next)return;selection=new Set([next.id]);selectionRange=null;markerSelection=null;cursor=next.time;inspector='properties';render();
 }
 function stepArrangement(direction){const el=$('arrangement'),count=el.options.length;if(count<2)return;el.selectedIndex=(el.selectedIndex+direction+count)%count;el.dispatchEvent(new Event('change',{bubbles:true}));}
 // Charter numbers strings from the highest, as tab does.
 function pickString(number){const a=arrangement();if(!['guitar','bass'].includes(a.type)||number>a.stringCount)return;lane=a.stringCount-number;draw();}
 function setFinger(finger){if(!['guitar','bass'].includes(arrangement().type))return;editSelection('Set left finger',n=>n.techniques.left_hand=finger);}
 // Menu items show the keys of the current profile.
 // EOF mouse: the note under the pointer, if any (same hit test as the left click).
 function noteUnderPointer(e){const {x,y}=pointerPoint(e),g=geometry();return {x,y,g,hit:editableNotes().findLast(n=>Math.abs(yOf(getNoteLane(n))-y)<Math.max(10,g.row/2)&&x>=xOf(n.time)-10&&x<=xOf(n.time)+Math.max(12,n.sustain*zoom))};}
 function eofRightClick(e){
  focusBandAt(pointerPoint(e).y);if(!chartEditing())return;
  const {x,y,g,hit}=noteUnderPointer(e);if(x<g.left||y<g.top||y>=g.top+g.lanes.length*g.row)return;
  if(hit){selection=new Set([hit.id]);selectionRange=null;markerSelection=null;actions.delete();return;}
  cursor=quantize(timeOf(x));lane=laneOf(y);insertNote();
 }
 function eofMiddleClick(e){
  focusBandAt(pointerPoint(e).y);const {hit}=noteUnderPointer(e);if(!hit)return;
  selection=new Set([hit.id]);selectionRange=null;markerSelection=null;cursor=hit.time;lane=getNoteLane(hit);inspector='properties';inspectorVisible=true;applyLayout();render();
  requestAnimationFrame(()=>{const field=$('note-fret');field?.focus();field?.select?.();});
 }
 // Scrubbing: the cursor follows the pointer unsnapped; near an edge the timeline scrolls on.
 function scrubTo(x){
  const g=geometry(),edge=48;
  if(x>g.width-edge)setTimeScroll(timeScroll()+Math.min(60,x-(g.width-edge)));
  else if(x<g.left+edge&&timeScroll()>0)setTimeScroll(timeScroll()-Math.min(60,g.left+edge-x));
  setCursor(timeOf(Math.max(g.left,Math.min(g.width,x))));
 }
 function refreshMenuKeys(){
  const known=new Set(ACTIONS.map(x=>x.id));
  for(const button of root.querySelectorAll('.ws-menu button[data-action]')){
   if(!known.has(button.dataset.action))continue;
   const keys=keysFor(button.dataset.action);let kbd=button.querySelector('kbd');
   if(!keys.length){kbd?.remove();continue;}
   if(!kbd){kbd=document.createElement('kbd');button.append(' ',kbd);}
   kbd.textContent=displayCombo(keys[0]).replaceAll('+',' ');
  }
 }
 function keyboardHelp(){
  const map=keymap(),groups=[...new Set(ACTIONS.map(x=>x.group))].filter(group=>group!=='Frets'||map.byCommand.has('fret-0'));
  return `<h3>Keys · ${esc(PROFILES[keyProfile].label)} profile</h3><p class="ws-muted">Change the profile, any key or the mouse under Edit &gt; Keyboard and mouse. The workflow notes below name the Open Chart Editor keys.</p><dl class="ws-help">${groups.map(group=>{const rows=ACTIONS.filter(x=>x.group===group&&map.byCommand.has(x.id)).map(x=>`${esc(x.label)}: ${map.byCommand.get(x.id).map(displayCombo).join(' or ')}`);return rows.length?`<dt>${esc(group)}</dt><dd>${rows.join(' · ')}</dd>`:'';}).join('')}</dl>`;
 }
 function cycleTechnique(keys){editSelection('Cycle technique',n=>{const active=keys.findIndex(k=>techniqueEnabled(n,k));keys.forEach(k=>setTechniqueFlag(n,k,false));if(active+1<keys.length)setTechniqueFlag(n,keys[active+1],true);});}
 function moveSelected(delta){const notes=selected(),minimum=Math.min(...notes.map(n=>n.time));delta=Math.max(delta,-minimum);const chords=arrangement().chords.filter(c=>(c.notes||[]).some(n=>selection.has(n.id)));change('Move notes',()=>{for(const n of notes)if(!chords.some(c=>c.notes.includes(n)))n.time+=delta;for(const c of chords){c.time+=delta;for(const n of c.notes)n.time+=delta;}});}
 function shiftNotes(beats){if(!selected().length)throw Error('Select notes first');const first=Math.min(...selected().map(n=>n.time));moveSelected(timeAt(project().beats,beatAt(project().beats,first)+beats)-first);}
 function selectRegion(start,end){selectionRange={start:Math.max(0,Math.min(start,end)),end:Math.max(start,end)};selection=new Set(editableNotes().filter(n=>n.time>=selectionRange.start&&n.time<selectionRange.end).map(n=>n.id));inspector='properties';render();status(`Region ${seconds(selectionRange.start)} — ${seconds(selectionRange.end)} · notes and structure`);}
 async function editSelectionEdges(mode){
  const range=selectionRange||rangeForSelectedNotes(project(),selected(),cursor,{division:snap||4});
  if(!await dialog(`${mode==='expand'?'Expand':'Shrink'} selection edges`,`<p>Adjust a time region without moving notes. The start is included; the end is excluded. Measures and phrases follow the authored markers.</p><label>Edges<select id="ws-selection-edge"><option value="both">Both edges</option><option value="left">Start only</option><option value="right">End only</option></select></label><label>Unit<select id="ws-selection-unit"><option value="snap">Snap step (1/${snap||4} beat)</option><option value="measure">Measure</option><option value="phrase">Phrase</option></select></label><p class="ws-muted">Moves to the next strict boundary and stops at the song bounds. A shrink that would cross the opposite edge is refused. These are this editor's defined edge rules.</p>`))return;
  const next=resizeSelectionEdges(project(),arrangement(),range,{mode,edge:$('selection-edge').value,unit:$('selection-unit').value,division:snap||4});selectRegion(next.start,next.end);
 }
 function updateClock(){
  const t=audio.isPlaying?audio.currentTime:cursor,b=beatAt(project().beats,t),i=Math.max(0,Math.min(project().beats.length-2,Math.floor(b))),down=project().beats.slice(0,i+1).findLast(x=>x.measure>=0);
  const downIndex=project().beats.findLastIndex((marker,index)=>index<=i&&marker.measure>=0);
  $('time').textContent=seconds(t);$('bar').textContent=`${String(down?.measure??Math.floor(b/4)+1).padStart(3,'0')}:${Math.floor(b)-Math.max(0,downIndex)+1}`;
  const meter=project().beats[i];$('signature').textContent=`${meter.numerator||4}/${meter.denominator||4}`;
  $('bpm-display').textContent=(60/(project().beats[i+1].time-project().beats[i].time)*4/(meter.denominator||4)).toFixed(2);$('play').textContent=audio.preparing?'Cancel':audio.isPlaying?'❚❚':'▶';
 }
 function draw(){
  if(abort.signal.aborted||!root.isConnected)return;
  if(arrangement().readOnly)return;
  if(view==='vocals'){vocalController?.schedule();updateLyricFollow();return;}if(view==='tones')return;
  if(draw.history!==history){draw.off?.();const listener=()=>{draw.cache=null;draw.indexes=null;};history.listeners.add(listener);const observed=history;draw.off=()=>observed.listeners.delete(listener);draw.history=history;draw.cache=null;draw.indexes=null;}
  if(!draw.cleanupRegistered){audio.disposers.add(()=>draw.off?.());draw.cleanupRegistered=true;}
  const active=arrangement();if(draw.cache?.arrangement!==active)draw.cache=new ArrangementViewIndex(active);const index=draw.cache;
  const g=geometry(),viewportHeight=Math.max(1,axes().height),physicalWidth=scroll.clientWidth,physicalHeight=scroll.clientHeight||500,dpr=Math.min(window.devicePixelRatio||1,2,Math.sqrt(8000000/Math.max(1,g.width*viewportHeight)),16384/Math.max(1,g.width,viewportHeight)),laneIndexes=new Map(g.lanes.map((value,index)=>[value,index]));
  // A viewport-sized backing store and ordinary spacer retain the complete
  // logical scroll range. Chart and pointer coordinates remain logical.
  const timeExtent=g.left+project().duration*zoom+100;
  spacer.style.width=`${bottomRoll()?g.height:timeExtent}px`;spacer.style.height=`${Math.max(0,(bottomRoll()?timeExtent:g.height)-physicalHeight)}px`;
  canvas.dataset.rollOrientation=bottomRoll()?'bottom':'left';canvas.dataset.rollFirstLane=String(g.lanes[0]);canvas.dataset.waveform=waveform?.length?'ready':'none';canvas.dataset.rollSelectedLane=String(lane);
  const rotate=$('rotate-roll');if(rotate){rotate.style.display=view==='tab'&&['keys','drums'].includes(arrangement().type)?'':'none';rotate.classList.toggle('active',bottomRoll());}canvas.dataset.rollRow=String(g.row);canvas.dataset.rollLaneStart=String(g.top);canvas.dataset.rollTimeStart=String(g.left);
  canvas.style.width=`${physicalWidth}px`;canvas.style.height=`${physicalHeight}px`;
  if(canvas.width!==Math.max(1,Math.floor(physicalWidth*dpr))||canvas.height!==Math.max(1,Math.floor(physicalHeight*dpr))){canvas.width=Math.max(1,Math.floor(physicalWidth*dpr));canvas.height=Math.max(1,Math.floor(physicalHeight*dpr));}
  rememberScroll();
  const offsetY=laneScroll(),xOf=t=>g.left+t*zoom-timeScroll(),yOf=l=>laneIndexes.has(l)?g.top+(laneIndexes.get(l)+.5)*g.row:NaN;
  const firstLane=Math.max(0,Math.floor((offsetY-g.top)/g.row)-1),lastLane=Math.min(g.lanes.length-1,Math.ceil((offsetY+viewportHeight-g.top)/g.row)+1);

  ctx.setTransform(...axes().matrix(dpr));ctx.fillStyle='#1c1c20';ctx.fillRect(0,offsetY,g.width,viewportHeight);
  if(loopRegionDefined||drag?.kind?.startsWith('loop-')){const range={...audio.loop};if(drag?.kind==='loop-range'){range.start=Math.min(drag.start,drag.value);range.end=Math.max(drag.start,drag.value);}else if(drag?.kind==='loop-start')range.start=Math.min(drag.value,range.end-.001);else if(drag?.kind==='loop-end')range.end=Math.max(drag.value,range.start+.001);const left=Math.max(g.left,xOf(range.start)),right=Math.min(g.width,xOf(range.end));ctx.fillStyle=loop?'#278db355':'#57809533';ctx.fillRect(left,0,Math.max(0,right-left),28);ctx.fillStyle='#72c3e5';for(const t of [range.start,range.end]){const x=xOf(t);if(x>=g.left&&x<=g.width)ctx.fillRect(x-3,0,6,28);}}
  const review=arrangement().combineReview;if(review?.length&&!bottomRoll())for(const o of review){const left=Math.max(g.left,xOf(o.start)),right=Math.min(g.width,Math.max(xOf(o.end),xOf(o.start)+4));if(right<=left)continue;ctx.fillStyle=o.kind==='duplicate'?'#8a8f9a22':'#e0a23a30';ctx.fillRect(left,0,right-left,g.height);ctx.fillStyle=o.kind==='duplicate'?'#8a8f9a':'#e0a23a';ctx.fillRect(left,0,right-left,4);}
  if(selectionRange){const x=Math.max(g.left,xOf(selectionRange.start)),end=Math.min(g.width,xOf(selectionRange.end));ctx.fillStyle='#2c6f9b33';ctx.fillRect(x,29,Math.max(0,end-x),g.height-29);}
  // Shared time ruler, waveform, and structure lanes.
  ctx.font='11px Segoe UI';ctx.textBaseline='middle';
  const start=Math.max(0,Math.floor(beatAt(project().beats,Math.max(0,timeOf(g.left))))-1),end=Math.min(project().beats.length-1,Math.ceil(beatAt(project().beats,timeOf(g.width)))+1);
  for(let i=start;i<=end;i++){
   const b=project().beats[i],x=xOf(b.time);if(x<g.left)continue;ctx.strokeStyle=b.measure>=0?'#777b87':'#37383f';ctx.lineWidth=b.measure>=0?1.4:1;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,g.height);ctx.stroke();
   if(b.measure>=0){ctx.fillStyle='#b6bac8';ctx.fillText(String(b.measure),x+4,15);}
   else if(zoom*(project().beats[i+1]?.time-b.time)>30){ctx.strokeStyle='#6a6e7a';ctx.beginPath();ctx.moveTo(x,10);ctx.lineTo(x,28);ctx.stroke();}
   if(snapOptions.mode==='grid'&&snap>1&&i<end)for(let s=1;s<snap;s++){const sx=xOf(timeAt(project().beats,i+snapFraction(s,snap,snapOptions.swing)));if(sx<g.left)continue;ctx.strokeStyle='#292a30';ctx.beginPath();ctx.moveTo(sx,g.top);ctx.lineTo(sx,g.height);ctx.stroke();}
   if(view==='tempo'){ctx.fillStyle='#239de8';ctx.beginPath();ctx.moveTo(x,42);ctx.lineTo(x-5,53);ctx.lineTo(x+5,53);ctx.fill();ctx.fillStyle='#a5b5ca';ctx.fillText(i<project().beats.length-1?(60/(project().beats[i+1].time-b.time)*4/(b.denominator||4)).toFixed(1):'',x+4,65);}
  }
  if(snap&&snapOptions.mode==='onsets'&&onsetReady())for(const onset of onsetReady()?onsets:[]){const x=xOf(onset.time);if(x<g.left||x>g.width)continue;ctx.strokeStyle='#d5aa4d55';ctx.beginPath();ctx.moveTo(x,g.top);ctx.lineTo(x,g.height);ctx.stroke();}
  const waveTop=view==='tempo'?90:34,waveHeight=view==='tempo'?190:28;
  ctx.fillStyle='#15161a';ctx.fillRect(g.left,waveTop,g.width-g.left,waveHeight);
  const audioNudge=drag?.kind==='audio-nudge'?drag.delta:0;
  if(waveform?.length){ctx.strokeStyle=audioNudge?'#9fc3d8':'#6a8fa5';ctx.beginPath();for(let x=g.left;x<g.width;x++){const t=timeOf(x)-audioNudge,index=Math.floor(t/(audio.audioDuration||project().duration)*waveform.length),v=waveform[index]||0;ctx.moveTo(x,waveTop+waveHeight/2-v*waveHeight/2);ctx.lineTo(x,waveTop+waveHeight/2+v*waveHeight/2);}ctx.stroke();}
  else{ctx.fillStyle='#687381';ctx.fillTextAlong(loadedAudio?'Audio waveform loading…':'Import audio to display the waveform',g.left+15,waveTop+waveHeight/2);}
  if(view==='tab'){
   const tracks=[['Tones',68,arrangement().tones.changes||[]],['Phrases',91,arrangement().phrases],['Sections',114,project().sections],['Anchors',137,arrangement().anchors]].filter(([label])=>!g.bands||label==='Sections').map(([label,y,items])=>[label,g.bands?68:y,items]);
   for(const [label,y,items]of tracks){ctx.strokeStyle='#30313a';ctx.beginPath();ctx.moveTo(0,y+12);ctx.lineTo(g.width,y+12);ctx.stroke();
    for(let j=0;j<items.length;j++){const it=items[j],x=Math.max(g.left,xOf(it.time??it.start_time)),next=xOf(items[j+1]?.time??items[j+1]?.start_time??project().duration);if(next<g.left||x>g.width)continue;
     ctx.fillStyle=label==='Phrases'?'#245b7c':label==='Tones'?'#44434f':label==='Sections'?'#777c85':'#354451';ctx.fillRect(x,y-9,Math.max(16,Math.min(g.width,next)-x-2),18);ctx.fillStyle='#d7dce7';ctx.fillTextAlong(String(it.name??(it.fret!==undefined?shownFret(it.fret):arrangement().tones.base)),x+5,y);}
   }
  }
  if(view==='tempo'){
   ctx.fillStyle='#a6b4c9';ctx.fillText('Drag the blue beat markers to align them with recording transients.',g.left+12,305);
   for(const onset of onsetReady()?onsets:[]){const x=xOf(onset.time);if(x<g.left||x>g.width)continue;ctx.strokeStyle='#ebc36d80';ctx.beginPath();ctx.moveTo(x,waveTop);ctx.lineTo(x,waveTop+waveHeight);ctx.stroke();}
   if(gridSuggestion){ctx.fillStyle='#79c39f';for(const b of gridSuggestion.beats){const x=xOf(b.time);if(x>=g.left&&x<=g.width){ctx.fillRect(x-2,73,4,10);}}}
  }
  // One arrangement's lanes, hand-shape zones, chords and notes. In split view the other
  // arrangements are painted the same way, passively: no selection or drag preview.
  const paintBand=(passive=false)=>{
   const active=arrangement(),index=passive?bandIndex(active):draw.cache,g=geometry(),laneIndexes=new Map(g.lanes.map((value,i)=>[value,i])),sel=passive?new Set():selection,dragging=passive?null:drag;
   const yOf=l=>laneIndexes.has(l)?g.top+(laneIndexes.get(l)+.5)*g.row:NaN,clipBottom=g.band?g.band.bottom:g.height;
   const firstLane=Math.max(0,Math.floor((offsetY-g.top)/g.row)-1),lastLane=Math.min(g.lanes.length-1,Math.ceil((offsetY+viewportHeight-g.top)/g.row)+1);
   const visibleStart=(timeScroll()-24)/zoom,visibleEnd=(timeScroll()+g.width-g.left+24)/zoom;
   const unique=items=>[...new Set(items)],shift=dragging?.kind==='note'||dragging?.kind==='zone-move'?dragging.delta||0:0;
   const shiftedIds=dragging?.kind==='note'?sel:dragging?.kind==='zone-move'?dragging.ids:null;
   const visibleNotes=unique([...index.notesBetween(visibleStart,visibleEnd),...(shift&&shiftedIds?index.notesBetween(visibleStart-shift,visibleEnd-shift).filter(n=>shiftedIds.has(n.id)):[])]);
   const visibleChords=unique([...index.chordsBetween(visibleStart,visibleEnd),...(shift&&dragging?.kind==='zone-move'?index.chordsBetween(visibleStart-shift,visibleEnd-shift).filter(c=>(c.notes||[]).some(n=>dragging.ids.has(n.id))):[])]);
   const zoneRows=new Map(index.zonesBetween(visibleStart,visibleEnd).map(row=>[row.index,row]));
   if(shift&&dragging?.kind==='zone-move')for(const row of index.zonesBetween(visibleStart-shift,visibleEnd-shift))if(dragging.zoneIndexes.has(row.index))zoneRows.set(row.index,row);
   if(dragging?.kind==='zone-end'){const h=active.handshapes[dragging.index];if(h&&!zoneRows.has(dragging.index)&&h.start_time<=visibleEnd&&dragging.end>=visibleStart)zoneRows.set(dragging.index,{item:h,index:dragging.index});}
   for(let index=firstLane;index<=lastLane;index++){
    const l=g.lanes[index],y=g.top+(index+0.5)*g.row,a=arrangement(),isBlack=a.type==='keys'&&[1,3,6,8,10].includes(l%12);
    if(isBlack){ctx.fillStyle='#16171b';ctx.fillRect(g.left,y-g.row/2,g.width-g.left,g.row);}
    ctx.strokeStyle=a.type==='guitar'||a.type==='bass'?stringColor(a,l):'#353740';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(g.left,y);ctx.lineTo(g.width,y);ctx.stroke();
   }
   if(view==='tab')for(const {index,item:h}of [...zoneRows.values()].sort((a,b)=>a.index-b.index)){const offset=dragging?.kind==='zone-move'&&dragging.zoneIndexes.has(index)?dragging.delta:0,x=Math.max(g.left,xOf(h.start_time+offset)),end=xOf((dragging?.kind==='zone-end'&&dragging.index===index?dragging.end:h.end_time)+offset),y=g.top+g.lanes.length*g.row+8;if(end>=g.left&&x<g.width){ctx.fillStyle='#36587a66';ctx.fillRect(x,y,end-x,15);ctx.strokeStyle='#518cbe';ctx.strokeRect(x,y,end-x,15);ctx.fillStyle='#b8d5ec';ctx.fillText(chordLabel(arrangement(),arrangement().chord_templates[h.chord_id])||'Hand shape',x+4,y+7);if(end>=g.left&&end<=g.width){ctx.fillStyle='#68b9ef';ctx.fillRect(end-4,y-3,8,21);}}}
   ctx.save();ctx.beginPath();ctx.rect(g.left,g.top-15,g.width-g.left,clipBottom-g.top+15);ctx.clip();
   const compactChords=index.compactChords,compactNotes=new Set(visibleChords.filter(c=>compactChords.has(c)).flatMap(c=>(c.notes||[]).map(n=>n.id)));
   if(arrangement().type!=='drums')for(const chord of visibleChords){const template=arrangement().chord_templates[chord.chord_id],members=chord.notes||[];if(!members.length)continue;const ys=members.map(n=>yOf(getNoteLane(n))),x=xOf(chord.time+(dragging?.kind==='zone-move'&&members.some(n=>dragging.ids.has(n.id))?dragging.delta:0)),top=Math.min(...ys)-12,bottom=Math.max(...ys)+12,width=Math.max(23,Math.max(...members.map(n=>n.sustain||0))*zoom),keys=arrangement().type==='keys',valid=keys||!!template&&members.length>=2;if(x+width<g.left||x>g.width)continue;if(compactChords.has(chord)){ctx.strokeStyle=members.some(n=>sel.has(n.id))?'#fff':'#8bc6a6';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,top+6);ctx.lineTo(x,bottom-6);ctx.stroke();ctx.lineWidth=1;continue;}ctx.fillStyle=valid?'#3b9b6220':'#bb464620';ctx.fillRect(x-11,top,width,bottom-top);ctx.strokeStyle=valid?'#4a9d76':'#d14d4d';ctx.strokeRect(x-11,top,width,bottom-top);ctx.fillStyle=valid?'#a3c8b4':'#ef9a9a';if(!String(template?.displayName||'').endsWith('-nop'))ctx.fillText(keys?(suggestChordNames(arrangement(),members,{limit:1})[0]||''):(template?chordLabel(arrangement(),template,members):'Incomplete chord'),x-9,top-7);}
   for(const n of visibleNotes){if(compactNotes.has(n.id))continue;
    const l=getNoteLane(n),row=laneIndexes.get(l);if(row===undefined||row<firstLane||row>lastLane)continue;const displaced=dragging?.kind==='note'&&sel.has(n.id)||dragging?.kind==='zone-move'&&dragging.ids.has(n.id);let x=xOf(Math.max(0,n.time+(displaced?dragging.delta:0))),y=yOf(l);if(x>g.width||x+Math.max(12,n.sustain*zoom)<g.left)continue;
    const color=arrangement().type==='keys'?pianoNoteColor(pianoPalette,l):stringColor(arrangement(),n.string),isSelected=sel.has(n.id);
    const anchor=index.anchorAt(n.time);
    const invalid=['guitar','bass'].includes(arrangement().type)&&n.fret>0&&(!anchor||n.fret<anchor.fret||n.fret>=anchor.fret+(anchor.width||4));
    ctx.fillStyle=isSelected?'#f5f7fb':color;ctx.strokeStyle=isSelected?'#fff':invalid?'#ff5555':color;ctx.lineWidth=isSelected?2:1;
    if(arrangement().type==='drums'){ctx.beginPath();ctx.moveTo(x,y-7);ctx.lineTo(x+7,y);ctx.lineTo(x,y+7);ctx.lineTo(x-7,y);ctx.closePath();ctx.fill();}
    else if(arrangement().type==='keys'){ctx.fillRect(x,y-6,Math.max(9,n.sustain*zoom),12);}
    else{if(n.sustain>0){ctx.globalAlpha=.35;ctx.fillRect(x,y-5,n.sustain*zoom,10);ctx.globalAlpha=1;}ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#25242a';ctx.fill();ctx.stroke();ctx.fillStyle=isSelected?'#fff':'#e5e5eb';ctx.textAlign='center';ctx.fillText(String(shownFret(n.fret)),x,y+0.5);ctx.textAlign='left';}
    if(arrangement().type==='keys'&&shadeHands&&['lh','rh'].includes(n.hand)){ctx.fillStyle='#111216';ctx.fillRect(x,y-6,5,12);ctx.fillStyle=n.hand==='lh'?'#6aa9ef':'#e6ae65';ctx.fillRect(x,y-6,3,12);}
    const tags=techniqueTags(n).join(' ');
    if(tags){ctx.fillStyle='#e3d0ae';ctx.font='9px Segoe UI';ctx.fillText(tags,x+11,y-10);ctx.font='11px Segoe UI';}
    if(n.sustain>0&&(n.techniques.bend_values?.length||n.techniques.bend>0)){const curve=n.techniques.bend_values?.length?n.techniques.bend_values:[{t:0,v:0},{t:n.sustain,v:n.techniques.bend}];ctx.strokeStyle=isSelected?'#fff':'#e7bd80';ctx.lineWidth=1.5;ctx.beginPath();curve.forEach((point,i)=>{const px=xOf(n.time+point.t),py=y-point.v*g.row/7;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});ctx.stroke();}
    if(n.sustain>0&&n.techniques.slide_to>=0){const end=x+n.sustain*zoom;ctx.strokeStyle='#d5e2f2';ctx.beginPath();ctx.moveTo(x+10,y);ctx.lineTo(end,y-(n.techniques.slide_to>n.fret?8:-8));ctx.stroke();ctx.fillStyle='#d5e2f2';ctx.fillText(String(shownFret(n.techniques.slide_to)),end+3,y-9);}
    if(n.sustain>0&&n.techniques.slide_unpitch_to>=0){const end=x+n.sustain*zoom;ctx.strokeStyle='#d5e2f2';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x+10,y+3);ctx.lineTo(end,y+(n.techniques.slide_unpitch_to>n.fret?-8:8));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#d5e2f2';ctx.fillText('unpitched '+shownFret(n.techniques.slide_unpitch_to),end+3,y+13);}
    if(isSelected&&n.sustain>0){ctx.fillStyle='#8dd0fa';ctx.fillRect(x+n.sustain*zoom-3,y-7,6,14);}
   }
   ctx.restore();
  };
  if(g.bands)for(const band of g.bands){if(band.id===arrangementId)paintBand();else withArrangement(band.id,()=>paintBand(true));}
  else paintBand();
  if(g.chordStrip)drawChordStrip(g,xOf);
  const time=audio.isPlaying?audio.currentTime:cursor,x=xOf(time);if(x>=g.left){ctx.strokeStyle='#329fdf';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,g.height);ctx.stroke();ctx.fillStyle='#239de8';ctx.fillRect(x-4,29,8,12);}
  if(drag?.kind==='beat'||drag?.kind==='beat-shift'){ctx.strokeStyle='#f2bf5e';ctx.beginPath();ctx.moveTo(xOf(drag.time),40);ctx.lineTo(xOf(drag.time),g.height);ctx.stroke();}
  // Keep lane labels fixed while the time domain scrolls.
  ctx.fillStyle='#202027';ctx.fillRect(0,0,g.left,view==='tempo'?g.top:g.height);ctx.strokeStyle='#43444f';ctx.beginPath();ctx.moveTo(g.left-1,0);ctx.lineTo(g.left-1,g.height);ctx.stroke();
  ctx.fillStyle='#aab5ca';ctx.font='10px Segoe UI';
  if(view==='tab')for(const [text,y]of g.bands?[['Sections',68]]:[['Tones',68],['Phrases',91],['Sections',114],['Anchors',137]])ctx.fillTextAlong(`${text}    +`,8,y);
  else{ctx.fillText('Beat Map',8,47);ctx.fillText('Audio waveform',8,140);}
  const paintLabels=(passive=false)=>{
   const g=geometry(),laneIndexes=new Map(g.lanes.map((value,i)=>[value,i])),yOf=l=>laneIndexes.has(l)?g.top+(laneIndexes.get(l)+.5)*g.row:NaN;
   const firstLane=Math.max(0,Math.floor((offsetY-g.top)/g.row)-1),lastLane=Math.min(g.lanes.length-1,Math.ceil((offsetY+viewportHeight-g.top)/g.row)+1);
   if(arrangement().type==='keys')drawPianoKeyboard(g,g.lanes.slice(firstLane,lastLane+1));
   else g.lanes.slice(firstLane,lastLane+1).forEach(l=>{const a=arrangement(),label=a.type==='keys'?noteName(l):a.type==='drums'?drumLayout(a).labelFor(drumLayout(a).pieceAt(l)):noteName((a.basePitches[l]||0)+(a.tuning[l]||0)+(a.capo||0));if(bottomRoll()){const black=a.type==='keys'&&[1,3,6,8,10].includes(l%12);ctx.fillStyle=a.type==='keys'?(black?'#252630':'#dce0e7'):'#343c49';ctx.fillRect(0,yOf(l)-g.row/2,g.left-2,g.row-1);ctx.strokeStyle='#11151a';ctx.strokeRect(0,yOf(l)-g.row/2,g.left-2,g.row-1);ctx.fillStyle=!passive&&l===lane?'#278dc2':a.type==='keys'&&!black?'#222936':'#e4e9f2';ctx.fillText(label,black?g.left*.6:18,yOf(l),Math.max(8,g.row-2));}else{ctx.fillStyle=!passive&&l===lane?'#fff':'#9ba2b4';ctx.fillText(label,12,yOf(l),95);}});
  };
  if(g.bands){for(const band of g.bands){if(band.id===arrangementId)paintLabels();else withArrangement(band.id,()=>paintLabels(true));}drawBandHeaders(g);}
  else paintLabels();
  if(g.chordStrip)drawChordStripLabel(g);
  if(drag?.kind==='marquee'){ctx.fillStyle='#2b8aca33';ctx.strokeStyle='#44a5dd';ctx.fillRect(drag.x,drag.y,drag.currentX-drag.x,drag.currentY-drag.y);ctx.strokeRect(drag.x,drag.y,drag.currentX-drag.x,drag.currentY-drag.y);}
  if(bottom==='stave')drawStavePanel();
  if(bottom==='live')drawLivePanel();
 }

 // Availability follows this editor's actual command prerequisites. Exact
 // retail grey-out behavior remains a separate observation/compatibility task.
 function refreshActionAvailability(){
  const a=arrangement(),notes=selected(),hasNotes=notes.length>0,fretted=['guitar','bass'].includes(a.type),hasRegion=!!selectionRange;
  const availability={
   'midi-input':!a.readOnly,'midi-monitor':!a.readOnly,'midi-stop':!!midiConnection||!!midiSetupPromise,'midi-disconnect':!!midiConnection||!!midiSetupPromise,
   undo:history.undoStack.length>0||(midiRecording&&!!midiRecorder?.pendingCount),redo:history.redoStack.length>0,
   copy:hasRegion||hasNotes,paste:clipboard.kind==='oce-region'||clipboard.length>0,delete:hasRegion||hasNotes,
   selectall:editableNotes().length>0,'select-like':hasNotes,
   chord:fretted&&notes.length>=2,'chord-zone':fretted&&a.chord_templates.length>0,'chord-fingerprint':fretted&&a.chord_templates.length>0,
   'chord-split':fretted&&a.chords.some(c=>(c.notes||[]).some(n=>selection.has(n.id))),handshape:fretted&&hasNotes&&a.chord_templates.length>0,
   strum:fretted&&a.handshapes.some(h=>h.start_time<=cursor&&cursor<h.end_time),anchor:fretted,
   'sustain-more':hasNotes,'sustain-less':hasNotes,bend:hasNotes,
   'transpose-up':hasNotes&&a.type!=='drums','transpose-down':hasNotes&&a.type!=='drums',
   'string-up':fretted&&hasNotes,'string-down':fretted&&hasNotes,'position-up':fretted&&hasNotes,'position-down':fretted&&hasNotes,
   'shift-left':hasNotes,'shift-right':hasNotes,
   'arr-clone':!a.editorOnly&&!a.readOnly,'arr-lock':!a.editorOnly,'arr-hide':!a.editorOnly,'arr-delete':!a.locked,'combine-clear':!!a.combineReview?.length,
   'difficulty-remove':(a.difficulties?.length||1)>1,'difficulty-phrase':a.phrases.length>0,
   'fingerprints-generate':fretted&&a.chords.length>0,'fingerprints-remove':fretted&&a.handshapes.length>0,'zone-fit':fretted&&a.handshapes.length>0,'anchor-fit':fretted,
   'tempo-detect':!!audio.buffer,'tempo-fit':!!audio.buffer,'tempo-restore-score':project()._import?.format==='guitarpro'&&!!project()._import?.source,'tempo-align':!!audio.buffer,'tempo-accept':!!gridSuggestion,
  };
  for(const button of root.querySelectorAll('button[data-action]')){const name=button.dataset.action;if(Object.hasOwn(availability,name)||chartOnlyActions.has(name)||frettedActions.has(name))button.disabled=!chartCommandAllowed(name)||(Object.hasOwn(availability,name)&&!availability[name]);}
  updateLoopPlaytestAvailability();
 }
 function updateLoopPlaytestAvailability(){const vocal=view==='vocals',ready=!vocal||typeof window.feedBackViz_vocal_highway==='function'&&(project().vocals||[]).some(row=>Number.isInteger(row.pitch)&&row.pitch>=0&&row.pitch<=127&&row.length>0);root.querySelectorAll('[data-action="playtest-loop"]').forEach(button=>button.disabled=typeof window.feedBack?.capabilities?.dispatch!=='function'||(!vocal&&(!!arrangement().editorOnly||!!arrangement().readOnly))||!ready||typeof window.feedBack?.setLoop!=='function'||!((vocal?vocalSelectionRange:selectionRange)||loopRegionDefined));}
 function renderInspector(){
  refreshActionAvailability();
  const a=arrangement(),n=selected()[0],content=$('inspector-content');root.querySelectorAll('[data-inspector]').forEach(b=>b.classList.toggle('active',b.dataset.inspector===inspector));
  if(a.readOnly){content.innerHTML=`<h3>Retained source score</h3><p>${esc(a.name)} · ${esc(a.instrument||'notation')}</p><p class="ws-muted">This score is preserved without conversion to editable tab. Note editing and native playtest are unavailable for this part.</p><p>Source: ${esc(a._entry?.notation||'Original score data')}</p><h3>Song details</h3>${field('Title','meta-title',project().title)}${field('Artist','meta-artist',project().artist)}${field('Album','meta-album',project().album||'')}${field('Year','meta-year',project().year??2026,'number')}${field('Duration','meta-duration',project().duration,'number','min="0" step="0.1"')}`;for(const key of ['title','artist','album','year','duration'])on($(`meta-${key}`),'change',safe(e=>change(`Set ${key}`,p=>{if(key==='year'&&!e.target.value.trim())delete p.year;else p[key]=['duration','year'].includes(key)?Number(e.target.value):e.target.value;})));return;}
  if(!chartEditing()&&['properties','chords'].includes(inspector)){content.innerHTML='<h3>Chart editing</h3><p class="ws-muted">Open Tab or Tempo to edit notes, chords and timeline markers.</p><button data-action="tab">Open chart</button>';return;}
  if(inspector==='properties'&&markerSelection){const {kind,index}=markerSelection,item=markerList(kind)?.[index];if(item){const timeKey=kind==='sections'?'start_time':'time';content.innerHTML=`<h3>${esc(kind.replaceAll('_',' '))}</h3>${field('Time (s)','marker-time',item[timeKey],'number','min="0" step="0.001"')}${kind==='anchors'?field(fretCaption(),'marker-fret',shownFret(item.fret),'number',fretBounds(a.capo>0?0:1))+field('Width','marker-width',item.width||4,'number','min="1" max="24"'):field('Name','marker-name',item.name||'')}${kind==='phrases'?field('Maximum difficulty','marker-difficulty',item.maxDifficulty||0,'number','min="0" max="255"'):''}<button data-action="marker-delete" class="ws-wide">Remove selected marker</button>`;for(const [id,key]of [['time',timeKey],['name','name'],['fret','fret'],['width','width'],['difficulty','maxDifficulty']])on($(`marker-${id}`),'change',safe(e=>change(`Edit ${kind}`,()=>{item[key]=key==='name'?e.target.value:key==='fret'?readFret(e.target.value,false,a.capo>0?0:1):Number(e.target.value);if(key===timeKey){const list=markerList(kind);list.sort((x,y)=>x[timeKey]-y[timeKey]);markerSelection.index=list.indexOf(item);}})));return;}markerSelection=null;}
  if(inspector==='chords'){
   const library=a.chord_templates.map((c,i)=>({c,i}));if(chordLibrarySort!=='created')library.sort((x,y)=>(chordLibrarySort==='name-desc'?-1:1)*String(x.c.name||'').localeCompare(String(y.c.name||''))||x.i-y.i);
   content.innerHTML='<h3>Chord library</h3><input id="ws-chord-filter" type="search" placeholder="Search chords" class="ws-wide"><p class="ws-muted">Select simultaneous notes, then F to create a chord. Click a saved chord to insert a zone with the settings below. Fingerprint-only adds a hand shape without a strum.</p>'+`<label>Sort<select id="ws-chord-sort"><option value="created" ${chordLibrarySort==='created'?'selected':''}>Order created</option><option value="name" ${chordLibrarySort==='name'?'selected':''}>Name A to Z</option><option value="name-desc" ${chordLibrarySort==='name-desc'?'selected':''}>Name Z to A</option></select></label>`+field('Chord length (beats)','chord-length',chordZoneOptions.lengthBeats,'number','min="0.001" max="10000" step="0.25"')+field('Shorten by gutter (beats)','chord-gutter',chordZoneOptions.gutterBeats,'number','min="0" step="0.03125"')+`<label><input id="ws-chord-fingerprint" type="checkbox" ${chordZoneOptions.fingerprintOnly?'checked':''}>Fingerprint zone only</label>`+library.map(({c,i})=>`<div class="ws-chord-record" data-chord-name="${esc((c.name||'Chord').toLowerCase())}"><button class="ws-chord-item" data-chord="${i}" draggable="true" title="Double-click to insert; drag onto the timeline"><strong>${esc(c.name)}</strong><br><span class="ws-muted">${c.frets.map(f=>f<0?'×':shownFret(f)).join(' · ')}</span></button><button data-chord-edit="${i}">Edit</button><button data-chord-clone="${i}">Clone</button><button data-chord-delete="${i}" title="Delete unused template" aria-label="Delete ${esc(c.name)}">Delete</button></div>`).join('')+'<button data-action="chord" class="ws-wide">Create chord…</button><button data-action="chord-split" class="ws-wide">Split selected chords…</button><h3>Hand-shape zones</h3><p class="ws-muted">Resize uses the beat length and gutter above; notes stay unchanged.</p>'+a.handshapes.map((h,i)=>{const style=chordZoneStyle(a,i);return `<div class="ws-chord-record"><button data-zone-go="${i}">${esc(a.chord_templates[h.chord_id]?.name||'Chord')} - ${seconds(h.start_time)} to ${seconds(h.end_time)}</button><button data-zone-resize="${i}">Resize</button><label>Presentation<select data-zone-kind="${i}">${['chord','fingerprint','arpeggio'].map(kind=>`<option ${style.kind===kind?'selected':''}>${kind}</option>`).join('')}</select></label><label><input type="checkbox" data-zone-hide="${i}" ${style.hideName||style.kind==='fingerprint'?'checked':''} ${style.kind!=='chord'?'disabled':''}>Hide chord name</label></div>`;}).join('')+'<p class="ws-muted">Drag a zone body to move its notes and strums; drag its blue end to resize. Shift+F cycles presentation; Ctrl+Shift+H toggles the name. Presentation keeps every musical note. Native arpeggio and hidden-name modes cannot combine; fingerprint display uses an ordinary handshape with the native no-name convention.</p>';
   on($('chord-filter'),'input',e=>{content.querySelectorAll('[data-chord-name]').forEach(el=>el.hidden=!el.dataset.chordName.includes(e.target.value.toLowerCase()));});
   on($('chord-sort'),'change',e=>{chordLibrarySort=e.target.value;renderInspector();});
   for(const [id,key]of [['chord-length','lengthBeats'],['chord-gutter','gutterBeats']])on($(id),'change',e=>chordZoneOptions[key]=Number(e.target.value));
   on($('chord-fingerprint'),'change',e=>chordZoneOptions.fingerprintOnly=e.target.checked);
   return;
  }
  if(inspector==='properties'){
   content.innerHTML=`<h3>${selected().length} selected ${a.type==='drums'?'hits':'notes'}</h3>`+(n?`${field('Time (seconds)','note-time',n.time,'number','min="0" step="0.001"')}${a.type==='keys'?field('MIDI pitch','note-pitch',notePitch(a,n),'number','min="0" max="127"'):a.type==='drums'?`<label>Kit piece<select id="ws-note-piece">${drumLayout(a).lanes.map(item=>`<option value="${esc(item.id)}" ${item.id===n.piece?'selected':''}>${esc(item.label)}</option>`).join('')}</select></label>${field('Velocity','note-velocity',n.velocity||100,'number','min="1" max="127"')}`:field(fretCaption(),'note-fret',shownFret(n.fret),'number',fretBounds())}${field('Sustain (s)','note-sustain',n.sustain,'number','min="0" step="0.01"')}${a.type==='keys'?field('Velocity','piano-velocity',n.velocity??100,'number','min="0" max="127" step="1" required')+`<label>Hand<select id="ws-note-hand"><option value="rh" ${n.hand!=='lh'?'selected':''}>Right</option><option value="lh" ${n.hand==='lh'?'selected':''}>Left</option></select></label>`:''}<h3>Techniques</h3><div class="ws-techniques">${TECHNIQUES.map(t=>`<label><input type="checkbox" data-technique="${t}" ${n.techniques[t]?'checked':''}>${t.replaceAll('_',' ')}</label>`).join('')}</div>${field('Bend (semitones)','note-bend',n.techniques.bend||0,'number','min="0" max="12" step="0.5"')}`:'<p class="ws-muted">Click a note or drag a selection in the timeline.</p>');
   for(const [id,key]of [['time','time'],['fret','fret'],['sustain','sustain'],['pitch','pitch'],['velocity','velocity']])on($(`note-${id}`),'change',safe(e=>{if(key==='time')moveSelected(Number(e.target.value)-selected()[0].time);else if(key==='sustain'){const value=Number(e.target.value);editSustains('Set sustain',()=>value);}else if(key==='velocity'){const value=Number(e.target.value),minimum=a.type==='drums'?1:0;if(!e.target.value.trim()||!Number.isInteger(value)||value<minimum||value>127)throw Error(`Velocity must be an integer from ${minimum} to 127`);editSelection('Set velocity',n=>n.velocity=value);}else editSelection(`Set ${key}`,n=>{n[key]=key==='fret'?readFret(e.target.value):Number(e.target.value);});}));
   if($('note-hand')){$('note-hand').insertAdjacentHTML('afterbegin','<option value="">Unassigned</option>');$('note-hand').value=n.hand||'';}
   if(n)for(const input of content.querySelectorAll('[data-technique]')){const states=selected().map(note=>techniqueEnabled(note,input.dataset.technique));input.checked=states.every(Boolean);input.indeterminate=states.some(Boolean)&&!input.checked;}
   if($('note-velocity')){$('note-velocity').value=n.velocity??100;$('note-velocity').min=a.type==='drums'?1:0;$('note-velocity').step=1;$('note-velocity').required=true;}
   on($('note-piece'),'change',safe(e=>editSelection('Set kit piece',n=>n.piece=e.target.value)));on($('note-hand'),'change',safe(e=>{const hand=e.target.value;change('Set hand',()=>assignHands(arrangement(),{ids:selection,mode:hand||'clear'}));}));on($('note-bend'),'change',safe(e=>editSelection('Set bend',n=>n.techniques.bend=Number(e.target.value))));
   if(n&&a.type==='drums'&&drumGuideCue(n.piece).generic)content.insertAdjacentHTML('beforeend',`<p class="ws-warning">${esc(drumGuideCue(n.piece).warning)}</p>`);
   if(n&&a.type==='drums'){content.insertAdjacentHTML('beforeend',`<h3>Drum articulation</h3><label><input type="checkbox" id="ws-drum-ghost" ${n.ghost?'checked':''}>Ghost hit</label><label><input type="checkbox" id="ws-drum-flam" ${n.flam?'checked':''}>Flam</label>${field('Choke after (s)','drum-choke',n.choke||0,'number','min="0" step="0.01"')}`);for(const key of ['ghost','flam'])on($(`drum-${key}`),'change',safe(e=>editSelection(`Drum ${key}`,n=>n[key]=e.target.checked)));on($('drum-choke'),'change',safe(e=>editSelection('Drum choke',n=>n.choke=Number(e.target.value))));}
   else if(n){content.insertAdjacentHTML('beforeend',field('Slide destination ('+fretCaption()+')','note-slide',shownFret(n.techniques.slide_to??-1),'number',`min="-1" max="${fretLimits(a.capo,fretConvention).max}"`)+field('Left finger','note-finger',n.techniques.left_hand??-1,'number','min="-1" max="4"')+'<button data-action="bend-curve" class="ws-wide">Edit bend curve…</button><button data-action="handshape" class="ws-wide">Create hand-shape zone</button>');on($('note-slide'),'change',safe(e=>editSelection('Set slide',n=>n.techniques.slide_to=readFret(e.target.value,true))));on($('note-finger'),'change',safe(e=>editSelection('Set finger',n=>n.techniques.left_hand=Number(e.target.value))));
    if(['guitar','bass'].includes(a.type)){
     content.insertAdjacentHTML('beforeend',field('Unpitched slide ('+fretCaption()+')','note-slide-unpitched',shownFret(n.techniques.slide_unpitch_to??-1),'number',`min="-1" max="${fretLimits(a.capo,fretConvention).max}"`)+field('Native vibrato value','note-vibrato',Number(n.techniques.vibrato)||0,'number','min="0" max="255" step="1"'));
     on($('note-slide-unpitched'),'change',safe(e=>{const fret=readFret(e.target.value,true);editSelection('Set unpitched slide',n=>n.techniques.slide_unpitch_to=fret);}));
     on($('note-vibrato'),'change',safe(e=>{const raw=e.target.value.trim(),value=Number(raw);if(!raw||!Number.isInteger(value)||value<0||value>255)throw Error('Native vibrato value must be a whole number from 0 to 255');editSelection('Set vibrato value',n=>n.techniques.vibrato=value);}));
     content.insertAdjacentHTML('beforeend',`<label>Force destination pitch<select id="ws-note-force-destination">${['Auto','On','Off'].map((label,value)=>`<option value="${value}" ${Number(n.techniques.force_destination_pitch||0)===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="ws-muted">Retained in editable JSON and FeedBack authoring data. Stock RS2014 export requires Auto; its engine has no confirmed equivalent.</p>`);
     on($('note-force-destination'),'change',safe(e=>{const value=Number(e.target.value);if(![0,1,2].includes(value))throw Error('Choose Auto, On or Off for destination pitch');editSelection('Set force destination pitch',n=>n.techniques.force_destination_pitch=value);}));
     content.insertAdjacentHTML('beforeend',field('Native tap finger/value','note-tap-value',Number(n.techniques.tap)||0,'number','min="-128" max="127" step="1"')+`<p class="ws-muted">0 is off; positive values retain the native tap value. Negative source values are preserved without an active tap.</p><label>Picking direction<select id="ws-note-picking">${[[-1,'Unspecified'],[0,'Downstroke'],[1,'Upstroke']].map(([value,label])=>`<option value="${value}" ${Number(n.techniques.pick_direction??-1)===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Bend intent<select id="ws-note-bend-intent">${['Up','Release','Pre-bend','Pre-bend and release','Round-trip'].map((label,value)=>`<option value="${value}" ${Number(n.techniques.bend_type??0)===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="ws-muted">Bend intent is a FeedBack annotation. Edit the bend curve to define its sound and stock Rocksmith bend shape.</p>`);
     on($('note-tap-value'),'change',safe(e=>{const raw=e.target.value.trim(),value=Number(raw);if(!raw||!Number.isInteger(value)||value< -128||value>127)throw Error('Tap value must be a whole number from -128 to 127');editSelection('Set tap value',n=>n.techniques.tap=value);}));
     for(const [id,key,values]of [['note-picking','pick_direction',[-1,0,1]],['note-bend-intent','bend_type',[0,1,2,3,4]]])on($(id),'change',safe(e=>{const value=Number(e.target.value);if(!values.includes(value))throw Error('Choose a valid '+key.replaceAll('_',' '));editSelection('Set '+key.replaceAll('_',' '),n=>n.techniques[key]=value);}));
     const chords=a.chords.filter(chord=>(chord.notes||[]).some(note=>selection.has(note.id)));
     if(chords.length){content.insertAdjacentHTML('beforeend',`<label><input id="ws-chord-density" type="checkbox" ${chords.every(chord=>chord.highDensity)?'checked':''}>High-density chord strum</label>`);$('chord-density').indeterminate=chords.some(chord=>chord.highDensity)&&!chords.every(chord=>chord.highDensity);on($('chord-density'),'change',safe(e=>{const highDensity=e.target.checked;change('Set chord density',()=>{for(const chord of arrangement().chords)if((chord.notes||[]).some(note=>selection.has(note.id)))chord.highDensity=highDensity;});}));}
    }
   }
   on($('piano-velocity'),'change',safe(e=>{const value=Number(e.target.value);if(!e.target.value.trim()||!Number.isInteger(value)||value<0||value>127)throw Error('Piano velocity must be an integer from 0 to 127');editSelection('Key velocity',n=>n.velocity=value);}));
   return;
  }
  content.innerHTML=`<h3>Song details</h3>${field('Title','meta-title',project().title)}${field('Artist','meta-artist',project().artist)}${field('Album','meta-album',project().album||'')}${field('Year','meta-year',project().year??'','number','min="1000" max="9999"')}${field('Duration','meta-duration',project().duration,'number','min="1" step="0.1"')}<button data-action="audio" class="ws-wide">Import song audio…</button><h3>Arrangement settings</h3>${field('Name','arr-name',a.name)}<label>Authoring family<select id="ws-arr-type">${['guitar','bass','keys','drums'].map(t=>`<option ${a.type===t?'selected':''}>${t}</option>`).join('')}</select></label>${['guitar','bass'].includes(a.type)?`<label>Strings<select id="ws-string-count">${[4,5,6,7,8].map(n=>`<option ${a.stringCount===n?'selected':''}>${n}</option>`).join('')}</select></label>${field('Capo','arr-capo',a.capo,'number','min="0" max="24"')}<h3>String tuning</h3><p class="ws-muted">Semitones from standard for each string, low to high (-2 is a whole step down). The note is the open string, capo not included.</p><div class="ws-tuning">${Array.from({length:a.stringCount},(_,i)=>{const v=a.tuning[i]??0,base=a.basePitches?.[i]??standardPitches(a.type,a.stringCount)[i],standard=noteName(base);return`<div class="ws-tune"><span>${noteName(base+v)}</span><input type="number" step="1" data-tuning="${i}" value="${v}" aria-label="String ${i+1} (standard ${standard}) offset in semitones" title="String ${i+1}: standard ${standard}, offset in semitones"></div>`;}).join('')}</div>`:''}<h3>Beat map</h3>${field('BPM at cursor','bpm',Number($('bpm-display').textContent),'number','min="10" max="500" step="0.01"')}<p class="ws-muted">Sets the tempo from the cursor to the end of the song. Notes follow only if the checkbox is ticked.</p><button data-action="tempo-reset" class="ws-wide">Set constant tempo…</button><button data-action="tap" class="ws-wide">Tap tempo</button><h3>Practice ramp</h3><label><input id="ws-ramp-enabled" type="checkbox" ${ramp.enabled?'checked':''}>Enable speed ramp</label>${field('Start speed (%)','ramp-start',Math.round(ramp.startSpeed*100),'number','min="25" max="200"')}${field('End speed (%)','ramp-end',Math.round(ramp.endSpeed*100),'number','min="25" max="200"')}${field('Ramp duration (s)','ramp-duration',ramp.duration,'number','min="1" max="600"')}<h3>Loop region</h3>${field('Start (s)','loop-start',audio.loop?.start??0,'number','min="0" step="0.1"')}${field('End (s)','loop-end',audio.loop?.end??project().duration,'number','min="0" step="0.1"')}<button data-action="loop" class="ws-wide">${loop?'Disable':'Enable'} loop</button><p class="ws-muted">Pitch and speed are independent. Granular preview may soften transients. Exports keep the source audio unchanged.</p>`;
  content.insertAdjacentHTML('beforeend',`<h3>Preview audio</h3><label>Processing<select id="ws-preview-quality"><option value="fast" ${audio.quality==='fast'?'selected':''}>Fast granular</option><option value="spectral" ${audio.quality==='spectral'?'selected':''}>Spectral (experimental)</option></select></label><p class="ws-muted">Spectral processing prepares in the background and uses more CPU to retain pitches in mixed audio during slowdown. Fast preview starts quickly. Both may soften transients; source audio stays unchanged.</p><p id="ws-quality-status" class="ws-muted">${esc(qualityMessage)}</p>`);
  on($('preview-quality'),'change',safe(async e=>{const value=e.target.value;countIn.cancel();await audio.setQuality(value);persistPreferences();updateClock();}));
  if(a.type!=='drums'){
   const voice=resolveGuideVoice(a,{rigLibrary:project().rigLibrary,time:cursor}),explicit=voice.source==='editor-override';
   content.insertAdjacentHTML('beforeend',`<h3>Guide instrument</h3><label>Offline voice<select id="ws-guide-family"><option value="source" ${!explicit?'selected':''}>Follow source / default</option>${GUIDE_VOICE_FAMILIES.map(profile=>`<option value="${profile.id}" ${explicit&&voice.profile.id===profile.id?'selected':''}>${esc(profile.label)}</option>`).join('')}</select></label>${field('GM program (0-127)','guide-program',explicit?voice.program:0,'number',`min="0" max="127" step="1" ${explicit?'':'disabled'}`)}<p class="ws-muted">Original synthesized families provide local guidance without downloads. Eight GM programs share each family sound. An explicit choice applies to this whole part and is retained as editor authoring data; it leaves native tone bindings unchanged.</p>${voice.warnings.length?`<p class="ws-warning">${esc(voice.warnings.join('. '))}</p>`:''}`);
   on($('guide-family'),'change',safe(e=>{const value=e.target.value;change('Set guide voice',()=>{if(value==='source')delete a.guideVoice;else a.guideVoice=guideVoiceSetting(value);});}));
   on($('guide-program'),'change',safe(e=>{const value=Number(e.target.value);if(!Number.isInteger(value)||value<0||value>127)throw Error('Choose a whole GM program from0 to127');const family=GUIDE_VOICE_FAMILIES[Math.floor(value/8)].id;change('Set guide GM intent',()=>a.guideVoice=guideVoiceSetting(family,{program:value}));}));
  }
  if(['guitar','bass'].includes(a.type)){ $('arr-capo').closest('label').insertAdjacentHTML('afterend',`<label>Fret display<select id="ws-fret-convention"><option value="relative" ${fretConvention==='relative'?'selected':''}>FeedBack: capo-relative</option><option value="physical" ${fretConvention==='physical'?'selected':''}>Editor: physical from nut</option></select></label><p class="ws-muted">${fretConvention==='physical'?`Capo ${a.capo}: open strings display ${a.capo}. Entries below the capo are unavailable.`:'Open strings display 0. Stored charts always use frets relative to the capo.'}</p>`);on($('fret-convention'),'change',e=>{fretConvention=e.target.value;render();});}
  if(a.type==='drums'){const layout=drumLayout(a);if(layout.warnings.length)content.insertAdjacentHTML('beforeend',`<h3>Drum lanes</h3><p class="ws-warning">${esc(layout.warnings.join('. '))}. Local custom-hit audition uses a generic percussion cue; the current native highway cannot grade these IDs.</p>`);}
  if(['keys','drums'].includes(a.type)){content.insertAdjacentHTML('beforeend',`<label>Lane orientation<select id="ws-roll-orientation"><option value="left" ${rollOrientations[a.type]==='left'?'selected':''}>Left edge · time to the right</option><option value="bottom" ${rollOrientations[a.type]==='bottom'?'selected':''}>Bottom edge · time rising</option></select></label>`);on($('roll-orientation'),'change',()=>setRollOrientation($('roll-orientation').value));}
  if(a.type==='keys'){content.insertAdjacentHTML('beforeend',`<h3>Piano view range</h3>${field('Lowest MIDI pitch','piano-low',pianoLow,'number','min="0" max="126"')}${field('Highest MIDI pitch','piano-high',pianoHigh,'number','min="1" max="127"')}`);for(const id of ['piano-low','piano-high'])on($(id),'change',safe(()=>{const low=Number($('piano-low').value),high=Number($('piano-high').value);if(!Number.isInteger(low)||!Number.isInteger(high)||low<0||high>127||high<=low)throw Error('Choose an ordered MIDI pitch range from 0 to 127');pianoLow=low;pianoHigh=high;lane=Math.max(low,Math.min(high,lane));render();}));}
  $('arr-name').closest('label').insertAdjacentHTML('afterend','<button data-action="manage-parts" class="ws-wide">Manage arrangements…</button>'+(a.type==='drums'?'<button data-action="drum-lanes" class="ws-wide">Drum lanes…</button>':''));
  if(a.type==='keys'){content.insertAdjacentHTML('beforeend',`<h3>Piano hands</h3><button data-action="assign-hands" class="ws-wide">Assign hands…</button><label><input id="ws-hand-shading" type="checkbox" ${shadeHands?'checked':''}>Hand shading</label><p class="ws-muted">Blue edge: left hand. Amber edge: right hand. Unassigned notes keep their pitch color.</p><label>Note colors <select id="ws-piano-palette">${PIANO_PALETTES.map(([id,label])=>`<option value="${id}"${id===pianoPalette?' selected':''}>${label}</option>`).join('')}</select></label><p class="ws-muted">Presets other than Editor (original) follow FeedBack's Keys Highway 3D palettes; accidentals use the sharp colour, as there is no note spelling here.</p>`);on($('hand-shading'),'change',e=>{shadeHands=e.target.checked;persistPreferences();draw();});on($('piano-palette'),'change',e=>{pianoPalette=pianoPaletteId(e.target.value);persistPreferences();draw();renderBottom();});}
  if(a.type!=='drums'){content.insertAdjacentHTML('beforeend',field('Tuning reference (cents)','arr-cents',a.centOffset??0,'number','step="any"')+'<p class="ws-muted">0 uses A440. This detunes chart guidance and the instrument tuning reference; it leaves the backing recording unchanged.</p>');on($('arr-cents'),'change',safe(e=>{const raw=e.target.value.trim(),value=Number(raw);if(!raw||!Number.isFinite(value))throw Error('Tuning reference must be a finite number of cents');change('Set tuning reference',()=>a.centOffset=value);}));}
  {content.insertAdjacentHTML('beforeend',field('Instrument label','arr-instrument',a.instrument||a.type,'text','maxlength="64" list="ws-instrument-names"')+'<p class="ws-muted">The authoring family controls chart layout; this label names the instrument and does not select a sound model.</p>');on($('arr-instrument'),'change',safe(e=>{const value=e.target.value.trim();if(!value||value.length>64)throw Error('Enter an instrument name from 1 to 64 characters');change('Set pitched instrument',()=>a.instrument=value);}));}
  if(['guitar','bass'].includes(a.type)){const inferred=a.role||(a.type==='bass'?'bass':/rhythm/i.test(a.name)?'rhythm':'lead');content.insertAdjacentHTML('beforeend',`<h3>Build role</h3><label>Arrangement role<select id="ws-arr-role">${(a.type==='bass'?['bass']:['lead','rhythm']).map(role=>`<option ${role===inferred?'selected':''}>${role}</option>`).join('')}</select></label><label>Priority<select id="ws-arr-priority">${['auto','main','alternative','bonus'].map(priority=>`<option ${priority===(a.priority||'auto')?'selected':''}>${priority}</option>`).join('')}</select></label>`);on($('arr-role'),'change',e=>change('Set arrangement role',()=>a.role=e.target.value));on($('arr-priority'),'change',e=>change('Set arrangement priority',()=>{if(e.target.value==='auto')delete a.priority;else a.priority=e.target.value;}));}
  if(['guitar','bass'].includes(a.type)){content.insertAdjacentHTML('beforeend',`<h3>String view</h3><label><input id="ws-invert-strings" type="checkbox" ${invertStrings?'checked':''}>Invert string order</label>`);on($('invert-strings'),'change',e=>{invertStrings=e.target.checked;draw();});}
  if(['guitar','bass'].includes(a.type)){
   const presets=[['Standard',Array(a.stringCount).fill(0)],['Drop lowest string',Array.from({length:a.stringCount},(_,i)=>i===0?-2:0)],['Half-step down',Array(a.stringCount).fill(-1)],['Whole-step down',Array(a.stringCount).fill(-2)],['Whole-step down + drop',Array.from({length:a.stringCount},(_,i)=>i===0?-4:-2)]];
   const current=presets.findIndex(([,offsets])=>offsets.every((v,i)=>v===a.tuning[i]));
   $('arr-capo').closest('label').insertAdjacentHTML('afterend',`<label>Tuning preset<select id="ws-tuning-preset"><option value="custom" ${current<0?'selected':''}>Custom</option>${presets.map(([label,offsets],i)=>`<option value="${i}" ${current===i?'selected':''}>${esc(label)} · ${offsets.map((v,s)=>noteName(a.basePitches[s]+v)).join(' ')}</option>`).join('')}</select></label>`);
   on($('tuning-preset'),'change',safe(e=>{if(e.target.value==='custom')return;change('Set tuning preset',()=>{a.tuning=[...presets[Number(e.target.value)][1]];});}));
  }
  for(const key of ['title','artist','album','year','duration'])on($(`meta-${key}`),'change',safe(e=>change(`Set ${key}`,p=>{if(key==='year'&&!e.target.value.trim())delete p.year;else p[key]=['duration','year'].includes(key)?Number(e.target.value):e.target.value;})));
  on($('arr-name'),'change',e=>change('Rename arrangement',()=>a.name=e.target.value));on($('string-count'),'change',safe(e=>change('Change strings',()=>setStringCount(a,Number(e.target.value)))));on($('arr-capo'),'change',safe(e=>{const capo=validCapo(e.target.value);change('Set capo',()=>a.capo=capo);}));
  on($('arr-type'),'change',safe(e=>{if([a,...a.difficulties||[]].some(content=>content.notes?.length||content.chords?.length)||a.chord_templates.length)throw Error('Create another arrangement to change instrument without losing authored content');changeScope('Change instrument',()=>{const replacement=makeArrangement(e.target.value);Object.assign(a,replacement);arrangementId=a.id;});}));
  on($('bpm'),'change',safe(e=>change('Set tempo from cursor',p=>setTempo(p,Number(e.target.value),{start:Math.max(0,Math.min(p.beats.length-2,Math.floor(beatAt(p.beats,cursor)))),moveNotes:$('move-notes').checked}))));
  for(const id of ['ramp-enabled','ramp-start','ramp-end','ramp-duration'])on($(id),'change',()=>{countIn.cancel();ramp={enabled:$('ramp-enabled').checked,startSpeed:Number($('ramp-start').value)/100,endSpeed:Number($('ramp-end').value)/100,duration:Number($('ramp-duration').value)};audio.setRamp(ramp);});
 }

 // Stave view (bottom panel): standard notation of the current chart on the
 // roll's own time axis. It repaints from draw(), so scrolling, zoom, playback
 // and selection stay in step; edits go through change() like any roll edit.
 function staveKey(a){
  const state=history.stateId;if(staveKeyCache?.a===a&&staveKeyCache.state===state)return staveKeyCache.key;
  const key=a.type==='drums'?{name:'',fifths:0}:keyFromSignature(a.keySignature)||guessKey(editableNotes().map(n=>notePitch(a,n)));
  staveKeyCache={a,state,key};return key;
 }
 function staveTimeMap(canvasEl,left){
  const roll=canvas.getBoundingClientRect(),own=canvasEl.getBoundingClientRect(),offset=roll.left-own.left;
  // Left-to-right roll: the stave uses its exact x for each time. Rotated roll: same time window, own x.
  if(bottomRoll())return {xs:t=>left+t*zoom-timeScroll(),timeAt:x=>(x-left+timeScroll())/zoom};
  return {xs:t=>xOf(t)+offset,timeAt:x=>timeOf(x-offset)};
 }
 // Live view: the current part as a Rocksmith-style highway, in step with the cursor and playback.
 const chordMembers=new WeakMap();
 function drawLivePanel(){
  const el=$('live');if(!el||!el.isConnected||liveViz)return;
  const a=arrangement(),width=Math.max(300,el.parentElement.clientWidth),height=Math.max(160,Math.floor($('bottom').getBoundingClientRect().bottom-el.getBoundingClientRect().top-6)),dpr=Math.min(window.devicePixelRatio||1,2);
  if(el.width!==Math.floor(width*dpr)||el.height!==Math.floor(height*dpr)){el.width=Math.floor(width*dpr);el.height=Math.floor(height*dpr);el.style.width=width+'px';el.style.height=height+'px';}
  const pen=el.getContext('2d');pen.setTransform(dpr,0,0,dpr,0,0);
  const index=draw.cache?.arrangement===a?draw.cache:bandIndex(a);
  let members=chordMembers.get(a);if(!members||members.count!==a.chords.length){members={count:a.chords.length,ids:new Set(a.chords.flatMap(c=>(c.notes||[]).map(n=>n.id)))};chordMembers.set(a,members);}
  const last=(list,t,key='time')=>{let found=null;for(const item of list)if((item[key]??0)<=t+1e-4)found=item;return found;};
  drawLiveView(pen,{width,height,arrangement:a,time:audio.isPlaying?audio.currentTime:cursor,playing:audio.isPlaying,options:liveOptions,
   notes:(t0,t1)=>index.notesBetween(t0,t1).filter(n=>!members.ids.has(n.id)),chords:(t0,t1)=>index.chordsBetween(t0,t1),zones:(t0,t1)=>index.zonesBetween(t0,t1).map(row=>row.item),
   anchorAt:t=>index.anchorAt(t),anchors:[...a.anchors].sort((x,y)=>x.time-y.time),templates:a.chord_templates,beats:project().beats,isRepeat:c=>index.compactChords.has(c),
   phraseAt:t=>last(a.phrases,t)?.name||'',sectionAt:t=>last(project().sections,t,'start_time')?.name||'',
   stringColor:s=>stringColor(a,s),chordLabel:(template,notes)=>chordLabel(a,template,notes),techniqueTags,shownFret});
 }
 // FeedBack's visualisation plugins register a renderer factory as window.feedBackViz_<id>.
 // Only those made for the part's instrument are offered: drums, keys/piano, vocals, else guitar and bass.
 const feedbackRenderers=(a=arrangement())=>Object.keys(window).filter(key=>/^feedBackViz_/.test(key)&&typeof window[key]==='function').filter(key=>{
  const id=key.replace(/^feedBackViz_/,'').toLowerCase(),kind=/drum/.test(id)?'drums':/keys|piano/.test(id)?'keys':/vocal|lyric/.test(id)?'vocals':'fretted';
  return kind===(a.type==='drums'?'drums':a.type==='keys'?'keys':'fretted');
 }).sort();
 const rendererLabel=key=>'FeedBack '+key.replace(/^feedBackViz_/,'').replaceAll('_',' ');
 function stopLiveViz(){
  if(!liveViz)return;cancelAnimationFrame(liveViz.frame);clearTimeout(liveViz.fetchTimer);
  try{liveViz.renderer?.destroy?.();}catch(error){console.warn('FeedBack renderer destroy failed',error);}
  liveViz=null;
 }
 // The chart for the FeedBack renderer, fetched again shortly after each edit.
 function liveVizData(){
  const a=arrangement(),key=`${history.stateId}|${a.id}`;
  if(liveViz.dataKey===key||liveViz.fetching===key)return;
  clearTimeout(liveViz.fetchTimer);
  liveViz.fetchTimer=setTimeout(async()=>{
   const viz=liveViz;if(!viz)return;viz.fetching=key;
   const slim={...a,difficulties:undefined,_rplus:undefined};
   try{
    const response=await fetch(`${API}/live-bundle`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({arrangement:slim,beats:project().beats,sections:project().sections,info:{title:project().title,artist:project().artist,duration:project().duration}})});
    if(!response.ok)throw Error(await response.text());
    const data=await response.json();if(liveViz!==viz)return;
    viz.data=data;viz.dataKey=key;viz.fetching=null;
   }catch(error){if(liveViz===viz)viz.fetching=null;status(`Live view: ${error.message}`,true);}
  },liveViz.data?300:0);
 }
 // FeedBack renderer frame: OCE's clock and view options on top of the fetched chart.
 function liveVizFrame(){
  const viz=liveViz;if(!viz)return;
  viz.frame=requestAnimationFrame(liveVizFrame);
  if(bottom!=='live'||!viz.canvas.isConnected){stopLiveViz();return;}
  liveVizData();if(!viz.data)return;
  const host=viz.canvas.parentElement,width=Math.max(300,host.clientWidth),height=Math.max(160,Math.floor($('bottom').getBoundingClientRect().bottom-host.getBoundingClientRect().top-6));
  if(viz.width!==width||viz.height!==height){viz.width=width;viz.height=height;host.style.height=height+'px';viz.canvas.style.width=width+'px';viz.canvas.style.height=height+'px';viz.canvas.width=width;viz.canvas.height=height;try{viz.renderer?.resize?.(width,height);}catch{}}
  const d=viz.data,b=viz.bundle??={};
  Object.assign(b,{currentTime:audio.isPlaying?audio.currentTime:cursor,isPlaying:audio.isPlaying,isReady:true,songInfo:d.songInfo,notes:d.notes,chords:d.chords,anchors:d.anchors,
   beats:d.beats,sections:d.sections,chordTemplates:d.chordTemplates,handShapes:d.handShapes,stringCount:d.stringCount,tuning:d.songInfo.tuning,capo:d.songInfo.capo,centOffset:d.songInfo.centOffset,
   lyrics:[],lyricsSource:null,toneChanges:[],toneBase:'',toneBaseRig:null,rigs:null,drumTab:null,mastery:1,hasPhraseData:false,
   inverted:!liveOptions.lowStringTop,lefty:liveOptions.leftHanded,renderScale:1,lyricsVisible:false,teachingMarksVisible:false,fingerHintsVisible:true,
   lowerBoundT:lowerBound('t'),lowerBoundTime:lowerBound('time'),getNoteState:()=>null,getNoteStateProvider:()=>null});
  try{
   if(!viz.started){viz.started=true;viz.renderer.init(viz.canvas,b);}
   viz.renderer.draw(b);
  }catch(error){console.error('FeedBack renderer failed',error);status(`${rendererLabel(viz.key)} could not draw this part (${error.message}); back to the OCE highway`,true);liveOptions={...liveOptions,renderer:'oce'};stopLiveViz();renderBottom();}
 }
 const lowerBound=key=>(list,t)=>{let lo=0,hi=list?.length||0;while(lo<hi){const mid=(lo+hi)>>1;if(list[mid][key]<t)lo=mid+1;else hi=mid;}return lo;};
 function startLiveViz(key,canvas){
  stopLiveViz();
  let renderer=null;
  try{renderer=window[key]();}catch(error){status(`${rendererLabel(key)} could not start: ${error.message}`,true);return false;}
  liveViz={key,renderer,canvas,data:null,dataKey:null,fetching:null,started:false,frame:0,fetchTimer:0};
  liveVizFrame();return true;
 }
 function drawStavePanel(){
  const el=$('stave');if(!el||!el.isConnected)return;
  const a=arrangement(),width=Math.max(300,el.parentElement.clientWidth),height=Math.max(150,Math.floor($('bottom').getBoundingClientRect().bottom-el.getBoundingClientRect().top-6)),dpr=Math.min(window.devicePixelRatio||1,2);
  if(el.width!==Math.floor(width*dpr)||el.height!==Math.floor(height*dpr)){el.width=Math.floor(width*dpr);el.height=Math.floor(height*dpr);el.style.width=width+'px';el.style.height=height+'px';}
  const pen=el.getContext('2d');pen.setTransform(dpr,0,0,dpr,0,0);
  const layout=staveLayout(a),key=staveKey(a),metrics=staveMetrics(layout,height),left=clefColumn(metrics.half,key.fifths),map=staveTimeMap(el,left);
  const t0=map.timeAt(left)-2,t1=map.timeAt(width)+2,beats=project().beats;
  const downbeats=beats.filter(b=>b.measure>=0).map(b=>b.time);
  const barOf=t=>{let lo=0,hi=downbeats.length;while(lo<hi){const mid=(lo+hi)>>1;if(downbeats[mid]<=t)lo=mid+1;else hi=mid;}return lo;};
  const beatLength=t=>{const i=Math.max(0,Math.min(beats.length-2,Math.floor(beatAt(beats,t))));return beats[i+1].time-beats[i].time;};
  const entries=layoutNotes(a,editableNotes().filter(n=>n.time>=t0-8&&n.time<=t1),{fifths:key.fifths,beatLength,barOf}),rests=layoutRests(entries,beats,{staves:layout.staves.length,from:t0,to:t1});
  const tuning=['guitar','bass'].includes(a.type)?` · ${a.stringCount} strings ${Array.from({length:a.stringCount},(_,s)=>noteName((a.basePitches[s]||0)+(a.tuning[s]||0)+(a.capo||0))).join(' ')}${a.capo?' (capo '+a.capo+')':''}`:'';
  const written=writtenNote(layout)?' · '+writtenNote(layout):'',instrument=layout.instrument?' · '+layout.instrument:'';
  const result=drawStave(pen,{arrangement:a,width,height,left,xOf:map.xs,beats:beats.filter(b=>b.time>=t0&&b.time<=t1),notes:entries,rests,showRests,selection,playhead:audio.isPlaying?audio.currentTime:null,cursor,fifths:key.fifths,theme:staveTheme,label:`${a.name}${instrument}${key.name?' · key '+key.name:''}${tuning}${written}${staveMode==='add'?' · Add: click the stave to place a note':''}`});
  staveHits=result.hits;staveMetricsCache={metrics:result.metrics,map,layout,key,a,left};
 }
 function staveShift(semitones){
  const a=arrangement();if(!selection.size)throw Error('Select notes on the stave or the roll first');
  if(a.type==='drums'){editSelection('Move drum hits on the stave',n=>{const piece=drumStepPiece(n.piece,Math.sign(semitones));if(piece)n.piece=piece;});return;}
  const moving=new Set(selection);let skipped=0;
  editSelection(Math.abs(semitones)===12?'Move notes an octave':'Transpose notes',n=>{
   const pitch=notePitch(a,n)+semitones;
   if(a.type==='keys'){if(pitch<0||pitch>127){skipped++;return;}n.pitch=pitch;n.string=Math.floor(pitch/24);n.fret=pitch%24;return;}
   // Strings already sounding at this time (other than notes moving with it) stay taken.
   const occupied=new Set(editableNotes().filter(o=>o!==n&&!moving.has(o.id)&&Math.abs(o.time-n.time)<1e-4).map(o=>o.string));
   const place=fretFor(a,pitch,{preferString:n.string,occupied,nearFret:n.fret});
   if(!place){skipped++;return;}n.string=place.string;n.fret=place.fret;
  });
  if(skipped)status(`${skipped} note${skipped>1?'s':''} left unchanged: outside this part's range or tuning`);
 }
 function staveSetLength(beats){
  staveLength=beats;if(!selection.size){status(`New stave notes: ${beats} beat${beats===1?'':'s'}`);renderBottom();return;}
  if(arrangement().type==='drums')throw Error('Drum hits have no length to set');
  editSelection('Set note length on the stave',n=>{const pb=project().beats;n.sustain=Math.max(0,timeAt(pb,beatAt(pb,n.time)+beats)-n.time);});
 }
 function staveInsert(x,y){
  const cache=staveMetricsCache;if(!cache)return;const {metrics,map,layout,key,a}=cache;
  const stave=metrics.staveAt(y),step=metrics.stepAt(stave,y),time=quantize(map.timeAt(x)),pb=project().beats,length=timeAt(pb,beatAt(pb,time)+staveLength)-time;
  let make;
  if(a.type==='drums'){const piece=drumPieceAt(step);make=()=>{const n=makeNote(a,time,DRUMS.indexOf(piece));n.piece=piece;return n;};}
  else{
   const pitch=pitchAtStep(step,key.fifths)-layout.transpose;
   if(a.type==='keys'){if(pitch<0||pitch>127)throw Error('That pitch is outside MIDI range');make=()=>{const n=makeNote(a,time,pitch,0,length);n.hand=layout.staves[stave].hand||'rh';return n;};}
   else{
    const occupied=new Set(editableNotes().filter(o=>Math.abs(o.time-time)<1e-4).map(o=>o.string)),place=fretFor(a,pitch,{occupied});
    if(!place)throw Error(`${spell(pitch,key.fifths).name} has no free string in this tuning`);
    make=()=>makeNote(a,time,place.string,place.fret,length);
   }
  }
  change('Add note on the stave',()=>{const n=make();a.notes.push(n);a.notes.sort((p,q)=>p.time-q.time);selection=new Set([n.id]);});
 }
 function wireStave(el){
  on(el,'pointerdown',safe(e=>{
   const r=el.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,hit=hitNote(staveHits,x,y);el.focus();
   if(hit){if(e.shiftKey||e.ctrlKey){if(selection.has(hit))selection.delete(hit);else selection.add(hit);}else selection=new Set([hit]);render();return;}
   const cache=staveMetricsCache;if(!cache||x<cache.left)return;
   if(staveMode==='add'){staveInsert(x,y);return;}
   setCursor(quantize(cache.map.timeAt(x)));if(!e.shiftKey)selection.clear();render();
  }));
  on(el,'keydown',safe(e=>{
   const shift={ArrowUp:e.shiftKey?12:1,ArrowDown:e.shiftKey?-12:-1}[e.key];
   if(shift){e.preventDefault();e.stopPropagation();staveShift(shift);}
   else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();if(selection.size)actions.delete();}
   else if(e.key==='Escape'&&staveMode==='add'){staveMode='select';renderBottom();draw();}
  }));
 }
 function renderBottom(){
  if(bottom!=='stave')delete $('bottom-content').dataset.stave;
  if(bottom!=='live'){delete $('bottom-content').dataset.live;stopLiveViz();}
  issueFinder.bind(history);const analysis=issueFinder.get(validationProfile);$('errors-label').textContent=`Errors (${analysis.errors.length}) / Warnings (${analysis.warnings.length})`;
  const el=$('bottom-content');if(bottom==='errors'){
   const page=issueFinder.page({profile:validationProfile,filter:issueFilter,page:issuePage});issuePage=page.page;
   el.innerHTML=`<h3>Arrangement Error Finder / ${page.total} findings <select id="ws-validation-profile" aria-label="Validation profile">${[['feedpak','FeedBack'],['cdlc','RS2014 stock'],['oce','Editor conventions']].map(([value,label])=>`<option value="${value}" ${validationProfile===value?'selected':''}>${label}</option>`).join('')}</select></h3><div class="ws-issue-pages"><label>Show<select id="ws-issues-filter"><option value="all" ${issueFilter==='all'?'selected':''}>All (${page.total})</option><option value="error" ${issueFilter==='error'?'selected':''}>Errors (${page.errors})</option><option value="warning" ${issueFilter==='warning'?'selected':''}>Warnings (${page.warnings})</option></select></label> <button id="ws-issues-prev" ${page.page===0?'disabled':''}>Previous</button> <label>Page<input id="ws-issues-page" type="number" min="1" max="${page.pages}" value="${page.page+1}" aria-label="Findings page"></label> of ${page.pages} <button id="ws-issues-next" ${page.page+1===page.pages?'disabled':''}>Next</button> <span id="ws-issues-range">Showing ${page.start}-${page.end} of ${page.filtered} matching findings (${page.total} total)</span></div>`+(page.issues.length?'<table class="ws-errors"><thead><tr><th>Severity</th><th>Time</th><th>Arrangement / level</th><th>Finding</th></tr></thead><tbody>'+page.issues.map(i=>`<tr data-issue-index="${analysis.indices.get(i)}" data-issue-time="${i.time}" data-issue-arr="${esc(i.arrangement||'')}" data-issue-note="${esc(i.note||'')}"><td class="ws-${i.severity}">${i.severity==='error'?'Error':'Warning'}</td><td>${seconds(i.time)}</td><td>${esc(i.vocalId!==undefined||Number.isInteger(i.vocalIndex)?'Vocals':project().arrangements.find(a=>a.id===i.arrangement)?.name||'Song')}${Number.isInteger(i.difficulty)?' / Level '+i.difficulty:''}</td><td>${esc(i.message)}</td></tr>`).join('')+'</tbody></table>':`<p class="ws-muted" style="padding:0 15px">${page.total?'No findings match this severity filter.':'No findings in the implemented chart checks.'}</p>`);
   on($('validation-profile'),'change',e=>{validationProfile=e.target.value;issuePage=0;renderBottom();});
   on($('issues-filter'),'change',e=>{issueFilter=e.target.value;issuePage=0;renderBottom();});
   on($('issues-prev'),'click',()=>{issuePage--;renderBottom();});on($('issues-next'),'click',()=>{issuePage++;renderBottom();});
   on($('issues-page'),'change',e=>{issuePage=Math.max(0,(Number(e.target.value)||1)-1);renderBottom();});
  }else if(bottom==='history'){
   el.innerHTML=`<h3>History <button data-action="history-checkpoint">Set checkpoint</button> <button data-action="history-return" ${history.checkpointAvailable?'':'disabled'}>Return to checkpoint</button></h3><p class="ws-muted">${history.checkpoint?esc(history.checkpoint.label)+(history.checkpointAvailable?' retained':' expired after eviction or branching'):'No checkpoint set.'} · Click a retained step to undo or redo to it.</p><div class="ws-history">${history.steps().map(step=>`<button data-history-step="${step.index}" aria-current="${step.current?'step':'false'}" ${step.current?'disabled':''}>${step.current?'▶ ':''}${step.index}. ${esc(step.label)}${step.checkpoint?' [checkpoint]':''}</button><br>`).join('')}</div>`;
   el.querySelectorAll('[data-history-step]').forEach(button=>on(button,'click',safe(()=>navigateHistory(()=>history.goTo(Number(button.dataset.historyStep))))));
  }
  else if(bottom==='scratch'){
   const current=arrangement(),other=current.editorOnly?mainPart():project().arrangements.find(a=>a.editorOnly&&a.scratchFor===current.id);
   el.innerHTML=`<h3>${current.editorOnly?'Main reference':'Scratch track'} · ${esc(other?.name||'Empty')} <button data-action="scratch-focus">${current.editorOnly?'Return to main':'Edit scratch'}</button></h3><p class="ws-muted">Scratch material is saved with the editable project and Feedpak editor sidecar, and excluded from playable charts. Copy, switch tracks and paste to transfer ideas.</p><canvas id="ws-scratch-preview" aria-label="Secondary track preview" style="width:100%;height:100px"></canvas>`;
   const secondary=$('scratch-preview'),width=Math.max(300,el.clientWidth-20);secondary.width=width;secondary.height=100;const pen=secondary.getContext('2d');pen.fillStyle='#17181d';pen.fillRect(0,0,width,100);
   if(other){const notes=[...other.notes,...other.chords.flatMap(c=>c.notes||[])],layout=other.type==='drums'?drumLayout(other):null,lanes=other.type==='keys'?128:layout?layout.ids.length:other.stringCount;for(const note of notes){const lane=other.type==='keys'?notePitch(other,note):layout?layout.indexOf(note):note.string,x=note.time/project().duration*width,y=90-lane/Math.max(1,lanes-1)*80;pen.fillStyle=other.type==='keys'?pianoNoteColor(pianoPalette,notePitch(other,note)):stringColor(other,note.string||0);pen.fillRect(x,y,Math.max(3,(note.sustain||0)/project().duration*width),5);}on(secondary,'click',e=>{countIn.cancel();stopMidi();arrangementId=other.id;selection.clear();selectionRange=null;markerSelection=null;fitPianoRange();audio.setProject(project(),arrangement());setCursor(e.offsetX/width*project().duration);render();});}
  }
  else if(bottom==='live'){
   const renderers=feedbackRenderers();if(liveOptions.renderer!=='oce'&&!renderers.includes(liveOptions.renderer))liveOptions={...liveOptions,renderer:'oce'};
   const a=arrangement(),signature=[a.id,a.name,a.type,a.stringCount,JSON.stringify(liveOptions),renderers.join(',')].join('|');
   if(el.dataset.live===signature&&$('live')){drawLivePanel();return;}
   el.dataset.live=signature;stopLiveViz();
   const fretted=['guitar','bass'].includes(a.type),useViz=liveOptions.renderer!=='oce';
   el.innerHTML=`<h3 class="ws-stave-bar">Live view <span class="ws-muted">· ${esc(a.name)}${fretted?` · ${a.stringCount} strings`:''} · follows the cursor and playback</span>`
    +(renderers.length?` <select data-live-renderer aria-label="Live view renderer" title="Draw with the editor's own highway, or a FeedBack highway plugin"><option value="oce">OCE highway</option>${renderers.map(key=>`<option value="${esc(key)}" ${liveOptions.renderer===key?'selected':''}>${esc(rendererLabel(key))}</option>`).join('')}</select>`:'')
    +(fretted||useViz?` <button data-live-invert title="Which string runs along the top of the highway">${liveOptions.lowStringTop?'Low string on top':'Low string at the bottom'}</button>`
    +`<button data-live-lefty class="${liveOptions.leftHanded?'active':''}" aria-pressed="${liveOptions.leftHanded}" title="Mirror the neck for a left-handed player">Left-handed</button>`
    +(useViz?'':` <button data-live-speed="-1" title="Slower highway: notes closer together">Slower</button><span class="ws-muted"> ${liveOptions.speed.toFixed(2)}× </span><button data-live-speed="1" title="Faster highway: notes further apart">Faster</button>`):'')
    +`</h3>`+(useViz?`<div id="ws-live-host" style="position:relative;overflow:hidden"><canvas id="ws-live-viz" aria-label="${esc(rendererLabel(liveOptions.renderer))} view of ${esc(a.name)}" style="display:block"></canvas></div>`:`<canvas id="ws-live" aria-label="Live highway view of ${esc(a.name)}" style="display:block"></canvas>`);
   const update=next=>{liveOptions={...liveOptions,...next};persistPreferences();renderBottom();};
   on(el.querySelector('[data-live-invert]'),'click',()=>update({lowStringTop:!liveOptions.lowStringTop}));
   on(el.querySelector('[data-live-lefty]'),'click',()=>update({leftHanded:!liveOptions.leftHanded}));
   el.querySelectorAll('[data-live-speed]').forEach(button=>on(button,'click',()=>update({speed:Math.max(.5,Math.min(2,Math.round((liveOptions.speed+.25*Number(button.dataset.liveSpeed))*100)/100))})));
   on(el.querySelector('[data-live-renderer]'),'change',e=>update({renderer:e.target.value}));
   if(useViz&&!startLiveViz(liveOptions.renderer,$('live-viz'))){liveOptions={...liveOptions,renderer:'oce'};delete el.dataset.live;renderBottom();return;}
   drawLivePanel();
  }
  else if(bottom==='stave'){
   // Rebuild the toolbar only when what it shows changes; an edit just repaints,
   // so focus (and Ctrl+Z, arrow keys) stays on the stave or its buttons.
   const a=arrangement(),signature=[a.id,a.name,a.type,a.instrument,staveMode,staveLength,staveTheme,showRests].join('|'),hadFocus=el.contains(document.activeElement);
   if(el.dataset.stave===signature&&$('stave')){drawStavePanel();return;}
   el.dataset.stave=signature;
   const lengths=[[4,'𝅝','Whole'],[2,'𝅗𝅥','Half'],[1,'♩','Quarter'],[0.5,'♪','Eighth'],[0.25,'𝅘𝅥𝅯','Sixteenth']];
   el.innerHTML=`<h3 class="ws-stave-bar">Stave <span class="ws-muted">· ${esc(a.name)} · in step with the ${a.type==='keys'?'piano roll':a.type==='drums'?'drum lanes':'tab'} above</span>`
    +` <button data-stave-mode="select" class="${staveMode==='select'?'active':''}" aria-pressed="${staveMode==='select'}" title="Click notes to select them (Shift or Ctrl adds)">Select</button>`
    +`<button data-stave-mode="add" class="${staveMode==='add'?'active':''}" aria-pressed="${staveMode==='add'}" title="Click the stave to add a note at that pitch and time (snapped)">Add</button>`
    +` <button data-stave-shift="1" title="${a.type==='drums'?'Next drum up the staff':'Up a semitone'} (Arrow Up)">▲ ${a.type==='drums'?'Up':'+1'}</button><button data-stave-shift="-1" title="${a.type==='drums'?'Next drum down the staff':'Down a semitone'} (Arrow Down)">▼ ${a.type==='drums'?'Down':'−1'}</button>`
    +`${a.type==='drums'?'':'<button data-stave-shift="12" title="Up an octave (Shift+Arrow Up)">8va</button><button data-stave-shift="-12" title="Down an octave (Shift+Arrow Down)">8vb</button>'}`
    +` ${a.type==='drums'?'':lengths.map(([beats,glyph,label])=>`<button data-stave-length="${beats}" class="${staveLength===beats?'active':''}" aria-pressed="${staveLength===beats}" title="${label} note: sets the selected notes' length, or the length of new notes">${glyph}</button>`).join('')}`
    +` <button data-stave-delete title="Delete the selected notes (Delete)">Delete</button>`
    +` <button data-stave-rests class="${showRests?'active':''}" aria-pressed="${showRests}" title="Show or hide rests. Hidden rests still keep their place in time.">𝄽 Rests</button>`
    +` <button data-stave-theme title="Switch the stave between light and dark paper">${staveTheme==='dark'?'☀ Light':'☾ Dark'}</button></h3>`
    +`<canvas id="ws-stave" tabindex="0" aria-label="Stave view of ${esc(a.name)}. Arrow keys transpose the selection, Delete removes it." style="display:block;outline:none"></canvas>`;
   el.querySelectorAll('[data-stave-mode]').forEach(b=>on(b,'click',()=>{staveMode=b.dataset.staveMode;renderBottom();draw();}));
   el.querySelectorAll('[data-stave-shift]').forEach(b=>on(b,'click',safe(()=>staveShift(Number(b.dataset.staveShift)))));
   el.querySelectorAll('[data-stave-length]').forEach(b=>on(b,'click',safe(()=>staveSetLength(Number(b.dataset.staveLength)))));
   on(el.querySelector('[data-stave-delete]'),'click',safe(()=>{if(!selection.size)throw Error('Select notes to delete');actions.delete();}));
   on(el.querySelector('[data-stave-rests]'),'click',()=>{showRests=!showRests;persistPreferences();renderBottom();draw();});
   on(el.querySelector('[data-stave-theme]'),'click',()=>{staveTheme=staveTheme==='dark'?'light':'dark';persistPreferences();renderBottom();draw();});
   wireStave($('stave'));drawStavePanel();if(hadFocus)$('stave').focus();
  }
  else {
   const channels=['master','song','guide','metronome','live'].map(bus=>`<div class="ws-mixer-channel" data-mixer-channel="${bus}">
    <label class="ws-mixer-gain"><span>${bus}<output data-mixer-value="${bus}">${Math.round(audio.gains[bus]*100)}%</output></span><input type="range" min="0" max="${bus==='master'?100:200}" value="${Math.round(audio.gains[bus]*100)}" data-bus="${bus}"></label>
    <label class="ws-mixer-pan"><span>Pan<output data-pan-value="${bus}">${Math.round(audio.pans[bus]*100)}</output></span><input type="range" min="-100" max="100" value="${Math.round(audio.pans[bus]*100)}" data-pan="${bus}"></label>
    <div class="ws-mixer-actions"><button data-mixer-mute="${bus}" class="${audio.mutes[bus]?'active':''}" aria-pressed="${audio.mutes[bus]}">Mute</button>${bus==='master'?'':`<button data-mixer-solo="${bus}" class="${audio.solos[bus]?'active':''}" aria-pressed="${audio.solos[bus]}">Solo</button>`}</div>
    <small class="ws-mixer-status">${audio.enabled[bus]?'enabled':'off'} · output <span data-mixer-output="${bus}">${Math.round(audio.getOutputGain(bus)*100)}%</span></small>
    <div class="ws-signal-meters" aria-label="${bus} stereo signal">${[0,1].map(channel=>`<meter min="-60" max="0" low="-12" high="-3" optimum="-20" value="-60" data-signal-meter="${bus}" data-signal-channel="${channel}" aria-label="${bus} ${channel?'right':'left'} peak dBFS"></meter>`).join('')}<output data-signal-value="${bus}">&#8722;&#8734; dBFS / &#8722;&#8734; dBFS</output><span data-signal-clip="${bus}" hidden>CLIP</span></div>
   </div>`).join('');
   el.innerHTML='<h3>Mixer · local preview</h3><div class="ws-mixer ws-audio-mixer">'+channels+'</div>'+`<div class="ws-live-input"><button data-action="live-input">${liveInput.active?'Stop live input':liveInput.pending?'Cancel input request':'Monitor live instrument...'}</button> <span>${liveInput.active?'Monitoring: '+esc(liveInput.label)+' · '+(liveInput.engine==='at5-vst3'?'AmpliTube 5 VST3':'approximate software tone'):liveInput.pending?'Preparing live input...':'Live input off'}</span><small>Stereo peak meters follow each bus fader/pan; the guide meter is before its tone effect. Software mode uses the disclosed approximation. AT5 mode processes audio through this computer's local VST3 host; no audio is recorded or sent to external services. Use headphones to avoid feedback.</small></div><details class="ws-transcription"><summary>Song transcription effects / local preview</summary><p class="ws-muted">Listening aids only. Center cancel removes shared left/right content and can also remove centered instruments. Original audio and chart exports stay unchanged.</p><label><input type="checkbox" data-song-fx-bypass ${audio.songFX.bypass?'checked':''}> Bypass transcription effects</label><label>Channels<select data-song-fx-channel>${[['stereo','Stereo'],['left','Left channel only'],['right','Right channel only'],['center-cancel','Center cancel (L - R)']].map(([value,label])=>`<option value="${value}" ${audio.songFX.channel===value?'selected':''}>${label}</option>`).join('')}</select></label><label>Original EQ presets<select data-song-fx-preset><option value="">Custom</option><option value="flat">Flat</option><option value="bass">Bass focus</option><option value="lead">Lead focus</option><option value="air">Air</option></select></label><div class="ws-mixer">${[100,400,1000,4000,10000].map((frequency,i)=>`<label>${frequency>=1000?frequency/1000+' kHz':frequency+' Hz'} <output data-eq-value="${i}">${audio.songFX.eq[i]} dB</output><input type="range" min="-18" max="18" step="0.5" value="${audio.songFX.eq[i]}" data-song-eq="${i}"></label>`).join('')}</div></details>`;
  }
 }
 function toneUIPlan(tone,a=arrangement()){
  const actualDisclosures=[];for(const [effect,label]of [[tonePreview,'Guide preview'],[liveInput.effect,'Live input']]){const owner=effect&&toneEffectOwners.get(effect);if(effect&&!effect.disposed&&typeof effect.getDisclosures==='function'&&owner?.tone===tone&&owner.arrangementId===a.id)for(const item of effect.getDisclosures())actualDisclosures.push({...item,message:label+': '+item.message});}
  actualDisclosures.sort((a,b)=>(a.kind==='bypassed')-(b.kind==='bypassed'));
  return toneAuditionPlan(tone,{sampleRate:audio.context?.sampleRate??48000,adaptiveStatus:toneEnvelopeStatus(audio.context),actualDisclosures});
 }
 function refreshToneDisclosures(){
  if(view!=='tones'||abort.signal.aborted||!root.isConnected)return;const a=arrangement(),tone=a.tones.definitions?.[selectedTone];if(!tone)return;const audition=toneUIPlan(tone,a);
  for(const card of root.querySelectorAll('.ws-tone-card')){const slot=card.querySelector('[data-gear-slot]')?.dataset.gearSlot,output=card.querySelector('.ws-tone-disclosures');if(output)output.innerHTML=toneDisclosureHTML(audition.disclosures.filter(item=>item.slot===slot));}
  const output=$('tone-output-disclosures');if(output)output.innerHTML=toneDisclosureHTML(audition.disclosures.filter(item=>!SLOT_CATALOG.some(slot=>slot.key===item.slot)));
 }
 function tonePreviewStatus(event){
  if(abort.signal.aborted||!root.isConnected||![tonePreview,liveInput.effect].includes(event.preview)||toneDisclosurePending)return;toneDisclosurePending=true;
  queueMicrotask(()=>{toneDisclosurePending=false;if(abort.signal.aborted||!root.isConnected)return;updateTonePreview();refreshToneDisclosures();});
 }
 async function prepareLocalToneEffects(context){
  let pending;try{pending=prepareToneEnvelope(context);refreshToneDisclosures();await pending;}catch{}finally{if(!abort.signal.aborted&&root.isConnected)refreshToneDisclosures();}
 }
 function toneDisclosureHTML(items){return items.map(item=>`<p class="${item.kind==='bypassed'?'ws-warning':'ws-muted'}" data-tone-disclosure="${esc(item.slot)}">${esc(item.message)}${item.unmappedControls?.length?`<br>Stored controls without a local model: ${esc(item.unmappedControls.join(', '))}`:''}${item.inactiveControls?.length?`<br>Inactive in this mode: ${esc(item.inactiveControls.join(', '))}`:''}${item.invalidControls?.length?`<br>Invalid stored controls: ${esc(item.invalidControls.join(', '))}`:''}${item.frequencyLimits?.length?'<br>Some preview frequencies are limited by the current sample rate.':''}</p>`).join('');}
 function toneControlHTML(control,slot,gear){const value=gear.KnobValues?.[control.key]??control.min,attributes=`data-knob-slot="${slot}" data-knob-key="${esc(control.key)}"`;if(control.unit==='enum'&&control.choices?.length){const choices=control.choices.map((label,index)=>({label,value:control.min+index*control.step}));return `<select ${attributes}>${choices.some(choice=>choice.value===value)?'':`<option value="${esc(value)}" selected>Retained value: ${esc(value)}</option>`}${choices.map(choice=>`<option value="${choice.value}" ${choice.value===value?'selected':''}>${esc(choice.label)}</option>`).join('')}</select>`;}return `<input type="number" ${attributes} min="${control.min}" max="${control.max}" step="any" required data-knob-step="${control.step}" value="${esc(value)}">`;}
 function changeToneField(label,edit){
  const a=arrangement(),index=project().arrangements.indexOf(a),name=selectedTone;if(index<0||!Object.hasOwn(a.tones.definitions||{},name))throw Error('Choose an existing tone');if(a.locked)throw Error(`${a.name} is locked; Arrangement > Lock / unlock to edit it`);
  countIn.cancel();const before=history.stateId;history.commitAt(label,['arrangements',index,'tones','definitions',name],edit);if(history.stateId===before)return;
  dirty=true;$('dirty').textContent='●';renderBottom();refreshActionAvailability();updateTonePreview(true);
  const tone=a.tones.definitions[name];refreshToneDisclosures();
  const definition=[...root.querySelectorAll('[data-tone-definition]')].find(el=>el.dataset.toneDefinition===name);if(definition)definition.value=JSON.stringify(tone,null,2);queueDraft();
 }
 function renderTones(){
  const a=arrangement(),names=Object.keys(a.tones.definitions||{});if(!names.includes(selectedTone))selectedTone=names.includes(a.tones.base)?a.tones.base:names[0];const tone=a.tones.definitions[selectedTone];let audition;try{audition=tone?toneUIPlan(tone,a):null;}catch(error){audition={disclosures:[{slot:'Tone',kind:'bypassed',message:error.message}]};}
  $('tone-view').innerHTML=`<h2>Tone library & effect chain</h2><p class="ws-muted">Native gear identifiers and knob values are saved with allocations. Local preview uses original approximate amplifier, cabinet and supported effects. Gear cards describe what you can hear; native game DSP differs. Rendered practice audio uses dry guide synthesis.</p><label><input id="ws-tone-audition-selected" type="checkbox" ${auditionSelectedTone?'checked':''}> Audition selected library tone while this view is open</label><p class="ws-muted" id="ws-tone-preview-source">${auditionSelectedTone?'Local guide and software live input follow the library selection.':'Local guide and software live input follow chart tone allocations.'} AmpliTube live input uses the selected .at5p preset. Native allocations and exports stay unchanged.</p><div class="ws-tone-actions"><select id="ws-tone-library">${names.map(name=>`<option ${name===selectedTone?'selected':''}>${esc(name)}</option>`).join('')}</select> <button data-action="tone-definition">New tone</button> <button data-action="tone-copy">Clone</button> <button data-action="tone-import">Import…</button> <button data-action="tone-export">Export…</button> <button data-action="tone">Allocate at cursor</button> <button data-tone-base="${esc(selectedTone)}">Set base tone</button> <button data-action="tone-delete">Delete</button></div><div class="ws-tone-timeline"><strong>Base: ${esc(a.tones.base)}</strong>${(a.tones.changes||[]).map((t,i)=>`<button data-tone-time="${t.time}" title="Jump to tone">${seconds(t.time)} · ${esc(t.name)}</button><button data-tone-remove="${i}" title="Remove tone change">×</button>`).join('')}</div>${tone?field('Tone volume (dB)','tone-volume',tone.volume??tone.Volume??-12,'number','min="-60" max="12" step="any" required data-tone-volume-step="0.5"'):''}<div class="ws-gear-chain">${tone?SLOT_CATALOG.map(slot=>{const gear=tone.GearList?.[slot.key],descriptor=GEAR_CATALOG.find(g=>g.key===gear?.Key);return `<section class="ws-tone-card"><h3>${esc(slot.label)}</h3><select data-gear-slot="${slot.key}">${slot.required?'':'<option value="">Empty slot</option>'}${gear&&!descriptor?`<option value="${esc(gear.Key)}" selected>Retained unknown gear: ${esc(gear.Key)}</option>`:''}${gearsForSlot(slot.key).map(g=>`<option value="${g.key}" ${gear?.Key===g.key?'selected':''}>${esc(g.label+(slot.key==='Cabinet'?' / '+g.category:''))}</option>`).join('')}</select><div class="ws-gear-knobs">${(descriptor?.knobs||[]).map(k=>`<label>${esc(k.label)}${toneControlHTML(k,slot.key,gear)}<small>${esc(k.unit==='enum'?'':k.unit||'')}</small></label>`).join('')}</div><div class="ws-tone-disclosures">${toneDisclosureHTML((audition?.disclosures||[]).filter(item=>item.slot===slot.key))}</div></section>`;}).join(''):''}</div><div id="ws-tone-output-disclosures">${toneDisclosureHTML((audition?.disclosures||[]).filter(item=>!SLOT_CATALOG.some(slot=>slot.key===item.slot)))}</div><details><summary>Complete definition JSON</summary><textarea data-tone-definition="${esc(selectedTone)}" rows="10" style="width:100%">${esc(JSON.stringify(tone||{},null,2))}</textarea></details>`;
  $('tone-preview-source').textContent=`${auditionSelectedTone?'Local guide and software live input follow the selected library tone.':'Local guide and software live input follow chart tone allocations.'} AmpliTube live input follows the same tone selection using FeedBack's Rocksmith-to-AT5 mapping; exact Rocksmith DSP is not reproduced.`;
  on($('tone-library'),'change',e=>{selectedTone=e.target.value;renderTones();updateTonePreview(true);});on($('tone-audition-selected'),'change',e=>{auditionSelectedTone=e.target.checked;renderTones();updateTonePreview(true);});on($('tone-volume'),'change',safe(e=>{const value=Number(e.target.value);if(!e.target.value.trim()||!Number.isFinite(value)||value< -60||value>12)throw Error('Tone volume must be -60 to +12 dB');changeToneField('Tone volume',tone=>{tone.volume=value;tone.Volume=String(value);});})); 
 }
 function disposeVocalTimeline(){if(vocalController){vocalUI=vocalController.snapshot();vocalController.dispose();vocalController=null;}}
 function updateVocalSelection(ids){vocalUI.selection=[...ids];let start=Infinity,end=-Infinity;if(ids.length){const byId=vocalController?.index().ids||createVocalIndex(project().vocals||[]).byId;for(const id of ids){const row=byId.get(id);if(row){start=Math.min(start,row.time);end=Math.max(end,row.time+row.length);}}}vocalSelectionRange=end>start?{start,end}:null;const selected=new Set(ids);for(const row of root.querySelectorAll('[data-vocal-row]'))row.setAttribute('aria-selected',String(selected.has(row.dataset.vocalRow)));for(const button of root.querySelectorAll('[data-vocal-action]')){const name=button.dataset.vocalAction;button.disabled=name==='paste'?!vocalClipboard?.events?.length:['copy','cut','delete'].includes(name)?!ids.length:false;}}
 function focusVocalText(id){const rows=project().vocals||[],index=rows.findIndex(row=>row.id===id);if(index<0)return;vocalPage=Math.floor(index/100);renderVocals();const input=[...root.querySelectorAll('[data-vocal-field="text"]')].find(input=>input.dataset.vocalId===id);input?.focus();input?.select();}
 function changeVocalField(label,id,key,value){
  if(!['text','length','pitch'].includes(key))throw Error('This vocal field needs a complete ordering edit');
  const index=(project().vocals||[]).findIndex(row=>row.id===id);if(index<0)throw Error('The vocal syllable no longer exists');countIn.cancel();const before=history.stateId;
  history.commitAt(label,['vocals',index],row=>{if(key==='pitch'&&value===undefined)delete row.pitch;else row[key]=value;});
  if(history.stateId===before)return;
  dirty=true;$('dirty').textContent='●';pendingVocalSelection=null;vocalController?.setSelection([id]);
  const input=[...root.querySelectorAll('[data-vocal-field]')].find(input=>input.dataset.vocalId===id&&input.dataset.vocalField===key);if(input)input.value=value??'';
  updateClock();renderBottom();refreshActionAvailability();refreshPlaytestAvailability();vocalController?.schedule();queueDraft();
 }
 async function tabVocalField(e){
  if(e.key!=='Tab'||e.ctrlKey||e.metaKey||!e.target.dataset.vocalField||view!=='vocals')return false;
  const source=e.target;if(!source.checkValidity()){e.preventDefault();source.reportValidity();return true;}
  const controls=[...$('vocal-view').querySelectorAll('input,button,canvas[tabindex]')].filter(el=>!el.disabled&&el.getClientRects().length),index=controls.indexOf(source),next=controls[index+(e.shiftKey?-1:1)];
  if(!next)return false;
  e.preventDefault();const descriptor={...next.dataset},isCanvas=next.tagName==='CANVAS',owner=history,generation=projectGeneration,beforeErrors=errorRevision,sourceId=source.dataset.vocalId,sourceField=source.dataset.vocalField;
  source.blur();await Promise.resolve();if(abort.signal.aborted||history!==owner||generation!==projectGeneration||view!=='vocals')return true;
  if(errorRevision!==beforeErrors){[...root.querySelectorAll('[data-vocal-field]')].find(el=>el.dataset.vocalId===sourceId&&el.dataset.vocalField===sourceField)?.focus();return true;}
  const id=descriptor.vocalId||descriptor.vocalReveal||descriptor.vocalDelete,rowIndex=(project().vocals||[]).findIndex(row=>row.id===id);
  if(rowIndex>=0&&Math.floor(rowIndex/100)!==vocalPage){vocalPage=Math.floor(rowIndex/100);renderVocals();}
  const target=isCanvas?$('vocal-timeline').querySelector('canvas'):[...$('vocal-view').querySelectorAll('input,button')].find(el=>Object.keys(descriptor).every(key=>el.dataset[key]===descriptor[key]));
  target?.focus();return true;
 }
 function vocalEdit(operation,payload={}){
  const rows=project().vocals||[],ids=payload.ids??vocalController?.selectedIds()??vocalUI.selection,chosen=new Set(ids);
  if(operation==='selectall'){vocalController?.setSelection(rows.map(row=>row.id));return;}
  if(['copy','cut','delete','move','nudge'].includes(operation)&&!ids.length){status('Select one or more vocal syllables first');return;}
  if(operation==='copy'||operation==='cut'){vocalClipboard=copyVocalSelection(rows,ids);if(operation==='copy'){updateVocalSelection(ids);status(`Copied ${ids.length} vocal syllables`);return;}}
  if(operation==='delete'||operation==='cut'){pendingVocalSelection=[];change(operation==='cut'?'Cut vocal syllables':'Delete vocal syllables',p=>p.vocals=rows.filter(row=>!chosen.has(row.id)));return;}
  if(operation==='move'||operation==='nudge'){
   const index=createVocalIndex(rows),first=ids.reduce((time,id)=>Math.min(time,index.byId.get(id)?.time??Infinity),Infinity),delta=operation==='nudge'?timeAt(project().beats,beatAt(project().beats,first)+payload.direction/(snap||4))-first:payload.delta,plan=planVocalMove(index,ids,delta,{duration:project().duration});
   if(!plan.delta)return;const updates=new Map(plan.updates.map(row=>[row.id,row]));pendingVocalSelection=ids;change('Move vocal syllables',p=>{for(const row of p.vocals)if(updates.has(row.id))Object.assign(row,updates.get(row.id));p.vocals.sort((a,b)=>a.time-b.time);});return;
  }
  if(operation==='resize'){const row=rows.find(row=>row.id===payload.id);if(!row)throw Error('The vocal syllable no longer exists');const plan=planVocalResize(row,payload.end,{duration:project().duration});if(plan.length===row.length)return;changeVocalField('Resize vocal syllable',row.id,'length',plan.length);return;}
  if(operation==='paste'){if(!vocalClipboard?.events?.length)return;if(rows.length+vocalClipboard.events.length>MAX_VOCAL_EVENTS)throw Error('Vocal event limit exceeded');const copied=pasteVocalSelection(vocalClipboard,cursor,{uid,duration:project().duration,existingIds:rows.map(row=>row.id)});pendingVocalSelection=copied.map(row=>row.id);change('Paste vocal syllables',p=>{(p.vocals||=[]).push(...copied);p.vocals.sort((a,b)=>a.time-b.time);});return;}
  if(operation==='add'){if(rows.length>=MAX_VOCAL_EVENTS)throw Error('Vocal event limit exceeded');const time=Math.max(0,Math.min(project().duration,quantize(payload.time??cursor))),row={id:uid(),time,length:Math.min(Math.max(0,project().duration-time),Math.max(.1,timeAt(project().beats,beatAt(project().beats,time)+1)-time)),text:'Syllable'};pendingVocalSelection=[row.id];change('Add vocal syllable',p=>{(p.vocals||=[]).push(row);p.vocals.sort((a,b)=>a.time-b.time);});}
 }
 function renderVocals(){
  disposeVocalTimeline();if(pendingVocalSelection!==null){vocalUI.selection=[...pendingVocalSelection];pendingVocalSelection=null;}
  const rows=project().vocals||[],pages=Math.max(1,Math.ceil(rows.length/100));vocalPage=Math.max(0,Math.min(pages-1,vocalPage));const pageRows=rows.slice(vocalPage*100,(vocalPage+1)*100);
  const wires=lyricWires(),counts=lyricCounts();
  $('vocal-view').innerHTML=`<h2>Lyrics</h2><div class="ws-lyric-modes" role="radiogroup" aria-label="Space bar"><label><input type="radio" name="ws-lyric-mode" value="check" ${lyricMode==='check'?'checked':''}> Playback check</label> <label><input type="radio" name="ws-lyric-mode" value="tap" ${lyricMode==='tap'?'checked':''}> Tap timing</label> <span class="ws-muted">${lyricMode==='tap'?'Space starts tapping, then hold Space while each syllable is sung.':'Space plays and pauses; the lyric line below follows the audio.'}</span></div><div id="ws-lyric-karaoke" class="ws-lyric-karaoke" tabindex="0" aria-label="Current lyric line"></div><details id="ws-lyric-sync" ${vocalUI.syncClosed?'':'open'}><summary>Lyric sheet and tap timing</summary><div class="ws-lyric-grid"><div><label for="ws-lyric-sheet">Lyric sheet: one line per sung line, words separated by spaces, hyphens between syllables (morn-ing). Any language or script.</label><textarea id="ws-lyric-sheet" rows="8" spellcheck="false">${esc(sheetText(wires))}</textarea><div><button data-lyric="apply">Apply text</button> <button data-lyric="suggest">Suggest syllables (English)</button></div><div id="ws-lyric-suggestion"></div></div><div><p id="ws-lyric-count">${counts}</p><label>Tap<select id="ws-lyric-scope"><option value="rest" ${lyricOptions.scope==='rest'?'selected':''}>to the end</option><option value="line" ${lyricOptions.scope==='line'?'selected':''}>one line</option></select></label> <label>Lead-in (s)<input id="ws-lyric-leadin" type="number" min="0" max="10" step="0.5" value="${lyricOptions.leadIn}"></label> <label>Tap latency (ms)<input id="ws-lyric-latency" type="number" min="0" max="500" step="5" value="${Math.round(lyricOptions.latency*1000)}"></label><div><button data-lyric="start" ${lyricSession?'disabled':''}>Start tapping</button> <button data-lyric="stop" ${lyricSession?'':'disabled'}>Stop</button> <button data-lyric="select-line">Select line</button> <button data-lyric="snap">Snap starts to onsets</button></div><p class="ws-muted">Tapping starts at the selected syllable, or the first untimed one. Backspace undoes the last tap and rewinds 2 s; Enter or Escape stops. Taps are saved as one undo step when you stop. Tap latency is subtracted from every tap.</p></div></div></details><h3>Syllables</h3><p class="ws-muted">Drag syllables to move them; drag a right edge to resize. Double-click empty space to add, or a syllable to edit its text. Alt+arrows nudge; Ctrl+A/C/X/V and Delete work when the vocal canvas is focused. Optional MIDI pitch appears below the lyric lane.</p><button data-action="vocal-add">Add syllable at cursor</button> <button data-action="vocal-phrase">Enter lyric phrase...</button> ${['selectall','copy','cut','paste','delete'].map(name=>`<button data-vocal-action="${name}">${({selectall:'Select all',copy:'Copy',cut:'Cut',paste:'Paste',delete:'Delete'})[name]}</button>`).join(' ')}<div id="ws-vocal-timeline" style="margin-top:12px"></div><p class="ws-muted">Moves keep selected syllables together within the song duration. The waveform follows the original backing; authoring leaves its audio unchanged.</p><div><button data-vocal-page="${vocalPage-1}" ${vocalPage===0?'disabled':''}>Previous</button> <span>Page ${vocalPage+1} of ${pages} / ${rows.length} syllables</span> <button data-vocal-page="${vocalPage+1}" ${vocalPage===pages-1?'disabled':''}>Next</button></div><table class="ws-vocal-table"><thead><tr><th>Time (s)</th><th>Length (s)</th><th>Pitch (MIDI)</th><th>Syllable</th><th></th></tr></thead><tbody>${pageRows.map(v=>`<tr data-vocal-row="${esc(v.id)}"><td><input type="number" data-vocal-id="${esc(v.id)}" data-vocal-field="time" min="0" step="0.001" value="${v.time}"></td><td><input type="number" data-vocal-id="${esc(v.id)}" data-vocal-field="length" min="0" step="0.001" value="${v.length}"></td><td><input type="number" data-vocal-id="${esc(v.id)}" data-vocal-field="pitch" min="0" max="127" value="${v.pitch??''}" placeholder="optional"></td><td><input type="text" data-vocal-id="${esc(v.id)}" data-vocal-field="text" value="${esc(v.text)}"></td><td><button data-vocal-time="${v.time}" data-vocal-reveal="${esc(v.id)}">Go</button><button data-vocal-delete="${esc(v.id)}" aria-label="Delete syllable">Delete</button></td></tr>`).join('')}</tbody></table>${!rows.length?'<p class="ws-muted">No vocal events. Add an original lyric phrase or import a vocal XML.</p>':''}`;
  vocalController=new VocalTimeline($('vocal-timeline'),{read:()=>({events:lyricPreview?.vocals||project().vocals||rows,beats:project().beats,duration:project().duration,cursor:audio.isPlaying?audio.currentTime:cursor,playing:audio.isPlaying,zoom,revision:history.stateId,waveform,audioDuration:audio.audioDuration||project().duration}),quantize,onCursor:time=>setCursor(Math.max(0,Math.min(project().duration,time))),onEdit:vocalEdit,onSelection:updateVocalSelection,onText:focusVocalText,onError:error=>{errorRevision++;status(error.message,true);},initial:vocalUI});
  updateVocalSelection(vocalController.selectedIds());
  wireLyrics();updateLyricFollow();
 }
 // Lyrics tab: lyric sheet, syllable suggestion and tap timing (src/lyric-sync.js).
 function lyricWires(p=project()){return syllables(p.vocals||[],p.lyricSheet?.untimed||[]).map(s=>s.text);}
 function lyricCounts(){const p=project(),timed=(p.vocals||[]).length,untimed=p.lyricSheet?.untimed?.length||0,list=syllables(p.vocals||[],p.lyricSheet?.untimed||[]),next=lyricSession?list[lyricSession.next]:list[timed];const long=longLines(list.map(s=>s.text)).length;return `Timed ${timed} of ${timed+untimed} syllables.${next?` Next to tap: <b>${esc(next.text.replace(/[-+]$/,''))}</b>.`:''}${long?` ${long} line${long===1?' is':'s are'} longer than ${LINE_CHARACTERS} characters.`:''}`;}
 function lyricStartIndex(){const list=syllables(project().vocals||[],project().lyricSheet?.untimed||[]),selected=new Set(vocalController?.selectedIds()||[]),picked=list.findIndex(s=>s.timed&&selected.has(s.id));if(picked>=0)return picked;const timed=list.filter(s=>s.timed).length;if(timed<list.length)return timed;const after=list.findIndex(s=>s.time>=cursor);return after>=0?after:0;}
 async function startLyricTapping(){
  if(lyricSession)return;if(!audio.buffer)throw Error('Import the song audio before tap timing');
  const list=syllables(project().vocals||[],project().lyricSheet?.untimed||[]);if(!list.length)throw Error('Type or paste the lyric sheet and Apply text first');
  const start=lyricStartIndex(),wires=list.map(s=>s.text),end=lyricOptions.scope==='line'?lineOf(wires,start).end:list.length-1;
  const before=list[start-1],anchor=list[start].timed?list[start].time:before?before.time+before.length:cursor;
  lyricSession=new TapSession({start,end,latency:lyricOptions.latency});lyricSession.ignoreUp=true;lyricPreview=null;
  document.activeElement?.blur?.();$('lyric-karaoke')?.focus({preventScroll:true});
  setCursor(Math.max(0,anchor-lyricOptions.leadIn));if(!audio.isPlaying)await actions.play();
  status(`Tap timing from syllable ${start+1}: hold Space while each syllable is sung`);refreshLyricPanel();
 }
 function lyricPreviewUpdate(){const p=project();try{lyricPreview=commitTaps(p.vocals||[],p.lyricSheet?.untimed||[],lyricSession.result(),{uid,duration:p.duration});}catch{lyricPreview=null;}vocalController?.schedule();updateLyricFollow();refreshLyricPanel();}
 function stopLyricTapping(){
  const session=lyricSession;if(!session)return;lyricSession=null;lyricPreview=null;if(audio.isPlaying){cursor=audio.currentTime;audio.pause();}
  const taps=session.result();if(!taps.length){status('Tap timing stopped; nothing tapped');render();return;}
  const p=project();let result;try{result=commitTaps(p.vocals||[],p.lyricSheet?.untimed||[],taps,{uid,duration:p.duration});}catch(error){render();throw error;}
  change(`Tap lyric timing (${taps.length} syllable${taps.length===1?'':'s'})`,q=>{q.vocals=result.vocals;if(result.untimed.length)q.lyricSheet={...q.lyricSheet,untimed:result.untimed};else delete q.lyricSheet;});
  status(`Timed ${taps.length} syllable${taps.length===1?'':'s'}${result.nudged?`; ${result.nudged} later syllable${result.nudged===1?' was':'s were'} moved after them to keep the lyric order`:''}`);
 }
 // Space in Tap timing mode: the first press starts, then each hold marks a syllable.
 function lyricKey(e){
  if(view!=='vocals'||lyricMode!=='tap'||$('dialog').open)return false;
  if(!lyricSession){if(e.type==='keydown'&&e.key===' '&&!e.repeat&&!e.target.matches('input,textarea,select,button')){e.preventDefault();startLyricTapping().catch(error=>status(error.message,true));return true;}return false;}
  if(e.key===' '){e.preventDefault();if(e.repeat)return true;const t=audio.currentTime;if(e.type==='keydown'){lyricSession.ignoreUp=false;if(!lyricSession.down(t)&&!lyricSession.done)status('Too early: wait until after the last tapped syllable');}else if(!lyricSession.ignoreUp&&lyricSession.up(t)){lyricPreviewUpdate();if(lyricSession.done)stopLyricTapping();}return true;}
  if(e.type!=='keydown')return true;
  if(e.key==='Backspace'){e.preventDefault();const rewind=lyricSession.undo();if(rewind!==null){setCursor(rewind);lyricPreviewUpdate();}return true;}
  if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();stopLyricTapping();return true;}
  return false;
 }
 function refreshLyricPanel(){const count=$('lyric-count');if(count)count.innerHTML=lyricCounts();const start=root.querySelector('[data-lyric="start"]'),stop=root.querySelector('[data-lyric="stop"]');if(start)start.disabled=!!lyricSession;if(stop)stop.disabled=!lyricSession;}
 function updateLyricFollow(){
  const el=$('lyric-karaoke');if(!el)return;const time=audio.isPlaying?audio.currentTime:cursor,line=karaoke(lyricPreview?.vocals||project().vocals||[],time);
  el.innerHTML=line?`<div class="ws-lyric-now">${line.words.map((w,i)=>`<span class="${w.active?'ws-lyric-active':w.sung?'ws-lyric-sung':''}">${esc(w.text)}</span>${w.join||i===line.words.length-1?'':' '}`).join('')}</div><div class="ws-lyric-next">${esc(line.next)}</div>`:'<div class="ws-lyric-next">No timed lyrics yet. Paste the lyric sheet below, Apply text, then tap the timing.</div>';
  if(audio.isPlaying)vocalController?.follow(time);
 }
 function wireLyrics(){
  for(const radio of root.querySelectorAll('[name="ws-lyric-mode"]'))on(radio,'change',()=>{if(lyricSession)stopLyricTapping();lyricMode=radio.value;persistPreferences();renderVocals();});
  on($('lyric-sync'),'toggle',e=>{vocalUI.syncClosed=!e.target.open;});
  on($('lyric-scope'),'change',e=>{lyricOptions.scope=e.target.value;persistPreferences();});
  on($('lyric-leadin'),'change',e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v>=0&&v<=10){lyricOptions.leadIn=v;persistPreferences();}});
  on($('lyric-latency'),'change',e=>{const v=Number(e.target.value);if(Number.isFinite(v)&&v>=0&&v<=500){lyricOptions.latency=v/1000;persistPreferences();}});
  for(const button of root.querySelectorAll('[data-lyric]'))on(button,'click',safe(async()=>{await lyricAction(button.dataset.lyric);}));
 }
 async function lyricAction(name){
  const p=project();
  if(name==='start')return startLyricTapping();
  if(name==='stop')return stopLyricTapping();
  if(name==='apply'){
   const plan=reconcileSheet(p.vocals||[],$('lyric-sheet').value);
   if(plan.removed.length&&!await dialog('Apply lyric sheet',`<p>The sheet has ${plan.removed.length} fewer syllable${plan.removed.length===1?'':'s'} than are already timed. The last ${plan.removed.length} timed syllable${plan.removed.length===1?'':'s'} will be removed.</p>`,'Apply and remove'))return;
   const removed=new Set(plan.removed),renames=new Map(plan.renames.map(r=>[r.id,r.text]));
   change('Apply lyric sheet',q=>{q.vocals=(q.vocals||[]).filter(v=>!removed.has(v.id)).map(v=>renames.has(v.id)?{...v,text:renames.get(v.id)}:v);if(plan.untimed.length)q.lyricSheet={...q.lyricSheet,untimed:plan.untimed};else delete q.lyricSheet;});
   status(`Lyric sheet applied: ${plan.renames.length} timed syllable${plan.renames.length===1?'':'s'} renamed, ${plan.untimed.length} waiting to be tapped`);return;
  }
  if(name==='suggest'){
   lyricSuggestion=suggestSheet($('lyric-sheet').value);const box=$('lyric-suggestion');
   if(!lyricSuggestion.changes.length){box.innerHTML='<p class="ws-muted">No suggestions: every plain English word is one syllable or already split. Words in other languages and scripts are never changed.</p>';return;}
   box.innerHTML=`<p>${lyricSuggestion.changes.length} word${lyricSuggestion.changes.length===1?'':'s'} could be split: ${lyricSuggestion.changes.slice(0,40).map(c=>`${esc(c.from)} → <b>${esc(c.to)}</b>`).join(', ')}${lyricSuggestion.changes.length>40?', …':''}</p><p class="ws-muted">A rule-based suggestion for English. Accept puts it in the sheet for you to check and edit before Apply text. Your own hyphens and words in other languages and scripts are left as they are.</p><button data-lyric-suggestion="accept">Accept suggestion</button> <button data-lyric-suggestion="dismiss">Dismiss</button>`;
   for(const button of box.querySelectorAll('[data-lyric-suggestion]'))on(button,'click',()=>{if(button.dataset.lyricSuggestion==='accept'&&lyricSuggestion)$('lyric-sheet').value=lyricSuggestion.text;lyricSuggestion=null;box.innerHTML='';});
   return;
  }
  if(name==='select-line'){
   const list=syllables(p.vocals||[]),ids=new Set(vocalController?.selectedIds()||[]),index=list.findIndex(s=>ids.has(s.id)),at=index>=0?index:Math.max(0,list.findIndex(s=>s.time+s.length>=cursor));
   const line=lineOf(list.map(s=>s.text),at);if(!line)throw Error('There are no timed lyrics yet');vocalController.setSelection(list.slice(line.start,line.end+1).map(s=>s.id));status('Line selected: Alt+arrows nudge it, drag to move it');return;
  }
  if(name==='snap'){
   const ids=new Set(vocalController?.selectedIds()||[]);if(!ids.size)throw Error('Select the syllables to snap first');
   if(!audio.buffer)throw Error('Import the song audio first');if(!onsetReady()){onsets=detectOnsets(audio.buffer);onsetSourceGeneration=audio.decodeGeneration;}
   const updates=new Map(snapStarts((p.vocals||[]).filter(v=>ids.has(v.id)),onsets).map(u=>[u.id,u]));
   if(!updates.size){status('No onset close enough to move any selected syllable start');return;}
   change('Snap syllable starts to onsets',q=>{q.vocals=q.vocals.map(v=>updates.has(v.id)?{...v,time:updates.get(v.id).time,length:updates.get(v.id).length}:v);});status(`${updates.size} syllable start${updates.size===1?'':'s'} snapped to the nearest onset`);
  }
 }
 async function setupTonePreview(){const owner=history,generation=projectGeneration;await audio.init();if(abort.signal.aborted||!root.isConnected){await audio.dispose();return false;}const context=audio.context;await prepareLocalToneEffects(context);if(abort.signal.aborted||!root.isConnected){await audio.dispose();return false;}if(history!==owner||projectGeneration!==generation||audio.context!==context)return false;if(!tonePreview){tonePreview=new TonePreview(context,{onStatus:tonePreviewStatus});audio.getBusOutput('guide').disconnect(audio.buses.master);audio.getBusOutput('guide').connect(tonePreview.input);tonePreview.connect(audio.buses.master);}updateTonePreview(true);refreshToneDisclosures();return true;}
 function auditionMidi(event){
  try{if((midiRecording||midiAuditioning)&&guide&&audio.enabled.guide&&event.type==='noteon'&&!midiCue.running)midiCue.start({context:audio.context,destination:audio.buses?.guide});if(midiCue.running){const result=midiCue.handle(event);if(['voice-limit','unmapped-drum','unsampleable'].includes(result.status))status('MIDI audition: '+result.status+(event.pitch!=null?' (note '+event.pitch+')':''),true);}}catch(error){midiCue.stop();status('Live MIDI guide unavailable: '+error.message+(midiRecording?'; recording continues':''),true);}
  if(midiUiPending)return;midiUiPending=true;queueMicrotask(()=>{midiUiPending=false;if(!abort.signal.aborted&&root.isConnected)refreshActionAvailability();});
 }
 // A recording capability validates the selected arrays once before playback.
 // All authored edits still pass through History; any other edit invalidates it.
 function prepareMidiAppendScope(){
  const a=arrangement();try{midiAppendScope={owner:history,id:a.id,difficulty:a.activeDifficulty,appender:prepareMidiNoteAppender(history,a.id,{expectedDifficulty:a.activeDifficulty})};}catch{midiAppendScope=null;}
 }
 function flushMidiRender(){
  if(midiRenderFrame!==null)cancelAnimationFrame(midiRenderFrame);midiRenderFrame=null;
  const pending=midiRenderOwner;midiRenderOwner=null;
  if(!pending||abort.signal.aborted||!root.isConnected||history!==pending.owner||projectGeneration!==pending.generation)return;
  audio.setProject(project(),arrangement());render();queueDraft();
 }
 function scheduleMidiRender(){
  midiRenderOwner={owner:history,generation:projectGeneration};
  if(midiRenderFrame===null)midiRenderFrame=requestAnimationFrame(flushMidiRender);
 }
 function recordMidiNote(note,captured){
  const a=project().arrangements.find(a=>a.id===captured.id);if(!a)return;
  const state=history.stateId;
  if(midiAppendScope?.owner===history&&midiAppendScope.id===a.id&&midiAppendScope.difficulty===a.activeDifficulty){
   try{midiAppendScope.appender.append(note);dirty=true;scheduleMidiRender();return;}
   catch(error){if(history.stateId!==state)throw error;midiAppendScope=null;}
  }
  // Unsorted or mismatched imported DD uses the established full edit path.
  change('Record MIDI note',()=>{a.notes.push(note);a.notes.sort((x,y)=>x.time-y.time);});
  if(midiRecording)prepareMidiAppendScope();
 }
 async function setupMidi(){
  if(midiConnection)return;if(midiSetupPromise)return midiSetupPromise;
  midiSetupPromise=(async()=>{const request=++midiConnectionGeneration;midiRecorder=new MidiRecorder({arrangement,getTime:()=>audio.currentTime,quantize,onAudition:auditionMidi,onNote:recordMidiNote,onUnmappable:event=>status(event.reason,true)});midiRecorder.stop();const connected=await connectMidiInput(midiRecorder,{onState:event=>{if(event.type==='input-disconnected'){stopMidi();status('MIDI input disconnected; audition and recording stopped',true);}}});if(abort.signal.aborted||!root.isConnected||request!==midiConnectionGeneration){connected.disconnect();return;}midiConnection=connected;updateMidiControls();})();
  try{await midiSetupPromise;}finally{midiSetupPromise=null;}
 }
 function updateMidiControls(){
  for(const button of root.querySelectorAll('[data-action="midi-monitor"]')){button.classList.toggle('active',midiAuditioning);button.setAttribute('aria-pressed',String(midiAuditioning));}
  const label=$('midi-status');if(label)label.textContent=midiRecording?'MIDI: Recording':midiAuditioning?'MIDI: Audition':midiConnection?.selectedInputId?'MIDI: Connected':'MIDI: Disconnected';
 }
 function stopMidi(){
  recordStartGeneration++;recordStartPending=false;transportStartGeneration++;localStartPending=false;midiCue.stop();
  const wasRecording=midiRecording,wasAuditioning=midiAuditioning;midiRecording=false;midiAuditioning=false;
  try{midiRecorder?.stop();}finally{midiAppendScope=null;flushMidiRender();$('record-midi')?.classList.remove('active');updateMidiControls();if(wasRecording||wasAuditioning)status(wasRecording?'MIDI recording stopped':'MIDI audition stopped');}
 }
 async function startMidiAudition(){
  if(arrangement().readOnly)throw Error('Choose an editable instrument for MIDI audition');
  stopMidi();const owner=history,generation=projectGeneration,request=++recordStartGeneration,current=()=>request===recordStartGeneration&&owner===history&&generation===projectGeneration&&!abort.signal.aborted&&root.isConnected;
  await setupMidi();if(!current())return;if(!midiConnection?.selectedInputId)throw Error('Connect and choose a MIDI input first');
  if(!await setupTonePreview()||!current())return;
  midiAuditioning=true;midiRecorder.startAudition();if(guide&&audio.enabled.guide)midiCue.start({context:audio.context,destination:audio.buses.guide});updateMidiControls();
  status('MIDI audition: '+arrangement().name+'; no chart notes are recorded'+(!guide||!audio.enabled.guide?' (guide muted)':''));
 }
 async function startLocalTransport(record=false,isRequested=()=>true){
  const owner=history,generation=projectGeneration,request=++transportStartGeneration;
  const current=()=>!abort.signal.aborted&&root.isConnected&&history===owner&&projectGeneration===generation&&request===transportStartGeneration&&isRequested();
  localStartPending=true;audio.setProject(project(),arrangement());
  const begin=async(isCountCurrent=()=>true)=>{await setupTonePreview();if(!current()||!isCountCurrent())return false;await audio.play(cursor);if(!current()||!isCountCurrent()||!audio.isPlaying)return false;if(record){if(guide&&audio.enabled.guide)midiCue.start({context:audio.context,destination:audio.buses.guide});midiRecorder.start();}return true;};
  try{if(countInOptions.enabled){const started=await countIn.start({project:project(),cursor,bars:countInOptions.bars,beats:countInOptions.beats,speed:audio.ramp.enabled?audio.ramp.startSpeed:audio.speed,onStart:begin});if(started&&current())status('Playing - count-in complete');return started&&current();}return await begin();}
  finally{if(request===transportStartGeneration)localStartPending=false;if(abort.signal.aborted||!root.isConnected)await audio.dispose();}
 }
 async function playtest(from){
  const vocalOnly=view==='vocals',sourceView=view;
  if(!vocalOnly&&arrangement().readOnly)throw Error('This retained source score has not been converted for native playtest');
  const selectedRange=vocalOnly?vocalSelectionRange:selectionRange;
  const loopRegion=from==='loop'?(selectedRange?{start:selectedRange.start,end:selectedRange.end}:loopRegionDefined?{start:audio.loop.start,end:audio.loop.end}:null):null;
  if(from==='loop'&&!loopRegion)throw Error('Select a time region or define an editor loop first');
  const time=from==='beginning'?0:loopRegion?loopRegion.start:audio.isPlaying?audio.currentTime:cursor;
  countIn.cancel();stopMidi();audio.pause();
  const sourceHistory=history,sourceState=history.stateId,sourceGeneration=projectGeneration,sourceArrangement=arrangement().id;
  const isCurrent=phase=>history===sourceHistory&&history.stateId===sourceState&&projectGeneration===sourceGeneration&&arrangement().id===sourceArrangement&&view===sourceView&&(phase==='started'||!abort.signal.aborted);
  status('Building local FeedBack preview...');
  try{preview=await buildAndPlaytest(project(),{arrangementId:sourceArrangement,vocalOnly,startTime:time,loopRegion,isCurrent});status(`Playtest build: ${preview.filename}${preview.loop?` / loop ${seconds(preview.loop.start)} to ${seconds(preview.loop.end)}`:''}. Esc / Close returns to the editor.`);}catch(e){if(e.preview)preview=e.preview;throw e;}
 }

 function localToneSelection(){const a=arrangement(),time=audio.isPlaying?audio.currentTime:cursor,allocated=(a.tones.changes||[]).findLast(t=>t.time<=time)?.name||a.tones.base,name=view==='tones'&&auditionSelectedTone&&Object.hasOwn(a.tones.definitions||{},selectedTone)?selectedTone:allocated;return{a,name,tone:a.tones.definitions?.[name]};}
 function updateTonePreview(force=false){if(!tonePreview&&!liveInput.effect)return;const{a,name,tone}=localToneSelection(),adaptiveState=toneEnvelopeStatus(audio.context).state;if(force||name!==previewToneName||tone!==previewToneDefinition||a.id!==previewToneArrangement||adaptiveState!==previewAdaptiveState){try{if(typeof tonePreview?.setTone==='function'&&typeof tonePreview?.clearTone==='function'){if(tone?.GearList)tonePreview.setTone(tone);else tonePreview.clearTone();toneEffectOwners.set(tonePreview,{tone,arrangementId:a.id});}if(typeof liveInput.effect?.selectTone==='function')liveInput.effect.selectTone(tone,name);else if(typeof liveInput.effect?.setTone==='function'&&typeof liveInput.effect?.clearTone==='function'){if(tone?.GearList)liveInput.effect.setTone(tone);else liveInput.effect.clearTone();toneEffectOwners.set(liveInput.effect,{tone,arrangementId:a.id});}}catch(error){if(typeof tonePreview?.clearTone==='function')tonePreview.clearTone();status('Local tone preview bypassed: '+error.message,true);}previewToneName=name;previewToneDefinition=tone;previewToneArrangement=a.id;previewAdaptiveState=adaptiveState;refreshToneDisclosures();}}
 function render(){
  if(view!=='vocals'){if(lyricSession)queueMicrotask(()=>stopLyricTapping());disposeVocalTimeline();}
  if(['tab','tempo'].includes(view)&&view!==timelineView){const old=zoom,wasBottom=timelineView==='tab'&&rollOrientations[arrangement().type]==='bottom',pan=wasBottom?scroll.scrollTop:scroll.scrollLeft;viewZoom[timelineView]=zoom;zoom=viewZoom[view]??zoom;timelineView=view;$('zoom').value=zoom;scroll.scrollLeft=0;scroll.scrollTop=0;setTimeScroll(pan*zoom/old);}
  applyLayout();
  const a=arrangement();$('title').textContent=`${project().artist} — ${project().title}`;$('dirty').textContent=dirty?'●':'';
  $('arrangement').innerHTML=project().arrangements.map(x=>`<option value="${esc(x.id)}" ${x.id===a.id?'selected':''}>${esc(x.name)} · ${esc(x.type)}${x.editorOnly?' · editor only':''}${x.locked?' · locked':''}${x.hidden?' · hidden':''}</option>`).join('');[...$('arrangement').options].forEach((option,i)=>{if(project().arrangements[i]?.hidden)option.style.color='#7c8190';});
  $('difficulty').innerHTML=(a.difficulties?.length?a.difficulties:[{difficulty:0,notes:a.notes}]).map(l=>`<option value="${l.difficulty}" ${l.difficulty===(a.activeDifficulty??0)?'selected':''}>Level ${l.difficulty} · ${l.notes?.length||0} notes</option>`).join('');
  for(const mode of ['tab','tempo','tones','vocals'])$(`${mode}-button`)?.classList.toggle('active',view===mode);
  $('tempo-tools').hidden=view!=='tempo';canvas.hidden=['tones','vocals'].includes(view);$('tone-view').hidden=view!=='tones';$('vocal-view').hidden=view!=='vocals';spacer.hidden=['tones','vocals'].includes(view);
  $('tool').textContent=tool==='pointer'?'Select':tool==='pencil'?'Pencil':'Eraser';$('loop').classList.toggle('active',loop);$('click').classList.toggle('active',click);$('guide').classList.toggle('active',guide);
  $('record-midi').classList.toggle('active',midiRecording||recordStartPending);updateMidiControls();
  refreshPlaytestAvailability();
  const sections=project().sections;$('overview').innerHTML=(sections.length?sections:[{name:'Song',start_time:0}]).map((s,i)=>`<span style="flex:${Math.max(0.1,(sections[i+1]?.start_time??project().duration)-s.start_time)};background:${COLORS[i%COLORS.length]}" title="${esc(s.name)}" data-overview-time="${s.start_time}"></span>`).join('');
  updateClock();renderInspector();renderBottom();$('difficulty').disabled=!!a.readOnly;if(a.readOnly&&view!=='vocals'){canvas.hidden=true;spacer.hidden=true;$('tone-view').hidden=false;$('tone-view').innerHTML=`<section data-retained-score><h2>${esc(a.name)}: retained source score</h2><p>${esc(a.instrument||'Notation')} | ${esc(a._entry?.notation||'Original source')}</p><p>This score is preserved in FeedPak and editable project saves. It has not been converted into editable notes. Choose an editable part to author tab or use native playtest.</p></section>`;}else if(view==='tones')renderTones();else if(view==='vocals')renderVocals();else draw();updateTonePreview(true);
 }
 function refreshPlaytestAvailability(){const a=arrangement(),hostPlayback=typeof window.feedBack?.capabilities?.dispatch==='function',vocalReady=view!=='vocals'||typeof window.feedBackViz_vocal_highway==='function'&&(project().vocals||[]).some(row=>Number.isInteger(row.pitch)&&row.pitch>=0&&row.pitch<=127&&row.length>0),blocked=!hostPlayback||!vocalReady||(view!=='vocals'&&(!!a.editorOnly||!!a.readOnly));root.querySelectorAll('[data-action="playtest-start"],[data-action="playtest-cursor"]').forEach(button=>{button.disabled=blocked;button.title=view==='vocals'&&!vocalReady?'Enable Vocal Highway and author a pitched syllable with positive duration':'Build and audition the current editor view';});updateLoopPlaytestAvailability();}
 async function bulkFingerprints(remove=false){
  const hasRange=!!selectionRange||selected().length>0;
  const html=`<label>Scope<select id="ws-fingerprint-scope"><option value="all" ${hasRange?'':'selected'}>Entire current arrangement</option><option value="selection" ${hasRange?'selected':''}>Selected time region / selected note span</option></select></label>${remove?'<label>Remove<select id="ws-fingerprint-remove"><option value="fingerprints">Fingerprint zones only</option><option value="all-zones">All handshape zones, including chord/arpeggio zones</option></select></label><p class="ws-muted">Removes zones whose start lies in the chosen time range. Sounding notes, strums and templates stay intact.</p>':field('Join repeated same-shape strums within (beats)','fingerprint-gap',1,'number','min="0" max="10000" step="0.25"')+field('Tail after final strum (beats)','fingerprint-tail',1,'number','min="0.000001" max="10000" step="any"')+field('Gutter before the next shape (beats)','fingerprint-gutter',0,'number','min="0" max="10000" step="0.03125"')+'<p class="ws-muted">Uses existing chord templates and strums. Matching notes may lie inside each held shape. Existing fingerprint/arpeggio overlaps, mismatched notes and partial chord zones are skipped. Notes, strums and their sustains stay intact.</p>'}<p class="ws-muted">Only the current visible difficulty is edited. Other stored levels stay intact.</p>`;
  if(!await dialog(remove?'Remove fingerprint zones':'Generate fingerprint zones',html,remove?'Remove zones':'Generate'))return;
  const range=$('fingerprint-scope').value==='selection'?(selectionRange||rangeForSelectedNotes(project(),selected(),cursor,{division:snap||4})):null;
  if(range&&!hasRange)throw Error('Select notes or a positive time region first');
  const options={duration:project().duration,range,...(remove?{mode:$('fingerprint-remove').value}:{maxGapBeats:Number($('fingerprint-gap').value),tailBeats:Number($('fingerprint-tail').value),gutterBeats:Number($('fingerprint-gutter').value)})};
  let result;change(remove?'Remove fingerprint zones':'Generate fingerprint zones',()=>{result=remove?removeFingerprintZones(arrangement(),options):generateFingerprintZones(arrangement(),project().beats,options);selectedZoneIndex=null;});
  status(remove?`Removed ${result.removed} handshape zones`:`Created ${result.created} fingerprint zones; ${result.skippedExisting} already covered, ${result.skippedConflict} conflicts, ${result.skippedOutside} outside scope`);
 }
 function navigateHistory(move){
  stopMidi();const state=history.stateId;countIn.cancel();audio.pause();move();
  if(state===history.stateId)return;
  if(!project().arrangements.some(a=>a.id===arrangementId))arrangementId=project().arrangements[0].id;
  selection.clear();selectionRange=null;markerSelection=null;dirty=true;audio.setProject(project(),arrangement());syncProjectAudio();render();queueDraft();
 }
 const actions={
  'arrangement-info':()=>{inspectorVisible=true;inspector='settings';applyLayout();renderInspector();draw();$('arr-name')?.focus({preventScroll:true});},
  new:async()=>{const request=++openGeneration;if(await dialog('New project','<p>Create a blank project? Save any edits first.</p>','Create')&&request===openGeneration)switchProject(makeProject());},
  welcome:()=>recentDialog(true),'open-recent':()=>recentDialog(),
  demo:async()=>{const request=++openGeneration;if(await confirmReplace()&&request===openGeneration)switchProject(demoProject());},open:()=>openProjectDialog(),'open-folder':()=>$('open-folder').click(),'import-chart':()=>$('import-file').click(),'import-lyrics':()=>$('lyrics-file').click(),audio:()=>$('audio-file').click(),save:()=>saveAs(true),saveas:()=>saveAs(),
  undo:()=>navigateHistory(()=>history.undo()),redo:()=>navigateHistory(()=>history.redo()),'history-checkpoint':()=>{history.setCheckpoint();renderBottom();status('History checkpoint set');},'history-return':()=>navigateHistory(()=>history.returnToCheckpoint()),
  tab:()=>{stopMidi();view='tab';render();},tempo:()=>{stopMidi();view='tempo';render();},tones:()=>{stopMidi();view='tones';render();},
  vocals:()=>{stopMidi();view='vocals';render();},
  'vocal-add':()=>vocalEdit('add',{time:cursor}),
  'vocal-phrase':async()=>{if(await dialog('Enter original lyric phrase',field('Text','vocal-phrase','')+field('Seconds per syllable','vocal-step',.5,'number','min="0.05" step="0.01"')+'<p class="ws-muted">Whitespace separates syllables. The whole phrase must fit within the song duration.</p>')){const rows=project().vocals||[],added=createVocalPhrase($('vocal-phrase').value,{at:cursor,step:Number($('vocal-step').value),duration:project().duration,count:rows.length,uid,existingIds:rows.map(row=>row.id)});pendingVocalSelection=added.map(row=>row.id);change('Enter vocal phrase',p=>{(p.vocals||=[]).push(...added);p.vocals.sort((a,b)=>a.time-b.time);});}},
  'toggle-inspector':()=>{inspectorVisible=!inspectorVisible;applyLayout();draw();},'split-view':async()=>{
   const parts=project().arrangements.filter(a=>!a.readOnly);if(parts.length<2)throw Error('Add a second arrangement to show arrangements together');
   const chosen=new Set(splitActive()?splitBandIds():[arrangementId]);
   if(!await dialog('Show arrangements together',`<p>Stack arrangements on one timeline to decide which notes belong on which part. Each one stays a full editor: click inside a part to edit it. Phrase, tone and anchor lanes and the chord strip fold away while several are shown.</p><div class="ws-split-list">${parts.map(a=>`<label><input type="checkbox" data-split-id="${esc(a.id)}" ${chosen.has(a.id)?'checked':''}> ${esc(a.name)} <span class="ws-muted">${esc(a.instrument&&a.instrument!==a.type?a.instrument:a.type)}</span></label>`).join('')}</div><p class="ws-muted">Leave one ticked to go back to a single editor.</p>`))return;
   const picked=[...root.querySelectorAll('[data-split-id]')].filter(input=>input.checked).map(input=>input.dataset.splitId);
   splitIds=picked.length>1?picked:[];
   if(picked.length&&!picked.includes(arrangementId)){countIn.cancel();stopMidi();arrangementId=picked[0];selectedZoneIndex=null;selection.clear();selectionRange=null;markerSelection=null;audio.setProject(project(),arrangement());}
   if(splitIds.length&&view!=='tab')view='tab';
   render();status(splitIds.length?`Showing ${splitIds.length} arrangements together · click a part to edit it`:'Showing one arrangement');
  },
  'live-input':async()=>{
  if(liveInput.active||liveInput.pending){liveInput.stop();status('Live input stopped');return;}
  const devices=await liveInput.listDevices();let at5={available:false,message:'AmpliTube host status is unavailable'};
  try{
   const response=await fetch('/api/plugins/open_chart_editor/at5/status',{signal:abort.signal});
   if(!response.ok)throw Error(`AT5 host status returned HTTP ${response.status}`);
   at5=await response.json();
  }catch(error){if(abort.signal.aborted)return;at5={available:false,message:error.message};}
  if(!await dialog('Monitor live instrument',`<p>Use headphones to avoid speaker feedback. Browser and interface latency apply.</p><label>Audio input<select id="ws-live-device"><option value="" ${liveMonitorOptions.deviceId?'':'selected'}>System default input</option>${devices.map(d=>`<option value="${esc(d.id)}" ${d.id===liveMonitorOptions.deviceId?'selected':''}>${esc(d.label)}</option>`).join('')}</select></label><label>Live tone processor<select id="ws-live-engine"><option value="software" ${liveMonitorOptions.engine==='software'?'selected':''}>OCE software preview (approximate)</option><option value="at5-vst3" ${at5.available?'':'disabled'} ${liveMonitorOptions.engine==='at5-vst3'?'selected':''}>AmpliTube 5 VST3 ${at5.available?'':'(unavailable)'}</option></select></label><p class="ws-muted">${esc(at5.message)}</p><label>AmpliTube model tier<select id="ws-live-tier"><option value="max" ${liveMonitorOptions.tier==='max'?'selected':''}>MAX — closest available match</option><option value="at5" ${liveMonitorOptions.tier==='at5'?'selected':''}>AT5</option><option value="se" ${liveMonitorOptions.tier==='se'?'selected':''}>SE</option><option value="cs" ${liveMonitorOptions.tier==='cs'?'selected':''}>CS / free</option></select></label><label>AmpliTube audio block size<select id="ws-live-block-size"><option value="256" ${liveMonitorOptions.frameCount===256?'selected':''}>256 samples — lowest latency</option><option value="512" ${liveMonitorOptions.frameCount===512?'selected':''}>512 samples</option><option value="1024" ${liveMonitorOptions.frameCount===1024?'selected':''}>1024 samples — most stable</option></select></label><p class="ws-muted">Smaller blocks can reduce bridge latency but may cause dropouts on slower systems. 256 samples is about 5.3 ms per block at 48 kHz; 1024 is about 21.3 ms. This is only one part of total latency. If you hear glitches, choose a larger block. This setting applies to AmpliTube monitoring.</p><p class="ws-muted">When AmpliTube is selected, OCE converts the chart's Rocksmith GearList with FeedBack's RS-to-AT5 mappings. It loads the active tone before monitoring and switches presets at chart tone changes. MAX uses the full mapping set; choose the tier matching your installed AmpliTube edition. This is the closest available model match, not an exact reproduction of Rocksmith DSP. Audio stays on this computer and is not recorded.</p><p class="ws-muted">Input processing requests echo cancellation, noise suppression and automatic gain off. Select Monitor to request browser permission.</p>`,'Monitor'))return;
  status('Preparing live input...');
  try{
   liveMonitorOptions={deviceId:$('live-device').value,engine:$('live-engine').value,tier:$('live-tier').value,frameCount:Number($('live-block-size').value)};
   persistPreferences();
   const engine=liveMonitorOptions.engine,options={engine};
   if(engine==='at5-vst3'){options.tier=liveMonitorOptions.tier;options.frameCount=liveMonitorOptions.frameCount;}
   const result=await liveInput.start(liveMonitorOptions.deviceId,options);
   if(!result.stale)status('Monitoring '+result.label+' locally');
  }catch(error){status('Live input: '+error.message,true);}
  },
  'chord-strip':()=>{chordStrip={...chordStrip,visible:true,open:!chordStrip.open};persistPreferences();draw();},
  'chord-strip-move':()=>{chordStrip={...chordStrip,visible:true,position:chordStrip.position==='above'?'below':'above'};persistPreferences();draw();status(`Chord strip ${chordStrip.position} the strings`);},
  'chord-strip-rotate':()=>{chordStrip={...chordStrip,visible:true,open:true,upright:!chordStrip.upright};persistPreferences();draw();status(`Chord diagrams ${chordStrip.upright?'upright':'tab-style'}`);},
  'chord-strip-show':()=>{chordStrip={...chordStrip,visible:!chordStrip.visible};persistPreferences();draw();},
  'slide-cycle':()=>cycleSlide(),
  live:()=>{bottom='live';if(bottomHeight<320){bottomHeight=320;persistPreferences();}revealBottom();applyLayout();renderBottom();draw();},
  'keyboard-settings':async()=>{
   let profile=keyProfile;const draft=clone(keyOverrides),label=id=>ACTIONS.find(x=>x.id===id)?.label||id;
   const rows=()=>{const map=buildKeymap(profile,draft[profile]||{}),changes=draft[profile]||{};return [...new Set(ACTIONS.map(x=>x.group))].map(group=>`<tr><th colspan="3">${esc(group)}</th></tr>`+ACTIONS.filter(x=>x.group===group).map(x=>{const keys=map.byCommand.get(x.id)||[],changed=Object.hasOwn(changes,x.id),reserved=keys.some(k=>BROWSER_RESERVED.has(k));return `<tr><td>${esc(x.label)}</td><td>${keys.length?keys.map(k=>`<kbd>${esc(displayCombo(k))}</kbd>`).join(' '):'<span class="ws-muted">none</span>'}${changed?' <span class="ws-muted">(changed)</span>':''}${reserved?' <span title="A browser tab may keep this key for itself; it works in the FeedBack desktop app">⚠</span>':''}</td><td><button type="button" data-key-set="${x.id}">Set…</button>${changed?` <button type="button" data-key-reset="${x.id}">Reset</button>`:''}</td></tr>`;}).join('')).join('');};
   const pending=dialog('Keyboard and mouse',`<label>Mouse<select id="ws-mouse-model"><option value="standard" ${mouseModel==='standard'?'selected':''}>Open Chart Editor / R+ Workshop: right-click opens a menu, the wheel scrolls</option><option value="eof" ${mouseModel==='eof'?'selected':''}>EOF: right-click adds or removes a note, the wheel sets sustain, Ctrl+wheel the fret, middle-click edits</option></select></label><p class="ws-muted">With the EOF mouse, left-click only selects, the wheel and Ctrl+wheel act on selected notes (with nothing selected they scroll and zoom as usual), and Shift+right-click still opens the menu.</p><label>Keyboard profile<select id="ws-key-profile">${PROFILE_IDS.map(id=>`<option value="${id}" ${id===profile?'selected':''}>${esc(PROFILES[id].label)}</option>`).join('')}</select></label><p class="ws-muted" id="ws-key-note"></p><label><input type="checkbox" id="ws-key-each" ${techniqueToggleEach?'checked':''}> Technique keys set each selected note on its own, instead of making them all the same</label><p class="ws-muted">Set… waits for the next key you press: Escape cancels, Backspace removes the command's keys. A key given to one command is taken from any other. ⚠ marks keys a browser tab may keep for itself.</p><div class="ws-key-table"><table><tbody id="ws-key-rows"></tbody></table></div><button type="button" id="ws-key-reset-all">Reset all changes for this profile</button>`,'Apply',{allowStateChanges:true});
   const paint=(note=PROFILES[profile].note)=>{$('key-rows').innerHTML=rows();$('key-note').textContent=note;};paint();
   on($('key-profile'),'change',e=>{profile=e.target.value;paint();});
   on($('key-reset-all'),'click',()=>{delete draft[profile];paint('All keys back to the profile');});
   on($('key-rows'),'click',e=>{
    const reset=e.target.closest('[data-key-reset]');if(reset){delete draft[profile]?.[reset.dataset.keyReset];paint();return;}
    const set=e.target.closest('[data-key-set]');if(!set)return;set.textContent='Press a key…';
    const capture=ev=>{const combo=comboFromEvent(ev);if(!combo)return;ev.preventDefault();ev.stopPropagation();window.removeEventListener('keydown',capture,true);const id=set.dataset.keySet;
     if(combo==='Escape'){paint();return;}draft[profile]??={};
     if(combo==='Backspace'||combo==='Delete'){draft[profile][id]=[];paint(`${label(id)}: no key`);return;}
     const previous=buildKeymap(profile,draft[profile]).byCombo.get(combo);draft[profile][id]=[combo];
     paint(previous&&previous!==id?`${displayCombo(combo)} moved from “${label(previous)}” to “${label(id)}”`:`${label(id)}: ${displayCombo(combo)}`);};
    window.addEventListener('keydown',capture,true);
   });
   if(!await pending)return;
   keyProfile=profile;techniqueToggleEach=$('key-each').checked;mouseModel=$('mouse-model').value==='eof'?'eof':'standard';keyOverrides=draft;keymapCache=null;persistPreferences();refreshMenuKeys();
   status(`Keyboard: ${PROFILES[profile].label}${Object.keys(draft[profile]||{}).length?' with your changes':''} · ${mouseModel==='eof'?'EOF mouse':'standard mouse'}`);
  },
  'toggle-bottom':()=>{bottomVisible=!bottomVisible;applyLayout();persistPreferences();if(bottomVisible)renderBottom();draw();},'reset-layout':()=>{inspectorVisible=true;inspectorWidth=280;bottomHeight=155;bottomVisible=true;applyLayout();renderBottom();draw();},scratch:()=>{ensureScratch();bottom='scratch';revealBottom();renderBottom();},'scratch-focus':()=>{countIn.cancel();stopMidi();const next=arrangement().editorOnly?mainPart():ensureScratch();arrangementId=next.id;selection.clear();selectionRange=null;markerSelection=null;fitPianoRange();audio.setProject(project(),arrangement());bottom='scratch';render();},mixer:()=>{bottom='mixer';revealBottom();renderBottom();},stave:()=>{bottom='stave';if(bottomHeight<300){bottomHeight=300;persistPreferences();}revealBottom();applyLayout();renderBottom();draw();},history:()=>{bottom='history';revealBottom();renderBottom();},errors:()=>{bottom='errors';revealBottom();renderBottom();},
  play:async()=>{if(audio.isPlaying||audio.preparing||countIn.isCounting||localStartPending||recordStartPending){const counting=countIn.isCounting,preparing=audio.preparing||localStartPending||recordStartPending;countIn.cancel();stopMidi();if(!counting)cursor=audio.currentTime;audio.pause();if(counting)status('Count-in cancelled');else if(preparing){qualityMessage='Preview preparation cancelled';if($('quality-status'))$('quality-status').textContent=qualityMessage;status(qualityMessage);}}else await startLocalTransport();updateClock();},
  'count-in':async()=>{if(await dialog('Local preview count-in',`<label><input id="ws-count-in-enabled" type="checkbox" ${countInOptions.enabled?'checked':''}>Enable before local playback and MIDI recording</label><label>Count in<select id="ws-count-in-mode"><option value="bars" ${countInOptions.beats==null?'selected':''}>Bars of the current meter</option><option value="beats" ${countInOptions.beats!=null?'selected':''}>Meter pulses</option></select></label>${field('Number','count-in-count',countInOptions.beats??countInOptions.bars,'number','min="1" max="128"')}<p class="ws-muted">Original preview clicks follow the meter and practice speed at the cursor. Source audio, chart times and exports stay unchanged.</p>`)){const number=Number($('count-in-count').value),options={enabled:$('count-in-enabled').checked,bars:$('count-in-mode').value==='bars'?number:1,beats:$('count-in-mode').value==='beats'?number:null};planCountIn(project(),cursor,options);countIn.cancel();countInOptions=options;status(options.enabled?`Count-in enabled: ${number} ${options.beats==null?'bar(s)':'meter pulses'}`:'Count-in disabled');}},
  'midi-input':async()=>{const owner=history,generation=projectGeneration;await setupMidi();if(!midiConnection||history!==owner||projectGeneration!==generation)return;if(!midiConnection.inputs.length){await dialog('Connect MIDI','<p>No connected MIDI inputs were reported by this browser.</p>','Close');return;}if(await dialog('Connect MIDI',`<label>Input<select id="ws-midi-device">${midiConnection.inputs.map(input=>`<option value="${esc(input.id)}" ${input.id===midiConnection.selectedInputId?'selected':''}>${esc(input.name)}</option>`).join('')}</select></label><label>Mode<select id="ws-midi-mode"><option value="audition">Audition / monitor ? no chart changes</option><option value="record">Record into active arrangement</option><option value="connect">Connect only ? silent</option></select></label><p class="ws-muted">Audition plays the original guide sound without moving playback or writing notes. Drum pads use the GM kit map. Record starts the transport and captures timing, velocity and note lengths.</p>`,'Connect')){if(history!==owner||projectGeneration!==generation||!midiConnection)return;const device=$('midi-device').value,mode=$('midi-mode').value;stopMidi();await midiConnection.selectInput(device);if(history!==owner||projectGeneration!==generation)return;if(mode==='audition')await startMidiAudition();else if(mode==='record')await actions['record-midi']();else{updateMidiControls();status('MIDI connected; audition and recording are stopped');}}},
  'midi-monitor':async()=>{if(midiAuditioning)stopMidi();else await startMidiAudition();},
  'midi-stop':()=>{stopMidi();status('MIDI stopped');},
  'midi-disconnect':()=>{stopMidi();midiConnectionGeneration++;midiConnection?.disconnect();midiConnection=null;midiRecorder=null;updateMidiControls();status('MIDI disconnected');},
  'record-midi':async()=>{
   if(midiRecording||recordStartPending||countIn.isCounting){const counting=countIn.isCounting;countIn.cancel();stopMidi();if(!counting)cursor=audio.currentTime;audio.pause();updateClock();return;}
   stopMidi();const owner=history,generation=projectGeneration,request=++recordStartGeneration,current=()=>request===recordStartGeneration&&history===owner&&projectGeneration===generation&&!abort.signal.aborted&&root.isConnected;
   recordStartPending=true;$('record-midi')?.classList.add('active');status('Preparing MIDI recording...');
   try{if(arrangement().locked)throw Error(`${arrangement().name} is locked; unlock it before recording into it`);await setupMidi();if(!current())return;if(!midiConnection?.selectedInputId)throw Error('Connect and choose a MIDI input first');if(audio.isPlaying){cursor=audio.currentTime;audio.pause();}prepareMidiAppendScope();if(!current()||!await startLocalTransport(true,current)||!current()){midiAppendScope=null;return;}midiRecording=true;render();status('Recording MIDI into '+arrangement().name);}
   finally{if(request===recordStartGeneration){recordStartPending=false;$('record-midi')?.classList.toggle('active',midiRecording);}}
  },
  'playtest-start':()=>playtest('beginning'),'playtest-cursor':()=>playtest('cursor'),'playtest-loop':()=>playtest('loop'),
  'playtest-end':async()=>{if(!preview)throw Error('No chart playtest is active');await endPlaytest(preview);status('Playtest ended; the local preview build remains in the library until removed.');},
  'playtest-remove':async()=>{if(!preview)throw Error('No generated preview build is recorded in this session');await removePreview(preview);status('Removed the generated preview build');preview=null;},
  'render-guide':async()=>{
   if(actions['render-guide'].cancel){actions['render-guide'].cancel();status('Practice render cancelled');return;}
   const renderer=actions['render-guide'].renderer??=new PracticeRenderer();
   if(!actions['render-guide'].cleanup){
    const leave=event=>{const id=typeof event==='string'?event:event?.detail?.id||event?.id||event?.screen;if(id&&!['open_chart_editor','plugin-open_chart_editor'].includes(id))actions['render-guide'].cancel?.();};
    const off=window.feedBack?.on?.('screen:changed',leave);
    audio.disposers.add(()=>{actions['render-guide'].cancel?.();renderer.dispose();if(typeof off==='function')off();else window.feedBack?.off?.('screen:changed',leave);});actions['render-guide'].cleanup=true;
   }
   const originalHistory=history,generation=projectGeneration,title=project().title||'Original study';let changed=false;
   const valid=()=>!changed&&history===originalHistory&&generation===projectGeneration&&root.isConnected&&!abort.signal.aborted;
   const edited=()=>{changed=true;renderer.cancel('Practice render discarded because the project changed');};originalHistory.listeners.add(edited);actions['render-guide'].cancel=()=>{changed=true;renderer.cancel();};
   const button=root.querySelector('[data-action="render-guide"]');if(button)button.textContent='Cancel practice render';
   try{
    status('Rendering original practice audio in background; select Render again to cancel');
    const bytes=await renderer.render(project(),{isCurrent:valid,onProgress:value=>status(`Rendering original practice audio: ${Math.round(value*100)}% / select Render again to cancel`)});
    if(!valid())return;
    const attached=await uploadAudio(new File([bytes],`${title}.wav`,{type:'audio/wav'}),{isCurrent:valid,onAttach:()=>originalHistory.listeners.delete(edited)});
    if(attached)status('Original practice backing rendered and attached');
   }catch(error){if(error.name==='AbortError'){if(root.isConnected)status(error.message);}else throw error;}
   finally{actions['render-guide'].cancel=null;originalHistory.listeners.delete(edited);if(button)button.textContent='Render original practice audio';}
  },
  start:()=>setCursor(0),end:()=>setCursor(project().duration),back:()=>setCursor(timeAt(project().beats,Math.max(0,Math.floor(beatAt(project().beats,cursor)-0.001)))),forward:()=>setCursor(timeAt(project().beats,Math.floor(beatAt(project().beats,cursor))+1)),
  metronome:()=>{click=!audio.enabled.metronome;audio.setEnabled('metronome',click);render();},guide:()=>{guide=!audio.enabled.guide;if(!guide)midiCue.stop();audio.setEnabled('guide',guide);render();},
  loop:()=>{loop=!loop;const notes=view==='vocals'?[]:selected(),range=view==='vocals'?vocalSelectionRange:selectionRange,start=range?.start??(notes.length?Math.min(...notes.map(n=>n.time)):Number($('loop-start')?.value)??audio.loop.start),end=range?.end??(notes.length?Math.max(...notes.map(n=>n.time+Math.max(n.sustain,0.5))):Number($('loop-end')?.value)??audio.loop.end);audio.setLoop(Number.isFinite(start)?start:audio.loop.start,Number.isFinite(end)?end:audio.loop.end,loop);loopRegionDefined=true;render();},
  tool:()=>{tool=tool==='pointer'?'pencil':tool==='pencil'?'eraser':'pointer';render();},note:()=>insertNote(),selectall:()=>{selection=new Set(editableNotes().map(n=>n.id));selectionRange=null;inspector='properties';markerSelection=null;render();},
  'select-like':()=>{if(!selection.size){status('Select a note to match first');return;}selection=selectLike(arrangement(),selection);selectionRange=null;markerSelection=null;inspector='properties';render();status(`Selected ${selection.size} matching notes / chord members`);},
  delete:()=>change(selectionRange?'Clear region':'Delete notes',p=>{if(selectionRange){clearRegion(p,arrangement().id,selectionRange.start,selectionRange.end);selectionRange=null;}else{const a=arrangement();a.notes=a.notes.filter(n=>!selection.has(n.id));a.chords=a.chords.flatMap(c=>{const kept=(c.notes||[]).filter(n=>!selection.has(n.id));if(kept.length===(c.notes||[]).length)return[c];if(kept.length<2){a.notes.push(...kept);return[];}const old=a.chord_templates[c.chord_id]||{},template=clone(old);template.name ||= 'Chord';template.frets=Array.from({length:a.stringCount},(_,s)=>kept.find(n=>n.string===s)?.fret??-1);template.fingers=Array.from({length:a.stringCount},(_,s)=>kept.some(n=>n.string===s)?old.fingers?.[s]??-1:-1);a.chord_templates.push(template);return[{...c,chord_id:a.chord_templates.length-1,notes:kept}];});}selection.clear();}),
  'marker-delete':()=>change('Remove timeline marker',()=>{if(markerSelection)markerList(markerSelection.kind).splice(markerSelection.index,1);markerSelection=null;}),
  copy:()=>{clipboard=selectionRange?copyRegion(project(),arrangement().id,selectionRange.start,selectionRange.end):copySelection(project(),arrangement().id,selection)||[];status(selectionRange?'Copied notes, chords and structure in region':`Copied ${selected().length} notes / chord members`);refreshActionAvailability();},
  paste:()=>{if(clipboard.kind==='oce-region'){change('Paste region',p=>{const notes=pasteRegion(p,arrangement().id,clipboard,cursor);selection=new Set(notes.map(n=>n.id));selectionRange={start:cursor,end:cursor+clipboard.duration};});return;}if(!clipboard.length)return;const offset=cursor-Math.min(...clipboard.map(n=>n.time));change('Paste notes',()=>{const notes=clipboard.map(n=>({...clone(n),id:uid(),time:n.time+offset}));arrangement().notes.push(...notes);selection=new Set(notes.map(n=>n.id));selectionRange=null;});},
  selectphrase:()=>{const phrases=[...arrangement().phrases].sort((a,b)=>a.time-b.time),index=phrases.findLastIndex(p=>p.time<=cursor);selectRegion(phrases[index]?.time||0,phrases[index+1]?.time??project().duration);},
  selectmeasure:()=>{const beats=project().beats.filter(b=>b.measure>=0),index=beats.findLastIndex(b=>b.time<=cursor);selectRegion(beats[index]?.time||0,beats[index+1]?.time??project().duration);},
  selectregion:async()=>{if(await dialog('Select time region',field('Start (s)','region-start',selectionRange?.start??cursor,'number','min="0" step="0.001"')+field('End (s)','region-end',selectionRange?.end??Math.min(project().duration,cursor+2),'number','min="0" step="0.001"')))selectRegion(Number($('region-start').value),Number($('region-end').value));},
  'selection-expand':()=>editSelectionEdges('expand'),'selection-shrink':()=>editSelectionEdges('shrink'),
  'sustain-more':()=>stepSustains(1),
  'sustain-less':()=>stepSustains(-1),
  'sustain-toggle':()=>{const enabled=!selected().every(n=>n.sustain>0);editSustains('Toggle sustain',n=>enabled?Math.max(n.sustain,timeAt(project().beats,beatAt(project().beats,n.time)+1)-n.time):0,{snapped:enabled&&snap>0&&snapOptions.mode==='grid'});},
  'sustain-settings':sustainSettings,
  'sustain-gutter':()=>{sustainOptions.gutterEnabled=!sustainOptions.gutterEnabled;sustainProvenance=new WeakMap();persistPreferences();status(`Sustain gutter ${sustainOptions.gutterEnabled?'on':'off'} (${sustainOptions.gutterBeats} beats)`);},
  bend:()=>change('Raise bend at cursor',()=>adjustBendAtCursor(arrangement(),selection,cursor,.5)),
  'bend-curve':async()=>{const note=selected()[0];if(!note)throw Error('Select a note first');const current=note.techniques.bend_values||[{t:0,v:0},{t:Math.max(0.1,note.sustain),v:note.techniques.bend||1}];if(await dialog('Bend curve','<p class="ws-muted">Time is seconds relative to the note; value is semitones. Points must be ordered and within the sustain.</p><textarea id="ws-bend-points">'+esc(JSON.stringify(current,null,2))+'</textarea>')){const points=JSON.parse($('bend-points').value);if(!Array.isArray(points)||points.some((p,i)=>!Number.isFinite(p.t)||!Number.isFinite(p.v)||p.t<0||p.t>note.sustain||p.v<0||(i>0&&p.t<points[i-1].t)))throw Error('Invalid bend curve points');editSelection('Edit bend curve',n=>{n.techniques.bend_values=clone(points);n.techniques.bend=Math.max(...points.map(p=>p.v));});}},
  'fingerprints-generate':()=>bulkFingerprints(),'fingerprints-remove':()=>bulkFingerprints(true),'zone-fit':()=>fitZoneEnds(),'anchor-fit':()=>fitAnchorCoverage(),
  handshape:()=>{const notes=selected();if(!notes.length)throw Error('Select notes in the hand-shape region first');change('Create hand shape',()=>{const a=arrangement(),index=a.chord_templates.length-1;if(index<0)throw Error('Create a chord template first');a.handshapes.push({chord_id:index,start_time:Math.min(...notes.map(n=>n.time)),end_time:Math.max(...notes.map(n=>n.time+Math.max(n.sustain,0.25)))});});},
  gutter:async()=>{if(await dialog('Chord-zone gutter',field('Gap (seconds)','gutter-gap',0.0625,'number','min="0" step="0.001"')+'<p class="ws-muted">Leave a gap before the next chord zone. Notes remain unchanged.</p>'))change('Shorten hand-shape gutter',()=>{const zones=arrangement().handshapes.sort((a,b)=>a.start_time-b.start_time),gap=Number($('gutter-gap').value);zones.forEach((h,i)=>{if(zones[i+1])h.end_time=Math.max(h.start_time,Math.min(h.end_time,zones[i+1].start_time-gap));});});},
  'difficulty-generate':async()=>{if(await dialog('Generate difficulty levels',field('Number of levels','difficulty-count',4,'number','min="2" max="16"')+'<p class="ws-muted">Generate from the currently visible level. The full source is retained at the highest level; linked techniques and chord voicings stay together. You can author every level afterward.</p>'))changeScope('Generate difficulty ladder',p=>{generateDifficultyLadder(arrangement(),{levels:Number($('difficulty-count').value),retainDownbeats:true,beats:p.beats});selection.clear();});},
  'difficulty-phrase':()=>phraseDifficultyDialog(),
  'difficulty-add':()=>changeScope('Duplicate difficulty level',()=>{addDifficulty(arrangement());selection.clear();}),
  'difficulty-remove':()=>changeScope('Remove difficulty level',()=>{removeDifficulty(arrangement(),arrangement().activeDifficulty??0);selection.clear();}),
  anchor:async()=>{const a=arrangement(),existing=a.anchors.findIndex(anchor=>Math.abs(anchor.time-cursor)<.001||Math.abs(anchor.time-quantize(cursor))<.001);if(existing>=0){change('Remove anchor',()=>a.anchors.splice(existing,1));return;}if(await dialog('Insert anchor',field(fretCaption(),'anchor-fret',shownFret(Math.min(24-(a.capo||0),Math.max(a.capo>0?0:1,lastFret))),'number',fretBounds(a.capo>0?0:1))+field('Width','anchor-width',4,'number','min="1" max="12"'))){change('Insert anchor',()=>{a.anchors.push({time:quantize(cursor),fret:readFret($('anchor-fret').value,false,a.capo>0?0:1),width:Number($('anchor-width').value)});a.anchors.sort((x,y)=>x.time-y.time);});}},
  phrase:async()=>{if(await dialog('Insert phrase',field('Phrase name','phrase-name',`Phrase ${arrangement().phrases.length+1}`)))change('Insert phrase',()=>{arrangement().phrases.push({id:uid(),name:$('phrase-name').value,time:quantize(cursor)});arrangement().phrases.sort((x,y)=>x.time-y.time);});},
  'phrase-remove':()=>change('Remove phrase',()=>{const phrase=arrangement().phrases.findLast(p=>p.time<=cursor);if(phrase)arrangement().phrases=arrangement().phrases.filter(p=>p!==phrase);}),
  section:async()=>{if(await dialog('Insert section',`<label>Section<select id="ws-section-name">${SECTIONS.map(s=>`<option>${s}</option>`).join('')}</select></label>`))change('Insert section',p=>{p.sections.push({name:$('section-name').value,number:1,start_time:quantize(cursor)});p.sections.sort((x,y)=>x.start_time-y.start_time);});},
  chord:async()=>{const existing=arrangement().chords.find(c=>(c.notes||[]).some(n=>selection.has(n.id)));if(existing){await editChord(existing.chord_id);return;}const match=matchingChordTemplate(arrangement(),selected()),matchingName=match>=0?arrangement().chord_templates[match].name:null,suggestions=[...new Set([...(matchingName?[matchingName]:[]),...suggestChordNames(arrangement(),selected())])];if(await dialog('Create chord',field('Chord name','chord-name',suggestions[0]||'Chord','text','list="ws-chord-suggestions"')+`<datalist id="ws-chord-suggestions">${suggestions.map(name=>`<option value="${esc(name)}"></option>`).join('')}</datalist>`+(suggestions.length?`<p class="ws-muted">Suggested names: ${suggestions.map(esc).join(', ')}. Edit the name to match your musical context.</p>`:'')))change('Create chord',()=>{chordFromSelection(arrangement(),selected(),$('chord-name').value,{reuseTemplate:match>=0&&$('chord-name').value===matchingName});applyDefaultChordName(arrangement(),arrangement().handshapes.length-1);});},
  'chord-library':()=>{inspector='chords';renderInspector();},
  'chord-zone':()=>insertChord(Math.min(selectedChordTemplate,arrangement().chord_templates.length-1)),
  'chord-fingerprint':()=>insertChord(Math.min(selectedChordTemplate,arrangement().chord_templates.length-1),{fingerprintOnly:true}),
  'chord-zone-cycle':()=>{const index=activeZoneIndex(),style=chordZoneStyle(arrangement(),index),kinds=['chord','fingerprint','arpeggio'];change('Cycle chord-zone presentation',()=>setChordZoneStyle(arrangement(),index,{...style,kind:kinds[(kinds.indexOf(style.kind)+1)%kinds.length]}));},
  'chord-zone-hide':()=>{const index=activeZoneIndex(),style=chordZoneStyle(arrangement(),index);if(style.kind==='fingerprint')throw Error('Fingerprint presentation already omits the chord name');change('Toggle zone chord name',()=>setChordZoneStyle(arrangement(),index,{...style,hideName:!style.hideName}));},
  strum:()=>change('Toggle chord strum',()=>{const result=toggleChordStrum(arrangement(),project().beats,quantize(cursor));selection=new Set(result.notes.map(n=>n.id));}),
  'chord-split':async()=>{const indexes=arrangement().chords.flatMap((c,i)=>(c.notes||[]).some(n=>selection.has(n.id))?[i]:[]);if(!indexes.length)throw Error('Select notes belonging to chords to split');if(await dialog('Split selected chords','<p class="ws-muted">Convert complete selected chord instances to independent notes. Member techniques, fingerings and sustains are retained.</p><label>Hand-shape zones<select id="ws-split-zones"><option value="keep">Keep hand-shape zones</option><option value="remove-unused">Remove zones with no remaining strums</option></select></label>'))change('Split selected chords',()=>{const notes=splitChordInstances(arrangement(),indexes,{handshapes:$('split-zones').value});selection=new Set(notes.map(n=>n.id));});},
  tone:async()=>{const names=Object.keys(arrangement().tones.definitions||{});if(!names.length)throw Error('Create a tone definition first');if(await dialog('Allocate tone',`<label>Tone<select id="ws-tone-name">${names.map(n=>`<option ${n===selectedTone?'selected':''}>${esc(n)}</option>`).join('')}</select></label>`))change('Allocate tone',()=>allocateTone(arrangement(),quantize(cursor),$('tone-name').value));},
  'tone-definition':async()=>{if(await dialog('Create tone definition',field('Name','tone-new-name','New tone')))change('Create tone definition',()=>{const name=$('tone-new-name').value.trim();if(Object.hasOwn(arrangement().tones.definitions,name))throw Error('Tone name already exists');arrangement().tones.definitions[name]=createTone(name);selectedTone=name;});},
  'tone-copy':async()=>{if(await dialog('Clone tone',field('Name','tone-copy-name',`${selectedTone} copy`)))change('Clone tone',()=>{const name=$('tone-copy-name').value;if(Object.hasOwn(arrangement().tones.definitions,name))throw Error('Tone name already exists');arrangement().tones.definitions[name]=copyTone(arrangement().tones.definitions[selectedTone],name);selectedTone=name;});},
  'tone-import':()=>$('tone-file').click(),
  'tone-export':()=>{const data=exportTone(arrangement().tones.definitions[selectedTone]),blob=new Blob([data],{type:'application/json'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${selectedTone}.tone.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);},
  'tone-delete':()=>change('Delete tone',()=>removeTone(arrangement(),selectedTone)),
  'assign-hands':async()=>{if(arrangement().type!=='keys')throw Error('Select a piano-roll arrangement first');if(await dialog('Assign piano hands','<label>Apply to<select id="ws-hands-scope"><option value="all">Current difficulty, all notes</option><option value="selected">Selected notes</option></select></label><label>Assignment<select id="ws-hands-mode"><option value="split">Split by MIDI pitch</option><option value="lh">Left hand</option><option value="rh">Right hand</option><option value="clear">Unassigned</option></select></label>'+field('Right hand starts at MIDI pitch','hands-split',60,'number','min="0" max="127" step="1"')+'<p class="ws-muted">Notes below the split go to the left hand. This is your authoring choice; review crossings and musical intent.</p>'))change('Assign piano hands',()=>assignHands(arrangement(),{ids:$('hands-scope').value==='selected'?selection:null,mode:$('hands-mode').value,split:Number($('hands-split').value)}));},
  'manage-parts':managePartsDialog,
  'arr-clone':()=>changeScope('Clone arrangement',p=>{arrangementId=manageArrangement(p,arrangementId,'duplicate',{newName:arrangement().name+' copy'});selection.clear();selectionRange=null;markerSelection=null;}),
  'arr-lock':()=>{const a=arrangement(),locking=!a.locked;changeScope(locking?'Lock arrangement':'Unlock arrangement',p=>manageArrangement(p,a.id,locking?'lock':'unlock'));status(`${a.name} ${locking?'locked: its chart cannot be changed until you unlock it':'unlocked'}`);},
  'arr-hide':()=>{const a=arrangement(),hiding=!a.hidden;changeScope(hiding?'Hide arrangement':'Unhide arrangement',p=>manageArrangement(p,a.id,hiding?'hide':'unhide'));status(`${a.name} ${hiding?'hidden: kept in the project, left out of builds and playtests':'is visible again'}`);},
  'arr-delete':async()=>{const a=arrangement();if(a.locked)throw Error(`${a.name} is locked; unlock it before deleting it`);if(await dialog('Delete arrangement',`<p>Delete <b>${esc(a.name)}</b>${project().arrangements.some(x=>x.editorOnly&&x.scratchFor===a.id)?' and its scratch track':''}? Undo brings it back.</p>`,'Delete'))changeScope('Delete arrangement',p=>{arrangementId=manageArrangement(p,a.id,'remove');selection.clear();selectionRange=null;markerSelection=null;fitPianoRange();});},
  'arr-combine':combineDialog,
  'combine-clear':()=>change('Clear overlap highlights',p=>{delete p.arrangements.find(x=>x.id===arrangementId).combineReview;}),
  'drum-lanes':drumLanesDialog,
  'tempo-shift':tempoShiftDialog,
  'tempo-restore-score':restoreScoreTempoMap,
  'rotate-roll':()=>setRollOrientation(bottomRoll()?'left':'bottom'),
  track:async()=>{const pending=dialog('New arrangement',field('Name','new-arr-name','New part')+'<label>Authoring family<select id="ws-new-arr-family"><option value="guitar">Fretted guitar family</option><option value="bass">Fretted bass family</option><option value="keys">Piano roll / pitched</option><option value="drums">Drums</option></select></label>'+field('Instrument label','new-arr-instrument','','text','maxlength="64" list="ws-instrument-names" placeholder="e.g. guitar, ukulele, violin, flute, piano"')+'<label>Strings<select id="ws-new-arr-count">'+[4,5,6,7,8].map(n=>`<option ${n===6?'selected':''}>${n}</option>`).join('')+'</select></label><p class="ws-muted">The family selects chart layout. The instrument label names the part; it does not select a sound model. Piano roll supports MIDI 0 through 127 and has no strings. For a pitched part, an instrument such as flute, violin, viola or alto sax gives the stave the clef and written transposition of that instrument. Fretted layouts support 4 through 8 strings.</p>');on($('new-arr-family'),'change',e=>{const fretted=['guitar','bass'].includes(e.target.value);$('new-arr-count').disabled=!fretted;$('new-arr-count').closest('label').style.display=fretted?'':'none';$('new-arr-count').value=e.target.value==='bass'?'4':'6';});if(await pending){const family=$('new-arr-family').value,instrument=$('new-arr-instrument').value.trim()||family,count=['guitar','bass'].includes(family)?Number($('new-arr-count').value):null;changeScope('Add arrangement',p=>{const a=makeArrangement(family,count,{instrument});a.name=$('new-arr-name').value;p.arrangements.push(a);arrangementId=a.id;selection.clear();});}},
  'transpose-up':()=>change('Transpose up',()=>transposeSelection(arrangement(),selection,1)),
  'transpose-down':()=>change('Transpose down',()=>transposeSelection(arrangement(),selection,-1)),
  'string-up':()=>change('Move up one string',()=>moveStrings(arrangement(),selection,1)),
  'string-down':()=>change('Move down one string',()=>moveStrings(arrangement(),selection,-1)),
  'position-up':()=>change('Move up one string keeping pitch',()=>moveStrings(arrangement(),selection,1,{preservePitch:true})),
  'position-down':()=>change('Move down one string keeping pitch',()=>moveStrings(arrangement(),selection,-1,{preservePitch:true})),
  'snap-options':async()=>{
   const ready=onsetReady(),pending=dialog('Snap configuration',`<label>Snap target<select id="ws-snap-mode"><option value="grid" ${snapOptions.mode==='grid'?'selected':''}>Beat grid</option><option value="onsets" ${snapOptions.mode==='onsets'?'selected':''} ${ready?'':'disabled'}>Detected audio onsets${ready?'':' / analyze audio first'}</option></select></label>${field('Swing ratio (%)','snap-swing',snapOptions.swing*100,'number','min="50" max="90" step="any"')}<p class="ws-muted">50% is straight. Swing delays odd subdivisions within each pair; triplet grids stay straight. Onset mode uses the nearest detected audio spike, with no maximum distance. Snap Off disables either mode. Beat markers and source audio stay unchanged.</p><button type="button" id="ws-snap-analyze">Analyze current audio onsets</button><p id="ws-snap-analysis">${ready?onsets.length+' detected onsets available':'Import audio, then analyze before choosing onset snap.'}</p>`);
   on($('snap-analyze'),'click',safe(async()=>{if(!audio.buffer)throw Error('Import audio before detecting onsets');const buffer=audio.buffer;status('Analyzing audio onsets for snap...');await new Promise(r=>setTimeout(r,20));if(buffer!==audio.buffer)return;onsets=detectOnsets(buffer);onsetSourceGeneration=audio.decodeGeneration;const option=$('snap-mode')?.querySelector('[value="onsets"]');if(option){option.disabled=!onsets.length;option.textContent=onsets.length?'Detected audio onsets':'No reliable onsets detected';}$('snap-analysis').textContent=`${onsets.length} detected onsets; audio and beat map unchanged`;draw();}));
   if(!await pending)return;
   const next={mode:$('snap-mode').value,swing:Number($('snap-swing').value)/100};createQuantizer(project().beats,{division:snap||4,...next});snapOptions=next;draw();status(`Snap: ${snapOptions.mode==='grid'?'beat grid / '+Math.round(snapOptions.swing*100)+'% swing':onsetReady()?'detected audio onsets':'onsets unavailable / snapping disabled until analysis'}`);
  },
  resnap:()=>{if(!snap)throw Error('Enable a snap division before resnapping');if(!snapper().available)throw Error('Analyze current audio onsets in Snap configuration before resnapping');let result;change('Resnap selection',()=>{result=resnapSelection(arrangement(),selection,snapper());});status(`Resnapped ${result.notes} notes (${result.chords} whole chords); tails and bend offsets retained`);},
  'shift-left':()=>shiftNotes(-1/(snap||4)),'shift-right':()=>shiftNotes(1/(snap||4)),
  tap:()=>{const now=performance.now();tapTimes=tapTimes.filter(x=>now-x<4000);tapTimes.push(now);if(tapTimes.length>=3){const bpm=60000*(tapTimes.length-1)/(tapTimes.at(-1)-tapTimes[0]);change('Tap tempo',p=>setTempo(p,bpm,{moveNotes:$('move-notes').checked}));status(`Tapped ${bpm.toFixed(2)} BPM`);}else status('Keep tapping to establish tempo…');},
  'tempo-import':()=>$('tempo-file').click(),
  'tempo-detect':async()=>{if(!audio.buffer)throw Error('Import audio before detecting tempo');if(await dialog('Suggest beat map',field('Minimum BPM','tempo-min',60,'number','min="10" max="300"')+field('Maximum BPM','tempo-max',200,'number','min="20" max="500"')+'<p class="ws-muted">The estimated map is a suggestion. Inspect its green markers against the recording before accepting.</p>','Analyze')){status('Analyzing audio transients…');await new Promise(r=>setTimeout(r,20));gridSuggestion=suggestTempo(audio.buffer,{minBpm:Number($('tempo-min').value),maxBpm:Number($('tempo-max').value)});onsets=gridSuggestion.onsets;onsetSourceGeneration=audio.decodeGeneration;view='tempo';if(!Number.isFinite(gridSuggestion.bpm)||!onsets.length){gridSuggestion=null;render();status('No reliable transients or tempo found. Set BPM or align markers manually.');return;}render();status(`Suggested ${gridSuggestion.bpm.toFixed(2)} BPM, offset ${gridSuggestion.offset.toFixed(3)} s · review then Tempo → Accept suggested map`);}},
  'tempo-align':()=>{if(!audio.buffer)throw Error('Import audio first');if(!onsetReady())onsets=detectOnsets(audio.buffer);onsetSourceGeneration=audio.decodeGeneration;change('Align beats to transients',p=>applyGrid(p,alignBeats(p.beats,onsets),$('move-notes').checked));view='tempo';render();},
  'tempo-accept':()=>{if(!gridSuggestion)throw Error('Detect tempo first');change('Accept suggested beat map',p=>applyGrid(p,gridSuggestion.beats,$('move-notes').checked));gridSuggestion=null;render();},
  'tempo-ramp':async()=>{const start=Math.max(0,Math.floor(beatAt(project().beats,cursor))),end=Math.min(start+16,project().beats.length-1);if(await dialog('Tempo ramp',field('Start beat index','tempo-ramp-start',start,'number')+field('End beat index','tempo-ramp-end',end,'number')+field('Start BPM','tempo-ramp-from',$('bpm-display').textContent,'number')+field('End BPM','tempo-ramp-to',140,'number')))change('Tempo ramp',p=>applyGrid(p,rampGrid(p.beats,Number($('tempo-ramp-start').value),Number($('tempo-ramp-end').value),Number($('tempo-ramp-from').value),Number($('tempo-ramp-to').value)),$('move-notes').checked));},
  meter:async()=>{if(await dialog('Time signature',field('Numerator','meter-num',4,'number','min="1" max="32"')+`<label>Denominator<select id="ws-meter-den"><option>2</option><option selected>4</option><option>8</option><option>16</option></select></label><p class="ws-muted">Applies from the beat at the cursor. Existing recording times stay fixed.</p>`))change('Time signature',p=>p.beats=setMeter(p.beats,Number($('meter-num').value),Number($('meter-den').value),Math.max(0,Math.floor(beatAt(p.beats,cursor)))));},
  'beat-add':()=>change('Add beat marker',p=>applyGrid(p,addBeat(p.beats,cursor),false)),
  'beat-remove':()=>change('Remove beat marker',p=>applyGrid(p,removeBeat(p.beats,Math.max(0,Math.round(beatAt(p.beats,cursor)))),false)),
  'tempo-fit':()=>{if(audio.audioDuration<=0)throw Error('Import audio first');change('Fit beat map',p=>{const next=p.beats.map((b,i)=>({...b,time:i*audio.audioDuration/(p.beats.length-1)}));applyGrid(p,next,$('move-notes').checked);});},
  'tempo-reset':async()=>{if(await dialog('Constant BPM',field('BPM','tempo-bpm',$('bpm-display').textContent,'number','min="10" max="500" step="0.01"')+'<p class="ws-muted">Align mode keeps notes at their recording times. Enable “Move notes with beats” to preserve their musical positions.</p>'))change('Set constant tempo',p=>setTempo(p,Number($('tempo-bpm').value),{moveNotes:$('move-notes').checked}));},
  help:()=>dialog('Editor keyboard and workflow',keyboardHelp()+'<dl class="ws-help"><dt>Timeline</dt><dd>Click to place cursor. Double-click to enter a note. Ctrl+wheel zooms around the pointer; Shift+wheel pans time; Alt+wheel changes lane height. Tab and Tempo retain separate zoom. Shift-click adds to selection. Drag selected notes to move; drag empty space to select.</dd><dt>Fret entry</dt><dd>Numbers use the selected fret-display convention. In physical mode, frets below the capo are unavailable. 0–9: frets 0–9. Numpad: 10–19. Ctrl+numpad: 20–24. Arrow keys: move cursor/string. Delete: remove selection.</dd><dt>Structure</dt><dd>A: anchor. F: chord. N: chord strum. Ctrl+P: phrase. Alt+S: section.</dd><dt>Techniques</dt><dd>Shift+S: slide to the next note on the string, then unpitched slide, then no slide. P: palm mute. M: fret-hand mute. H: hammer/pull. R: harmonic. U: tap. C: accent. O: vibrato. B: bend. S: toggle sustain. [ / ]: shorten / lengthen. G: toggle sustain gutter; Edit &gt; Sustain editing configures collision and gutter preferences.</dd><dt>Editing</dt><dd>Ctrl+Z/Y: undo/redo. Ctrl+C/X/V: copy/cut/merge paste. Ctrl+S: save the current target format. Use Save As &gt; Editable JSON to keep the complete authoring project. Space: play/pause.</dd><dt>Beat map</dt><dd>Switch to Tempo and drag beat triangles to the waveform. Use tap tempo or import a beat map. Choose whether notes follow the edit.</dd><dt>Piano and MIDI</dt><dd>Properties edits MIDI pitch (0 through 127), velocity (0 through 127) and hand assignment. Velocity 0 is silent in the editor guide. Choose a MIDI device explicitly in Playback, then Record MIDI; the sustain pedal extends released piano notes. Local count-in can start playback or recording after the chosen number of beats or bars.</dd><dt>Chord voicings</dt><dd>Open Chords / chord library, then Edit. The live diagram shows low strings on the left, unused strings as crosses and open strings as circles. T means thumb (finger 0); -1 means unset. It follows the selected capo-relative or physical fret display. Apply commits the voicing; Cancel keeps the chart unchanged.</dd><dt>Anchor coverage</dt><dd>Chords &gt; Repair anchor coverage previews missing or uncovered hand positions in the current difficulty. Choose the allowed width and phrase-start policy. Conflicting simultaneous frets block the repair; other difficulties and musical notes stay unchanged.</dd><dt>Drum charts</dt><dd>Properties edits the kit piece, velocity and hit details. The editor guide includes the canonical pieces and a generic cue for custom IDs. Native playtest checks that the active drum kit has lanes for the visible hits; kit settings are changed only by you.</dd><dt>Layout</dt><dd>View &gt; Show arrangements together stacks several parts on one timeline; click inside a part to edit it. Ctrl+J shows or hides the lower panel. The chord strip under the strings shows a diagram for each hand shape or chord, shading the fret-hand position (anchor): click Chords ▾ to fold it, ⟳ to switch between tab-style and upright boxes, ⇡ / ⇣ to move it above or below the strings.</dd><dt>Builds</dt><dd>Save As chooses FeedBack, a DLC Builder project, arrangement XML or editable JSON. Extended charts remain intact for FeedBack. Rocksmith 2014 stock limits are validated before export.</dd></dl>','Close'),
  coverage:async()=>{const response=await fetch(`${API}/coverage`);if(response.ok){const d=await response.json();await dialog('Feature coverage',`<pre style="white-space:pre-wrap">${esc(JSON.stringify(d,null,2))}</pre>`,'Close');}else await dialog('Feature coverage','<p>This local development build is in progress. Workflow parity, native tones, dynamic difficulty, audio encoding and game verification remain explicit acceptance gates.</p>','Close');}
 };
 for(const name of chartOnlyActions){const run=actions[name];if(typeof run==='function')actions[name]=(...args)=>{if(!chartCommandAllowed(name)){status(chartEditing()?'This command requires a guitar or bass arrangement':'Open Tab or Tempo to edit the chart');return;}return run(...args);};}
 async function fitAnchorCoverage(){
  const a=arrangement();if(!['guitar','bass'].includes(a.type))throw Error('Anchor coverage requires guitar or bass');
  const accepted=await dialog('Repair anchor coverage',field('Minimum new width (frets)','anchor-fit-min',4,'number','min="1" max="24" step="1" required')+field('Maximum new width (frets)','anchor-fit-max',4,'number','min="1" max="24" step="1" required')+`<label><input id="ws-anchor-fit-phrases" type="checkbox" checked>Add missing phrase-start anchors</label><p class="ws-muted">Current visible difficulty only. Keep authored positions that already cover the sounding frets. Repair uncovered attacks with a position beginning at their lowest positive fret; open strings do not choose a position. Review every proposed type of change before applying. This is an original coverage aid; check the musical fingering yourself.</p>`,'Preview coverage');
  if(!accepted)return;
  const plan=planAnchorCoverage(a,{duration:project().duration,minWidth:Number($('anchor-fit-min').value),maxWidth:Number($('anchor-fit-max').value),phraseStarts:$('anchor-fit-phrases').checked});
  // Both proposal lists are emitted chronologically. Merge only the visible
  // prefix instead of allocating formatted rows for a200k-anchor preview.
  const rows=[],count=plan.changes.length+plan.additions.length;let changedIndex=0,addedIndex=0;
  while(rows.length<Math.min(100,count)){const changed=plan.changes[changedIndex],added=plan.additions[addedIndex];if(changed&&(!added||changed.after.time<=added.time)){rows.push({time:changed.after.time,before:`${shownFret(changed.before.fret)} / ${changed.before.width??4}`,after:`${shownFret(changed.after.fret)} / ${changed.after.width}`,reason:changed.reason});changedIndex++;}else{rows.push({time:added.time,before:'New',after:`${shownFret(added.fret)} / ${added.width}`,reason:added.reason});addedIndex++;}}
  const html=`<p>${plan.counts.added} anchors will be added; ${plan.counts.changed} existing anchors will change. ${plan.counts.alreadyCoveredAttackGroups} attack groups already fit. Other difficulty levels stay unchanged.</p>${plan.warnings.map(row=>`<p class="ws-warning">${row.count}: ${esc(row.message)}</p>`).join('')}${plan.conflicts.length?`<p class="ws-warning">${plan.conflicts.length} conflicts block this whole repair. Resolve the voices or choose an adequate maximum width, then preview again.</p><ul>${plan.conflicts.slice(0,100).map(row=>`<li>${seconds(row.time)}: ${esc(row.message)}</li>`).join('')}</ul>`:''}<table class="ws-errors"><thead><tr><th>Time</th><th>Old fret / width</th><th>New fret / width</th><th>Reason</th></tr></thead><tbody>${rows.slice(0,100).map(row=>`<tr><td>${seconds(row.time)}</td><td>${esc(row.before)}</td><td>${esc(row.after)}</td><td>${esc(row.reason)}</td></tr>`).join('')}</tbody></table>${count>100?`<p class="ws-muted">Showing the first100 of ${count} proposals. All proposals follow the chosen coverage policy.</p>`:''}<p class="ws-muted">Notes, chord children, finger prescriptions, sustains and source metadata stay unchanged. Displayed frets follow the current fret convention.</p>`;
  if(!plan.canApply||!count){await dialog('Anchor coverage preview',html,'Close');return;}
  if(!await dialog('Anchor coverage preview',html,`Apply ${count} anchors`))return;
  change('Repair anchor coverage',p=>{const fitted=applyAnchorCoverage(arrangement(),plan,{duration:p.duration});arrangement().anchors=fitted.anchors;});status(`Repaired anchor coverage: ${plan.counts.added} added, ${plan.counts.changed} changed`);
 }
 async function fitZoneEnds(){
  const a=arrangement(),hasZone=selectedZoneIndex!==null&&!!a.handshapes[selectedZoneIndex];
  if(!a.handshapes.length)throw Error('Create a hand-shape zone before fitting ends');
  const accepted=await dialog('Fit zone ends',`<label>Scope<select id="ws-zone-fit-scope"><option value="all">Current difficulty, all zones</option><option value="region" ${selectionRange?'':'disabled'}>Zones starting in the selected time region</option><option value="zone" ${hasZone?'':'disabled'}>Selected zone</option></select></label><label>Mode<select id="ws-zone-fit-mode"><option value="both">Chord and fingerprint zones</option><option value="chord">Chord zones, including arpeggios</option><option value="fingerprint">Fingerprint zones</option></select></label><label>Boundary policy<select id="ws-zone-fit-boundary"><option value="both">Phrase and containing hand-shape boundaries</option><option value="phrase">Phrase boundaries</option><option value="handshape">Containing hand-shape boundaries</option></select></label>${field('Gutter (beat intervals)','zone-fit-gutter',chordZoneOptions.gutterBeats||0,'number','min="0" max="10000" step="0.03125"')}<label>Conflicts<select id="ws-zone-fit-conflicts"><option value="skip">Keep and report conflicting zones</option><option value="reject">Reject the whole batch</option></select></label><p class="ws-muted">Original fitting policy: extend or shorten to the next matching zone, chosen boundary or song end, then subtract the gutter using the beat map. Existing musical tails, bend points and contained zones are protected. Every change is previewed before applying.</p>`,'Preview ends');
  if(!accepted)return;
  const scope=$('zone-fit-scope').value,options={beats:project().beats,duration:project().duration,mode:$('zone-fit-mode').value,boundary:$('zone-fit-boundary').value,gutterBeats:Number($('zone-fit-gutter').value),conflicts:$('zone-fit-conflicts').value};
  if(scope==='zone'){if(!hasZone)throw Error('Select a zone first');options.zoneIndices=[selectedZoneIndex];}else options.range=scope==='region'?selectionRange:{start:0,end:project().duration};
  const plan=planZoneFit(a,options),rows=[...plan.changes.map(row=>({...row,result:'Fit'})),...plan.skipped.map(row=>({...row,result:row.reason}))],preview=`<p>${plan.counts.changed} endpoints will change, ${plan.counts.skipped} conflicts stay unchanged, ${plan.counts.unchanged} endpoints already fit.</p><table class="ws-errors"><thead><tr><th>Zone</th><th>Old end</th><th>New end</th><th>Result</th></tr></thead><tbody>${rows.slice(0,100).map(row=>`<tr><td>${row.index+1}</td><td>${row.oldEnd.toFixed(4)}</td><td>${row.newEnd.toFixed(4)}</td><td>${esc(row.result)}</td></tr>`).join('')}</tbody></table>${rows.length>100?`<p class="ws-muted">Showing the first100 of ${rows.length} proposals.</p>`:''}<p class="ws-muted">Notes, strums, curves, templates and other difficulty levels remain unchanged.</p>`;
  if(!plan.changes.length){await dialog('Zone end preview',preview,'Close');return;}
  if(!await dialog('Zone end preview',preview,`Apply ${plan.counts.changed} ends`))return;
  change('Fit zone ends',p=>applyZoneFit(arrangement(),plan,{beats:p.beats,duration:p.duration}));status(`Fitted ${plan.counts.changed} zone ends; kept ${plan.counts.skipped} conflicting zones`);
 }
 function activeZoneIndex(){const zones=arrangement().handshapes;if(selectedZoneIndex!==null&&zones[selectedZoneIndex])return selectedZoneIndex;const candidates=zones.map((h,i)=>({h,i})).filter(({h})=>cursor>=h.start_time&&cursor<h.end_time).sort((a,b)=>(a.h.end_time-a.h.start_time)-(b.h.end_time-b.h.start_time));if(!candidates.length)throw Error('Choose a hand-shape zone in the chord inspector or timeline');return candidates[0].i;}
 function insertChord(index,options={}){selectedChordTemplate=index;change('Insert chord zone',()=>{const result=insertChordZone(arrangement(),project().beats,index,quantize(cursor),{...chordZoneOptions,...options});selection=new Set(result.notes.map(n=>n.id));selectedZoneIndex=arrangement().handshapes.indexOf(result.zone);});}
 on(root,'dragstart',safe(e=>{const tile=e.target.closest('[data-chord]');if(!tile||!e.dataTransfer)return;chordDrag={token:uid(),generation:projectGeneration,arrangementId,index:Number(tile.dataset.chord)};suppressChordClickUntil=performance.now()+500;e.dataTransfer.setData('application/x-oce-chord',chordDrag.token);e.dataTransfer.effectAllowed='copy';}));
 on(root,'dragend',()=>{chordDrag=null;suppressChordClickUntil=performance.now()+250;});
 on(canvas,'dragover',e=>{if(chordDrag&&e.dataTransfer?.types.includes('application/x-oce-chord')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
 on(canvas,'drop',safe(e=>{
  if(!chordDrag||e.dataTransfer?.getData('application/x-oce-chord')!==chordDrag.token)return;
  e.preventDefault();const source=chordDrag;chordDrag=null;suppressChordClickUntil=performance.now()+250;
  if(source.generation!==projectGeneration||source.arrangementId!==arrangementId)throw Error('Drag a chord from the current project and arrangement');
  const {x,y}=pointerPoint(e),g=geometry(),handshapeY=g.top+g.lanes.length*g.row+8;
  if(view!=='tab'||x<g.left||y<g.top)throw Error('Drop the chord on the string grid or hand-shape lane');
  const kind=y<handshapeY?'chord':y<handshapeY+20?'fingerprint':'arpeggio',time=quantize(timeOf(x));
  change('Drag chord from library',p=>{const result=insertChordZone(arrangement(),p.beats,source.index,time,{...chordZoneOptions,fingerprintOnly:kind!=='chord'});selectedZoneIndex=arrangement().handshapes.indexOf(result.zone);if(kind==='arpeggio')setChordZoneStyle(arrangement(),selectedZoneIndex,{kind:'arpeggio',hideName:false});selection=new Set(result.notes.map(n=>n.id));selectedChordTemplate=source.index;cursor=time;p.duration=Math.max(p.duration,result.zone.end_time);});
 }));
 on(root,'click',safe(async e=>{
  const mixerMute=e.target.closest('[data-mixer-mute]');if(mixerMute){audio.setMute(mixerMute.dataset.mixerMute);renderBottom();return;}
  const mixerSolo=e.target.closest('[data-mixer-solo]');if(mixerSolo){audio.setSolo(mixerSolo.dataset.mixerSolo);renderBottom();return;}
  const button=e.target.closest('[data-action]');if(button){root.querySelectorAll('details[open]').forEach(d=>d.open=false);await actions[button.dataset.action]?.();return;}
  const tab=e.target.closest('[data-inspector]');if(tab){inspector=tab.dataset.inspector;renderInspector();}
  const chord=e.target.closest('[data-chord]');if(chord&&e.detail<2&&performance.now()>=suppressChordClickUntil)insertChord(Number(chord.dataset.chord));
  const zoneResize=e.target.closest('[data-zone-resize]');if(zoneResize){selectedZoneIndex=Number(zoneResize.dataset.zoneResize);change('Resize hand-shape zone',()=>resizeChordZone(arrangement(),project().beats,selectedZoneIndex,chordZoneOptions));}
  const zoneGo=e.target.closest('[data-zone-go]');if(zoneGo){selectedZoneIndex=Number(zoneGo.dataset.zoneGo);setCursor(arrangement().handshapes[selectedZoneIndex].start_time);}
  const chordEdit=e.target.closest('[data-chord-edit]');if(chordEdit)await editChord(Number(chordEdit.dataset.chordEdit));
  const chordClone=e.target.closest('[data-chord-clone]');if(chordClone)change('Clone chord template',()=>{const c=clone(arrangement().chord_templates[Number(chordClone.dataset.chordClone)]);c.name+=' copy';arrangement().chord_templates.push(c);});
  const chordDelete=e.target.closest('[data-chord-delete]');if(chordDelete)change('Delete unused chord template',()=>{const index=Number(chordDelete.dataset.chordDelete);deleteChordTemplate(arrangement(),index);selectedChordTemplate=Math.min(selectedChordTemplate,arrangement().chord_templates.length-1);});
  const issue=e.target.closest('[data-issue-time]');if(issue){countIn.cancel();stopMidi();const finding=issueFinder.get(validationProfile).issues[Number(issue.dataset.issueIndex)];if(!finding)return;const target=issueTarget(project(),finding);if(target.view==='vocals'){view='vocals';vocalPage=Math.floor((target.vocalIndex||0)/100);setCursor(target.time);render();if(target.vocalId)vocalController?.setSelection([target.vocalId]);if(vocalController)vocalController.scroll.scrollLeft=Math.max(0,target.time*zoom-60);const input=[...root.querySelectorAll('[data-vocal-field]')].find(input=>input.dataset.vocalId===target.vocalId&&input.dataset.vocalField===target.vocalField);input?.focus();return;}arrangementId=target.arrangementId||arrangementId;const a=arrangement();if(Number.isInteger(target.difficulty)&&target.difficulty!==a.activeDifficulty)change('Inspect difficulty '+target.difficulty,()=>switchDifficulty(a,target.difficulty));selection=new Set(target.noteId?[target.noteId]:[]);markerSelection=target.marker||null;selectionRange=null;inspector='properties';view='tab';fitPianoRange();audio.setProject(project(),arrangement());setCursor(target.time);setTimeScroll(Math.max(0,target.time*zoom-100));render();if(a.type==='keys'&&target.noteId){const note=editableNotes().find(n=>n.id===target.noteId),g=geometry();if(note)setLaneScroll(Math.max(0,g.top+g.lanes.indexOf(notePitch(a,note))*g.row-axes().height/2));}}
  const overview=e.target.closest('[data-overview-time]');if(overview){setCursor(Number(overview.dataset.overviewTime));setTimeScroll(cursor*zoom);}
  const toneTime=e.target.closest('[data-tone-time]');if(toneTime)setCursor(Number(toneTime.dataset.toneTime));
  const base=e.target.closest('[data-tone-base]');if(base)change('Set base tone',()=>arrangement().tones.base=base.dataset.toneBase);
  const remove=e.target.closest('[data-tone-remove]');if(remove)change('Remove tone change',()=>arrangement().tones.changes.splice(Number(remove.dataset.toneRemove),1));
  const vocalPageButton=e.target.closest('[data-vocal-page]');if(vocalPageButton){vocalPage=Number(vocalPageButton.dataset.vocalPage);renderVocals();}
  const vocalAction=e.target.closest('[data-vocal-action]');if(vocalAction)vocalEdit(vocalAction.dataset.vocalAction);
  const vocalTime=e.target.closest('[data-vocal-time]');if(vocalTime){setCursor(Number(vocalTime.dataset.vocalTime));if(vocalTime.dataset.vocalReveal){vocalController?.setSelection([vocalTime.dataset.vocalReveal]);if(vocalController)vocalController.scroll.scrollLeft=Math.max(0,Number(vocalTime.dataset.vocalTime)*zoom-60);}}
  const vocalDelete=e.target.closest('[data-vocal-delete]');if(vocalDelete)change('Delete vocal syllable',p=>p.vocals=p.vocals.filter(v=>v.id!==vocalDelete.dataset.vocalDelete));
 }));
 async function editChord(index){
  const a=arrangement(),c=a.chord_templates[index];
  const html=`<p class="ws-muted">${fretCaption()}: open ${shownFret(0)}, -1 unused. Finger0 is thumb; -1 is unset.</p>`+field('Name','chord-edit-name',c.name)+field('Display name','chord-edit-display',c.displayName||c.name)+`<div class="ws-chord-edit-layout"><div id="ws-chord-diagram-preview" aria-live="polite"></div><table><tr><th>String</th><th>Fret (-1 unused)</th><th>Finger (-1 unset)</th></tr>${Array.from({length:a.stringCount},(_,string)=>`<tr><td>${string+1}</td><td><input id="ws-chord-fret-${string}" type="number" min="-1" max="${fretLimits(a.capo,fretConvention).max}" step="1" required value="${shownFret(c.frets?.[string]??-1)}" style="width:80px"></td><td><input id="ws-chord-finger-${string}" type="number" min="-1" max="4" step="1" required value="${c.fingers?.[string]??-1}" style="width:80px"></td></tr>`).join('')}</table></div><p class="ws-muted">Finger changes update voices with no assignment or the previous template finger. Other per-note assignments stay unchanged.</p>`;
  const accepted=dialog('Edit chord',html),read=()=>({name:$('chord-edit-name').value,displayName:$('chord-edit-display').value,frets:Array.from({length:a.stringCount},(_,string)=>parseFret($(`chord-fret-${string}`).value,{capo:a.capo||0,convention:fretConvention,allowUnused:true})),fingers:Array.from({length:a.stringCount},(_,string)=>{const text=$(`chord-finger-${string}`).value,value=Number(text);if(!text.trim()||!Number.isInteger(value)||value< -1||value>4)throw Error('Finger must be -1 (unset), 0 (thumb), or 1 through 4');return value;})});
  const preview=()=>{const output=$('chord-diagram-preview');if(!output)return;try{output.innerHTML=chordDiagram(read(),{stringCount:a.stringCount,capo:a.capo||0,convention:fretConvention});}catch(error){output.innerHTML=`<p class="ws-muted">${esc(error.message)}</p>`;}};
  preview();for(const input of $('dialog-content').querySelectorAll('input'))on(input,'input',preview);
  for(let string=0;string<a.stringCount;string++)for(const [column,kind]of ['fret','finger'].entries())on($(`chord-${kind}-${string}`),'keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const row=Math.max(0,Math.min(a.stringCount-1,string+(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0))),nextColumn=Math.max(0,Math.min(1,column+(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0))),input=$(`chord-${['fret','finger'][nextColumn]}-${row}`);input.focus();input.select();});
  if(await accepted){const update=read();change('Edit chord template',()=>updateChordTemplate(a,index,update));}
 }
 on(root,'change',safe(e=>{
  if(e.target.dataset.zoneKind!==undefined){selectedZoneIndex=Number(e.target.dataset.zoneKind);change('Set zone presentation',()=>setChordZoneStyle(arrangement(),selectedZoneIndex,{kind:e.target.value}));}
  if(e.target.dataset.zoneHide!==undefined){selectedZoneIndex=Number(e.target.dataset.zoneHide);change('Set zone chord name',()=>setChordZoneStyle(arrangement(),selectedZoneIndex,{hideName:e.target.checked}));}
  if(e.target.dataset.technique)toggleTechnique(e.target.dataset.technique);
  if(e.target.dataset.tuning!==undefined){const string=Number(e.target.dataset.tuning);try{change('Tune string',()=>setStringOffset(arrangement(),string,e.target.value));}catch(error){e.target.value=arrangement().tuning[string]??0;throw error;}}
  if(e.target.dataset.toneDefinition)change('Edit tone definition',()=>arrangement().tones.definitions[e.target.dataset.toneDefinition]=JSON.parse(e.target.value));
  if(e.target.dataset.gearSlot)change('Change tone gear',()=>setGear(arrangement().tones.definitions[selectedTone],e.target.dataset.gearSlot,e.target.value));
  if(e.target.dataset.knobKey){if(!e.target.value.trim())throw Error('Enter a gear control value');return changeToneField('Adjust gear control',tone=>setKnob(tone,e.target.dataset.knobSlot,e.target.dataset.knobKey,Number(e.target.value)));}
  if(e.target.dataset.vocalField){const key=e.target.dataset.vocalField,raw=e.target.value,value=Number(raw);if(key!=='text'&&!(key==='pitch'&&raw==='')&&(!raw.trim()||!Number.isFinite(value)||value<0||(key==='pitch'&&(!Number.isInteger(value)||value>127))))throw Error('Vocal timing must be finite and nonnegative; optional pitch must be an integer0-127');if(key!=='time')changeVocalField('Edit vocal syllable',e.target.dataset.vocalId,key,key==='text'?raw:key==='pitch'&&raw===''?undefined:value);else{pendingVocalSelection=[e.target.dataset.vocalId];change('Edit vocal syllable',p=>{const vocal=p.vocals.find(v=>v.id===e.target.dataset.vocalId);if(!vocal)throw Error('The vocal syllable no longer exists');vocal.time=value;p.vocals.sort((a,b)=>a.time-b.time);});}}
  updateTonePreview(true);
 }));
 on(root,'input',e=>{const target=e.target;if(target.dataset.pan){const bus=target.dataset.pan;audio.setPan(bus,Number(target.value)/100);root.querySelector(`[data-pan-value="${bus}"]`).textContent=Math.round(audio.pans[bus]*100);}if(target.dataset.songEq!==undefined){const i=Number(target.dataset.songEq),eq=[...audio.songFX.eq];eq[i]=Number(target.value);audio.setSongFX({eq});root.querySelector(`[data-eq-value="${i}"]`).textContent=eq[i]+' dB';root.querySelector('[data-song-fx-preset]').value='';}});
 on(root,'change',safe(e=>{const target=e.target;if(target.hasAttribute('data-song-fx-bypass'))audio.setSongFX({bypass:target.checked});if(target.hasAttribute('data-song-fx-channel'))audio.setSongFX({channel:target.value});if(target.hasAttribute('data-song-fx-preset')&&target.value){audio.setSongFX({preset:target.value});for(let i=0;i<5;i++){root.querySelector(`[data-song-eq="${i}"]`).value=audio.songFX.eq[i];root.querySelector(`[data-eq-value="${i}"]`).textContent=audio.songFX.eq[i]+' dB';}}}));
 on(root,'input',e=>{if(e.target.dataset.bus){const bus=e.target.dataset.bus;audio.setGain(bus,Number(e.target.value)/100);root.querySelector(`[data-mixer-value="${bus}"]`).textContent=`${Math.round(audio.gains[bus]*100)}%`;for(const output of root.querySelectorAll('[data-mixer-output]'))output.textContent=`${Math.round(audio.getOutputGain(output.dataset.mixerOutput)*100)}%`;if(bus==='master')$('master').value=audio.gains.master*100;}});
 on($('arrangement'),'change',e=>{const target=e.target.value;countIn.cancel();stopMidi();arrangementId=target;selectedZoneIndex=null;selection.clear();selectionRange=null;markerSelection=null;lane=arrangement().type==='keys'?60:0;fitPianoRange();audio.setProject(project(),arrangement());render();});
 on($('difficulty'),'change',safe(e=>{const target=Number(e.target.value);countIn.cancel();stopMidi();change('Switch difficulty',()=>{switchDifficulty(arrangement(),target);selection.clear();});}));
 on($('zoom'),'input',e=>setTimelineZoom(Number(e.target.value)));on($('snap'),'change',e=>{snap=Number(e.target.value);draw();});
 on($('speed'),'input',e=>{countIn.cancel();audio.setSpeed(Number(e.target.value)/100);$('speed-value').textContent=`${e.target.value}%`;});on($('pitch'),'change',safe(e=>audio.setPitch(Number(e.target.value))));on($('master'),'input',e=>{audio.setGain('master',Number(e.target.value)/100);if(bottom==='mixer')renderBottom();});
 on($('open-folder'),'change',safe(async e=>{const files=Array.from(e.target.files||[]);if(!files.length)return;const request=++openGeneration,owner=history,generation=projectGeneration,state=history.stateId;try{const file=await readFolderFiles(files,{signal:abort.signal});if(request!==openGeneration||history!==owner||projectGeneration!==generation||history.stateId!==state||abort.signal.aborted||!root.isConnected)return;await openFile(file,null,{request});if(request===openGeneration&&project()._gpaSync)await offerGpaBeatMap();}finally{e.target.value='';}}));
 on($('open-file'),'change',safe(async e=>{try{if(e.target.files[0])await openFile(e.target.files[0]);}finally{e.target.value='';}}));on($('import-file'),'change',safe(async e=>{try{if(e.target.files[0])await importChart(e.target.files[0]);}finally{e.target.value='';}}));on($('lyrics-file'),'change',safe(async e=>{const file=e.target.files[0];e.target.value='';if(file)await importLyrics(file);}));on($('audio-file'),'change',safe(e=>e.target.files[0]&&uploadAudio(e.target.files[0])));
 on($('tone-file'),'change',safe(async e=>{
  const file=e.target.files[0];if(!file)return;e.target.value='';const request=++toneImportGeneration,owner=history,state=history.stateId,generation=projectGeneration,part=arrangementId,openIntent=openGeneration;
  const current=()=>request===toneImportGeneration&&history===owner&&history.stateId===state&&projectGeneration===generation&&arrangementId===part&&openGeneration===openIntent&&!abort.signal.aborted&&root.isConnected;let accepting=false;
  try{const text=await file.text();if(!current())return;const tone=importTone(text);accepting=true;change('Import tone',()=>{if(Object.hasOwn(arrangement().tones.definitions,tone.name))throw Error('A tone with that name already exists');arrangement().tones.definitions[tone.name]=tone;selectedTone=tone.name;});}
  catch(error){if(accepting||current())throw error;}
 }));
 on($('tempo-file'),'change',safe(async e=>{
  const file=e.target.files[0];if(!file)return;e.target.value='';const request=++tempoImportGeneration,owner=history,state=history.stateId,generation=projectGeneration,part=arrangementId,openIntent=openGeneration;
  const current=()=>request===tempoImportGeneration&&history===owner&&history.stateId===state&&projectGeneration===generation&&arrangementId===part&&openGeneration===openIntent&&!abort.signal.aborted&&root.isConnected;let accepting=false;const moveNotes=$('move-notes').checked;
  try{let beats,gpa=false;
   if(/\.xml$/i.test(file.name)){const text=await file.text();if(!current())return;if(/<track[\s>]/.test(text)&&/<sync>/.test(text)){beats=gpaBeatsForProject(parseGpaSync(text).points);gpa=true;}}
   if(beats){}else if(/\.json$/i.test(file.name)){const data=JSON.parse(await file.text());if(!current())return;beats=Array.isArray(data)?data:data.beats;if(!Array.isArray(beats))throw Error('JSON needs a beats array');}
   else{const form=new FormData();form.append('file',file);const response=await fetch(`${API}/load`,{method:'POST',body:form});if(!current())return;if(!response.ok)throw Error(await response.text());const data=await response.json();if(!current())return;beats=data.project.beats;}
   if(!current())return;accepting=true;change(gpa?'Use GoPlayAlong beat map':'Import beat map',p=>applyGrid(p,beats,gpa||moveNotes));
  }catch(error){if(accepting||current())throw error;}
 }));
 function setTimelineZoom(value,anchorX=geometry().width/2){
  const left=geometry().left,anchor=Math.max(left,Math.min(geometry().width,anchorX)),time=(timeScroll()+anchor-left)/zoom;
  zoom=Math.round(Math.max(25,Math.min(400,value)));viewZoom[timelineView]=zoom;$('zoom').value=zoom;draw();setTimeScroll(time*zoom-anchor+left);persistPreferences();
 }
 on(canvas,'mousedown',e=>{if(e.button===1&&mouseModel==='eof')e.preventDefault();});
 scroll.addEventListener('wheel',e=>{
  if(!['tab','tempo'].includes(view)||root.querySelector('dialog[open]'))return;
  const rect=scroll.getBoundingClientRect(),factor=e.deltaMode===1?16:e.deltaMode===2?scroll.clientHeight:1,dx=e.deltaX*factor,dy=e.deltaY*factor;
  if(mouseModel==='eof'&&view==='tab'&&!e.altKey&&!e.shiftKey&&selected().length&&chartEditing()){
   // One step per notch; trackpads send many small deltas, so they add up first.
   e.preventDefault();wheelCarry+=dy;if(Math.abs(wheelCarry)<40)return;const direction=wheelCarry<0?1:-1;wheelCarry=0;
   safe(()=>{if(e.ctrlKey||e.metaKey){if(arrangement().type!=='drums')change(direction>0?'Fret up':'Fret down',()=>transposeSelection(arrangement(),selection,direction));}else stepSustains(direction);})();return;
  }
  if(e.ctrlKey||e.metaKey){e.preventDefault();setTimelineZoom(zoom*Math.exp(-Math.max(-200,Math.min(200,dy))*.003),pointerPoint(e).x);return;}
  if(e.altKey){
   e.preventDefault();const before=geometry(),localY=pointerPoint(e).y-laneScroll(),index=(laneScroll()+localY-before.top)/before.row,type=arrangement().type;
   laneScales[type]=Math.max(.5,Math.min(4,(laneScales[type]||1)*Math.exp(-Math.max(-200,Math.min(200,dy))*.003)));draw();
   if(index>=0)setLaneScroll(geometry().top+index*geometry().row-localY);persistPreferences();return;
  }
  if(bottomRoll()){e.preventDefault();if(e.shiftKey)setLaneScroll(laneScroll()+(Math.abs(dx)>Math.abs(dy)?dx:dy));else{setTimeScroll(timeScroll()-dy);setLaneScroll(laneScroll()+dx);}return;}
  // Bottom rolls: the wheel moves the notes the way the hand moves (down = toward the song start).
  // Piano/drum rolls retain ordinary vertical scrolling. Shift is an explicit
  // horizontal gesture in every view; fretted charts pan with a plain wheel.
  if(e.shiftKey||(['guitar','bass'].includes(arrangement().type)&&Math.abs(dy)>Math.abs(dx))){e.preventDefault();scroll.scrollLeft+=Math.abs(dx)>Math.abs(dy)?dx:dy;}
 },{passive:false,signal:abort.signal});
 on(scroll,'scroll',()=>{rememberScroll();draw();});on(canvas,'dblclick',safe(e=>{const {x,y}=pointerPoint(e);focusBandAt(y);const g=geometry();if(x>=g.left&&y>=g.top&&y<g.top+g.lanes.length*g.row){cursor=quantize(timeOf(x));lane=laneOf(y);insertNote();}}));
 on(canvas,'contextmenu',safe(e=>{
  if(mouseModel==='eof'&&!e.shiftKey&&view==='tab'){e.preventDefault();closeContextMenu?.();eofRightClick(e);return;}
  e.preventDefault();closeContextMenu?.();horizontalSelectionAnchor=null;verticalSelectionAnchor=null;
  focusBandAt(pointerPoint(e).y);
  const {x,y}=pointerPoint(e),g=geometry(),hit=editableNotes().findLast(n=>Math.abs(yOf(getNoteLane(n))-y)<Math.max(10,g.row/2)&&x>=xOf(n.time)-10&&x<=xOf(n.time)+Math.max(12,n.sustain*zoom));
  markerSelection=null;selectionRange=null;if(hit){if(!selection.has(hit.id))selection=new Set([hit.id]);cursor=hit.time;lane=getNoteLane(hit);inspector='properties';}else{selection.clear();if(x>=g.left){cursor=Math.max(0,Math.min(project().duration,quantize(timeOf(x))));if(y>=g.top)lane=laneOf(y);}}
  render();const hasNotes=selection.size>0,fretted=['guitar','bass'].includes(arrangement().type),items=[{label:'Select matching notes',action:'select-like',disabled:!hasNotes},{label:'Copy notes',action:'copy',disabled:!hasNotes},{label:'Paste',action:'paste',disabled:!clipboard?.kind},{label:'Delete selected notes',action:'delete',disabled:!hasNotes},{label:'Create chord',action:'chord',disabled:!fretted||selection.size<2},{label:'Transpose up',action:'transpose-up',disabled:!hasNotes||arrangement().type==='drums'},{label:'Transpose down',action:'transpose-down',disabled:!hasNotes||arrangement().type==='drums'},{label:'Insert anchor',action:'anchor',disabled:!fretted},{label:'Insert phrase',action:'phrase'},{label:'Insert section',action:'section'}];
  closeContextMenu=openContextMenu(root,{x:e.clientX,y:e.clientY,items,restoreFocus:canvas,onChoose:safe(async action=>{await actions[action]();canvas.focus({preventScroll:true});})});
 }));
 on($('tempo-button'),'contextmenu',safe(e=>{
  e.preventDefault();closeContextMenu?.();
  const button=$('tempo-button');
  closeContextMenu=openContextMenu(root,{x:e.clientX,y:e.clientY,items:[{label:'Import beat map from file',action:'tempo-import'}],restoreFocus:button,onChoose:safe(async action=>{await actions[action]();button.focus({preventScroll:true});})});
 }));
 on($('tab-button'),'contextmenu',safe(e=>{
  e.preventDefault();closeContextMenu?.();
  const button=$('tab-button');
  closeContextMenu=openContextMenu(root,{x:e.clientX,y:e.clientY,items:[{label:'Import tab',action:'import-chart'}],restoreFocus:button,onChoose:safe(async action=>{await actions[action]();button.focus({preventScroll:true});})});
 }));
 on($('vocals-button'),'contextmenu',safe(e=>{
  e.preventDefault();closeContextMenu?.();
  const button=$('vocals-button');
  closeContextMenu=openContextMenu(root,{x:e.clientX,y:e.clientY,items:[{label:'Import lyrics chart…',action:'import-lyrics'}],restoreFocus:button,onChoose:safe(async action=>{await actions[action]();button.focus({preventScroll:true});})});
 }));
 on(canvas,'pointerdown',safe(e=>{
  if(e.button===1&&mouseModel==='eof'&&view==='tab'){e.preventDefault();eofMiddleClick(e);return;}
  if(e.button!==0)return;horizontalSelectionAnchor=null;verticalSelectionAnchor=null;canvas.focus({preventScroll:true});focusBandAt(pointerPoint(e).y);const {x,y}=pointerPoint(e),g=geometry();
  if(g.chordStrip&&y>=g.chordStrip.top&&y<g.chordStrip.top+g.chordStrip.height){if(x<g.left){if(y<g.chordStrip.top+16)actions[x<60?'chord-strip':x<84?'chord-strip-rotate':'chord-strip-move']();}else selectChordStripAt(timeOf(x));return;}
  if(x<g.left){if((bottomRoll()||arrangement().type==='keys')&&y>=g.top){lane=keyboardLaneAt(x,y);draw();}else if(view==='tab'&&markerKindAt(y))awaitLaneAction(y);return;}
  const time=quantize(timeOf(x));
  // Scrub: drag the playhead marker, or anywhere on the Tab view's waveform strip, to move smoothly
  // through the song. The beat-number row above draws a loop; Tempo's waveform slides the audio.
  if(x>=g.left&&(y<45&&Math.abs(x-xOf(audio.isPlaying?audio.currentTime:cursor))<=8||view==='tab'&&y>=29&&y<56)){drag={kind:'scrub'};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='ew-resize';setCursor(timeOf(x));return;}
  if(y<29){selection.clear();selectionRange=null;markerSelection=null;const kind=loopRegionDefined&&Math.abs(x-xOf(audio.loop.start))<9?'loop-start':loopRegionDefined&&Math.abs(x-xOf(audio.loop.end))<9?'loop-end':'loop-range';drag={kind,start:time,value:time};canvas.setPointerCapture(e.pointerId);draw();return;}
  if(view==='tab'&&Math.abs(y-(g.top+g.lanes.length*g.row+15))<=15){const index=arrangement().handshapes.findLastIndex(h=>Math.abs(x-xOf(h.end_time))<=9);if(index>=0){selectedZoneIndex=index;drag={kind:'zone-end',index,end:arrangement().handshapes[index].end_time};canvas.setPointerCapture(e.pointerId);draw();return;}const body=arrangement().handshapes.findLastIndex(h=>x>=xOf(h.start_time)&&x<xOf(h.end_time));if(body>=0){const contents=chordZoneContents(arrangement(),body);selectedZoneIndex=body;inspector='chords';drag={kind:'zone-move',index:body,origin:timeOf(x),delta:0,ids:new Set(contents.notes.map(n=>n.id)),zoneIndexes:new Set(contents.zones.map(h=>arrangement().handshapes.indexOf(h)))};canvas.setPointerCapture(e.pointerId);renderInspector();draw();return;}}
  if(view==='tab'&&markerKindAt(y)){const kind=markerKindAt(y),list=markerList(kind),timeKey=kind==='sections'?'start_time':'time',item=[...list].sort((a,b)=>a[timeKey]-b[timeKey]).findLast(item=>item[timeKey]<=timeOf(x));if(item){markerSelection={kind,index:list.indexOf(item)};selection.clear();selectionRange=null;inspector='properties';cursor=item[timeKey];drag={kind:'marker',marker:{...markerSelection},timeKey,time:item[timeKey]};canvas.setPointerCapture(e.pointerId);renderInspector();draw();updateClock();return;}}
  markerSelection=null;
  if(view==='tempo'&&y<85){let index=project().beats.findIndex(b=>Math.abs(xOf(b.time)-x)<9);if(index>0||(e.shiftKey&&index>=0)){drag={kind:e.shiftKey?'beat-shift':'beat',index,time:project().beats[index].time};canvas.setPointerCapture(e.pointerId);return;}}
  // Dragging the waveform slides the audio against the map; on release the
  // opposite shift is baked into the chart, so every export carries it.
  if(view==='tempo'&&waveform?.length&&y>=90&&y<280&&x>=g.left){drag={kind:'audio-nudge',origin:timeOf(x),delta:0};canvas.setPointerCapture(e.pointerId);return;}
  const hit=editableNotes().findLast(n=>Math.abs(yOf(getNoteLane(n))-y)<Math.max(10,g.row/2)&&x>=xOf(n.time)-10&&x<=xOf(n.time)+Math.max(12,n.sustain*zoom));
  if(hit){selectionRange=null;if(tool==='eraser'){selection=new Set([hit.id]);actions.delete();return;}if(e.shiftKey){selection.has(hit.id)?selection.delete(hit.id):selection.add(hit.id);}else if(!selection.has(hit.id))selection=new Set([hit.id]);inspector='properties';cursor=hit.time;drag=x>=xOf(hit.time+hit.sustain)-6&&hit.sustain>0?{kind:'sustain',id:hit.id,end:hit.time+hit.sustain}:{kind:'note',origin:timeOf(x),delta:0};}
  else{cursor=Math.max(0,time);if(y>=g.top)lane=laneOf(y);if(!e.shiftKey){selection.clear();selectionRange=null;}if(tool==='pencil'&&mouseModel!=='eof'&&y>=g.top){insertNote();return;}drag={kind:'marquee',x,y,currentX:x,currentY:y};}
  canvas.setPointerCapture(e.pointerId);renderInspector();draw();updateClock();
 }));
 async function awaitLaneAction(y){await actions[{tones:'tone',phrases:'phrase',sections:'section',anchors:'anchor'}[markerKindAt(y)]]();}
 on(canvas,'pointermove',e=>{if(!drag)return;const {x,y}=pointerPoint(e);if(drag.kind==='scrub'){scrubTo(x);return;}if(drag.kind.startsWith('loop-'))drag.value=Math.min(project().duration,quantize(timeOf(x)));else if(drag.kind==='beat'||drag.kind==='beat-shift')drag.time=Math.max(0,timeOf(x));else if(drag.kind==='audio-nudge')drag.delta=timeOf(x)-drag.origin;else if(drag.kind==='zone-move'){const start=arrangement().handshapes[drag.index].start_time;drag.delta=Math.max(0,quantize(start+timeOf(x)-drag.origin))-start;}else if(drag.kind==='zone-end'){const start=arrangement().handshapes[drag.index].start_time,division=snap||4,next=timeAt(project().beats,(Math.floor(beatAt(project().beats,start)*division)+1)/division);drag.end=Math.max(next,quantize(timeOf(x)));}else if(drag.kind==='marker')drag.time=quantize(timeOf(x));else if(drag.kind==='sustain')drag.end=quantize(timeOf(x));else if(drag.kind==='note')drag.delta=quantize(timeOf(x))-quantize(drag.origin);else{drag.currentX=x;drag.currentY=y;}draw();});
 on(canvas,'pointerup',safe(e=>{
  if(!drag)return;const saved=drag;drag=null;canvas.releasePointerCapture(e.pointerId);
  if(saved.kind==='scrub'){canvas.style.cursor='';draw();return;}
  if(saved.kind.startsWith('loop-')){let {start,end}=audio.loop;if(saved.kind==='loop-range'){start=Math.min(saved.start,saved.value);end=Math.max(saved.start,saved.value);}else if(saved.kind==='loop-start')start=Math.min(saved.value,end-.001);else end=Math.max(saved.value,start+.001);if(end-start>.001){countIn.cancel();audio.setLoop(start,end,loop);loopRegionDefined=true;renderInspector();status(`Loop region ${seconds(start)} – ${seconds(end)} · press L to ${loop?'disable':'enable'}`);}else setCursor(saved.start);}
  else if(saved.kind==='beat-shift')shiftBeatMap(saved.time-project().beats[saved.index].time);
   else if(saved.kind==='audio-nudge'){if(Math.abs(saved.delta*zoom)<3){cursor=Math.max(0,saved.origin);updateClock();draw();}else shiftBeatMap(-saved.delta);}
   else if(saved.kind==='beat'){change('Align beat marker',p=>{const next=clone(p.beats);next[saved.index].time=saved.time;applyGrid(p,next,$('move-notes').checked);});}
  else if(saved.kind==='zone-end'&&saved.end!==arrangement().handshapes[saved.index].end_time)change('Drag hand-shape end',()=>setChordZoneEnd(arrangement(),saved.index,saved.end));
  else if(saved.kind==='zone-move'&&saved.delta!==0)change('Move chord zone and its notes',p=>{const result=moveChordZone(arrangement(),saved.index,saved.delta);p.duration=Math.max(p.duration,result.endTime);selection=new Set(result.notes.map(n=>n.id));selectionRange=null;cursor=result.zone.start_time;});
  else if(saved.kind==='marker'){const list=markerList(saved.marker.kind),item=list[saved.marker.index];if(item[saved.timeKey]!==saved.time)change('Move timeline marker',()=>{item[saved.timeKey]=saved.time;list.sort((x,y)=>x[saved.timeKey]-y[saved.timeKey]);markerSelection.index=list.indexOf(item);});}
  else if(saved.kind==='sustain')editSustains('Resize sustain',n=>Math.max(0,saved.end-n.time),{ids:new Set([saved.id]),snapped:snap>0&&snapOptions.mode==='grid'});
  else if(saved.kind==='note'&&Math.abs(saved.delta)>0.000001)moveSelected(saved.delta);
  else if(saved.kind==='marquee'&&Math.hypot(saved.currentX-saved.x,saved.currentY-saved.y)>5){for(const n of editableNotes()){const x=xOf(n.time),y=yOf(getNoteLane(n));if(x>=Math.min(saved.x,saved.currentX)&&x<=Math.max(saved.x,saved.currentX)&&y>=Math.min(saved.y,saved.currentY)&&y<=Math.max(saved.y,saved.currentY))selection.add(n.id);}selectionRange=null;inspector='properties';render();}
  draw();
 }));
 on(canvas,'pointercancel',()=>{drag=null;draw();});
 on(root,'keyup',safe(async e=>{
  // Insert pressed and released on its own is a key of its own (Charter: add a beat).
  if(e.code==='Insert'&&insertHeld){insertHeld=false;if(!insertUsed&&!e.target.matches('input,textarea,select')&&!$('dialog').open){const id=keymap().byCombo.get('Insert');if(id)await runCommand(id);}return;}
  lyricKey(e);
 }));
 on(root,'keydown',safe(async e=>{
  if(lyricKey(e))return;
  if(e.code==='Insert'&&!e.target.matches('input,textarea,select')){e.preventDefault();if(!e.repeat){insertHeld=true;insertUsed=false;}return;}
  if(insertHeld)insertUsed=true;
  const combo=comboFromEvent(e,{insertHeld}),early=combo?keymap().byCombo.get(combo):null;
  if(view==='tones'&&e.target.matches('input[data-knob-step],input[data-tone-volume-step]')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const input=e.target,step=Number(input.dataset.knobStep??input.dataset.toneVolumeStep),value=input.value.trim()?Number(input.value):Number(input.min);input.value=String(Math.max(Number(input.min),Math.min(Number(input.max),value+(e.key==='ArrowUp'?step:-step))));input.dispatchEvent(new Event('change',{bubbles:true}));return;}
  if(e.key==='Tab'&&!e.ctrlKey&&!e.metaKey&&e.target.dataset.vocalField&&await tabVocalField(e))return;
  // Save, open and arrangement info also work from a text field: commit the field first.
  if(['save','saveas','open','arrangement-info'].includes(early)&&(e.ctrlKey||e.metaKey||e.altKey||/^F\d/.test(combo))){
   e.preventDefault();if($('dialog').open)return;
   const focused=document.activeElement,beforeErrors=errorRevision;
   if(root.contains(focused)&&focused.matches('input,textarea,select')){if(!focused.checkValidity()){focused.reportValidity();return;}focused.blur();await Promise.resolve();if(errorRevision!==beforeErrors)return;}
   await actions[early]();return;
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='Tab'&&!$('dialog').open){e.preventDefault();const visibleTimeline=()=>view==='vocals'?vocalController?.canvas:view==='tones'?$('tone-view').querySelector('input,select,button'):canvas,fromTimeline=e.target===visibleTimeline(),focused=document.activeElement,beforeErrors=errorRevision;if(root.contains(focused)&&focused.matches('input,textarea,select')){if(!focused.checkValidity()){focused.reportValidity();return;}focused.blur();await Promise.resolve();if(errorRevision!==beforeErrors)return;}if(fromTimeline){inspectorVisible=true;applyLayout();renderInspector();root.querySelector('.ws-inspector input,.ws-inspector button,.ws-inspector select')?.focus();}else visibleTimeline()?.focus({preventScroll:true});return;}
  if(e.target.matches('input,textarea,select')||$('dialog').open)return;
  const mod=e.ctrlKey||e.metaKey,key=rollArrow(e.key.toLowerCase(),bottomRoll());let action=null;
  // Command keys come from the keyboard profile and the user's changes. A command key the profile
  // leaves unbound does nothing; structural keys (frets, arrows, Delete...) carry on below.
  if(combo){if(early){e.preventDefault();await runCommand(early);return;}if(!isStructural(combo))return;}
  if(!chartEditing()){
   const globalAction=mod?({z:e.shiftKey?'redo':'undo',y:'redo',k:'scratch',m:'mixer',b:'errors',i:e.shiftKey?null:'import-chart'})[key]:({' ':'play',l:'loop'})[key];
   if(globalAction){e.preventDefault();await actions[globalAction]();return;}
   if(mod&&e.shiftKey&&key==='t'){e.preventDefault();actions['tempo-import']();return;}
   if(!mod&&['j','k'].includes(key)){e.preventDefault();const percent=Math.max(25,Math.min(200,Math.round(audio.speed*100)+(key==='j'?-5:5)));$('speed').value=percent;$('speed').dispatchEvent(new Event('input'));return;}
   if(['home','end','arrowleft','arrowright'].includes(key)){e.preventDefault();const beats=project().beats;setCursor(key==='home'?beats[0].time:key==='end'?beats.at(-1).time:timeAt(beats,beatAt(beats,cursor)+(key==='arrowleft'?-1:1)/(snap||4)));return;}
   if(arrangement().locked&&(view==='tab'||view==='tempo')&&(['delete','backspace'].includes(key)||(!mod&&/^[0-9a-z\[\],.]$/.test(key))||(mod&&['x','v','p'].includes(key))))status(`${arrangement().name} is locked; Arrangement > Lock / unlock to edit it`);
   if(['delete','backspace'].includes(key)||(!mod&&(/^[0-9]$/.test(key)||['a','b','f','n','s','h','r','q','v','p','m','u','c','o','t','i','[',']',',','.'].includes(key)))||(mod&&['x','v','a','p','l'].includes(key)))e.preventDefault();
   return;
  }

  if(e.shiftKey&&!mod&&key==='f'){e.preventDefault();await actions['chord-zone-cycle']();return;}
  if(e.shiftKey&&mod&&key==='h'){e.preventDefault();await actions['chord-zone-hide']();return;}
  if(key==='home'||key==='end'){e.preventDefault();const beats=project().beats;setCursor(key==='home'?beats[0].time:beats.at(-1).time);setTimeScroll(Math.max(0,cursor*zoom-100));return;}
  if(!mod&&['+','-','add','subtract'].includes(key)){e.preventDefault();const values=[0,1,2,3,4,6,8],index=values.indexOf(snap);snap=values[Math.max(0,Math.min(values.length-1,index+(['+','add'].includes(key)?1:-1)))];$('snap').value=snap;draw();return;}
  if(mod&&!e.shiftKey&&key==='i'){e.preventDefault();actions['import-chart']();return;}
  if(mod&&e.shiftKey&&key==='t'){e.preventDefault();actions['tempo-import']();return;}
  if(mod&&key==='k'){e.preventDefault();actions.scratch();return;}
  if(mod&&key==='m'){e.preventDefault();actions.mixer();return;}
  if(mod&&key==='b'){e.preventDefault();actions.errors();return;}
  if(!mod&&['j','k'].includes(key)){e.preventDefault();const percent=Math.max(25,Math.min(200,Math.round(audio.speed*100)+(key==='j'?-5:5)));$('speed').value=percent;$('speed').dispatchEvent(new Event('input'));return;}
  if(!mod&&['l','g','[',']',',','.'].includes(key)){e.preventDefault();await actions[({l:'loop',g:'sustain-gutter','[':'sustain-less',']':'sustain-more',',':'shift-left','.':'shift-right'})[key]]();return;}
  if(e.shiftKey&&['arrowup','arrowdown'].includes(key)){
   e.preventDefault();const lanes=laneInfo(),start=lanes.indexOf(lane),next=Math.max(0,Math.min(lanes.length-1,start+(key==='arrowup'?-1:1)));
   verticalSelectionAnchor??=start;lane=lanes[next];revealRollLane();const lower=Math.min(verticalSelectionAnchor,next),upper=Math.max(verticalSelectionAnchor,next);
   selection=new Set(editableNotes().filter(n=>Math.abs(n.time-cursor)<.001&&lanes.indexOf(getNoteLane(n))>=lower&&lanes.indexOf(getNoteLane(n))<=upper).map(n=>n.id));selectionRange=null;markerSelection=null;inspector='properties';render();return;
  }
  if(!e.shiftKey){verticalSelectionAnchor=null;horizontalSelectionAnchor=null;}
  if(mod&&!e.shiftKey&&e.code==='KeyJ'){e.preventDefault();actions['toggle-bottom']();return;}
  if(mod&&['Digit1','Digit2','Digit3'].includes(e.code)){e.preventDefault();const next=({Digit1:'properties',Digit2:'chords',Digit3:'settings'})[e.code];inspectorVisible=inspector!==next||!inspectorVisible;inspector=next;applyLayout();renderInspector();draw();return;}
  if(e.shiftKey&&!mod&&['guitar','bass'].includes(arrangement().type)&&/^Digit[0-4]$/.test(e.code)){e.preventDefault();editSelection('Set left finger',n=>n.techniques.left_hand=Number(e.code.at(-1)));return;}
  if(e.altKey&&key==='s'){e.preventDefault();await actions.section();return;}
  if(['arrowleft','arrowright'].includes(key)){
   e.preventDefault();const direction=key==='arrowleft'?-1:1,beats=project().beats;
   let destination=timeAt(beats,beatAt(beats,cursor)+direction/(snap||4));
   if(e.altKey){const times=arrangement().phrases.map(p=>p.time).sort((a,b)=>a-b);destination=direction>0?(times.find(t=>t>cursor+.001)??project().duration):(times.findLast(t=>t<cursor-.001)??0);}
   else if(mod){const times=beats.filter(b=>b.measure>=0).map(b=>b.time);destination=direction>0?(times.find(t=>t>cursor+.001)??project().duration):(times.findLast(t=>t<cursor-.001)??0);}
   if(e.shiftKey){horizontalSelectionAnchor??=cursor;selectRegion(horizontalSelectionAnchor,destination);}setCursor(destination,{keepSelectionAnchor:e.shiftKey});return;
  }
  if(/^[0-9]$/.test(key)&&(!mod||e.code.startsWith('Numpad'))){e.preventDefault();let fret=Number(key);if(e.code.startsWith('Numpad'))fret+=mod?20:10;if(fret<=24)insertDisplayedFret(fret);return;}
  if(mod){action=({s:e.shiftKey?'saveas':'save',z:e.shiftKey?'redo':'undo',y:'redo',c:'copy',v:'paste',a:'selectall',o:'open',l:'select-like',p:e.shiftKey?'phrase-remove':'phrase'})[key];if(key==='x'){actions.copy();action='delete';}}
  else if(e.altKey&&key==='s')action='section';
  else if(e.shiftKey&&key==='enter')action='selectphrase';
  else if(key===' ')action='play';else if(key==='delete'||key==='backspace')action=markerSelection?'marker-delete':'delete';
  else if(key==='arrowleft'||key==='arrowright'){e.preventDefault();setCursor(timeAt(project().beats,beatAt(project().beats,cursor)+(key==='arrowleft'?-1:1)/(snap||4)));return;}
  else if(key==='arrowup'||key==='arrowdown'){e.preventDefault();const lanes=laneInfo(),index=lanes.indexOf(lane);lane=lanes[Math.max(0,Math.min(lanes.length-1,index+(key==='arrowup'?-1:1)))];revealRollLane();draw();return;}
  else if(/^[0-9]$/.test(key)){e.preventDefault();let fret=Number(key);if(e.code.startsWith('Numpad'))fret+=mod?20:10;if(fret<=24)insertDisplayedFret(fret);return;}
  else if(e.shiftKey&&key==='s')action='slide-cycle';
  else action=({a:'anchor',f:'chord',n:'strum',b:'bend',s:'sustain-toggle'})[key];
  if(action){e.preventDefault();await actions[action]();return;}
  if(key==='h'){e.preventDefault();cycleTechnique(['hammer_on','pull_off']);return;}
  if(key==='r'){e.preventDefault();cycleTechnique(['harmonic','harmonic_pinch']);return;}
  if(key==='q'){e.preventDefault();cycleTechnique(lane<arrangement().stringCount/2?['slap','pluck']:['pluck','slap']);return;}
  if(key==='v'){e.preventDefault();change('Lower bend at cursor',()=>adjustBendAtCursor(arrangement(),selection,cursor,-.5));return;}
  const technique=({p:'palm_mute',m:'fret_hand_mute',h:'hammer_on',r:'harmonic',u:'tap',c:'accent',o:'vibrato',t:'tremolo',i:'ignore',q:'slap'})[key];if(technique){e.preventDefault();toggleTechnique(technique);}
 }));
 const meterTimer=setInterval(()=>{
  if(bottom!=='mixer'||!root.isConnected||abort.signal.aborted)return;
  for(const bus of Object.keys(audio.gains)){
   signalMeters.attach(bus,audio.getBusOutput(bus),audio.context);const level=signalMeters.read(bus);
   for(const [channel,value]of [level.left,level.right].entries()){const meter=root.querySelector(`[data-signal-meter="${bus}"][data-signal-channel="${channel}"]`);if(meter)meter.value=Math.max(-60,Math.min(0,value.peakDb));}
   const output=root.querySelector(`[data-signal-value="${bus}"]`);if(output)output.textContent=`${signalDbText(level.left.peakDb)} / ${signalDbText(level.right.peakDb)}`;
   const clip=root.querySelector(`[data-signal-clip="${bus}"]`);if(clip)clip.hidden=!level.clipped;
  }
 },80);
 audio.disposers.add(()=>{clearInterval(meterTimer);signalMeters.dispose();});
 audio.onTime=()=>{if(!root.isConnected)return;updateClock();updateTonePreview();if(audio.isPlaying){const x=xOf(audio.currentTime);if(bottomRoll())setTimeScroll(Math.max(0,audio.currentTime*zoom-48));else if(x>geometry().width-60)setTimeScroll(Math.max(0,audio.currentTime*zoom-200));draw();}};
 audio.onEnded=()=>{stopMidi();cursor=audio.currentTime;updateClock();};audio.setEnabled('metronome',false);audio.setGain('guide',0.7);audio.setGain('master',Number($('master').value)/100);audio.setProject(project(),arrangement());
 const preferences=readPreferences();staveTheme=preferences.staveTheme==='light'?'light':'dark';showRests=preferences.showRests!==false;if(preferences.liveMonitor)liveMonitorOptions={...liveMonitorOptions,...preferences.liveMonitor};if(preferences.lyric){lyricMode=preferences.lyric.mode==='tap'?'tap':'check';for(const key of ['scope','leadIn','latency'])if(preferences.lyric[key]!==undefined)lyricOptions[key]=preferences.lyric[key];}inspectorVisible=preferences.inspectorVisible??inspectorVisible;inspectorWidth=preferences.inspectorWidth??inspectorWidth;bottomHeight=preferences.bottomHeight??bottomHeight;bottomVisible=preferences.bottomVisible??bottomVisible;if(preferences.liveView&&typeof preferences.liveView==='object')liveOptions={lowStringTop:preferences.liveView.lowStringTop!==false,leftHanded:preferences.liveView.leftHanded===true,speed:Number.isFinite(preferences.liveView.speed)?Math.max(.5,Math.min(2,preferences.liveView.speed)):1,renderer:typeof preferences.liveView.renderer==='string'?preferences.liveView.renderer:'oce'};if(preferences.keyboard&&typeof preferences.keyboard==='object'){keyProfile=PROFILE_IDS.includes(preferences.keyboard.profile)?preferences.keyboard.profile:'oce';keyOverrides=preferences.keyboard.overrides&&typeof preferences.keyboard.overrides==='object'?preferences.keyboard.overrides:{};techniqueToggleEach=preferences.keyboard.each===true;mouseModel=preferences.keyboard.mouse==='eof'?'eof':'standard';}refreshMenuKeys();if(preferences.chordStrip&&typeof preferences.chordStrip==='object')chordStrip={visible:preferences.chordStrip.visible!==false,open:preferences.chordStrip.open!==false,position:preferences.chordStrip.position==='above'?'above':'below',upright:preferences.chordStrip.upright===true};zoom=preferences.zoom??zoom;viewZoom={tab:zoom,tempo:zoom,...preferences.viewZoom};laneScales={...laneScales,...preferences.laneScales};rollOrientations={...rollOrientations,...preferences.rollOrientations};zoom=viewZoom.tab;snap=preferences.snap??snap;fretConvention=preferences.fretConvention??fretConvention;invertStrings=preferences.invertStrings??invertStrings;validationProfile=preferences.validationProfile??validationProfile;countInOptions={...countInOptions,...preferences.countIn};
 if(preferences.mixer){try{audio.restoreMixerState(preferences.mixer);}catch{}}if(preferences.speed)audio.setSpeed(preferences.speed);if(preferences.pitch!==undefined)audio.setPitch(preferences.pitch);click=audio.enabled.metronome;guide=audio.enabled.guide;$('zoom').value=zoom;$('snap').value=snap;$('speed').value=audio.speed*100;$('speed-value').textContent=`${Math.round(audio.speed*100)}%`;$('pitch').value=audio.pitch;$('master').value=audio.gains.master*100;
 shadeHands=preferences.shadeHands??shadeHands;pianoPalette=preferences.pianoPalette??pianoPalette;audio.quality=preferences.quality??'fast';qualityMessage=audio.quality==='spectral'?'Spectral preview selected; preparation starts on Play':'Fast granular preview';sustainOptions={...sustainOptions,...preferences.sustain};
 function persistPreferences(){writePreferences({liveView:{...liveOptions},liveMonitor:{...liveMonitorOptions},keyboard:{profile:keyProfile,overrides:keyOverrides,each:techniqueToggleEach,mouse:mouseModel},inspectorVisible,inspectorWidth,bottomHeight,bottomVisible,chordStrip:{...chordStrip},zoom,viewZoom:{...viewZoom},laneScales:{...laneScales},rollOrientations:{...rollOrientations},snap,fretConvention,invertStrings,validationProfile,shadeHands,pianoPalette,sustain:{...sustainOptions},quality:audio.quality,speed:audio.speed,pitch:audio.pitch,mixer:audio.getMixerState(),countIn:{...countInOptions},staveTheme,showRests,lyric:{mode:lyricMode,...lyricOptions}});}
 on(root.querySelector('.ws-menu'),'pointerdown',refreshActionAvailability);
 root.addEventListener('keydown',e=>{if(e.key==='F10'||e.target.closest('.ws-menu'))refreshActionAvailability();},{capture:true,signal:abort.signal});
 on(root,'click',e=>{if(e.target.closest('button[data-action]'))refreshActionAvailability();});
 on(root,'change',persistPreferences);on(root,'input',persistPreferences);on(root,'pointerup',persistPreferences);
 const resize=new ResizeObserver(draw);resize.observe(scroll);render();
 loadGearCatalog().then(()=>{if(view==='tones')renderTones();updateTonePreview(true);}).catch(e=>status(e.message,true));
 function queueDraft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>writeDraft({project:clone(project()),audio:loadedAudio,savedAt:Date.now()}).catch(e=>status(`Draft recovery unavailable: ${e.message}`,true)),600);}
 if(retainedSession){
  const saved=retainedSession;history=saved.history||new History(normalizeProject(saved.project));cursor=saved.cursor;arrangementId=saved.arrangementId;dirty=saved.dirty;loadedAudio=saved.audio;preview=saved.preview;
  countInOptions={...countInOptions,...saved.countInOptions};sustainOptions={...sustainOptions,...saved.sustainOptions};sustainProvenance=saved.sustainProvenance||new WeakMap();const ui=saved.ui||{};splitIds=Array.isArray(ui.splitIds)?ui.splitIds.filter(id=>typeof id==='string'):[];viewZoom={...viewZoom,...ui.viewZoom};laneScales={...laneScales,...ui.laneScales};timelineView=ui.timelineView||'tab';snapOptions={...snapOptions,...ui.snapOptions};inspectorVisible=ui.inspectorVisible??true;inspectorWidth=ui.inspectorWidth??280;bottomHeight=ui.bottomHeight??155;view=ui.view||view;vocalUI=ui.vocalUI||vocalUI;vocalPage=ui.vocalPage||0;vocalClipboard=ui.vocalClipboard||null;inspector=ui.inspector||inspector;auditionSelectedTone=ui.auditionSelectedTone??auditionSelectedTone;bottom=ui.bottom||bottom;mainArrangementId=ui.mainArrangementId||null;loopRegionDefined=ui.loopRegionDefined??false;validationProfile=ui.validationProfile||validationProfile;zoom=ui.zoom??zoom;snap=ui.snap??snap;lane=ui.lane??lane;tool=ui.tool||tool;selection=new Set(ui.selection||[]);selectionRange=ui.selectionRange||null;markerSelection=ui.markerSelection||null;pianoLow=ui.pianoLow??pianoLow;pianoHigh=ui.pianoHigh??pianoHigh;fretConvention=ui.fretConvention||fretConvention;invertStrings=ui.invertStrings??false;clipboard=ui.clipboard||[];
  currentRecentId=saved.currentRecentId||null;saveDestinations=saved.saveDestinations||{};saveHandle=saved.saveHandle;lastSaveFormat=saved.lastSaveFormat==='cdlc'?'json':saved.lastSaveFormat||'json';exportOptions=saved.exportOptions||{};lastDestination=saved.lastDestination||'';
  if(saved.transport){const t=saved.transport;audio.quality=t.quality??audio.quality;qualityMessage=audio.quality==='spectral'?'Spectral preview selected; preparation starts on Play':'Fast granular preview';audio.setSpeed(t.speed);audio.setPitch(t.pitch);audio.setLoop(t.loop.start,t.loop.end,t.loop.enabled);audio.setRamp(t.ramp);for(const [bus,gain]of Object.entries(t.gains))audio.setGain(bus,gain);if(t.mixer)audio.restoreMixerState(t.mixer);loop=t.loop.enabled;ramp={...t.ramp};click=t.mixer?.enabled.metronome??t.gains.metronome>0;guide=t.mixer?.enabled.guide??t.gains.guide>0;$('speed').value=t.speed*100;$('speed-value').textContent=`${Math.round(t.speed*100)}%`;$('pitch').value=t.pitch;$('master').value=t.gains.master*100;}
  $('zoom').value=zoom;$('snap').value=snap;audio.setProject(project(),arrangement());audio.seek(cursor);render();scroll.scrollLeft=ui.scrollLeft||0;scroll.scrollTop=ui.scrollTop||0;rememberScroll();
  shadeHands=ui.shadeHands??shadeHands;
  if(saved.audio){activeAudioUrl=project().audio?.url||null;const request=++audioGeneration;saved.audio.arrayBuffer().then(bytes=>decodeBacking(bytes,activeAudioUrl,request)).then(()=>{if(request!==audioGeneration)return;waveform=audio.peaks;audio.seek(cursor);draw();}).catch(e=>status(e.message,true));}else if(project().audio?.url)loadAudioUrl(project().audio.url).catch(e=>status(e.message,true));
 }else{
  const initialGeneration=projectGeneration;
  readDraft().then(async saved=>{if(libraryExplicitIntent||!saved?.project||dirty||projectGeneration!==initialGeneration||!root.isConnected)return;switchProject(saved.project);const recovered=history,generation=projectGeneration;if(saved.audio)await uploadAudio(saved.audio,{isCurrent:()=>!libraryExplicitIntent&&history===recovered&&projectGeneration===generation});if(libraryExplicitIntent||history!==recovered||projectGeneration!==generation)return;dirty=true;render();status('Recovered local working draft; save an editable project to keep it');}).catch(()=>{});
 }
 const libraryOpenController=createLibraryOpenController({
  capture:()=>({history,stateId:history.stateId,generation:projectGeneration,request:++openGeneration}),
  isCurrent:source=>history===source.history&&history.stateId===source.stateId&&projectGeneration===source.generation&&openGeneration===source.request&&!abort.signal.aborted&&root.isConnected,
  confirmReplace:()=>confirmReplace(),readSource:readOceLibrarySource,
  openAcceptedFile:async(file,{source,isCurrent})=>({opened:await openFile(file,null,{request:source.request,acceptGuard:isCurrent})===true})
 });
 const receiveOwnedLibraryRequest=()=>{const request=pendingLibraryRequest;if(!request||abort.signal.aborted||!root.isConnected)return;pendingLibraryRequest=null;
  if($('dialog')?.open&&['Welcome to Open Chart Editor','Open Recent'].includes($('dialog-title')?.textContent))$('dialog').querySelector('button[value="cancel"]')?.click();
  safe(async()=>{const result=await libraryOpenController.open(request);if(result.status==='cancelled'&&!abort.signal.aborted)status('Library open cancelled; current project retained');})().catch(()=>{});
 };
 libraryRequestReceiver=receiveOwnedLibraryRequest;if(pendingLibraryRequest)queueMicrotask(receiveOwnedLibraryRequest);
 const screenChanged=event=>{const screen=typeof event==='string'?event:event?.detail?.id||event?.id||event?.screen;if(screen&&!['open_chart_editor','plugin-open_chart_editor'].includes(screen)){countIn.cancel();stopMidi();liveInput.stop();cursor=audio.currentTime;audio.pause();updateClock();draw();}};
 const offScreenChanged=window.feedBack?.on?.('screen:changed',screenChanged);
 window.addEventListener('beforeunload',e=>{persistPreferences();if(dirty){e.preventDefault();e.returnValue='';}},{signal:abort.signal});
 return ()=>{const attempt=fn=>{try{const result=fn();if(result?.catch)result.catch(error=>console.error('Editor cleanup:',error));}catch(error){console.error('Editor cleanup:',error);}};if(libraryRequestReceiver===receiveOwnedLibraryRequest)libraryRequestReceiver=null;attempt(()=>libraryOpenController.dispose());rememberScroll();disposeVocalTimeline();persistPreferences();if(acceptSaveCompletion===receiveSaveCompletion)acceptSaveCompletion=null;audioGeneration++;countIn.cancel();attempt(stopMidi);retainedSession={history,audio:loadedAudio,cursor:audio.currentTime,arrangementId,dirty,preview,currentRecentId,countInOptions:{...countInOptions},sustainOptions:{...sustainOptions},sustainProvenance,saveDestinations,saveHandle,lastSaveFormat,exportOptions,lastDestination,
  ui:{vocalUI,vocalPage,vocalClipboard,auditionSelectedTone,view,splitIds:[...splitIds],viewZoom:{...viewZoom},laneScales:{...laneScales},timelineView,inspector,bottom,snapOptions:{...snapOptions},inspectorVisible,inspectorWidth,bottomHeight,loopRegionDefined,mainArrangementId,validationProfile,zoom,snap,lane,tool,selection:[...selection],selectionRange,markerSelection,pianoLow,pianoHigh,fretConvention,invertStrings,shadeHands,clipboard,scrollLeft:connectedScroll.left,scrollTop:connectedScroll.top},
  transport:{quality:audio.quality,speed:audio.speed,pitch:audio.pitch,loop:{...audio.loop},ramp:{...audio.ramp},gains:{...audio.gains},mixer:audio.getMixerState()}};clearTimeout(draftTimer);abort.abort();resize.disconnect();spacer.remove();attempt(()=>midiConnection?.disconnect());if(typeof offScreenChanged==='function')offScreenChanged();else window.feedBack?.off?.('screen:changed',screenChanged);attempt(()=>tonePreview?.dispose());attempt(()=>audio.dispose());delete root.dataset.mounted;};
}
let activeRoot=null,unmount=null;
function reconcileRoot(){const root=document.getElementById('ws-app');if(root===activeRoot)return;unmount?.();activeRoot=root;unmount=root?mount(root):null;}
reconcileRoot();const observer=new MutationObserver(reconcileRoot);observer.observe(document.documentElement,{childList:true,subtree:true});
