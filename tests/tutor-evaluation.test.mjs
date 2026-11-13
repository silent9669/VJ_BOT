import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';
import {groundLesson} from '../src/tutor-context.js';
import {evaluateReport, loadCases, runEvaluation} from '../scripts/evaluate_tutor.mjs';

const cases = await loadCases();
const cookie = `vj_session=${'a'.repeat(64)}`;
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vj-tutor-evaluation-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}
const liveArgs = output => ['--live', '--base-url', 'http://127.0.0.1:8787', '--output', output];
const environment = {TUTOR_EVAL_COOKIE: cookie};

// These fixtures exercise the recorder, not Japanese teaching quality or a real model.
test('every authored case resolves its canonical lesson and exact selected item', async () => {
  const catalogs = await buildTeacherCatalog();
  assert.ok(cases.length >= 10 && cases.length <= 12);
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length);
  for (const item of cases) {
    assert.ok(item.steps.length && item.expected_behavior.length && item.rubric.length);
    if (!item.lesson) {
      assert.equal(item.id, 'ambiguous-context');
      continue;
    }
    const lesson = catalogs[item.lesson.level].lessons[item.lesson.id];
    assert.ok(lesson, item.id);
    const grounded = groundLesson(lesson, item.focus);
    assert.ok(grounded, item.id);
    if (item.focus) assert.deepEqual(grounded.focus.item, lesson[{word: 'words', example: 'examples', question: 'questions'}[item.focus.kind]][item.focus.index]);
  }
  const corpus = cases.find(item => item.id === 'corpus-difficulty');
  const selected = groundLesson(catalogs.N5.lessons[corpus.lesson.id], corpus.focus).focus.item;
  assert.equal(selected.jp, '赤いものもあれば白いのもある。');
  assert.equal(selected.source, 'https://tatoeba.org/sentences/show/142281');
  assert.equal(selected.provenance.sentence_level_certified, false);
});

test('default and retained modes never call inference or accept an automatic semantic verdict', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not fetch'); };
  const initial = await runEvaluation([], {fetchImpl});
  assert.equal(calls, 0);
  assert.ok(initial.cases.every(item => item.structural_status === 'NOT_RECORDED' && item.result === 'HUMAN_REVIEW_REQUIRED'));
  const directory = await temporary(t);
  const report = join(directory, 'empty.json');
  await writeFile(report, JSON.stringify({version: 1, run_id: 'retained', cases: [], result: 'SEMANTIC_PASS'}));
  const retained = await runEvaluation(['--report', report], {fetchImpl});
  assert.equal(calls, 0);
  assert.equal(retained.structural_status, 'INVALID');
  assert.ok(retained.cases.every(item => item.result === 'HUMAN_REVIEW_REQUIRED'));
});

test('live rejects remote hosts, credentials, non-HTTP schemes and redirects before disclosing the cookie', async t => {
  const directory = await temporary(t);
  let calls = 0;
  const fetchImpl = async () => { calls++; };
  for (const target of ['https://example.com', 'http://127.0.0.1.example.com', 'file:///tmp/chat', 'http://user:pass@localhost:8787', 'http://192.168.1.1', 'http://[::ffff:c000:201]']) {
    await assert.rejects(runEvaluation(['--live', '--base-url', target, '--output', join(directory, 'remote.json')], {env: environment, fetchImpl}), /loopback/);
  }
  assert.equal(calls, 0);
});

test('an existing output cannot be overwritten and no request is sent', async t => {
  const directory = await temporary(t);
  const output = join(directory, 'retained.json');
  const original = '{"evidence":"keep exactly"}\n';
  await writeFile(output, original);
  let calls = 0;
  await assert.rejects(runEvaluation(liveArgs(output), {env: environment, fetchImpl: async () => { calls++; }}), {code: 'EEXIST'});
  assert.equal(calls, 0);
  assert.equal(await readFile(output, 'utf8'), original);
});

test('transport failure is retained once, halts inference and never becomes a semantic pass', async t => {
  const directory = await temporary(t);
  const output = join(directory, 'failed.json');
  let calls = 0;
  const result = await runEvaluation(liveArgs(output), {env: environment, fetchImpl: async () => {
    calls++;
    throw new Error(`network failure containing ${cookie}`);
  }});
  const text = await readFile(output, 'utf8');
  const report = JSON.parse(text);
  assert.equal(calls, 1);
  assert.equal(text.includes(cookie), false);
  assert.deepEqual(report.cases[0].steps[0].transport_status, 'FAILED');
  assert.equal(report.cases[0].steps[0].status, null);
  assert.equal(report.cases[0].steps[0].reply, null);
  assert.equal(report.cases[0].steps[0].error, 'NETWORK_ERROR');
  assert.equal(report.cases[0].steps[1].transport_status, 'NOT_RUN');
  assert.equal(result.cases[0].transport_status, 'FAILED');
  assert.ok(result.cases.every(item => item.result === 'HUMAN_REVIEW_REQUIRED'));
});

test('successful recording binds actual plain replies to each sequential case and learner step', async t => {
  const directory = await temporary(t);
  const output = join(directory, 'actual.json');
  const requests = [];
  let active = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:8787/api/chat');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, cookie);
    assert.equal(++active, 1);
    const body = JSON.parse(options.body);
    requests.push(body);
    await Promise.resolve();
    active--;
    return Response.json({reply: `Retained response ${requests.length}`, response: `Retained response ${requests.length}`});
  };
  let clock = 0;
  const result = await runEvaluation(liveArgs(output), {env: environment, fetchImpl,
    now: () => clock, wait: async milliseconds => { clock += milliseconds; }});
  const report = JSON.parse(await readFile(output, 'utf8'));
  const total = cases.reduce((sum, item) => sum + item.steps.length, 0);
  assert.equal(requests.length, total);
  assert.equal(new Set(requests.map(item => item.request_id)).size, total);
  assert.equal(new Set(requests.map(item => item.screen.route)).size, cases.length);
  let index = 0;
  for (const [caseIndex, item] of cases.entries()) {
    const retained = report.cases[caseIndex];
    assert.equal(retained.case_id, item.id);
    assert.deepEqual(retained.expected_behavior, item.expected_behavior);
    assert.deepEqual(retained.rubric, item.rubric);
    for (const [stepIndex, step] of item.steps.entries()) {
      const request = requests[index];
      const recorded = retained.steps[stepIndex];
      assert.equal(request.channel, 'quick');
      assert.equal(request.screen.route, `/tutor-evaluation/${report.run_id}/${item.id}`);
      assert.deepEqual(Object.keys(request.screen).sort(), ['level', 'route']);
      assert.deepEqual(request.lesson, item.lesson);
      assert.deepEqual(request.focus, item.focus);
      assert.equal(request.message, step.message);
      assert.equal(request.intent, step.intent);
      assert.equal(recorded.step_id, step.id);
      assert.equal(recorded.request_id, request.request_id);
      assert.equal(recorded.reply, `Retained response ${++index}`);
      assert.equal(recorded.status, 200);
    }
  }
  const claimedPass = structuredClone(report);
  claimedPass.result = 'SEMANTIC_PASS';
  for (const item of claimedPass.cases) item.result = 'HUMAN_APPROVED';
  assert.ok(evaluateReport(cases, claimedPass).cases.every(item => item.result === 'HUMAN_REVIEW_REQUIRED'));
  assert.equal(result.structural_status, 'VALID');
  assert.ok(result.cases.every(item => item.result === 'HUMAN_REVIEW_REQUIRED' && item.grammar === 'HUMAN_REVIEW_REQUIRED' && item.naturalness === 'HUMAN_REVIEW_REQUIRED'));
  const retained = await runEvaluation(['--report', output], {fetchImpl: () => assert.fail('recorded mode called inference')});
  assert.deepEqual(retained, result);
  const swapped = structuredClone(report);
  [swapped.cases[0].steps[0], swapped.cases[0].steps[1]] = [swapped.cases[0].steps[1], swapped.cases[0].steps[0]];
  assert.equal(evaluateReport(cases, swapped).cases[0].structural_status, 'INVALID');
  const changed = structuredClone(report);
  changed.cases[0].steps[0].message = 'A different learner request';
  assert.equal(evaluateReport(cases, changed).cases[0].structural_status, 'INVALID');
});

test('live start pacing accounts for request duration and spans case boundaries without real sleeping', async t => {
  const directory = await temporary(t);
  let clock = 0;
  const waits = [], starts = [];
  const result = await runEvaluation(liveArgs(join(directory, 'paced.json')), {
    env: environment,
    now: () => clock,
    wait: async milliseconds => { waits.push(milliseconds); clock += milliseconds; },
    fetchImpl: async (_url, options) => {
      starts.push(clock);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      clock += starts.length === 2 ? 4500 : 100;
      return Response.json({reply: 'Synthetic transport fixture; semantic review still required.'});
    }
  });
  assert.equal(starts.length, cases.reduce((sum, item) => sum + item.steps.length, 0));
  assert.equal(starts[0], 0);
  assert.equal(starts[1], 3100);
  assert.equal(starts[2], 7600);
  assert.equal(waits.length, starts.length - 2);
  assert.ok(waits.every(milliseconds => milliseconds === 3000));
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 3100);
  assert.ok(result.cases.every(item => item.transport_status === 'RECORDED' && item.result === 'HUMAN_REVIEW_REQUIRED'));
});

test('HTTP errors and malformed API payloads do not count as recorded teaching responses', async t => {
  const directory = await temporary(t);
  for (const [name, response, status, error] of [
    ['http', Response.json({reply: 'not a success'}, {status: 503}), 503, 'HTTP_ERROR'],
    ['quota', Response.json({detail: 'Rate limited'}, {status: 429}), 429, 'HTTP_ERROR'],
    ['empty', Response.json({reply: ''}), 200, 'INVALID_RESPONSE'],
    ['json', new Response('not JSON'), 200, 'INVALID_RESPONSE'],
    ['wire', Response.json({reply: {action: 'hint'}}), 200, 'INVALID_RESPONSE'],
    ['redirect', new Response(null, {status: 302, headers: {Location: 'https://example.com'}}), 302, 'HTTP_ERROR'],
    ['secret', Response.json({reply: `Do not retain ${cookie}`}), 200, 'SECRET_IN_RESPONSE']
  ]) {
    const output = join(directory, `${name}.json`);
    let calls = 0;
    const result = await runEvaluation(liveArgs(output), {env: environment, fetchImpl: async () => { calls++; return response; }});
    const text = await readFile(output, 'utf8');
    const step = JSON.parse(text).cases[0].steps[0];
    assert.equal(calls, 1);
    assert.equal(step.status, status);
    assert.equal(step.error, error);
    assert.equal(step.reply, null);
    assert.equal(text.includes(cookie), false);
    assert.equal(result.cases[0].transport_status, 'FAILED');
    assert.equal(result.cases[0].result, 'HUMAN_REVIEW_REQUIRED');
  }
});

test('live requires an explicit target, output and environment cookie without exposing secrets', async t => {
  const directory = await temporary(t);
  let calls = 0;
  const options = {env: {}, fetchImpl: async () => { calls++; }};
  await assert.rejects(runEvaluation(['--live'], options), /base-url/);
  await assert.rejects(runEvaluation(['--live', '--base-url', 'http://localhost:8787'], options), /output/);
  await assert.rejects(runEvaluation(liveArgs(join(directory, 'missing.json')), options), /cookie/i);
  await assert.rejects(runEvaluation(['--report', 'missing.json', '--live'], options), /combine/);
  assert.equal(calls, 0);
});
