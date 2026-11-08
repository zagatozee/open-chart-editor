// Original passive stereo meters. Each channel has its own analyser so phase-
// opposed stereo cannot cancel in a mono downmix. No tap feeds audible output.
const silence=()=>({peak:0,rms:0,peakDb:-Infinity,rmsDb:-Infinity});
const db=value=>value>0?20*Math.log10(value):-Infinity;
export class SignalMeters{
 constructor(){this.channels=new Map();}
 attach(name,node,context){
  if(this.channels.get(name)?.source===node)return;
  this.detach(name);
  if(!node||!context||typeof context.createAnalyser!=='function')return;
  const splitter=context.createChannelSplitter(2),analysers=[0,1].map(()=>{const analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;return analyser;});
  // Up-mix in the tap so a mono bus input (oscillators, mono drums, a mono mic) reads on both sides.
  const upmix=context.createGain();upmix.channelCount=2;upmix.channelCountMode='explicit';upmix.channelInterpretation='speakers';
  node.connect(upmix);upmix.connect(splitter);analysers.forEach((analyser,index)=>splitter.connect(analyser,index));
  this.channels.set(name,{source:node,upmix,splitter,analysers,buffers:analysers.map(analyser=>new Float32Array(analyser.fftSize)),clippedUntil:0});
 }
 read(name,now=performance.now()){
  const tap=this.channels.get(name);if(!tap)return {left:silence(),right:silence(),clipped:false};
  const channels=tap.analysers.map((analyser,index)=>{const values=tap.buffers[index];analyser.getFloatTimeDomainData(values);let peak=0,power=0;for(const value of values){if(!Number.isFinite(value))continue;peak=Math.max(peak,Math.abs(value));power+=value*value;}const rms=Math.sqrt(power/values.length);return {peak,rms,peakDb:db(peak),rmsDb:db(rms)};});
  if(channels.some(channel=>channel.peak>=1))tap.clippedUntil=now+1000;
  return {left:channels[0],right:channels[1],clipped:now<tap.clippedUntil};
 }
 detach(name){const tap=this.channels.get(name);if(!tap)return;try{tap.source.disconnect(tap.upmix);}catch{}try{tap.upmix.disconnect();}catch{}try{tap.splitter.disconnect();}catch{}for(const analyser of tap.analysers)try{analyser.disconnect();}catch{}this.channels.delete(name);}
 dispose(){for(const name of this.channels.keys())this.detach(name);}
}
export function signalDbText(value){return Number.isFinite(value)?`${value.toFixed(1)} dBFS`:'−∞ dBFS';}
