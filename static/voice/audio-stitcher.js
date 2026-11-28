(function () {
  const floor=10**(-42/20), rmsTarget=10**(-18/20), peakLimit=0.98;
  const pause={start:0,inline:0.055,sentence:0.2,arrow:0.26,blank:0.5};
  const maxSeconds=90;
  function bounded(promise,signal,milliseconds,detail) {
    return new Promise((resolve,reject)=>{
      if (signal.aborted) {reject(signal.reason);return;}
      const timer=setTimeout(()=>finish(reject,new Error(detail)),milliseconds);
      const cancel=()=>finish(reject,signal.reason);
      function finish(settle,value) {clearTimeout(timer);signal.removeEventListener('abort',cancel);settle(value);}
      signal.addEventListener('abort',cancel,{once:true});
      promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }
  function create({audioContext,sink}={}) {
    const Context=window.AudioContext || window.webkitAudioContext;
    if (!audioContext && !Context) throw new Error('Trình duyệt không hỗ trợ ghép âm thanh.');
    const abort=new AbortController(), context=audioContext || new Context({sampleRate:24000});
    const destination=sink || context.destination;
    const ready=context.state==='running' ? Promise.resolve()
      : bounded(context.resume(),abort.signal,5000,'Trình duyệt chưa cho phát âm thanh. Bấm Nghe lại.');
    ready.catch(()=>{});
    let next=0, closed=false;
    let previousVoice, previousModel, previousGain;
    const active=new Set();
    let tail=Promise.resolve();
    async function append(segment) {
      await ready;
      if (closed) return;
      if (active.size>=2) await active.values().next().value.done;
      if (closed) return;
      const uri=audioDataUrl(segment);
      const encoded=Uint8Array.from(atob(uri.slice(uri.indexOf(',')+1)),character=>character.charCodeAt(0));
      const buffer=await bounded(context.decodeAudioData(encoded.buffer),abort.signal,5000,'Không giải mã được âm thanh.');
      if (closed) return;
      if (!Number.isFinite(buffer.duration) || buffer.duration<=0 || buffer.duration>maxSeconds || ![1,2].includes(buffer.numberOfChannels))
        throw new Error('Định dạng hoặc thời lượng đoạn âm thanh không được hỗ trợ.');
      const channels=Array.from({length:buffer.numberOfChannels},(_,index)=>buffer.getChannelData(index));
      let first=buffer.length,last=-1;
      for (const channel of channels) {
        for (let i=0;i<first;i++) if (Math.abs(channel[i])>=floor) {first=i;break;}
        for (let i=channel.length-1;i>last;i--) if (Math.abs(channel[i])>=floor) {last=i;break;}
      }
      if (last<first) throw new Error('Nhà cung cấp trả về đoạn âm thanh im lặng.');
      const samples=last-first+1;
      let squares=0,peak=0;
      for (const channel of channels) for(let i=first;i<=last;i++) {
        const sample=channel[i];squares+=sample*sample;peak=Math.max(peak,Math.abs(sample));
      }
      const {voice,model}=segment;
      const labelled=typeof voice==='string' && voice.trim() && typeof model==='string' && model.trim();
      let gain=Math.min(rmsTarget/Math.sqrt(squares/(samples*channels.length)),4);
      if (labelled && voice===previousVoice && model===previousModel)
        gain=Math.min(previousGain*1.35,Math.max(previousGain*0.75,gain));
      // Never trade headroom for continuity, even when it breaks the relative gain bound.
      gain=Math.min(gain,peakLimit/peak);
      const lead=Math.min(first,Math.round(buffer.sampleRate*0.015));
      const trail=Math.min(buffer.length-1-last,Math.round(buffer.sampleRate*0.025));
      first-=lead;last+=trail;
      const source=context.createBufferSource(), volume=context.createGain();
      source.buffer=buffer;source.playbackRate.value=segment.speed;
      source.connect(volume).connect(destination);
      const start=Math.max(context.currentTime+0.015,next+(pause[segment.boundary] || 0));
      const seconds=(last-first+1)/buffer.sampleRate, duration=seconds/segment.speed;
      const sampleTime=1/(buffer.sampleRate*segment.speed);
      const fadeIn=Math.min(0.012,lead*sampleTime+0.003,duration/2);
      const fadeOut=Math.min(0.012,trail*sampleTime+0.003,duration/2);
      volume.gain.setValueAtTime(0,start);volume.gain.linearRampToValueAtTime(gain,start+fadeIn);
      volume.gain.setValueAtTime(gain,start+duration-fadeOut);volume.gain.linearRampToValueAtTime(0,start+duration);
      next=start+duration;
      let settle;
      const entry={source,done:new Promise(resolve=>{settle=resolve;}),finish(){
        if (!active.delete(entry)) return;
        source.onended=null;source.disconnect();volume.disconnect();settle();
      }};
      active.add(entry);source.onended=entry.finish;tail=entry.done;
      source.start(start,first/buffer.sampleRate,seconds);
      previousVoice=labelled ? voice : undefined;
      previousModel=labelled ? model : undefined;
      previousGain=gain;
    }
    function stop() {
      if (closed) return;
      closed=true;abort.abort();
      for (const entry of active) {
        try {entry.source.stop();} catch { /* Already ended. */ }
        entry.finish();
      }
      if (!audioContext) context.close().catch(()=>{});
    }
    return {append,finish:()=>tail,stop};
  }
  window.VJVoiceStitcher=Object.freeze({create});
})();
