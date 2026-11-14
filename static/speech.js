// Read-aloud owns one request and one audio element. Provider errors never change voices.
let speechPlayback = null;

function speechReading(text, reading = '') {
  const kana = reading.replace(/[（(][^）)]*[）)]/g, '').trim();
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(kana) ? kana : text;
}

function speechText(text, {reading = '', japaneseOnly = false} = {}) {
  let clean = speechReading(String(text || ''), reading)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{([^{}|]+)\|([^{}|]+)\}/g, '$2')
    .replace(/([\p{Script=Han}々]+[\p{Script=Hiragana}ー]*)\s*[（(]([\p{Script=Hiragana}\p{Script=Katakana}ー]+)[）)]/gu, '$2')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。！？])\s*[（(][A-Za-zāīūēōĀĪŪĒŌ][A-Za-zāīūēōĀĪŪĒŌ0-9\s'.,!?-]*[）)]/gu, '$1')
    .replace(/[#*`_]/g, '').trim();
  if (japaneseOnly) {
    const japanese = clean.replace(/\p{Script=Latin}[\p{Script=Latin}\p{M}\d-]*/gu, word => /^[A-Z][A-Z0-9-]*$/.test(word) ? word : '\n');
    const spans = japanese.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヵヶA-Z0-9０-９。、！？!?「」『』（）()・：:〜～….,%％ \t]+/gu) || [];
    clean = spans.filter(span => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(span))
      .map(span => span.replace(/^[\s。、！？!?：:.,]+/u, '').trim()).join('\n');
  }
  return clean;
}

function audioDataUrl(data) {
  const mime = data.mimeType || 'audio/wav';
  if (!/^audio\/l16(?:;|$)/i.test(mime)) {
    if (!/^audio\/(?:wav|x-wav|mpeg|mp3|ogg)(?:;|$)/i.test(mime)) throw new Error('Định dạng âm thanh giọng nói không được hỗ trợ.');
    return `data:${mime};base64,${data.audioBase64}`;
  }
  const rate = Number(mime.match(/;\s*rate=(\d+)(?:;|$)/i)?.[1] || 24000);
  const channels = Number(mime.match(/;\s*channels=(\d+)(?:;|$)/i)?.[1] || 1);
  const pcm = Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0));
  if (rate < 8000 || rate > 192000 || ![1, 2].includes(channels) || pcm.length % (2 * channels)) throw new Error('Định dạng PCM của giọng nói không hợp lệ.');
  const wav = new Uint8Array(44 + pcm.length), view = new DataView(wav.buffer);
  const write = (offset, text) => [...text].forEach((c, i) => {wav[offset + i] = c.charCodeAt(0);});
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, pcm.length, true); wav.set(pcm, 44);
  let binary = '';
  for (let i = 0; i < wav.length; i += 8192) binary += String.fromCharCode(...wav.subarray(i, i + 8192));
  return 'data:audio/wav;base64,' + btoa(binary);
}

function speechStatus(message, active = false) {
  document.getElementById('speech-notice').hidden = !message;
  document.getElementById('speech-status').textContent = message;
  document.getElementById('speech-stop').textContent = active ? 'Dừng' : 'Đóng';
}

function stopSpeech() {
  const previous = speechPlayback;
  speechPlayback = null;
  previous?.controller.abort();
  if (previous?.audio) {
    previous.audio.pause();
    previous.audio.removeAttribute('src');
    previous.audio.load();
  }
  if (previous) mascotMgr.setState('idle');
  speechStatus('');
}
function speechIdentity() {
  try {
    if (typeof window.voiceIdentity !== 'function' || typeof window.selectedSpeechModel !== 'function') return null;
    const identity = window.voiceIdentity();
    return identity ? JSON.stringify([identity, window.selectedSpeechModel()]) : null;
  }
  catch { return null; }
}


async function playGeminiTTS(text, options = {}) {
  stopSpeech();
  globalThis.stopJapaneseInputs?.();
  window.speechSynthesis?.cancel();
  const clean = speechText(text, options);
  if (!/\p{L}/u.test(clean)) {
    speechStatus('Không có chữ để đọc.');
    return;
  }
  const identity = speechIdentity();
  if (identity === null) {speechStatus('Cài đặt giọng nói không dùng được. Hãy mở lại cài đặt giọng nói.'); return;}
  const model = window.selectedSpeechModel();
  if (!model) {speechStatus('Chọn tài khoản và model giọng nói trong Cài đặt.'); return;}
  const controller = new AbortController();
  const current = () => {
    if (speechPlayback?.controller !== controller) return false;
    if (speechIdentity() === identity) return true;
    stopSpeech();
    return false;
  };
  const language = options.japaneseOnly ? 'tiếng Nhật' : 'tiếng Việt và tiếng Nhật';
  speechPlayback = {controller, audio: null};
  speechStatus(`Đang chuẩn bị âm thanh ${language}…`, true);
  try {
    let reference={};
    const context=options.lesson?options:globalThis.teacherContext?.();
    if(context?.lesson){
      reference={lesson:context.lesson,focus:context.focus || null,view:context.view || 'checks'};
      if(context.task)reference.task=await taskReference(context.task);
    }
    if(!current())return;
    const response = await apiFetch('/api/tts', {
      method: 'POST', signal: controller.signal,
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text:clean,speech_model:model,...reference})
    });
    if (!current()) return;
    const data = await response.json();
    if (!current()) return;
    if (!response.ok) throw new Error(data.detail || 'Không đọc được lúc này. Hãy thử lại.');
    if (typeof data.audioBase64 !== 'string' || !data.audioBase64) throw new Error('Không nhận được âm thanh giọng nói.');
    const audio = new Audio(audioDataUrl(data));
    speechPlayback = {controller, audio};
    audio.onended = () => {if (current()) stopSpeech();};
    audio.onerror = () => {
      if (!current()) return;
      stopSpeech();
      speechStatus('Không phát được giọng đọc. Hãy thử lại.');
    };
    await audio.play();
    if (!current()) {audio.pause(); return;}
    mascotMgr.setState('speaking');
    speechStatus(`Đang đọc ${language}${data.voice ? ' · ' + data.voice : ''}${data.model ? ' · ' + data.model : ''}`, true);
  } catch (error) {
    if (!current()) return;
    stopSpeech();
    speechStatus(error.name === 'NotAllowedError' ? 'Trình duyệt chặn phát âm thanh. Bấm Nghe lại.' : 'Chưa phát được âm thanh. Em bấm Nghe để thử lại nhé.' + (error.message ? ' Chi tiết kết nối: ' + error.message : ''));
  }
}

document.getElementById('speech-stop').addEventListener('click', stopSpeech);
window.addEventListener('pagehide', stopSpeech);
window.addEventListener('hashchange', stopSpeech);
window.addEventListener('popstate', stopSpeech);
window.addEventListener('vjbot-voice-changed', stopSpeech);
window.addEventListener('vjbot-account-ready', stopSpeech);
