// Explicit local monitoring only: no recorder or file writes.
export class LiveInput {
  constructor({audio,mediaDevices=globalThis.navigator?.mediaDevices,prepareEffect=null,createEffect=null,onState=()=>{}}={}) {
    if(!audio)throw Error('An audio engine is required');
    this.audio=audio;this.mediaDevices=mediaDevices;this.prepareEffect=prepareEffect;this.createEffect=createEffect;this.onState=onState;
    this.generation=0;this.stream=null;this.source=null;this.effect=null;this.pending=false;this.label='';this.deviceId='';this.engine='';this.pendingController=null;this.disposed=false;this.cleanupPromise=null;
    this.disposeHook=()=>this.dispose();audio.disposers?.add(this.disposeHook);
  }
  get active(){return !!this.stream;}
  state(){return {active:this.active,pending:this.pending,label:this.label,deviceId:this.deviceId,engine:this.engine};}
  emit(){this.onState(this.state());}
  async listDevices(){
    if(!this.mediaDevices?.enumerateDevices)throw Error('Live input requires a secure browser with audio input support');
    return (await this.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput').map((d,i)=>({id:d.deviceId,label:d.label||`Audio input ${i+1}`}));
  }
  async start(deviceId='',effectOptions={}){
    if(this.disposed)throw Error('Live input has been disposed');
    this.stop();const request=this.generation,controller=new AbortController();this.pendingController=controller;this.pending=true;this.emit();
    let effect=null;
    try{
      if(!this.mediaDevices?.getUserMedia)throw Error('Live input requires a secure browser with audio input support');
      await this.audio.init();if(request!==this.generation||this.disposed){await this.cleanupDisposedAudio();return {stale:true};}
      // Explicit preparation runs before requesting hardware. Cancellation
      // during module loading must never lead to a later microphone request.
      if(this.prepareEffect){await this.prepareEffect(this.audio.context,effectOptions);if(request!==this.generation||this.disposed){await this.cleanupDisposedAudio();return {stale:true};}}
      effect=await this.createEffect?.(this.audio.context,{...effectOptions,signal:controller.signal})||null;
      if(request!==this.generation||this.disposed){effect?.dispose();await this.cleanupDisposedAudio();return {stale:true};}
      this.effect=effect;
      const stream=await this.mediaDevices.getUserMedia({audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:1}},video:false});
      if(request!==this.generation||this.disposed){stream.getTracks().forEach(track=>track.stop());effect?.dispose();if(this.effect===effect)this.effect=null;await this.cleanupDisposedAudio();return {stale:true};}
      this.stream=stream;
      const track=stream.getAudioTracks()[0];if(!track)throw Error('The selected input supplied no audio track');
      this.source=this.audio.context.createMediaStreamSource(stream);
      if(this.effect){this.source.connect(this.effect.input);this.effect.connect(this.audio.buses.live);}else this.source.connect(this.audio.buses.live);
      this.label=track.label||'Audio input';this.deviceId=track.getSettings?.().deviceId||deviceId;this.engine=this.effect?.engine||'software';this.pendingController=null;
      this.ended=()=>{if(this.stream===stream)this.stop();};track.addEventListener?.('ended',this.ended,{once:true});
      this.pending=false;this.emit();return this.state();
    }catch(error){if(request!==this.generation||this.disposed){effect?.dispose();if(this.effect===effect)this.effect=null;await this.cleanupDisposedAudio();return {stale:true};}this.stop();throw error;}
  }
  async cleanupDisposedAudio(){
    // A deferred init may create its context AFTER the unmount's engine.dispose
    // saw no context. Only terminal disposal closes that orphan; an ordinary
    // Stop/Cancel leaves the engine reusable for this same mounted editor.
    if(!this.disposed||!this.audio.context||this.audio.context.state==='closed')return;
    if(!this.cleanupPromise)this.cleanupPromise=Promise.resolve().then(()=>this.audio.context&&this.audio.context.state!=='closed'?this.audio.dispose():undefined).finally(()=>{this.cleanupPromise=null;});
    await this.cleanupPromise;
  }
  stop(){
    this.generation++;this.pending=false;this.pendingController?.abort();this.pendingController=null;
    for(const track of this.stream?.getTracks()||[]){track.removeEventListener?.('ended',this.ended);track.stop();}
    this.source?.disconnect();this.effect?.dispose();this.stream=null;this.source=null;this.effect=null;this.label='';this.deviceId='';this.engine='';this.emit();
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.audio.disposers?.delete(this.disposeHook);this.stop();}
}
