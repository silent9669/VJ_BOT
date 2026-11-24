// GPT-Live carries microphone audio over WebRTC; Gemini Live carries it over a WebSocket. Keys stay on the Worker or as ephemeral tokens.
(function () {
  const el = id => document.getElementById(id);
  let peer=null, stream=null, channel=null, abort=null, version=0, ready=false, closing=false;
  let timer=null, closeTimer=null, connectTimer=null, disconnectedTimer=null, startedAt=0;
  const BARS=33,SILENCE='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let audioContext=null,analyser=null,waveFrame=null,callOwner=null,statsTimer=null,remoteLevel=0;
  let liveSocket=null,captureNode=null,captureSource=null,nextPlayTime=0;
  let mistralRoom=null,mistralSessionId=null,mistralSegments={};
  const audioSources=[];
  let wakeLock=null,commands={},teacherAnalyser=null,teacherHeardAt=0,teacherExpectedUntil=0,teacherSpeaking=false,userMuted=false;
  // Keep the screen on during a call: iPhone locking the screen drops the microphone.
  const keepAwake=async()=>{try{wakeLock?.release?.();wakeLock=await navigator.wakeLock?.request('screen');}catch{wakeLock=null;}};
  const letSleep=()=>{wakeLock?.release?.().catch(()=>{});wakeLock=null;};
  const timeline = createLiveTranscript(el('live-transcript'));
  const status = text => { el('live-status').textContent=text; };
  function controls(active) {
    el('live-start').disabled=active;
    el('live-end').disabled=!active;
    el('live-mute').disabled=!ready || closing;
    el('live-end').hidden=!active;el('live-mute').hidden=!active;
    el('live-stage').dataset.active=String(ready && !closing);
    turn();
  }
  // One speaker at a time: the microphone stays closed while the teacher talks and opens when the teacher stops.
  function turn() {
    const live=ready && !closing, mine=live && !teacherSpeaking;
    stream?.getAudioTracks().forEach(track=>{track.enabled=mine && !userMuted;});
    el('live-stage').dataset.turn=live?(teacherSpeaking?'teacher':userMuted?'muted':'you'):'';
    el('live-commands').hidden=!live;
    for(const button of el('live-commands').querySelectorAll?.('button')||[])button.disabled=!mine || !commands[button.dataset.command];
    if(live)status(teacherSpeaking?'Thầy đang nói. Em đợi một chút nhé.':userMuted?'Micro đang tắt':'Đến lượt em nói nhé.');
  }
  // Safari cannot tap a remote WebRTC track with Web Audio, so the teacher's level comes from the connection stats.
  async function pollRemoteLevel() {
    if(!peer?.getStats)return;
    try {
      let level=0;
      (await peer.getStats()).forEach(report=>{if(report.type==='inbound-rtp' && (report.kind||report.mediaType)==='audio' && typeof report.audioLevel==='number')level=Math.max(level,report.audioLevel);});
      remoteLevel=level;
      if(level>.01)teacherHeardAt=Date.now();
    } catch {}
  }
  function teacherPulse() {
    if(!teacherAnalyser)return;
    const samples=new Uint8Array(teacherAnalyser.fftSize);teacherAnalyser.getByteTimeDomainData(samples);
    let peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value-128));
    const now=Date.now();
    if(peak>4)teacherHeardAt=now;
    const speaking=ready && (now<teacherExpectedUntil || now-teacherHeardAt<900);
    if(speaking!==teacherSpeaking){teacherSpeaking=speaking;turn();}
  }
  function cleanup(message) {
    ++version; ready=false; closing=false;
    clearInterval(timer); clearTimeout(closeTimer); clearTimeout(connectTimer); clearTimeout(disconnectedTimer);
    abort?.abort(); abort=null;
    stream?.getTracks().forEach(track=>track.stop()); stream=null;
    const oldChannel=channel, oldPeer=peer, oldSocket=liveSocket, oldRoom=mistralRoom, sessionId=mistralSessionId;
    channel=null;peer=null;liveSocket=null;mistralRoom=null;mistralSessionId=null;mistralSegments={};
    oldChannel?.close(); oldPeer?.close(); oldSocket?.close(); oldRoom?.disconnect?.();
    if(sessionId)apiFetch('/api/live/mistral',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:sessionId})}).catch(()=>{});
    captureSource?.disconnect?.();captureNode?.disconnect?.();captureSource=null;captureNode=null;nextPlayTime=0;
    if(waveFrame!==null)cancelAnimationFrame(waveFrame);waveFrame=null;
    clearInterval(statsTimer);statsTimer=null;remoteLevel=0;
    audioSources.splice(0).forEach(source=>source.disconnect());
    audioContext?.close().catch(()=>{});audioContext=null;analyser=null;teacherAnalyser=null;
    teacherHeardAt=0;teacherExpectedUntil=0;teacherSpeaking=false;userMuted=false;commands={};
    paint(new Float32Array(BARS),0);
    el('live-audio').srcObject=null;el('live-audio').removeAttribute?.('src');letSleep();
    el('live-play-audio').hidden=true;
    el('live-mute').setAttribute('aria-pressed','false');el('live-mute').textContent='Tắt micro';
    controls(false); if (message) status(message);
    timeline.finish();
  }
  function connectWave(media,teacher=false) {
    if(!audioContext || !analyser)return;
    const source=audioContext.createMediaStreamSource(media);source.connect(analyser);audioSources.push(source);
    if(teacher && teacherAnalyser)source.connect(teacherAnalyser);
  }
  function wave() {
    const canvas=el('live-wave'),ctx=canvas?.getContext?.('2d');
    const AudioContext=window.AudioContext || window.webkitAudioContext;
    if(!ctx || !AudioContext)return;
    audioContext=new AudioContext();audioContext.resume().catch(()=>{});
    analyser=audioContext.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.65;
    teacherAnalyser=audioContext.createAnalyser();teacherAnalyser.fftSize=512;
    const samples=new Uint8Array(analyser.fftSize),levels=new Float32Array(BARS);
    statsTimer=setInterval(pollRemoteLevel,150);
    const draw=()=>{
      if(!analyser)return;
      teacherPulse();
      analyser.getByteTimeDomainData(samples);
      const span=Math.floor(samples.length/BARS);let sum=0;
      for(let i=0;i<BARS;i++){
        let energy=0;for(let j=0;j<span;j++)energy+=Math.abs(samples[i*span+j]-128);
        const envelope=.3+.7*Math.sin(Math.PI*(i+.5)/BARS);
        const own=Math.min(1,energy/span/36*envelope);
        const remote=Math.min(1,remoteLevel*5)*envelope*(.6+.4*Math.sin(Date.now()/110+i*.9));
        levels[i]+=(Math.max(own,remote)-levels[i])*.35;sum+=levels[i];
      }
      paint(levels,sum/BARS);waveFrame=requestAnimationFrame(draw);
    };draw();
  }
  // Mirrored capsule bars (Siri / Voice Memos style) drawn with one stroked path.
  function paint(levels,level) {
    const canvas=el('live-wave'),ctx=canvas?.getContext?.('2d');
    if(!ctx)return;
    const gap=canvas.width/BARS,mid=canvas.height/2,max=canvas.height*.86;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.lineCap='round';ctx.lineWidth=gap*.46;ctx.strokeStyle=getComputedStyle(canvas).color;ctx.beginPath();
    for(let i=0;i<BARS;i++){const x=(i+.5)*gap,half=Math.max(.01,levels[i]*max/2);ctx.moveTo(x,mid-half);ctx.lineTo(x,mid+half);}
    ctx.stroke();
    el('live-stage')?.style?.setProperty?.('--level',level.toFixed(3));
  }
  function end(immediate=false) {
    stream?.getTracks().forEach(track=>{track.enabled=false;});
    if(closing && !immediate)return;
    if (liveSocket) { liveSocket.close();liveSocket=null; }
    if (channel?.readyState==='open' && ready && !closing) {
      closing=true; channel.send(JSON.stringify({type:'session.close',event_id:'close_'+Date.now()}));
      if (!immediate) {
        status('Đang kết thúc…');controls(true);el('live-end').disabled=true;
        closeTimer=setTimeout(()=>cleanup('Đã ngắt kết nối. OpenAI chưa xác nhận kết thúc phiên.'),5000);
        return;
      }
    }
    cleanup('Đã kết thúc cuộc trò chuyện.');
  }
  async function start() {
    if (peer || liveSocket || mistralRoom || el('live-start').disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection==='undefined') {status('Trình duyệt cần hỗ trợ WebRTC và micro qua HTTPS hoặc localhost.');return;}
    // iOS only lets an element play later if it was started inside this tap: unlock it with a silent clip.
    const speaker=el('live-audio');
    if(!speaker.srcObject){speaker.src=SILENCE;speaker.play?.()?.catch?.(()=>{});}
    const run=++version, owner=signedInUser?.user_id;
    callOwner=owner;
    timeline.reset();
    el('live-duration').textContent='00:00';controls(true);status('Cho phép micro để bắt đầu…');
    try {
      globalThis.stopSpeech?.();globalThis.stopJapaneseInputs?.();
      wave();
      const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(run!==version || owner!==signedInUser?.user_id){microphone.getTracks().forEach(track=>track.stop());if(run===version)cleanup('Tài khoản đã thay đổi.');return;}
      stream=microphone;
      const engine=await liveEngine();
      if(run!==version)return;
      if(owner!==signedInUser?.user_id){cleanup('Tài khoản đã thay đổi.');return;}
      if(engine==='gemini'){await startGemini(run,microphone);return;}
      if(engine==='mistral'){await startMistral(run,microphone);return;}
      if(engine!=='openai'){cleanup('Nói trực tiếp cần kết nối OpenAI chính thức, Gemini gốc hoặc Mistral gốc trong Cài đặt.');return;}
      const connection=peer=new RTCPeerConnection();
      connectWave(stream);
      stream.getTracks().forEach(track=>connection.addTrack(track,stream));
      connection.addEventListener('track',event=>{
        if(run!==version)return;
        el('live-audio').srcObject=new MediaStream([event.track]);
        connectWave(el('live-audio').srcObject,true);
        el('live-audio').play().catch(()=>{if(run===version){el('live-play-audio').hidden=false;status('Nhấn Bật âm thanh để nghe thầy.');}});
      });
      connection.addEventListener('connectionstatechange',()=>{
        if(run!==version)return;
        if(connection.connectionState==='failed')cleanup('Mất kết nối. Nhấn bắt đầu để thử lại.');
        else if(connection.connectionState==='disconnected')disconnectedTimer=setTimeout(()=>{if(run===version)cleanup('Mất kết nối. Nhấn bắt đầu để thử lại.');},8000);
        else if(connection.connectionState==='connected')clearTimeout(disconnectedTimer);
      });
      const events=channel=connection.createDataChannel('oai-events');
      let greeting='';
      events.addEventListener('message',({data})=>{
        if(run!==version)return;
        let event;try{event=JSON.parse(data);}catch{return;}
        if(event.type==='session.started') {
          ready=true;clearTimeout(connectTimer);controls(true);startedAt=Date.now();keepAwake();teacherExpectedUntil=Date.now()+4000;turn();
          events.send(JSON.stringify({type:'session.commentary.append',event_id:'hello_'+Date.now(),delegation_id:null,content:greeting}));
          timer=setInterval(()=>{
            const seconds=Math.floor((Date.now()-startedAt)/1000);
            el('live-duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
            if(seconds>=600)end();
          },1000);
        } else if(event.type==='session.closed')cleanup('Đã kết thúc cuộc trò chuyện.');
        else if(['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type)){if(event.type==='session.output_transcript.delta')teacherHeardAt=Date.now();timeline.add(event);}
        else if(event.type==='error')cleanup('Cuộc gọi gặp lỗi và đã kết thúc. Hãy thử lại.');
      });
      events.addEventListener('close',()=>{if(run===version)cleanup('Kết nối đã đóng.');});
      status('Đang kết nối với thầy…');
      connectTimer=setTimeout(()=>{if(run===version)cleanup('Kết nối hết thời gian. Hãy thử lại.');},35000);
      await connection.setLocalDescription(await connection.createOffer());
      if(connection.iceGatheringState!=='complete')await new Promise(resolve=>{
        const timeout=setTimeout(done,3000);
        function done(){clearTimeout(timeout);connection.removeEventListener('icegatheringstatechange',change);resolve();}
        function change(){if(connection.iceGatheringState==='complete')done();}
        connection.addEventListener('icegatheringstatechange',change);
      });
      if(run!==version)return;
      const context=globalThis.teacherContext?.();
      const lesson=(typeof chatLessonContext!=='undefined'?chatLessonContext:null) || context?.lesson;
      abort=new AbortController();
      const response=await apiFetch('/api/live',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sdp:connection.localDescription.sdp,level:lesson?.level || activeCurriculumLevel || 'N5',lesson:lesson?{id:lesson.id,level:lesson.level}:null})});
      const result=await response.json();
      if(run!==version)return;
      if(owner!==signedInUser?.user_id){cleanup('Tài khoản đã thay đổi.');return;}
      if(!response.ok)throw Object.assign(new Error(result.detail || 'Không mở được cuộc gọi.'),{userFacing:true});
      greeting=result.greeting;commands=result.commands && typeof result.commands==='object'?result.commands:{};
      await connection.setRemoteDescription({type:'answer',sdp:result.sdp});
    } catch(error) {
      if(run!==version)return;
      cleanup(error.userFacing?error.message
        : ['NotAllowedError','SecurityError'].includes(error.name)?'Micro chưa được cho phép. Bật quyền micro rồi thử lại.'
        : ['NotFoundError','DevicesNotFoundError'].includes(error.name)?'Không tìm thấy micro. Kết nối micro rồi thử lại.'
        : error.name==='NotReadableError'?'Micro đang bận hoặc không khả dụng. Đóng ứng dụng đang dùng micro rồi thử lại.'
        : error.name==='SyntaxError'?'Phản hồi kết nối không hợp lệ. Hãy thử lại.'
        : 'Không kết nối được cuộc trò chuyện trực tiếp. Kiểm tra mạng và thiết bị rồi thử lại.');
    }
  }
  // The learner's saved connection decides the engine; admin stays on the server-keyed OpenAI path.
  async function liveEngine() {
    try {
      const settings=await (await apiFetch('/api/ai/settings')).json(),own=settings?.own;
      const host=protocol=>new URL((own?.base_url||'').trim()||settings?.bases?.[protocol]||'https://x').hostname;
      if(settings?.is_admin)return'openai';
      if(own?.protocol==='gemini' && /(^|\.)generativelanguage\.googleapis\.com$/.test(host('gemini')))return'gemini';
      if(own?.protocol==='openai' && /(^|\.)mistral\.ai$/.test(host('openai')))return'mistral';
      if(own?.protocol==='openai' && /(^|\.)openai\.com$/.test(host('openai')))return'openai';
    } catch {}
    return'none';
  }
  // Gemini Live: mic PCM 16kHz over a WebSocket, server audio 24kHz queued for playback.
  async function startGemini(run,microphone) {
    const context=globalThis.teacherContext?.();
    const lesson=(typeof chatLessonContext!=='undefined'?chatLessonContext:null) || context?.lesson;
    abort=new AbortController();
    const response=await apiFetch('/api/live/gemini',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({level:lesson?.level || activeCurriculumLevel || 'N5',lesson:lesson?{id:lesson.id,level:lesson.level}:null})});
    const result=await response.json();
    if(run!==version)return;
    if(!response.ok)throw Object.assign(new Error(result.detail || 'Không mở được cuộc gọi.'),{userFacing:true});
    commands=result.commands && typeof result.commands==='object'?result.commands:{};
    const speakerContext=audioContext || new (window.AudioContext || window.webkitAudioContext)();
    if(!audioContext){audioContext=speakerContext;audioContext.resume().catch(()=>{});}
    connectWave(microphone);
    const ratio=speakerContext.sampleRate/16000;
    const socket=liveSocket=new WebSocket(result.ws+'?access_token='+encodeURIComponent(result.token));
    socket.addEventListener('open',()=>{
      if(run!==version)return;
      socket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:result.greeting}]}],turnComplete:true}}));
    });
    socket.addEventListener('message',async({data})=>{
      if(run!==version)return;
      let event;try{event=JSON.parse(typeof data==='string'?data:await data.text());}catch{return;}
      if(event.setupComplete){ready=true;clearTimeout(connectTimer);controls(true);startedAt=Date.now();keepAwake();teacherExpectedUntil=Date.now()+4000;turn();
        timer=setInterval(()=>{const seconds=Math.floor((Date.now()-startedAt)/1000);
          el('live-duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
          if(seconds>=600)end();},1000);
        captureSource=speakerContext.createMediaStreamSource(microphone);
        captureNode=speakerContext.createScriptProcessor(4096,1,1);
        captureNode.onaudioprocess=e=>{
          if(run!==version || socket.readyState!==1)return;
          const input=e.inputBuffer.getChannelData(0),out=Math.floor(input.length/ratio),pcm=new Int16Array(out);
          for(let i=0;i<out;i++){const s=input[Math.floor(i*ratio)];pcm[i]=Math.max(-1,Math.min(1,s))*32767;}
          let bin='';for(let i=0;i<pcm.length;i++)bin+=String.fromCharCode(pcm[i]&255,pcm[i]>>8);
          socket.send(JSON.stringify({realtimeInput:{audio:{data:btoa(bin),mimeType:'audio/pcm;rate=16000'}}}));
        };
        const muteGain=speakerContext.createGain();muteGain.gain.value=0;
        captureSource.connect(captureNode);captureNode.connect(muteGain);muteGain.connect(speakerContext.destination);
        return;
      }
      const content=event.serverContent;
      if(content?.modelTurn?.parts)for(const part of content.modelTurn.parts){
        const b64=part?.inlineData?.data;
        if(!b64)continue;
        teacherHeardAt=Date.now();teacherExpectedUntil=0;
        const bin=atob(b64),pcm=new Int16Array(bin.length/2);
        for(let i=0;i<pcm.length;i++)pcm[i]=bin.charCodeAt(i*2)|(bin.charCodeAt(i*2+1)<<8);
        const floats=new Float32Array(pcm.length);for(let i=0;i<pcm.length;i++)floats[i]=pcm[i]/32768;
        const buffer=speakerContext.createBuffer(1,floats.length,24000);buffer.getChannelData(0).set(floats);
        const source=speakerContext.createBufferSource();source.buffer=buffer;
        if(teacherAnalyser)source.connect(teacherAnalyser);
        source.connect(speakerContext.destination);
        nextPlayTime=Math.max(nextPlayTime,speakerContext.currentTime);source.start(nextPlayTime);nextPlayTime+=buffer.duration;
      }
      const now=Date.now()-startedAt;
      if(content?.inputTranscription?.text)timeline.add({type:'session.input_transcript.delta',delta:content.inputTranscription.text,start_ms:Math.max(0,now-1500),end_ms:now});
      if(content?.outputTranscription?.text)timeline.add({type:'session.output_transcript.delta',delta:content.outputTranscription.text,start_ms:Math.max(0,now-1500),end_ms:now});
      if(event.goAway || content?.turnComplete===false)teacherHeardAt=Date.now();
    });
    socket.addEventListener('close',()=>{if(run===version)cleanup('Kết nối đã đóng.');});
    socket.addEventListener('error',()=>{if(run===version)cleanup('Không kết nối được cuộc trò chuyện trực tiếp. Kiểm tra mạng và thiết bị rồi thử lại.');});
    status('Đang kết nối với thầy…');
    connectTimer=setTimeout(()=>{if(run===version)cleanup('Kết nối hết thời gian. Hãy thử lại.');},35000);
  }
  // Mistral Voice Agents run in a LiveKit room; livekit-client is vendored and loaded on demand.
  function loadLiveKit() {
    if(window.VJLiveKit)return Promise.resolve();
    if(loadLiveKit.promise)return loadLiveKit.promise;
    loadLiveKit.promise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='livekit.min.js';
      script.addEventListener('load',resolve);script.addEventListener('error',()=>{loadLiveKit.promise=null;reject(new Error('load'));});
      document.head.appendChild(script);
    });
    return loadLiveKit.promise;
  }
  async function startMistral(run,microphone) {
    status('Đang kết nối với thầy…');
    const context=globalThis.teacherContext?.();
    const lesson=(typeof chatLessonContext!=='undefined'?chatLessonContext:null) || context?.lesson;
    abort=new AbortController();
    const [response]=await Promise.all([apiFetch('/api/live/mistral',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({level:lesson?.level || activeCurriculumLevel || 'N5',lesson:lesson?{id:lesson.id,level:lesson.level}:null})}),loadLiveKit()]);
    const result=await response.json();
    if(run!==version)return;
    if(!response.ok)throw Object.assign(new Error(result.detail || 'Không mở được cuộc gọi.'),{userFacing:true});
    commands={};
    const {Room,RoomEvent,Track}=window.VJLiveKit,room=mistralRoom=new Room();
    mistralSessionId=result.id;
    room.on(RoomEvent.TrackSubscribed,track=>{
      if(run!==version || track.kind!==Track.Kind.Audio)return;
      const media=new MediaStream([track.mediaStreamTrack]);
      el('live-audio').srcObject=media;connectWave(media,true);
      el('live-audio').play().catch(()=>{if(run===version){el('live-play-audio').hidden=false;status('Nhấn Bật âm thanh để nghe thầy.');}});
      teacherHeardAt=Date.now();turn();
    });
    room.on(RoomEvent.DataReceived,(payload,participant,_kind,topic)=>{
      if(run!==version || topic!=='voice_agent.events')return;
      let event;try{event=JSON.parse(new TextDecoder().decode(payload));}catch{return;}
      if(event?.type!=='transcription.segment' || !['user','assistant'].includes(event.role) || typeof event.content!=='string' || typeof event.id!=='string')return;
      const previous=mistralSegments[event.id]||'';
      if(event.final && event.content===previous)return;
      if(!event.content.startsWith(previous))return;
      mistralSegments[event.id]=event.content;
      const delta=event.content.slice(previous.length);if(!delta)return;
      const now=Date.now()-startedAt;
      timeline.add({type:event.role==='user'?'session.input_transcript.delta':'session.output_transcript.delta',
        delta,start_ms:Math.max(0,now-2000),end_ms:now});
      if(event.role==='assistant')teacherHeardAt=Date.now();
    });
    room.on(RoomEvent.Disconnected,()=>{if(run===version)cleanup('Kết nối đã đóng.');});
    connectTimer=setTimeout(()=>{if(run===version)cleanup('Kết nối hết thời gian. Hãy thử lại.');},35000);
    await room.connect(result.serverUrl,result.participantToken);
    if(run!==version){room.disconnect();return;}
    await room.localParticipant.publishTrack(microphone.getAudioTracks()[0],{source:Track.Source.Microphone});
    if(run!==version){room.disconnect();return;}
    connectWave(microphone);
    ready=true;clearTimeout(connectTimer);controls(true);startedAt=Date.now();keepAwake();teacherExpectedUntil=Date.now()+4000;turn();
    timer=setInterval(()=>{const seconds=Math.floor((Date.now()-startedAt)/1000);
      el('live-duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
      if(seconds>=600)end();},1000);
  }
  function mode(live) {
    if(!live && (peer || el('live-start').disabled))end();
    if(!live)timeline.stop();
    if(live && !callOwner && !peer && !closing && !el('live-start').disabled)status('Em bấm Bắt đầu nói khi sẵn sàng nhé.');
    el('classroom-voice').hidden=!live;
    el('classroom-text').hidden=live;
    document.querySelector('.classroom-chat-window').dataset.mode=live?'live':'text';
    for(const button of document.querySelectorAll('[data-chat-mode]'))button.setAttribute('aria-pressed',String(button.dataset.chatMode===(live?'live':'text')));
  }
  el('live-start').addEventListener('click',start);
  el('live-end').addEventListener('click',()=>end());
  el('live-play-audio').addEventListener('click',async()=>{
    const run=version;
    try{await el('live-audio').play();if(run===version){el('live-play-audio').hidden=true;status('Đã bật âm thanh.');turn();}}
    catch{if(run===version)status('Chưa phát được âm thanh. Kiểm tra thiết bị rồi thử lại.');}
  });
  el('live-commands').addEventListener('click',event=>{
    const text=commands[event.target?.dataset?.command];
    if(!text || !ready || closing || teacherSpeaking)return;
    teacherExpectedUntil=Date.now()+4000;turn();
    if(liveSocket?.readyState===1)liveSocket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text}]}],turnComplete:true}}));
    else if(channel?.readyState==='open')channel.send(JSON.stringify({type:'session.commentary.append',event_id:'cmd_'+Date.now(),delegation_id:null,content:text}));
  });
  el('live-mute').addEventListener('click',()=>{
    const mute=el('live-mute').getAttribute('aria-pressed')!=='true';
    userMuted=mute;turn();
    el('live-mute').setAttribute('aria-pressed',String(mute));el('live-mute').textContent=mute?'Bật micro':'Tắt micro';
  });
  for(const button of document.querySelectorAll('[data-chat-mode]'))button.addEventListener('click',()=>mode(button.dataset.chatMode==='live'));
  // The browser drops the wake lock when the tab is hidden; take it again on return.
  window.addEventListener('focus',()=>{if(ready&&!closing)keepAwake();});
  window.addEventListener('pagehide',()=>{end(true);timeline.stop();});
  window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#classroom')){end();timeline.stop();}});
  window.checkLiveAccount=()=>{
    timeline.accountChanged();
    if(!signedInUser || callOwner && callOwner!==signedInUser?.user_id)mode(false);
  };
  window.addEventListener('vjbot-account-ready',window.checkLiveAccount);
  window.stopLiveConversation=()=>{end();timeline.stop();timeline.accountChanged();};
  window.openLiveConversation=()=>{if(!signedInUser)return;mode(true);};
  paint(new Float32Array(BARS),0);
})();
