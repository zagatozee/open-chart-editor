import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSpectrum} from '../src/spectrum-analysis.js';

test('spectrum analysis locates stable low and high notes and reports progress',async()=>{
 const sampleRate=48000,samples=new Float32Array(sampleRate),progress=[];
 for(let i=0;i<samples.length;i++)samples[i]=.6*Math.sin(2*Math.PI*82.4069*i/sampleRate)+.35*Math.sin(2*Math.PI*440*i/sampleRate);
 const result=await analyzeSpectrum(samples,sampleRate,{onProgress:value=>progress.push(value)});
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi];
 assert.ok(value(5,40)>210,`MIDI 40 energy ${value(5,40)}`);
 assert.ok(value(5,69)>210,`MIDI 69 energy ${value(5,69)}`);
 assert.ok(value(5,65)<value(5,69),'Unrelated semitone must not dominate the 440 Hz peak');
 assert.equal(result.frameCount,Math.ceil(samples.length/result.hopSize));
 assert.equal(progress.at(-1),1);
});

test('spectrum analysis maps silence to the floor and rejects invalid PCM',async()=>{
 const silence=await analyzeSpectrum(new Float32Array(8192),48000,{fftSize:4096,hopSize:2048,minMidi:60,maxMidi:60});
 assert.ok(silence.values.every(value=>value===0));
 await assert.rejects(analyzeSpectrum([],48000),/decoded mono audio/);
 await assert.rejects(analyzeSpectrum(new Float32Array(4),7000),/valid sample rate/);
});

test('spectrum analysis suppresses broadband noise relative to clear pitched energy',async()=>{
 const sampleRate=48000,samples=new Float32Array(sampleRate);
 let state=0x5eed1234;
 for(let i=0;i<samples.length;i++){state=(1664525*state+1013904223)>>>0;samples[i]=.55*Math.sin(2*Math.PI*440*i/sampleRate)+.025*((state/0x80000000)-1);}
 const result=await analyzeSpectrum(samples,sampleRate);
 const value=(frame,pitch)=>result.values[frame*(result.maxMidi-result.minMidi+1)+pitch-result.minMidi];
 const frame=5;assert.ok(value(frame,69)>180,`A4 should remain prominent, got ${value(frame,69)}`);
 const visiblePitches=Array.from({length:result.maxMidi-result.minMidi+1},(_,index)=>value(frame,index+result.minMidi)).filter(energy=>energy>48).length;
 assert.ok(visiblePitches<24,`Noise should not fill the pitch map, but ${visiblePitches} pitches were prominent`);
});
