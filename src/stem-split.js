// Stem splitting: OCE ships no separation engine. This sends the project's
// full mix to a separation-server URL the user supplies (e.g. a
// feedBack-demucs-server instance, run however they like — standalone,
// Docker, or managed by FeedBack's own Stem Splitter plugin) and merges the
// returned stems into the project. OCE never installs or downloads a model;
// it only ever calls an address the user configured.
import {fullMixStem,fullMixBytes} from './spectrum-stems.js';

const PREFIX='/api/plugins/open_chart_editor';

function base64ToBytes(encoded){
 const raw=atob(encoded),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return bytes;
}
function bytesToBase64(bytes){
 let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
 return btoa(binary);
}

// Sends the project's full mix to the backend and runs separation. Returns
// {stems:[{id,codec,bytes}], stem_separation:{engine,model,version}} — raw
// bytes, not base64 (decoded here so callers never touch the wire format).
export async function requestStemSplit(project,{serverUrl,model=''}={}){
 if(!serverUrl)throw Error('Enter a split server URL first');
 const stem=fullMixStem(project);
 if(!stem)throw Error('This project has no audio to split');
 const bytes=fullMixBytes(project),filename=stem.file.split('/').pop()||'mix.wav';
 const body=new FormData();
 body.append('file',new Blob([bytes]),filename);
 body.append('server_url',serverUrl);
 if(model)body.append('model',model);
 const response=await fetch(PREFIX+'/stems/split',{method:'POST',body});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(data&&data.detail||'Stem splitting failed');
 return {
  stem_separation:data.stem_separation,
  stems:(data.stems||[]).map(s=>({id:s.id,codec:s.codec,bytes:base64ToBytes(s.bytes_base64)})),
 };
}

const CODEC_EXT={vorbis:'ogg',pcm:'wav',flac:'flac',mp3:'mp3',aac:'m4a'};

// Pure: merges a requestStemSplit() result into a project, as a `change()`
// callback body (`change('Split stems', p=>mergeStemSplitResult(p,result))`).
// New stems become `default:true`; any stem the split produced that already
// existed is overwritten (a deliberate re-split), everything else is left
// untouched - same as the original plugin's merge semantics, minus the
// selective-replace picker (OCE always re-splits everything at once).
export function mergeStemSplitResult(project,result){
 const pack=project._pack||(project._pack={manifest:{},entries:{}});
 const manifest=pack.manifest||(pack.manifest={});
 const entries=pack.entries||(pack.entries={});
 const existing=Array.isArray(manifest.stems)?manifest.stems:[];
 const byId=new Map(existing.map(stem=>[String(stem&&stem.id||''),stem]));
 for(const stem of result.stems){
  const ext=CODEC_EXT[stem.codec]||'bin',file=`stems/${stem.id}.${ext}`;
  entries[file]=bytesToBase64(stem.bytes);
  byId.set(stem.id,{id:stem.id,file,default:true,codec:stem.codec});
 }
 manifest.stems=[...byId.values()];
 manifest.stem_separation=result.stem_separation;
 return project;
}
