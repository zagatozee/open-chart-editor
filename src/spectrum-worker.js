import {analyzeSpectrum} from './spectrum-analysis.js';
import {analyzeDrumOnsets} from './drum-onset-analysis.js';
let activeJob=null;
self.onmessage=({data})=>{
 if(data.type==='cancel'){activeJob=null;return;}
 if(data.type==='analyze'){
  const {id,samples,sampleRate,useBassHarmonics,suppressOctaveEcho}=data;activeJob=id;
  analyzeSpectrum(samples,sampleRate,{useBassHarmonics,suppressOctaveEcho,onProgress:progress=>{if(activeJob===id)self.postMessage({type:'progress',id,progress});},shouldCancel:()=>activeJob!==id})
   .then(result=>{if(activeJob===id){activeJob=null;self.postMessage({type:'result',id,result},[result.values.buffer]);}})
   .catch(error=>{if(activeJob===id){activeJob=null;self.postMessage({type:'error',id,message:error.message||String(error)});}});
  return;
 }
 if(data.type==='analyzeDrums'){
  const {id,samples,sampleRate}=data;activeJob=id;
  analyzeDrumOnsets(samples,sampleRate,{onProgress:progress=>{if(activeJob===id)self.postMessage({type:'progress',id,progress});},shouldCancel:()=>activeJob!==id})
   .then(result=>{if(activeJob===id){activeJob=null;self.postMessage({type:'result',id,result},result.bands.map(band=>band.energy.buffer));}})
   .catch(error=>{if(activeJob===id){activeJob=null;self.postMessage({type:'error',id,message:error.message||String(error)});}});
 }
};
