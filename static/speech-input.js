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
    label.textContent = recording ? 'Dừng ghi âm' : idleLabel;
  };
  const describe = (error, action='Chép lời') => {
    const code = error?.error || error?.name;
    if (action === 'Phát lại') return 'Trình duyệt chưa phát được âm thanh. Hãy bấm Nghe lại hoặc gõ câu trả lời.';
    if (['NotAllowedError','SecurityError','not-allowed','service-not-allowed'].includes(code)) return 'Chưa có quyền dùng micro. Em cho phép micro hoặc gõ câu trả lời nhé.';
    if (['NotFoundError','DevicesNotFoundError','audio-capture'].includes(code)) return 'Không tìm thấy micro. Hãy cắm micro hoặc gõ câu trả lời.';
    if (code === 'NotReadableError') return 'Micro đang bận hoặc không dùng được. Hãy đóng ứng dụng thu âm khác hoặc gõ câu trả lời.';
    return `${action} không thành công${code ? ` (${code})` : ''}. Hãy gõ câu trả lời hoặc thử lại.`;
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
      try { release(previous); } catch (error) { announce(`Không dừng được bản ghi: ${describe(error)}`); }
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
      announce(requested ? 'Đã dừng ghi. Em xem lại chữ trước khi gửi nhé.'
        : 'Chép lời của trình duyệt đã kết thúc; đã dừng ghi. Hãy xem lại chữ trước khi nhờ AI nhận xét.');
    } catch (error) { fail(session, `Không tắt được micro: ${describe(error, 'Dừng ghi âm')}`); }
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
    if (!Recognition && !canRecord) { announce('Không ghi âm và không chép lời bằng trình duyệt được. Hãy nhập câu trả lời bằng bàn phím.'); return; }
    if (bindButton) stopJapaneseInputs();
    else { cancel(); discard(); }
    globalThis.stopSpeech?.();
    const session = {owner:owner(), route:route(), prefix:input.value.trim(), stopped:false,
      recognitionEnded:false, stream:null, recorder:null};
    active = session; draw();
    const chunks = [];
    if (canRecord) {
      announce('Đang chờ quyền dùng micro. Bấm Dừng để hủy.');
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
          if (!chunks.length) { announce('Chưa ghi được âm thanh. Hãy gõ câu trả lời hoặc ghi lại.'); return; }
          try {
            const mimeType = recorder.mimeType || chunks.find(chunk => chunk.type)?.type;
            const blob = new Blob(chunks, mimeType ? {type:mimeType} : {});
            discard(); audioUrl = URL.createObjectURL(blob); audioOwner = {owner:session.owner, route:session.route};
            playbackButton.hidden = false; playbackButton.style.display = 'inline-flex';
          } catch (error) { fail(session, `Không lưu được bản ghi: ${describe(error, 'Lưu bản ghi')}`); }
        };
        recorder.onerror = event => fail(session, `Bộ ghi âm gặp lỗi: ${describe(event.error || event, 'Ghi âm')}`);
        recorder.start();
      } catch (error) { if (!session.stopped) fail(session, describe(error, 'Ghi âm')); return; }
    }
    announce(canRecord ? (Recognition ? 'Đang ghi và chép lời bằng trình duyệt.'
      : 'Đang ghi để em nghe lại. Trình duyệt này không chép lời được; em hãy gõ câu trả lời.')
      : 'Đang chép lời bằng trình duyệt. Không có bản ghi để nghe lại; em cũng có thể gõ câu trả lời.');
    if (Recognition) try { recognize(session); } catch (error) { fail(session, `Trình duyệt chép lời không thành công: ${describe(error)}`); }
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
      entry.audio.onended = () => { if (playbackOwns(entry)) { pauseReplay(); announce('Đã phát xong.'); } };
      entry.audio.onerror = () => { if (playbackOwns(entry)) { pauseReplay(); announce('Không phát lại được bản ghi. Hãy ghi lại hoặc gõ câu trả lời.'); } };
      announce('Đang phát lại bản ghi của em.');
      await entry.audio.play();
    } catch (error) { if (playbackOwns(entry)) { pauseReplay(); announce(`Không phát lại được bản ghi: ${describe(error, 'Phát lại')}`); } }
  };
  if (bindButton) playbackButton?.addEventListener('click', replay);
  const controller = {toggle, replay, get active() { return Boolean(active && !active.stopped); }, reset() {
    cancel(); discard(); announce('Micro sẵn sàng');
  }};
  if (bindButton) japaneseInputs.push(controller);
  if (status) { status.setAttribute?.('role','status'); status.setAttribute?.('aria-live','polite'); }
  if (bindButton) {
    button.disabled = !Recognition && !canRecord;
    if (!Recognition && !canRecord) announce('Không ghi âm và không chép lời bằng trình duyệt được. Hãy nhập câu trả lời bằng bàn phím.');
    else if (!Recognition) announce('Trình duyệt không chép lời được. Em có thể ghi âm để nghe lại hoặc gõ câu trả lời; AI chỉ nhận xét dựa trên chữ.');
    else if (!canRecord) announce('Không ghi âm được. Vẫn dùng được chép lời của trình duyệt hoặc gõ tay.');
    else announce('Micro sẵn sàng');
    draw();
  }
  return controller;
}
for (const event of ['hashchange','popstate','pagehide','vjbot-account-ready','vjbot-voice-changed']) addEventListener(event, stopJapaneseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopJapaneseInputs(); });
