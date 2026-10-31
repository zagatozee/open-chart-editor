import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findChartIssues, validateProject} from '../src/validation.js';

const nativeTone = () => ({GearList:{Amp:{Key:'OwnAmp',KnobValues:{}},Cabinet:{Key:'OwnCabinet',KnobValues:{}}}});
function chart(type='guitar',count=6) {
  return {duration:20,beats:[{time:0,measure:1},{time:0.5,measure:-1}],sections:[],arrangements:[{
    id:'lead',type,stringCount:count,tuning:Array(count).fill(0),notes:[],chords:[],chord_templates:[],
    anchors:[{time:0,fret:1,width:24}],phrases:[],handshapes:[],tones:{base:'OwnClean',changes:[],definitions:{OwnClean:nativeTone()}}
  }]};
}
const note = (id,time,string=0,fret=3,sustain=0.5,techniques={}) => ({id,time,string,fret,sustain,techniques});
const codes = (p,target) => findChartIssues(p,target).map(issue=>issue.code);
const issuesWith = (p,code) => findChartIssues(p).filter(issue=>issue.code===code);
const template = (frets=[3,3,-1,-1,-1,-1],fingers=[1,1,-1,-1,-1,-1]) => ({name:'Original chord',frets,fingers});

test('valid original fretted, keys, drums and extended Feedpak charts stay valid without mutation',()=>{
  for(const [kind,count] of [['guitar',8],['bass',5],['keys',6],['drums',6]]) {
    const p=chart(kind,count),a=p.arrangements[0];
    a.notes=[kind==='keys'?{id:'k',time:1,pitch:60,sustain:1}:kind==='drums'?{id:'d',time:1,piece:'kick',velocity:96,sustain:0}:note('n',1)];
    p.future={opaque:['preserved']};const before=structuredClone(p);
    assert.deepEqual(findChartIssues(p),[]);assert.deepEqual(p,before);
  }
});

test('stock compatibility is explicit and placeholder tones cannot masquerade as native gear',()=>{
  const p=chart('guitar',8),a=p.arrangements[0];
  a.tones.definitions.OwnClean={name:'OwnClean',gain:0.2};
  assert.equal(codes(p).includes('export.instrument'),false);
  assert.deepEqual(new Set(codes(p,'cdlc')),new Set(['export.instrument','tone.nativeDefinition']));
  assert.ok(!codes(p,'xml').includes('tone.nativeDefinition'));
});

test('sustain overlap tracks furthest tail, includes chords, allows other strings and exact joins',()=>{
  const p=chart(),a=p.arrangements[0];
  a.notes=[note('long',1,0,3,5),note('middle',2,0,4,0.1),note('later',4,0,5,0.2),note('other',2,1,4,3)];
  assert.deepEqual(issuesWith(p,'sustain.overlap').map(x=>x.note),['middle','later']);
  a.notes=[note('first',1,0,3,1),note('joined',2,0,4,1)];assert.equal(issuesWith(p,'sustain.overlap').length,0);
  a.chord_templates=[template()];a.chords=[{time:1.5,chord_id:0,notes:[note('chord-member',1.5,0,3,1)]}];
  assert.ok(issuesWith(p,'sustain.overlap').some(x=>x.note==='chord-member'));
  a.chords=[{time:1.5,chord_id:0,sustain:1}];assert.ok(issuesWith(p,'sustain.overlap').length>0);
});

test('a sustain joined exactly at the epsilon boundary is not flagged merely because of float64 subtraction noise',()=>{
  // Reproduces a real Rocksmith+ "Spark in the Dark" UGC Lead chart: a linked slide's sustain
  // and the next note's time are each subtracted from absolute song-position floats, so the
  // join lands a few ULP past the nominal 1ms tolerance depending on which way that noise falls.
  const p=chart(),a=p.arrangements[0];
  a.notes=[note('slide',32.814,1,3,0.112,{slide_to:2,link_next:true}),note('landed',32.925,1,2,0.112,{slide_to:3,link_next:true}),note('next',33.037,1,3,0)];
  assert.equal(issuesWith(p,'sustain.overlap').length,0);
});

test('same-onset duplicate is found even beneath an earlier longer sustain',()=>{
  const p=chart();p.arrangements[0].notes=[note('long',0,0,3,10),note('a',1),note('b',1)];
  assert.deepEqual(issuesWith(p,'note.duplicate').map(x=>x.note),['b']);
  assert.equal(issuesWith(p,'note.duplicate')[0].related[0],'a');
});

test('curve times are relative, ordered and within tails, with independent value diagnostics',()=>{
  const p=chart();p.arrangements[0].notes=[note('bend',10,0,0,1,{bend:1,bend_values:[{t:0,v:0},{t:0.7,v:1},{t:0.7,v:-1},{t:1.5,v:1}]})];
  const result=new Set(codes(p));for(const code of ['bend.openString','bend.pointOrder','bend.pointTime','bend.pointValue'])assert.ok(result.has(code),code);
  p.arrangements[0].notes=[note('valid-bend',10,0,5,1,{bn:1,bnv:[{t:0,v:0},{t:1,v:1}]})];
  assert.deepEqual(findChartIssues(p),[]);
});

test('a bend point at the epsilon boundary is not flagged merely because of float64 subtraction noise',()=>{
  // Reproduces a real Rocksmith+ "Spark in the Dark" UGC Lead chart: the bend value's absolute
  // XML time minus the note's absolute XML time lands a few ULP past sustain+1ms, not because
  // the point is genuinely outside the sustain but because both are float64 subtractions of
  // large song-position values (~135s), which carries noise far smaller than the 1ms tolerance.
  const p=chart();p.arrangements[0].notes=[note('bend',135.771,0,11,0.884,{bend:1,bend_values:[{t:136.656-135.771,v:2}]})];
  assert.equal(issuesWith(p,'bend.pointTime').length,0);
});

test('slides retain zero destinations and distinguish disabled -1 from invalid values',()=>{
  const p=chart();p.arrangements[0].notes=[note('zero',1,0,0,0,{sl:0}),note('bad',2,1,5,1,{slide_to:25,slu:NaN}),note('off',3,2,3,0,{sl:-1})];
  assert.equal(issuesWith(p,'slide.destination').length,2);
  assert.deepEqual(issuesWith(p,'slide.stationary').map(x=>x.note),['zero']);
  assert.deepEqual(issuesWith(p,'slide.noSustain').map(x=>x.note),['zero']);
});

test('link-next must meet its next lane event; piano overlap follows pitch not packed string',()=>{
  const p=chart('keys');p.arrangements[0].notes=[{id:'a',time:0,pitch:60,sustain:2,techniques:{link_next:true}},{id:'b',time:1,pitch:60,sustain:0.5},{id:'c',time:1,pitch:61,sustain:0.5}];
  assert.equal(issuesWith(p,'sustain.overlap').length,1);
  assert.deepEqual(issuesWith(p,'link.disconnected').map(x=>x.note),['a']);
  p.arrangements[0].notes[0].sustain=1;assert.equal(issuesWith(p,'link.disconnected').length,0);
});

test('template shape/finger validity and physical warnings distinguish valid same-fret barre',()=>{
  const p=chart(),a=p.arrangements[0];a.chord_templates=[template()];assert.deepEqual(findChartIssues(p),[]);
  a.chord_templates=[template([3,5,0,-1,10,-1],[1,1,2,-1,5,-1])];
  const result=new Set(codes(p));for(const code of ['template.fingerConflict','template.unusedFinger','template.finger','template.stretch'])assert.ok(result.has(code),code);
  a.chord_templates[0].frets=[3];assert.ok(codes(p).includes('template.width'));
});

test('chord refs, member lanes/frets/times and handshape intervals are checked',()=>{
  const p=chart(),a=p.arrangements[0];a.chord_templates=[template()];
  a.chords=[{time:2,chord_id:0,notes:[note('x',2,0,5),note('y',2.5,0,3)]},{time:4,chord_id:9,notes:[]}];
  a.handshapes=[{start_time:3,end_time:2,chord_id:0},{start_time:19,end_time:21,chord_id:6}];
  const result=new Set(codes(p));for(const code of ['chord.template','chord.fretMismatch','chord.stringConflict','chord.memberTime','handshape.interval','handshape.template','handshape.afterSong'])assert.ok(result.has(code),code);
});

test('anchor ordering never changes chart and phrase start requires a colocated anchor',()=>{
  const p=chart(),a=p.arrangements[0];a.anchors=[{time:5,fret:9,width:4},{time:0,fret:1,width:4}];
  // D is an empty outro phrase: nothing to play, so no anchor is needed there.
  a.notes=[note('early',1,0,2),note('late',6,0,10),note('last',7.5,0,10)];a.phrases=[{id:'A',time:0},{id:'B',time:5},{id:'C',time:7},{id:'D',time:9}];
  const before=structuredClone(p);assert.equal(issuesWith(p,'note.anchor').length,0);
  assert.deepEqual(issuesWith(p,'phrase.anchor').map(x=>x.note),['C']);assert.deepEqual(p,before);
});

test('a slide with no length is an error for Rocksmith 2014 and a warning for FeedBack',()=>{
  const p=chart(),a=p.arrangements[0];a.anchors=[{time:0,fret:1,width:4}];a.notes=[note('s',1,0,3,0,{slide_to:5})];
  const find=target=>findChartIssues(p,{target}).filter(i=>i.code==='slide.noSustain').map(i=>i.severity);
  assert.deepEqual(find('cdlc'),['error']);assert.deepEqual(find('feedpak'),['warning']);
});

test('link-next tolerates millisecond rounding from chart XML',()=>{
  const p=chart(),a=p.arrangements[0];
  a.notes=[note('a',1,0,5,0.106,{link_next:true}),note('b',1.107,0,7,0.2),note('c',2,1,5,0.1,{link_next:true}),note('d',2.11,1,7)];
  assert.deepEqual(issuesWith(p,'link.disconnected').map(x=>x.note),['c']);
});

test('tones validate used names, slot allocation, missing/native definitions and stock count',()=>{
  const p=chart(),a=p.arrangements[0];a.tones={base:'A',slots:['A'],definitions:{A:nativeTone(),B:nativeTone()},changes:[{time:4,name:'B'},{time:4,name:'C'},{time:3,name:'D'},{time:6,name:'E'}]};
  const feed=new Set(codes(p));for(const code of ['tone.duplicateChange','tone.order','tone.unallocated','tone.definitionMissing'])assert.ok(feed.has(code),code);
  assert.ok(!feed.has('tone.stockLimit'));assert.ok(codes(p,'cdlc').includes('tone.stockLimit'));
  assert.ok(findChartIssues(p,'cdlc').filter(x=>x.code==='tone.definitionMissing').every(x=>x.severity==='error'));
});

test('difficulty ladders reject duplicate/max/reference errors and out-of-phrase content',()=>{
  const p=chart(),a=p.arrangements[0];a.phrases=[{id:'P',start_time:0,end_time:5,max_difficulty:2,levels:[{difficulty:0,notes:[note('outside',6)]},{difficulty:0,notes:[]}]}];
  a.phraseIterations=[{time:0,phraseId:8},{time:1,phraseId:0,difficulty:4}];
  const result=new Set(codes(p));for(const code of ['difficulty.duplicate','difficulty.maximum','difficulty.noteRange','difficulty.phraseReference','difficulty.levelReference'])assert.ok(result.has(code),code);
  a.phrases[0].levels=[{difficulty:0,notes:[note('inside',1)]},{difficulty:2,notes:[]}];
  a.phraseIterations=[{time:0,phraseId:'P',difficulty:2}];assert.deepEqual(findChartIssues(p),[]);
});

test('song duration and non-finite input produce actionable timing diagnostics',()=>{
  const p=chart();p.duration=5;p.arrangements[0].notes=[note('tail',4,0,3,2),note('past',6),note('nan',NaN),note('negative',-1),note('bad-tail',2,0,3,Infinity)];
  const result=new Set(codes(p));for(const code of ['sustain.afterSong','time.afterSong','time.invalid','sustain.invalid'])assert.ok(result.has(code),code);
  assert.ok(findChartIssues(p).every(x=>Number.isFinite(x.time)));
});

test('meter schema positivity is distinct from conventional export denominator restrictions',()=>{
  const p=chart();p.time_signatures=[{time:0,ts:[4,4]},{time:4,ts:[3,3]},{time:4,ts:[0,8]},{time:2,ts:[7,8]}];
  const result=new Set(codes(p));for(const code of ['meter.denominator','meter.invalid','meter.duplicate','meter.order'])assert.ok(result.has(code),code);
  assert.equal(issuesWith(p,'meter.denominator')[0].severity,'warning');
  assert.equal(findChartIssues(p,'xml').find(x=>x.code==='meter.denominator').severity,'error');
});

test('destination pitch stays authorable while stock export flags unsupported modes across chord voices',()=>{
  const p=chart(),a=p.arrangements[0];a.notes=[note('on',1,0,3,.5,{force_destination_pitch:1})];
  a.chord_templates=[template()];a.chords=[{time:3,chord_id:0,notes:[note('off',3,0,3,.5,{force_destination_pitch:2}),note('auto',3,1,3,.5,{force_destination_pitch:0})]}];
  assert.deepEqual(findChartIssues(p),[]);assert.equal(findChartIssues(p,'xml').filter(issue=>issue.code==='destinationPitch.unsupported').length,2);
  a.notes[0].techniques.force_destination_pitch=63;assert.ok(codes(p).includes('destinationPitch.invalid'));
});

test('wire-format aliases, null collections and malformed records are deterministic and do not throw',()=>{
  const p=chart(),a=p.arrangements[0];a.notes=[{id:'wire',t:1,s:0,f:3,sus:1,sl:99},null];a.chords=[null];a.anchors.push(null);a.phrases.push(null);a.handshapes.push(null);
  assert.doesNotThrow(()=>findChartIssues(p));assert.ok(codes(p).includes('slide.destination'));
  assert.deepEqual(validateProject(p),findChartIssues(p));assert.deepEqual(findChartIssues(p),findChartIssues(p));
  assert.equal(findChartIssues(null)[0].code,'project.invalid');assert.ok(codes({duration:0,arrangements:[]}).includes('arrangements.empty'));
});
