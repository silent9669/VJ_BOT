import test from 'node:test';
import assert from 'node:assert/strict';
import {speechResponse, DEFAULT_SPEECH_MODEL} from '../src/speech.js';

const key = 'synthetic-key-not-real';
const entry = name => ({name:'models/' + name, supportedGenerationMethods:['generateContent']});
const audio = () => Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/wav',data:'UklGRg=='}}]}}]});

test('speech discovery updates compatible candidates without generating audio or switching models', async () => {
  const original = globalThis.fetch, calls = [];
  let additions = false;
  globalThis.fetch = async (url, options) => {
    calls.push({url, method:options.method || 'GET'});
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['x-goog-api-key'], key);
    const rows = [entry(DEFAULT_SPEECH_MODEL), entry('gemini-3.8-flash-lite-tts'), entry('gemini-3-flash-preview'), entry('gemini-2.5-pro-preview-tts'), {name:'models/gemini-3.8-flash-tts-disabled',supportedGenerationMethods:['embedContent']}];
    if (additions) rows.push(entry('gemini-3.8-flash-tts-002'));
    return Response.json({models:rows});
  };
  try {
    let result = await (await speechResponse({action:'models'}, key)).json();
    assert.deepEqual(result.models, ['gemini-3.8-flash-lite-tts', DEFAULT_SPEECH_MODEL]);
    additions = true;
    result = await (await speechResponse({action:'models'}, key)).json();
    assert.ok(result.models.includes('gemini-3.8-flash-tts-002'));
    assert.equal(result.default_model, DEFAULT_SPEECH_MODEL);
    assert.equal(result.verified, false);
    assert.ok(calls.every(call => call.method === 'GET' && !call.url.includes('generateContent')));
  } finally {globalThis.fetch = original;}
});

test('male bilingual speech sends only the transcript and keeps Charon separate from delivery metadata', async () => {
  const original = globalThis.fetch;
  const text = 'Thầy giải thích nhé. 学生です。 Nghĩa là học sinh.';
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/' + DEFAULT_SPEECH_MODEL + ':generateContent'));
    const body = JSON.parse(options.body), part = body.contents[0].parts[0];
    assert.equal(part.text, text);
    assert.match(part.speech_metadata.style, /male.*Vietnamese.*Japanese/s);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
    return audio();
  };
  try {
    const response = await speechResponse({text}, key), data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.model, DEFAULT_SPEECH_MODEL);
    assert.equal(data.voice, 'Charon');
    assert.equal(data.audioBase64, 'UklGRg==');
  } finally {globalThis.fetch = original;}
});

test('explicit compatible alternative is catalog-bound and synthesizes only that model', async () => {
  const original = globalThis.fetch, calls = [];
  const model = 'gemini-3.8-flash-lite-tts';
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.includes(':generateContent')) {
      assert.ok(url.endsWith(model + ':generateContent'));
      assert.equal(options.method, 'POST');
      return audio();
    }
    return Response.json({models:[entry(model)]});
  };
  try {
    const response = await speechResponse({text:'Xin chào. こんにちは。',speech_model:model}, key);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).model, model);
    assert.equal(calls.filter(url => url.includes(':generateContent')).length, 1);
  } finally {globalThis.fetch = original;}
});

test('missing or incompatible selected model never falls back to another provider or model', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async url => {calls.push(url);return Response.json({models:[entry(DEFAULT_SPEECH_MODEL)]});};
  try {
    assert.equal((await speechResponse({text:'Xin chào',speech_model:'gemini-3.8-flash-lite-tts'}, key)).status, 409);
    assert.equal((await speechResponse({text:'Xin chào',speech_model:'../../other'}, key)).status, 400);
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].includes(':generateContent'));
  } finally {globalThis.fetch = original;}
});

test('quota errors remain distinct and do not trigger a retry or voice fallback', async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {count++;return Response.json({error:{message:key}}, {status:429});};
  try {
    const response = await speechResponse({text:'Xin chào'}, key), data = await response.json();
    assert.equal(response.status, 429);
    assert.equal(data.code, 'tts_quota');
    assert.equal(count, 1);
    assert.ok(!JSON.stringify(data).includes(key));
  } finally {globalThis.fetch = original;}
});

test('catalog quota or missing Google credentials never become a successful capability claim', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({error:{message:'quota'}}, {status:429});
  try {
    const response = await speechResponse({action:'models'}, key);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'tts_catalog_unavailable');
    assert.equal((await speechResponse({action:'models'}, null)).status, 403);
  } finally {globalThis.fetch = original;}
});
