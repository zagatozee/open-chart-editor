import {guideHarmonics} from './guide-voice.js';
import {SpectralPreview} from './spectral-preview.js';
import {GrainAligner} from './grain-align.js';
import {drumSamples,drumGain,drumFades,drumPiece} from './drum-guide.js';
// Original local Web Audio transport. Granular audition, never game audio code.
import { notePitch } from './model.js';
import {PointIndex,IntervalIndex} from './viewport.js';
import {guideNotes,guideDuration,guidePlan,guideTables} from './guide-synthesis.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const midiFrequency = (midi,cents=0) => 440 * 2 ** ((midi - 69) / 12+cents/1200);
// Unsampleable or malformed tuning is silent, never an overflowing AudioParam.
// The actual rendering context sets the upper bound; MIDI identity stays integer.
export function guideFrequency(midi,cents=0,sampleRate=48000){
 if(!Number.isFinite(midi)||!Number.isFinite(cents)||!Number.isFinite(sampleRate)||sampleRate<=0)return 0;
 const frequency=midiFrequency(midi,cents);
 return Number.isFinite(frequency)&&frequency>0&&Number.isFinite(Math.fround(frequency))&&Math.fround(frequency)>0&&frequency<sampleRate/2?frequency:0;
}
export function speedAtTime(elapsed, speed = 1, ramp = null) {
  if (!ramp?.enabled) return speed;
  const t = clamp(elapsed / Math.max(0.01, ramp.duration), 0, 1);
  return ramp.startSpeed + (ramp.endSpeed - ramp.startSpeed) * t;
}
export function distanceAtTime(elapsed, speed = 1, ramp = null) {
  elapsed = Math.max(0, elapsed);
  if (!ramp?.enabled) return elapsed * speed;
  const duration = Math.max(0.01, ramp.duration), t = Math.min(elapsed, duration);
  return ramp.startSpeed * t + (ramp.endSpeed - ramp.startSpeed) * t * t / (2 * duration)
    + Math.max(0, elapsed - duration) * ramp.endSpeed;
}
export function advanceTransport(position, distance, loop = null, duration = Infinity) {
  let time = position + distance;
  if (loop?.enabled && loop.end > loop.start && time >= loop.end) {
    time = loop.start + ((time - loop.start) % (loop.end - loop.start));
  }
  return clamp(time, 0, duration);
}
// Pure reference sampler used by tests and offline diagnostics.
export function granularSample(samples, position) {
  if (position < 0 || position >= samples.length) return 0;
  const i = Math.floor(position), f = position - i;
  return samples[i] * (1 - f) + (samples[i + 1] ?? samples[i]) * f;
}

export function waveformPeaks(buffer, count = 4096) {
  count = Math.max(1, Math.min(4096, Math.floor(count) || 4096, buffer.length));
  const peaks = new Float32Array(count);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let bin = 0; bin < count; bin++) {
      const end = Math.floor((bin + 1) * samples.length / count);
      for (let frame = Math.floor(bin * samples.length / count); frame < end; frame++) {
        peaks[bin] = Math.max(peaks[bin], Math.abs(samples[frame]));
      }
    }
  }
  return peaks;
}

// Original PCM16 encoder. Exporting this buffer does not retime chart events.
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels, frames = buffer.length, dataBytes = frames * channels * 2;
  if (!(channels >= 1 && channels <= 32) || dataBytes > 0xffffffff - 36) throw Error('Audio exceeds PCM WAV size limits');
  const output = new ArrayBuffer(44 + dataBytes), view = new DataView(output);
  const writeText = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeText(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeText(8, 'WAVE'); writeText(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, dataBytes, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const value = clamp(samples[channel][frame], -1, 1);
    view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return output;
}

export const SONG_EQ_FREQUENCIES = Object.freeze([100, 400, 1000, 4000, 10000]);
// Original listening presets, not presets from the R+ Workshop.
export const SONG_EQ_PRESETS = Object.freeze({flat:[0,0,0,0,0],bass:[6,3,-3,-6,-6],lead:[-6,-3,3,5,0],air:[-3,-2,0,3,5]});
export function channelMatrix(mode='stereo') {
  if(mode==='left')return [1,0,1,0];
  if(mode==='right')return [0,1,0,1];
  if(mode==='center-cancel')return [.5,-.5,.5,-.5];
  if(mode==='stereo')return [1,0,0,1];
  throw Error('Unknown song channel mode');
}

export class AudioEngine {
  constructor({ onTime = () => {}, onEnded = () => {}, onQualityStatus = () => {}, context = null } = {}) {
    this.context = context; this.onTime = onTime; this.onEnded = onEnded;this.onQualityStatus=onQualityStatus;this.quality='fast';this.effectiveQuality='fast';this.preparing=false;this.spectral=null;
    this.buffer = null; this.peaks = null; this.project = null; this.arrangement = null;
    this.position = 0; this.speed = 1; this.pitch = 0; this.playing = false;
    this.loop = { start: 0, end: 4, enabled: false };
    this.ramp = { enabled: false, startSpeed: 0.5, endSpeed: 1, duration: 30 };
    this.gains = { master: 0.8, song: 1, guide: 0.25, metronome: 0.25, live:0.5 };
    this.mutes = { master:false, song:false, guide:false, metronome:false, live:false };
    this.solos = { song:false, guide:false, metronome:false, live:false };
    this.enabled = { master:true, song:true, guide:true, metronome:false, live:true };
    this.pans = {master:0,song:0,guide:0,metronome:0,live:0};
    this.songFX = {bypass:false,channel:'stereo',eq:[0,0,0,0,0]};
    this.disposers = new Set();
    this.nodes = new Set(); this.timer = null; this.generation = 0; this.decodeGeneration = 0;
    this.grainAligner=new GrainAligner();
    this.window = Float32Array.from({ length: 128 }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / 127)));
  }
  async init(resume = true) {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw Error('Web Audio is unavailable in this browser');
      this.context = new Context();
    }
    if (!this.buses) {
      // Each bus is a unity input (where sources connect, metered before the fader) feeding its fader.
      this.buses = {};this.faders = {};
      for (const name of Object.keys(this.gains)) {
        this.buses[name] = this.context.createGain();
        const fader = this.context.createGain(); fader.gain.value = this.getEffectiveGain(name); this.faders[name] = fader; this.buses[name].connect(fader);
      }
      this.panners = {};
      for(const name of Object.keys(this.gains)) {
        const pan=this.context.createStereoPanner();pan.pan.value=this.pans[name];this.panners[name]=pan;
        this.faders[name].connect(pan);pan.connect(name==='master'?this.context.destination:this.buses.master);
      }
      const songInput=this.context.createGain();songInput.channelCount=2;songInput.channelCountMode='explicit';songInput.channelInterpretation='speakers';
      const input=this.context.createChannelSplitter(2),output=this.context.createChannelMerger(2);songInput.connect(input);
      const matrix=Array.from({length:4},(_,i)=>{const gain=this.context.createGain();input.connect(gain,i%2);gain.connect(output,0,Math.floor(i/2));return gain;});
      const filters=SONG_EQ_FREQUENCIES.map((frequency,i)=>{const filter=this.context.createBiquadFilter();filter.type=i===0?'lowshelf':i===4?'highshelf':'peaking';filter.frequency.value=frequency;filter.Q.value=.8;return filter;});
      output.connect(filters[0]);filters.forEach((filter,i)=>filter.connect(filters[i+1]||this.buses.song));
      this.songGraph={input:songInput,splitter:input,output,matrix,filters};
      const initialMatrix=channelMatrix(this.songFX.bypass?'stereo':this.songFX.channel);
      matrix.forEach((node,i)=>node.gain.value=initialMatrix[i]);filters.forEach((node,i)=>node.gain.value=this.songFX.bypass?0:this.songFX.eq[i]);
    }
    if(resume)await this.context.resume();
  }
  async loadFile(file) {
    const request=++this.decodeGeneration;
    try{const data=await file.arrayBuffer();if(request!==this.decodeGeneration)return {stale:true};return await this.decode(data,request);}
    catch(error){if(request!==this.decodeGeneration)return {stale:true};throw error;}
  }
  async loadArrayBuffer(data,{isCurrent=()=>true}={}) {
    return this.decode(data,++this.decodeGeneration,isCurrent);
  }
  async decode(data,request,isCurrent=()=>true) {
    try{
      await this.init(false);if(request!==this.decodeGeneration||!isCurrent())return {stale:true};
      const decoded = await this.context.decodeAudioData(data.slice(0));
      if(request!==this.decodeGeneration||!isCurrent())return {stale:true};
      this.pause(); this.buffer = decoded; this.peaks = waveformPeaks(decoded); this.position = 0;
      return { duration: decoded.duration, sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels };
    }catch(error){if(request!==this.decodeGeneration||!isCurrent())return {stale:true};throw error;}
  }
  setProject(project, arrangement = null) {
    this.project = project; this.arrangement = arrangement || project?.arrangements?.[0] || null;
    this.guideIndex=null;this.guideTails=null;this.guidePlans=new Map();this.beatIndex=null;
  }
  clearAudio() { this.decodeGeneration++; this.pause(); this.buffer = null; this.peaks = null; this.position = 0; }
  get audioDuration() { return this.buffer?.duration || 0; }
  exportWav() { if (!this.buffer) throw Error('Import audio before exporting a WAV'); return encodeWav(this.buffer); }
  get duration() { return Math.max(this.buffer?.duration || 0, this.project?.duration || 0); }
  get isPlaying() { return this.playing; }
  get currentTime() {
    if (!this.playing) return this.position;
    return this.timeAtContext(this.context.currentTime);
  }
  timeAtContext(time) {
    return advanceTransport(this.position, distanceAtTime(Math.max(0, time - this.startedAt), this.speed, this.ramp), this.loop, this.duration);
  }
  async play(position = this.position) {
    const request = ++this.generation;
    await this.init();
    if (request !== this.generation) return;
    this.pause(); this.position = clamp(position, 0, this.duration);
    if (this.position >= this.duration && this.duration > 0) this.position = 0;
    this.effectiveQuality='fast';
    if(this.quality==='spectral'&&this.buffer){
      const generation=this.generation,position=this.position,speed=this.speed,ramp={...this.ramp};this.preparing=true;
      const preview=this.spectral=new SpectralPreview({context:this.context,buffer:this.buffer,output:this.songGraph.input,pitch:this.pitch,loop:{...this.loop},sourceTimeAtOutput:seconds=>position+distanceAtTime(seconds,speed,ramp),onStatus:event=>{if(generation===this.generation)this.onQualityStatus(event);},onFailure:error=>{if(generation!==this.generation||this.spectral!==preview||!this.playing)return;const cursor=this.currentTime;this.pause();this.quality='fast';this.onQualityStatus({mode:'fast',state:'fallback',message:error.message});this.play(cursor).catch(e=>this.onQualityStatus({mode:'fast',state:'error',message:e.message}));}});
      try{await preview.prepare();if(generation!==this.generation){preview.stop();return;}this.effectiveQuality='spectral';}
      catch(error){preview.stop();if(generation!==this.generation||error.name==='AbortError')return;this.spectral=null;this.quality='fast';this.onQualityStatus({mode:'fast',state:'fallback',message:'Spectral preview unavailable; using fast preview. '+error.message});}
      finally{if(generation===this.generation)this.preparing=false;}
    }
    this.startedAt = this.context.currentTime + 0.025;if(this.effectiveQuality==='spectral')this.startedAt=this.spectral.start(this.startedAt);this.nextGrain = this.startedAt;
    this.playing = true;this.guideContinue=true; this.lastGuideTime = this.position - 0.000001;
    this.schedule(); this.timer = setInterval(() => this.schedule(), 25);
  }
  pause() {
    if (this.playing) this.position = this.currentTime;
    this.playing = false; this.preparing=false;this.generation++;this.grainAligner.reset();this.spectral?.stop();this.spectral=null;this.effectiveQuality='fast';
    clearInterval(this.timer); this.timer = null;
    for (const node of this.nodes) { try { node.stop(); } catch {} }
    this.nodes.clear(); this.onTime(this.position);
  }
  stop() { this.pause(); this.position = 0; this.onTime(0); }
  seek(seconds) {
    const playing = this.playing||this.preparing; this.pause(); this.position = clamp(Number(seconds) || 0, 0, this.duration);
    this.onTime(this.position); if (playing) return this.play();
  }
  updateSetting(callback) {
    const playing = this.playing||this.preparing; this.pause(); callback(); if (playing) return this.play();
  }
  async setQuality(mode){
    if(!['fast','spectral'].includes(mode))throw Error('Choose fast or spectral preview');
    const resume=this.playing||this.preparing,position=this.currentTime;this.pause();this.quality=mode;this.onQualityStatus({mode,state:'ready',message:mode==='spectral'?'Spectral preview selected; preparation starts on Play':'Fast granular preview selected'});if(resume)await this.play(position);
  }
  setSpeed(rate) { return this.updateSetting(() => { this.speed = clamp(Number(rate) || 1, 0.1, 2); }); }
  setPitch(semitones) { return this.updateSetting(() => { this.pitch = clamp(Number(semitones) || 0, -24, 24); }); }
  setLoop(start, end, enabled = true) {
    return this.updateSetting(() => { this.loop = { start: Math.max(0, start), end: Math.min(this.duration, end), enabled: !!enabled && end > start }; });
  }
  setRamp(ramp) {
    return this.updateSetting(() => { this.ramp = { enabled: !!ramp.enabled, startSpeed: clamp(Number(ramp.startSpeed) || 0.5, 0.1, 2), endSpeed: clamp(Number(ramp.endSpeed) || 1, 0.1, 2), duration: Math.max(0.1, Number(ramp.duration) || 30) }; });
  }
  setGain(bus, value) {
    if (!Object.hasOwn(this.gains,bus)) throw Error(`Unknown audio bus: ${bus}`);
    this.gains[bus] = clamp(Number(value) || 0, 0, 2);
    this.applyMixer();
  }
  setMute(bus,value=!this.mutes[bus]) { if(!Object.hasOwn(this.mutes,bus))throw Error(`Unknown audio bus: ${bus}`);this.mutes[bus]=!!value;this.applyMixer();return this.mutes[bus]; }
  setSolo(bus,value=!this.solos[bus]) { if(!Object.hasOwn(this.solos,bus))throw Error('Solo applies to song, guide, metronome or live buses');this.solos[bus]=!!value;this.applyMixer();return this.solos[bus]; }
  setEnabled(bus,value) { if(!Object.hasOwn(this.enabled,bus))throw Error(`Unknown audio bus: ${bus}`);this.enabled[bus]=!!value;this.applyMixer();return this.enabled[bus]; }
  getEffectiveGain(bus) {
    if(!Object.hasOwn(this.gains,bus))throw Error(`Unknown audio bus: ${bus}`);
    if(this.mutes[bus]||!this.enabled[bus])return 0;
    if(bus!=='master'&&(this.mutes.master||!this.enabled.master||Object.values(this.solos).some(Boolean)&&!this.solos[bus]))return 0;
    return this.gains[bus];
  }
  getOutputGain(bus) { return this.getEffectiveGain(bus)*(bus==='master'?1:this.getEffectiveGain('master')); }
  applyMixer() { if(this.faders)for(const bus of Object.keys(this.gains))this.faders[bus].gain.setTargetAtTime(this.getEffectiveGain(bus),this.context.currentTime,.01); }
  getBusOutput(bus) { return this.panners?.[bus]||this.faders?.[bus]; }
  getBusInput(bus) { return this.buses?.[bus]; }
  setPan(bus,value) {
    if(!Object.hasOwn(this.pans,bus))throw Error(`Unknown audio bus: ${bus}`);
    this.pans[bus]=clamp(Number(value)||0,-1,1);
    this.panners?.[bus].pan.setTargetAtTime(this.pans[bus],this.context.currentTime,.01);
    return this.pans[bus];
  }
  setSongFX(settings={}) {
    const next={...this.songFX,eq:[...this.songFX.eq]};
    if(settings.channel!==undefined){channelMatrix(settings.channel);next.channel=settings.channel;}
    if(settings.bypass!==undefined)next.bypass=!!settings.bypass;
    if(settings.preset!==undefined){if(!Object.hasOwn(SONG_EQ_PRESETS,settings.preset))throw Error('Unknown EQ preset');next.eq=[...SONG_EQ_PRESETS[settings.preset]];}
    if(settings.eq!==undefined){if(!Array.isArray(settings.eq)||settings.eq.length!==5||!settings.eq.every(Number.isFinite))throw Error('Five finite EQ gains required');next.eq=settings.eq.map(v=>clamp(v,-18,18));}
    this.songFX=next;this.applySongFX();return {...next,eq:[...next.eq]};
  }
  applySongFX() {
    if(!this.songGraph)return;
    const matrix=channelMatrix(this.songFX.bypass?'stereo':this.songFX.channel),at=this.context.currentTime;
    this.songGraph.matrix.forEach((node,i)=>node.gain.setTargetAtTime(matrix[i],at,.01));
    this.songGraph.filters.forEach((node,i)=>node.gain.setTargetAtTime(this.songFX.bypass?0:this.songFX.eq[i],at,.01));
  }
  getMixerState() { return {pans:{...this.pans},songFX:{...this.songFX,eq:[...this.songFX.eq]},gains:{...this.gains},mutes:{...this.mutes},solos:{...this.solos},enabled:{...this.enabled}}; }
  restoreMixerState(state={}) {
    for(const bus of Object.keys(this.gains)){
      if(Number.isFinite(state.gains?.[bus]))this.gains[bus]=clamp(state.gains[bus],0,2);
      if(typeof state.mutes?.[bus]==='boolean')this.mutes[bus]=state.mutes[bus];
      if(typeof state.enabled?.[bus]==='boolean')this.enabled[bus]=state.enabled[bus];
      if(Object.hasOwn(this.solos,bus)&&typeof state.solos?.[bus]==='boolean')this.solos[bus]=state.solos[bus];
    }
    for(const bus of Object.keys(this.pans))if(Number.isFinite(state.pans?.[bus]))this.setPan(bus,state.pans[bus]);
    if(state.songFX)this.setSongFX(state.songFX);
    this.applyMixer();return this.getMixerState();
  }
  track(node) {
    this.nodes.add(node); node.onended = () => { this.nodes.delete(node); try { node.disconnect(); } catch {} };
    return node;
  }
  grain(at, sourceTime) {
    if (!this.buffer || sourceTime >= this.buffer.duration) return;
    const pitch = 2 ** (this.pitch / 12);
    sourceTime=this.grainAligner.select(this.buffer,at,sourceTime,pitch,this.loop.enabled?{lower:this.loop.start,upper:Math.min(this.loop.end,this.buffer.duration)}:{});
    const duration = Math.min(0.08, (this.buffer.duration - sourceTime) / pitch);
    if (duration <= 0.001) return;
    const source = this.track(this.context.createBufferSource()), envelope = this.context.createGain();
    source.buffer = this.buffer; source.playbackRate.value = pitch;
    if (this.loop.enabled) { source.loop = true; source.loopStart = this.loop.start; source.loopEnd = Math.min(this.buffer.duration, this.loop.end); }
    envelope.gain.setValueCurveAtTime(this.window, at, duration);
    const mix = this.context.createGain(); mix.gain.value = 0.5;
    source.connect(envelope); envelope.connect(mix); mix.connect(this.songGraph.input);
    source.onended = () => { this.nodes.delete(source); source.disconnect(); envelope.disconnect(); mix.disconnect(); };
    source.start(at, sourceTime, duration * pitch);
  }
  voice(pitch, at, duration = 0.15, bus = 'guide', velocity = 1, waveform = 'triangle', interpretation=null) {
    const cents=bus==='guide'&&this.arrangement?.type!=='drums'?(this.arrangement?.centOffset??0):0;
    if(!Number.isFinite(velocity)||velocity<=0)return null;
    const tables=interpretation?guideTables(interpretation.plan,{duration,offset:interpretation.offset,sourceAt:interpretation.sourceAt,frequencyAt:value=>guideFrequency(value+pitch-interpretation.plan.pitch,cents,this.context.sampleRate||48000)}):null;
    if(tables&&!tables.audible)return null;
    const frequency=tables?.frequencies[0]??guideFrequency(pitch,cents,this.context.sampleRate||48000);if(!frequency)return null;
    const source = this.track(this.context.createOscillator()), gain = this.context.createGain();
    source.frequency.value = frequency; source.type = waveform;
    if(interpretation?.plan.profile&&tables){
      const coefficients=guideHarmonics(interpretation.plan.profile,tables.frequencies.reduce((maximum,value)=>Math.max(maximum,value),0),this.context.sampleRate||48000);
      const real=new Float32Array(coefficients.length+1),imag=new Float32Array(coefficients.length+1);imag.set(coefficients,1);
      source.setPeriodicWave(this.context.createPeriodicWave(real,imag,{disableNormalization:true}));
    }
    if(tables){source.frequency.setValueCurveAtTime(tables.frequencies,at,duration);gain.gain.setValueCurveAtTime(Float32Array.from(tables.gains,value=>value*.25),at,duration);}
    else{gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.25 * velocity, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.02, duration));}
    source.connect(gain); gain.connect(this.buses[bus]);
    source.onended = () => { this.nodes.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(at); source.stop(at + Math.max(0.03, duration) + 0.01);
  }
  drumVoice(note,at,duration,offset=0){
    const rawVelocity=note.velocity??100,velocity=(Number.isFinite(rawVelocity)?Math.max(0,Math.min(127,rawVelocity)):0)/127*drumGain(note);if(!(velocity>0)||!Number.isFinite(at)||at<0||!Number.isFinite(offset)||offset<0)return;
    const piece=drumPiece(note.piece);this.drumBuffers ||= new Map();let buffer=this.drumBuffers.get(piece);
    if(!buffer){const rate=this.context.sampleRate||48000,pcm=drumSamples(piece,rate);buffer=this.context.createBuffer(1,pcm.length,rate);buffer.getChannelData(0).set(pcm);this.drumBuffers.set(piece,buffer);}
    const span=Math.min(duration,buffer.duration-offset);if(!(span>0))return;
    const source=this.track(this.context.createBufferSource()),gain=this.context.createGain();source.buffer=buffer;
    const level=.25*velocity,{attack,release}=drumFades(span);gain.gain.setValueAtTime(offset>0?0:level,at);if(offset>0)gain.gain.linearRampToValueAtTime(level,at+attack);gain.gain.setValueAtTime(level,at+span-release);gain.gain.linearRampToValueAtTime(0,at+span);
    source.connect(gain);gain.connect(this.buses.guide);source.onended=()=>{this.nodes.delete(source);source.disconnect();gain.disconnect();};source.start(at,offset,span);
  }
  scheduleGuide(from, to, at, wallDuration,continueTails=false) {
    if (to < from) { // Loop boundary: split the segment and retain both edge events.
      const fraction = clamp((this.loop.end - from) / ((this.loop.end - from) + to - this.loop.start), 0, 1);
      this.scheduleGuide(from, this.loop.end, at, wallDuration * fraction,continueTails);
      this.scheduleGuide(this.loop.start - 1e-7, to, at + wallDuration * fraction, wallDuration * (1 - fraction),true); return;
    }
    const events = [];
    if (this.getOutputGain('metronome') > 0) {
      this.beatIndex ||= new PointIndex(this.project?.beats||[]);
      for (const beat of this.beatIndex.between(from,to)) {
      if (beat.time >= from && beat.time < to) events.push({ time: beat.time, pitch: beat.measure >= 0 ? 88 : 76, duration: 0.045, bus: 'metronome' });
      }
    }
    if(this.getOutputGain('guide') > 0&&!this.guideIndex){
    const notes=guideNotes(this.arrangement||{});this.guideIndex=new PointIndex(notes);this.guideTails=new IntervalIndex(notes,{end:n=>n.time+guideDuration(n,this.arrangement?.type)});this.guidePlans=new Map();
    }
    if (this.getOutputGain('guide') > 0) {
     const notes=[...this.guideIndex.between(from,to),...(continueTails?this.guideTails.between(from,from).map(row=>row.item).filter(n=>n.time<from-1e-8&&n.time+guideDuration(n,this.arrangement?.type)>from+1e-8):[])];
     for (const note of notes) {
      const time=Math.max(from,note.time),eventAt=at+(time-from)/Math.max(1e-7,to-from)*wallDuration,offset=Math.max(0,time-note.time);
      let plan=this.guidePlans.get(note);if(!plan){plan=guidePlan(this.arrangement,note,{rigLibrary:this.project?.rigLibrary});this.guidePlans.set(note,plan);}
      const remaining=Math.min(plan.duration-offset,Math.max(0,this.duration-time),this.loop.enabled?Math.max(0,this.loop.end-time):Infinity);
      if(!(remaining>1e-5))continue;
      const elapsed=Math.max(0,eventAt-this.startedAt),distance=t=>distanceAtTime(elapsed+t,this.speed,this.ramp)-distanceAtTime(elapsed,this.speed,this.ramp);
      let duration;if(!this.ramp.enabled)duration=remaining/this.speed;else{let lo=0,hi=remaining/Math.min(this.ramp.startSpeed,this.ramp.endSpeed);for(let i=0;i<36;i++){const mid=(lo+hi)/2;if(distance(mid)<remaining)lo=mid;else hi=mid;}duration=(lo+hi)/2;}
      if(!Number.isFinite(duration)||duration<=0)continue;
      const pitch=notePitch(this.arrangement,note);
      events.push({time,drum:this.arrangement.type==='drums'?note:null,offset,pitch:pitch??(note.piece==='kick'?35:note.piece==='snare'?50:80),duration,bus:'guide',velocity:(note.velocity??100)/127,interpretation:pitch==null?null:{plan,offset,sourceAt:t=>offset+distance(t)}});
     }
    }
    for(const event of events)if(event.drum)this.drumVoice(event.drum,at+(event.time-from)/Math.max(1e-7,to-from)*wallDuration,event.duration,event.offset);else this.voice(event.pitch+(event.bus==='guide'?this.pitch:0),at+(event.time-from)/Math.max(1e-7,to-from)*wallDuration,event.duration,event.bus,event.velocity??1,'triangle',event.interpretation);
  }

  schedule() {
    if (!this.playing) return;
    const now = this.context.currentTime;
    if (!this.loop.enabled && this.currentTime >= this.duration) { this.pause(); this.onEnded(); return; }
    // Schedule each 20 ms segment exactly once, ahead of the audio clock.
    if (this.nextGrain < now) this.nextGrain = now + 0.005;
    while (this.nextGrain < now + 0.12) {
      const at = this.nextGrain, from = this.timeAtContext(at), to = this.timeAtContext(at + 0.02);
      if(this.effectiveQuality!=='spectral')this.grain(at, from); this.scheduleGuide(from, to, at, 0.02,this.guideContinue);this.guideContinue=false; this.nextGrain += 0.02;
    }
    this.onTime(this.currentTime);
  }
  async dispose() { for(const dispose of this.disposers)dispose();this.disposers.clear();this.decodeGeneration++; this.pause(); if (this.context) await this.context.close(); this.context = null; this.drumBuffers?.clear();this.buses = null; this.faders = null; this.panners = null; this.songGraph = null; }
}
