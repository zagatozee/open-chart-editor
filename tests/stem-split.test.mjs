import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeStemSplitResult} from '../src/stem-split.js';

function bytesOf(text){return new TextEncoder().encode(text);}

test('merges new stems into an empty pack, keyed by canonical id',()=>{
 const project={_pack:{manifest:{stems:[{id:'full',file:'stems/full.wav',default:true}]},entries:{'stems/full.wav':btoa('mix')}}};
 const result={stems:[{id:'drums',codec:'vorbis',bytes:bytesOf('drum-bytes')},{id:'bass',codec:'pcm',bytes:bytesOf('bass-bytes')}],
  stem_separation:{engine:'demucs',model:'htdemucs_6s',version:'1.0.0'}};
 mergeStemSplitResult(project,result);
 const stems=project._pack.manifest.stems;
 assert.deepEqual(stems.map(s=>s.id).sort(),['bass','drums','full']);
 const drums=stems.find(s=>s.id==='drums');
 assert.equal(drums.file,'stems/drums.ogg');assert.equal(drums.default,true);
 assert.equal(atob(project._pack.entries['stems/drums.ogg']),'drum-bytes');
 const bass=stems.find(s=>s.id==='bass');
 assert.equal(bass.file,'stems/bass.wav');
 assert.deepEqual(project._pack.manifest.stem_separation,result.stem_separation);
 // The pre-existing full mix is untouched.
 assert.equal(atob(project._pack.entries['stems/full.wav']),'mix');
});

test('a re-split overwrites a previously produced stem of the same id',()=>{
 const project={_pack:{manifest:{stems:[{id:'drums',file:'stems/drums.ogg',default:true}]},entries:{'stems/drums.ogg':btoa('old')}}};
 mergeStemSplitResult(project,{stems:[{id:'drums',codec:'vorbis',bytes:bytesOf('new')}],stem_separation:{engine:'remote',model:'bs_roformer_sw',version:'1.0.0'}});
 assert.equal(atob(project._pack.entries['stems/drums.ogg']),'new');
 assert.equal(project._pack.manifest.stems.length,1);
});

test('builds _pack from scratch when the project had none',()=>{
 const project={};
 mergeStemSplitResult(project,{stems:[{id:'vocals',codec:'vorbis',bytes:bytesOf('v')}],stem_separation:{engine:'demucs',model:'htdemucs_6s',version:'1.0.0'}});
 assert.equal(project._pack.manifest.stems[0].id,'vocals');
 assert.equal(atob(project._pack.entries['stems/vocals.ogg']),'v');
});
