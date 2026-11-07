// Original mixer meter ballistics and fader curve: sample-peak zones at -20 and -9 dBFS, a
// 23.53 dB/s fall-back, a 20 s peak hold, a ~300 ms average line and a log fader.
// Constants are exported so they can be tuned by ear.
export const MIN_DB=-60,WARN_DB=-20,ERR_DB=-9,INPUT_FLOOR_DB=-50;
export const DECAY_DB_S=23.53,HOLD_S=20,INTEGRATION_S=.3,INPUT_HOLD_S=1,CLIP_S=1;
const level=db=>Number.isFinite(db)?Math.max(MIN_DB,Math.min(0,db)):db>0?0:MIN_DB;
export const meterState=()=>({peak:MIN_DB,hold:MIN_DB,holdAt:0,rms:MIN_DB,input:MIN_DB,inputAt:0,clipUntil:0});
// One display step per channel per frame. sample dB values may be -Infinity; dt and now are seconds.
export function meterStep(state,{peakDb,rmsDb,inputDb}={},dt,now){
 const p=level(peakDb),r=level(rmsDb),s={...state};
 s.peak=p>=s.peak?p:Math.max(p,s.peak-DECAY_DB_S*dt);
 if(p>=s.hold||now-s.holdAt>HOLD_S){s.hold=p;s.holdAt=now;}
 s.rms+=(r-s.rms)*(1-Math.exp(-dt*.99/INTEGRATION_S)); // ~300 ms time constant, independent of frame rate
 if(inputDb!==undefined){const i=level(inputDb);if(i>=s.input||now-s.inputAt>INPUT_HOLD_S){s.input=i;s.inputAt=now;}}
 if(peakDb>=0)s.clipUntil=now+CLIP_S;
 return s;
}
export function levelZone(db){return db>=0?'clip':db>=ERR_DB?'err':db>=WARN_DB?'warn':'ok';}
// Logarithmic fader travel: 0..1 position, -96 dB below the top at the bottom (shown as -inf).
const OFFSET=6,RANGE=96,SPAN=Math.log10(RANGE+OFFSET)-Math.log10(OFFSET);
export const faderTopDb=bus=>bus==='master'?0:20*Math.log10(2);
export function faderPosition(gain,topDb=0){
 if(!(gain>0))return 0;const d=20*Math.log10(gain)-topDb;
 return d>=0?1:d<=-RANGE?0:(Math.log10(RANGE+OFFSET)-Math.log10(OFFSET-d))/SPAN;
}
export function faderGain(position,topDb=0){
 if(!(position>0))return 0;if(position>=1)return 10**(topDb/20);
 return 10**((OFFSET-(RANGE+OFFSET)*((RANGE+OFFSET)/OFFSET)**-position+topDb)/20);
}
export function gainDbText(gain){
 if(!(gain>0))return '-inf dB';const db=20*Math.log10(gain),text=Math.abs(db)<.05?'0.0':db.toFixed(1);
 return `${db>=.05?'+':''}${text} dB`;
}
