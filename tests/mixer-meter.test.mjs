import test from 'node:test';
import assert from 'node:assert/strict';
import {meterState,meterStep,levelZone,faderPosition,faderGain,faderTopDb,gainDbText,MIN_DB,DECAY_DB_S,HOLD_S,CLIP_S,INPUT_HOLD_S} from '../src/mixer-meter.js';
const near=(a,b,eps=.01)=>assert.ok(Math.abs(a-b)<eps,`${a} versus ${b}`);

test('peak attacks instantly and falls back at the decay rate',()=>{
 let s=meterStep(meterState(),{peakDb:-6,rmsDb:-12},1/60,1);near(s.peak,-6);
 s=meterStep(s,{peakDb:-Infinity,rmsDb:-Infinity},.5,1.5);near(s.peak,-6-DECAY_DB_S*.5);
 for(let t=1.5;t<5;t+=.1)s=meterStep(s,{peakDb:-Infinity},.1,t);assert.equal(s.peak,MIN_DB);
});

test('peak hold keeps the highest peak for the hold time, then drops to the current peak',()=>{
 let s=meterStep(meterState(),{peakDb:-3},0,10);s=meterStep(s,{peakDb:-30},1,11);assert.equal(s.hold,-3);
 s=meterStep(s,{peakDb:-30},1,10+HOLD_S-.1);assert.equal(s.hold,-3);
 s=meterStep(s,{peakDb:-30},1,10+HOLD_S+.1);assert.equal(s.hold,-30);
 s=meterStep(s,{peakDb:-10},0,10+HOLD_S+.2);assert.equal(s.hold,-10);
});

test('the average line follows with a ~300 ms time constant, whatever the frame rate',()=>{
 const run=fps=>{let s=meterState();for(let i=0;i<.3*fps;i++)s=meterStep(s,{rmsDb:-20},1/fps,i/fps);return s.rms;};
 assert.ok(run(60)>-36&&run(60)<-33,String(run(60)));near(run(60),run(144),.3);
 let s=meterState();for(let i=0;i<90;i++)s=meterStep(s,{rmsDb:-20},1/60,i/60);near(s.rms,-20,.5);
});

test('clipping holds for the clip window, from the output or the input',()=>{
 const s=meterStep(meterState(),{peakDb:.2},0,3);assert.equal(s.clipUntil,3+CLIP_S);assert.equal(s.peak,0);
 assert.equal(meterStep(meterState(),{peakDb:-40,inputDb:1},0,3).clipUntil,3+CLIP_S);
 assert.equal(meterStep(meterState(),{peakDb:-1},0,3).clipUntil,0);
});

test('the input indicator holds for its own, shorter time',()=>{
 let s=meterStep(meterState(),{inputDb:-8},0,1);s=meterStep(s,{inputDb:-40},.1,1+INPUT_HOLD_S-.1);assert.equal(s.input,-8);
 s=meterStep(s,{inputDb:-40},.1,1+INPUT_HOLD_S+.1);assert.equal(s.input,-40);
 assert.equal(meterStep(meterState(),{peakDb:-8},0,1).input,MIN_DB);
});

test('level zones follow the -20 and -9 dB marks',()=>{
 assert.deepEqual([-40,-20.1,-20,-9.1,-9,-.1,0,2].map(levelZone),['ok','ok','warn','warn','err','err','clip','clip']);
});

test('the fader curve is logarithmic and round-trips',()=>{
 near(faderPosition(10**(-6/20)),.755,.002);near(faderPosition(10**(-20/20)),.4825,.002);near(faderPosition(10**(-60/20)),.154,.002);
 assert.equal(faderPosition(1,0),1);assert.equal(faderPosition(0),0);assert.equal(faderGain(0),0);
 const top=faderTopDb('song');near(faderGain(1,top),2,1e-9);near(faderPosition(1,top),.755,.002);assert.equal(faderTopDb('master'),0);
 for(const gain of [.001,.05,.3,.7,1,1.5,2])near(faderGain(faderPosition(gain,top),top),gain,1e-6);
 for(let p=.001;p<1;p+=.05)near(faderPosition(faderGain(p,top),top),p,1e-6);
});

test('gain readouts are in dB',()=>{
 assert.deepEqual([0,1,.9999,2,10**(-3.2/20),.5].map(gainDbText),['-inf dB','0.0 dB','0.0 dB','+6.0 dB','-3.2 dB','-6.0 dB']);
});
