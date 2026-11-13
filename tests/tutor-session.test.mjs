import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {hashToken} from '../src/auth.js';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';
import {claimTutorRequest, claimTutorScope, clearTutorConversation, commitTutorTurn, releaseTutorClaim, renewTutorClaim} from '../src/tutor-session.js';

const catalogs = await buildTeacherCatalog();
const USER = 'google:tutor-acceptance';
const OTHER = 'google:other-learner';
const WORD_LESSON = {id: 'openjlpt:N5:vocabulary-group:1', level: 'N5'};
const ORIGINAL_PROBE = 'Em hãy đặt một câu với từ 明るい.';
const migrations = [
  '0001_base.sql', '0002_sessions.sql', '0003_srs_repetitions.sql',
  '0004_progress_display.sql', '0005_progress_attempts.sql', '0006_learning_responses.sql',
  '0007_completions.sql', '0008_exam_attempts.sql', '0009_password_accounts.sql',
  '0010_chat_requests.sql', '0011_ai_providers.sql', '0012_profile_identity.sql',
  '0013_identity_backfill.sql', '0014_api_profiles.sql', '0015_conversation_scope.sql',
  '0016_google_ai_oauth.sql', '0017_antigravity_oauth.sql', '0018_antigravity_accounts.sql',
  '0019_tutor_sessions.sql','0020_admin_grants.sql','0021_admin_ai_preferences.sql'
];

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const migration of migrations) sqlite.exec(readFileSync(new URL('../migrations/' + migration, import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async all() { return {results: sqlite.prepare(sql).all(...params)}; },
        async run() { sqlite.prepare(sql).run(...params); return {success: true}; }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

async function authenticated(t) {
  const env = {
    DB: database(t), AI_KEY_SECRET: 'local-tutor-test-secret',
    ASSETS: {fetch: async request => {
      const level = new URL(request.url).pathname.match(/^\/course\/teacher-(N[1-5])\.json$/)?.[1];
      return level ? Response.json(catalogs[level]) : new Response('Not found', {status: 404});
    }}
  };
  const clients = new Map();
  async function addUser(userId, token) {
    await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .bind(await hashToken(token), userId, 'Tutor learner', Date.now() + 3600000).run();
    await env.DB.prepare('INSERT INTO profiles(user_id,level,track,updated_at) VALUES(?,?,?,?)')
      .bind(userId, 'N5', 'openjlpt', 'now').run();
    const request = (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => new Request('https://vjbot.test' + path, {
      method, headers: {Cookie: 'vj_session=' + token, 'Content-Type': 'application/json', ...headers},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
    const settings = await worker.fetch(request('/api/ai/settings', {
      protocol: 'openai', base_url: 'https://api.example.com/v1', model: 'synthetic-tutor', api_key: 'test-only-tutor-key'
    }, 'PUT'), env);
    assert.equal(settings.status, 200, 'the synthetic provider is saved through the authenticated settings API');
    clients.set(userId, request);
    return request;
  }
  const request = await addUser(USER, 'a'.repeat(64));
  const send = (body, userId = USER) => worker.fetch(clients.get(userId)('/api/chat', {
    request_id: crypto.randomUUID(), ...body
  }), env);
  return {env, request, send, addUser};
}

const structured = (reply, action = 'explanation', open_probe = null) => ({reply, action, open_probe});
const providerResponse = (value, finish_reason = 'stop') => Response.json({
  choices: [{message: {content: typeof value === 'string' ? value : JSON.stringify(value)}, finish_reason}]
});

// Only the upstream network boundary is synthetic: routing, authentication, saved
// credentials, provider parsing, canonical assets and all persistence remain real.
function provider(t, respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({url, body, envelope: JSON.parse(body.messages.findLast(turn => turn.role === 'user').content)});
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only-tutor-key');
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.deepEqual([...body.response_format.json_schema.schema.required].sort(), ['action', 'open_probe', 'reply']);
    return respond(calls.at(-1), calls.length);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

async function successful(response, expectedReply) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reply, expectedReply);
  assert.equal(body.response, expectedReply);
  for (const field of ['action', 'open_probe', 'state', 'teaching', 'reference']) assert.equal(Object.hasOwn(body, field), false);
  return body;
}

async function saved(env, userId = USER, scope = 'chat') {
  const session = await env.DB.prepare('SELECT * FROM tutor_sessions WHERE user_id=? AND context_key=?').bind(userId, scope).first();
  const conversations = (await env.DB.prepare('SELECT * FROM conversations WHERE user_id=? AND context_key=? ORDER BY id').bind(userId, scope).all()).results;
  const requests = (await env.DB.prepare('SELECT * FROM tutor_requests WHERE user_id=? AND context_key=? ORDER BY request_id').bind(userId, scope).all()).results;
  return {session, conversations, requests};
}

const teachingState = snapshot => JSON.parse(snapshot.session.state_json);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function pausedProvider(t) {
  const entered = deferred(), released = deferred();
  let blocked = false;
  const calls = provider(t, async () => {
    if (!blocked) return providerResponse(structured('Đặt câu với từ đã chọn.', 'probe', ORIGINAL_PROBE));
    entered.resolve();
    await released.promise;
    return providerResponse(structured('Một gợi ý cho câu đang làm.', 'hint', null));
  });
  return {calls, entered: entered.promise, release: () => released.resolve(),
    pause: () => { blocked = true; }, resume: () => { blocked = false; }};
}

async function reachedProvider(entered, pending) {
  await Promise.race([entered, pending.then(response => assert.fail('Expected an in-flight provider call, received HTTP ' + response.status))]);
}

test('the original probe survives eviction from the twelve-message model history', async t => {
  const {env, send} = await authenticated(t);
  const calls = provider(t, (_call, index) => providerResponse(index === 1
    ? structured('Câu hỏi ban đầu.', 'probe', ORIGINAL_PROBE)
    : structured('Giải thích ngắn số ' + index + '.', 'explanation', null)));
  await successful(await send({intent: 'start', message: 'Bắt đầu'}), 'Câu hỏi ban đầu.');
  for (let index = 2; index <= 8; index++) {
    await successful(await send({message: 'Em cần làm rõ phần ' + index}), 'Giải thích ngắn số ' + index + '.');
  }
  const reference = calls.at(-1).envelope.reference;
  assert.equal(reference.history.length, 12);
  assert.ok(!reference.history.some(turn => turn.content === 'Câu hỏi ban đầu.' || turn.content === 'Bắt đầu'));
  assert.equal(reference.teaching.state.probe, ORIGINAL_PROBE);
  assert.equal(reference.teaching.state.awaiting, 'answer');
  const snapshot = await saved(env);
  assert.equal(teachingState(snapshot).probe, ORIGINAL_PROBE);
  assert.equal(snapshot.conversations.length, 16, 'bounded model history does not delete UI history');
});

test('explicit repeated hints retain the probe, saturate at stage two and reject a solution', async t => {
  const {env, send} = await authenticated(t);
  let result = structured('Đặt một câu.', 'probe', ORIGINAL_PROBE);
  const calls = provider(t, () => providerResponse(result));
  await successful(await send({intent: 'start', message: 'Bắt đầu'}), result.reply);
  for (let index = 1; index <= 3; index++) {
    result = structured('Gợi ý ' + index + '.', 'hint', 'Một câu hỏi thay thế không được ghi đè.');
    await successful(await send({intent: 'hint', message: 'Gợi ý thêm, chưa đưa đáp án.'}), result.reply);
    assert.equal(calls.at(-1).envelope.reference.teaching.intent, 'hint');
    assert.equal(calls.at(-1).envelope.reference.teaching.state.probe, ORIGINAL_PROBE);
    const state = teachingState(await saved(env));
    assert.equal(state.probe, ORIGINAL_PROBE);
    assert.equal(state.hint_stage, Math.min(2, index));
    assert.equal(state.awaiting, 'answer');
  }
  const before = await saved(env);
  result = structured('Đây là toàn bộ đáp án.', 'solution', null);
  const response = await send({intent: 'hint', message: 'Thêm gợi ý nhưng không cho đáp án.'});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reply, undefined);
  assert.deepEqual(await saved(env), before);
});

test('failed, truncated and invalid generations leave prior teaching state and conversations intact', async t => {
  const {env, send} = await authenticated(t);
  let respond = () => providerResponse(structured('Câu hỏi đã lưu.', 'probe', ORIGINAL_PROBE));
  provider(t, () => respond());
  await successful(await send({intent: 'start', message: 'Bắt đầu'}), 'Câu hỏi đã lưu.');
  const before = await saved(env);
  const invalid = [
    ['upstream failure', () => new Response('private upstream error', {status: 503})],
    ['network failure', () => { throw new TypeError('synthetic connection failure'); }],
    ['truncated provider completion', () => providerResponse(structured('Không được lưu.', 'hint', null), 'length')],
    ['truncated JSON', () => providerResponse('{"reply":"Chưa xong","action":"hint"')],
    ['plain text instead of JSON', () => providerResponse('Đây không phải phản hồi có cấu trúc.')],
    ['missing field', () => providerResponse({reply: 'Thiếu trường.', action: 'hint'})],
    ['unknown field', () => providerResponse({...structured('Thừa trường.', 'hint', null), state: {probe: 'forged'}})],
    ['invalid reply type', () => providerResponse(structured({text: 'Sai kiểu.'}, 'hint', null))],
    ['unknown action', () => providerResponse(structured('Sai hành động.', 'grade', null))],
    ['invalid probe type', () => providerResponse(structured('Sai kiểu câu hỏi.', 'hint', 123))],
    ['empty reply', () => providerResponse(structured('   ', 'hint', null))]
  ];
  for (const [name, failure] of invalid) {
    respond = failure;
    const response = await send({intent: 'hint', message: 'Em cần một gợi ý.'});
    assert.equal(response.status, 503, name);
    const body = await response.json();
    assert.equal(body.reply, undefined, name);
    assert.equal(body.response, undefined, name);
    assert.deepEqual(await saved(env), before, name);
  }
  respond = () => providerResponse(structured('Gợi ý hợp lệ sau lỗi.', 'hint', null));
  await successful(await send({intent: 'hint', message: 'Thử lại.'}), 'Gợi ý hợp lệ sau lỗi.');
  assert.equal(teachingState(await saved(env)).hint_stage, 1, 'failed requests release both leases');
});

test('restart clears model dialogue and teaching state without deleting UI history', async t => {
  const {env, request, send} = await authenticated(t);
  let result = structured('Câu hỏi cũ.', 'probe', ORIGINAL_PROBE);
  const calls = provider(t, () => providerResponse(result));
  await successful(await send({intent: 'start', message: 'Bắt đầu cũ'}), result.reply);
  result = structured('Gợi ý cũ.', 'hint', null);
  await successful(await send({intent: 'hint', message: 'Gợi ý cũ cho em'}), result.reply);
  const old = await saved(env);
  const freshProbe = 'Em hãy tự giới thiệu bằng một câu tiếng Nhật.';
  result = structured('Bắt đầu một lượt mới.', 'probe', freshProbe);
  await successful(await send({intent: 'restart', message: 'Bắt đầu lại'}), result.reply);
  assert.deepEqual(calls.at(-1).envelope.reference.history, []);
  assert.equal(calls.at(-1).envelope.reference.teaching.state, null);
  assert.equal(calls.at(-1).envelope.reference.teaching.intent, 'restart');
  const restarted = await saved(env);
  assert.deepEqual(restarted.conversations.slice(0, old.conversations.length), old.conversations);
  assert.equal(restarted.session.history_after, old.conversations.at(-1).id);
  assert.equal(teachingState(restarted).probe, freshProbe);
  assert.equal(teachingState(restarted).hint_stage, 0);
  assert.equal(teachingState(restarted).awaiting, 'answer');
  const historyResponse = await worker.fetch(request('/api/history'), env);
  assert.equal(historyResponse.status, 200);
  assert.deepEqual((await historyResponse.json()).map(row => row.content), restarted.conversations.map(row => row.content));
  result = structured('Gợi ý cho lượt mới.', 'hint', null);
  await successful(await send({intent: 'hint', message: 'Gợi ý mới cho em'}), result.reply);
  assert.deepEqual(calls.at(-1).envelope.reference.history, [
    {role: 'user', content: 'Bắt đầu lại'}, {role: 'assistant', content: 'Bắt đầu một lượt mới.'}
  ]);
  assert.equal(calls.at(-1).envelope.reference.teaching.state.probe, freshProbe);
});

test('an explicit focus change resets the old probe and hint stage', async t => {
  const {env, send} = await authenticated(t);
  let result = structured('Câu hỏi cho từ đầu.', 'probe', ORIGINAL_PROBE);
  const calls = provider(t, () => providerResponse(result));
  const body = {lesson: WORD_LESSON, focus: {kind: 'word', index: 0}};
  await successful(await send({...body, intent: 'start', message: 'Luyện từ này'}), result.reply);
  result = structured('Gợi ý cho từ đầu.', 'hint', null);
  await successful(await send({...body, intent: 'hint', message: 'Gợi ý'}), result.reply);
  const newFocus = {kind: 'word', index: 5};
  const newProbe = 'Em hãy đặt một câu mới với 明るい.';
  result = structured('Chuyển sang từ đã chọn.', 'probe', newProbe);
  await successful(await send({...body, focus: newFocus, intent: 'start', message: 'Luyện từ mới'}), result.reply);
  const reference = calls.at(-1).envelope.reference;
  assert.equal(reference.teaching.state, null);
  assert.deepEqual(reference.lesson.focus.item, catalogs.N5.lessons[WORD_LESSON.id].words[5]);
  const state = teachingState(await saved(env, USER, 'lesson:N5:' + WORD_LESSON.id));
  assert.equal(state.probe, newProbe);
  assert.equal(state.hint_stage, 0);
  assert.deepEqual(state.focus, newFocus);
  result = structured('Giữ từ đang luyện.', 'hint', null);
  await successful(await send({lesson: WORD_LESSON, intent: 'hint', message: 'Gợi ý không gửi lại focus'}), result.reply);
  assert.deepEqual(calls.at(-1).envelope.reference.lesson.focus.item, catalogs.N5.lessons[WORD_LESSON.id].words[5]);
  assert.equal(calls.at(-1).envelope.reference.teaching.state.probe, newProbe);
});

test('quick requests ground word five, listening example nine and question three in canonical assets', async t => {
  const {env, send} = await authenticated(t);
  const reply = structured('Em hãy thử trả lời.', 'probe', 'Em sẽ trả lời thế nào?');
  const calls = provider(t, () => providerResponse(reply));
  for (const [id, kind, index, field, route] of [
    [WORD_LESSON.id, 'word', 5, 'words', '/vocabulary'],
    ['listening:N5:1', 'example', 9, 'examples', '/listening'],
    ['sentences:N5:1', 'question', 3, 'questions', '/sentences']
  ]) {
    const canonical = catalogs.N5.lessons[id];
    const focus = {kind, index};
    await successful(await send({channel: 'quick', intent: 'start', message: 'Giúp em với mục đang chọn',
      lesson: {id, level: 'N5'}, focus,
      screen: {route, title: 'Màn hình học', level: 'N5', text: 'Nội dung trình duyệt không phải dữ liệu chuẩn.'}
    }), reply.reply);
    const grounded = calls.at(-1).envelope.reference.lesson;
    assert.equal(grounded.id, id);
    assert.equal(grounded.focus.kind, kind);
    assert.equal(grounded.focus.index, index);
    assert.deepEqual(grounded.focus.item, canonical[field][index]);
    if (kind === 'question') {
      assert.deepEqual(grounded.focus.examples, canonical.questions[index].example_indexes.map(item => canonical.examples[item]));
      assert.ok(grounded.focus.item.opts.includes(grounded.focus.item.ans));
    }
    assert.deepEqual(teachingState(await saved(env, USER, 'quick:' + route)).focus, focus);
  }
  assert.equal(calls[0].envelope.reference.lesson.focus.item.jp, '明るい');
  assert.equal(calls[1].envelope.reference.lesson.focus.item.jp, '赤いものもあれば白いのもある。');
  assert.equal(calls[2].envelope.reference.lesson.focus.item.item_id, 'sentences:N5:1:3');
});

test('exam follow-ups use original option positions, retain the view across turns and bind retries to it', async t => {
  const {env, send} = await authenticated(t);
  const canonical = Object.values(catalogs.N5.lessons).find(entry => entry.exam_questions?.length > 5 && entry.exam_questions.some((question, index) =>
    entry.questions[index] && JSON.stringify(question.opts) !== JSON.stringify(entry.questions[index].opts)
      && question.opts.indexOf(question.ans) !== entry.questions[index].opts.indexOf(entry.questions[index].ans)));
  assert.ok(canonical, 'real exam and normalized checks have different correct-option positions');
  const index = canonical.exam_questions.findIndex((question, index) => canonical.questions[index]
    && question.opts.indexOf(question.ans) !== canonical.questions[index].opts.indexOf(canonical.questions[index].ans));
  const lesson = {id: canonical.id, level: 'N5'}, focus = {kind: 'question', index};
  const screen = {route: 'study/exam-view', title: 'Hỏi về câu thi', level: 'N5', text: ''};
  const body = {request_id: crypto.randomUUID(), channel: 'quick', lesson, focus, view: 'exam', screen, message: 'Em đọc các lựa chọn thế nào?'};
  let result = structured('Em hãy so sánh các lựa chọn.', 'probe', 'Em thấy điểm khác nhau nào?');
  const calls = provider(t, () => providerResponse(result));
  await successful(await send(body), result.reply);
  const selected = () => calls.at(-1).envelope.reference.lesson.focus.item;
  assert.deepEqual(selected(), canonical.exam_questions[index]);
  assert.notDeepEqual(selected().opts, canonical.questions[index].opts);
  const snapshot = await saved(env, USER, 'quick:' + screen.route);
  await successful(await send(body), result.reply);
  assert.equal(calls.length, 1);
  assert.equal((await send({...body, view: 'checks'})).status, 409);
  assert.equal((await send({...body, view: undefined})).status, 409);
  assert.deepEqual(await saved(env, USER, 'quick:' + screen.route), snapshot);
  result = structured('Em xem lại sự khác nhau ấy nhé.', 'hint');
  await successful(await send({channel: 'quick', lesson, screen, intent: 'hint', message: 'Thầy gợi ý thêm nhé.'}), result.reply);
  assert.deepEqual(selected(), canonical.exam_questions[index]);
  assert.equal(calls.at(-1).envelope.reference.teaching.state.probe, teachingState(snapshot).probe);
  result = structured('Ta xem phần luyện trong bài.', 'probe', 'Em thử đọc câu luyện nhé?');
  await successful(await send({...body, request_id: crypto.randomUUID(), view: 'checks'}), result.reply);
  assert.deepEqual(selected(), canonical.questions[index]);
  assert.equal(calls.at(-1).envelope.reference.teaching.state, null);
  const last = canonical.exam_questions.length - 1;
  assert.ok(last >= 5);
  await successful(await send({...body, request_id: crypto.randomUUID(), focus: {kind: 'question', index: last}}), result.reply);
  assert.deepEqual(selected(), canonical.exam_questions[last]);
});

test('invalid exam views and forged question answer fields fail before inference or persistence', async t => {
  const {env, send} = await authenticated(t);
  const calls = provider(t, () => providerResponse(structured('Không được gọi', 'probe', ORIGINAL_PROBE)));
  const canonical = Object.values(catalogs.N5.lessons).find(entry => entry.exam_questions?.length > 5);
  assert.ok(canonical);
  const lesson = {id: canonical.id, level: 'N5'}, focus = {kind: 'question', index: 0};
  for (const change of [
    {view: 'other'}, {view: null}, {view: 'exam', focus: null},
    {view: 'exam', focus: {kind: 'example', index: 0}},
    {view: 'exam', lesson: undefined},
    {view: 'exam', focus: {...focus, answer_index: 0}},
    {view: 'exam', focus: {...focus, item: {opts: ['forged'], ans: 'forged'}}},
    {view: 'exam', focus: {kind: 'question', index: canonical.exam_questions.length}}
  ]) assert.equal((await send({lesson, focus, message: 'Giúp em', ...change})).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM tutor_sessions').first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM tutor_requests').first()).n, 0);
});

test('forged, malformed and out-of-range focus references are rejected before inference', async t => {
  const {env, send} = await authenticated(t);
  const calls = provider(t, () => providerResponse(structured('未使用', 'probe', ORIGINAL_PROBE)));
  const before = await saved(env);
  for (const focus of [
    {kind: 'word', index: 5, item: {jp: '偽物', vi: 'giả'}},
    {kind: 'word', index: 5, text: 'client replacement'},
    {kind: 'word', index: '5'}, {kind: 'word', index: -1},
    {kind: 'word', index: 0.5}, {kind: 'word', index: 999},
    {kind: 'example', index: 999}, {kind: 'unknown', index: 0}
  ]) {
    const response = await send({lesson: WORD_LESSON, focus, message: 'Giúp em'});
    assert.equal(response.status, 400, JSON.stringify(focus));
  }
  assert.equal((await send({focus: {kind: 'word', index: 5}, message: 'Không có bài'})).status, 400);
  assert.equal((await send({lesson: {...WORD_LESSON, words: [{jp: '偽物'}]}, focus: {kind: 'word', index: 0}, message: 'Giả bài'})).status, 400);
  assert.equal(calls.length, 0);
  assert.deepEqual(await saved(env), before);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM conversations').first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM tutor_sessions').first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM tutor_requests').first()).n, 0);
});

test('concurrent identical IDs generate once, completed replay is saved and conflicting reuse is refused', async t => {
  const {env, send} = await authenticated(t);
  const body = {request_id: crypto.randomUUID(), message: 'Em cần một gợi ý.', intent: 'hint'};
  const entered = deferred(), released = deferred();
  let block = false;
  const calls = provider(t, async () => {
    if (!block) return providerResponse(structured('Câu hỏi ban đầu.', 'probe', ORIGINAL_PROBE));
    entered.resolve();
    await released.promise;
    return providerResponse(structured('Gợi ý được lưu đúng một lần.', 'hint', null));
  });
  await successful(await send({intent: 'start', message: 'Bắt đầu'}), 'Câu hỏi ban đầu.');
  block = true;
  const before = await saved(env);
  const pending = send(body);
  try {
    await reachedProvider(entered.promise, pending);
    assert.equal((await send(body)).status, 409);
    assert.equal(calls.length, 2);
    assert.deepEqual((await saved(env)).conversations, before.conversations);
    assert.equal((await send({...body, message: 'Đổi nội dung trong lúc đang chạy'})).status, 409);
    released.resolve();
    await successful(await pending, 'Gợi ý được lưu đúng một lần.');
    const complete = await saved(env);
    assert.equal(complete.conversations.length, before.conversations.length + 2);
    assert.equal(complete.requests.find(row => row.request_id === body.request_id).status, 'complete');
    await successful(await send(body), 'Gợi ý được lưu đúng một lần.');
    for (const change of [
      {message: 'Một nội dung khác'}, {intent: 'summary'},
      {channel: 'quick'}, {lesson: WORD_LESSON}
    ]) assert.equal((await send({...body, ...change})).status, 409);
    assert.equal(calls.length, 2);
    assert.deepEqual(await saved(env), complete);
  } finally {
    released.resolve();
    await pending;
  }
});

test('distinct concurrent IDs in one scope cannot race its teaching state', async t => {
  const {env, send} = await authenticated(t);
  const paused = pausedProvider(t);
  await successful(await send({intent: 'start', message: 'Bắt đầu'}), 'Đặt câu với từ đã chọn.');
  const before = await saved(env);
  paused.pause();
  const first = {request_id: crypto.randomUUID(), intent: 'hint', message: 'Gợi ý thứ nhất'};
  const second = {request_id: crypto.randomUUID(), intent: 'hint', message: 'Gợi ý thứ hai'};
  const pending = send(first);
  try {
    await reachedProvider(paused.entered, pending);
    assert.equal((await send(second)).status, 409);
    const during = await saved(env);
    assert.deepEqual(during.conversations, before.conversations);
    assert.equal(teachingState(during).hint_stage, 0);
    assert.equal(during.requests.some(row => row.request_id === second.request_id), false);
    assert.equal(paused.calls.length, 2);
    paused.release();
    await successful(await pending, 'Một gợi ý cho câu đang làm.');
    assert.equal(teachingState(await saved(env)).hint_stage, 1);
    await successful(await send(second), 'Một gợi ý cho câu đang làm.');
    assert.equal(paused.calls.length, 3);
    assert.equal(paused.calls.at(-1).envelope.reference.teaching.state.hint_stage, 1);
    const final = await saved(env);
    assert.equal(teachingState(final).hint_stage, 2);
    assert.equal(final.conversations.length, before.conversations.length + 4);
    assert.equal(final.session.revision, before.session.revision + 2);
  } finally {
    paused.release();
    await pending;
  }
});

for (const cleanup of ['history', 'account']) {
  test(cleanup + ' deletion fences an in-flight response and preserves another user', async t => {
    const {env, request, send, addUser} = await authenticated(t);
    await addUser(OTHER, 'b'.repeat(64));
    const paused = pausedProvider(t);
    for (const [userId, lesson] of [[USER, undefined], [USER, WORD_LESSON], [OTHER, undefined]]) {
      await successful(await send({intent: 'start', message: 'Lượt đã lưu', ...(lesson ? {lesson} : {})}, userId), 'Đặt câu với từ đã chọn.');
    }
    const other = await saved(env, OTHER);
    const otherProvider = await env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=?').bind(OTHER).first();
    const otherSessions = (await env.DB.prepare('SELECT * FROM sessions WHERE user_id=?').bind(OTHER).all()).results;
    const otherProfile = await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(OTHER).first();
    const otherScope = await saved(env, USER, 'lesson:N5:' + WORD_LESSON.id);
    const requestId = crypto.randomUUID();
    paused.pause();
    const pending = send({request_id: requestId, intent: 'hint', message: 'Đang chờ gợi ý'});
    try {
      await reachedProvider(paused.entered, pending);
      const deletion = cleanup === 'history'
        ? request('/api/history?user_id=' + OTHER, undefined, 'DELETE')
        : request('/api/account/delete', {user_id: OTHER});
      const response = await worker.fetch(deletion, env);
      assert.equal(response.status, 200);
      assert.deepEqual(await saved(env), {session: null, conversations: [], requests: []});
      paused.release();
      const completed = await pending;
      assert.equal(completed.status, 409);
      assert.equal((await completed.json()).reply, undefined);
      assert.deepEqual(await saved(env), {session: null, conversations: [], requests: []});
      assert.deepEqual(await saved(env, OTHER), other);
      assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=?').bind(OTHER).first(), otherProvider);
      assert.deepEqual((await env.DB.prepare('SELECT * FROM sessions WHERE user_id=?').bind(OTHER).all()).results, otherSessions);
      assert.deepEqual(await env.DB.prepare('SELECT * FROM profiles WHERE user_id=?').bind(OTHER).first(), otherProfile);
      assert.equal(paused.calls.length, 4);
      if (cleanup === 'history') {
        assert.deepEqual(await saved(env, USER, 'lesson:N5:' + WORD_LESSON.id), otherScope);
        const uiHistory = await worker.fetch(request('/api/history'), env);
        assert.equal(uiHistory.status, 200);
        assert.deepEqual(await uiHistory.json(), []);
        paused.resume();
        const retry = await send({request_id: requestId, intent: 'start', message: 'Lượt mới sau khi xóa'});
        await successful(retry, 'Đặt câu với từ đã chọn.');
        assert.equal(paused.calls.at(-1).envelope.reference.teaching.state, null);
        assert.deepEqual(paused.calls.at(-1).envelope.reference.history, []);
      } else {
        for (const table of ['tutor_requests', 'tutor_sessions', 'conversations', 'ai_providers', 'sessions', 'profiles', 'ai_usage']) {
          assert.equal((await env.DB.prepare('SELECT count(*) n FROM ' + table + ' WHERE user_id=?').bind(USER).first()).n, 0, table);
        }
        assert.equal((await send({message: 'Phiên đã bị xóa'})).status, 401);
      }
    } finally {
      paused.release();
      await pending;
    }
  });
}

test('an expired lease can be taken over without allowing its stale owner to commit or release the new claim', async t => {
  const env = {DB: database(t)};
  const requestId = crypto.randomUUID(), fingerprint = 'same-semantic-request', scope = 'chat';
  const first = await claimTutorRequest(env, USER, scope, requestId, fingerprint, 1000);
  assert.equal(typeof first.token, 'string');
  assert.ok(await claimTutorScope(env, USER, scope, first.token, 1000));
  const expires = (await env.DB.prepare('SELECT lease_expires FROM tutor_requests WHERE user_id=? AND request_id=?').bind(USER, requestId).first()).lease_expires;
  assert.equal((await claimTutorRequest(env, USER, scope, requestId, fingerprint, expires - 1)).token, undefined);
  assert.equal(await claimTutorScope(env, USER, scope, 'competing-owner', expires - 1), null);
  const replacement = await claimTutorRequest(env, USER, scope, requestId, fingerprint, expires);
  assert.equal(typeof replacement.token, 'string');
  assert.notEqual(replacement.token, first.token);
  assert.ok(await claimTutorScope(env, USER, scope, replacement.token, expires));
  const oldTurn = {userId: USER, scope, requestId, token: first.token, message: 'Em đang luyện.', reply: 'Không được lưu câu cũ.',
    state: {probe: 'Câu hỏi cũ', hint_stage: 2, awaiting: 'answer', lesson: null, focus: null}, historyAfter: 0};
  assert.equal(await commitTutorTurn(env, oldTurn), null);
  await releaseTutorClaim(env, USER, scope, requestId, first.token);
  const pending = await saved(env);
  assert.equal(pending.conversations.length, 0);
  assert.equal(pending.session.state_json, null);
  assert.equal(pending.session.revision, 0);
  assert.equal(pending.session.lease_token, replacement.token);
  assert.equal(pending.requests[0].lease_token, replacement.token);
  assert.equal(pending.requests[0].status, 'pending');
  const state = {probe: 'Câu hỏi mới', hint_stage: 0, awaiting: 'answer', lesson: null, focus: null};
  const reply = await commitTutorTurn(env, {...oldTurn, token: replacement.token, reply: 'Phản hồi của chủ mới.', state});
  assert.equal(reply, 'Phản hồi của chủ mới.');
  const complete = await saved(env);
  assert.deepEqual(complete.conversations.map(row => [row.role, row.content]), [
    ['user', oldTurn.message], ['bot', 'Phản hồi của chủ mới.']
  ]);
  assert.deepEqual(teachingState(complete), state);
  assert.equal(complete.session.revision, 1);
  assert.equal(complete.requests[0].status, 'complete');
  await commitTutorTurn(env, oldTurn);
  await releaseTutorClaim(env, USER, scope, requestId, first.token);
  assert.deepEqual(await saved(env), complete);
  assert.deepEqual(await claimTutorRequest(env, USER, scope, requestId, fingerprint, expires + 1), {cached: 'Phản hồi của chủ mới.'});
});

test('an expired or replaced request owner cannot acquire an otherwise free scope', async t => {
  const env = {DB: database(t)}, scope = 'chat', requestId = crypto.randomUUID();
  const first = await claimTutorRequest(env, USER, scope, requestId, 'original-request', 1000);
  assert.equal(typeof first.token, 'string');
  const expiry = (await env.DB.prepare('SELECT lease_expires FROM tutor_requests WHERE user_id=? AND request_id=?')
    .bind(USER, requestId).first()).lease_expires;
  assert.equal(await claimTutorScope(env, USER, scope, first.token, expiry), null,
    'an expired request cannot acquire a scope even before another request takes over');
  const replacement = await claimTutorRequest(env, USER, scope, requestId, 'original-request', expiry);
  assert.equal(typeof replacement.token, 'string');
  assert.notEqual(replacement.token, first.token);
  assert.equal(await claimTutorScope(env, USER, scope, first.token, expiry), null,
    'a replaced request token cannot acquire the still-free scope');
  const unclaimed = await saved(env);
  assert.equal(unclaimed.session.lease_token, null);
  assert.equal(unclaimed.session.revision, 0);
  assert.equal(unclaimed.conversations.length, 0);
  assert.ok(await claimTutorScope(env, USER, scope, replacement.token, expiry));
  assert.equal((await saved(env)).session.lease_token, replacement.token);
});

test('renewal extends both live leases and refuses either expired lease without changing ownership', async t => {
  const env = {DB: database(t)}, scope = 'chat', requestId = crypto.randomUUID();
  const claim = await claimTutorRequest(env, USER, scope, requestId, 'renewal-request', 1000);
  assert.ok(await claimTutorScope(env, USER, scope, claim.token, 1000));
  const before = await saved(env);
  assert.equal(await renewTutorClaim(env, USER, scope, requestId, claim.token, 2000), true);
  const renewed = await saved(env);
  assert.ok(renewed.session.lease_expires > before.session.lease_expires);
  assert.ok(renewed.requests[0].lease_expires > before.requests[0].lease_expires);
  assert.equal(renewed.session.lease_expires, renewed.requests[0].lease_expires);
  assert.equal(renewed.session.lease_token, claim.token);
  assert.equal(renewed.requests[0].lease_token, claim.token);
  assert.equal(await renewTutorClaim(env, USER, scope, requestId, 'stale-token', 2001), false);
  assert.deepEqual(await saved(env), renewed);
  for (const expired of ['tutor_requests', 'tutor_sessions']) {
    await env.DB.prepare('UPDATE tutor_requests SET lease_expires=? WHERE user_id=? AND request_id=?')
      .bind(renewed.requests[0].lease_expires, USER, requestId).run();
    await env.DB.prepare('UPDATE tutor_sessions SET lease_expires=? WHERE user_id=? AND context_key=?')
      .bind(renewed.session.lease_expires, USER, scope).run();
    await env.DB.prepare('UPDATE ' + expired + ' SET lease_expires=2001 WHERE user_id=?').bind(USER).run();
    const snapshot = await saved(env);
    assert.equal(await renewTutorClaim(env, USER, scope, requestId, claim.token, 2001), false, expired);
    assert.deepEqual(await saved(env), snapshot, expired);
  }
});

test('a generation paused during provider resolution is fenced before inference after lease takeover', async t => {
  const {env, send} = await authenticated(t);
  const calls = provider(t, () => providerResponse(structured('Không được gọi.', 'probe', ORIGINAL_PROBE)));
  const entered = deferred(), released = deferred();
  const prepare = env.DB.prepare.bind(env.DB);
  let paused = false;
  env.DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql.startsWith('SELECT p.* FROM ai_providers p')) {
      const first = statement.first.bind(statement);
      statement.first = async () => {
        const row = await first();
        if (!paused) {
          paused = true;
          entered.resolve();
          await released.promise;
        }
        return row;
      };
    }
    return statement;
  };
  const requestId = crypto.randomUUID();
  const pending = send({request_id: requestId, intent: 'start', message: 'Câu hỏi của chủ A'});
  try {
    await reachedProvider(entered.promise, pending);
    const ownerA = await saved(env);
    assert.equal(ownerA.requests[0].request_id, requestId);
    assert.equal(ownerA.session.lease_token, ownerA.requests[0].lease_token);
    assert.equal(calls.length, 0);
    await env.DB.prepare('UPDATE tutor_requests SET lease_expires=0 WHERE user_id=? AND request_id=?')
      .bind(USER, requestId).run();
    await env.DB.prepare('UPDATE tutor_sessions SET lease_expires=0 WHERE user_id=? AND context_key=?')
      .bind(USER, 'chat').run();
    const now = Date.now();
    const ownerB = await claimTutorRequest(env, USER, 'chat', requestId, ownerA.requests[0].fingerprint, now);
    assert.equal(typeof ownerB.token, 'string');
    assert.notEqual(ownerB.token, ownerA.requests[0].lease_token);
    assert.ok(await claimTutorScope(env, USER, 'chat', ownerB.token, now));
    const takenOver = await saved(env);
    released.resolve();
    const response = await pending;
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reply, undefined);
    assert.equal(calls.length, 0, 'stale owner A cannot start a paid generation after provider resolution');
    assert.deepEqual(await saved(env), takenOver, 'stale cleanup must leave both owner B leases intact');
    const state = {probe: 'Câu hỏi của chủ B', hint_stage: 0, awaiting: 'answer', lesson: null, focus: null};
    assert.equal(await commitTutorTurn(env, {
      userId: USER, scope: 'chat', requestId, token: ownerB.token,
      message: 'Câu hỏi của chủ A', reply: 'Phản hồi của chủ B.', state, historyAfter: 0
    }), 'Phản hồi của chủ B.');
    assert.deepEqual(teachingState(await saved(env)), state);
  } finally {
    released.resolve();
    await pending;
  }
});

test('a stale completion cannot return a replacement answer after history deletion and same-ID reuse', async t => {
  const env = {DB: database(t)}, scope = 'chat', requestId = crypto.randomUUID();
  const old = await claimTutorRequest(env, USER, scope, requestId, 'payload-A', 1000);
  assert.ok(await claimTutorScope(env, USER, scope, old.token, 1000));
  await clearTutorConversation(env, USER, scope);
  const replacement = await claimTutorRequest(env, USER, scope, requestId, 'different-payload-B', 2000);
  assert.equal(typeof replacement.token, 'string');
  assert.notEqual(replacement.token, old.token);
  assert.ok(await claimTutorScope(env, USER, scope, replacement.token, 2000));
  const state = {probe: 'Câu hỏi mới sau khi xóa', hint_stage: 0, awaiting: 'answer', lesson: null, focus: null};
  const turn = {userId: USER, scope, requestId, token: replacement.token,
    message: 'Nội dung B', reply: 'Phản hồi riêng cho B.', state, historyAfter: 0};
  assert.equal(await commitTutorTurn(env, turn), turn.reply);
  const complete = await saved(env);
  assert.equal(await commitTutorTurn(env, {...turn, token: old.token, message: 'Nội dung A', reply: 'Phản hồi A.'}), null,
    'a fenced owner must not borrow the completed answer from the new request');
  await releaseTutorClaim(env, USER, scope, requestId, old.token);
  assert.deepEqual(await saved(env), complete);
  assert.deepEqual(complete.conversations.map(row => [row.role, row.content]), [
    ['user', 'Nội dung B'], ['bot', 'Phản hồi riêng cho B.']
  ]);
  assert.equal(complete.requests[0].fingerprint, 'different-payload-B');
  assert.deepEqual(teachingState(complete), state);
});

test('explicit start creates a durable greeting probe in the normal chat session', async t => {
  const {env, send} = await authenticated(t);
  const probe = 'Em hãy giới thiệu mình bằng tiếng Nhật.';
  const calls = provider(t, (_call, index) => providerResponse(index === 1
    ? structured('Chào em, hãy thử tự giới thiệu.', 'probe', probe)
    : structured('Em bắt đầu với 私 nhé.', 'hint', null)));
  await successful(await send({intent: 'start', message: ''}), 'Chào em, hãy thử tự giới thiệu.');
  assert.equal(calls[0].envelope.reference.teaching.intent, 'start');
  assert.equal(teachingState(await saved(env)).probe, probe);
  await successful(await send({intent: 'hint', message: 'Gợi ý cho em'}), 'Em bắt đầu với 私 nhé.');
  assert.equal(calls[1].envelope.reference.teaching.state.probe, probe);
  const snapshot = await saved(env);
  assert.equal(teachingState(snapshot).probe, probe);
  assert.equal(teachingState(snapshot).hint_stage, 1);
  assert.equal(snapshot.conversations.length, 4);
  assert.equal(snapshot.session.revision, 2);
});

test('the retired greeting endpoint cannot append history or bypass an active chat generation', async t => {
  const {env, request, send} = await authenticated(t);
  const paused = pausedProvider(t);
  const empty = await saved(env);
  assert.equal((await worker.fetch(request('/api/chat/greeting', {}), env)).status, 404);
  assert.equal(paused.calls.length, 0);
  assert.deepEqual(await saved(env), empty);
  await successful(await send({intent: 'start', message: 'Bắt đầu'}), 'Đặt câu với từ đã chọn.');
  paused.pause();
  const pending = send({intent: 'hint', message: 'Đang chờ gợi ý'});
  try {
    await reachedProvider(paused.entered, pending);
    const busy = await saved(env);
    assert.equal((await worker.fetch(request('/api/chat/greeting', {intent: 'start'}), env)).status, 404);
    assert.equal((await send({intent: 'start', message: ''})).status, 409);
    assert.equal(paused.calls.length, 2);
    assert.deepEqual(await saved(env), busy);
    paused.release();
    await successful(await pending, 'Một gợi ý cho câu đang làm.');
    const complete = await saved(env);
    assert.equal(complete.conversations.length, 4);
    assert.equal(teachingState(complete).probe, ORIGINAL_PROBE);
    assert.equal(teachingState(complete).hint_stage, 1);
  } finally {
    paused.release();
    await pending;
  }
});

test('completed tutor retries bind every explicit device connection field without persisting credentials', async t => {
  const {env, request} = await authenticated(t);
  const device = {protocol: 'openai', base_url: 'https://device.example.com/v1', model: 'device-tutor', api_key: 'synthetic-device-secret'};
  const body = {request_id: crypto.randomUUID(), intent: 'start', message: 'Luyện với kết nối thiết bị', api_connection: device};
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, device.base_url + '/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer ' + device.api_key);
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, device.model);
    assert.equal(payload.response_format.json_schema.name, 'tutor_reply');
    assert.equal(payload.response_format.json_schema.strict, true);
    assert.ok(!JSON.stringify(payload).includes(device.api_key));
    calls.push(payload);
    return providerResponse(structured('Phản hồi từ thiết bị.', 'probe', ORIGINAL_PROBE));
  });
  const send = value => worker.fetch(request('/api/chat', value), env);
  await successful(await send(body), 'Phản hồi từ thiết bị.');
  const complete = await saved(env);
  assert.match(complete.requests[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(complete).includes(device.api_key));
  assert.ok(!JSON.stringify(complete).includes(device.base_url));
  await successful(await send({...body, api_connection: {
    api_key: device.api_key, model: device.model, base_url: device.base_url, protocol: device.protocol
  }}), 'Phản hồi từ thiết bị.');
  for (const change of [
    {protocol: 'anthropic'}, {base_url: 'https://other-device.example.com/v1'},
    {model: 'other-device-tutor'}, {api_key: 'different-device-secret'}
  ]) assert.equal((await send({...body, api_connection: {...device, ...change}})).status, 409);
  const {api_connection, ...savedSelection} = body;
  assert.equal((await send(savedSelection)).status, 409);
  assert.equal(calls.length, 1);
  assert.deepEqual(await saved(env), complete);
});

test('tutor chat honors explicit saved profiles and account ownership instead of borrowing another cached selection', async t => {
  const {env, request} = await authenticated(t);
  const profiles = [];
  for (const suffix of ['one', 'two']) {
    const response = await worker.fetch(request('/api/ai/profiles', {
      name: suffix, protocol: 'openai', base_url: 'https://profile-' + suffix + '.example.com/v1',
      model: 'tutor-' + suffix, api_key: 'synthetic-profile-' + suffix
    }), env);
    assert.equal(response.status, 201);
    profiles.push((await response.json()).profile);
  }
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const payload = JSON.parse(options.body);
    const suffix = calls.length === 0 ? 'one' : 'two';
    assert.equal(url, 'https://profile-' + suffix + '.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-profile-' + suffix);
    assert.equal(payload.model, 'tutor-' + suffix);
    assert.equal(payload.response_format.json_schema.name, 'tutor_reply');
    calls.push(payload);
    return providerResponse(structured('Phản hồi ' + suffix + '.', 'probe', ORIGINAL_PROBE));
  });
  const body = {request_id: crypto.randomUUID(), intent: 'start', message: 'Chọn hồ sơ để luyện'};
  const send = (value, profileId, account = USER) => worker.fetch(request('/api/chat', value, 'POST', {
    'X-VJBot-Profile': profileId, 'X-VJBot-Account': account
  }), env);
  const refused = await send(body, profiles[0].id, OTHER);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, 'account_changed');
  assert.equal(calls.length, 0);
  await successful(await send({...body, user_id: OTHER}, profiles[0].id), 'Phản hồi one.');
  const complete = await saved(env);
  await successful(await send(body, profiles[0].id), 'Phản hồi one.');
  assert.equal((await send(body, profiles[1].id)).status, 409);
  assert.equal(calls.length, 1);
  assert.deepEqual(await saved(env), complete);
  assert.deepEqual(await saved(env, OTHER), {session: null, conversations: [], requests: []});
  await successful(await send({...body, request_id: crypto.randomUUID()}, profiles[1].id), 'Phản hồi two.');
  assert.equal(calls.length, 2);
});
