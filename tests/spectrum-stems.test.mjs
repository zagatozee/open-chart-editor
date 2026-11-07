import test from 'node:test';
import assert from 'node:assert/strict';
import {spectrumStems,stemBytes,fullMixStem,fullMixBytes} from '../src/spectrum-stems.js';

const project={_pack:{manifest:{stems:[
 {id:'full',file:'stems/full.ogg',default:true},
 {id:'bass',file:'stems/bass.ogg',name:'Bass DI',description:'Direct input'},
 {id:'drums',file:'stems/drums.ogg'},
 {id:'gone',file:'stems/gone.ogg'},
 {id:'',file:'stems/blank.ogg'},
 {id:'nofile'},
 null,
]},entries:{'stems/bass.ogg':btoa('\x00\xffOggS'),'stems/drums.ogg':btoa('x')}}};

test('lists every usable stem except the full mix, by name then id',()=>{
 assert.deepEqual(spectrumStems(project).map(stem=>[stem.id,stem.label,stem.description]),[['bass','Bass DI','Direct input'],['drums','drums',''],['gone','gone','']]);
});
test('a project without a stem list offers none',()=>{
 for(const value of [undefined,{},{_pack:{}},{_pack:{manifest:{stems:'bass'}}}])assert.deepEqual(spectrumStems(value),[]);
});
test('reads a stem file as exact bytes',()=>{
 assert.deepEqual([...stemBytes(project,'bass')],[0,255,79,103,103,83]);
});
test('refuses a stem whose file is missing, or an id that is not offered',()=>{
 for(const id of ['gone','full','nope'])assert.throws(()=>stemBytes(project,id),/not in this project/);
});
test('finds the full/default stem, which spectrumStems() leaves out',()=>{
 assert.equal(fullMixStem(project).id,'full');
 assert.deepEqual([...fullMixBytes({_pack:{manifest:{stems:[{id:'full',file:'a'}]},entries:{a:btoa('hi')}}})],[...Buffer.from('hi')]);
});
test('falls back to the first stem with a file when none is marked default/full',()=>{
 const noDefault={_pack:{manifest:{stems:[{id:'bass',file:'b'},{id:'drums',file:'d'}]},entries:{b:btoa('x')}}};
 assert.equal(fullMixStem(noDefault).id,'bass');
});
test('refuses fullMixBytes on a project with no audio at all',()=>{
 assert.throws(()=>fullMixBytes({_pack:{manifest:{stems:[]},entries:{}}}),/no audio to split/);
});
