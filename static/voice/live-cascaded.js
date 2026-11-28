(function () {
  const maxAudio=2*1024*1024, maxText=4000, maxSegments=16, managedTtsSegments=8;
  const minSpeech=350, maxRecording=30000, hangover=750;
  // The Worker limits the request to 20 KiB; reserve room for a device connection and its JSON escaping.
  const maxTurnBytes=18*1024;
  const textEncoder=new TextEncoder();
  const commands=['start','hint','explain','situation','check','slower','summary'];
  const invalidReply='Phản hồi hội thoại không hợp lệ.';
  const noSpeech='Chưa nghe rõ lời nói. Em thử nói lại nhé.';
  const captureError='Không ghi được âm thanh. Em kiểm tra micro rồi thử lại nhé.';
  const sttSettings='Trong Cài đặt → Âm thanh → Nguồn chép lời, em chọn nguồn khác.';
  const explicitUnavailable='Kết nối chép lời giọng nói đã chọn không dùng được. Hệ thống không dùng nguồn khác. '+sttSettings;
  const firstSentenceEnd=/[。！？!?…][。！？.!?…]*[」』”’"')）]*|\.+[」』”’"')）]*(?=\s|$)/gu;
  // Mirror the TTS check for spoken text and explicitly labelled numbers.
  const hasSpokenText=text=>/\p{L}/u.test(text) || /^[\d０-９][\d０-９.,，、:：%％〜～\s]*[。！？!?]?$/u.test(text);
  const leadingBlank=/^[\s「『“‘"(（]*(?:_{3,}|＿{3,})/u;
  const trailingBlank=/(?:_{3,}|＿{3,})[\s。！？.!?…」』”’"')）]*$/u;
  // A tagged caption can expand into many synthesis clips. Keep its original text and
  // cut only at an existing audio break when the next spoken clause would exceed the cap.
  function speechBatches(parts,limit,room) {
    const groups=[];
    let group=[],size=0,total=0;
    for (const part of parts) {
      const {lang}=part, text=part.text.slice(part.speech_start ?? 0);
      let from=0,clause=0,boundary=part.boundary;
      for (const mark of text.matchAll(/_{3,}|＿{3,}|→|$/gu)) {
        if (/[\p{L}\p{N}]/u.test(text.slice(clause,mark.index))) {
          if (++total>room) return null;
          if (size===limit) {
            if (clause>from) group.push({lang,text:text.slice(from,clause),boundary});
            groups.push(group);group=[];size=0;from=clause;
            if (clause) boundary=text[clause-1]==='→'?'arrow':'blank';
          }
          size++;
        }
        clause=mark.index+mark[0].length;
      }
      if (from<text.length) group.push({lang,text:text.slice(from),boundary});
    }
    if (group.length) groups.push(group);
    return {groups,total};
  }
  const message=(error,fallback)=>error instanceof SyntaxError ? invalidReply : error?.message || fallback;
  const detail=(body,fallback)=>typeof body?.detail==='string' && body.detail.trim() ? body.detail.slice(0,600) : fallback;
  function responseError(body,fallback) {
    const error=new Error(detail(body,fallback));
    if (/^[a-z][a-z0-9_]{0,63}$/.test(body?.code)) error.code=body.code;
    if (/^[a-f0-9-]{36}$/.test(body?.request_id)) error.message+=` Mã đối chiếu: ${body.request_id}.`;
    return error;
  }
  const cancelBody=response=>{void response.body?.cancel().catch(()=>{});};
  function post(path,body,signal,options) {
    return apiFetch(path,{method:'POST',signal,body:JSON.stringify(body),...options,
      headers:{'Content-Type':'application/json',...options?.headers}});
  }
  async function readStream(response,signal,current,maxBytes,readText) {
    if (!response.body || !current()) {cancelBody(response);return false;}
    const reader=response.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
    const cancel=()=>{void reader.cancel().catch(()=>{});};
    signal.addEventListener('abort',cancel,{once:true});
    let bytes=0, complete=false;
    try {
      for (;;) {
        const {done,value}=await reader.read();
        if (!current()) return false;
        bytes+=value?.byteLength || 0;
        if (bytes>maxBytes) throw new Error('Phản hồi hội thoại quá lớn.');
        readText(done ? decoder.decode() : decoder.decode(value,{stream:true}));
        if (done) {complete=true;return true;}
      }
    } finally {
      signal.removeEventListener('abort',cancel);
      if (!complete) cancel();
      reader.releaseLock();
    }
  }
  async function jsonResponse(response,signal,current,fallback) {
    let text='';
    if (!await readStream(response,signal,current,32*1024,chunk=>{text+=chunk;})) {
      if (!current()) return null;
      throw new Error(fallback);
    }
    let result;
    try {result=JSON.parse(text);} catch {throw new Error(fallback);}
    if (!response.ok) throw responseError(result,fallback);
    return result;
  }
  const chatRequest=(chatBinding,chatProfile)=>chatBinding ? {chatBinding}
    : chatProfile ? {headers:{'X-VJBot-Profile':chatProfile},redirect:'error'} : {};
  const sttOptions=(live,chatBinding,chatProfile)=>live.stt_source==='voice'
    ? {voiceRouting:true} : {...chatRequest(chatBinding,chatProfile),cascadedStt:true};
  async function routingForStt(live,stt,signal) {
    if (live.stt_source!=='voice') return {};
    let routing;
    try {routing=await stt(signal);}
    catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`${error.message} ${sttSettings}`);
    }
    if (!routing) throw new Error(explicitUnavailable);
    return {stt_routing:routing};
  }
  async function selectStt({live,stt,chatBinding,chatProfile,signal,current}) {
    if (live.stt_source==='browser') {
      if (!window.SpeechRecognition && !window.webkitSpeechRecognition)
        throw new Error('Trình duyệt không hỗ trợ chép lời. '+sttSettings);
      if (!['ja','vi'].includes(live.stt_language))
        throw new Error('Nguồn chép lời trình duyệt cần chọn Tiếng Việt hoặc Tiếng Nhật trong Cài đặt → Âm thanh → Ngôn ngữ nói.');
      return 'browser';
    }
    if (!window.MediaRecorder) throw new Error('Trình duyệt không hỗ trợ ghi âm. '+sttSettings);
    const routing=await routingForStt(live,stt,signal);
    if (!current()) return null;
    const response=await post('/api/stt',{action:'capabilities',language:live.stt_language ?? 'auto',...routing},signal,sttOptions(live,chatBinding,chatProfile));
    const result=await jsonResponse(response,signal,current,'Không kiểm tra được kết nối chép lời.');
    if (!current()) return null;
    if (result?.supported===true && ['openai','mistral','elevenlabs'].includes(result.provider)) return result.provider;
    if (live.stt_source==='voice') throw new Error(explicitUnavailable);
    throw new Error('Kết nối trò chuyện đã chọn không hỗ trợ chép lời. '+sttSettings);
  }
  async function liveEvents(response,signal,current,onSegment,onDone) {
    if (!current()) {cancelBody(response);return null;}
    if (!response.ok) return jsonResponse(response,signal,current,invalidReply);
    if (!response.headers.get('Content-Type')?.startsWith('text/event-stream') || !response.body) {
      cancelBody(response);throw new Error(invalidReply);
    }
    let pending='', event='', data='', reply=null, length=0;
    const segments=[];
    const complete=await readStream(response,signal,current,256*1024,chunk=>{
      pending+=chunk;
      let newline;
      while ((newline=pending.indexOf('\n'))!==-1) {
        const line=pending.slice(0,newline).replace(/\r$/,'');pending=pending.slice(newline+1);
        if (line.startsWith(':')) continue;
        if (line && reply) throw new Error(invalidReply);
        if (line.startsWith('event:') && !event) {event=line.slice(6).trim();continue;}
        if (line.startsWith('data:')) {data+=(data?'\n':'')+line.slice(5).trimStart();continue;}
        if (line) throw new Error(invalidReply);
        if (!event && !data) continue;
        const row=JSON.parse(data);data='';
        if (event==='error') throw responseError(row,invalidReply);
        if (event==='done' && segments.length && row?.count===segments.length && typeof row.full_text==='string'
          && row.full_text===segments.map(part=>part.text).join(' ') && typeof row.japanese_only==='boolean') {
          reply=row;
          onDone(segments);
        } else if (event==='segment' && row?.index===segments.length && row.index<maxSegments
          && ['ja','vi'].includes(row.lang) && (row.index ? ['inline','sentence'].includes(row.boundary) : row.boundary==='start')
          && typeof row.text==='string' && row.text.trim() && !/<\/?(?:ja|vi)>/i.test(row.text)
          && (row.speech_start===undefined || Number.isInteger(row.speech_start) && row.speech_start>=0 && row.speech_start<=row.text.length)) {
          length+=row.text.length+9+Number(row.index>0);
          if (length>maxText) throw new Error('Lượt trả lời quá dài. Em thử hỏi ngắn hơn nhé.');
          segments.push(row);
          onSegment(row,segments);
          if (!current()) return;
        } else throw new Error(invalidReply);
        event='';
      }
    });
    if (!complete || !current()) return null;
    if (pending || event || data || !reply) throw new Error('Lượt trả lời chưa hoàn tất. Em thử lại nhé.');
    return {segments,reply};
  }

  function create({audioContext,microphone,sink,live,route,stt,context,current,chatBinding,chatProfile,sttProvider:preflightStt,onState,onCaption,onError}) {
    const session=new AbortController(), epoch=performance.now();
    const chatOptions=chatRequest(chatBinding,chatProfile);
    const transcriptionOptions=sttOptions(live,chatBinding,chatProfile);
    const Recognition=window.SpeechRecognition || window.webkitSpeechRecognition;
    // Desktop Chromium shipped audio-track input in 135, before the unprefixed API.
    const agent=globalThis.navigator?.userAgent || '';
    const desktopTrackInput=/\b(?:Windows NT|Macintosh|X11)\b/.test(agent) && !/\b(?:Android|Mobile)\b/.test(agent)
      && Number(/\bChrome\/(\d+)/.exec(agent)?.[1])>=135;
    const recordedBrowserStt=Boolean(Recognition && window.MediaRecorder && audioContext.createMediaStreamDestination)
      && (typeof window.SpeechRecognition?.available==='function' || desktopTrackInput);
    const browserPttOnly='Trình duyệt này không chép được bản ghi ở chế độ tự động. Em dùng Bấm để nói nhé.';
    let mode=live.turn_mode, muted=false, phase='connecting', sttProvider=null;
    let started=false, ready=false, sequence=0, active=null, capture=null, pendingBrowser=null, setupTimer;
    let source=null, detector=null, pollTimer, vadMute=null;
    let history=[], lastAudio=null, slowerSteps=0;
    let japaneseOnly=live.japanese_only===true;
    let speakerEndedAt=-Infinity, waitForQuiet=false;
    const time=()=>Math.round(performance.now()-epoch);
    function ownsSession() {
      if (session.signal.aborted) return false;
      if (current()) return true;
      stop();return false;
    }
    const owns=turn=>active===turn && !turn.controller.signal.aborted && ownsSession();
    const ownsCapture=record=>record!=null && (capture===record || pendingBrowser===record);
    function state(next=phase) {
      if (phase==='speaking' && next!=='speaking') speakerEndedAt=time();
      phase=next;
      if (ownsSession()) onState({phase,mode,muted,sttProvider});
    }
    function caption(turn,role,text,start_ms,end_ms) {
      if (owns(turn)) onCaption({role,key:'cascaded-'+turn.id+'-'+role,text,start_ms,end_ms});
    }
    function remember(entry) {
      history.push(entry);
      history=history.slice(-12);
      return entry;
    }
    function releaseTurn(outcome='interrupted') {
      const turn=active;active=null;
      if (!turn) return;
      if (turn.reply?.playback==='pending') turn.reply.playback=outcome;
      else if (!turn.reply && turn.partialText && outcome==='interrupted')
        remember({role:'assistant',text:trimHistory(turn.partialText),generation:'partial',playback:'interrupted'});
      releaseCapture(pendingBrowser);
      clearTimeout(turn.timer);
      turn.audio?.stop();
      turn.controller.abort();
    }
    function beginTurn() {
      releaseTurn();
      return active={id:++sequence,controller:new AbortController(),audio:null,timer:null};
    }
    function turnError(turn,error) {
      if (!owns(turn)) return;
      releaseTurn('failed');state('listening');
      if (ownsSession()) onError(message(error,'Chưa xử lý được lượt nói. Em thử lại nhé.'));
    }
    function deadline(turn,ms,detail) {
      clearTimeout(turn.timer);
      turn.timer=setTimeout(()=>turnError(turn,new Error(detail)),ms);
    }
    function completeTurn(turn) {
      if (!owns(turn)) return;
      releaseTurn('completed');state('listening');
    }
    function fatal(error) {
      if (!ownsSession()) return;
      stop();onError(message(error,'Chưa mở được hội thoại.'),true);
    }
    function stop() {
      if (session.signal.aborted) return;
      session.abort();ready=false;
      clearTimeout(setupTimer);clearInterval(pollTimer);
      releaseCapture(capture);releaseTurn();
      if (detector?.port) detector.port.onmessage=null;
      source?.disconnect();detector?.disconnect();vadMute?.disconnect();
      source=detector=vadMute=null;
      history=[];lastAudio=null;
    }
    async function initVad() {
      // Use a silent output connection so the graph keeps processing without monitoring the microphone.
      if (audioContext.audioWorklet && window.AudioWorkletNode) {
        let timer;
        const signal=session.signal;
        let cancel;
        try {
          await Promise.race([audioContext.audioWorklet.addModule('voice/vad-worklet.js'),
            new Promise((_,reject)=>{
              cancel=()=>reject(signal.reason);
              signal.addEventListener('abort',cancel,{once:true});
              timer=setTimeout(()=>reject(new Error('AudioWorklet timeout')),2000);
            })]);
          if (!ownsSession()) return;
          detector=new window.AudioWorkletNode(audioContext,'vjbot-vad-processor');
          vadMute=audioContext.createGain();vadMute.gain.value=0;
          detector.connect(vadMute).connect(audioContext.destination);
          source=audioContext.createMediaStreamSource(microphone);source.connect(detector);
          detector.port.onmessage=event=>observe(event.data?.rms);
          return;
        } catch {
          source?.disconnect();detector?.disconnect();vadMute?.disconnect();
          source=detector=vadMute=null;
        } finally {
          clearTimeout(timer);signal.removeEventListener('abort',cancel);
        }
      }
      if (!ownsSession()) return;
      try {
        detector=audioContext.createAnalyser();detector.fftSize=1024;
        const samples=new Float32Array(detector.fftSize);
        source=audioContext.createMediaStreamSource(microphone);source.connect(detector);
        pollTimer=setInterval(()=>{
          if (!ownsSession() || !ready || muted || mode!=='vad') return;
          detector.getFloatTimeDomainData(samples);
          let squares=0;
          for (const sample of samples) squares+=sample*sample;
          observe(Math.sqrt(squares/samples.length));
        },30);
      } catch {
        source?.disconnect();detector?.disconnect();source=detector=null;
      }
    }
    async function start() {
      if (started || !ownsSession()) return;
      started=true;state();
      setupTimer=setTimeout(()=>fatal(new Error('Mở hội thoại quá lâu. Em kiểm tra kết nối rồi thử lại nhé.')),15000);
      try {
        const provider=preflightStt ?? await selectStt({live,stt,chatBinding,chatProfile,signal:session.signal,current:ownsSession});
        if (!ownsSession()) return;
        sttProvider=provider;
        await initVad();
        if (!ownsSession()) return;
        clearTimeout(setupTimer);ready=true;
        if (mode==='vad' && (!detector || provider==='browser' && !recordedBrowserStt)) {
          mode='ptt';state('listening');
          if (ownsSession()) onError(provider==='browser' && !recordedBrowserStt ? browserPttOnly : 'Trình duyệt không hỗ trợ phát hiện tiếng nói. Em dùng Bấm để nói nhé.');
        }
        return sendCommand('start');
      } catch (error) {fatal(error);}
    }

    function releaseCapture(record) {
      if (!ownsCapture(record)) return;
      if (capture===record) capture=null;
      else pendingBrowser=null;
      clearTimeout(record.timer);
      const {recorder,recognizer,bufferSource,track,destination}=record;
      if (recognizer) {
        recognizer.onresult=recognizer.onerror=recognizer.onend=recognizer.onaudiostart=null;
        try {recognizer.abort();} catch { /* It may already have ended. */ }
      }
      if (recorder) {
        recorder.ondataavailable=recorder.onerror=recorder.onstop=null;
        try {if (recorder.state!=='inactive') recorder.stop();} catch { /* It may already have ended. */ }
      }
      if (bufferSource) {
        bufferSource.onended=null;
        try {bufferSource.stop();} catch { /* It may not have started. */ }
        bufferSource.disconnect();
      }
      track?.stop();destination?.disconnect();
    }
    function captureErrorFor(record,text) {
      if (!ownsCapture(record) || !ownsSession()) return;
      if (record.auto && capture===record) waitForQuiet=true;
      releaseCapture(record);
      if (record.turn) turnError(record.turn,new Error(text));
      else if (text!==noSpeech || !record.auto) onError(text);
    }
    function commitCapture(record) {
      if (!ownsSession() || capture!==record) return;
      if (record.browser && !record.auto) {
        try { startBrowserRecognition(record); }
        catch {captureErrorFor(record,captureError);return;}
        if (!ownsSession() || capture!==record) return;
      }
      record.turn=beginTurn();state('recording');
    }
    function finishTranscript(record) {
      if (!ownsCapture(record) || !ownsSession()) return;
      const {turn,start,text}=record, end=record.end ?? time();
      releaseCapture(record);
      if (turn && owns(turn)) void learnerTurn(turn,text,null,start,end);
    }
    async function recordEnded(record) {
      if (capture!==record || !ownsSession()) return;
      const {turn,browser,start,lastLoud,recorder}=record, end=record.end ?? time();
      if (!turn || !owns(turn)) {releaseCapture(record);return;}
      if (record.auto && !browser && lastLoud-start<minSpeech) {
        releaseCapture(record);completeTurn(turn);return;
      }
      const input=new Blob(record.chunks,{type:recorder.mimeType || record.chunks[0]?.type || record.mime});
      if (input.size<512 || input.size>maxAudio) {captureErrorFor(record,noSpeech);return;}
      if (!browser) {
        releaseCapture(record);void learnerTurn(turn,'',input,start,end);return;
      }
      record.end=end;record.chunks.length=0;
      capture=null;pendingBrowser=record;
      state('thinking');
      try {
        const bytes=await input.arrayBuffer();
        if (!owns(turn) || pendingBrowser!==record) return;
        const audio=await audioContext.decodeAudioData(bytes);
        if (!owns(turn) || pendingBrowser!==record) return;
        clearTimeout(record.timer);
        record.timer=setTimeout(()=>captureErrorFor(record,captureError),Math.ceil(audio.duration*1000)+8000);
        startBrowserRecognition(record,audio);
      } catch {captureErrorFor(record,captureError);}
    }
    function endCapture(record) {
      if (capture!==record || record.end!==undefined || !ownsSession()) return;
      const device=record.recognizer || record.recorder;
      if (!record.turn || !device) {releaseCapture(record);return;}
      record.end=time();clearTimeout(record.timer);
      record.timer=setTimeout(()=>captureErrorFor(record,captureError),4000);
      try {device.stop();} catch {captureErrorFor(record,captureError);}
    }
    function startBrowserRecognition(record,audio) {
      const recognizer=record.recognizer=new Recognition();
      recognizer.lang=live.stt_language==='vi'?'vi-VN':'ja-JP';recognizer.continuous=true;recognizer.interimResults=false;
      recognizer.onresult=event=>{
        if (!ownsCapture(record) || !ownsSession()) return;
        let text='';
        for (let i=0;i<event.results.length;i++) {
          if (!event.results[i].isFinal) continue;
          text+=(text?' ':'')+event.results[i][0].transcript.trim();
          if (text.length>1500) {captureErrorFor(record,'Câu nói quá dài. Em thử nói ngắn hơn nhé.');return;}
        }
        record.text=text;
      };
      recognizer.onerror=event=>captureErrorFor(record,event.error==='no-speech' ? noSpeech : 'Trình duyệt chưa chép được lời. Em kiểm tra micro và nguồn chép lời nhé.');
      recognizer.onend=()=>finishTranscript(record);
      if (!audio) {recognizer.start();return;}
      // Feed the whole confirmed recording after the recognizer is ready, never the live mic.
      const destination=record.destination=audioContext.createMediaStreamDestination();
      const track=record.track=destination.stream.getAudioTracks()[0];
      const bufferSource=record.bufferSource=audioContext.createBufferSource();
      bufferSource.buffer=audio;bufferSource.connect(destination);
      bufferSource.onended=()=>{
        if (pendingBrowser!==record || !ownsSession()) return;
        try {recognizer.stop();} catch {captureErrorFor(record,captureError);}
      };
      recognizer.onaudiostart=()=>{
        if (pendingBrowser!==record || !ownsSession()) return;
        recognizer.onaudiostart=null;
        try {bufferSource.start();} catch {captureErrorFor(record,captureError);}
      };
      recognizer.start(track);
    }
    function beginCapture(auto,now) {
      if (!ownsSession() || muted) return;
      const browser=sttProvider==='browser', record=capture={auto,browser,start:now,lastLoud:now,text:'',chunks:[],size:0};
      try {
        if (!browser || auto) {
          const Recorder=window.MediaRecorder;
          const mime=record.mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(type=>Recorder.isTypeSupported?.(type));
          const recorder=record.recorder=new Recorder(microphone,mime?{mimeType:mime}:{});
          recorder.ondataavailable=({data})=>{
            if (capture!==record || !ownsSession() || !data?.size) return;
            record.size+=data.size;
            if (record.size>maxAudio) {captureErrorFor(record,'Bản ghi quá lớn. Em thử nói ngắn hơn nhé.');return;}
            record.chunks.push(data);
          };
          recorder.onerror=()=>captureErrorFor(record,captureError);
          recorder.onstop=()=>{void recordEnded(record);};
          recorder.start(250);
        }
        if (capture!==record || !ownsSession()) return;
        record.timer=setTimeout(()=>{
          if (record.auto) waitForQuiet=true;
          endCapture(record);
        },maxRecording);
        if (!auto) commitCapture(record);
      } catch {captureErrorFor(record,captureError);}
    }
    function observe(rms) {
      if (!ownsSession() || !ready || muted || mode!=='vad' || !Number.isFinite(rms)) return;
      if (waitForQuiet) {
        if (rms<0.012) waitForQuiet=false;
        return;
      }
      const now=time(), record=capture;
      const nearSpeaker=phase==='speaking' || now-speakerEndedAt<250;
      const threshold=nearSpeaker ? 0.035 : 0.022;
      if (!record) {
        // Capture at onset, but never invoke Browser STT until the recording is confirmed.
        if (rms>=threshold && (phase==='listening' && !nearSpeaker || live.barge_in && ['listening','thinking','speaking'].includes(phase)))
          beginCapture(true,now);
        return;
      }
      if (record.end!==undefined) return;
      if (!record.turn) {
        if (rms>=threshold) {
          if (now-record.lastLoud>=60) record.start=now;
          record.lastLoud=now;
          // Do not cut off the tutor for an utterance we would discard as too short.
          if (now-record.start>=(nearSpeaker ? minSpeech : 120)) commitCapture(record);
        } else if (now-record.lastLoud>=60 || nearSpeaker && !live.barge_in) releaseCapture(record);
      } else {
        if (rms>=0.012) record.lastLoud=now;
        else if (now-record.lastLoud>=hangover) endCapture(record);
      }
    }
    function toggleTalk() {
      if (!ownsSession() || !ready || muted || mode!=='ptt') return;
      if (capture) endCapture(capture);
      else if (phase==='listening' || live.barge_in && ['thinking','speaking'].includes(phase)) beginCapture(false,time());
    }
    function discardCapture() {
      const turn=capture?.turn || pendingBrowser?.turn;
      releaseCapture(capture);
      if (turn && active===turn) {releaseTurn();phase='listening';}
    }
    function setMode(value) {
      if (!ownsSession() || !['ptt','vad'].includes(value) || mode===value) return;
      if (ready && value==='vad' && (!detector || sttProvider==='browser' && !recordedBrowserStt)) {
        state();
        if (ownsSession()) onError(sttProvider==='browser' && !recordedBrowserStt ? browserPttOnly : 'Trình duyệt không hỗ trợ chế độ tự động.');
        return;
      }
      discardCapture();mode=value;state();
    }
    function setMuted(value) {
      if (!ownsSession() || muted===Boolean(value)) return;
      muted=Boolean(value);
      if (muted) discardCapture();
      state();
    }

    async function learnerTurn(turn,transcript,blob,start,end) {
      const signal=turn.controller.signal, current=()=>owns(turn);
      try {
        deadline(turn,30000,'Chép lời quá lâu. Em thử lại nhé.');state('thinking');
        const reference=await context();
        if (!current()) return;
        if (blob) {
          const bytes=new Uint8Array(await blob.arrayBuffer());
          if (!current()) return;
          let binary='';
          for (let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
          const routing=await routingForStt(live,stt,signal);
          if (!current()) return;
          const {level,lesson}=reference;
          const response=await post('/api/stt',{audio:btoa(binary),mime_type:blob.type,level,lesson,
            language:live.stt_language ?? 'auto',...routing},signal,transcriptionOptions);
          const result=await jsonResponse(response,signal,current,'Chưa chép được bản ghi. Em thử lại nhé.');
          if (!current()) return;
          transcript=result?.text;
        }
        transcript=typeof transcript==='string' ? transcript.trim() : '';
        if (!transcript) throw new Error(noSpeech);
        if (transcript.length>1500) throw new Error('Câu nói quá dài. Em thử nói ngắn hơn nhé.');
        caption(turn,'user',transcript,start,end);
        turn.priorHistory=history.slice();
        remember({role:'user',text:trimHistory(transcript)});
        if (current()) await generate(turn,reference,null,transcript);
      } catch (error) {turnError(turn,error);}
    }
    async function generate(turn,reference,command,transcript='') {
      const signal=turn.controller.signal, current=()=>owns(turn);
      const audioAbort=new AbortController(), audioSignal=AbortSignal.any([signal,audioAbort.signal]);
      deadline(turn,35000,'Thầy phản hồi quá lâu. Em thử lại nhé.');
      let routing, firstReady, appendChain=Promise.resolve(), elevenChain=appendChain, text='', firstAt;
      let mistralSingle=false, audioFailure='', firstEnd=0, cut=0, batched=0, tail, pendingBlank=false, spokenBatch=false, plannedClips=0;
      const audioSegments=[];
      const steps=slowerSteps;
      const audioCurrent=()=>!audioSignal.aborted && current();
      function failAudio(error) {
        if (!audioCurrent()) return;
        audioFailure=message(error,'Không phát được câu trả lời.');
        audioAbort.abort();
        turn.audio?.stop();
        if (phase==='speaking') state('thinking');
      }
      function batch(parts) {
        const managed=parts.some(({lang})=>(routing.mode==='single'
          ? routing.primary.profile : routing[lang]?.profile ?? routing.primary.profile)?.scope==='platform');
        const plan=speechBatches(parts,managed ? managedTtsSegments : maxSegments,2*maxSegments-plannedClips);
        if (!plan) {failAudio(new Error('Câu trả lời có quá nhiều phần để phát âm thanh.'));return;}
        plannedClips+=plan.total;
        for (const group of plan.groups) dispatchAudio(group);
      }
      function dispatchAudio(parts) {
        const raw=parts.map(part=>part.text).join(' ');
        if (!/[\p{L}\p{N}]/u.test(raw)) {
          pendingBlank ||= /(?:_{3,}|＿{3,})/u.test(raw);
          return;
        }
        const boundary=!spokenBatch ? 'start' : pendingBlank || leadingBlank.test(raw) ? 'blank' : parts[0].boundary;
        pendingBlank=trailingBlank.test(raw);
        spokenBatch=true;
        const before=appendChain, priorEleven=elevenChain;
        const serialEleven=parts.some(({lang})=>(routing.mode==='single'
          ? routing.primary.provider : routing[lang]?.provider ?? routing.primary.provider)==='elevenlabs');
        // Limit ElevenLabs dispatch separately from the playback order.
        appendChain=(async()=>{
          if (serialEleven) await priorEleven;
          if (!audioCurrent()) return;
          const base=(routing.mode==='single' ? routing.primary.speed : routing.ja?.speed ?? routing.primary.speed) ?? 1;
          const jaScale=Math.min(base,Math.max(0.75,base-0.12*steps))/base;
          // Separate language clips only when Japanese needs a different pace, using the same voice and connection.
          const synthesisRouting=mistralSingle && jaScale<1
            ? {...routing,mode:'dual_same_api',ja:{profile:null},vi:{profile:null}} : routing;
          const text=parts.map(({lang,text})=>`<${lang}>${text}</${lang}>`).join(' ');
          const response=await post('/api/tts',{...reference,text,mode:'bilingual',stream:true,
            ...(serialEleven ? {serial:true} : {}),routing:synthesisRouting},audioSignal,{voiceRouting:true});
          await window.VJVoice.consume(response,async part=>{
            await before;
            if (!audioCurrent()) return;
            const clip={...part,boundary:part.index===0 ? boundary : part.boundary,
              speed:part.lang==='ja' ? part.speed*jaScale : part.speed};
            turn.audio??=window.VJVoiceStitcher.create({audioContext,sink});
            await turn.audio.append(clip);
            if (!audioCurrent()) return;
            audioSegments.push(clip);
            if (phase!=='speaking') state('speaking');
          },audioCurrent,audioSignal);
        })().catch(failAudio);
        if (serialEleven) elevenChain=appendChain;
      }
      function flushFirstSentence(segments) {
        if (!mistralSingle || !firstEnd || batched || !current()) return;
        batched=firstEnd;
        const parts=segments.slice(0,batched);
        if (cut) {
          const last=parts.at(-1);
          const rest=last.text.slice(cut).trim();
          if (rest) {
            parts[parts.length-1]={...last,text:last.text.slice(0,cut)};
            if (hasSpokenText(rest) || /(?:_{3,}|＿{3,})/u.test(rest)) tail={...last,text:rest,speech_start:0,boundary:'sentence'};
          }
        }
        batch(parts);
      }
      const payload={...reference,command,transcript,history:[],japanese_only:japaneseOnly};
      const room=maxTurnBytes-textEncoder.encode(JSON.stringify(payload)).length;
      const prior=turn.priorHistory ?? history;
      let first=prior.length, bytes=0;
      while(first){
        bytes+=1+textEncoder.encode(JSON.stringify(prior[first-1])).length;
        if(bytes>room)break;
        first--;
      }
      payload.history=prior.slice(first);
      const response=await post('/api/live/turn',payload,signal,chatOptions);
      const result=await liveEvents(response,signal,current,(part,segments)=>{
        const now=time();firstAt??=now;
        text+=(text?' ':'')+part.text;
        turn.partialText=text;
        caption(turn,'assistant',text,firstAt,now);
        if (!current() || batched) return;
        if (!firstEnd) {
          for (const end of part.text.matchAll(firstSentenceEnd)) {
            const at=end.index+end[0].length;
            const start=part.speech_start ?? 0;
            if (at<=start || part.index===0 && !hasSpokenText(part.text.slice(start,at).trim())) continue;
            // A parenthetical reading can contain punctuation; keep it attached until Worker normalization.
            const head=part.text.slice(start,end.index);
            if (Math.max(head.lastIndexOf('('),head.lastIndexOf('（'))>Math.max(head.lastIndexOf(')'),head.lastIndexOf('）'))) continue;
            if (/[」』]$/u.test(end[0]) && /^[\s]*[\p{Script=Hiragana}\p{Script=Han}]/u.test(part.text.slice(at))) continue;
            firstEnd=part.index+1;cut=at;break;
          }
        }
        if (part.index===0) {
          firstReady=route(audioSignal).then(value=>{
            if (!audioCurrent()) return;
            routing=value;
            mistralSingle=routing.mode==='single' && routing.primary.provider==='mistral';
            if (mistralSingle) flushFirstSentence(segments);
            else {batched=1;batch([part]);}
          }).catch(failAudio);
        } else flushFirstSentence(segments);
      },segments=>{
        firstEnd ||= segments.length;
        flushFirstSentence(segments);
      });
      if (!result || !current()) return;
      turn.reply=remember({role:'assistant',text:trimHistory(result.reply.full_text),generation:'complete',playback:'pending'});
      japaneseOnly=result.reply.japanese_only;
      clearTimeout(turn.timer);
      const audioTimeout=new Promise(resolve=>{
        turn.timer=setTimeout(()=>{
          failAudio(new Error('Âm thanh tải hoặc phát quá lâu. Em thử lại nhé.'));
          resolve();
        },90000);
      });
      const play=async()=>{
        await firstReady;
        if (!audioCurrent()) return;
        if (tail || result.segments.length>batched) {
          const remaining=result.segments.slice(batched);
          if (tail) remaining.unshift(tail);
          batch(remaining);
        }
        await appendChain;
        if (audioCurrent()) await turn.audio?.finish();
      };
      await Promise.race([play().catch(failAudio),audioTimeout]);
      if (!current()) return;
      // Text completion and audio delivery are independent evidence.
      turn.reply.playback=audioFailure ? 'failed' : 'completed';
      lastAudio=audioFailure || !audioSegments.length ? null : audioSegments;
      if (audioFailure) turnError(turn,new Error(`${audioFailure} Câu trả lời vẫn có trong bản chép lời.`));
      else completeTurn(turn);
    }
    function trimHistory(text) {
      const short=text.slice(0,600);
      return /[\uD800-\uDBFF]$/.test(short) ? short.slice(0,-1) : short;
    }
    async function sendCommand(command) {
      if (!ownsSession() || !ready || command!=='repeat' && !commands.includes(command)) return;
      if (command==='repeat' && !lastAudio) {
        onError('Chưa có lời đáp hoàn chỉnh để nghe lại.');return;
      }
      discardCapture();
      const turn=beginTurn();
      try {
        if (command==='repeat') {
          deadline(turn,90000,'Âm thanh phát quá lâu. Em thử lại nhé.');
          turn.audio=window.VJVoiceStitcher.create({audioContext,sink});
          for (const part of lastAudio) {
            if (!owns(turn)) return;
            await turn.audio.append(part);
            if (!owns(turn)) return;
            if (phase!=='speaking') state('speaking');
          }
          await turn.audio.finish();
          completeTurn(turn);return;
        }
        if (command==='slower') slowerSteps=Math.min(slowerSteps+1,11);
        deadline(turn,35000,'Thầy phản hồi quá lâu. Em thử lại nhé.');state('thinking');
        const reference=await context();
        if (owns(turn)) await generate(turn,reference,command);
      } catch (error) {turnError(turn,error);}
    }
    return {start,stop,toggleTalk,setMode,setMuted,sendCommand};
  }
  window.VJLiveCascaded=Object.freeze({create,selectStt});
})();
