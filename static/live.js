// GPT-Live carries microphone audio over WebRTC; the project key stays on the Worker.
(function () {
  const el = id => document.getElementById(id);
  let peer=null, stream=null, channel=null, abort=null, version=0, ready=false, closing=false;
  let timer=null, closeTimer=null, connectTimer=null, disconnectedTimer=null, startedAt=0;
  const captions = {user:[],assistant:[]};
  const status = text => { el('live-status').textContent=text; };
  function controls(active) {
    el('live-start').disabled=active;
    el('live-end').disabled=!active;
    el('live-mute').disabled=!ready || closing;
    el('live-stage').dataset.active=String(ready && !closing);
  }
  function cleanup(message) {
    ++version; ready=false; closing=false;
    clearInterval(timer); clearTimeout(closeTimer); clearTimeout(connectTimer); clearTimeout(disconnectedTimer);
    abort?.abort(); abort=null;
    stream?.getTracks().forEach(track=>track.stop()); stream=null;
    const oldChannel=channel, oldPeer=peer; channel=null;peer=null;
    oldChannel?.close(); oldPeer?.close();
    el('live-audio').srcObject=null;
    el('live-mute').setAttribute('aria-pressed','false');el('live-mute').textContent='Tắt micro';
    controls(false); if (message) status(message);
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
  function transcript(event) {
    const role=event.type==='session.input_transcript.delta'?'user':'assistant';
    if (typeof event.delta!=='string' || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)) return;
    captions[role].push({text:event.delta,start:event.start_ms,end:event.end_ms});
    // These are continuous captions, not completed or persisted conversational turns.
    if(captions[role].length>500)captions[role].shift();
    const caption=el(role==='user'?'live-user-caption':'live-teacher-caption');
    const follow=caption.scrollHeight-caption.scrollTop-caption.clientHeight<40;
    caption.textContent=captions[role].map(part=>part.text).join('').slice(-5000);
    if(follow)caption.scrollTop=caption.scrollHeight;
  }
  async function start() {
    if (peer || el('live-start').disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection==='undefined') {status('Trình duyệt cần hỗ trợ WebRTC và micro qua HTTPS hoặc localhost.');return;}
    const run=++version, owner=signedInUser?.user_id;
    captions.user=[];captions.assistant=[];
    el('live-user-caption').textContent='';el('live-teacher-caption').textContent='';
    el('live-duration').textContent='00:00';controls(true);status('Cho phép micro để bắt đầu…');
    try {
      globalThis.stopSpeech?.();globalThis.stopJapaneseInputs?.();
      const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(run!==version || owner!==signedInUser?.user_id){microphone.getTracks().forEach(track=>track.stop());if(run===version)cleanup('Tài khoản đã thay đổi.');return;}
      stream=microphone;const connection=peer=new RTCPeerConnection();
      stream.getTracks().forEach(track=>connection.addTrack(track,stream));
      connection.addEventListener('track',event=>{
        if(run!==version)return;
        el('live-audio').srcObject=new MediaStream([event.track]);
        el('live-audio').play().catch(()=>status('Nhấn phát trên thanh âm thanh để nghe thầy.'));
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
          ready=true;clearTimeout(connectTimer);controls(true);status('Đang kết nối · Em có thể nói ngay');startedAt=Date.now();
          events.send(JSON.stringify({type:'session.commentary.append',event_id:'hello_'+Date.now(),delegation_id:null,content:greeting}));
          timer=setInterval(()=>{
            const seconds=Math.floor((Date.now()-startedAt)/1000);
            el('live-duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
            if(seconds>=600)end();
          },1000);
        } else if(event.type==='session.closed')cleanup('Đã kết thúc cuộc trò chuyện.');
        else if(['session.input_transcript.delta','session.output_transcript.delta'].includes(event.type))transcript(event);
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
    el('classroom-voice').hidden=!live;
    el('classroom-text').hidden=live;
    document.querySelector('.classroom-chat-window').dataset.mode=live?'live':'text';
    for(const button of document.querySelectorAll('[data-chat-mode]'))button.setAttribute('aria-pressed',String(button.dataset.chatMode===(live?'live':'text')));
  }
  el('live-start').addEventListener('click',start);
  el('live-end').addEventListener('click',()=>end());
  el('live-mute').addEventListener('click',()=>{
    const mute=el('live-mute').getAttribute('aria-pressed')!=='true';
    stream?.getAudioTracks().forEach(track=>{track.enabled=!mute;});
    el('live-mute').setAttribute('aria-pressed',String(mute));el('live-mute').textContent=mute?'Bật micro':'Tắt micro';
  });
  for(const button of document.querySelectorAll('[data-chat-mode]'))button.addEventListener('click',()=>mode(button.dataset.chatMode==='live'));
  window.addEventListener('pagehide',()=>end(true));
  window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#classroom'))end();});
  window.addEventListener('vjbot-account-ready',()=>{
    el('chat-live-toggle').hidden=!signedInUser?.is_admin;
    if(!signedInUser?.is_admin)mode(false);
  });
  window.stopLiveConversation=()=>end();
})();
