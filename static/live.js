// GPT-Live carries microphone audio over WebRTC; the project key stays on the Worker.
(function () {
  const el = id => document.getElementById(id);
  let peer=null, stream=null, channel=null, abort=null, version=0, ready=false, closing=false;
  let timer=null, closeTimer=null, connectTimer=null, disconnectedTimer=null, startedAt=0;
  let audioContext=null,analyser=null,waveFrame=null,callOwner=null;
  const audioSources=[];
  const timeline = createLiveTranscript(el('live-transcript'));
  const status = text => { el('live-status').textContent=text; };
  function controls(active) {
    el('live-start').disabled=active;
    el('live-end').disabled=!active;
    el('live-mute').disabled=!ready || closing;
    el('live-end').hidden=!active;el('live-mute').hidden=!active;
    el('live-stage').dataset.active=String(ready && !closing);
  }
  function cleanup(message) {
    ++version; ready=false; closing=false;
    clearInterval(timer); clearTimeout(closeTimer); clearTimeout(connectTimer); clearTimeout(disconnectedTimer);
    abort?.abort(); abort=null;
    stream?.getTracks().forEach(track=>track.stop()); stream=null;
    const oldChannel=channel, oldPeer=peer; channel=null;peer=null;
    oldChannel?.close(); oldPeer?.close();
    if(waveFrame!==null)cancelAnimationFrame(waveFrame);waveFrame=null;
    audioSources.splice(0).forEach(source=>source.disconnect());
    audioContext?.close().catch(()=>{});audioContext=null;analyser=null;
    const canvas=el('live-wave');canvas?.getContext?.('2d')?.clearRect(0,0,canvas.width,canvas.height);
    el('live-audio').srcObject=null;
    el('live-play-audio').hidden=true;
    el('live-mute').setAttribute('aria-pressed','false');el('live-mute').textContent='Tắt micro';
    controls(false); if (message) status(message);
    timeline.finish();
  }
  function connectWave(media) {
    if(!audioContext || !analyser)return;
    const source=audioContext.createMediaStreamSource(media);source.connect(analyser);audioSources.push(source);
  }
  function wave() {
    const canvas=el('live-wave'),ctx=canvas?.getContext?.('2d');
    const AudioContext=window.AudioContext || window.webkitAudioContext;
    if(!ctx || !AudioContext)return;
    audioContext=new AudioContext();audioContext.resume().catch(()=>{});
    analyser=audioContext.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.65;
    const samples=new Uint8Array(analyser.fftSize);
    const draw=()=>{
      if(!analyser)return;
      analyser.getByteTimeDomainData(samples);ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.strokeStyle=getComputedStyle(canvas).color;ctx.lineWidth=3;ctx.beginPath();
      for(let i=0;i<samples.length;i++){const x=i/(samples.length-1)*canvas.width,y=canvas.height/2+(samples[i]-128)/128*canvas.height*.46;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);}
      ctx.stroke();waveFrame=requestAnimationFrame(draw);
    };draw();
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
        connectWave(el('live-audio').srcObject);
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
          ready=true;clearTimeout(connectTimer);controls(true);status('Đang nghe · Em có thể nói ngay');startedAt=Date.now();
          events.send(JSON.stringify({type:'session.commentary.append',event_id:'hello_'+Date.now(),delegation_id:null,content:greeting}));
          timer=setInterval(()=>{
            const seconds=Math.floor((Date.now()-startedAt)/1000);
            el('live-duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
            if(seconds>=600)end();
          },1000);
        } else if(event.type==='session.closed')cleanup('Đã kết thúc cuộc trò chuyện.');
        else if(['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type))timeline.add(event);
        else if(event.type==='error')cleanup('GPT-Live báo lỗi. Kết thúc phiên; hãy thử lại.');
      });
      events.addEventListener('close',()=>{if(run===version)cleanup('Kết nối đã đóng.');});
      status('Đang mở GPT-Live…');
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
      if(!response.ok)throw new Error(result.detail || 'Không mở được GPT-Live.');
      greeting=result.greeting;
      el('live-model-name').textContent=result.model+' · '+result.voice;
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
  el('live-mute').addEventListener('click',()=>{
    const mute=el('live-mute').getAttribute('aria-pressed')!=='true';
    stream?.getAudioTracks().forEach(track=>{track.enabled=!mute;});
    el('live-mute').setAttribute('aria-pressed',String(mute));el('live-mute').textContent=mute?'Bật micro':'Tắt micro';
  });
  for(const button of document.querySelectorAll('[data-chat-mode]'))button.addEventListener('click',()=>mode(button.dataset.chatMode==='live'));
  window.addEventListener('pagehide',()=>{end(true);timeline.stop();});
  window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#classroom')){end();timeline.stop();}});
  window.checkLiveAccount=()=>{
    timeline.accountChanged();
    if(!signedInUser?.is_admin || callOwner && callOwner!==signedInUser?.user_id)mode(false);
  };
  window.addEventListener('vjbot-account-ready',window.checkLiveAccount);
  window.stopLiveConversation=()=>{end();timeline.stop();timeline.accountChanged();};
  window.openLiveConversation=()=>{if(!signedInUser?.is_admin)return;mode(true);return start();};
})();
