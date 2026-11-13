// Chat and Kaiwa share recognition, microphone cleanup and accessible recording states.
const japaneseInputs = [];
function stopJapaneseInputs() { japaneseInputs.forEach(input => input.reset()); }
function createJapaneseInput(options) {
  return window.MediaRecorder && navigator.mediaDevices?.getUserMedia && typeof apiFetch==='function'
    ? createRecordedJapaneseInput(options) : createBrowserJapaneseInput(options);
}
function createBrowserJapaneseInput({button, input, status, playbackButton, onError, bindButton=true}) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const label = button.querySelector?.('span:last-child') || button;
  const idleLabel = label.textContent;
  const announce = text => { if (status) {status.textContent = text;status.hidden=!text || text==='Micro sẵn sàng';} };
  if (!Recognition) {
    button.disabled = bindButton;
    if(bindButton)button.title = 'Trình duyệt không hỗ trợ nhận diện giọng nói';
    if(bindButton)announce('Nhập câu trả lời bằng bàn phím.');
    return {reset() {},toggle(){announce('Nhập câu trả lời bằng bàn phím.');}};
  }
  const recognition = new Recognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = true;
  let active = false, failed = false, generation = 0, stream, recorder, audioUrl, playback, timer, prefix = '';
  const draw = recording => {
    button.setAttribute('aria-pressed', String(recording));
    label.textContent = recording ? 'Dừng ghi âm' : idleLabel;
  };
  const release = () => {
    clearTimeout(timer);
    if (recorder?.state === 'recording') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  };
  async function capture(version) {
    if (!playbackButton || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({audio: true});
      // Permission may arrive after navigation or after the recognition service has ended.
      if (!active || version !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      if (!window.MediaRecorder || !playbackButton) return;
      const captureRecorder = recorder = new window.MediaRecorder(stream), chunks = [];
      captureRecorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      captureRecorder.onstop = () => {
        if (version !== generation || !chunks.length) return;
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = URL.createObjectURL(new Blob(chunks, {type: captureRecorder.mimeType}));
        playbackButton.hidden = false;
      };
      captureRecorder.start();
    } catch { /* Recognition may still work when local recording is unavailable. */ }
  }
  recognition.onstart = () => {
    if (!active) { recognition.abort(); return; }
    draw(true); announce('Đang nghe tiếng Nhật…');
    capture(generation);
    timer = setTimeout(() => recognition.stop(), 60000);
  };
  recognition.onresult = event => {
    if (!active) return;
    const transcript = Array.from(event.results, result => result[0].transcript).join('');
    input.value = [prefix, transcript].filter(Boolean).join(' ').slice(0, 6000);
    input.dispatchEvent?.(new Event('input', {bubbles: true}));
  };
  recognition.onerror = event => {
    failed = true; active = false; draw(false);
    const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Chưa có quyền micro. Cho phép micro hoặc nhập câu trả lời.'
      : event.error === 'network' ? 'Mất kết nối nhận diện. Thử lại hoặc nhập câu trả lời.'
      : 'Chưa nghe rõ. Thử ghi âm lại hoặc nhập câu trả lời.';
    announce(message); onError?.(message); release();
  };
  recognition.onend = () => {
    active = false; draw(false); release();
    if (!failed) announce(input.value.trim() ? 'Đã nhận câu trả lời.' : 'Micro sẵn sàng');
  };
  const toggle = () => {
    if (active) { recognition.stop(); return; }
    failed = false; active = true; generation++; prefix = input.value.trim();
    playback?.pause();
    announce('Đang mở micro…'); draw(true);
    try { recognition.start(); }
    catch { active = false; draw(false); announce('Chưa mở được micro. Hãy thử lại.'); }
  };
  if(bindButton)button.addEventListener('click',toggle);
  playbackButton?.addEventListener('click', () => {
    if (!audioUrl) return;
    playback?.pause(); playback = new Audio(audioUrl);
    playback.play().catch(() => announce('Chưa phát được bản ghi. Hãy thử lại.'));
  });
  const controller = {toggle,get active(){return active;},reset() {
    generation++; failed = false;
    if (active) { active = false; recognition.abort(); }
    release(); draw(false); playback?.pause();
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    if (playbackButton) playbackButton.hidden = true;
    announce('Micro sẵn sàng');
  }};
  if(bindButton)japaneseInputs.push(controller);
  return controller;
}
addEventListener('pagehide', stopJapaneseInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopJapaneseInputs(); });
