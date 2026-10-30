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
