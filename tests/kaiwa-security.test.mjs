import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseKaiwaEvaluation} from '../src/kaiwa.js';
import {kaiwaJudgment, testRubric} from './fixtures/kaiwa-judgments.mjs';

test('varying legitimate names and occupations are not constrained by a name whitelist', () => {
  for (const speech of ['私はグエン・ティ・ハーです。看護師です。', 'アレックスと申します。庭師をしています。', 'リンです。今は仕事をしていません。']) {
    const result = parseKaiwaEvaluation(JSON.stringify(kaiwaJudgment(testRubric, speech)), speech, testRubric);
    assert.equal(result.status, 'estimated');assert.equal(result.score, null);
    assert.equal(result.estimated_score, 100);
    assert.deepEqual(result.criteria[0].evidence, [speech]);
  }
});
const app = readFileSync('static/app.js', 'utf8');
function kaiwaUI(apiFetch) {
  const elements = new Map(), spoken = [], effects = {cheers: 0, completions: 0};
  for (const id of ['btn-eval-kaiwa', 'kaiwa-manual-input', 'kaiwa-result-card', 'kaiwa-score-val', 'kaiwa-feedback-text', 'kaiwa-model-text', 'btn-kaiwa-model-tts', 'kaiwa-criteria', 'kaiwa-error']) {
    elements.set(id, {textContent: '', value: '', hidden: true, disabled: false, listeners: {}, focused: false,
      children: [], replaceChildren() {this.children = [];}, append(child) {this.children.push(child);},
      focus() {this.focused = true;},
      addEventListener(type, fn) {this.listeners[type] = fn;},
      dispatchEvent(event) {return this.listeners[event.type]?.(event);},
      click() {return this.disabled ? undefined : this.listeners.click?.();}});
  }
  const element = id => elements.get(id);
  const c = vm.createContext({
    document: {getElementById: element, createElement: () => ({textContent: ''})}, window: {JLPT_DATA: {kaiwaScenarios: {intro: {prompts: [{jp: 'お名前とお仕事は？'}]}}}},
    kaiwaInput: element('kaiwa-manual-input'), activeKaiwaKey: 'intro', activeKaiwaPromptIdx: 0, activeKaiwaLevel: 'N5', navigationVersion: 0, AbortSignal,
    soundEngine: {playCheer() {effects.cheers++;}},
    mountCompletion() {effects.completions++;}, playGeminiTTS: text => spoken.push(text), apiFetch
  });
  vm.runInContext(app.slice(app.indexOf('  // Kaiwa Evaluation submit'), app.indexOf('  // Quiz Next & Restart buttons')), c);
  return {c, element, spoken, effects, submit: () => element('btn-eval-kaiwa').click()};
}
const assessment = speech => ({
  ...parseKaiwaEvaluation(JSON.stringify(kaiwaJudgment(testRubric, speech)), speech, testRubric),
  user_text: speech, scenario: 'Introduction'
});

test('real Kaiwa callback shows estimated points and criterion evidence without official grade, cheer or completion', async () => {
  const speech = '私はサラです。建築家です。', sent = [];
  const b = kaiwaUI(async (path, options) => {sent.push([path, JSON.parse(options.body)]); return Response.json(assessment(speech));});
  b.element('kaiwa-manual-input').value = speech;
  await b.submit();
  assert.equal(sent.length, 1);assert.equal(sent[0][0], '/api/kaiwa/evaluate');
  assert.deepEqual(sent[0][1], {scenario_id: 'intro', prompt_index: 0, user_speech: speech, level: 'N5'});
  assert.match(b.element('kaiwa-score-val').textContent, /^100\/100\b/);
  assert.equal(b.element('kaiwa-feedback-text').textContent, assessment(speech).feedback);
  assert.equal(b.element('kaiwa-criteria').children.length, 4);
  assert.ok(b.element('kaiwa-criteria').children[0].textContent.includes(speech));
  assert.equal(b.element('kaiwa-model-text').textContent, assessment(speech).model_answer);
  assert.equal(b.element('kaiwa-result-card').hidden, false);
  assert.equal(b.effects.cheers, 0);assert.equal(b.effects.completions, 0);
  await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, [assessment(speech).model_answer]);
});

test('Kaiwa UI never invents a successful grade, praise or model answer for invalid, ungraded or failed responses', async () => {
  const speech = 'バナナは黄色です。';
  for (const data of [{score: 100, rating: 'Xuất sắc', feedback: 'Excellent!'}, {...assessment(speech), score: 100}, {...assessment(speech), model_answer: ''}, {...assessment(speech), criteria: [{label: 'Fabrication', verdict: 'met', evidence: ['私は学生です。']}]}, {...assessment(speech), criteria: assessment(speech).criteria.map(item => ({...item, evidence: []}))}, {status: 'ungraded', reason: 'empty_submission', score: null, rating: null, feedback: 'No answer was submitted.', model_answer: '', criteria: []}]) {
    const b = kaiwaUI(async () => Response.json(data));
    b.element('kaiwa-manual-input').value = speech;await b.submit();
    assert.doesNotMatch(b.element('kaiwa-score-val').textContent, /\d/);
    assert.equal(b.element('kaiwa-model-text').textContent, '');
    assert.doesNotMatch(b.element('kaiwa-feedback-text').textContent, /Excellent|Phản xạ giao tiếp rất tốt/);
    assert.equal(b.effects.cheers, 0);assert.equal(b.effects.completions, 0);
    assert.equal(b.element('btn-eval-kaiwa').disabled, false);
  }
  const b = kaiwaUI(async () => {throw new Error('Offline');});
  b.element('kaiwa-manual-input').value = speech;b.element('kaiwa-model-text').textContent = 'OLD';
  await b.submit();
  assert.equal(b.element('kaiwa-model-text').textContent, '');
  assert.doesNotMatch(b.element('kaiwa-score-val').textContent, /\d/);
  assert.ok(b.element('kaiwa-feedback-text').textContent.trim());
});

test('empty Kaiwa UI input never sends inference or triggers success callbacks', async () => {
  let calls = 0;const b = kaiwaUI(async () => {calls++;});
  b.element('kaiwa-manual-input').value = '  ';await b.submit();
  assert.equal(calls, 0);assert.equal(b.effects.cheers, 0);assert.equal(b.effects.completions, 0);
  assert.equal(b.element('kaiwa-error').hidden, false);assert.equal(b.element('kaiwa-manual-input').focused, true);
});

test('Kaiwa UI ignores a result whose question changes while JSON is being read', {timeout: 1000}, async () => {
  let finish, signalStarted;
  const started = new Promise(resolve => {signalStarted = resolve;});
  const b = kaiwaUI(async () => ({ok: true, json: () => new Promise(resolve => {finish = resolve;signalStarted();})}));
  b.element('kaiwa-manual-input').value = 'はい。';
  const pending = b.submit();
  await started;
  b.c.activeKaiwaPromptIdx = 1;finish(assessment('はい。'));await pending;
  assert.equal(b.element('kaiwa-result-card').hidden, true);assert.equal(b.effects.cheers, 0);
});

test('Kaiwa result markup associates advisory guidance and live feedback without prefilled success', () => {
  const html = readFileSync('static/index.html', 'utf8');
  const panel = html.slice(html.indexOf('id="kaiwa-result-card"'), html.indexOf('<!-- TAB 5:'));
  assert.match(panel, /aria-describedby="kaiwa-advisory-notice"/);
  assert.match(panel, /không phải điểm chính thức/);
  assert.match(panel, /Nhận định và ví dụ của AI vẫn có thể sai/);
  assert.match(panel, /id="kaiwa-feedback-text" role="status" aria-live="polite"/);
  assert.doesNotMatch(panel, /100 Điểm|>90<|Câu trả lời rất tự nhiên và chính xác/);
});

test('Kaiwa UI displays a provider failure honestly without retaining the previous AI example', async () => {
  const b = kaiwaUI(async () => Response.json({
    status: 'ungraded', reason: 'invalid_feedback', score: null, rating: null,
    detail: 'No reliable advisory feedback was returned. Nothing has been graded.'
  }, {status: 503}));
  b.element('kaiwa-manual-input').value = 'はい。';
  b.element('kaiwa-model-text').textContent = 'OLD EXAMPLE';await b.submit();
  assert.doesNotMatch(b.element('kaiwa-score-val').textContent, /\d/);
  assert.equal(b.element('kaiwa-model-text').textContent, '');
  assert.equal(b.element('kaiwa-feedback-text').textContent, 'No reliable advisory feedback was returned. Nothing has been graded.');
  assert.equal(b.element('kaiwa-result-card').hidden, false);
  assert.equal(b.effects.cheers, 0);assert.equal(b.effects.completions, 0);
});

test('editing a pending Kaiwa answer discards both advice and stale provider failures', {timeout: 1000}, async () => {
  for (const outcome of ['advice', 'provider-error', 'network-error']) {
    let resolveResponse, rejectResponse, signalStarted;
    const started = new Promise(resolve => {signalStarted = resolve;});
    const b = kaiwaUI(() => new Promise((resolve, reject) => {resolveResponse = resolve;rejectResponse = reject;signalStarted();}));
    const original = '私はアンです。会社員です。';
    b.element('kaiwa-manual-input').value = original;
    const pending = b.submit();await started;
    b.element('kaiwa-manual-input').value = '私はマイです。学生です。';
    if (outcome === 'network-error') rejectResponse(new Error('Offline'));
    else resolveResponse(outcome === 'advice' ? Response.json(assessment(original)) : Response.json({detail: 'Provider failed'}, {status: 503}));
    await pending;
    assert.equal(b.element('kaiwa-result-card').hidden, true, outcome);
    assert.equal(b.element('kaiwa-model-text').textContent, '', outcome);
    assert.equal(b.element('kaiwa-feedback-text').textContent, '', outcome);
    await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, []);
    assert.equal(b.element('btn-eval-kaiwa').disabled, false);
  }
});

test('empty resubmission clears previous Kaiwa advice and its playable example without inference', async () => {
  const speech = '私はアンです。会社員です。';let calls = 0;
  const b = kaiwaUI(async () => {calls++;return Response.json(assessment(speech));});
  b.element('kaiwa-manual-input').value = speech;await b.submit();
  assert.equal(b.element('kaiwa-result-card').hidden, false);
  b.element('kaiwa-manual-input').value = ' ';await b.submit();
  assert.equal(calls, 1);
  assert.equal(b.element('kaiwa-result-card').hidden, true);
  assert.equal(b.element('kaiwa-model-text').textContent, '');
  await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, []);
});

test('editing the answer hides completed Kaiwa advice and removes its TTS ownership', async () => {
  const speech = '私はアンです。会社員です。';
  const b = kaiwaUI(async () => Response.json(assessment(speech)));
  b.element('kaiwa-manual-input').value = speech;await b.submit();
  b.element('kaiwa-manual-input').value = '別の答えです。';
  b.element('kaiwa-manual-input').dispatchEvent({type: 'input'});
  assert.equal(b.element('kaiwa-result-card').hidden, true);
  await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, []);
});

test('uncertain criterion results show no numeric grade and retain transparent criterion evidence', async () => {
  const speech = 'はい。';
  const result = parseKaiwaEvaluation(JSON.stringify(kaiwaJudgment(testRubric, speech, {grammar: {verdict: 'uncertain', evidence: []}})), speech, testRubric);
  const b = kaiwaUI(async () => Response.json({...result, user_text: speech}));
  b.element('kaiwa-manual-input').value = speech;await b.submit();
  assert.doesNotMatch(b.element('kaiwa-score-val').textContent, /\d/);
  assert.equal(b.element('kaiwa-feedback-text').textContent, result.feedback);
  assert.equal(b.element('kaiwa-criteria').children.length, 4);
});

test('an edit followed by restoring the same text cannot reclaim a pending assessment', {timeout: 1000}, async () => {
  let finish;
  const speech = '私はアンです。会社員です。';
  const b = kaiwaUI(() => new Promise(resolve => {finish = resolve;}));
  b.element('kaiwa-manual-input').value = speech;const pending = b.submit();
  b.element('kaiwa-manual-input').value = '別の答えです。';b.element('kaiwa-manual-input').dispatchEvent({type: 'input'});
  b.element('kaiwa-manual-input').value = speech;b.element('kaiwa-manual-input').dispatchEvent({type: 'input'});
  finish(Response.json(assessment(speech)));await pending;
  assert.equal(b.element('kaiwa-result-card').hidden, true);
  assert.equal(b.element('kaiwa-model-text').textContent, '');
});

test('navigation and level changes discard pending advice and failures', {timeout: 1000}, async () => {
  for (const change of ['navigationVersion', 'activeKaiwaLevel', 'activeKaiwaKey']) {
    for (const outcome of ['advice', 'provider-error', 'network-error']) {
      let finish, fail;
      const speech = 'はい。', b = kaiwaUI(() => new Promise((resolve, reject) => {finish = resolve;fail = reject;}));
      b.element('kaiwa-manual-input').value = speech;const pending = b.submit();
      b.c[change] = change === 'navigationVersion' ? 1 : 'other';
      if (outcome === 'network-error') fail(new Error('Offline'));
      else finish(outcome === 'advice' ? Response.json(assessment(speech)) : Response.json({detail: 'OLD FAILURE'}, {status: 503}));
      await pending;
      assert.equal(b.element('kaiwa-result-card').hidden, true, `${change}: ${outcome}`);
      assert.equal(b.element('kaiwa-feedback-text').textContent, '');
      assert.equal(b.element('btn-eval-kaiwa').disabled, false);
    }
  }
});

test('scenario prompt loading clears completed advice, evidence and model TTS through the same reset hook', async () => {
  const speech = 'はい。', b = kaiwaUI(async () => Response.json(assessment(speech)));
  b.element('kaiwa-manual-input').value = speech;await b.submit();
  for (const id of ['kaiwa-prompt-tag', 'kaiwa-prompt-jp', 'kaiwa-prompt-vi', 'kaiwa-next-prompt', 'kaiwa-prompt-hint', 'kaiwa-context', 'kaiwa-completion']) {
    const node = {hidden: false, textContent: ''};
    const getElementById = b.c.document.getElementById;
    b.c.document.getElementById = name => name === id ? node : getElementById(name);
  }
  b.c.document.querySelectorAll = () => [];
  vm.runInContext(app.slice(app.indexOf('function loadKaiwaPrompt()'), app.indexOf('// 12. JLPT MOCK EXAM CONTROLLER')), b.c);
  b.c.loadKaiwaPrompt();
  assert.equal(b.element('kaiwa-result-card').hidden, true);
  assert.equal(b.element('kaiwa-criteria').children.length, 0);
  assert.equal(b.element('kaiwa-model-text').textContent, '');
  await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, []);
});

test('browser STT input events clear completed Kaiwa feedback without replacing the shared Voice controller', async () => {
  const speech = 'はい。', b = kaiwaUI(async () => Response.json(assessment(speech)));
  b.element('kaiwa-manual-input').value = speech;await b.submit();
  let recognition;
  b.c.window.SpeechRecognition = class {
    constructor() {recognition = this;}
    start() {}
    abort() {}
    stop() {}
  };
  b.c.navigator = {};b.c.Event = Event;
  b.c.setTimeout = () => 1;b.c.clearTimeout = () => {};
  b.c.addEventListener = () => {};
  b.c.document.addEventListener = () => {};
  vm.runInContext(readFileSync('static/speech-input.js', 'utf8'), b.c);
  const controller = b.c.createBrowserJapaneseInput({
    button: {textContent: 'Record', setAttribute() {}}, input: b.element('kaiwa-manual-input'), bindButton: false
  });
  await controller.toggle();
  recognition.onresult({results: [[{transcript: '別の答えです。'}]]});
  assert.match(b.element('kaiwa-manual-input').value, /別の答えです/);
  assert.equal(b.element('kaiwa-result-card').hidden, true);
  assert.equal(b.element('kaiwa-criteria').children.length, 0);
  await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, []);
});

test('accepted workspace navigation clears completed advice before leaving the Kaiwa surface', async () => {
  const speech = 'はい。', b = kaiwaUI(async () => Response.json(assessment(speech)));
  b.element('kaiwa-manual-input').value = speech;await b.submit();
  const navigated = new Error('Stop after the navigation reset');
  b.c.authorizePage = () => true;b.c.confirmWorkspaceNavigation = () => true;
  b.c.stopSpeech = () => {};
  b.c.stopLiveConversation = () => {throw navigated;};
  const start = app.indexOf('function switchTab(');
  vm.runInContext(app.slice(start, app.indexOf('\n// ==========================================', start)), b.c);
  assert.throws(() => b.c.switchTab('dashboard'), error => error === navigated);
  assert.equal(b.element('kaiwa-result-card').hidden, true);
  assert.equal(b.element('kaiwa-criteria').children.length, 0);
  assert.equal(b.element('kaiwa-feedback-text').textContent, '');
  await b.element('btn-kaiwa-model-tts').click();assert.deepEqual(b.spoken, []);
});
