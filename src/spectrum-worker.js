import {analyzeSpectrum} from './spectrum-analysis.js';
let activeJob=null;
self.onmessage=({data})=>{
 if(data.type==='cancel'){activeJob=null;return;}
 if(data.type!=='analyze')return;
 const {id,samples,sampleRate}=data;activeJob=id;
 analyzeSpectrum(samples,sampleRate,{onProgress:progress=>{if(activeJob===id)self.postMessage({type:'progress',id,progress});},shouldCancel:()=>activeJob!==id})
  .then(result=>{if(activeJob===id){activeJob=null;self.postMessage({type:'result',id,result},[result.values.buffer]);}})
  .catch(error=>{if(activeJob===id){activeJob=null;self.postMessage({type:'error',id,message:error.message||String(error)});}});
};
