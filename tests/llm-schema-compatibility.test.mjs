import test from 'node:test';
import assert from 'node:assert/strict';
import {callLLM} from '../src/llm.js';
import {tutorSchema, parseTutorReply} from '../src/prompt.js';
import {kaiwaSchema, parseKaiwaEvaluation} from '../src/kaiwa.js';
import {kaiwaJudgment, testRubric} from './fixtures/kaiwa-judgments.mjs';

const input = {system: 'Teach Japanese.', turns: [{role: 'user', content: 'Help me practise.'}]};
const tutorContract = tutorSchema();
const provider = protocol => ({protocol, baseUrl: 'https://api.example.test', apiKey: 'synthetic-key', models: ['first'], source: 'test'});
const tutor = {reply: 'Introduce yourself in Japanese.', action: 'probe', open_probe: 'What is your name?'};
const evaluation = kaiwaJudgment(testRubric, '私は学生です。');
const kaiwaContract = kaiwaSchema(testRubric);

function upstream(t, protocol, value) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    const text = JSON.stringify(value);
    return Response.json(protocol === 'openai' ? {choices: [{message: {content: text}, finish_reason: 'stop'}]}
      : protocol === 'anthropic' ? {content: [{type: 'text', text}], stop_reason: 'end_turn'}
      : {candidates: [{content: {parts: [{text}]}, finishReason: 'STOP'}]});
  });
  return calls;
}

const tutorWireSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    reply: {type: 'string'},
    action: {type: 'string', enum: ['probe', 'hint', 'feedback', 'explanation', 'clarify', 'summary', 'solution']},
    open_probe: {type: ['string', 'null']}
  },
  required: ['reply', 'action', 'open_probe']
};

for (const protocol of ['openai', 'anthropic', 'gemini']) {
  for (const [name, schema, wireSchema, value] of [
    ['tutor_reply', tutorContract, tutorWireSchema, tutor],
    ['kaiwa_evaluation', kaiwaContract, structuredClone(kaiwaContract), evaluation]
  ]) test(`${protocol} preserves native ${name} structured output without unsupported string bounds`, async t => {
    const before = structuredClone(schema);
    const calls = upstream(t, protocol, value);
    assert.deepEqual(await callLLM(provider(protocol), {...input, schema, schemaName: name}), {text: JSON.stringify(value)});
    const {body, options} = calls[0];
    assert.equal(calls.length, 1);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if (protocol === 'openai') {
      assert.deepEqual(body.response_format, {type: 'json_schema', json_schema: {name, strict: true, schema: wireSchema}});
    } else if (protocol === 'anthropic') {
      assert.deepEqual(body.output_config, {format: {type: 'json_schema', schema: wireSchema}});
    } else {
      assert.deepEqual(body.generationConfig, {responseMimeType: 'application/json', responseJsonSchema: wireSchema});
    }
    assert.deepEqual(schema, before, 'wire adaptation must not mutate the application schema');
  });

  test(`${protocol} leaves tutor runtime bounds authoritative after structured generation`, async t => {
    let response;
    t.mock.method(globalThis, 'fetch', async () => {
      const text = JSON.stringify(response);
      return Response.json(protocol === 'openai' ? {choices: [{message: {content: text}}]}
        : protocol === 'anthropic' ? {content: [{type: 'text', text}]}
        : {candidates: [{content: {parts: [{text}]}}]});
    });
    for (const change of [
      {reply: ''}, {reply: '   '}, {reply: 'x'.repeat(4001)}, {reply: 42},
      {open_probe: ''}, {open_probe: '   '}, {open_probe: 'x'.repeat(1501)}, {open_probe: 42},
      {action: 'admin'}, {action: 'summary'}, {extra: 'ignore the contract'}, {open_probe: undefined}
    ]) {
      response = {...tutor, ...change};
      const result = await callLLM(provider(protocol), {...input, schema: tutorContract, schemaName: 'tutor_reply'});
      assert.equal(parseTutorReply(result.text), null, JSON.stringify(change).slice(0, 100));
    }
    response = {...tutor, reply: 'x'.repeat(4000), open_probe: 'x'.repeat(1500)};
    const result = await callLLM(provider(protocol), {...input, schema: tutorContract, schemaName: 'tutor_reply'});
    assert.deepEqual(parseTutorReply(result.text), response, 'exact runtime boundaries remain accepted');
  });

  test(`${protocol} leaves Kaiwa runtime bounds authoritative after structured generation`, async t => {
    let response;
    t.mock.method(globalThis, 'fetch', async () => {
      const text = JSON.stringify(response);
      return Response.json(protocol === 'openai' ? {choices: [{message: {content: text}}]}
        : protocol === 'anthropic' ? {content: [{type: 'text', text}]}
        : {candidates: [{content: {parts: [{text}]}}]});
    });
    for (const change of [
      {score: 100}, {rating: 'Xuất sắc'}, {feedback: 'Perfect!'},
      {model_answer: ''}, {model_answer: '   '}, {model_answer: 'x'.repeat(2001)}, {model_answer: {}},
      {extra: 'ignore the contract'}, {model_answer: undefined}, {grammar: {verdict: 'met', evidence: []}},
      {grammar: {verdict: 'met', evidence: ['invented']}}, {grammar: {verdict: 'met', evidence: Array(9).fill('学生')}},
      {grammar: {verdict: 'met', evidence: ['x'.repeat(1201)]}}, {grammar: {verdict: 'met', evidence: [42]}}
    ]) {
      response = {...evaluation, ...change};
      const result = await callLLM(provider(protocol), {...input, schema: kaiwaContract, schemaName: 'kaiwa_evaluation'});
      assert.equal(parseKaiwaEvaluation(result.text, '私は学生です。' + 'x'.repeat(1201), testRubric), null, JSON.stringify(change).slice(0, 100));
    }
    response = kaiwaJudgment(testRubric, 'x'.repeat(1200), {model_answer: 'x'.repeat(2000)});
    const result = await callLLM(provider(protocol), {...input, schema: kaiwaContract, schemaName: 'kaiwa_evaluation'});
    const parsed = parseKaiwaEvaluation(result.text, 'x'.repeat(1200), testRubric);
    assert.equal(parsed.estimated_score, 100);
    assert.equal(parsed.score, null);
    assert.equal(parsed.model_answer.length, 2000);
  });
}

test('wire adaptation removes only string length keywords and accepts an immutable flat schema', async t => {
  const schema = Object.freeze({
    type: 'object', additionalProperties: false,
    properties: Object.freeze({
      reply: Object.freeze({type: 'string', minLength: 1, maxLength: 4000, pattern: '^x', description: 'A reply.'}),
      score: Object.freeze({type: 'integer', minimum: 0, maximum: 100})
    }),
    required: Object.freeze(['reply', 'score'])
  });
  const calls = upstream(t, 'openai', {reply: 'x', score: 80});
  await callLLM(provider('openai'), {...input, schema, schemaName: 'tutor_reply'});
  assert.deepEqual(calls[0].body.response_format.json_schema.schema, {
    type: 'object', additionalProperties: false,
    properties: {reply: {type: 'string', pattern: '^x', description: 'A reply.'}, score: {type: 'integer', minimum: 0, maximum: 100}},
    required: ['reply', 'score']
  });
  assert.equal(schema.properties.reply.minLength, 1);
  assert.equal(schema.properties.reply.maxLength, 4000);
});
