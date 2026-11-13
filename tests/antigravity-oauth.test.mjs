import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import worker from '../src/worker.js';
import {hashToken} from '../src/auth.js';
import {unseal} from '../src/ai-secrets.js';
import {activateConnection, antigravityProvider, connectionFor, stateOwner} from '../src/antigravity-gateway.js';
import {askAI, resolveSpeechProvider} from '../src/providers.js';
import {speechResponse} from '../src/speech.js';
import {deleteUserData} from '../src/admin.js';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';

const root = '/api/ai/oauth/antigravity';
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('migrations').filter(file => /^\d+.*\.sql$/.test(file)).sort()) sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  const prepare = sql => { let values = []; return {bind(...args) { values = args; return this; }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async all() { return {results:sqlite.prepare(sql).all(...values)}; }, async run() { return sqlite.prepare(sql).run(...values); }}; };
  const DB = {prepare, async batch(rows) { const results = []; for (const row of rows) results.push(await row.run()); return results; }};
  for (const [owner, cookie] of [['alice','a'], ['bob','b']]) await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(cookie.repeat(64)), owner, owner, Date.now() + 600000).run();
  const env = {DB, AI_KEY_SECRET:'synthetic-encryption-secret', ANTIGRAVITY_GATEWAY_URL:'https://gateway.test', ANTIGRAVITY_MANAGEMENT_KEY:'synthetic-management-secret', ANTIGRAVITY_API_KEY:'synthetic-client-secret'};
  const send = (path = '', method = 'GET', data, owner = 'alice', headers = {}) => worker.fetch(new Request('https://vjbot.test' + root + path, {
    method, headers:{Cookie:'vj_session=' + (owner === 'alice' ? 'a' : 'b').repeat(64), Origin:'https://vjbot.test', 'X-VJBot-Account':owner, 'Content-Type':'application/json', ...headers},
    ...(data === undefined ? {} : {body:JSON.stringify(data)})
  }), env);
  const seed = async (owner = 'alice', model = 'gemini-chat', suffix = '') => {
    const id = owner + suffix;
    await DB.prepare('INSERT INTO ai_antigravity_connections(user_id,auth_id,gateway_url,prefix,login_id,model,state,updated_at,name) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(owner, id + '-credential', env.ANTIGRAVITY_GATEWAY_URL, id + '-prefix', id + '-login', model, 'active', Date.now(), 'Account ' + id).run();
    await activateConnection(env, owner, id + '-login');
    return connectionFor(env, owner, id + '-login');
  };
  return {sqlite, DB, env, send, seed};
}

function gateway(f) {
  const state = 'synthetic-state-' + crypto.randomUUID();
  const credentials = new Map(), requests = [], callbacks = [];
  const management = [];
  const control = {strict:true, result:{status:'wait'}, patchFailures:0, deleteFails:false, generationStatus:200, beforeGeneration:null,
    quotaStatus:200, quotaBody:{models:{'gemini-provider-native':{quotaInfo:{remainingFraction:0.5,resetTime:'2026-11-13T00:00:00Z'}}}}};
  const auth = new URL('https://accounts.google.com/o/oauth2/auth');
  auth.search = new URLSearchParams({state, redirect_uri:'http://localhost:51121/oauth-callback', response_type:'code'});
  const fetch = async (raw, options = {}) => {
    const url = new URL(raw), headers = new Headers(options.headers), body = options.body ? JSON.parse(options.body) : null;
    const path = url.pathname.replace('/v8/management', '');
    if (url.origin === 'https://gateway.test' && url.pathname.startsWith('/v8/management/')) {
      assert.equal(headers.get('Authorization'), 'Bearer ' + f.env.ANTIGRAVITY_MANAGEMENT_KEY);
      management.push({path, method:options.method || 'GET', body});
      if (path === '/requests/api-call') {
        assert.equal(options.method, 'POST');
        assert.equal(body.url, 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels');
        assert.equal(body.method, 'POST');
        assert.deepEqual(body.header, {Authorization:'Bearer $TOKEN$', 'Content-Type':'application/json', 'User-Agent':'antigravity/1.19.6 windows/amd64'});
        assert.ok([...credentials.values()].some(value => value.auth_index === body.auth_index && JSON.stringify({project:value.project_id}) === body.data));
        return Response.json({status_code:control.quotaStatus, body:typeof control.quotaBody === 'string' ? control.quotaBody : JSON.stringify(control.quotaBody)});
      }
      if (path === '/config/routing/force-model-prefix') return Response.json(control.strict);
      if (path === '/oauth/auth-url') return Response.json({status:'ok', url:auth.href, state});
      if (path === '/oauth/status') { assert.equal(url.searchParams.get('state'), state); return Response.json(control.result); }
      if (path === '/oauth/session') return Response.json({cancelled:control.result.status === 'wait'});
      if (path === '/oauth/callback') { callbacks.push(body); return Response.json({status:'ok'}); }
      if (path === '/credentials/fields') {
        if (control.patchFailures-- > 0) return new Response('', {status:503});
        const old = credentials.get(body.name); assert.ok(old, 'OAuth result must identify an actual credential');
        credentials.set(body.name, {...old, prefix:body.prefix}); return Response.json({status:'ok'});
      }
      if (path === '/credentials/models') {
        const entry = credentials.get(url.searchParams.get('name'));
        return Response.json({models:entry ? (entry.rawModels || ['gemini-chat','old-model','gemini-3.8-flash-tts'].map(id => ({id:entry.prefix + '/' + id}))) : []});
      }
      if (path === '/credentials' && options.method === 'DELETE') {
        if (control.deleteFails) return new Response('', {status:503});
        if (control.deleteUnconfirmed) return Response.json({status:'error',detail:'private-provider-error'});
        credentials.delete(url.searchParams.get('name')); return Response.json({status:'ok'});
      }
      if (path === '/credentials') return Response.json({files:[...credentials].map(([id, {prefix, ...value}]) => ({id, provider:'antigravity', ...value}))});
    }
    if (url.href === 'https://gateway.test/v1/chat/completions') {
      assert.equal(headers.get('Authorization'), 'Bearer ' + f.env.ANTIGRAVITY_API_KEY);
      assert.equal(options.redirect, 'manual'); requests.push(body);
      if (control.beforeGeneration) await control.beforeGeneration();
      if (control.generationStatus !== 200) return new Response('', {status:control.generationStatus});
      const answer = body.response_format?.json_schema?.name === 'tutor_reply'
        ? JSON.stringify({reply:'何時に始まりますか。', action:'probe', open_probe:'何時に始まりますか。'})
        : 'A real-shaped synthetic answer';
      return body.stream ? new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n', {headers:{'Content-Type':'text/event-stream'}})
        : Response.json({choices:[{message:{content:answer}}]});
    }
    throw new Error('Unexpected upstream destination: ' + url.origin + url.pathname);
  };
  const complete = (id = 'alice-credential') => {
    if (!credentials.has(id)) credentials.set(id, {prefix:''});
    control.result = {status:'ok', saved:true, adopted:true, requires_sign_in:false, auth_id:id};
  };
  return {state, control, credentials, requests, callbacks, management, fetch, complete};
}
async function upstream(g, run) { const original = globalThis.fetch; globalThis.fetch = g.fetch; try { return await run(); } finally { globalThis.fetch = original; } }
const begin = async f => { const response = await f.send('/start', 'POST'); assert.equal(response.status, 200); return response.json(); };

test('OAuth setup stays private; anonymous, stale-account and cross-origin requests cannot start sign-in', async () => {
  const f = await fixture(), g = gateway(f); delete f.env.ANTIGRAVITY_API_KEY;
  await upstream(g, async () => {
    const status = await (await f.send()).json(); assert.equal(status.configured, false);
    assert.equal(JSON.stringify(status).includes(f.env.ANTIGRAVITY_MANAGEMENT_KEY), false);
    assert.equal((await f.send('/start', 'POST')).status, 503);
    assert.equal((await f.send('/start', 'POST', undefined, 'alice', {Origin:'https://elsewhere.test'})).status, 403);
    assert.equal((await f.send('', 'GET', undefined, 'alice', {'X-VJBot-Account':'bob'})).status, 409);
    assert.equal((await worker.fetch(new Request('https://vjbot.test' + root), f.env)).status, 401);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_antigravity_oauth_states').get().n, 0);
  });
});

test('pending authorization is encrypted and bound to the exact account and session', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const started = await begin(f), pending = f.sqlite.prepare('SELECT * FROM ai_antigravity_oauth_states').get();
    assert.equal(pending.state_enc.includes(g.state), false);
    assert.equal(await unseal(f.env, stateOwner('bob'), pending.state_enc), null);
    assert.equal((await f.send('/status', 'POST', {handle:started.handle}, 'bob')).status, 400);
    await f.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken('c'.repeat(64)), 'alice', 'alice', Date.now() + 600000).run();
    assert.equal((await f.send('/status', 'POST', {handle:started.handle}, 'alice', {Cookie:'vj_session=' + 'c'.repeat(64)})).status, 400);
    assert.equal((await f.send('', 'GET', undefined, 'bob')).status, 200);
    assert.equal((await (await f.send('', 'GET', undefined, 'bob')).json()).pending, null);
    assert.equal(await connectionFor(f.env, 'alice'), null);
  });
});

test('completed OAuth binds exactly one credential; replay does not create another connection', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const started = await begin(f); g.complete();
    const response = await f.send('/status', 'POST', {handle:started.handle}); assert.equal(response.status, 200);
    const row = await connectionFor(f.env, 'alice'); assert.equal(row.auth_id, 'alice-credential'); assert.equal(row.model, '');
    assert.equal(g.credentials.get(row.auth_id).prefix, row.prefix);
    assert.equal((await f.send('/status', 'POST', {handle:started.handle})).status, 200);
    assert.equal((await f.send('/status', 'POST', {handle:started.handle}, 'bob')).status, 400);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_antigravity_connections').get().n, 1);
    assert.equal(g.requests.length, 0);
  });
});

test('a failed prefix binding stays closed and can finish safely on the next status poll', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const started = await begin(f); g.complete(); g.control.patchFailures = 1;
    assert.equal((await f.send('/status', 'POST', {handle:started.handle})).status, 503);
    assert.equal((await connectionFor(f.env, 'alice', started.handle)).state, 'binding');
    assert.equal((await antigravityProvider(f.env, 'alice', started.handle)).error, 'oauth_reconnect');
    assert.equal((await f.send('/status', 'POST', {handle:started.handle})).status, 200);
    assert.equal((await connectionFor(f.env, 'alice')).state, 'active');
  });
});

test('a Google account linked to another VJBot user is never rebound or deleted by a new login', async () => {
  const f = await fixture(), g = gateway(f); await f.seed('bob'); g.credentials.set('bob-credential', {prefix:'bob-prefix'});
  await upstream(g, async () => {
    const started = await begin(f); g.complete('bob-credential');
    assert.equal((await f.send('/status', 'POST', {handle:started.handle})).status, 409);
    assert.equal(await connectionFor(f.env, 'alice'), null);
    assert.equal(g.credentials.get('bob-credential').prefix, 'bob-prefix');
    assert.equal((await connectionFor(f.env, 'bob')).state, 'active');
  });
});

test('only one live OAuth session can reserve the upstream callback listener', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const replies = await Promise.all([f.send('/start', 'POST'), f.send('/start', 'POST', undefined, 'bob')]);
    assert.deepEqual(replies.map(response => response.status).sort(), [200,409]);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_antigravity_oauth_states').get().n, 1);
    assert.equal(g.requests.length, 0);
  });
});

test('manual callbacks must match the stored redirect and state; no pasted URL is fetched', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const started = await begin(f);
    assert.equal((await f.send('/callback', 'POST', {handle:started.handle, redirect_url:'https://elsewhere.test/oauth-callback?code=example&state=' + g.state})).status, 400);
    assert.equal((await f.send('/callback', 'POST', {handle:started.handle, redirect_url:'http://localhost:51121/oauth-callback?code=example&state=wrong'})).status, 400);
    assert.equal(g.callbacks.length, 0);
    assert.equal((await f.send('/callback', 'POST', {handle:started.handle, redirect_url:'http://localhost:51121/oauth-callback?code=example&state=' + g.state})).status, 200);
    assert.equal(g.callbacks.length, 1); assert.equal(g.requests.length, 0);
  });
});

test('chat is pinned to the owner prefix; missing accounts never borrow another credential', async () => {
  const f = await fixture(), g = gateway(f); await f.seed(); await f.seed('bob');
  g.credentials.set('alice-credential', {prefix:'alice-prefix'}); g.credentials.set('bob-credential', {prefix:'bob-prefix'});
  await upstream(g, async () => {
    assert.ok((await askAI(f.env, 'alice', {turns:[{role:'user',content:'Hello'}]}, undefined, 'antigravity_oauth:alice-login')).text);
    assert.equal(g.requests[0].model, 'alice-prefix/gemini-chat');
    assert.equal((await antigravityProvider(f.env, 'missing-user', 'alice-login')).error, 'oauth_reconnect');
    g.control.strict = false;
    assert.equal((await antigravityProvider(f.env, 'alice', 'alice-login')).error, 'oauth_reconnect');
    g.control.strict = true; g.credentials.set('alice-credential', {prefix:'bob-prefix'});
    assert.equal((await f.send('/models?connection_id=alice-login')).status, 409);
    assert.equal(g.requests.length, 1);
  });
});

test('catalog membership does not verify access; a failed test preserves the saved model', async () => {
  const f = await fixture(), g = gateway(f); await f.seed('alice', 'old-model'); g.credentials.set('alice-credential', {prefix:'alice-prefix'});
  await upstream(g, async () => {
    const catalog = await (await f.send('/models?connection_id=alice-login')).json();
    assert.deepEqual(catalog.models, ['gemini-chat','old-model']); assert.equal(catalog.verified, false); assert.equal(g.requests.length, 0);
    g.control.generationStatus = 429;
    assert.equal((await f.send('/model', 'PUT', {connection_id:'alice-login',model:'gemini-chat'})).status, 429);
    assert.equal((await connectionFor(f.env, 'alice')).model, 'old-model');
    assert.equal((await f.send('/model', 'PUT', {connection_id:'alice-login',model:'unknown-model'})).status, 409);
    assert.equal(g.requests.length, 1);
  });
});

test('only visible text saves a choice; an old successful probe cannot overwrite a replacement', async () => {
  const f = await fixture(), g = gateway(f); await f.seed('alice', 'old-model'); g.credentials.set('alice-credential', {prefix:'alice-prefix'});
  await upstream(g, async () => {
    assert.equal((await f.send('/model', 'PUT', {connection_id:'alice-login',model:'gemini-chat'})).status, 200);
    assert.equal((await connectionFor(f.env, 'alice')).model, 'gemini-chat');
    g.control.beforeGeneration = () => f.DB.prepare("UPDATE ai_antigravity_connections SET prefix='replacement-prefix',model='old-model' WHERE user_id='alice'").run();
    assert.equal((await f.send('/model', 'PUT', {connection_id:'alice-login',model:'gemini-chat'})).status, 409);
    assert.equal((await connectionFor(f.env, 'alice')).model, 'old-model');
  });
});

test('failed disconnect keeps a closed ownership record; retry removes only that account', async () => {
  const f = await fixture(), g = gateway(f); await f.seed(); await f.seed('bob');
  g.credentials.set('alice-credential', {prefix:'alice-prefix'}); g.credentials.set('bob-credential', {prefix:'bob-prefix'});
  await upstream(g, async () => {
    g.control.deleteFails = true; assert.equal((await f.send('', 'DELETE', {connection_id:'alice-login'})).status, 503);
    assert.equal((await connectionFor(f.env, 'alice')).state, 'disconnecting');
    assert.equal((await antigravityProvider(f.env, 'alice', 'alice-login')).error, 'oauth_reconnect');
    g.control.deleteFails = false; assert.equal((await f.send('', 'DELETE', {connection_id:'alice-login'})).status, 200);
    assert.equal(await connectionFor(f.env, 'alice'), null); assert.ok(await connectionFor(f.env, 'bob'));
    assert.equal(g.credentials.has('alice-credential'), false); assert.equal(g.credentials.has('bob-credential'), true);
  });
});

test('account deletion removes its gateway credential first and preserves the other account', async () => {
  const f = await fixture(), g = gateway(f); await f.seed(); await f.seed('bob');
  g.credentials.set('alice-credential', {prefix:'alice-prefix'}); g.credentials.set('bob-credential', {prefix:'bob-prefix'});
  await upstream(g, async () => {
    await deleteUserData(f.env, 'alice');
    assert.equal(await connectionFor(f.env, 'alice'), null); assert.ok(await connectionFor(f.env, 'bob'));
    assert.equal(g.credentials.has('alice-credential'), false); assert.equal(g.credentials.has('bob-credential'), true);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM sessions WHERE user_id='alice'").get().n, 0);
  });
});

test('Antigravity cannot be used as a TTS credential; Gemini read-aloud keeps its explicit API key', async () => {
  const f = await fixture(), g = gateway(f); let voiceCalls = 0;
  const originalFetch = g.fetch;
  g.fetch = async (url, options) => {
    if (new URL(url).hostname !== 'generativelanguage.googleapis.com') return originalFetch(url, options);
    voiceCalls++; const headers = new Headers(options.headers), body = JSON.parse(options.body);
    assert.equal(headers.get('x-goog-api-key'), 'synthetic-voice-key'); assert.equal(headers.has('Authorization'), false);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
    return Response.json({candidates:[{content:{parts:[{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]}}]});
  };
  await upstream(g, async () => {
    assert.equal((await resolveSpeechProvider(f.env, 'alice', undefined, 'antigravity_oauth:alice-login')).response.status, 403);
    const response = await speechResponse({text:'こんにちは。Xin chào.'}, 'synthetic-voice-key'); assert.equal(response.status, 200);
    assert.equal((await response.json()).model, 'gemini-3.8-flash-tts'); assert.equal(voiceCalls, 1); assert.equal(g.requests.length, 0);
  });
});

test('identity-less legacy OAuth success never claims a credential from the gateway catalog', async () => {
  const f = await fixture(), g = gateway(f);
  g.credentials.set('alice-credential', {prefix:''});
  await upstream(g, async () => {
    const started = await begin(f);
    g.control.result = {status:'ok'};
    assert.equal((await f.send('/status', 'POST', {handle:started.handle})).status, 409);
    assert.equal(await connectionFor(f.env, 'alice'), null);
    assert.equal(g.credentials.get('alice-credential').prefix, '');
    assert.equal(g.requests.length, 0);
  });
});

test('saved OAuth credentials wait for runtime adoption without rebinding or generating', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const started = await begin(f); g.complete(); g.control.result = {...g.control.result, adopted:false};
    const waiting = await f.send('/status', 'POST', {handle:started.handle});
    assert.equal(waiting.status, 200); assert.equal((await waiting.json()).status, 'wait');
    assert.equal(await connectionFor(f.env, 'alice'), null);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_antigravity_oauth_states').get().n, 1);
    g.control.result = {...g.control.result, adopted:true};
    assert.equal((await f.send('/status', 'POST', {handle:started.handle})).status, 200);
    assert.equal((await connectionFor(f.env, 'alice')).state, 'active');
    assert.equal(g.requests.length, 0);
  });
});

test('cancelling a saved unadopted login removes that credential rather than leaving tokens behind', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const started = await begin(f); g.complete(); g.control.result = {...g.control.result, adopted:false};
    assert.equal((await f.send('/cancel', 'POST', {handle:started.handle})).status, 200);
    assert.equal(g.credentials.has('alice-credential'), false);
    assert.equal(await connectionFor(f.env, 'alice'), null);
    assert.equal(g.requests.length, 0);
  });
});

test('completed connection survives a new session for the same account without another Google login', async () => {
  const f = await fixture(), g = gateway(f);
  await f.seed(); g.credentials.set('alice-credential', {prefix:'alice-prefix'});
  await upstream(g, async () => {
    await f.DB.prepare("DELETE FROM sessions WHERE user_id='alice'").run();
    assert.equal((await f.send()).status, 401);
    await f.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
      .bind(await hashToken('c'.repeat(64)), 'alice', 'alice', Date.now() + 600000).run();
    const response = await f.send('', 'GET', undefined, 'alice', {Cookie:'vj_session=' + 'c'.repeat(64)});
    assert.equal(response.status, 200);
    const connection = await response.json();
    assert.equal(connection.connected, true); assert.equal(connection.model, 'gemini-chat');
    assert.equal((await (await f.send('', 'GET', undefined, 'bob')).json()).connected, false);
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM ai_antigravity_oauth_states').get().n, 0);
    assert.equal(g.requests.length, 0);
  });
});

test('account migration preserves legacy identity, selected model and active choice with foreign keys enabled', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync('migrations').filter(file => /^\d+.*\.sql$/.test(file) && file < '0018').sort()) sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  const legacy = ['alice','private-file.json','https://gateway.test','unchanged-prefix','opaque-login','saved-model','active',1234];
  sqlite.prepare('INSERT INTO ai_antigravity_connections VALUES(?,?,?,?,?,?,?,?)').run(...legacy);
  sqlite.exec(readFileSync('migrations/0018_antigravity_accounts.sql', 'utf8'));
  const row = sqlite.prepare('SELECT * FROM ai_antigravity_connections').get();
  assert.deepEqual([row.user_id,row.auth_id,row.gateway_url,row.prefix,row.login_id,row.model,row.state,row.updated_at], legacy);
  assert.equal(row.name, 'Antigravity account');
  assert.equal(sqlite.prepare('SELECT connection_id FROM ai_active_antigravity WHERE user_id=?').get('alice').connection_id, 'opaque-login');
  sqlite.prepare('INSERT INTO ai_antigravity_connections(user_id,auth_id,gateway_url,prefix,login_id,state,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('alice','second-file','https://gateway.test','second-prefix','second-login','active',1235);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM ai_antigravity_connections WHERE user_id=?').get('alice').n, 2);
  for (const values of [
    ['bob','private-file.json','unique-prefix','unique-login'],
    ['bob','unique-auth','unchanged-prefix','unique-login'],
    ['bob','unique-auth','unique-prefix','opaque-login']
  ]) assert.throws(() => sqlite.prepare('INSERT INTO ai_antigravity_connections(user_id,auth_id,prefix,login_id,gateway_url,state,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run(...values,'https://gateway.test','active',1236), /UNIQUE/);
  assert.throws(() => sqlite.prepare('INSERT INTO ai_active_antigravity VALUES(?,?)').run('bob','opaque-login'), /FOREIGN KEY/);
  sqlite.close();
});

test('two completed Google accounts persist for one owner without replacing the previous model or identity', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    const first = await begin(f); g.complete('first-credential');
    assert.equal((await (await f.send('/status', 'POST', {handle:first.handle})).json()).connection_id, first.handle);
    assert.equal((await f.send('/model', 'PUT', {connection_id:first.handle,model:'old-model'})).status, 200);
    g.control.result = {status:'wait'};
    const response = await f.send('/start', 'POST', {name:'Second Google account'});
    assert.equal(response.status, 200);
    const second = await response.json(); g.complete('second-credential');
    const completed = await (await f.send('/status', 'POST', {handle:second.handle})).json();
    assert.equal(completed.connection_id, second.handle);
    const status = await (await f.send()).json();
    assert.equal(status.connections.length, 2); assert.equal(status.active_id, second.handle);
    assert.equal(status.connections.find(row => row.id === second.handle).name, 'Second Google account');
    const firstRow = await connectionFor(f.env, 'alice', first.handle);
    assert.equal(firstRow.model, 'old-model'); assert.equal(firstRow.auth_id, 'first-credential');
    assert.equal(g.credentials.get(firstRow.auth_id).prefix, firstRow.prefix);
    assert.equal(status.model, ''); assert.equal(g.requests.length, 1);
    const serialized = JSON.stringify(status);
    for (const privateValue of ['first-credential','second-credential',firstRow.prefix,f.env.ANTIGRAVITY_GATEWAY_URL]) assert.equal(serialized.includes(privateValue), false);
    await f.DB.prepare("DELETE FROM sessions WHERE user_id='alice'").run();
    await f.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken('c'.repeat(64)), 'alice', 'alice', Date.now() + 600000).run();
    const restored = await (await f.send('', 'GET', undefined, 'alice', {Cookie:'vj_session=' + 'c'.repeat(64)})).json();
    assert.equal(restored.active_id, second.handle); assert.equal(restored.connections.length, 2);
  });
});

test('activation is persisted and entirely local; explicit inference ignores later active selection changes', async () => {
  const f = await fixture(), g = gateway(f);
  const first = await f.seed('alice', 'old-model'), second = await f.seed('alice', 'old-model', '-two');
  g.credentials.set(first.auth_id, {prefix:first.prefix}); g.credentials.set(second.auth_id, {prefix:second.prefix});
  await upstream(g, async () => {
    assert.equal((await f.send('/connections/' + first.login_id + '/activate', 'POST')).status, 200);
    assert.equal((await connectionFor(f.env, 'alice')).login_id, first.login_id);
    assert.equal(g.management.length, 0); assert.equal(g.requests.length, 0);
    assert.equal((await f.send('/connections/' + second.login_id + '/activate', 'POST')).status, 200);
    assert.equal(g.management.length, 0);
    assert.ok((await askAI(f.env, 'alice', {turns:[{role:'user',content:'Hi'}]}, undefined, 'antigravity_oauth:' + first.login_id)).text);
    assert.equal(g.requests[0].model, first.prefix + '/old-model');
    assert.equal((await f.send('/model', 'PUT', {connection_id:first.login_id,model:'gemini-chat'})).status, 200);
    assert.equal((await connectionFor(f.env, 'alice', first.login_id)).model, 'gemini-chat');
    assert.equal((await connectionFor(f.env, 'alice')).login_id, second.login_id);
    assert.equal((await connectionFor(f.env, 'alice', second.login_id)).model, 'old-model');
    const request = new Request('https://vjbot.test/api/ai/test', {method:'POST',
      headers:{Cookie:'vj_session=' + 'a'.repeat(64), Origin:'https://vjbot.test', 'X-VJBot-Profile':'antigravity_oauth:' + first.login_id},
      body:'{}'});
    assert.equal((await worker.fetch(request, f.env)).status, 200);
    assert.equal(g.requests.at(-1).model, first.prefix + '/gemini-chat');
  });
});

test('removal is scoped, failed removal stays closed, and deleting the active account never rotates to another', async () => {
  const f = await fixture(), g = gateway(f);
  const first = await f.seed(), second = await f.seed('alice','old-model','-two'), third = await f.seed('alice','gemini-chat','-three');
  for (const row of [first,second,third]) g.credentials.set(row.auth_id, {prefix:row.prefix});
  await upstream(g, async () => {
    g.control.deleteFails = true;
    assert.equal((await f.send('', 'DELETE', {connection_id:first.login_id})).status, 503);
    assert.equal((await connectionFor(f.env, 'alice', first.login_id)).state, 'disconnecting');
    assert.equal((await connectionFor(f.env, 'alice')).login_id, third.login_id);
    assert.equal((await f.send('/connections/' + first.login_id + '/activate', 'POST')).status, 409);
    assert.equal((await antigravityProvider(f.env, 'alice', first.login_id)).error, 'oauth_reconnect');
    g.control.deleteFails = false;
    assert.equal((await f.send('', 'DELETE', {connection_id:first.login_id})).status, 200);
    assert.equal((await connectionFor(f.env, 'alice')).login_id, third.login_id);
    assert.equal((await f.send('', 'DELETE', {connection_id:third.login_id})).status, 200);
    const status = await (await f.send()).json();
    assert.equal(status.active_id, null); assert.equal(status.connected, false);
    assert.deepEqual(status.connections.map(row => row.id), [second.login_id]);
    assert.equal(g.credentials.has(second.auth_id), true);
    assert.equal((await askAI(f.env, 'alice', {turns:[]}, undefined, 'antigravity_oauth:' + third.login_id)).response.status, 409);
    assert.equal(g.requests.length, 0);
  });
});

test('every explicit connection operation rejects another owner without touching the gateway', async () => {
  const f = await fixture(), g = gateway(f); const bob = await f.seed('bob');
  await f.seed();
  await upstream(g, async () => {
    assert.equal((await f.send('/models?connection_id=' + bob.login_id)).status, 404);
    assert.equal((await f.send('/usage?connection_id=' + bob.login_id)).status, 404);
    assert.equal((await f.send('/connections/' + bob.login_id + '/activate', 'POST')).status, 404);
    assert.equal((await f.send('/model', 'PUT', {connection_id:bob.login_id,model:'gemini-chat'})).status, 404);
    assert.equal((await f.send('', 'DELETE', {connection_id:bob.login_id})).status, 404);
    assert.equal((await askAI(f.env, 'alice', {turns:[]}, undefined, 'antigravity_oauth:' + bob.login_id)).response.status, 409);
    assert.deepEqual((await (await f.send()).json()).connections.map(row => row.id), ['alice-login']);
    assert.equal(g.management.length, 0); assert.equal(g.requests.length, 0);
  });
});

test('ambiguous, malformed and missing OAuth IDs never borrow an active connection or API profile', async () => {
  const f = await fixture(), g = gateway(f); await f.seed();
  await upstream(g, async () => {
    for (const id of ['antigravity_oauth','antigravity_oauth:','antigravity_oauth:alice/login','antigravity_oauth:alice-login:other','antigravity_oauth:' + 'x'.repeat(129)]) {
      assert.equal((await askAI(f.env, 'alice', {turns:[]}, undefined, id)).response.status, 400);
    }
    assert.equal((await askAI(f.env, 'alice', {turns:[]}, {protocol:'gemini'}, 'antigravity_oauth:alice-login')).response.status, 400);
    assert.equal((await antigravityProvider(f.env, 'alice')).error, 'oauth_reconnect');
    assert.equal((await f.send('/models')).status, 400);
    assert.equal((await f.send('/usage')).status, 400);
    assert.equal((await f.send('/model', 'PUT', {model:'gemini-chat'})).status, 400);
    assert.equal((await f.send('', 'DELETE')).status, 400);
    assert.equal(g.management.length, 0); assert.equal(g.requests.length, 0);
    assert.equal((await connectionFor(f.env, 'alice')).login_id, 'alice-login');
  });
});

test('quota uses only owned gateway metadata and preserves native IDs, exact zero and unknown values', async () => {
  const f = await fixture(), g = gateway(f), row = await f.seed();
  g.credentials.set(row.auth_id, {prefix:row.prefix,auth_index:'private-index',project_id:'private-project'});
  g.control.quotaBody = {token:'private-token',project:'private-project',models:{
    'gemini-native-tiered':{quotaInfo:{remainingFraction:0,resetTime:'2020-01-01T00:00:00Z'},token:'private-token'},
    'unknown-native':{quotaInfo:{resetTime:'invalid'}},
    'string-fraction':{quotaInfo:{remainingFraction:'0'}},
    'negative-fraction':{quotaInfo:{remainingFraction:-0.2}},
    'excess-fraction':{quotaInfo:{remainingFraction:2}},
    'bad-model<script>':{quotaInfo:{remainingFraction:0.5}},
    'full-native':{quotaInfo:{remainingFraction:1,resetTime:'2026-11-13T00:00:00Z'}},
    'invalid-calendar':{quotaInfo:{remainingFraction:0.25,resetTime:'2026-02-30T00:00:00Z'}}
  }};
  await upstream(g, async () => {
    const response = await f.send('/usage?connection_id=' + row.login_id + '&url=https://elsewhere.test&auth_index=attacker&project=attacker');
    assert.equal(response.status, 200);
    const usage = await response.json(), byId = Object.fromEntries(usage.models.map(model => [model.model,model]));
    assert.equal(usage.connection_id, row.login_id); assert.equal(usage.available, true);
    assert.ok(Number.isFinite(Date.parse(usage.checked_at)));
    assert.equal(byId['gemini-native-tiered'].remaining_fraction, 0);
    assert.equal(byId['gemini-native-tiered'].reset_at, '2020-01-01T00:00:00Z');
    assert.equal(byId['unknown-native'].remaining_fraction, null); assert.equal(byId['unknown-native'].reset_at, null);
    for (const id of ['string-fraction','negative-fraction','excess-fraction']) assert.equal(byId[id].remaining_fraction, null);
    assert.equal(byId['full-native'].remaining_fraction, 1); assert.equal(byId['bad-model<script>'], undefined);
    assert.equal(byId['invalid-calendar'].reset_at, null);
    assert.equal(byId['gemini-chat'], undefined);
    const serialized = JSON.stringify(usage);
    for (const value of ['private-token','private-index','private-project',row.auth_id,row.prefix,'Bearer']) assert.equal(serialized.includes(value), false);
    const call = g.management.find(request => request.path === '/requests/api-call');
    assert.equal(call.body.auth_index, 'private-index'); assert.deepEqual(JSON.parse(call.body.data), {project:'private-project'});
    g.control.quotaBody = {models:{'zero-only':{quotaInfo:{remainingFraction:0}}}};
    const zero = await (await f.send('/usage?connection_id=' + row.login_id)).json();
    assert.equal(zero.available, true); assert.equal(zero.models[0].remaining_fraction, 0);
    assert.equal(g.management.some(request => request.path === '/credentials/models'), false);
    assert.equal(g.requests.length, 0);
  });
});

test('quota errors, missing signals, malformed and oversized replies remain sanitized unknown, never zero', async () => {
  const f = await fixture(), g = gateway(f), row = await f.seed();
  g.credentials.set(row.auth_id, {prefix:row.prefix,auth_index:'private-index',project_id:'private-project'});
  await upstream(g, async () => {
    for (const [status,body] of [
      [403,'private-provider-error-token'],
      [200,'not JSON private-provider-error'],
      [200,{models:{'unknown-native':{quotaInfo:{}}}}],
      [200,{models:[]}],
      [200,{models:Object.fromEntries(Array.from({length:1001}, (_,i) => ['model-' + i,{}]))}],
      [200,'x'.repeat(1048577)]
    ]) {
      g.control.quotaStatus = status; g.control.quotaBody = body;
      const response = await f.send('/usage?connection_id=' + row.login_id);
      assert.equal(response.status, 200);
      const usage = await response.json();
      assert.equal(usage.available, false);
      assert.ok(usage.models.every(model => model.remaining_fraction === null));
      assert.equal(JSON.stringify(usage).includes('private-'), false);
    }
    g.credentials.set(row.auth_id, {prefix:row.prefix});
    const before = g.management.filter(request => request.path === '/requests/api-call').length;
    assert.equal((await (await f.send('/usage?connection_id=' + row.login_id)).json()).available, false);
    assert.equal(g.management.filter(request => request.path === '/requests/api-call').length, before);
    assert.equal(g.requests.length, 0);
  });
});

test('quota respects explicit IDs rather than the active account and shares the existing per-owner limiter', async () => {
  const f = await fixture(), g = gateway(f), first = await f.seed(), second = await f.seed('alice','old-model','-two');
  g.credentials.set(first.auth_id, {prefix:first.prefix,auth_index:'first-index',project_id:'first-project'});
  g.credentials.set(second.auth_id, {prefix:second.prefix,auth_index:'second-index',project_id:'second-project'});
  await upstream(g, async () => {
    assert.equal((await f.send('/usage?connection_id=' + first.login_id)).status, 200);
    assert.equal(g.management.find(request => request.path === '/requests/api-call').body.auth_index, 'first-index');
    const bucket = Math.floor(Date.now() / 60000);
    await f.DB.prepare('INSERT OR REPLACE INTO ai_usage(user_id,bucket,count) VALUES(?,?,?)').bind('alice', bucket, 20).run();
    const before = g.management.length;
    assert.equal((await f.send('/usage?connection_id=' + second.login_id)).status, 429);
    assert.equal(g.management.length, before); assert.equal(g.requests.length, 0);
  });
});

test('names, request bodies and saved-account counts are bounded before new provider work', async () => {
  const f = await fixture(), g = gateway(f);
  await upstream(g, async () => {
    for (const name of ['', ' ', 'x'.repeat(81), 'name\ncontrol', 12]) assert.equal((await f.send('/start', 'POST', {name})).status, 400);
    assert.equal((await f.send('/start', 'POST', {name:'x'.repeat(8193)})).status, 413);
    assert.equal(g.management.length, 0);
    for (let i = 0; i < 20; i++) await f.seed('alice','gemini-chat','-' + i);
    assert.equal((await f.send('/start', 'POST')).status, 409);
    await assert.rejects(f.seed('alice','gemini-chat','-overflow'), /account limit/);
    assert.equal((await (await f.send()).json()).connections.length, 20);
    assert.equal(g.management.length, 0);
  });
});

test('same-owner provider login reuses its stable saved ID and cancellation cannot delete another saved login', async () => {
  const f = await fixture(), g = gateway(f), row = await f.seed('alice','old-model');
  g.credentials.set(row.auth_id, {prefix:row.prefix});
  await upstream(g, async () => {
    const started = await begin(f); g.complete(row.auth_id);
    const result = await (await f.send('/status', 'POST', {handle:started.handle})).json();
    assert.equal(result.connection_id, row.login_id);
    const saved = await connectionFor(f.env, 'alice');
    assert.equal(saved.model, 'old-model'); assert.equal(saved.prefix, row.prefix); assert.equal(saved.name, row.name);
    assert.equal((await (await f.send()).json()).connections.length, 1);
    g.control.result = {status:'wait'};
    const pending = await begin(f); g.complete(row.auth_id); g.control.result.adopted = false;
    assert.equal((await f.send('/cancel', 'POST', {handle:pending.handle})).status, 200);
    assert.ok(g.credentials.has(row.auth_id));
    assert.equal((await connectionFor(f.env, 'alice')).login_id, row.login_id);
    assert.equal(g.requests.length, 0);
  });
});

test('model CAS rejects a stale probe for the same saved identity without overwriting a newer model', async () => {
  const f = await fixture(), g = gateway(f), row = await f.seed('alice','old-model');
  g.credentials.set(row.auth_id, {prefix:row.prefix});
  await upstream(g, async () => {
    g.control.beforeGeneration = () => f.DB.prepare('UPDATE ai_antigravity_connections SET model=?,updated_at=updated_at+1 WHERE user_id=? AND login_id=?')
      .bind('old-model', 'alice', row.login_id).run();
    assert.equal((await f.send('/model', 'PUT', {connection_id:row.login_id,model:'gemini-chat'})).status, 409);
    assert.equal((await connectionFor(f.env, 'alice', row.login_id)).model, 'old-model');
    assert.equal(g.requests.length, 1);
  });
});

test('provider failure never rotates to another saved account and admin deletion removes every owned account only', async () => {
  const f = await fixture(), g = gateway(f), first = await f.seed(), second = await f.seed('alice','old-model','-two'), bob = await f.seed('bob');
  for (const row of [first,second,bob]) g.credentials.set(row.auth_id, {prefix:row.prefix});
  await upstream(g, async () => {
    g.control.generationStatus = 429;
    assert.equal((await askAI(f.env, 'alice', {turns:[{role:'user',content:'Hi'}]}, undefined, 'antigravity_oauth:' + first.login_id)).response.status, 429);
    assert.equal(g.requests.length, 1); assert.equal(g.requests[0].model, first.prefix + '/gemini-chat');
    assert.equal((await connectionFor(f.env, 'alice')).login_id, second.login_id);
    await deleteUserData(f.env, 'alice');
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM ai_antigravity_connections WHERE user_id='alice'").get().n, 0);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM ai_active_antigravity WHERE user_id='alice'").get().n, 0);
    assert.equal(g.credentials.has(first.auth_id), false); assert.equal(g.credentials.has(second.auth_id), false);
    assert.ok(g.credentials.has(bob.auth_id)); assert.ok(await connectionFor(f.env, 'bob'));
  });
});

test('gateway configuration refuses a shared management and inference key', async () => {
  const f = await fixture(), g = gateway(f);
  f.env.ANTIGRAVITY_API_KEY = f.env.ANTIGRAVITY_MANAGEMENT_KEY;
  await upstream(g, async () => {
    assert.equal((await (await f.send()).json()).configured, false);
    assert.equal((await f.send('/start', 'POST')).status, 503);
    assert.equal(g.management.length, 0); assert.equal(g.requests.length, 0);
  });
});

test('removing a partially bound login clears its pending handle so a later status cannot resurrect it', async () => {
  const f = await fixture(), g = gateway(f), previous = await f.seed();
  g.credentials.set(previous.auth_id, {prefix:previous.prefix});
  await upstream(g, async () => {
    const pending = await begin(f); g.complete('second-credential'); g.control.patchFailures = 1;
    assert.equal((await f.send('/status', 'POST', {handle:pending.handle})).status, 503);
    assert.equal((await f.send('', 'DELETE', {connection_id:pending.handle})).status, 200);
    assert.equal((await f.send('/status', 'POST', {handle:pending.handle})).status, 400);
    assert.equal(await connectionFor(f.env, 'alice', pending.handle), null);
    assert.equal((await connectionFor(f.env, 'alice')).login_id, previous.login_id);
    assert.equal(g.credentials.has('second-credential'), false);
    assert.ok(g.credentials.has(previous.auth_id)); assert.equal(g.requests.length, 0);
  });
});

test('an unconfirmed gateway deletion cannot release the saved ownership record', async () => {
  const f = await fixture(), g = gateway(f), row = await f.seed();
  g.credentials.set(row.auth_id, {prefix:row.prefix}); g.control.deleteUnconfirmed = true;
  await upstream(g, async () => {
    const response = await f.send('', 'DELETE', {connection_id:row.login_id});
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(await response.json()).includes('private-provider-error'), false);
    assert.equal((await connectionFor(f.env, 'alice', row.login_id)).state, 'disconnecting');
    assert.ok(g.credentials.has(row.auth_id)); assert.equal(g.requests.length, 0);
  });
});

test('structured tutor chat pins its OAuth account and fences completed retries across selections', async () => {
  const f = await fixture(), g = gateway(f), catalogs = await buildTeacherCatalog();
  await f.seed(); await f.seed('bob');
  g.credentials.set('alice-credential', {prefix:'alice-prefix'});
  g.credentials.set('bob-credential', {prefix:'bob-prefix'});
  f.env.ASSETS = {fetch: async request => {
    const level = new URL(request.url).pathname.match(/^\/course\/teacher-(N[1-5])\.json$/)?.[1];
    return level ? Response.json(catalogs[level]) : new Response('Not found', {status:404});
  }};
  const body = {message:'Em muốn học cách nói giờ bắt đầu công việc.', request_id:crypto.randomUUID()};
  const send = (profileId, requestBody = body) => worker.fetch(new Request('https://vjbot.test/api/chat', {
    method:'POST', headers:{Cookie:'vj_session=' + 'a'.repeat(64), Origin:'https://vjbot.test',
      'Content-Type':'application/json', 'X-VJBot-Account':'alice', 'X-VJBot-Profile':profileId},
    body:JSON.stringify(requestBody)
  }), f.env);
  await upstream(g, async () => {
    const response = await send('antigravity_oauth:alice-login');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.reply, '何時に始まりますか。');
    assert.equal(data.action, undefined);
    assert.equal(data.open_probe, undefined);
    assert.equal((await send('antigravity_oauth:alice-login')).status, 200);
    assert.equal((await send('antigravity_oauth:bob-login')).status, 409);
    assert.equal((await send('antigravity_oauth:bob-login', {...body, request_id:crypto.randomUUID()})).status, 409);
    assert.equal(g.requests.length, 1);
    assert.equal(g.requests[0].model, 'alice-prefix/gemini-chat');
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM conversations WHERE user_id='alice'").get().n, 2);
    assert.equal(f.sqlite.prepare("SELECT count(*) n FROM tutor_sessions WHERE user_id='bob'").get().n, 0);
  });
});
