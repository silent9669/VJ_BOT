// GPT-Live carries microphone audio over WebRTC; Gemini Live carries it over a WebSocket. Keys stay on the Worker or as ephemeral tokens.
(function () {
  const el = id => document.getElementById(id);
  let peer=null, stream=null, channel=null, abort=null, version=0, ready=false, closing=false;
  let timer=null, closeTimer=null, connectTimer=null, disconnectedTimer=null, startedAt=0;
  const BARS=33,SILENCE='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let audioContext=null,analyser=null,waveFrame=null,callOwner=null,statsTimer=null,remoteLevel=0;
  let liveSocket=null,captureNode=null,captureSource=null,nextPlayTime=0;
  let mistralRoom=null,mistralClose=null,mistralSegments={};
  const cascadedCommands=new Set(['hint','repeat','slower','situation','check','explain','summary']);
  const sttNames={openai:'OpenAI',mistral:'Mistral',elevenlabs:'ElevenLabs',browser:'trình duyệt'};
  const ttsNames={...sttNames,gemini:'Gemini',openai_compatible:'máy chủ tùy chỉnh'};
  const nativeMode='Kết nối trực tiếp gốc';
  const nativeUnavailable='Nói trực tiếp cần kết nối OpenAI chính thức, Gemini gốc hoặc Mistral gốc trong Cài đặt.';
  const liveError=message=>Object.assign(new Error(message),{userFacing:true});
  let cascaded=null,cascadedSession=null,cascadedState=null,teacherSink=null,wakeRequest=0;
  const audioSources=[];
  let wakeLock=null,commands={},teacherAnalyser=null,teacherHeardAt=0,teacherExpectedUntil=0,teacherSpeaking=false,userMuted=false;
  // Keep the screen on during a call: iPhone locking the screen drops the microphone.
  const keepAwake=async()=>{
    const request=++wakeRequest,run=version;
    try{
      const lock=await navigator.wakeLock?.request('screen');
      if(request!==wakeRequest || run!==version || closing || !ready){if(lock!==wakeLock)await lock?.release();return;}
      if(wakeLock!==lock)wakeLock?.release().catch(()=>{});
      wakeLock=lock;
    }catch{ /* Wake Lock is optional. */ }
  };
  const letSleep=()=>{++wakeRequest;wakeLock?.release?.().catch(()=>{});wakeLock=null;};
  const timeline = createLiveTranscript(el('live-transcript'));
  const status = text => { el('live-status').textContent=text; };
  const nativePrivacy=el('live-privacy')?.textContent;
  const liveTalk=el('live-talk'),liveTurnMode=el('live-turn-mode');
  function controls(active) {
    el('live-start').disabled=active;
    el('live-end').disabled=!active;
    el('live-mute').disabled=!ready || closing;
    el('live-end').hidden=!active;el('live-mute').hidden=!active;
    el('live-stage').dataset.active=String(ready && !closing);
    turn();
  }
  function drawCascaded() {
    if(!liveTalk || !liveTurnMode)return;
    const state=ready && cascadedState;
    liveTurnMode.hidden=!state;
    liveTalk.hidden=!state || state.mode!=='ptt';
    if(!state)return;
    liveTurnMode.value=state.mode;
    liveTalk.disabled=state.muted || (!cascadedSession.live.barge_in && !['listening','recording'].includes(state.phase));
    liveTalk.textContent=state.phase==='recording'?'Dừng và gửi':'Bấm để nói';
    liveTalk.setAttribute('aria-pressed',String(state.phase==='recording'));
    el('live-stage').dataset.turn=state.muted?'muted':state.phase==='speaking'?'teacher':'you';
    el('live-commands').hidden=false;
    for(const button of el('live-commands').querySelectorAll('button'))button.disabled=false;
    status(state.muted?'Micro đang tắt':{
      listening:state.mode==='ptt'?'Bấm để nói khi sẵn sàng nhé.':'Đến lượt em nói nhé.',
      recording:'Đang thu lời em…',thinking:'Thầy đang chuẩn bị trả lời…',speaking:'Thầy đang nói…'
    }[state.phase] || 'Đang kết nối…');
  }
  // One speaker at a time: the microphone stays closed while the teacher talks and opens when the teacher stops.
  function turn() {
    if(cascadedSession){drawCascaded();return;}
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
    const oldCascaded=cascaded,wasCascaded=Boolean(cascadedSession);cascaded=null;cascadedSession=null;cascadedState=null;
    oldCascaded?.stop();
    teacherSink?.disconnect();teacherSink=null;
    drawCascaded();
    clearInterval(timer); clearTimeout(closeTimer); clearTimeout(connectTimer); clearTimeout(disconnectedTimer);
    abort?.abort(); abort=null;
    stream?.getTracks().forEach(track=>track.stop()); stream=null;
    const oldChannel=channel, oldPeer=peer, oldSocket=liveSocket, oldRoom=mistralRoom, closeMistral=mistralClose;
    channel=null;peer=null;liveSocket=null;mistralRoom=null;mistralClose=null;mistralSegments={};
    oldChannel?.close(); oldPeer?.close(); oldSocket?.close(); oldRoom?.disconnect?.();
    closeMistral?.();
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
    if(wasCascaded)describeNextCall();
    timeline.finish();
  }
  function connectWave(media,teacher=false) {
    if(!audioContext || !analyser)return;
    const source=audioContext.createMediaStreamSource(media);source.connect(analyser);audioSources.push(source);
    if(teacher && teacherAnalyser)source.connect(teacherAnalyser);
  }
  function wave(composed=false) {
    const canvas=el('live-wave'),ctx=canvas?.getContext?.('2d');
    const AudioContext=window.AudioContext || window.webkitAudioContext;
    if(!AudioContext || (!ctx && !composed))return;
    audioContext=new AudioContext();
    const resumed=audioContext.resume();resumed.catch(()=>{});
    analyser=audioContext.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.65;
    teacherAnalyser=audioContext.createAnalyser();teacherAnalyser.fftSize=512;
    const samples=new Uint8Array(analyser.fftSize),levels=new Float32Array(BARS);
    if(!composed)statsTimer=setInterval(pollRemoteLevel,150);
    const draw=()=>{
      if(!analyser)return;
      if(!composed)teacherPulse();
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
    };if(ctx)draw();
    return resumed;
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
  function cascadedReference() {
    const context=globalThis.teacherContext?.(),lesson=(typeof chatLessonContext==='undefined'?null:chatLessonContext) || context?.lesson;
    const same=lesson && context?.lesson?.id===lesson.id && context.lesson.level===lesson.level;
    const focus=same?context.focus:null,task=focus?.kind==='question'?context.task:null;
    if(focus?.kind==='question' && !task)throw Object.assign(new Error('Bài tập đã đổi. Em mở lại câu này trước khi tiếp tục nhé.'),{userFacing:true});
    return {
      body:{level:lesson?.level || (typeof activeCurriculumLevel==='undefined'?'N5':activeCurriculumLevel) || 'N5',
        ...(lesson?{lesson:{id:lesson.id,level:lesson.level}}:{}),...(focus?{focus}:{}),
        ...(task?{view:context.view || 'checks'}:{})},
      task
    };
  }
  function chatIdentity(owner,admin) {
    return admin?'platform_openai':usesAntigravityOAuth(owner)
      ? JSON.stringify(['antigravity',antigravityConnectionId(owner)])
      : JSON.stringify(window.VJProfiles?.active(owner) || null);
  }
  function cascadedIdentity(owner,admin,routing) {
    if(owner!==signedInUser?.user_id || admin!==(signedInUser?.is_admin===true))return null;
    const saved=routing.stored();
    if(!saved)return null;
    const {body,task}=cascadedReference();
    return JSON.stringify([routing.liveIdentity(saved),chatIdentity(owner,admin),body,task?taskRevisionSource(task):null]);
  }
  async function liveSettings(path,signal) {
    const response=await apiFetch(path,{signal});
    if(!response.ok)throw liveError('Chưa kiểm tra được kết nối. Kiểm tra mạng rồi thử lại.');
    return response.json();
  }
  async function cascadedChatBinding(owner,admin,signal) {
    const missing=()=>liveError('Giọng song ngữ cần kết nối trò chuyện. Vào Cài đặt → Kết nối AI, chọn kết nối và model chat.');
    if(admin){
      const {platform}=await liveSettings('/api/ai/settings',signal);
      if(!platform?.configured)throw liveError('OpenAI quản trị chưa sẵn sàng. Kiểm tra khóa máy chủ trong Cài đặt quản trị.');
      return;
    }
    if(usesAntigravityOAuth(owner)){
      const id=antigravityConnectionId(owner);
      if(!id)throw missing();
      const {configured,connections}=await liveSettings('/api/ai/oauth/antigravity',signal);
      if(!configured || !connections?.some(row=>row.id===id && row.state==='active' && row.model))throw missing();
      return;
    }
    const profiles=window.VJProfiles,choice=profiles?.active(owner);
    if(!profiles || choice?.scope==='none')throw missing();
    if(choice?.scope==='local'){
      const profile=await profiles.load(owner,choice.id).catch(()=>null);
      if(!profile?.model)throw missing();
      return {...choice,revision:profile.revision};
    }
    // Unpinned multiple-choice guidance can run locally without a Chat provider.
    if(!choice && cascadedReference().task?.mode==='choice')return;
    const profile=choice?.scope==='server'
      ? (await liveSettings('/api/ai/profiles',signal)).profiles?.find(row=>row.id===choice.id)
      : (await liveSettings('/api/ai/settings',signal)).own;
    if(!profile?.model || profile.connection_id===null)throw missing();
    if(!choice && profile.id) return {serverDefault:profile.id};
  }
  function describeCascaded(config,live,owner,admin,provider) {
    const chat=admin?'OpenAI máy chủ':usesAntigravityOAuth(owner)?'Antigravity':'kết nối AI đã chọn';
    const slots=config.mode==='single'?[config.primary]:[config.ja,config.vi];
    const teachers=[...new Set(slots.map(slot=>ttsNames[slot?.provider || config.primary?.provider]).filter(Boolean))].join(' / ');
    const transcription=provider==='browser' || live.stt_source==='browser'?'dịch vụ nhận diện của trình duyệt (có thể xử lý từ xa)'
      : sttNames[provider] || (live.stt_source==='chat'?'kết nối trò chuyện':'kết nối giọng nói đã chọn');
    el('live-model-name').textContent=teachers?`Giọng song ngữ · ${teachers}`:'Giọng song ngữ';
    el('live-privacy').textContent=`Giọng thầy là giọng AI. Micro được chép lời qua ${transcription}. Gửi bản chép lời đến ${chat}; gửi câu trả lời đến ${teachers || 'kết nối giọng đọc đã chọn'}. Tối đa 10 phút.`;
  }
  function describeNextCall() {
    try{
      const config=window.VJVoiceRouting?.stored(),live=config && window.VJVoiceRouting.liveConfig(config);
      if(live?.engine==='cascaded'){
        describeCascaded(config,live,signedInUser?.user_id,signedInUser?.is_admin===true);return;
      }
    }catch{ /* Start reports invalid saved routing without using a fallback. */ }
    if(nativePrivacy)el('live-privacy').textContent=nativePrivacy;
    el('live-model-name').textContent=nativeMode;
  }
  function showNextCall() {
    describeNextCall();
    status(`${el('live-model-name').textContent}. Em bấm Bắt đầu nói khi sẵn sàng nhé.`);
  }
  async function openCascaded(run,owner,microphone,sttProvider) {
    const {config,live,routing,current,admin,chatBinding,chatProfile}=cascadedSession;
    if(!current()){if(run===version)cleanup('Kết nối hội thoại đã thay đổi.');return;}
    connectWave(microphone);
    teacherSink=audioContext.createGain();
    teacherSink.connect(audioContext.destination);teacherSink.connect(analyser);
    let shownProvider=null;
    describeCascaded(config,live,owner,admin,shownProvider);
    cascaded=window.VJLiveCascaded.create({audioContext,microphone,sink:teacherSink,live,chatBinding,chatProfile,sttProvider,
      route:signal=>routing.prepared(config,signal),stt:signal=>routing.preparedStt(config,signal),
      current(){
        if(current())return true;
        if(run===version)cleanup('Kết nối hội thoại đã thay đổi. Bấm Bắt đầu nói để kết nối lại.');
        return false;
      },
      async context(){
        const {body,task}=cascadedReference();
        if(task)body.task=await taskReference(task);
        return body;
      },
      onState(state){
        if(!current())return;
        cascadedState=state;
        if(state.sttProvider && state.sttProvider!==shownProvider){
          shownProvider=state.sttProvider;describeCascaded(config,live,owner,admin,shownProvider);
        }
        if(!ready && state.phase!=='connecting'){
          ready=true;startedAt=Date.now();controls(true);void keepAwake();
        }
        drawCascaded();
      },
      onCaption(data){if(current())timeline.upsert(data);},
      onError(message,fatal){if(!current())return;if(fatal)cleanup(message);else status(message);}
    });
    await cascaded.start();
  }
  async function start() {
    if(peer || liveSocket || mistralRoom || el('live-start').disabled)return;
    if(!signedInUser || !navigator.mediaDevices?.getUserMedia){status('Đăng nhập và dùng trình duyệt hỗ trợ micro qua HTTPS hoặc localhost.');return;}
    const owner=signedInUser.user_id,admin=signedInUser.is_admin===true,routing=window.VJVoiceRouting;
    let config,live,key;
    try{
      config=routing?.stored();
      live=config?routing.liveConfig(config):null;
      if(live?.engine==='cascaded'){
        if(!window.VJLiveCascaded)throw new Error('Chưa tải được hội thoại song ngữ. Hãy tải lại trang.');
        key=cascadedIdentity(owner,admin,routing);
      }
    }catch(error){status(error.message);return;}
    // Unlock audio inside this click, before microphone or network awaits.
    if(!key){
      const speaker=el('live-audio');
      if(!speaker.srcObject){speaker.src=SILENCE;speaker.play?.()?.catch?.(()=>{});}
    }
    const run=++version;
    if(key)cascadedSession={config,live,routing,admin,current(){
      try{return run===version && location.hash.startsWith('#classroom') && cascadedIdentity(owner,admin,routing)===key;}
      catch{return false;}
    }};
    callOwner=owner;
    timeline.reset();
    el('live-duration').textContent='00:00';controls(true);
    if(cascadedSession)timer=setInterval(()=>{
      if(!cascadedSession.current()){cleanup('Kết nối hội thoại đã thay đổi. Bấm Bắt đầu nói để kết nối lại.');return;}
      if(!ready)return;
      const seconds=Math.floor((Date.now()-startedAt)/1000);
      if(seconds>=600){end(true);return;}
      el('live-duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    },1000);
    try {
      globalThis.stopSpeech?.();globalThis.stopJapaneseInputs?.();
      const resumed=wave(Boolean(key));
      let engine,sttProvider;
      if(key){
        if(!audioContext || !resumed)throw liveError('Trình duyệt không hỗ trợ âm thanh hội thoại.');
        status('Đang kiểm tra kết nối trò chuyện và chép lời…');
        const session=cascadedSession,controller=abort=new AbortController();
        const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]);
        const current=()=>!signal.aborted && session.current();
        try{
          const binding=await cascadedChatBinding(owner,admin,signal);
          session.chatProfile=binding?.serverDefault;
          session.chatBinding=session.chatProfile ? undefined : binding;
          if(current())sttProvider=await window.VJLiveCascaded.selectStt({live,chatBinding:session.chatBinding,chatProfile:session.chatProfile,
            stt:signal=>routing.preparedStt(config,signal),signal,current});
          let resumeTimer;
          try{await Promise.race([resumed,new Promise((_,reject)=>{resumeTimer=setTimeout(()=>reject(new Error('Trình duyệt chưa cho phát âm thanh. Bấm Bắt đầu nói lại.')),5000);})]);}
          catch {throw new Error('Trình duyệt chưa cho phát âm thanh. Bấm Bắt đầu nói lại.');}
          finally{clearTimeout(resumeTimer);}
          signal.throwIfAborted();
        }catch(error){
          throw liveError(signal.aborted?'Kiểm tra kết nối quá lâu. Em kiểm tra mạng rồi thử lại nhé.':error.message);
        }
        if(run!==version)return;
        if(!session.current()){cleanup('Kết nối hội thoại đã thay đổi.');return;}
      }else{
        engine=admin?{name:'openai'}:await liveEngine(owner,(abort=new AbortController()).signal);
        if(run!==version)return;
        if(owner!==signedInUser?.user_id){cleanup('Tài khoản đã thay đổi.');return;}
        if(!engine){cleanup(nativeUnavailable);return;}
        if(engine.name==='openai' && typeof RTCPeerConnection==='undefined'){cleanup('Trình duyệt cần hỗ trợ WebRTC để kết nối OpenAI trực tiếp.');return;}
      }
      status('Cho phép micro để bắt đầu…');
      const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,...(key?{autoGainControl:true}:{})},video:false});
      if(run!==version || owner!==signedInUser?.user_id){microphone.getTracks().forEach(track=>track.stop());if(run===version)cleanup('Tài khoản đã thay đổi.');return;}
      stream=microphone;
      if(key){await openCascaded(run,owner,microphone,sttProvider);return;}
      if(engine.name==='gemini'){await startGemini(run,microphone);return;}
      if(engine.name==='mistral'){await startMistral(run,microphone,owner,engine);return;}
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
  const isMistralProfile=profile=>profile?.protocol==='openai' && profile.base_url==='https://api.mistral.ai/v1';
  async function liveEngine(owner,signal) {
    const profiles=window.VJProfiles;
    if(!profiles || usesAntigravityOAuth(owner))return null;
    const binding=chatIdentity(owner,false),selected=profiles.active(owner);
    if(selected?.scope==='none')return null;
    if(selected?.scope==='local'){
      const profile=(await profiles.list(owner)).find(row=>row.id===selected.id);
      return isMistralProfile(profile) && profile.model ? {name:'mistral',localId:selected.id,binding} : null;
    }
    // Mistral can use an explicitly selected server profile even if it is not the account default.
    const settings=await liveSettings('/api/ai/settings',signal),own=settings?.own;
    if(settings?.is_admin)return {name:'openai'};
    if(selected?.scope==='server' && selected.id!==own?.id){
      const {profiles}=await liveSettings('/api/ai/profiles',signal);
      const profile=profiles?.find(row=>row.id===selected.id);
      return isMistralProfile(profile) && profile.model && profile.connection_id!==null
        ? {name:'mistral',serverId:selected.id,binding} : null;
    }
    if(isMistralProfile(own))return own.model && own.connection_id!==null ? {name:'mistral',serverId:own.id,binding} : null;
    const host=protocol=>new URL((own?.base_url||'').trim()||settings?.bases?.[protocol]||'https://x').hostname;
    if(own?.protocol==='gemini' && /(^|\.)generativelanguage\.googleapis\.com$/.test(host('gemini')))return {name:'gemini'};
    if(own?.protocol==='openai' && /(^|\.)openai\.com$/.test(host('openai')))return {name:'openai'};
    return null;
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
  async function startMistral(run,microphone,owner,{localId,serverId,binding}) {
    status('Đang kết nối với thầy…');
    await loadLiveKit();
    if(run!==version)return;
    if(owner!==signedInUser?.user_id){cleanup('Tài khoản đã thay đổi.');return;}
    let apiConnection;
    if(localId){
      const profile=await window.VJProfiles.load(owner,localId).catch(()=>null);
      if(run!==version)return;
      if(owner!==signedInUser?.user_id){cleanup('Tài khoản đã thay đổi.');return;}
      const selected=window.VJProfiles.active(owner);
      if(signedInUser.is_admin || selected?.scope!=='local' || selected.id!==localId || !isMistralProfile(profile) || !profile.model)
        throw Object.assign(new Error('Kết nối Mistral không còn dùng được. Kiểm tra kết nối trong Cài đặt rồi thử lại.'),{userFacing:true});
      apiConnection={protocol:profile.protocol,base_url:profile.base_url,model:profile.model,api_key:profile.api_key};
    }
    if(signedInUser.is_admin || chatIdentity(owner,false)!==binding)
      throw liveError('Kết nối Mistral không còn dùng được. Kiểm tra kết nối trong Cài đặt rồi thử lại.');
    const headers={'Content-Type':'application/json',...(serverId?{'X-VJBot-Profile':serverId}:{})};
    const request=(method,body,signal)=>apiFetch('/api/live/mistral',{method,signal,redirect:'error',headers,
      body:JSON.stringify(apiConnection?{...body,api_connection:apiConnection}:body)});
    const context=globalThis.teacherContext?.();
    const lesson=(typeof chatLessonContext!=='undefined'?chatLessonContext:null) || context?.lesson;
    // Let an already dispatched create settle after local cancellation so its room can be closed.
    const response=await request('POST',{level:lesson?.level || activeCurriculumLevel || 'N5',lesson:lesson?{id:lesson.id,level:lesson.level}:null},AbortSignal.timeout(65000));
    const result=await response.json();
    const close=()=>{
      if(signedInUser?.user_id!==owner || signedInUser.is_admin)return;
      const closingVersion=version;
      const warn=()=>{if(closingVersion===version && !el('live-start').disabled)
        status('Đã ngắt kết nối trên thiết bị. Mistral chưa xác nhận đóng phiên.');};
      request('DELETE',{id:result.id},AbortSignal.timeout(15000)).then(closed=>{if(!closed.ok)warn();},warn);
    };
    if(run!==version){if(response.ok)close();return;}
    if(owner!==signedInUser?.user_id){cleanup('Tài khoản đã thay đổi.');return;}
    if(!response.ok)throw Object.assign(new Error(result.detail || 'Không mở được cuộc gọi.'),{userFacing:true});
    mistralClose=close;
    commands={};
    const {Room,RoomEvent,Track}=window.VJLiveKit,room=mistralRoom=new Room();
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
      if(event?.type==='error'){
        const detail=(typeof event.source==='string'?event.source.slice(0,40):'agent')+': '+(typeof event.message==='string'?event.message.slice(0,200):'');
        console.warn('Mistral live error',event.source,event.code,event.message);
        if(event.fatal===true)cleanup('Cuộc gọi gặp lỗi ('+detail+'). Hãy thử lại.');
        else status('Mistral báo lỗi ('+detail+')');
        return;
      }
      if(event?.type!=='transcription.segment' || !['user','assistant'].includes(event.role) || typeof event.content!=='string' || typeof event.id!=='string')return;
      const now=Date.now()-startedAt;
      mistralSegments[event.id]??=Math.max(0,now-2000);
      timeline.upsert({role:event.role,key:event.id,text:event.content,start_ms:mistralSegments[event.id],end_ms:now});
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
    if(live && !el('live-start').disabled)showNextCall();
    if(!live)timeline.stop();
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
  liveTurnMode?.addEventListener('change',()=>cascaded?.setMode(liveTurnMode.value));
  liveTalk?.addEventListener('click',()=>cascaded?.toggleTalk());
  el('live-commands').addEventListener('click',event=>{
    const key=event.target?.dataset?.command;
    if(cascaded){if(ready && cascadedCommands.has(key))void cascaded.sendCommand(key);return;}
    const text=commands[event.target?.dataset?.command];
    if(!text || !ready || closing || teacherSpeaking)return;
    teacherExpectedUntil=Date.now()+4000;turn();
    if(liveSocket?.readyState===1)liveSocket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text}]}],turnComplete:true}}));
    else if(channel?.readyState==='open')channel.send(JSON.stringify({type:'session.commentary.append',event_id:'cmd_'+Date.now(),delegation_id:null,content:text}));
  });
  el('live-mute').addEventListener('click',()=>{
    const mute=el('live-mute').getAttribute('aria-pressed')!=='true';
    userMuted=mute;
    if(cascaded){
      stream?.getAudioTracks().forEach(track=>{track.enabled=!mute;});
      cascaded.setMuted(mute);
    }else turn();
    el('live-mute').setAttribute('aria-pressed',String(mute));el('live-mute').textContent=mute?'Bật micro':'Tắt micro';
  });
  for(const button of document.querySelectorAll('[data-chat-mode]'))button.addEventListener('click',()=>mode(button.dataset.chatMode==='live'));
  // The browser drops the wake lock when the tab is hidden; take it again on return.
  window.addEventListener('focus',()=>{if(ready&&!closing)keepAwake();});
  window.addEventListener('pagehide',()=>{end(true);timeline.stop();});
  window.addEventListener('hashchange',()=>{
    if(!location.hash.startsWith('#classroom')){end();timeline.stop();}
    else checkCascaded();
  });
  window.checkLiveAccount=()=>{
    timeline.accountChanged();
    if(!signedInUser || callOwner && callOwner!==signedInUser?.user_id)mode(false);
    else checkCascaded();
  };
  window.addEventListener('vjbot-account-ready',window.checkLiveAccount);
  function checkCascaded() {
    if(cascadedSession && !cascadedSession.current()){
      cleanup('Kết nối hội thoại đã thay đổi. Bấm Bắt đầu nói để kết nối lại.');return;
    }
    if(!el('classroom-voice').hidden && !el('live-start').disabled)showNextCall();
  }
  window.addEventListener('vjbot-voice-changed',checkCascaded);
  window.addEventListener('storage',checkCascaded);
  const chatChanged=()=>{
    if(cascadedSession)cleanup('Kết nối trò chuyện đã thay đổi. Bấm Bắt đầu nói để kết nối lại.');
    else if(!el('classroom-voice').hidden && !el('live-start').disabled)showNextCall();
  };
  window.addEventListener('vjbot-chat-connection-changed',chatChanged);
  const oldAiConnectionChanged=window.aiConnectionChanged;
  window.aiConnectionChanged=()=>{chatChanged();oldAiConnectionChanged?.();};
  window.stopLiveConversation=()=>{end();timeline.stop();timeline.accountChanged();};
  window.openLiveConversation=()=>{if(!signedInUser)return;mode(true);};
  paint(new Float32Array(BARS),0);
})();
