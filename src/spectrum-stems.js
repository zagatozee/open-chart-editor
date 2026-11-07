// The stems a FeedPak's manifest lists (spec 5.3), for the Spectrum view to analyze.
// `full` is left out: it loads as the backing track, and imported audio replaces it on save.
export function spectrumStems(project){
 const stems=project?._pack?.manifest?.stems;if(!Array.isArray(stems))return[];
 return stems.filter(stem=>stem&&typeof stem.id==='string'&&stem.id&&stem.id!=='full'&&typeof stem.file==='string')
  .map(stem=>({id:stem.id,label:String(stem.name||stem.id),description:String(stem.description||''),file:stem.file}));
}
export function stemBytes(project,id){
 const stem=spectrumStems(project).find(item=>item.id===id),encoded=stem&&project._pack.entries?.[stem.file];
 if(typeof encoded!=='string')throw Error('its file is not in this project');
 const raw=atob(encoded),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return bytes;
}
// Decoding needs no sound output, so it stays clear of the playback AudioContext.
export async function decodeStem(project,id,sampleRate=44100){
 return new OfflineAudioContext(1,1,sampleRate).decodeAudioData(stemBytes(project,id).buffer);
}
