import {Fourier} from './spectral-fft.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const frequencyForMidi=pitch=>440*2**((pitch-69)/12);

export async function analyzeSpectrum(samples,sampleRate,{fftSize=16384,hopSize=4096,minMidi=24,maxMidi=108,onProgress=()=>{},shouldCancel=()=>false}={}){
 if(!(samples instanceof Float32Array)||samples.length<1||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Spectrum analysis needs decoded mono audio and a valid sample rate');
 if(!Number.isInteger(fftSize)||fftSize<512||fftSize>16384||(fftSize&(fftSize-1))||!Number.isInteger(hopSize)||hopSize<32||hopSize>fftSize)throw Error('Invalid spectrum window settings');
 if(!Number.isInteger(minMidi)||!Number.isInteger(maxMidi)||minMidi<0||maxMidi>127||minMidi>maxMidi)throw Error('Invalid spectrum pitch range');
 const fft=new Fourier(fftSize),real=new Float64Array(fftSize),imag=new Float64Array(fftSize),window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(fftSize-1))),windowSum=window.reduce((sum,value)=>sum+value,0),half=fftSize/2,frameCount=Math.max(1,Math.ceil(samples.length/hopSize)),pitchCount=maxMidi-minMidi+1,values=new Uint8Array(frameCount*pitchCount),frameDb=new Float32Array(pitchCount);
 const bands=Array.from({length:pitchCount},(_,index)=>{
  const frequency=frequencyForMidi(minMidi+index),low=frequency*2**(-1/24),high=frequency*2**(1/24),first=Math.max(1,Math.ceil(low*fftSize/sampleRate)),last=Math.min(half,Math.floor(high*fftSize/sampleRate));
  return first<=last?[first,last]:[Math.max(1,Math.min(half,Math.round(frequency*fftSize/sampleRate))),Math.max(1,Math.min(half,Math.round(frequency*fftSize/sampleRate)))];
 });
 for(let frame=0;frame<frameCount;frame++){
  if(shouldCancel())throw Error('Spectrum analysis cancelled');
  const center=frame*hopSize;
  for(let i=0;i<fftSize;i++){const source=center+i-half;real[i]=(source>=0&&source<samples.length?samples[source]:0)*window[i];imag[i]=0;}
  fft.transform(real,imag);
  let peakDb=-Infinity;
  for(let pitch=0;pitch<pitchCount;pitch++){
   const [first,last]=bands[pitch];let magnitude=0;
   for(let bin=first;bin<=last;bin++)magnitude=Math.max(magnitude,Math.hypot(real[bin],imag[bin]));
   const amplitude=magnitude*2/windowSum;frameDb[pitch]=20*Math.log10(Math.max(amplitude,1e-8));peakDb=Math.max(peakDb,frameDb[pitch]);
  }
  const floorDb=Math.max(-78,peakDb-38);
  for(let pitch=0;pitch<pitchCount;pitch++){
   const neighbours=[];for(let distance=1;distance<=2;distance++){if(pitch-distance>=0)neighbours.push(frameDb[pitch-distance]);if(pitch+distance<pitchCount)neighbours.push(frameDb[pitch+distance]);}
   neighbours.sort((a,b)=>a-b);const localFloor=neighbours[Math.floor(neighbours.length/2)]??floorDb,prominence=frameDb[pitch]-localFloor;
   if(frameDb[pitch]<floorDb||prominence<6.5){values[frame*pitchCount+pitch]=0;continue;}
   const contrast=clamp((prominence-5)/3,0,1);
   values[frame*pitchCount+pitch]=Math.round(clamp((frameDb[pitch]-floorDb)/38,0,1)*contrast*255);
  }
  if((frame&15)===15||frame===frameCount-1){onProgress((frame+1)/frameCount);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 return {sampleRate,fftSize,hopSize,frameCount,minMidi,maxMidi,values};
}
