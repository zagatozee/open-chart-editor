import {Fourier} from './spectral-fft.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const frequencyForMidi=pitch=>440*2**((pitch-69)/12);

async function analyzeBand(samples,sampleRate,{fftSize,hopSize,minMidi,maxMidi,onBandProgress,shouldCancel,useHarmonics=false,suppressOctaveEcho=false,onsetDb=6.5,sustainDb=3,contrastFloor=3,contrastRange=4}){
 const fft=new Fourier(fftSize),real=new Float64Array(fftSize),imag=new Float64Array(fftSize),window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(fftSize-1))),windowSum=window.reduce((sum,value)=>sum+value,0),half=fftSize/2,frameCount=Math.max(1,Math.ceil(samples.length/hopSize)),pitchCount=maxMidi-minMidi+1,values=new Uint8Array(frameCount*pitchCount),frameDb=new Float32Array(pitchCount),held=new Uint8Array(pitchCount);
 const bandsFor=multiple=>Array.from({length:pitchCount},(_,index)=>{
  const frequency=frequencyForMidi(minMidi+index)*multiple,low=frequency*2**(-1/24),high=frequency*2**(1/24),first=Math.max(1,Math.ceil(low*fftSize/sampleRate)),last=Math.min(half,Math.floor(high*fftSize/sampleRate));
  return first<=last?[first,last]:[Math.max(1,Math.min(half,Math.round(frequency*fftSize/sampleRate))),Math.max(1,Math.min(half,Math.round(frequency*fftSize/sampleRate)))];
 });
 // A plucked/picked bass note's fundamental is often weaker than its 2nd or 3rd harmonic, especially
 // on recordings (amp/pickup response, mix EQ) — the classic "missing fundamental" effect human pitch
 // perception already compensates for. For the low band, also look at a pitch's own harmonics and take
 // whichever is strongest as evidence the note is sounding, rather than only its exact fundamental bin.
 //
 // That alone creates a false-positive mirror of every real note: checking pitch P's 2nd harmonic bin
 // lands exactly on pitch P+12's fundamental, and its 3rd harmonic bin lands near P+19's — so any real,
 // strong note makes the rows 12 and ~19 semitones below it also light up too. The fix can't compare a
 // row against the row(s) above it to tell "weak fundamental, real note" apart from "pure echo of the
 // note above" — those look identical from a single row's own reading. Instead: only trust the harmonic
 // boost where the row's own fundamental clears the frame's overall noise floor at all (estimated from
 // fundamentals alone, before any boosting) — a genuinely missing-fundamental note still leaves *some*
 // real signal at its fundamental bin, where a pure harmonic echo of a different note generally doesn't.
 const bands=bandsFor(1),harmonicBands=useHarmonics?[bandsFor(2),bandsFor(3)]:[],fundamentalDb=new Float32Array(pitchCount);
 for(let frame=0;frame<frameCount;frame++){
  if(shouldCancel())throw Error('Spectrum analysis cancelled');
  const center=frame*hopSize;
  for(let i=0;i<fftSize;i++){const source=center+i-half;real[i]=(source>=0&&source<samples.length?samples[source]:0)*window[i];imag[i]=0;}
  fft.transform(real,imag);
  let fundamentalPeakDb=-Infinity;
  for(let pitch=0;pitch<pitchCount;pitch++){
   const [first,last]=bands[pitch];let magnitude=0;
   for(let bin=first;bin<=last;bin++)magnitude=Math.max(magnitude,Math.hypot(real[bin],imag[bin]));
   fundamentalDb[pitch]=20*Math.log10(Math.max(magnitude*2/windowSum,1e-8));fundamentalPeakDb=Math.max(fundamentalPeakDb,fundamentalDb[pitch]);
  }
  const fundamentalFloorDb=Math.max(-78,fundamentalPeakDb-38);
  let peakDb=-Infinity;
  for(let pitch=0;pitch<pitchCount;pitch++){
   let db=fundamentalDb[pitch];
   if(fundamentalDb[pitch]>=fundamentalFloorDb){
    let magnitude=0;
    for(const set of harmonicBands){const [first,last]=set[pitch];for(let bin=first;bin<=last;bin++)magnitude=Math.max(magnitude,Math.hypot(real[bin],imag[bin]));}
    db=Math.max(db,20*Math.log10(Math.max(magnitude*2/windowSum,1e-8)));
   }
   // Octave/19-semitone-above content is frequently a real acoustic harmonic of a lower note rather than
   // a separate note in its own right (common for a distorted/overdriven bass, whose 2nd harmonic can be
   // louder than its fundamental) — not a detection artifact, genuinely present signal. When a charter is
   // focused on one instrument's part, that's still noise worth hiding: if a note 12 or 19 semitones below
   // this row clears the floor at all, treat this row as explained by it and suppress it outright.
   if(suppressOctaveEcho&&(pitch-12>=0&&fundamentalDb[pitch-12]>=fundamentalFloorDb||pitch-19>=0&&fundamentalDb[pitch-19]>=fundamentalFloorDb))db=-200;
   frameDb[pitch]=db;peakDb=Math.max(peakDb,db);
  }
  const floorDb=Math.max(-78,peakDb-38);
  for(let pitch=0;pitch<pitchCount;pitch++){
   const neighbours=[];for(let distance=1;distance<=2;distance++){if(pitch-distance>=0)neighbours.push(frameDb[pitch-distance]);if(pitch+distance<pitchCount)neighbours.push(frameDb[pitch+distance]);}
   neighbours.sort((a,b)=>a-b);const localFloor=neighbours[Math.floor(neighbours.length/2)]??floorDb,prominence=frameDb[pitch]-localFloor;
   // Hysteresis: a pitch that was already sounding needs a lower bar to keep showing than a fresh
   // onset needs to appear. Without this, a single louder frame nearby (a kick drum sharing a bass
   // note's register, say) can transiently lift the local floor enough to blank out an otherwise
   // continuously-held note for one frame, flickering instead of holding steady.
   const wasHeld=held[pitch]===1,onset=prominence>=onsetDb,sustain=wasHeld&&prominence>=sustainDb,isOn=frameDb[pitch]>=floorDb&&(onset||sustain);
   held[pitch]=isOn?1:0;
   if(!isOn){values[frame*pitchCount+pitch]=0;continue;}
   const contrast=clamp((prominence-contrastFloor)/contrastRange,0,1);
   values[frame*pitchCount+pitch]=Math.round(clamp((frameDb[pitch]-floorDb)/38,0,1)*contrast*255);
  }
  if((frame&15)===15||frame===frameCount-1){onBandProgress((frame+1)/frameCount);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 return {frameCount,pitchCount,values};
}

/**
 * Two-band analysis: a wide low-frequency window (coarser in time, far finer in
 * frequency) covers everything at and below `crossoverMidi`, so adjacent low
 * semitones on heavily down-tuned basses (5-string drop tunings and below)
 * resolve into separate FFT bins instead of collapsing together. A narrower
 * high-frequency window keeps fine time resolution for everything above it.
 * The two are merged onto the high band's (finer) time grid.
 */
export async function analyzeSpectrum(samples,sampleRate,{fftSize=16384,hopSize=1024,minMidi=24,maxMidi=108,lowFftSize=65536,lowHopSize=4096,crossoverMidi=45,useBassHarmonics=true,suppressOctaveEcho=false,onProgress=()=>{},shouldCancel=()=>false}={}){
 if(!(samples instanceof Float32Array)||samples.length<1||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('Spectrum analysis needs decoded mono audio and a valid sample rate');
 if(!Number.isInteger(fftSize)||fftSize<512||fftSize>131072||(fftSize&(fftSize-1))||!Number.isInteger(hopSize)||hopSize<32||hopSize>fftSize)throw Error('Invalid spectrum window settings');
 if(!Number.isInteger(lowFftSize)||lowFftSize<512||lowFftSize>131072||(lowFftSize&(lowFftSize-1))||!Number.isInteger(lowHopSize)||lowHopSize<32||lowHopSize>lowFftSize)throw Error('Invalid low-band spectrum window settings');
 if(!Number.isInteger(minMidi)||!Number.isInteger(maxMidi)||minMidi<0||maxMidi>127||minMidi>maxMidi)throw Error('Invalid spectrum pitch range');
 if(!Number.isInteger(crossoverMidi))throw Error('Invalid spectrum crossover pitch');
 const crossover=Math.max(minMidi,Math.min(maxMidi+1,crossoverMidi)),hasLow=crossover>minMidi,hasHigh=crossover<=maxMidi,pitchCount=maxMidi-minMidi+1;
 const costOf=(size,hop)=>Math.ceil(samples.length/hop)*size*Math.log2(size),lowCost=hasLow?costOf(lowFftSize,lowHopSize):0,highCost=hasHigh?costOf(fftSize,hopSize):0,lowShare=lowCost+highCost>0?lowCost/(lowCost+highCost):0;
 // The low band's real-world content (bass guitar especially) is often a broad, harmonically dense
 // spectral shelf rather than a sharp peak, so it needs a lower prominence bar than the high band to
 // register as "a pitch is sounding here" without that bar also going so low it just shows noise.
 const low=hasLow?await analyzeBand(samples,sampleRate,{fftSize:lowFftSize,hopSize:lowHopSize,minMidi,maxMidi:crossover-1,shouldCancel,useHarmonics:useBassHarmonics,suppressOctaveEcho,onsetDb:4,sustainDb:2,contrastFloor:1,contrastRange:3,onBandProgress:p=>onProgress(p*lowShare)}):null;
 const high=hasHigh?await analyzeBand(samples,sampleRate,{fftSize,hopSize,minMidi:crossover,maxMidi,shouldCancel,onBandProgress:p=>onProgress(lowShare+p*(1-lowShare))}):null;
 const frameCount=high?high.frameCount:Math.max(1,Math.ceil(samples.length/lowHopSize)),values=new Uint8Array(frameCount*pitchCount);
 for(let frame=0;frame<frameCount;frame++){
  const centerSample=frame*(high?hopSize:lowHopSize);
  if(high)for(let p=crossover;p<=maxMidi;p++)values[frame*pitchCount+(p-minMidi)]=high.values[frame*high.pitchCount+(p-crossover)];
  if(low){
   const lowFrame=Math.max(0,Math.min(low.frameCount-1,Math.round(centerSample/lowHopSize)));
   for(let p=minMidi;p<crossover;p++)values[frame*pitchCount+(p-minMidi)]=low.values[lowFrame*low.pitchCount+(p-minMidi)];
  }
 }
 onProgress(1);
 return {sampleRate,fftSize,hopSize,lowFftSize,lowHopSize,crossoverMidi:crossover,frameCount,minMidi,maxMidi,values};
}
