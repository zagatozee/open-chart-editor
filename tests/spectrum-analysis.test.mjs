import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSpectrum} from '../src/spectrum-analysis.js';

test('spectrum analysis locates stable low and high notes and reports progress',async()=>{
 const sampleRate=48000,samples=new Float32Array(sampleRate*3),progress=[];
 for(let i=0;i<samples.length;i++)samples[i]=.6*Math.sin(2*Math.PI*82.4069*i/sampleRate)+.35*Math.sin(2*Math.PI*440*i/sampleRate);
 const result=await analyzeSpectrum(samples,sampleRate,{onProgress:value=>progress.push(value)});
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi],frame=Math.ceil(result.lowFftSize/2/result.hopSize)+2;
 assert.ok(value(frame,40)>210,`MIDI 40 energy ${value(frame,40)}`);
 assert.ok(value(frame,69)>210,`MIDI 69 energy ${value(frame,69)}`);
 assert.ok(value(frame,65)<value(frame,69),'Unrelated semitone must not dominate the 440 Hz peak');
 assert.equal(result.frameCount,Math.ceil(samples.length/result.hopSize));
 assert.equal(progress.at(-1),1);
});
test('spectrum analysis resolves adjacent low semitones that a single-window pass would blur together',async()=>{
 const sampleRate=48000,samples=new Float32Array(sampleRate*3);
 for(let i=0;i<samples.length;i++)samples[i]=.6*Math.sin(2*Math.PI*41.2034*i/sampleRate); // E1, MIDI 28 — well below the default crossover
 const result=await analyzeSpectrum(samples,sampleRate);
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi],frame=Math.ceil(result.lowFftSize/2/result.hopSize)+2;
 assert.ok(value(frame,28)>150,`MIDI 28 (E1) energy ${value(frame,28)}`);
 assert.ok(value(frame,27)<value(frame,28)-40,`The adjacent semitone (D#1) should not blur into E1's bin, got ${value(frame,27)} vs ${value(frame,28)}`);
 assert.ok(value(frame,29)<value(frame,28)-40,`The adjacent semitone (F1) should not blur into E1's bin, got ${value(frame,29)} vs ${value(frame,28)}`);
});

test('spectrum analysis holds a sustained low note through a louder, briefer transient sharing its band',async()=>{
 // A held bass note (E1) plus periodic louder bursts of a different low pitch (A1), standing in for a
 // kick drum sharing the bass register. Each burst is short enough to raise only the frame(s) centred on
 // it; without hysteresis those frames' adaptive floor jumps and can blank the held note out entirely.
 const sampleRate=48000,duration=3,samples=new Float32Array(sampleRate*duration);
 for(let i=0;i<samples.length;i++){
  const t=i/sampleRate;
  let value=.3*Math.sin(2*Math.PI*41.2034*i/sampleRate); // held E1 (MIDI 28)
  if((t%.4)<.15)value+=2*Math.sin(2*Math.PI*55*i/sampleRate); // loud ~150ms A1 burst every 400ms
  samples[i]=value;
 }
 const result=await analyzeSpectrum(samples,sampleRate);
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi];
 const warmup=Math.ceil(result.lowFftSize/2/result.hopSize)+2,endFrame=result.frameCount-10;
 let gaps=0;
 for(let frame=warmup;frame<endFrame;frame++)if(value(frame,28)===0)gaps++;
 assert.equal(gaps,0,`The held E1 note should not flicker out between frames ${warmup} and ${endFrame}; found ${gaps} blanked frame(s)`);
});

test('spectrum analysis finds a bass note whose fundamental is weak but whose 2nd harmonic is strong',async()=>{
 // Real bass recordings frequently carry most of a note's audible energy in its 2nd/3rd harmonic
 // rather than its true fundamental (amp/pickup response, mix EQ) — the "missing fundamental" effect.
 // Found by analyzing the actual official "Play With Me" bass audio: its open Ab1 string (MIDI 32) had
 // its fundamental present in only ~6% of frames while its octave-up 2nd harmonic (Ab2, MIDI 44) was
 // present in ~81%. This reproduces that imbalance synthetically.
 const sampleRate=48000,samples=new Float32Array(sampleRate*3),ab1=440*2**((32-69)/12);
 for(let i=0;i<samples.length;i++)samples[i]=.03*Math.sin(2*Math.PI*ab1*i/sampleRate)+.5*Math.sin(2*Math.PI*ab1*2*i/sampleRate);
 const result=await analyzeSpectrum(samples,sampleRate);
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi],frame=Math.ceil(result.lowFftSize/2/result.hopSize)+2;
 assert.ok(value(frame,32)>100,`MIDI 32 (Ab1) should be detected via its harmonic even though its fundamental is weak, got ${value(frame,32)}`);
});

test('spectrum analysis does not echo a real note onto the rows below it via harmonic matching',async()=>{
 // Checking a pitch's own 2nd/3rd harmonic to find missing-fundamental notes (previous test) has an
 // unavoidable flip side: pitch P's 2nd harmonic bin IS pitch P+12's fundamental bin, and its 3rd
 // harmonic bin lands near P+19's — so a single real, strong note can make the rows 12 and ~19
 // semitones below it falsely light up too, unless that's specifically guarded against.
 const sampleRate=48000,samples=new Float32Array(sampleRate*3),ab2=440*2**((44-69)/12);
 for(let i=0;i<samples.length;i++)samples[i]=.5*Math.sin(2*Math.PI*ab2*i/sampleRate); // only Ab2 — nothing below it
 const result=await analyzeSpectrum(samples,sampleRate);
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi],frame=Math.ceil(result.lowFftSize/2/result.hopSize)+2;
 assert.ok(value(frame,44)>200,`MIDI 44 (Ab2, the real note) should be clearly detected, got ${value(frame,44)}`);
 assert.equal(value(frame,32),0,'MIDI 32 (12 semitones below, nothing really there) should not falsely light up');
 assert.equal(value(frame,25),0,'MIDI 25 (19 semitones below, nothing really there) should not falsely light up');
});

test('spectrum analysis can suppress a real octave/19-semitone echo when explicitly asked to focus on one instrument',async()=>{
 // A genuinely real acoustic harmonic (e.g. a distorted bass's loud 2nd harmonic) is not a detection
 // bug and isn't touched by the suppression above — but a charter focused on one instrument's part may
 // still want it hidden as noise. suppressOctaveEcho opts into that: fold a row down whenever a note 12
 // or 19 semitones below it is independently present, regardless of how strong this row's own signal is.
 const sampleRate=48000,samples=new Float32Array(sampleRate*3),ab1=440*2**((32-69)/12);
 for(let i=0;i<samples.length;i++)samples[i]=.3*Math.sin(2*Math.PI*ab1*i/sampleRate)+.5*Math.sin(2*Math.PI*ab1*2*i/sampleRate); // real Ab1 plus a genuinely strong 2nd harmonic
 const plain=await analyzeSpectrum(samples,sampleRate);
 const suppressed=await analyzeSpectrum(samples,sampleRate,{suppressOctaveEcho:true});
 const value=(result,frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi],frame=Math.ceil(plain.lowFftSize/2/plain.hopSize)+2;
 assert.ok(value(plain,frame,44)>0,'Sanity check: without suppression the real octave content should be visible');
 assert.ok(value(suppressed,frame,32)>0,'The fundamental note itself should still be detected with suppression on');
 assert.equal(value(suppressed,frame,44),0,'The octave-above row should be folded away with suppression on, even though it is genuinely strong');
});

test('spectrum analysis maps silence to the floor and rejects invalid PCM',async()=>{
 const silence=await analyzeSpectrum(new Float32Array(8192),48000,{fftSize:4096,hopSize:2048,minMidi:60,maxMidi:60});
 assert.ok(silence.values.every(value=>value===0));
 await assert.rejects(analyzeSpectrum([],48000),/decoded mono audio/);
 await assert.rejects(analyzeSpectrum(new Float32Array(4),7000),/valid sample rate/);
});

test('spectrum analysis suppresses broadband noise relative to clear pitched energy',async()=>{
 const sampleRate=48000,samples=new Float32Array(sampleRate*3);
 let state=0x5eed1234;
 for(let i=0;i<samples.length;i++){state=(1664525*state+1013904223)>>>0;samples[i]=.55*Math.sin(2*Math.PI*440*i/sampleRate)+.025*((state/0x80000000)-1);}
 const result=await analyzeSpectrum(samples,sampleRate);
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi];
 const frame=Math.ceil(result.lowFftSize/2/result.hopSize)+2;assert.ok(value(frame,69)>180,`A4 should remain prominent, got ${value(frame,69)}`);
 const visiblePitches=Array.from({length:result.maxMidi-result.minMidi+1},(_,index)=>value(frame,index+result.minMidi)).filter(energy=>energy>48).length;
 assert.ok(visiblePitches<24,`Noise should not fill the pitch map, but ${visiblePitches} pitches were prominent`);
});
