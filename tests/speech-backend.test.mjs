import test from 'node:test';
import assert from 'node:assert/strict';
import {speechResponse, openAISpeechResponse, DEFAULT_SPEECH_MODEL} from '../src/speech.js';

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
    assert.equal(typeof part.speech_metadata.style, 'string');
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

test('provider auth, billing and missing-model failures remain actionable without expiring the app session or exposing secrets', async () => {
  const original=globalThis.fetch;
  try {
    for(const [status,code,http] of [[401,'tts_key_rejected',403],[403,'tts_key_rejected',403],[402,'tts_billing',403],[404,'speech_model_missing',409]]) {
      let calls=0;
      globalThis.fetch=async()=>{calls++;return Response.json({error:{message:key}},{status});};
      const response=await speechResponse({text:'こんにちは。'},key),body=await response.json();
      assert.equal(response.status,http);
      assert.equal(body.code,code);
      assert.equal(calls,1);
      assert.ok(!JSON.stringify(body).includes(key));
    }
  } finally {globalThis.fetch=original;}
});

test('OpenAI speech reports alloy, preserves the entire allowed transcript and rejects model substitution without synthesis', async () => {
  const original = globalThis.fetch, provider = {apiKey:key}, text = '日'.repeat(4000);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url,'https://api.openai.com/v1/audio/speech');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer '+key);
    assert.deepEqual(JSON.parse(options.body),{model:'gpt-4o-mini-tts',voice:'alloy',input:text,response_format:'mp3'});
    return new Response(new Uint8Array([73,68,51]));
  };
  try {
    const models = await (await openAISpeechResponse({action:'models'},provider)).json();
    assert.deepEqual(models.models,['gpt-4o-mini-tts']);
    assert.equal(models.voice,'alloy'); assert.equal(models.verified,false);
    assert.equal((await openAISpeechResponse({text,speech_model:DEFAULT_SPEECH_MODEL},provider)).status,400);
    assert.equal((await openAISpeechResponse({text:text+'日'},provider)).status,400);
    assert.equal(calls,0);
    const response = await openAISpeechResponse({text,speech_model:'gpt-4o-mini-tts'},provider);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{mimeType:'audio/mpeg',audioBase64:'SUQz',voice:'alloy',model:'gpt-4o-mini-tts'});
    assert.equal(calls,1);
  } finally {globalThis.fetch = original;}
});

test('OpenAI speech sanitizes upstream failures and empty audio without retrying or changing voice', async () => {
  const original = globalThis.fetch;
  try {
    for (const [status,expected] of [[401,503],[403,503],[429,429],[503,503]]) {
      let calls = 0;
      globalThis.fetch = async () => {calls++;return new Response(key,{status});};
      const response = await openAISpeechResponse({text:'こんにちは'},{apiKey:key});
      assert.equal(response.status,expected);
      assert.equal((await response.json()).code,'tts_unavailable');
      assert.equal(calls,1);
    }
    globalThis.fetch = async () => new Response('');
    const response = await openAISpeechResponse({text:'こんにちは'},{apiKey:key});
    assert.equal(response.status,503);
    assert.ok(!(await response.text()).includes(key));
  } finally {globalThis.fetch = original;}
});
