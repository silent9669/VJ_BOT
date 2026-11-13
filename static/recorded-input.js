// Short recordings use the selected official OpenAI connection; no browser speech service is needed.
function createRecordedJapaneseInput({button,input,status,playbackButton,onError}) {
  const label=button.querySelector?.('span:last-child') || button,idle=label.textContent;
  const fallback=createBrowserJapaneseInput({button,input,status,playbackButton,onError,bindButton:false});
  let phase='idle',generation=0,stream=null,recorder=null,abort=null,timer=null,url=null,playback=null;
  const announce=message=>{if(status){status.textContent=message;status.hidden=!message || message==='Micro sẵn sàng';}};
  function draw(next) {
    phase=next;button.setAttribute('aria-pressed',String(next==='recording'));
    button.setAttribute('aria-busy',String(next==='checking'||next==='transcribing'));
    label.textContent=next==='idle'?idle:next==='recording'?'Dừng ghi âm':'Huỷ';
  }
  function release() {
    clearTimeout(timer);timer=null;
    if(recorder?.state==='recording')recorder.stop();
    stream?.getTracks().forEach(track=>track.stop());stream=null;
  }
  function reset() {
    ++generation;abort?.abort();abort=null;fallback.reset();release();draw('idle');
    playback?.pause();if(url){URL.revokeObjectURL(url);url=null;}
    if(playbackButton)playbackButton.hidden=true;announce('Micro sẵn sàng');
  }
  async function request(body,signal) {
    const response=await apiFetch('/api/stt',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw new Error(data.detail || 'Chưa chép được bản ghi. Hãy thử lại.');return data;
  }
  async function transcribe(blob,run) {
    if(run!==generation)return;
    if(!blob.size){draw('idle');announce('Chưa có âm thanh. Ghi lại hoặc nhập câu trả lời.');return;}
    draw('transcribing');announce('Đang chép lời tiếng Nhật…');
    try {
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      if(run!==generation)return;
      const result=await request({audio:btoa(binary),mime_type:blob.type},abort.signal);
      if(run!==generation)return;
      if(!result.text){announce('Chưa nghe rõ lời nói. Ghi lại hoặc nhập câu trả lời.');return;}
      input.value=[input.value.trim(),result.text].filter(Boolean).join(' ').slice(0,6000);
      input.dispatchEvent?.(new Event('input',{bubbles:true}));input.focus();announce('Đã chép lời. Kiểm tra câu trả lời trước khi gửi.');
    } catch(error){if(run===generation){announce(error.message);onError?.(error.message);}}
    finally {if(run===generation)draw('idle');}
  }
  async function toggle() {
    if(fallback.active){fallback.toggle();return;}
    if(phase==='recording'){release();return;}
    if(phase!=='idle'){reset();return;}
    const run=++generation;fallback.reset();playback?.pause();if(url){URL.revokeObjectURL(url);url=null;}if(playbackButton)playbackButton.hidden=true;abort=new AbortController();draw('checking');announce('Đang mở micro…');
    try {
      const capabilities=await request({action:'capabilities'},abort.signal);
      if(run!==generation)return;
      if(!capabilities.supported){draw('idle');fallback.toggle();return;}
      globalThis.stopSpeech?.();
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(run!==generation){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;const chunks=[];let size=0;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>window.MediaRecorder.isTypeSupported?.(type));
      const capture=recorder=new window.MediaRecorder(stream,mime?{mimeType:mime}:{});
      capture.ondataavailable=event=>{
        if(run!==generation || !event.data?.size)return;
        size+=event.data.size;
        if(size>2*1024*1024){reset();announce('Bản ghi quá lớn. Hãy ghi một câu ngắn hơn.');return;}
        chunks.push(event.data);
      };
      capture.onerror=()=>{if(run===generation){reset();announce('Không ghi được âm thanh. Kiểm tra micro rồi thử lại.');}};
      capture.onstop=()=>{
        if(run!==generation)return;
        release();const blob=new Blob(chunks,{type:capture.mimeType || mime || 'audio/webm'});
        if(playbackButton){if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);playbackButton.hidden=false;}
        transcribe(blob,run);
      };
      capture.start(1000);draw('recording');announce('Đang ghi âm · Nhấn Dừng để chép lời · tối đa 60 giây');
      timer=setTimeout(release,60000);
    }catch(error){if(run===generation){release();draw('idle');const message=error.name==='NotAllowedError'?'Cho phép micro trong trình duyệt rồi thử lại.':error.message;announce(message);onError?.(message);}}
  }
  button.addEventListener('click',toggle);
  playbackButton?.addEventListener('click',()=>{if(url){playback?.pause();playback=new Audio(url);playback.play().catch(()=>announce('Chưa phát được bản ghi. Hãy thử lại.'));}});
  const controller={reset};japaneseInputs.push(controller);return controller;
}
