import test from 'node:test';
import assert from 'node:assert/strict';
import {kaiwaSchema, parseKaiwaEvaluation} from '../src/kaiwa.js';

const rubric = {question: 'お名前とお仕事を教えてください。', requirements: [
  {id: 'requirement_1', description: 'State your name.'},
  {id: 'requirement_2', description: 'State your occupation or current student/employment status.'}
]};
const speech = '私はリンです。学生です。';
const item = (verdict = 'met', evidence = [speech]) => ({verdict, evidence});
const output = changes => ({relevance: 'relevant', requirements: {requirement_1: item(), requirement_2: item()}, grammar: item(), expression: item(), model_answer: 'リンです。学生です。よろしくお願いします。', ...changes});
const parse = (value, submission = speech) => parseKaiwaEvaluation(JSON.stringify(value), submission, rubric);

test('server computes an explicitly estimated score and fixed conclusion from criteria, never model totals', () => {
  const result = parse(output());
  assert.equal(result.status, 'estimated');assert.equal(result.estimated_score, 100);
  assert.equal(result.score, null);assert.equal(result.rating, null);
  assert.equal(result.conclusion, 'meets_requirements');
  const mixed = parse(output({grammar: item('partial'), expression: item('not_met')}));
  assert.equal(mixed.estimated_score, 65);assert.equal(mixed.conclusion, 'needs_practice');
  for (const field of ['score', 'rating', 'feedback', 'weights', 'conclusion', 'confidence']) assert.equal(parse({...output(), [field]: 100}), null);
});

test('missing task requirements cannot pass despite otherwise fluent Japanese', () => {
  const result = parse(output({requirements: {requirement_1: item(), requirement_2: item('not_met', [])}}));
  assert.equal(result.estimated_score, 75);assert.equal(result.conclusion, 'incomplete');
  assert.equal(result.criteria.find(c => c.id === 'requirement_2').verdict, 'not_met');
  assert.equal(parse(output({requirements: {requirement_1: item()}})), null);
  assert.equal(parse(output({requirements: {...output().requirements, forged_rule: item()}})), null);
});

test('irrelevant but grammatical answers receive no passing result, and contradictory judgments are rejected', () => {
  const banana = 'バナナは黄色です。';
  const irrelevant = output({relevance: 'off_topic', requirements: {requirement_1: item('not_met', []), requirement_2: item('not_met', [])}, grammar: item('met', [banana]), expression: item('met', [banana])});
  const result = parse(irrelevant, banana);
  assert.equal(result.estimated_score, 0);assert.equal(result.conclusion, 'off_topic');
  assert.equal(parse({...irrelevant, requirements: {requirement_1: item('met', [banana]), requirement_2: item('not_met', [])}}, banana), null);
});

test('a relevant refusal with no requested details is incomplete, not an API/schema failure', () => {
  const refusal = '名前も仕事も答えたくありません。';
  const result = parse(output({requirements: {
    requirement_1: item('not_met', []), requirement_2: item('not_met', [])
  }, grammar: item('met', [refusal]), expression: item('met', [refusal])}), refusal);
  assert.equal(result.status, 'estimated');
  assert.equal(result.estimated_score, 50);
  assert.equal(result.conclusion, 'incomplete');
});

test('missing evidence must be an empty array, never an empty or whitespace quote repaired into acceptance', () => {
  for (const verdict of ['met', 'partial', 'not_met', 'uncertain']) {
    for (const evidence of [[''], [' '], ['\n'], [speech, '']]) {
      assert.equal(parse(output({requirements: {
        requirement_1: item(verdict, evidence), requirement_2: item('not_met', [])
      }})), null);
      for (const field of ['grammar', 'expression']) {
        assert.equal(parse(output({[field]: item(verdict, evidence)})), null);
      }
    }
  }
  const result = parse(output({requirements: {
    requirement_1: item('not_met', []), requirement_2: item('not_met', [])
  }}));
  assert.equal(result.conclusion, 'incomplete');
  assert.equal(result.estimated_score, 50);
});

test('uncertainty abstains instead of inventing a zero or trusted grade', () => {
  for (const change of [{relevance: 'uncertain'}, {grammar: item('uncertain', [])}, {requirements: {requirement_1: item('uncertain', []), requirement_2: item()}}]) {
    const result = parse(output(change));assert.equal(result.status, 'ungraded');
    assert.equal(result.reason, 'insufficient_evidence');assert.equal(result.estimated_score, null);
    assert.equal(result.conclusion, 'uncertain');
  }
});

test('exact spans validate quotation only; bounded verdicts cannot fabricate or omit evidence of claimed success', () => {
  for (const change of [{grammar: item('met', [])}, {grammar: item('met', ['invented'])}, {grammar: item('excellent')}, {grammar: {...item(), points: 100}}, {grammar: item('met', Array(9).fill(speech))}, {model_answer: ''}, {model_answer: 'x'.repeat(2001)}]) assert.equal(parse(output(change)), null);
  assert.equal(parse(output(), ''), null);
  assert.equal(parseKaiwaEvaluation(JSON.stringify(output()), speech), null);
  assert.equal(parseKaiwaEvaluation(JSON.stringify(output()), speech, {...rubric, question: ''}), null);
  // The validator cannot detect semantic lying when every quoted byte really exists.
  assert.equal(parse(output({requirements: {requirement_1: item('met', ['学生']), requirement_2: item('met', ['学生'])}})).status, 'estimated');
});

test('native schema binds the exact canonical requirement IDs and forbids model-owned total/feedback', () => {
  const schema = kaiwaSchema(rubric);
  assert.deepEqual(schema.properties.requirements.required, ['requirement_1', 'requirement_2']);
  assert.deepEqual(schema.properties.relevance.enum, ['relevant', 'off_topic', 'uncertain']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.requirements.additionalProperties, false);
  assert.equal(schema.properties.grammar.additionalProperties, false);
  assert.equal(Object.hasOwn(schema.properties, 'score'), false);
  assert.throws(() => kaiwaSchema(null), /rubric/i);
});
