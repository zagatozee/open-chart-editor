import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeDrumOnsets,DRUM_BANDS,bandForPiece} from '../src/drum-onset-analysis.js';

function synthesizeKit(sampleRate,duration){
 const samples=new Float32Array(sampleRate*duration);
 let state=0x1234abcd;
 const noise=()=>{state=(1664525*state+1013904223)>>>0;return (state/0x80000000)-1;};
 const burst=(time,freq,amp,noiseAmp=0)=>{
  const start=Math.round(time*sampleRate),length=Math.round(.12*sampleRate);
  for(let i=0;i<length&&start+i<samples.length;i++){
   const env=Math.exp(-i/(sampleRate*.02));
   let value=freq?Math.sin(2*Math.PI*freq*(start+i)/sampleRate)*amp:0;
   if(noiseAmp)value+=noise()*noiseAmp;
   samples[start+i]+=env*value;
  }
 };
 burst(.5,60,1.2); // kick: 40-120Hz band
 burst(1.2,200,.4,.5); // snare: body tone in its 150-250Hz band + broadband snap noise
 burst(1.9,0,0,.9); // hats/cymbals: broadband noise only, no tone
 burst(2.6,260,.9); // toms: above the kick and snare-body ranges, inside 80-300Hz
 return samples;
}

test('drum onset analysis finds kick, snare, hats and toms onsets at the right times and bands',async()=>{
 const sampleRate=44100,samples=synthesizeKit(sampleRate,4),progress=[];
 const result=await analyzeDrumOnsets(samples,sampleRate,{onProgress:value=>progress.push(value)});
 assert.equal(result.bands.length,DRUM_BANDS.length);
 for(const band of result.bands)assert.equal(band.energy.length,result.frameCount);
 const nearest=(time,bandId)=>result.onsets.filter(o=>o.bandId===bandId).reduce((best,o)=>Math.abs(o.time-time)<Math.abs((best?.time??Infinity)-time)?o:best,null);
 for(const [time,bandId] of [[.5,'kick'],[1.2,'snare'],[1.9,'hats'],[2.6,'toms']]){
  const onset=nearest(time,bandId);
  assert.ok(onset&&Math.abs(onset.time-time)<.05,`Expected a ${bandId} onset near ${time}s, got ${JSON.stringify(onset)}`);
 }
 assert.equal(progress.at(-1),1);
});

test('drum onset analysis maps silence to no onsets and rejects invalid PCM',async()=>{
 const result=await analyzeDrumOnsets(new Float32Array(44100),44100);
 assert.equal(result.onsets.length,0);
 await assert.rejects(analyzeDrumOnsets([],44100),/decoded mono audio/);
 await assert.rejects(analyzeDrumOnsets(new Float32Array(4),7000),/valid sample rate/);
});

test('bandForPiece maps canonical drum pieces to their onset-detection lane',()=>{
 assert.equal(bandForPiece('kick'),'kick');
 assert.equal(bandForPiece('snare_xstick'),'snare');
 assert.equal(bandForPiece('hh_open'),'hats');
 assert.equal(bandForPiece('tom_floor'),'toms');
 assert.equal(bandForPiece('some_custom_piece'),null);
});
