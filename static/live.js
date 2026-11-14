// GPT-Live carries microphone audio over WebRTC; the project key stays on the Worker.
(function () {
  const el = id => document.getElementById(id);
  let peer=null, stream=null, channel=null, abort=null, version=0, ready=false, closing=false;
  let timer=null, closeTimer=null, connectTimer=null, disconnectedTimer=null, startedAt=0;
  const BARS=33,SILENCE='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let audioContext=null,analyser=null,waveFrame=null,callOwner=null,statsTimer=null,remoteLevel=0;
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
    if(live)status(teacherSpeaking?'Thầy đang nói · Em đợi thầy nói xong nhé':userMuted?'Micro đang tắt':'Đến lượt em · Em nói đi');
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
    const oldChannel=channel, oldPeer=peer; channel=null;peer=null;
    oldChannel?.close(); oldPeer?.close();
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
    if (peer || el('live-start').disabled) return;
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
      stream=microphone;const connection=peer=new RTCPeerConnection();
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
      if(!response.ok)throw new Error(result.detail || 'Không mở được cuộc gọi.');
      greeting=result.greeting;commands=result.commands && typeof result.commands==='object'?result.commands:{};
      await connection.setRemoteDescription({type:'answer',sdp:result.sdp});
    } catch(error) {
      if(run!==version)return;
      cleanup(error.name==='NotAllowedError'?'Micro chưa được cho phép. Bật quyền micro rồi thử lại.':error.message || 'Không kết nối được. Hãy thử lại.');
    }
  }
  function mode(live) {
    if(!live && (peer || el('live-start').disabled))end();
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
    try{await el('live-audio').play();if(run===version){el('live-play-audio').hidden=true;status('Đang nghe · Em có thể nói ngay');}}
    catch{if(run===version)status('Chưa phát được âm thanh. Kiểm tra thiết bị rồi thử lại.');}
  });
  el('live-commands').addEventListener('click',event=>{
    const text=commands[event.target?.dataset?.command];
    if(!text || !ready || closing || teacherSpeaking || channel?.readyState!=='open')return;
    teacherExpectedUntil=Date.now()+4000;turn();
    channel.send(JSON.stringify({type:'session.commentary.append',event_id:'cmd_'+Date.now(),delegation_id:null,content:text}));
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
    if(!signedInUser?.is_admin || callOwner && callOwner!==signedInUser?.user_id)mode(false);
  };
  window.addEventListener('vjbot-account-ready',window.checkLiveAccount);
  window.stopLiveConversation=()=>{end();timeline.stop();timeline.accountChanged();};
  window.openLiveConversation=()=>{if(!signedInUser?.is_admin)return;mode(true);return start();};
  paint(new Float32Array(BARS),0);
})();
