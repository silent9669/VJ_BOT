import test from 'node:test';
import assert from 'node:assert/strict';
import {callLLM, probeModel} from '../src/llm.js';

const input = {system: 'Teach one short Japanese phrase.', turns: [{role: 'user', content: 'Hello.'}]};
const provider = protocol => ({protocol, baseUrl: 'https://api.example.test', apiKey: 'synthetic-private-key', models: ['first'], source: 'test'});
const completion = (protocol, reason, text = 'こんにちは。') => {
  if (protocol === 'openai') return {choices: [{message: {content: text}, ...(reason === undefined ? {} : {finish_reason: reason})}]};
  if (protocol === 'anthropic') return {content: [{type: 'text', text}], ...(reason === undefined ? {} : {stop_reason: reason})};
  return {candidates: [{content: {parts: [{text}]}, ...(reason === undefined ? {} : {finishReason: reason})}]};
};
function upstream(t, respond) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    return respond(calls.length - 1);
  });
  return calls;
}

for (const [protocol, reasons] of [
  ['openai', ['length', 'content_filter']],
  ['anthropic', ['max_tokens', 'refusal']],
  ['gemini', ['MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION']]
]) {
  for (const reason of reasons) test(`${protocol} rejects visible text marked ${reason}`, async t => {
    const calls = upstream(t, () => Response.json(completion(protocol, reason, 'private incomplete provider text')));
    assert.deepEqual(await callLLM(provider(protocol), input), {status: 502});
    assert.equal(calls.length, 1, 'an incomplete completion is not retried on the same model');
  });
}

for (const [protocol, reasons] of [
  ['openai', ['stop', undefined, null]],
  ['anthropic', ['end_turn', 'stop_sequence', undefined, null]],
  ['gemini', ['STOP', undefined, null]]
]) {
  for (const reason of reasons) test(`${protocol} accepts complete text with ${String(reason)} stop metadata`, async t => {
    upstream(t, () => Response.json(completion(protocol, reason)));
    assert.deepEqual(await callLLM(provider(protocol), input), {text: 'こんにちは。'});
  });
}

for (const [label, decorate] of [
  ['blocked prompt', data => {data.promptFeedback = {blockReason: 'SAFETY'};}],
  ['blocked prompt safety rating', data => {data.promptFeedback = {safetyRatings: [{blocked: true}]};}],
  ['blocked candidate safety rating', data => {data.candidates[0].safetyRatings = [{blocked: true}];}]
]) test(`Gemini rejects text accompanied by a ${label}`, async t => {
  const data = completion('gemini', 'STOP', 'private blocked provider text');
  decorate(data);
  upstream(t, () => Response.json(data));
  assert.deepEqual(await callLLM(provider('gemini'), input), {status: 502});
});

test('Gemini unspecified prompt blocking and unblocked ratings preserve compatibility', async t => {
  const data = completion('gemini', 'STOP');
  data.promptFeedback = {blockReason: 'BLOCK_REASON_UNSPECIFIED', safetyRatings: [{blocked: false}]};
  data.candidates[0].safetyRatings = [{blocked: false}];
  upstream(t, () => Response.json(data));
  assert.deepEqual(await callLLM(provider('gemini'), input), {text: 'こんにちは。'});
});

for (const protocol of ['anthropic', 'gemini']) test(`${protocol} returns visible text without thought blocks`, async t => {
  const data = protocol === 'anthropic'
    ? {stop_reason: 'end_turn', content: [{type: 'thinking', thinking: 'private thought', text: 'hidden'}, {type: 'text', text: 'こんにちは。'}]}
    : {candidates: [{finishReason: 'STOP', content: {parts: [{thought: true, text: 'private thought'}, {text: 'こんにちは。'}]}}]};
  upstream(t, () => Response.json(data));
  assert.deepEqual(await callLLM(provider(protocol), input), {text: 'こんにちは。'});
});

for (const protocol of ['openai', 'anthropic', 'gemini']) test(`${protocol} falls back to the next model after an incomplete completion`, async t => {
  const reason = {openai: 'length', anthropic: 'max_tokens', gemini: 'MAX_TOKENS'}[protocol];
  const calls = upstream(t, index => Response.json(completion(protocol, index ? undefined : reason, index ? 'Complete answer.' : 'Discard this partial.')));
  assert.deepEqual(await callLLM({...provider(protocol), models: ['first', 'second']}, input), {text: 'Complete answer.'});
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => protocol === 'gemini' ? new URL(call.url).pathname.split('/').at(-1) : call.body.model),
    protocol === 'gemini' ? ['first:generateContent', 'second:generateContent'] : ['first', 'second']);
});

const schema = {type: 'object', properties: {reply: {type: 'string'}}, required: ['reply'], additionalProperties: false};
for (const protocol of ['openai', 'anthropic', 'gemini']) test(`${protocol} forwards its native structured-output schema and teaching input`, async t => {
  const calls = upstream(t, () => Response.json(completion(protocol, undefined, '{"reply":"Hello."}')));
  assert.deepEqual(await callLLM(provider(protocol), {...input, schema, schemaName: 'tutor_reply'}), {text: '{"reply":"Hello."}'});
  const {body, options} = calls[0];
  assert.equal(options.redirect, 'manual');
  assert.ok(options.signal instanceof AbortSignal);
  if (protocol === 'openai') {
    assert.deepEqual(body.response_format, {type: 'json_schema', json_schema: {name: 'tutor_reply', strict: true, schema}});
    assert.deepEqual(body.messages, [{role: 'system', content: input.system}, ...input.turns]);
  } else if (protocol === 'anthropic') {
    assert.deepEqual(body.output_config, {format: {type: 'json_schema', schema}});
    assert.equal(body.system, input.system);
    assert.deepEqual(body.messages, input.turns);
  } else {
    assert.deepEqual(body.generationConfig, {responseMimeType: 'application/json', responseJsonSchema: schema});
    assert.deepEqual(body.systemInstruction, {parts: [{text: input.system}]});
    assert.deepEqual(body.contents, [{role: 'user', parts: [{text: 'Hello.'}]}]);
  }
});

for (const schemaName of [undefined, 'kaiwa_evaluation', 'untrusted schema name', '__proto__', null, 42]) {
  test(`OpenAI uses the fixed Kaiwa schema name for ${String(schemaName)}`, async t => {
    const calls = upstream(t, () => Response.json(completion('openai', 'stop')));
    assert.deepEqual(await callLLM(provider('openai'), {...input, schema, schemaName}), {text: 'こんにちは。'});
    assert.equal(calls[0].body.response_format.json_schema.name, 'kaiwa_evaluation');
  });
}

for (const protocol of ['openai', 'anthropic', 'gemini']) test(`${protocol} keeps plain chat free of structured-output options`, async t => {
  const calls = upstream(t, () => Response.json(completion(protocol)));
  assert.deepEqual(await callLLM(provider(protocol), {...input, schemaName: 'tutor_reply'}), {text: 'こんにちは。'});
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[0].body.output_config, undefined);
  assert.equal(calls[0].body.generationConfig, undefined);
});

test('authentication errors remain private and do not fall back', async t => {
  const calls = upstream(t, () => Response.json({error: {message: 'synthetic-private-key and private diagnostics'}}, {status: 401}));
  assert.deepEqual(await callLLM({...provider('openai'), models: ['first', 'second']}, input), {status: 401});
  assert.equal(calls.length, 1);
});

test('timeouts remain private and use the next model without retrying the first', async t => {
  const calls = upstream(t, index => {
    if (!index) throw new DOMException('private timeout diagnostics', 'TimeoutError');
    return Response.json(completion('openai', 'stop'));
  });
  assert.deepEqual(await callLLM({...provider('openai'), models: ['first', 'second']}, input), {text: 'こんにちは。'});
  assert.deepEqual(calls.map(call => call.body.model), ['first', 'second']);
});

for (const [protocol, reason] of [['openai', 'length'], ['anthropic', 'max_tokens'], ['gemini', 'MAX_TOKENS']]) {
  test(`${protocol} draft probes still accept first visible text independently of final completion metadata`, async t => {
    const calls = upstream(t, () => Response.json(completion(protocol, reason, 'OK')));
    assert.deepEqual(await probeModel(provider(protocol)), {text: 'OK'});
    assert.equal(calls.length, 1);
  });
}
