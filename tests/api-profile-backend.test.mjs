import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import worker from '../src/worker.js';
import {hashToken} from '../src/auth.js';
import {resolveProvider, resolveSpeechProvider} from '../src/providers.js';
import {deleteUserData, recordAdminLogin} from '../src/admin.js';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';
import {kaiwaJudgment} from './fixtures/kaiwa-judgments.mjs';

const teacherCatalogs = await buildTeacherCatalog();
const kaiwaReference = {level: 'N5', scenario_id: Object.keys(teacherCatalogs.N5.scenarios)[0]};
const kaiwaRubric = teacherCatalogs.N5.scenarios[kaiwaReference.scenario_id].rubrics[0];
const teacherAssets = {fetch: async request => {
  const level = new URL(request.url).pathname.match(/^\/course\/teacher-(N[1-5])\.json$/)?.[1];
  return level ? Response.json(teacherCatalogs[level]) : new Response('Not found', {status: 404});
}};

const migrations = readdirSync('migrations').filter(f => /^\d+.*\.sql$/.test(f)).sort();
function database(beforeProfiles = false) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of migrations) {
    if (beforeProfiles && file === '0014_api_profiles.sql') break;
    sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  }
  const prepare = sql => {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return {results: sqlite.prepare(sql).all(...params)}; },
      async run() { return sqlite.prepare(sql).run(...params); }
    };
  };
  return {sqlite, prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }};
}
async function fixture(DB = database()) {
  const env = {DB, ASSETS: teacherAssets, AI_KEY_SECRET: 'profile-test-encryption-only'};
  const tokens = new Map([['google:alice', 'a'.repeat(64)], ['google:bob', 'b'.repeat(64)]]);
  for (const [id, token] of tokens) await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token), id, id, Date.now() + 600000).run();
  const request = (owner, path, method = 'GET', data) => new Request('https://vjbot.test' + path, {
    method, headers: {Cookie: 'vj_session=' + tokens.get(owner), 'Content-Type': 'application/json'},
    ...(data !== undefined ? {body: JSON.stringify(data)} : {})
  });
  const send = (owner, path, method, data) => worker.fetch(request(owner, path, method, data), env);
  const view = async owner => (await send(owner, '/api/ai/profiles')).json();
  const create = async (owner, patch = {}) => {
    const response = await send(owner, '/api/ai/profiles', 'POST', {name: 'API', protocol: 'openai', base_url: 'https://api.example.com/v1', model: 'm1', api_key: 'profile-test-key-1111', ...patch});
    assert.equal(response.status, 201); return (await response.json()).profile;
  };
  return {env, request, send, view, create};
}
const profileBody = (profile, patch = {}) => ({name: profile.name, protocol: profile.protocol, base_url: profile.base_url, model: profile.model, ...patch});
const activate = (send, owner, profile) => send(owner, '/api/ai/profiles/' + profile.id + '/activate', 'POST', {});

async function oldCiphertext(secret, owner, key) {
  const text = new TextEncoder();
  const aes = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', text.encode(secret)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: text.encode(owner)}, aes, text.encode(key)));
  return btoa(String.fromCharCode(...iv, ...ciphertext));
}

test('0014 migrates the encrypted single connection byte-for-byte and preserves active user AAD', async () => {
  const DB = database(true), f = await fixture(DB);
  const encrypted = await oldCiphertext(f.env.AI_KEY_SECRET, 'google:alice', 'migration-test-key-1234');
  await DB.prepare('INSERT INTO ai_providers VALUES(?,?,?,?,?,?,?)').bind('google:alice', 'openai', 'https://legacy.example.com/v1', 'legacy-model', encrypted, '1234', '2026-01-01T00:00:00.000Z').run();
  DB.sqlite.exec(readFileSync('migrations/0014_api_profiles.sql', 'utf8'));
  DB.sqlite.exec(readFileSync('migrations/0020_admin_grants.sql', 'utf8'));
  DB.sqlite.exec(readFileSync('migrations/0021_admin_ai_preferences.sql', 'utf8'));
  const rows = await DB.prepare('SELECT * FROM ai_providers').all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].key_enc, encrypted);
  assert.equal(rows.results[0].updated_at, '2026-01-01T00:00:00.000Z');
  const listed = await f.view('google:alice');
  assert.equal(listed.active_id, listed.profiles[0].id);
  assert.equal(listed.profiles[0].model, 'legacy-model');
  assert.deepEqual(listed.profiles[0].models, []);
  assert.equal(listed.profiles[0].checked_at, null);
  assert.equal((await resolveProvider(f.env, 'google:alice')).apiKey, 'migration-test-key-1234');
  assert.equal(await resolveProvider(f.env, 'google:bob'), null);
  const publicText = JSON.stringify(listed);
  assert.ok(!publicText.includes(encrypted)); assert.ok(!publicText.includes('migration-test-key'));
  // Even a copied ciphertext cannot be decrypted under another account's authenticated data.
  await DB.prepare('INSERT INTO ai_providers(user_id,id,name,protocol,base_url,model,key_enc,key_last4,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('google:bob', 'copied', 'Copy', 'openai', 'https://legacy.example.com/v1', 'legacy-model', encrypted, '1234', 'now').run();
  await f.send('google:bob', '/api/ai/profiles/copied/activate', 'POST', {});
  assert.equal((await resolveProvider(f.env, 'google:bob')).error, 'rekey');
});

test('profiles are private, selection is explicit, CRUD makes no network requests and settings edits only active', async () => {
  const {env, send, view, create} = await fixture(), original = globalThis.fetch;
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No network during profile CRUD'); };
  try {
    const a = await create('google:alice', {id: 'chosen-by-client', name: 'First'});
    assert.notEqual(a.id, 'chosen-by-client'); assert.equal((await view('google:alice')).active_id, null);
    const b = await create('google:alice', {name: 'Second', api_key: 'profile-test-key-2222', base_url: 'https://second.example.com/v1'});
    const ownBob = await create('google:bob', {name: 'Bob'});
    assert.equal((await activate(send, 'google:alice', a)).status, 200);
    assert.equal((await view('google:alice')).active_id, a.id);
    for (const [method, suffix, data] of [['PUT', '', profileBody(a, {name: 'stolen'})], ['DELETE', '', undefined], ['POST', '/activate', {}]]) {
      assert.equal((await send('google:bob', '/api/ai/profiles/' + a.id + suffix, method, data)).status, 404);
    }
    assert.deepEqual((await view('google:bob')).profiles.map(p => p.id), [ownBob.id]);
    assert.equal((await send('google:alice', '/api/ai/profiles/' + b.id, 'PUT', profileBody(b, {name: 'Renamed'}))).status, 200);
    assert.equal((await view('google:alice')).active_id, a.id);
    assert.equal((await activate(send, 'google:alice', b)).status, 200);
    const settings = await (await send('google:alice', '/api/ai/settings')).json();
    assert.equal(settings.own.id, b.id); assert.equal(settings.own.name, 'Renamed');
    assert.equal((await send('google:alice', '/api/ai/settings', 'PUT', profileBody(b, {model: 'new-model'}))).status, 200);
    assert.equal((await resolveProvider(env, 'google:alice')).models[0], 'new-model');
    assert.equal((await view('google:alice')).profiles.find(p => p.id === a.id).model, 'm1');
    const raw = JSON.stringify(await view('google:alice'));
    assert.ok(!raw.includes('profile-test-key')); assert.ok(!raw.includes('key_enc')); assert.ok(!raw.includes('api_key'));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('unconfigured profiles save and activate before discovery but cannot generate; settings still needs a model', async () => {
  const {env, send, view, create} = await fixture();
  const saved = await create('google:alice', {model: '', models: [], checked_at: null});
  assert.equal(saved.model, ''); assert.deepEqual(saved.models, []); assert.equal(saved.checked_at, null);
  assert.equal((await activate(send, 'google:alice', saved)).status, 200);
  assert.equal((await view('google:alice')).active_id, saved.id);
  assert.equal((await send('google:alice', '/api/ai/settings', 'PUT', profileBody(saved))).status, 400);
  assert.equal((await resolveProvider(env, 'google:alice')).error, 'no_model');
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Unconfigured model must not be sent'); };
  try {
    for (const [path, data] of [['/api/chat', {message: 'hello'}], ['/api/kaiwa/evaluate', {...kaiwaReference, user_speech: 'はい'}], ['/api/ai/test', {}]]) {
      const response = await send('google:alice', path, 'POST', data);
      assert.equal(response.status, 403); assert.equal((await response.json()).code, 'no_ai');
    }
  } finally { globalThis.fetch = original; }
});

test('blank keys cannot cross protocol or URL; stale and forged history never replaces same-connection history', async () => {
  const {env, send, create, view} = await fixture();
  const a = await create('google:alice'), path = '/api/ai/profiles/' + a.id, checked_at = Date.now() - 1000;
  const update = data => send('google:alice', path, 'PUT', profileBody(a, data));
  assert.equal((await update({models: ['m1', 'm2'], checked_at, connection_id: a.connection_id})).status, 200);
  const snapshot = await env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=? AND id=?').bind('google:alice', a.id).first();
  for (const patch of [{base_url: 'https://other.example.com/v1'}, {protocol: 'anthropic'}, {api_key: 'bad'}, {models: ['bad?'], checked_at, connection_id: a.connection_id}, {model: '<unsafe>'}]) {
    const response = await update(patch); assert.equal(response.status, 400);
    assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=? AND id=?').bind('google:alice', a.id).first(), snapshot);
  }
  for (const connection_id of ['forged', null]) {
    assert.equal((await update({models: ['forged-model'], checked_at, connection_id})).status, 200);
    const publicRow = (await view('google:alice')).profiles[0];
    assert.deepEqual(publicRow.models, ['m1', 'm2']); assert.equal(publicRow.checked_at, checked_at);
  }
  const changed = await (await update({api_key: 'replacement-test-key-9999', models: ['m1'], checked_at, connection_id: a.connection_id})).json();
  assert.notEqual(changed.profile.connection_id, a.connection_id);
  assert.deepEqual(changed.profile.models, []); assert.equal(changed.profile.checked_at, null);
  const changedEndpoint = await (await update({base_url: 'https://other.example.com/v1', api_key: 'replacement-test-key-9999', models: ['m1'], checked_at, connection_id: changed.profile.connection_id})).json();
  assert.notEqual(changedEndpoint.profile.connection_id, changed.profile.connection_id);
  assert.deepEqual(changedEndpoint.profile.models, []);
  assert.equal((await update({model: 'profile-test-key-1111', api_key: 'profile-test-key-1111'})).status, 400);
});

test('saved-key discovery selects only the requested owned profile and matching endpoint', async () => {
  const {send, create} = await fixture();
  const a = await create('google:alice'), b = await create('google:alice', {api_key: 'profile-test-key-2222'});
  await activate(send, 'google:alice', a);
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, 'https://api.example.com/v1/models'); assert.equal(options.headers.Authorization, 'Bearer profile-test-key-2222'); return Response.json({data: [{id: 'm1'}]}); };
  try {
    const draft = {protocol: b.protocol, base_url: b.base_url, profile_id: b.id};
    assert.equal((await send('google:alice', '/api/ai/models', 'POST', draft)).status, 200);
    assert.equal((await send('google:bob', '/api/ai/models', 'POST', draft)).status, 400);
    assert.equal((await send('google:alice', '/api/ai/models', 'POST', {...draft, base_url: 'https://other.example.com/v1'})).status, 400);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('deleting active never selects another; settings delete and account deletion remove only their intended rows', async () => {
  const {env, send, view, create} = await fixture();
  const a = await create('google:alice'), b = await create('google:alice'), bob = await create('google:bob');
  await activate(send, 'google:alice', a); await activate(send, 'google:bob', bob);
  assert.equal((await send('google:alice', '/api/ai/settings', 'DELETE')).status, 200);
  const listed = await view('google:alice'); assert.equal(listed.active_id, null); assert.deepEqual(listed.profiles.map(p => p.id), [b.id]);
  assert.equal(await resolveProvider(env, 'google:alice'), null);
  assert.equal((await send('google:alice', '/api/chat', 'POST', {message: 'hello'})).status, 403);
  await activate(send, 'google:alice', b);
  assert.equal((await send('google:alice', '/api/ai/profiles/' + b.id, 'DELETE')).status, 200);
  assert.equal((await view('google:alice')).active_id, null);
  await create('google:alice'); await create('google:alice');
  assert.equal((await send('google:alice', '/api/account/delete', 'POST', {})).status, 200);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_providers WHERE user_id=?').bind('google:alice').first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_active_profiles WHERE user_id=?').bind('google:alice').first()).n, 0);
  assert.equal((await view('google:bob')).active_id, bob.id);
});

test('concurrent creates stop at twenty per account and the database itself enforces the limit', async () => {
  const {env, send, view, create} = await fixture();
  const responses = await Promise.all(Array.from({length: 24}, (_, i) => send('google:alice', '/api/ai/profiles', 'POST', {
    name: 'Profile ' + i, protocol: 'openai', base_url: '', model: '', api_key: 'capacity-test-key'
  })));
  assert.equal(responses.filter(r => r.status === 201).length, 20);
  assert.equal(responses.filter(r => r.status === 409).length, 4);
  assert.equal((await view('google:alice')).profiles.length, 20);
  const first = (await view('google:alice')).profiles[0];
  assert.equal((await send('google:alice', '/api/ai/profiles/' + first.id, 'PUT', profileBody(first, {name: 'Still editable'}))).status, 200);
  await assert.rejects(env.DB.prepare(`INSERT INTO ai_providers(user_id,id,name,protocol,base_url,model,key_enc,key_last4,updated_at)
    SELECT user_id,'overflow',name,protocol,base_url,model,key_enc,key_last4,updated_at FROM ai_providers WHERE user_id=? LIMIT 1`).bind('google:alice').run(), /ai_profiles_limit/);
  await create('google:bob');
});

test('device overrides drive chat, Kaiwa, AI test and Google TTS transiently without changing server selection', async () => {
  const {env, send, create, view} = await fixture();
  const saved = await create('google:alice'); await activate(send, 'google:alice', saved);
  const before = await env.DB.prepare('SELECT * FROM ai_providers').all();
  const api_connection = {protocol: 'openai', base_url: 'https://device.example.com/v1', model: 'device-model', api_key: 'ephemeral-test-key-4444'};
  const seen = [], original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    seen.push(url); assert.equal(options.redirect, 'manual');
    if (url.includes('generativelanguage.googleapis.com')) {
      assert.equal(options.headers['x-goog-api-key'], 'ephemeral-google-key');
      return Response.json({candidates: [{content: {parts: [{inlineData: {data: 'UklGRg==', mimeType: 'audio/wav'}}]}}]});
    }
    assert.equal(url, 'https://device.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer ephemeral-test-key-4444');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'device-model');
    const content = body.response_format?.json_schema?.name === 'tutor_reply'
      ? {reply: '何時に始まりますか。', action: 'probe', open_probe: '何時に始まりますか。'}
      : kaiwaJudgment(kaiwaRubric, 'はい');
    return Response.json({choices: [{message: {content: JSON.stringify(content)}}]});
  };
  try {
    const chat = await send('google:alice', '/api/chat', 'POST', {message: 'hello', api_connection});
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).reply, '何時に始まりますか。');
    const kaiwa = await send('google:alice', '/api/kaiwa/evaluate', 'POST', {...kaiwaReference, user_speech: 'はい', api_connection});
    assert.equal(kaiwa.status, 200); const estimate = await kaiwa.json();
    assert.equal(estimate.status, 'estimated'); assert.equal(estimate.estimated_score, 100);
    assert.equal(estimate.score, null); assert.equal(estimate.rating, null);
    assert.equal((await send('google:alice', '/api/ai/test', 'POST', {api_connection})).status, 200);
    const tts = await send('google:alice', '/api/tts', 'POST', {text: 'こんにちは', api_connection: {protocol: 'gemini', base_url: '', model: 'gemini-test', api_key: 'ephemeral-google-key'}});
    assert.equal(tts.status, 200); assert.equal((await tts.json()).audioBase64, 'UklGRg==');
    assert.equal((await send('google:alice', '/api/tts', 'POST', {text: 'hello', api_connection})).status, 403);
    assert.equal((await send('google:alice', '/api/tts', 'POST', {text: 'hello', api_connection: {protocol: 'gemini', base_url: 'https://proxy.example.com', model: 'gemini-test', api_key: 'ephemeral-google-key'}})).status, 403);
    assert.equal(seen.length, 4);
    assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers').all(), before);
    assert.equal((await view('google:alice')).active_id, saved.id);
    const persisted = JSON.stringify((await env.DB.prepare('SELECT * FROM conversations').all()).results);
    assert.ok(!persisted.includes('ephemeral-test-key')); assert.ok(!persisted.includes('ephemeral-google-key'));
  } finally { globalThis.fetch = original; }
});

test('invalid or speech-incompatible overrides fail closed before network or history, even with a working server profile', async () => {
  const {env, send, create} = await fixture();
  const saved = await create('google:alice'); await activate(send, 'google:alice', saved);
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Invalid override must not fall back'); };
  const good = {protocol: 'openai', base_url: 'https://device.example.com/v1', model: 'm1', api_key: 'ephemeral-test-key'};
  const before = await env.DB.prepare('SELECT * FROM ai_providers').all();
  try {
    for (const api_connection of [null, [], {}, {...good, api_key: ''}, {...good, model: ''}, {...good, base_url: 'https://localhost/v1'}, {...good, base_url: 'https://127.0.0.1/v1'}, {...good, base_url: 'https://user:pw@device.example.com'}, {...good, protocol: 'unknown'}]) {
      for (const path of ['/api/chat', '/api/kaiwa/evaluate', '/api/tts', '/api/ai/test']) {
        // Voice-only profiles may omit a chat model, but this custom endpoint still cannot receive speech requests.
        const speechOnly = path === '/api/tts' && api_connection?.model === '';
        const response = await send('google:alice', path, 'POST', {message: '', user_speech: '', text: 'hi', api_connection});
        assert.equal(response.status, speechOnly ? 403 : 400, path);
        assert.equal((await response.json()).code, speechOnly ? 'no_tts' : 'invalid_connection');
      }
      await env.DB.prepare('DELETE FROM ai_usage').run();
    }
    assert.equal(calls, 0);
    assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers').all(), before);
    assert.equal((await env.DB.prepare('SELECT count(*) n FROM conversations').first()).n, 0);
    const forbidden = new Request('https://vjbot.test/api/chat', {method: 'POST', headers: {Origin: 'https://other.test'}, body: JSON.stringify({api_connection: good})});
    assert.equal((await worker.fetch(forbidden, env)).status, 403);
    assert.equal((await worker.fetch(new Request('https://vjbot.test/api/ai/profiles'), env)).status, 401);
  } finally { globalThis.fetch = original; }
});

test('admin summaries count accounts, report the active choice and remove every owned API and active reference', async () => {
  const {env, send, create, view} = await fixture();
  env.ADMIN_EMAILS = 'alice@example.test'; await recordAdminLogin(env, 'google:alice', 'alice@example.test');
  for (const owner of ['google:alice', 'google:bob']) await env.DB.prepare('INSERT INTO profiles(user_id,level,track,updated_at) VALUES(?,?,?,?)').bind(owner, 'N5', 'minna', 'now').run();
  const alice = await create('google:alice'), bob = await create('google:bob'), bob2 = await create('google:bob', {model: 'm2'});
  await activate(send, 'google:alice', alice); await activate(send, 'google:bob', bob2);
  assert.equal((await (await send('google:alice', '/api/admin/overview')).json()).own_api_users, 2);
  const detail = await (await send('google:alice', '/api/admin/user?id=google%3Abob')).json();
  assert.equal(detail.api_profiles, 2); assert.match(detail.api, /m2/);
  assert.ok(!JSON.stringify(detail).includes('key_enc')); assert.ok(!JSON.stringify(detail).includes('profile-test-key'));
  assert.equal((await send('google:alice', '/api/admin/user', 'POST', {id: 'google:bob', action: 'remove_api'})).status, 200);
  assert.deepEqual((await view('google:bob')).profiles, []); assert.equal((await view('google:bob')).active_id, null);
  assert.equal((await view('google:alice')).profiles.length, 1);
  const freshBob = await create('google:bob'); await activate(send, 'google:bob', freshBob);
  await deleteUserData(env, 'google:bob');
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_active_profiles WHERE user_id=?').bind('google:bob').first()).n, 0);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_providers WHERE user_id=?').bind('google:bob').first()).n, 0);
  assert.ok(bob.id); assert.equal((await view('google:alice')).active_id, alice.id);
});

test('same-endpoint profiles keep separate per-key model histories and active model choices across reads', async () => {
  const {env, send, view, create} = await fixture();
  const a = await create('google:alice', {model: 'first-model'}), b = await create('google:alice', {model: 'second-model', api_key: 'profile-test-key-2222'});
  assert.notEqual(a.connection_id, b.connection_id);
  for (const profile of [a, b]) {
    const checked_at = Date.now() - 1000;
    assert.equal((await send('google:alice', '/api/ai/profiles/' + profile.id, 'PUT', profileBody(profile, {
      models: [profile.model], checked_at, connection_id: profile.connection_id
    }))).status, 200);
  }
  for (const profile of [a, b, a]) {
    assert.equal((await activate(send, 'google:alice', profile)).status, 200);
    const reloaded = await view('google:alice');
    assert.equal(reloaded.active_id, profile.id);
    const settings = await (await send('google:alice', '/api/ai/settings')).json();
    assert.equal(settings.own.id, profile.id);
    assert.equal(settings.own.model, profile.model);
    assert.deepEqual(settings.own.models, [profile.model]);
    const resolved = await resolveProvider(env, 'google:alice');
    assert.equal(resolved.models[0], profile.model);
    assert.equal(resolved.apiKey, profile.id === a.id ? 'profile-test-key-1111' : 'profile-test-key-2222');
  }
  // A valid history identity for another key at the same host cannot be transferred.
  const changed = await send('google:alice', '/api/ai/profiles/' + b.id, 'PUT', profileBody(b, {
    models: ['first-model'], checked_at: Date.now(), connection_id: a.connection_id
  }));
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).profile.models, ['second-model']);
});

test('device use requires neither server key encryption nor saved profiles and still observes rate limits', async () => {
  const {env, send, view} = await fixture(); delete env.AI_KEY_SECRET;
  assert.equal((await view('google:alice')).can_store, false);
  const api_connection = {protocol: 'openai', base_url: 'https://device.example.com/v1', model: 'm1', api_key: 'unsaved-device-key'};
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://device.example.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer unsaved-device-key');
    return Response.json({choices: [{message: {content: JSON.stringify({reply: '何時に始まりますか。', action: 'probe', open_probe: '何時に始まりますか。'})}}]});
  };
  try {
    assert.equal((await send('google:alice', '/api/chat', 'POST', {message: 'hello', api_connection})).status, 200);
    await env.DB.prepare('INSERT OR REPLACE INTO ai_usage(user_id,bucket,count) VALUES(?,?,20)').bind('google:alice', Math.floor(Date.now() / 60000)).run();
    for (const path of ['/api/chat', '/api/kaiwa/evaluate', '/api/tts', '/api/ai/test']) {
      assert.equal((await send('google:alice', path, 'POST', {message: 'hello', text: 'hi', user_speech: 'はい', api_connection})).status, 429);
    }
    assert.equal(calls, 1);
    assert.deepEqual((await view('google:alice')).profiles, []);
    assert.equal((await view('google:alice')).active_id, null);
    assert.equal((await send('google:alice', '/api/ai/profiles', 'POST', profileBody({name: 'no', protocol: 'openai', base_url: '', model: ''}, {api_key: 'unsaved-device-key'}))).status, 503);
  } finally { globalThis.fetch = original; }
});

test('profile writes accept bounded thousand-model history while probes retain their smaller body bound', async () => {
  const {env, send, create, view} = await fixture();
  const a = await create('google:alice'), models = Array.from({length: 1000}, (_, i) => String(i).padStart(4, '0') + 'a'.repeat(96));
  const history = {models, checked_at: Date.now(), connection_id: a.connection_id};
  const full = profileBody(a, history);
  assert.ok(new TextEncoder().encode(JSON.stringify(full)).byteLength > 4096);
  assert.ok(new TextEncoder().encode(JSON.stringify(full)).byteLength < 131072);
  assert.equal((await send('google:alice', '/api/ai/profiles/' + a.id, 'PUT', full)).status, 200);
  assert.deepEqual((await view('google:alice')).profiles[0].models, models);
  await activate(send, 'google:alice', a);
  assert.equal((await send('google:alice', '/api/ai/settings', 'PUT', full)).status, 200);
  const copy = await create('google:alice', {...full, name: 'Copy'});
  assert.deepEqual(copy.models, models);
  const before = await env.DB.prepare('SELECT * FROM ai_providers').all();
  for (const padding of ['x'.repeat(131072), '日'.repeat(70000)]) {
    assert.equal((await send('google:alice', '/api/ai/profiles/' + a.id, 'PUT', profileBody(a, {padding}))).status, 400);
  }
  assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers').all(), before);
  for (const path of ['/api/ai/models', '/api/ai/models/test', '/api/ai/test']) {
    assert.equal((await send('google:alice', path, 'POST', {...profileBody(a), padding: 'x'.repeat(4096)})).status, 400);
  }
  for (const protocol of ['constructor', 'toString', ['openai']]) {
    assert.equal((await send('google:alice', '/api/ai/profiles/' + a.id, 'PUT', profileBody(a, {protocol}))).status, 400);
  }
});

test('a shared-cookie account change rejects stale-tab credentials before persistence, usage or inference', async () => {
  const f=await fixture(),previous=globalThis.fetch;
  let network=0;
  globalThis.fetch=async()=>{network++;throw new Error('Must not call provider');};
  try {
    for(const [path,method,data] of [
      ['/api/ai/profiles','GET'],
      ['/api/ai/profiles','POST',{name:'Do not save',protocol:'openai',base_url:'https://api.example.com/v1',model:'m1',api_key:'stale-alice-device-key'}],
      ['/api/ai/settings','PUT',{protocol:'openai',base_url:'https://api.example.com/v1',model:'m1',api_key:'stale-alice-device-key'}],
      ...['/api/chat','/api/tts','/api/kaiwa/evaluate','/api/ai/test'].map(path=>[path,'POST',{message:'hello',text:'こんにちは',user_speech:'はい',
        api_connection:{protocol:'openai',base_url:'https://api.example.com/v1',model:'m1',api_key:'stale-alice-device-key'}}])
    ]) {
      const request=f.request('google:bob',path,method,data);
      request.headers.set('X-VJBot-Account','google:alice');
      const response=await worker.fetch(request,f.env);
      assert.equal(response.status,409,path);
      assert.equal((await response.json()).code,'account_changed');
    }
    assert.equal(network,0);
    assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM ai_providers').first()).n,0);
    assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM ai_usage').first()).n,0);
    assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM conversations').first()).n,0);
  } finally {globalThis.fetch=previous;}
});

test('pinned server profiles survive another activation and fail closed after removal or cross-account use', async () => {
  const f=await fixture(),previous=globalThis.fetch;
  const first=await f.create('google:alice',{name:'First',protocol:'gemini',base_url:'https://generativelanguage.googleapis.com',api_key:'first-server-test-key'});
  const second=await f.create('google:alice',{name:'Second',api_key:'second-server-test-key'});
  await activate(f.send,'google:alice',second);
  let network=0;
  globalThis.fetch=async(url,options)=>{
    network++;
    assert.equal(options.headers['x-goog-api-key'],'first-server-test-key');
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
    const content = JSON.parse(options.body).generationConfig?.responseJsonSchema?.properties?.reply
      ? {reply: '何時に始まりますか。', action: 'probe', open_probe: '何時に始まりますか。'}
      : kaiwaJudgment(kaiwaRubric, 'はい');
    return Response.json({candidates:[{content:{parts:url.includes('-tts:')
      ?[{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]
      :[{text:JSON.stringify(content)}]}}]});
  };
  try {
    for(const path of ['/api/chat','/api/kaiwa/evaluate','/api/tts','/api/ai/test']) {
      const request=f.request('google:alice',path,'POST',{message:'hello',text:'こんにちは',user_speech:'はい',...(path === '/api/kaiwa/evaluate' ? kaiwaReference : {})});
      request.headers.set('X-VJBot-Profile',first.id);
      assert.equal((await worker.fetch(request,f.env)).status,200,path);
    }
    assert.equal(network,4);
    await f.send('google:alice','/api/ai/profiles/'+first.id,'DELETE');
    for(const owner of ['google:alice','google:bob']) {
      const request=f.request(owner,'/api/ai/test','POST',{});
      request.headers.set('X-VJBot-Profile',first.id);
      assert.equal((await worker.fetch(request,f.env)).status,409);
    }
    assert.equal(network,4);
    assert.equal((await f.view('google:alice')).active_id,second.id);
  } finally {globalThis.fetch=previous;}
});

test('TTS pins a saved Gemini credential without a chat model and never borrows server activation', async () => {
  const f = await fixture(), previous = globalThis.fetch;
  const voice = await f.create('google:alice', {name:'Voice only',protocol:'gemini',base_url:'',model:'',api_key:'saved-voice-only-key'});
  const chat = await f.create('google:alice', {name:'Chat',api_key:'saved-chat-only-key'});
  await activate(f.send,'google:alice',chat);
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
    assert.equal(options.headers['x-goog-api-key'],'saved-voice-only-key');
    if ((options.method || 'GET') === 'GET') return Response.json({models:[{name:'models/gemini-3.8-flash-tts',supportedGenerationMethods:['generateContent']}]});
    return Response.json({candidates:[{content:{parts:[{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]}}]});
  };
  const pinned = (owner, data, id = voice.id) => {
    const request = f.request(owner,'/api/tts','POST',data);
    request.headers.set('X-VJBot-Profile',id);
    return worker.fetch(request,f.env);
  };
  try {
    assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは'})).status,403);
    assert.equal(calls,0);
    assert.equal((await pinned('google:alice',{action:'models'})).status,200);
    assert.equal((await pinned('google:alice',{text:'こんにちは'})).status,200);
    assert.equal((await f.view('google:alice')).active_id,chat.id);
    await activate(f.send,'google:alice',voice);
    assert.equal((await resolveProvider(f.env,'google:alice')).error,'no_model');
    assert.equal((await f.send('google:alice','/api/chat','POST',{message:'hello'})).status,403);
    assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは'})).status,403);
    assert.equal((await pinned('google:bob',{text:'こんにちは'})).status,409);
    await f.send('google:alice','/api/ai/profiles/'+voice.id,'DELETE');
    assert.equal((await pinned('google:alice',{text:'こんにちは'})).status,409);
    assert.equal(calls,2);
  } finally {globalThis.fetch=previous;}
});

test('device Gemini TTS accepts an empty chat model but retains connection/key validation and no server fallback', async () => {
  const f = await fixture(), previous = globalThis.fetch;
  const active = await f.create('google:alice',{protocol:'gemini',base_url:'',api_key:'active-server-key'});
  await activate(f.send,'google:alice',active);
  const connection = {protocol:'gemini',base_url:'',model:'',api_key:'device-voice-only-key'};
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.headers['x-goog-api-key'],connection.api_key);
    return Response.json({candidates:[{content:{parts:[{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]}}]});
  };
  try {
    assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは',api_connection:connection})).status,200);
    assert.equal((await f.send('google:alice','/api/chat','POST',{message:'hello',api_connection:connection})).status,400);
    for (const patch of [
      {api_key:''},{model:null},{protocol:'unknown'},{base_url:'https://localhost'},
      {base_url:'https://generativelanguage.googleapis.com?key=secret'}
    ]) {
      assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは',api_connection:{...connection,...patch}})).status,400);
    }
    for (const base_url of ['https://proxy.example.com','https://generativelanguage.googleapis.com/custom','https://generativelanguage.googleapis.com:8443']) {
      assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは',api_connection:{...connection,base_url}})).status,403);
    }
    const combined = f.request('google:alice','/api/tts','POST',{text:'こんにちは',api_connection:connection});
    combined.headers.set('X-VJBot-Profile',active.id);
    assert.equal((await worker.fetch(combined,f.env)).status,400);
    assert.equal(calls,1);
    assert.equal((await f.view('google:alice')).active_id,active.id);
  } finally {globalThis.fetch=previous;}
});

test('managed admin chat and voice ignore personal profiles, recheck grants and fail closed without the server key', async () => {
  const f = await fixture(), previous = globalThis.fetch;
  f.env.OPENAI_API_KEY = 'platform-voice-key-only';
  f.env.ADMIN_EMAILS = 'owner@example.test';
  await recordAdminLogin(f.env,'google:alice','owner@example.test');
  const chat = await f.create('google:alice');
  await activate(f.send,'google:alice',chat);
  const stored = await f.env.DB.prepare('SELECT * FROM ai_providers WHERE id=?').bind(chat.id).first();
  await f.env.DB.prepare('INSERT INTO ai_antigravity_connections(user_id,auth_id,gateway_url,prefix,login_id,model,state,updated_at,name) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('google:alice','stored-credential','https://gateway.test','stored-prefix','stored-login','oauth-chat','active',Date.now(),'Saved OAuth').run();
  await f.env.DB.prepare('INSERT INTO ai_active_antigravity(user_id,connection_id) VALUES(?,?)').bind('google:alice','stored-login').run();
  const oauth = await f.env.DB.prepare('SELECT * FROM ai_antigravity_connections WHERE user_id=?').bind('google:alice').first();
  assert.equal((await f.send('google:alice','/api/admin/ai','PUT',
    {model:'gpt-5-mini',reasoning_effort:'high',live_voice:'marin'})).status,200);
  const selected = (owner, data = {text:'こんにちは'}, profile = 'platform_openai') => {
    const request = f.request(owner,'/api/tts','POST',data);
    request.headers.set('X-VJBot-Profile',profile);
    return worker.fetch(request,f.env);
  };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url,'https://api.openai.com/v1/audio/speech');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer '+f.env.OPENAI_API_KEY);
    assert.equal(JSON.parse(options.body).model,'gpt-4o-mini-tts');
    assert.equal(JSON.parse(options.body).voice,'alloy');
    assert.equal(JSON.parse(options.body).reasoning_effort,undefined);
    return new Response(new Uint8Array([73,68,51]));
  };
  try {
    const managed = await resolveProvider(f.env,'google:alice');
    assert.equal(managed.source,'platform'); assert.equal(managed.apiKey,f.env.OPENAI_API_KEY);
    assert.deepEqual(managed.models,['gpt-5-mini']); assert.equal(managed.reasoningEffort,'high');
    assert.equal((await resolveProvider(f.env,'google:alice',undefined,'platform_openai')).apiKey,f.env.OPENAI_API_KEY);
    assert.equal((await resolveSpeechProvider(f.env,'google:alice')).provider.source,'platform');
    const settings = await (await f.send('google:alice','/api/ai/settings')).json();
    assert.equal(settings.source,'platform'); assert.equal(settings.own.id,chat.id);
    assert.equal(settings.platform.configured,true);
    assert.ok(!JSON.stringify(settings).includes(f.env.OPENAI_API_KEY));
    assert.ok(!JSON.stringify(settings).includes('profile-test-key'));
    assert.equal((await f.send('google:alice','/api/tts','POST',{action:'models'})).status,200);
    assert.equal((await selected('google:alice',{action:'models'})).status,200);
    assert.equal(calls,0);
    for (const response of [
      await f.send('google:alice','/api/tts','POST',{text:'こんにちは'}),
      await selected('google:alice')
    ]) {
      assert.equal(response.status,200); assert.equal((await response.json()).voice,'alloy');
    }
    const device = {protocol:'openai',base_url:'',model:'m1',api_key:'device-private-key'};
    for (const profile of [chat.id,'antigravity_oauth:stored-login']) {
      assert.equal((await resolveProvider(f.env,'google:alice',undefined,profile)).error,'invalid_connection');
    }
    assert.equal((await resolveProvider(f.env,'google:alice',device)).error,'invalid_connection');
    for (const path of ['/api/chat','/api/ai/test','/api/tts']) {
      const response = await f.send('google:alice',path,'POST',{message:'hello',text:'こんにちは',api_connection:device});
      assert.equal(response.status,400,path); assert.equal((await response.json()).code,'invalid_connection');
    }
    assert.equal((await selected('google:alice',{text:'こんにちは'},chat.id)).status,400);
    assert.equal((await selected('google:alice',{text:'こんにちは'},'antigravity_oauth:stored-login')).status,400);
    assert.equal((await selected('google:alice',{text:'こんにちは',api_connection:device})).status,400);
    assert.equal((await selected('google:bob')).status,403);
    assert.equal((await f.send('google:bob','/api/tts','POST',{text:'こんにちは'})).status,403);
    const fake = f.request('google:bob','/api/chat','POST',{message:'hello',is_admin:true});
    fake.headers.set('X-VJBot-Profile','platform_openai'); fake.headers.set('X-VJBot-Admin','true');
    const forged = await worker.fetch(fake,f.env);
    assert.equal(forged.status,400); assert.ok(!(await forged.text()).includes(f.env.OPENAI_API_KEY));
    const stale = f.request('google:bob','/api/tts','POST',{text:'こんにちは'});
    stale.headers.set('X-VJBot-Account','google:alice');
    stale.headers.set('X-VJBot-Profile','platform_openai');
    assert.equal((await worker.fetch(stale,f.env)).status,409);
    await f.env.DB.prepare('INSERT INTO admin_grants VALUES(?,?,?)').bind('google:bob','google:alice','now').run();
    assert.deepEqual((await resolveProvider(f.env,'google:bob')).models,['gpt-4.1-mini']);
    assert.equal((await f.send('google:bob','/api/tts','POST',{text:'こんにちは'})).status,200);
    assert.equal((await selected('google:bob')).status,200);
    await f.env.DB.prepare('DELETE FROM admin_grants WHERE user_id=?').bind('google:bob').run();
    assert.equal(await resolveProvider(f.env,'google:bob'),null);
    assert.equal((await selected('google:bob')).status,403);
    assert.equal((await f.send('google:bob','/api/tts','POST',{text:'こんにちは'})).status,403);
    delete f.env.OPENAI_API_KEY;
    assert.equal(await resolveProvider(f.env,'google:alice'),null);
    const unavailable = await (await f.send('google:alice','/api/ai/settings')).json();
    assert.equal(unavailable.source,'platform'); assert.equal(unavailable.platform.configured,false);
    assert.equal(unavailable.own.id,chat.id);
    const noAI = await f.send('google:alice','/api/chat','POST',{message:'hello'});
    assert.equal(noAI.status,403); assert.equal((await noAI.json()).code,'no_ai');
    const noVoice = await f.send('google:alice','/api/tts','POST',{text:'こんにちは'});
    assert.equal(noVoice.status,403); assert.equal((await noVoice.json()).code,'no_tts');
    assert.equal((await selected('google:alice',{action:'models'})).status,403);
    f.env.OPENAI_API_KEY = 'platform-voice-key-only'; f.env.ADMIN_EMAILS = '';
    assert.equal((await selected('google:alice')).status,403);
    assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは'})).status,403);
    assert.equal((await resolveProvider(f.env,'google:alice')).apiKey,'profile-test-key-1111');
    assert.equal((await resolveProvider(f.env,'google:alice',undefined,'platform_openai')).error,'invalid_connection');
    const revoked=f.request('google:alice','/api/chat','POST',{message:'stale administrator tab'});
    revoked.headers.set('X-VJBot-Profile','platform_openai');
    assert.equal((await worker.fetch(revoked,f.env)).status,400);
    assert.equal((await resolveProvider(f.env,'google:alice',device)).apiKey,device.api_key);
    assert.equal((await resolveProvider(f.env,'google:alice',undefined,chat.id)).apiKey,'profile-test-key-1111');
    assert.equal((await (await f.send('google:alice','/api/ai/settings')).json()).source,'own');
    assert.deepEqual(await f.env.DB.prepare('SELECT * FROM ai_providers WHERE id=?').bind(chat.id).first(),stored);
    assert.equal((await f.view('google:alice')).active_id,chat.id);
    assert.deepEqual(await f.env.DB.prepare('SELECT * FROM ai_antigravity_connections WHERE user_id=?').bind('google:alice').first(),oauth);
    assert.equal((await f.env.DB.prepare('SELECT connection_id FROM ai_active_antigravity WHERE user_id=?').bind('google:alice').first()).connection_id,'stored-login');
    assert.equal(calls,4);
  } finally {globalThis.fetch = previous;}
});

test('official OpenAI voice-only profiles and device credentials stay pinned and cannot become chat or proxy fallback', async () => {
  const f = await fixture(), previous = globalThis.fetch;
  const voice = await f.create('google:alice',{protocol:'openai',base_url:'',model:'',api_key:'owned-openai-voice-key'});
  const chat = await f.create('google:alice',{protocol:'gemini',base_url:'',api_key:'chat-gemini-key'});
  await activate(f.send,'google:alice',chat);
  f.env.OPENAI_API_KEY = 'must-not-borrow-platform-key';
  const pinned = (owner, id = voice.id) => {
    const request = f.request(owner,'/api/tts','POST',{text:'こんにちは'});
    request.headers.set('X-VJBot-Profile',id);
    return worker.fetch(request,f.env);
  };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url,'https://api.openai.com/v1/audio/speech');
    assert.equal(options.headers.Authorization,calls === 1 ? 'Bearer owned-openai-voice-key' : 'Bearer device-openai-voice-key');
    return new Response(new Uint8Array([73,68,51]));
  };
  try {
    assert.equal((await pinned('google:alice')).status,200);
    assert.equal((await pinned('google:bob')).status,409);
    const device = {protocol:'openai',base_url:'',model:'',api_key:'device-openai-voice-key'};
    assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは',api_connection:device})).status,200);
    assert.equal((await f.send('google:alice','/api/chat','POST',{message:'hello',api_connection:device})).status,400);
    for (const base_url of ['https://proxy.example.com/v1','https://api.openai.com/v1/custom','https://api.openai.com:8443/v1']) {
      assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは',api_connection:{...device,base_url}})).status,403);
    }
    await activate(f.send,'google:alice',voice);
    assert.equal((await resolveProvider(f.env,'google:alice')).error,'no_model');
    assert.equal((await f.send('google:alice','/api/tts','POST',{text:'こんにちは'})).status,403);
    await f.send('google:alice','/api/ai/profiles/'+voice.id,'DELETE');
    assert.equal((await pinned('google:alice')).status,409);
    assert.equal(calls,2);
  } finally {globalThis.fetch = previous;}
});
