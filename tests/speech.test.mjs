import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = readFileSync('static/speech.js', 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
function speech(apiFetch = async () => Response.json({audioBase64:'UklGRg==', mimeType:'audio/wav'})) {
  const elements = new Map(['speech-notice', 'speech-status', 'speech-stop'].map(id => [id, {hidden:true, textContent:'', addEventListener(){}}]));
  const audios = [], states = [], events = new Map();
  const context = vm.createContext({
    AbortController,Response,atob,btoa,Uint8Array,DataView,crypto:webcrypto,TextEncoder,
    document:{getElementById:id => elements.get(id)},
    window:{addEventListener(name, handler){events.set(name, handler);}, voiceIdentity:()=>'owner:voice',
      selectedSpeechModel:()=>'gemini-3.8-flash-tts', speechSynthesis:{cancel(){}, speak(){throw new Error('Native voice fallback is forbidden');}}},
    mascotMgr:{setState:state => states.push(state)}, apiFetch,
    Audio:class {
      constructor(url) {this.src = url; this.paused = true; audios.push(this);}
      async play() {this.paused = false;}
      pause() {this.paused = true;}
      removeAttribute(name) {if (name === 'src') this.src = '';}
      load() {}
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(readFileSync('static/learning.js', 'utf8'), context);
  vm.runInContext(readFileSync('static/lesson-checks.js','utf8'),context);
  return {context, audios, states, events, status:() => elements.get('speech-status').textContent, visible:() => !elements.get('speech-notice').hidden};
}

test('Japanese-only chat speech omits explanations and duplicate kana/romaji readings', () => {
  const {context:c} = speech();
  assert.equal(c.speechText('Đúng rồi. 学生(がくせい)です。(gakusei desu)\nVì: Đây là học sinh.', {japaneseOnly:true}), 'がくせいです。');
  assert.equal(c.speechText('Nói: 3時にAIを使います。 Nghĩa: dùng AI lúc 3 giờ.', {japaneseOnly:true}), '3時にAIを使います。');
  assert.equal(c.speechText('<b>{私|わたし}</b>は{学生|がくせい}です。'), 'わたし はがくせいです。');
  assert.equal(c.speechText('JohnさんはUSBを使います。'), 'JohnさんはUSBを使います。');
});

test('bilingual speech retains Vietnamese explanations and Japanese readings without duplicated romaji', async () => {
  let body;
  const s = speech(async (_path, options) => {
    body = JSON.parse(options.body);
    return Response.json({audioBase64:'UklGRg==', mimeType:'audio/wav'});
  });
  await s.context.playGeminiTTS('Đúng rồi. 学生(がくせい)です。(gakusei desu) Nghĩa là học sinh (ví dụ).');
  assert.equal(body.text, 'Đúng rồi. がくせいです。 Nghĩa là học sinh (ví dụ).');
  assert.equal(s.audios[0].paused, false);
  await s.context.playGeminiTTS('Đây là giải thích tiếng Việt.');
  assert.equal(body.text, 'Đây là giải thích tiếng Việt.');
});

test('unambiguous word readings override homographs but alternative Kanji readings are not guessed', () => {
  const {context:c} = speech();
  assert.equal(c.speechText('生', {reading:'なま'}), 'なま');
  assert.equal(c.speechText('私', {reading:'わたし (watashi)'}), 'わたし');
  assert.equal(c.speechText('学', {reading:'ガク · まな.ぶ'}), '学');
});

test('a Japanese-only button with no Japanese does not send an empty or foreign transcript', async () => {
  let calls = 0;
  const s = speech(async () => {calls++;});
  await s.context.playGeminiTTS('Đây là giải thích tiếng Việt.', {japaneseOnly:true});
  assert.equal(calls, 0);
  assert.equal(s.visible(), true);
});

test('provider errors remain visible and do not silently switch the learner to another voice', async () => {
  const detail = 'Add a Google Gemini API key in Settings.';
  let requests = 0;
  const s = speech(async () => {requests++; return Response.json({detail}, {status:403});});
  await s.context.playGeminiTTS('こんにちは。');
  assert.equal(s.audios.length, 0);
  assert.equal(s.visible(), true);
  assert.match(s.status(), /chưa phát.*âm thanh/i);
  assert.ok(s.status().includes(detail));
  assert.equal(requests, 1);
  s.context.stopSpeech();
  assert.equal(s.visible(), false);
});

test('missing audio is an error rather than a successful browser-voice fallback', async () => {
  let requests = 0;
  const s = speech(async () => {requests++; return Response.json({fallback:true});});
  await s.context.playGeminiTTS('こんにちは。');
  assert.equal(s.audios.length, 0);
  assert.equal(s.visible(), true);
  assert.match(s.status(), /chưa phát.*âm thanh/i);
  assert.match(s.status(), /không nhận được âm thanh/i);
  assert.equal(requests, 1);
});

test('the latest click aborts old work and ignores a late response even if cancellation is ignored', async () => {
  const requests = [];
  const s = speech((path, options) => {
    const response = deferred();
    requests.push({...response, options});
    return response.promise;
  });
  const old = s.context.playGeminiTTS('古い文。');
  const latest = s.context.playGeminiTTS('新しい文。');
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve(Response.json({audioBase64:'new', mimeType:'audio/wav'}));
  await latest;
  requests[0].resolve(Response.json({audioBase64:'old', mimeType:'audio/wav'}));
  await old;
  assert.deepEqual(s.audios.map(a => a.src), ['data:audio/wav;base64,new']);
  assert.equal(s.audios[0].paused, false);
  s.context.stopSpeech();
  assert.equal(s.audios[0].paused, true);
  assert.equal(requests[1].options.signal.aborted, true);
  assert.equal(s.visible(), false);
});

test('replacing playing audio stops it and stale end/error events cannot stop its replacement', async () => {
  const s = speech();
  await s.context.playGeminiTTS('一つ目。');
  const first = s.audios[0];
  await s.context.playGeminiTTS('二つ目。');
  assert.equal(first.paused, true);
  first.onended(); first.onerror();
  assert.equal(s.audios[1].paused, false);
  s.audios[1].onended();
  assert.equal(s.visible(), false);
  assert.equal(s.states.at(-1), 'idle');
});

test('an old play promise settling cannot overwrite a newer request or resume stopped audio', async () => {
  const s = speech();
  const play = deferred();
  s.context.Audio.prototype.play = function () {this.paused = false; return play.promise;};
  const first = s.context.playGeminiTTS('一つ目。');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.audios[0].paused, false);
  s.context.stopSpeech();
  play.resolve(); await first;
  assert.equal(s.audios[0].paused, true);
  assert.equal(s.visible(), false);
});

test('audio decode failures stop the player and leave an actionable error', async () => {
  const s = speech();
  await s.context.playGeminiTTS('こんにちは。');
  s.audios[0].onerror();
  assert.equal(s.audios[0].paused, true);
  assert.equal(s.status(), 'Không phát được giọng đọc. Hãy thử lại.');
  assert.equal(s.states.at(-1), 'idle');
});

test('PCM media-type case, sample rate and channels preserve sample timing and signed samples', () => {
  const {context:c} = speech();
  const samples = Buffer.from([0, 0, 255, 127, 0, 128, 0, 0]);
  for (const mimeType of ['audio/l16;rate=16000;channels=2', 'audio/L16;rate=16000;channels=2']) {
    const url = c.audioDataUrl({mimeType, audioBase64:samples.toString('base64')});
    const wav = Buffer.from(url.split(',')[1], 'base64');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt32LE(28), 64000);
    assert.equal(wav.readUInt16LE(32), 4);
    assert.equal(wav.readUInt32LE(40) / wav.readUInt32LE(28), 2 / 16000);
    assert.deepEqual([...wav.subarray(44)].map((_, i) => i % 2 ? null : wav.readInt16LE(44 + i)).filter(n => n !== null), [0, 32767, -32768, 0]);
  }
  assert.throws(() => c.audioDataUrl({mimeType:'audio/l16;rate=16000;channels=2', audioBase64:'AA=='}), /Định dạng PCM của giọng nói không hợp lệ/);
});

test('Listen uses the saved model without a catalog request or automatic refresh', async () => {
  const requests = [];
  const s = speech(async (path, options) => {
    requests.push({path, body:JSON.parse(options.body)});
    return Response.json({audioBase64:'UklGRg==', mimeType:'audio/wav'});
  });
  s.context.window.selectedSpeechModel = () => 'gemini-3.8-flash-lite-tts';
  s.context.window.refreshSpeechModels = () => {throw new Error('Unexpected catalog refresh');};
  await s.context.playGeminiTTS('こんにちは。', {japaneseOnly:true});
  assert.deepEqual(requests.map(request => request.path), ['/api/tts']);
  assert.equal(requests[0].body.speech_model, 'gemini-3.8-flash-lite-tts');
  assert.equal(s.audios[0].paused, false);
});

test('a changed voice profile or model discards pending audio even without a change event', async () => {
  for (const change of ['profile', 'model']) {
    const pending = deferred();
    let profile = 'owner-a:voice-a', model = 'gemini-3.8-flash-tts', signal;
    const s = speech((_path, options) => {signal = options.signal; return pending.promise;});
    s.context.window.voiceIdentity = () => profile;
    s.context.window.selectedSpeechModel = () => model;
    const play = s.context.playGeminiTTS('こんにちは。');
    if (change === 'profile') profile = 'owner-b:voice-b';
    else model = 'gemini-3.8-flash-lite-tts';
    pending.resolve(Response.json({audioBase64:'old-audio', mimeType:'audio/wav'}));
    await play;
    assert.equal(s.audios.length, 0);
    assert.equal(signal.aborted, true);
    assert.equal(s.visible(), false);
  }
});

test('voice and account changes immediately stop current playback', async () => {
  for (const event of ['vjbot-voice-changed', 'vjbot-account-ready']) {
    const s = speech();
    await s.context.playGeminiTTS('こんにちは。');
    const audio = s.audios[0];
    s.events.get(event)();
    assert.equal(audio.paused, true);
    assert.equal(audio.src, '');
    assert.equal(s.visible(), false);
  }
});

test('an unavailable saved speech model never falls back to the default model', async () => {
  let requests = 0;
  const s = speech(async () => {requests++; return Response.json({audioBase64:'UklGRg==', mimeType:'audio/wav'});});
  s.context.window.selectedSpeechModel = () => '';
  await s.context.playGeminiTTS('こんにちは。');
  assert.equal(requests, 0);
  assert.equal(s.audios.length, 0);
  assert.equal(s.visible(), true);
});

test('playback labels use the returned provider voice instead of claiming Charon for OpenAI',async()=>{
  for(const [voice,model] of [['alloy','gpt-4o-mini-tts'],['Charon','gemini-3.8-flash-tts']]){
    const s=speech(async()=>Response.json({audioBase64:'UklGRg==',mimeType:'audio/wav',voice,model}));
    await s.context.playGeminiTTS('こんにちは。',{japaneseOnly:true});
    assert.equal(s.status(),`Đang đọc tiếng Nhật · ${voice} · ${model}`);
  }
});

test('missing voice settings helpers never generate speech through an implicit Gemini default',async()=>{
  let calls=0;
  const s=speech(async()=>{calls++;return Response.json({});});
  delete s.context.window.selectedSpeechModel;
  await s.context.playGeminiTTS('こんにちは。');
  assert.equal(calls,0);
  assert.match(s.status(),/Cài đặt giọng nói không dùng được/);
});

test('task read-aloud carries canonical revision without changing independent voice selection',async()=>{
  const sent=[],s=speech(async(_path,options)=>{sent.push(JSON.parse(options.body));return Response.json({audioBase64:'UklGRg==',mimeType:'audio/wav'});});
  const task=s.context.normalizedLessonTasks({id:'reading',drills:[{q:'Read',opts:['a','b'],answer_index:0}]},'N3','reading')[0];
  const lesson={id:'reading',level:'N3'},focus={kind:'question',index:0};
  s.context.teacherContext=()=>({lesson,focus,task,view:'checks'});
  await s.context.playGeminiTTS('日本語。');
  assert.deepEqual(sent[0].lesson,lesson);assert.deepEqual(sent[0].focus,focus);
  assert.equal(sent[0].task.id,task.task_id);assert.match(sent[0].task.revision,/^[a-f0-9]{64}$/);
  assert.equal(sent[0].speech_model,'gemini-3.8-flash-tts');
  s.context.taskReference=async()=>{throw new Error('Stale task reference.');};
  await s.context.playGeminiTTS('次の文。');
  assert.equal(sent.length,1);assert.match(s.status(),/Stale task reference/);
});
