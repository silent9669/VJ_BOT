import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_MAX_SEGMENTS, VOICE_COMMANDS, reversedPrompt, voiceInstructions, voiceStreamingInstructions} from '../src/prompt.js';

test('only a fresh explicit start authorizes a voice welcome', () => {
  const fresh = voiceStreamingInstructions('N5', {command: 'start'});
  assert.match(fresh, /^TURN OPENING: You may give .*welcome/m);
  for (const options of [{}, {command: 'hint'}, {command: 'start', preAnswerTask: true},
    {continuation: true}, {command: 'start', continuation: true}, {command: 'hint', continuation: true}]) {
    const prompt = voiceStreamingInstructions('N5', options);
    assert.doesNotMatch(prompt, /^TURN OPENING: You may give .*welcome/m);
    if (options.continuation) assert.match(prompt, /^TURN OPENING: Continue\b/m);
  }
});

test('stream instructions include only the selected command; native sessions can still receive each command', () => {
  const keys = ['start', 'hint', 'explain', 'situation', 'check', 'repeat', 'slower', 'summary'];
  const native = voiceInstructions('N4');
  for (const key of keys) {
    assert.ok(VOICE_COMMANDS[key], key);
    assert.ok(native.includes(VOICE_COMMANDS[key]), key);
  }
  for (const command of [null, ...keys.filter(key => key !== 'repeat')]) {
    const prompt = voiceStreamingInstructions('N4', {command});
    assert.deepEqual(keys.filter(key => prompt.includes(VOICE_COMMANDS[key])), command ? [command] : []);
    assert.doesNotMatch(prompt, /NATIVE COMMANDS:/);
  }
});


test('stream transport and protection are independent of command and language mode', () => {
  const protectedStream = voiceStreamingInstructions('N5', {command: 'check', japaneseOnly: true, preAnswerTask: true});
  assert.match(protectedStream, /^JAPANESE-ONLY TURN: .*<ja>.*<vi>/m);
  assert.match(protectedStream, /^PRE-ANSWER CANONICAL TASK: .*Never solve the task/m);
  const ordinary = voiceStreamingInstructions('N5', {command: 'check'});
  assert.doesNotMatch(ordinary, /JAPANESE-ONLY TURN:|PRE-ANSWER CANONICAL TASK:/);
  for (const prompt of [protectedStream, ordinary]) {
    assert.ok(prompt.includes(`Use at most ${LIVE_MAX_SEGMENTS} tagged segments`));
    assert.match(prompt, /<ja>\.\.\.<\/ja>.*<vi>\.\.\.<\/vi>.*Write nothing outside the tags except separating whitespace/);
  }
});

test('a digits-only request changes presentation, not a protected exercise or a quoted phrase',()=>{
  const message='Mình đã chọn bao nhiêu, chỉ viết một chữ số thôi.';
  for (const build of [reversedPrompt,voiceStreamingInstructions]) {
    assert.match(build('N5',{message}),/^REQUESTED FORMAT:/m);
    assert.doesNotMatch(build('N5',{message:'Em dịch “chỉ viết một chữ số thôi” thế nào?'}),/^REQUESTED FORMAT:/m);
  }
  assert.doesNotMatch(voiceStreamingInstructions('N5',{message,preAnswerTask:true}),/^REQUESTED FORMAT:/m);
  assert.doesNotMatch(reversedPrompt('N5',{message,intent:'hint'}),/^REQUESTED FORMAT:/m);
});
