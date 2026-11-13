// One shared capture owner for chat and Kaiwa; AI feedback evaluates text, not acoustics.
const japaneseInputs = [];
function stopJapaneseInputs() { japaneseInputs.forEach(input => input.reset()); }
function createJapaneseInput(options) {
  return window.MediaRecorder && navigator.mediaDevices?.getUserMedia && typeof apiFetch==='function'
    ? createRecordedJapaneseInput(options) : createBrowserJapaneseInput(options);
}
function createBrowserJapaneseInput({button, input, status, playbackButton, onError, bindButton=true}) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const Recorder = window.MediaRecorder;
  const canRecord = Boolean(playbackButton && typeof Recorder === 'function' && navigator.mediaDevices?.getUserMedia);
  const label = button.querySelector?.('span:last-child') || button, idleLabel = label.textContent;
  const owner = () => typeof signedInUser === 'undefined' ? '' : signedInUser?.user_id || '';
  const route = () => globalThis.location?.hash || '';
  let active = null, audioUrl = null, audioOwner = null, playback = null;
  const owns = session => active === session && session.owner === owner() && session.route === route();
  const playbackOwns = entry => playback === entry && entry.owner === owner() && entry.route === route();
  const announce = text => { if (status) { status.textContent = text; status.hidden = !text || text === 'Micro sẵn sàng'; } };
  const draw = () => {
    const recording = Boolean(active && !active.stopped);
    button.setAttribute('aria-pressed', String(recording));
    label.textContent = recording ? 'Dừng ghi âm · Stop' : idleLabel;
  };
  const describe = error => {
    const code = error?.error || error?.name;
    if (['NotAllowedError','SecurityError','not-allowed','service-not-allowed'].includes(code)) return 'Microphone permission denied. Chưa có quyền micro. Cho phép micro hoặc nhập câu trả lời.';
    if (['NotFoundError','DevicesNotFoundError','audio-capture'].includes(code)) return 'No microphone is available. Connect a microphone or type your answer.';
    if (code === 'NotReadableError') return 'The microphone is busy or unavailable. Close other capture apps or type your answer.';
    return error?.message || (code ? `Speech transcription failed (${code}). Type your answer or try again.` : 'Microphone capture failed. Type your answer or try again.');
  };
  const release = session => {
    clearTimeout(session.timer);
    try { if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop(); }
    finally { session.stream?.getTracks().forEach(track => track.stop()); session.stream = null; }
  };
  const pauseReplay = () => {
    const previous = playback; playback = null;
    if (previous?.audio) {
      previous.audio.onended = null; previous.audio.onerror = null;
      previous.audio.pause(); previous.audio.removeAttribute('src'); previous.audio.load();
    }
  };
  const discard = () => {
    pauseReplay();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    audioOwner = null;
    if (playbackButton) { playbackButton.hidden = true; playbackButton.style.display = 'none'; }
  };
  const cancel = () => {
    const previous = active; active = null;
    if (previous) {
      previous.stopped = true;
      try { previous.recognition?.abort(); } catch (error) { announce(describe(error)); }
      try { release(previous); } catch (error) { announce(`Recorder stop failed: ${describe(error)}`); }
    }
    draw();
  };
  const fail = (session, message) => {
    if (!owns(session)) return;
    cancel(); announce(message); onError?.(message);
  };
  const stop = (session, requested) => {
    if (!owns(session) || session.stopped) return;
    session.stopped = true;
    try {
      release(session);
      if (!session.recognitionEnded) session.recognition?.stop();
      announce(requested ? 'Recording stopped. AI feedback evaluates text, not acoustic pronunciation.'
        : 'Browser transcription ended; recording stopped. Review the text before requesting AI feedback.');
    } catch (error) { fail(session, `Microphone stop failed: ${describe(error)}`); }
    draw();
  };
  const recognize = session => {
    const recognition = session.recognition = new Recognition();
    recognition.lang = 'ja-JP'; recognition.interimResults = true;
    recognition.onstart = () => { if (!owns(session) || session.stopped) recognition.abort(); };
    recognition.onresult = event => {
      if (!owns(session) || session.recognitionEnded) return;
      const transcript = Array.from(event.results || [], result => result[0]?.transcript || '').join('');
      input.value = [session.prefix, transcript].filter(Boolean).join(' ').slice(0, 6000);
      input.dispatchEvent?.(new Event('input', {bubbles:true}));
    };
    recognition.onerror = event => {
      if (event.error === 'aborted' && session.stopped) return;
      fail(session, describe(event));
    };
    recognition.onend = () => {
      if (!owns(session)) return;
      session.recognitionEnded = true;
      if (!session.stopped) stop(session, false);
      draw();
    };
    recognition.start();
  };
  const toggle = async () => {
    if (active && !active.stopped) { stop(active, true); return; }
    if (!Recognition && !canRecord) { announce('Recording and browser transcription are unavailable. Nhập câu trả lời bằng bàn phím.'); return; }
    if (bindButton) stopJapaneseInputs();
    else { cancel(); discard(); }
    globalThis.stopSpeech?.();
    const session = {owner:owner(), route:route(), prefix:input.value.trim(), stopped:false,
      recognitionEnded:false, stream:null, recorder:null};
    active = session; draw();
    const chunks = [];
    if (canRecord) {
      announce('Waiting for microphone permission. Click Stop to cancel.');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({audio:true});
        if (!owns(session) || session.stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        session.stream = stream;
        const recorder = session.recorder = new Recorder(stream);
        recorder.ondataavailable = event => { if (owns(session) && event.data?.size > 0) chunks.push(event.data); };
        recorder.onstop = () => {
          session.stream?.getTracks().forEach(track => track.stop()); session.stream = null;
          if (!owns(session)) return;
          if (!session.stopped) stop(session, false);
          if (!chunks.length) { announce('No audio was recorded. Type your answer or record again.'); return; }
          try {
            const mimeType = recorder.mimeType || chunks.find(chunk => chunk.type)?.type;
            const blob = new Blob(chunks, mimeType ? {type:mimeType} : {});
            discard(); audioUrl = URL.createObjectURL(blob); audioOwner = {owner:session.owner, route:session.route};
            playbackButton.hidden = false; playbackButton.style.display = 'inline-flex';
          } catch (error) { fail(session, `Recording could not be saved: ${describe(error)}`); }
        };
        recorder.onerror = event => fail(session, `Recorder failed: ${describe(event.error || event)}`);
        recorder.start();
      } catch (error) { if (!session.stopped) fail(session, `Recording failed: ${describe(error)}`); return; }
    }
    announce(canRecord ? (Recognition ? 'Recording; browser transcription is separate from text-based AI feedback.'
      : 'Recording. Browser transcription is unavailable; type your answer for text-based AI feedback.')
      : 'Recording is unavailable; browser transcription only. You can also type your answer.');
    if (Recognition) try { recognize(session); } catch (error) { fail(session, `Browser transcription failed: ${describe(error)}`); }
    if (owns(session) && !session.stopped) session.timer = setTimeout(() => stop(session, true), 60000);
  };
  if (bindButton) button.addEventListener('click', toggle);
  const replay = async () => {
    if (!audioUrl) return;
    if (audioOwner?.owner !== owner() || audioOwner?.route !== route()) { cancel(); discard(); return; }
    cancel(); pauseReplay(); globalThis.stopSpeech?.();
    const entry = {audio:null, owner:owner(), route:route()}; playback = entry;
    try {
      entry.audio = new Audio(audioUrl);
      entry.audio.onended = () => { if (playbackOwns(entry)) { pauseReplay(); announce('Replay ended.'); } };
      entry.audio.onerror = () => { if (playbackOwns(entry)) { pauseReplay(); announce('Recorded audio playback failed. Record again or use manual text.'); } };
      announce('Playing your recording.');
      await entry.audio.play();
    } catch (error) { if (playbackOwns(entry)) { pauseReplay(); announce(`Recorded audio playback failed: ${describe(error)}`); } }
  };
  if (bindButton) playbackButton?.addEventListener('click', replay);
  const controller = {toggle, replay, get active() { return Boolean(active && !active.stopped); }, reset() {
    cancel(); discard(); announce('Micro sẵn sàng');
  }};
  if (bindButton) japaneseInputs.push(controller);
  if (status) { status.setAttribute?.('role','status'); status.setAttribute?.('aria-live','polite'); }
  if (bindButton) {
    button.disabled = !Recognition && !canRecord;
    if (!Recognition && !canRecord) announce('Recording and browser transcription are unavailable. Nhập câu trả lời bằng bàn phím.');
    else if (!Recognition) announce('Browser transcription is unavailable. You can record for replay or type your answer; AI feedback evaluates text only.');
    else if (!canRecord) announce('Recording is unavailable. Browser transcription or manual text remains available.');
    else announce('Microphone ready. AI feedback evaluates text, not acoustic pronunciation.');
    draw();
  }
  return controller;
}
for (const event of ['hashchange','popstate','pagehide','vjbot-account-ready','vjbot-voice-changed']) addEventListener(event, stopJapaneseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopJapaneseInputs(); });
