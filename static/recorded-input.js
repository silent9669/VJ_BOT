// Short recordings use the selected connection's STT capability, never another paid provider.
function createRecordedJapaneseInput({button,input,status,playbackButton,onError}) {
  const label=button.querySelector?.('span:last-child') || button,idle=label.textContent;
  const fallback=createBrowserJapaneseInput({button,input,status,playbackButton,onError,bindButton:false});
  const owner=()=>typeof signedInUser==='undefined'?'':signedInUser?.user_id || '';
  const route=()=>globalThis.location?.hash || '';
  let phase='idle',generation=0,stream=null,recorder=null,abort=null,timer=null,url=null,urlRun=null,playback=null;
  const owns=run=>run.generation===generation && run.owner===owner() && run.route===route();
  const announce=message=>{if(status){status.textContent=message;status.hidden=!message || message==='Micro sẵn sàng';}};
  const describe=error=>{
    if(error.userFacing)return error.message;
    if(['NotAllowedError','SecurityError'].includes(error.name))return 'Cho phép micro trong trình duyệt rồi thử lại hoặc nhập câu trả lời.';
    if(['NotFoundError','DevicesNotFoundError'].includes(error.name))return 'Không tìm thấy micro. Kết nối micro hoặc nhập câu trả lời.';
    if(error.name==='NotReadableError')return 'Micro đang bận hoặc không khả dụng. Đóng ứng dụng đang dùng micro rồi thử lại hoặc nhập câu trả lời.';
    if(error.name==='SyntaxError')return 'Phản hồi chép lời không hợp lệ. Nhập câu trả lời hoặc thử lại.';
    if(error.name==='TypeError')return 'Không kết nối được dịch vụ chép lời. Kiểm tra mạng rồi thử lại hoặc nhập câu trả lời.';
    return 'Không xử lý được âm thanh. Kiểm tra thiết bị rồi thử lại hoặc nhập câu trả lời.';
  };
  function draw(next) {
    phase=next;button.setAttribute('aria-pressed',String(next==='recording'));
    button.setAttribute('aria-busy',String(next==='checking'||next==='transcribing'));
    label.textContent=next==='idle'?idle:next==='recording'?'Dừng ghi âm':'Huỷ';
  }
  function release() {
    clearTimeout(timer);timer=null;
    try {if(recorder && recorder.state!=='inactive')recorder.stop();}
    finally {stream?.getTracks().forEach(track=>track.stop());stream=null;}
  }
  function pauseReplay() {
    const previous=playback;playback=null;
    if(previous?.audio){
      previous.audio.onended=null;previous.audio.onerror=null;
      previous.audio.pause();previous.audio.removeAttribute('src');previous.audio.load();
    }
  }
  function discardReplay() {
    pauseReplay();if(url){URL.revokeObjectURL(url);url=null;}urlRun=null;
    if(playbackButton){playbackButton.hidden=true;if(playbackButton.style)playbackButton.style.display='none';}
  }
  function reset() {
    ++generation;abort?.abort();abort=null;fallback.reset();
    try {release();} catch(error){onError?.(describe(error));}
    recorder=null;draw('idle');discardReplay();announce('Micro sẵn sàng');
  }
  async function request(body,signal) {
    const response=await apiFetch('/api/stt',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.detail || 'Chưa chép được bản ghi. Hãy thử lại hoặc nhập câu trả lời.'),{userFacing:true});return data;
  }
  async function transcribe(blob,run) {
    if(!owns(run))return;
    if(!blob.size){draw('idle');announce('Chưa có âm thanh. Ghi lại hoặc nhập câu trả lời.');return;}
    draw('transcribing');announce('Đang chép lời tiếng Nhật…');
    try {
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
      if(!owns(run))return;
      const result=await request({audio:btoa(binary),mime_type:blob.type},abort.signal);
      if(!owns(run))return;
      if(!result.text){announce('Chưa nghe rõ lời nói. Ghi lại hoặc nhập câu trả lời.');return;}
      input.value=[input.value.trim(),result.text].filter(Boolean).join(' ').slice(0,6000);
      input.dispatchEvent?.(new Event('input',{bubbles:true}));input.focus();
      announce('Đã chép lời. Em xem lại câu trước khi gửi nhé.');
    } catch(error){if(owns(run)){const message=describe(error);announce(message);onError?.(message);}}
    finally {if(owns(run))draw('idle');}
  }
  async function toggle() {
    if(fallback.active){await fallback.toggle();return;}
    if(phase==='recording'){
      try {release();} catch(error){reset();const message=`Không dừng được bản ghi. ${describe(error)}`;announce(message);onError?.(message);}
      return;
    }
    if(phase!=='idle'){reset();return;}
    stopJapaneseInputs();globalThis.stopSpeech?.();
    const run={generation:++generation,owner:owner(),route:route()};
    abort=new AbortController();draw('checking');announce('Đang kiểm tra khả năng chép lời của kết nối đã chọn…');
    try {
      const capabilities=await request({action:'capabilities'},abort.signal);
      if(!owns(run))return;
      if(!capabilities.supported){draw('idle');await fallback.toggle();return;}
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!owns(run)){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;const chunks=[];let size=0;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>window.MediaRecorder.isTypeSupported?.(type));
      const capture=recorder=new window.MediaRecorder(stream,mime?{mimeType:mime}:{});
      capture.ondataavailable=event=>{
        if(!owns(run) || !event.data?.size)return;
        size+=event.data.size;
        if(size>2*1024*1024){reset();announce('Bản ghi quá lớn. Hãy ghi một câu ngắn hơn hoặc nhập câu trả lời.');return;}
        chunks.push(event.data);
      };
      capture.onerror=()=>{if(owns(run)){reset();const message='Không ghi được âm thanh. Kiểm tra micro rồi thử lại hoặc nhập câu trả lời.';announce(message);onError?.(message);}};
      capture.onstop=()=>{
        if(!owns(run))return;
        try {
          release();recorder=null;
          const type=capture.mimeType || chunks.find(chunk=>chunk.type)?.type || mime;
          const blob=new Blob(chunks,type?{type}:{});
          if(playbackButton && blob.size){
            discardReplay();url=URL.createObjectURL(blob);urlRun=run;playbackButton.hidden=false;
            if(playbackButton.style)playbackButton.style.display='inline-flex';
          }
          transcribe(blob,run);
        } catch(error){if(owns(run)){reset();const message=`Không lưu được bản ghi. ${describe(error)}`;announce(message);onError?.(message);}}
      };
      capture.start(1000);draw('recording');announce('Đang ghi âm · Nhấn Dừng để chép lời · tối đa 60 giây');
      timer=setTimeout(()=>{if(owns(run))toggle();},60000);
    }catch(error){if(owns(run)){
      reset();
      const message=describe(error);
      announce(message);onError?.(message);
    }}
  }
  async function replay() {
    if(!url){await fallback.replay();return;}
    if(!urlRun || !owns(urlRun)){discardReplay();return;}
    pauseReplay();globalThis.stopSpeech?.();
    const entry={audio:null,run:{generation,owner:owner(),route:route()}};playback=entry;
    const current=()=>playback===entry && owns(entry.run);
    try {
      entry.audio=new Audio(url);
      entry.audio.onended=()=>{if(current()){pauseReplay();announce('Đã phát xong bản ghi.');}};
      entry.audio.onerror=()=>{if(current()){pauseReplay();announce('Không phát được bản ghi. Ghi lại hoặc nhập câu trả lời.');}};
      await entry.audio.play();
    } catch(error){if(current()){pauseReplay();announce(error.name==='NotAllowedError'?'Trình duyệt đã chặn phát bản ghi. Nhấn Nghe lại lần nữa.':'Không phát được bản ghi. Ghi lại hoặc nhập câu trả lời.');}}
  }
  button.addEventListener('click',toggle);
  playbackButton?.addEventListener('click',replay);
  const controller={toggle,replay,get active(){return phase!=='idle' || fallback.active;},reset};
  japaneseInputs.push(controller);draw('idle');announce('Micro sẵn sàng');return controller;
}
