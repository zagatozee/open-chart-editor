import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {folderSelection,droppedFolderSelection,decodeFolderTree,writeFolderTree} from '../src/folder-files.js';
const entry=(path,text)=>{const data=Buffer.from(text);return{path,size:data.length,sha256:createHash('sha256').update(data).digest('hex'),base64:data.toString('base64')};};
// Minimal fakes for the FileSystemEntry tree a DataTransferItem.webkitGetAsEntry() hands back,
// shaped just enough for droppedFolderSelection's own walk (readEntries in a loop, file() by
// callback) - no real DOM or filesystem involved.
const fakeFile=(name,size=1)=>({isFile:true,isDirectory:false,name,file:resolve=>resolve({name,size})});
const fakeDir=(name,children)=>({isFile:false,isDirectory:true,name,createReader(){let done=false;return{readEntries(resolve){if(done){resolve([]);return;}done=true;resolve(children);}};}});
const dropped=(...entries)=>({items:entries.map(e=>({kind:'file',webkitGetAsEntry:()=>e}))});
const tree=()=>({version:1,entries:[entry('manifest.yaml','own manifest'),entry('audio/own.wav','own audio\0')]});
test('folder selection retains one root and relative names with bounded bytes',()=>{
 const own=(name,size=1)=>({webkitRelativePath:name,size});
 assert.deepEqual(folderSelection([own('Own/manifest.yaml'),own('Own/audio/full.wav')]).entries.map(e=>e.path),['manifest.yaml','audio/full.wav']);
 for(const files of [[own('Own/a'),own('Other/b')],[own('Own/A'),own('Own/a')],[own('Own/../x')],[own('Own/a',256*1024*1024+1)]])assert.throws(()=>folderSelection(files));
});
test('a dropped folder builds the same path shape as the input picker, through nested subfolders',async()=>{
 const tree=fakeDir('Own',[fakeFile('manifest.yaml'),fakeDir('audio',[fakeFile('full.wav')])]);
 assert.deepEqual((await droppedFolderSelection(dropped(tree))).entries.map(e=>e.path),['manifest.yaml','audio/full.wav']);
});
test('a drop is refused unless it is exactly one directory',async()=>{
 await assert.rejects(droppedFolderSelection(dropped(fakeFile('a.txt'))));
 await assert.rejects(droppedFolderSelection(dropped(fakeDir('Own',[]),fakeDir('Other',[]))));
 await assert.rejects(droppedFolderSelection(dropped()));
});
test('a dropped folder with no files is refused',async()=>{
 await assert.rejects(droppedFolderSelection(dropped(fakeDir('Own',[]))));
});
test('a dropped EOF project folder skips its own accumulated junk the same way the input picker does',async()=>{
 const tree=fakeDir('Song',[fakeFile('notes.eof'),fakeFile('guitar.wav'),fakeFile('notes.backup.eof.bak')]);
 assert.deepEqual((await droppedFolderSelection(dropped(tree))).entries.map(e=>e.path),['notes.eof','guitar.wav']);
});
test('dropped folder entries are still bounded by the same size and unsafe-name checks',async()=>{
 await assert.rejects(droppedFolderSelection(dropped(fakeDir('Own',[fakeFile('big.wav',256*1024*1024+1)]))));
 await assert.rejects(droppedFolderSelection(dropped(fakeDir('Own',[fakeDir('..',[fakeFile('a')])]))));
 const many=Array.from({length:4097},(_,i)=>fakeFile('f'+i));
 await assert.rejects(droppedFolderSelection(dropped(fakeDir('Own',many))));
});
test('an EOF project folder (has notes.eof) skips its own accumulated backup/export junk; a non-EOF folder does not',()=>{
 const own=(name,size=1)=>({webkitRelativePath:name,size});
 const eofFiles=[own('Song/notes.eof'),own('Song/guitar.wav'),own('Song/notes.backup.eof.bak'),own('Song/guitar.ogg.backup'),own('Song/guitar.ogg.lastsaved'),own('Song/old.psarc')];
 assert.deepEqual(folderSelection(eofFiles).entries.map(e=>e.path),['notes.eof','guitar.wav']);
 const plainFiles=[own('Song/manifest.yaml'),own('Song/audio.wem.backup')];
 assert.deepEqual(folderSelection(plainFiles).entries.map(e=>e.path),['manifest.yaml','audio.wem.backup']);
});
test('a Charter project folder (has a root *.rscp file) skips its own backups/ subtree; a non-Charter folder does not',()=>{
 const own=(name,size=1)=>({webkitRelativePath:name,size});
 const charterFiles=[own('Song/project.rscp'),own('Song/guitar.ogg'),own('Song/backups/2024-01-01_12-00-00/project.rscp'),own('Song/backups/2024-01-01_12-00-00/guitar.ogg')];
 assert.deepEqual(folderSelection(charterFiles).entries.map(e=>e.path),['project.rscp','guitar.ogg']);
 const plainFiles=[own('Song/manifest.yaml'),own('Song/backups/not-really-a-backup.wav')];
 assert.deepEqual(folderSelection(plainFiles).entries.map(e=>e.path),['manifest.yaml','backups/not-really-a-backup.wav']);
});
test('all paths, sizes and checksums are checked before any directory writes',async()=>{
 for(const modify of [t=>t.entries[1].sha256='0'.repeat(64),t=>t.entries[1].path='../own.wav',t=>t.entries.push(entry('MANIFEST.yaml','other')),t=>t.entries.push(entry('audio','collision')),t=>t.entries.push(entry('Audio/other.wav','collision')),t=>t.entries[1].size++]){
  const payload=tree();modify(payload);let writes=0;const parent={getDirectoryHandle(){writes++;throw Error('Unexpected write');}};
  await assert.rejects(writeFolderTree(new Response(JSON.stringify(payload)),parent));assert.equal(writes,0);
 }
 const decoded=await decodeFolderTree(tree());assert.equal(Buffer.from(decoded[1].bytes).toString(),'own audio\0');
});
test('stale export cannot write and successful export uses a new child without replacing prior files',async()=>{
 let writes=0;const store=new Map(),directory=path=>({name:path,async getDirectoryHandle(name,{create}={}){const next=path+'/'+name;if(!create){const e=Error('missing');e.name='NotFoundError';throw e;}writes++;return directory(next);},async getFileHandle(name){return{async createWritable(){return{async write(bytes){store.set(path+'/'+name,Buffer.from(bytes));},async close(){}};}};}}),parent=directory('chosen');
 await assert.rejects(writeFolderTree(new Response(JSON.stringify(tree())),parent,{isCurrent:()=>false}));assert.equal(writes,0);
 const payload=tree();payload.manifest={warnings:['Unsupported charts retained in master']};const result=await writeFolderTree(new Response(JSON.stringify(payload)),parent,{name:'Own song',suffix:'.feedpak',crypto:webcrypto});
 assert.match(result.destination,/^chosen \/ Own song-.*\.feedpak$/);assert.equal(store.size,2);assert.equal([...store.values()][0].toString(),'own manifest');assert.equal(result.recentId,null);assert.deepEqual(result.warnings,['Unsupported charts retained in master']);
});
