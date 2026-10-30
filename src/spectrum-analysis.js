import {Fourier} from './spectral-fft.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const frequencyForMidi=pitch=>440*2**((pitch-69)/12);

export async function analyzeSpectrum(samples,sampleRate,{fftSize=8192,hopSize=4096,minMidi=24,maxMidi=108,onProgress=()=>{},shouldCancel=()=>false}={}){
 if(!(samples instanceof Float32Array)||samples.length<1||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Spectrum analysis needs decoded mono audio and a valid sample rate');
 if(!Number.isInteger(fftSize)||fftSize<512||fftSize>16384||(fftSize&(fftSize-1))||!Number.isInteger(hopSize)||hopSize<32||hopSize>fftSize)throw Error('Invalid spectrum window settings');
 if(!Number.isInteger(minMidi)||!Number.isInteger(maxMidi)||minMidi<0||maxMidi>127||minMidi>maxMidi)throw Error('Invalid spectrum pitch range');
 const fft=new Fourier(fftSize),real=new Float64Array(fftSize),imag=new Float64Array(fftSize),window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(fftSize-1))),windowSum=window.reduce((sum,value)=>sum+value,0),half=fftSize/2,frameCount=Math.max(1,Math.ceil(samples.length/hopSize)),pitchCount=maxMidi-minMidi+1,values=new Uint8Array(frameCount*pitchCount);
 const bands=Array.from({length:pitchCount},(_,index)=>{
  const frequency=frequencyForMidi(minMidi+index),low=frequency*2**(-1/24),high=frequency*2**(1/24),first=Math.max(1,Math.ceil(low*fftSize/sampleRate)),last=Math.min(half,Math.floor(high*fftSize/sampleRate));
  return first<=last?[first,last]:[Math.max(1,Math.min(half,Math.round(frequency*fftSize/sampleRate))),Math.max(1,Math.min(half,Math.round(frequency*fftSize/sampleRate)))];
 });
 for(let frame=0;frame<frameCount;frame++){
  if(shouldCancel())throw Error('Spectrum analysis cancelled');
  const center=frame*hopSize;
  for(let i=0;i<fftSize;i++){const source=center+i-half;real[i]=(source>=0&&source<samples.length?samples[source]:0)*window[i];imag[i]=0;}
  fft.transform(real,imag);
  for(let pitch=0;pitch<pitchCount;pitch++){
   const [first,last]=bands[pitch];let magnitude=0;
   for(let bin=first;bin<=last;bin++)magnitude=Math.max(magnitude,Math.hypot(real[bin],imag[bin]));
   const amplitude=magnitude*2/windowSum,decibels=20*Math.log10(Math.max(amplitude,1e-8));
   values[frame*pitchCount+pitch]=Math.round(clamp((decibels+72)/60,0,1)*255);
  }
  if((frame&15)===15||frame===frameCount-1){onProgress((frame+1)/frameCount);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 return {sampleRate,fftSize,hopSize,frameCount,minMidi,maxMidi,values};
}
