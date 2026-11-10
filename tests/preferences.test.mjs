import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreferences,writePreferences} from '../src/preferences.js';

function memoryStorage(initial={}){
 const values=new Map(Object.entries(initial));
 return {
  getItem(key){return values.get(key)??null;},
  setItem(key,value){values.set(key,String(value));}
 };
}

test('live monitor choices are validated and retained as browser preferences',()=>{
 const storage=memoryStorage();
 const liveMonitor={deviceId:'input-1',engine:'at5-vst3',tier:'se',frameCount:256};
 assert.equal(writePreferences({liveMonitor},storage),true);
 assert.deepEqual(readPreferences(storage).liveMonitor,liveMonitor);
});

test('invalid live monitor preferences fall back to safe defaults',()=>{
 const storage=memoryStorage({'oce.preferences.v1':JSON.stringify({
  liveMonitor:{deviceId:{},engine:'missing',tier:'invalid',frameCount:128}
 })});
 assert.deepEqual(readPreferences(storage).liveMonitor,{
  deviceId:'',engine:'software',tier:'max',frameCount:1024
 });
});

test('the floating mixer panel position and state round-trip, with safe fallbacks',()=>{
 const storage=memoryStorage();
 assert.equal(writePreferences({mixerPanel:{floating:false,open:true,x:120,y:48}},storage),true);
 assert.deepEqual(readPreferences(storage).mixerPanel,{floating:false,open:true,x:120,y:48});
 const bad=memoryStorage({'oce.preferences.v1':JSON.stringify({mixerPanel:{floating:'no',open:'yes',x:'left',y:-5}})});
 assert.deepEqual(readPreferences(bad).mixerPanel,{floating:true,open:false,x:null,y:0});
 assert.equal(readPreferences(memoryStorage({'oce.preferences.v1':'{}'})).mixerPanel,undefined);
 assert.equal(readPreferences(memoryStorage({'oce.preferences.v1':JSON.stringify({mixerPanel:[1]})})).mixerPanel,undefined);
});

test('the folder-browser panel state, quick search and advanced filter round-trip across a reload',()=>{
 const storage=memoryStorage();
 const folderBrowserFilter={type:'group',mode:'all',id:'g1',children:[{type:'format',op:'is',value:'eof',id:'c1'}]};
 assert.equal(writePreferences({folderBrowserVisible:true,folderBrowserWidth:320,folderBrowserHumstrum:false,folderBrowserQuery:'cradle',folderBrowserFilter},storage),true);
 const read=readPreferences(storage);
 assert.equal(read.folderBrowserVisible,true);
 assert.equal(read.folderBrowserWidth,320);
 assert.equal(read.folderBrowserHumstrum,false);
 assert.equal(read.folderBrowserQuery,'cradle');
 assert.deepEqual(read.folderBrowserFilter,folderBrowserFilter);
});

test('folder-browser preferences fall back to safe defaults when absent or malformed',()=>{
 const empty=readPreferences(memoryStorage({'oce.preferences.v1':'{}'}));
 assert.equal(empty.folderBrowserVisible,false);
 assert.equal(empty.folderBrowserWidth,260);
 assert.equal(empty.folderBrowserHumstrum,true);
 assert.equal(empty.folderBrowserQuery,'');
 assert.equal(empty.folderBrowserFilter,undefined);
 const bad=readPreferences(memoryStorage({'oce.preferences.v1':JSON.stringify({folderBrowserQuery:123,folderBrowserFilter:{type:'not-a-group'}})}));
 assert.equal(bad.folderBrowserQuery,'');
 assert.equal(bad.folderBrowserFilter,undefined);
});
