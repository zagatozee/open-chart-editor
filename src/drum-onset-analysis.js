import {Fourier} from './spectral-fft.js';

/**
 * Fixed frequency bands tuned to drum voices (spec 5.3 of the feature request,
 * issue #16), not a pitch grid - a drum hit is a transient/broadband event, not
 * a sustained tone. Snare combines its low-frequency body with its high-
 * frequency snap; the detector takes whichever sub-range is loudest per frame.
 */
export const DRUM_BANDS=Object.freeze([
 Object.freeze({id:'kick',label:'Kick',ranges:[[40,120]]}),
 Object.freeze({id:'snare',label:'Snare',ranges:[[150,250],[2000,5000]]}),
 Object.freeze({id:'hats',label:'Hats / cymbals',ranges:[[5000,20000]]}),
 Object.freeze({id:'toms',label:'Toms',ranges:[[80,300]]}),
]);

const PIECE_BAND={kick:'kick',snare:'snare',snare_xstick:'snare',hh_closed:'hats',hh_open:'hats',hh_pedal:'hats',crash_l:'hats',crash_r:'hats',ride:'hats',ride_bell:'hats',splash:'hats',china:'hats',stack:'hats',bell:'hats',tom_low:'toms',tom_mid:'toms',tom_hi:'toms',tom_floor:'toms'};
/** Maps a canonical drum piece ID (model.js DRUMS) to the band lane it overlays against. Unknown/custom IDs return null. */
export const bandForPiece=piece=>PIECE_BAND[piece]??null;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function binsFor(ranges,fftSize,sampleRate){
 const half=fftSize/2,nyquist=sampleRate/2,bins=[];
 for(const [lowHz,highHz] of ranges){
  const low=Math.max(1,Math.ceil(Math.min(lowHz,nyquist)*fftSize/sampleRate)),high=Math.min(half,Math.floor(Math.min(highHz,nyquist)*fftSize/sampleRate));
  if(low<=high)bins.push([low,high]);
 }
 return bins;
}

/**
 * Onset detection (spectral flux + adaptive peak-picking) and per-band energy
 * envelopes for drum charting. A short FFT favors time resolution over
 * frequency resolution - the opposite trade-off from analyzeSpectrum's pitch
 * grid, since exactly when a hit lands matters far more here than exactly
 * which Hz it peaks at.
 */
export async function analyzeDrumOnsets(samples,sampleRate,{fftSize=2048,hopSize=512,onsetMultiplier=1.6,minOnsetGapMs=60,onProgress=()=>{},shouldCancel=()=>false}={}){
 if(!(samples instanceof Float32Array)||samples.length<1||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Drum onset analysis needs decoded mono audio and a valid sample rate');
 if(!Number.isInteger(fftSize)||fftSize<256||fftSize>16384||(fftSize&(fftSize-1)))throw Error('Invalid drum onset FFT size');
 if(!Number.isInteger(hopSize)||hopSize<32||hopSize>fftSize)throw Error('Invalid drum onset hop size');
 const fft=new Fourier(fftSize),real=new Float64Array(fftSize),imag=new Float64Array(fftSize),half=fftSize/2;
 const window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(fftSize-1))),windowSum=window.reduce((sum,value)=>sum+value,0);
 const frameCount=Math.max(1,Math.ceil(samples.length/hopSize));
 const bands=DRUM_BANDS.map(band=>({id:band.id,label:band.label,bins:binsFor(band.ranges,fftSize,sampleRate),energy:new Uint8Array(frameCount),flux:new Float32Array(frameCount),prevMag:null}));
 for(let frame=0;frame<frameCount;frame++){
  if(shouldCancel())throw Error('Drum onset analysis cancelled');
  const center=frame*hopSize;
  for(let i=0;i<fftSize;i++){const source=center+i-half;real[i]=(source>=0&&source<samples.length?samples[source]:0)*window[i];imag[i]=0;}
  fft.transform(real,imag);
  const magnitude=new Float64Array(half+1);
  for(let bin=0;bin<=half;bin++)magnitude[bin]=Math.hypot(real[bin],imag[bin]);
  for(const band of bands){
   let peak=0,flux=0;
   for(const [first,last] of band.bins)for(let bin=first;bin<=last;bin++){
    peak=Math.max(peak,magnitude[bin]);
    if(band.prevMag)flux+=Math.max(0,magnitude[bin]-band.prevMag[bin]);
   }
   const db=20*Math.log10(Math.max(peak*2/windowSum,1e-8));
   band.energy[frame]=Math.round(clamp((db+70)/70,0,1)*255);
   band.flux[frame]=flux;
   band.prevMag=magnitude;
  }
  if((frame&31)===31||frame===frameCount-1){onProgress((frame+1)/frameCount*.85);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 const onsets=[],minOnsetGapFrames=Math.max(1,Math.round(minOnsetGapMs/1000*sampleRate/hopSize));
 for(const [bandIndex,band] of bands.entries()){
  const flux=band.flux,windowFrames=Math.max(4,Math.round(sampleRate/hopSize));
  let lastOnset=-Infinity;
  for(let frame=0;frame<frameCount;frame++){
   if(shouldCancel())throw Error('Drum onset analysis cancelled');
   const start=Math.max(0,frame-windowFrames),end=Math.min(frameCount,frame+windowFrames+1);
   let sum=0,sumSq=0;for(let i=start;i<end;i++){sum+=flux[i];sumSq+=flux[i]*flux[i];}
   const count=end-start,mean=sum/count,variance=Math.max(0,sumSq/count-mean*mean),threshold=mean+onsetMultiplier*Math.sqrt(variance);
   const isPeak=flux[frame]>0&&flux[frame]>threshold&&flux[frame]>=(flux[frame-1]??0)&&flux[frame]>=(flux[frame+1]??0);
   if(isPeak&&frame-lastOnset>=minOnsetGapFrames){onsets.push({time:frame*hopSize/sampleRate,bandId:band.id,strength:clamp(flux[frame]/(threshold||1)/3,0,1)});lastOnset=frame;}
   if((frame&63)===63){onProgress(.85+.15*(bandIndex+frame/frameCount)/bands.length);await new Promise(resolve=>setTimeout(resolve,0));}
  }
 }
 onsets.sort((a,b)=>a.time-b.time);
 onProgress(1);
 return {sampleRate,fftSize,hopSize,frameCount,bands:bands.map(({id,label,energy})=>({id,label,energy})),onsets};
}
