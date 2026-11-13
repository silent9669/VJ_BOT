import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const source = readFileSync('static/api-profiles.js', 'utf8');
const owner = 'google:learner', other = 'google:other';
const draft = () => ({name: 'Personal', protocol: 'openai', base_url: '', model: 'gpt-example', api_key: 'synthetic-key-one'});
const plain = value => JSON.parse(JSON.stringify(value));

// This fixture covers our small IDB surface, not browser transaction/clone compatibility.
// The parent browser check must exercise native IndexedDB, CryptoKey reload and quota failures.
function database() {
  const stores = new Map();
  const db = {
    objectStoreNames: {contains: name => stores.has(name)},
    createObjectStore(name) {
      stores.set(name, new Map());
      return {createIndex() {}};
    },
    close() {},
    transaction(names, mode) {
      let pending = 0, finished = false, aborted = false;
      const tx = {abort() {aborted = true; setImmediate(() => tx.onabort?.());}};
      const finish = () => setImmediate(() => {
        if (!pending && !finished && !aborted) {finished = true; tx.oncomplete?.();}
      });
      const request = fn => {
        const req = {}; pending++;
        setImmediate(() => {
          if (aborted) return;
          try {req.result = structuredClone(fn()); req.onsuccess?.();}
          catch (error) {req.error = error; req.onerror?.(); tx.abort();}
          pending--; finish();
        });
        return req;
      };
      tx.objectStore = name => {
        const store = stores.get(name), keyOf = value => JSON.stringify(name === 'keys' ? value.owner : [value.owner, value.id]);
        return {
          get: key => request(() => store.get(JSON.stringify(key))),
          put: value => request(() => {store.set(keyOf(value), structuredClone(value));}),
          delete: key => request(() => {store.delete(JSON.stringify(key));}),
          index: () => ({getAll: account => request(() => [...store.values()].filter(row => row.owner === account))})
        };
      };
      finish();
      return tx;
    }
  };
  let created = false;
  return {stores, open() {
    const req = {};
    setImmediate(() => {req.result = db; if (!created) {created = true; req.onupgradeneeded?.();} req.onsuccess?.();});
    return req;
  }};
}
function browser({idb = database(), storage = new Map(), brokenStorage = false} = {}) {
  const events = new EventTarget();
  const context = vm.createContext({crypto: webcrypto, URL, Headers, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    Event, addEventListener:events.addEventListener.bind(events), dispatchEvent:events.dispatchEvent.bind(events),
    indexedDB: idb, location: {href: 'https://tutor.example/settings', origin: 'https://tutor.example'},
    localStorage: {
      getItem(key) {if (brokenStorage) throw new Error('private details'); return storage.get(key) ?? null;},
      setItem(key, value) {if (brokenStorage) throw new Error('private details'); storage.set(key, value);},
      removeItem(key) {if (brokenStorage) throw new Error('private details'); storage.delete(key);}
    }});
  context.window = context;
  vm.runInContext(source, context);
  return {api: context.VJProfiles, context, idb, storage};
}

test('saves encrypted credentials, public metadata, and reloads the same account key', async () => {
  const b = browser(), profile = await b.api.save(owner, draft());
  assert.equal(profile.api_key, undefined);
  assert.equal(profile.key_last4, '-one');
  assert.equal(profile.base_url, 'https://api.openai.com/v1');
  const stored = [...b.idb.stores.get('profiles').values()][0];
  assert.equal(stored.api_key, undefined);
  assert.equal(JSON.stringify(stored).includes(draft().api_key), false);
  const key = [...b.idb.stores.get('keys').values()][0].key;
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, 'AES-GCM');
  const reloaded = browser({idb: b.idb, storage: b.storage});
  assert.equal((await reloaded.api.load(owner, profile.id)).api_key, draft().api_key);
  assert.equal((await reloaded.api.list(owner)).length, 1);
  assert.equal(b.storage.size, 0);
});

test('normalizes supported defaults and endpoint suffixes without network access', async () => {
  const b = browser();
  for (const [protocol, base_url, expected] of [
    ['openai', 'https://API.EXAMPLE/v1/chat/completions/', 'https://api.example/v1'],
    ['anthropic', 'https://api.example/v1/messages', 'https://api.example'],
    ['gemini', 'https://api.example/v1beta/', 'https://api.example'],
    ['anthropic', '', 'https://api.anthropic.com'],
    ['gemini', '', 'https://generativelanguage.googleapis.com']
  ]) assert.equal((await b.api.save(owner, {...draft(), protocol, base_url})).base_url, expected);
});

test('rejects invalid inputs and public URL violations before opening storage', async () => {
  const b = browser({idb: undefined});
  for (const changes of [{name: ''}, {name: 'x'.repeat(81)}, {protocol: '__proto__'}, {model: 'bad model'},
    {api_key: 'short'}, {api_key: null}, {base_url: 7},
    ...['http://api.example', 'https://localhost', 'https://127.0.0.1', 'https://2130706433',
      'https://[::1]', 'https://service.internal', 'https://x.workers.dev', 'https://x.dangphuc.me',
      'https://user:pass@api.example', 'https://api.example?token=secret', 'https://api.example/#fragment'].map(base_url => ({base_url}))]) {
    await assert.rejects(b.api.save(owner, {...draft(), ...changes}), /Invalid|HTTPS|public|key/i);
  }
  await assert.rejects(b.api.save('', draft()), /account/i);
});

test('supports saving before discovery but fails closed before choosing a model', async () => {
  const b = browser(), profile = await b.api.save(owner, {...draft(), model: ''});
  assert.equal(profile.model, '');
  assert.equal(profile.connection_id, null);
  assert.deepEqual(plain(profile.models), []);
  assert.equal(profile.checked_at, null);
  b.api.setActive(owner, {scope: 'local', id: profile.id});
  await assert.rejects(b.api.prepareRequest('/api/chat', {method: 'POST', body: '{}'}, owner), /choose|check.*model/i);
});

test('isolates accounts and profiles; another account cannot overwrite an id', async () => {
  const b = browser(), profile = await b.api.save(owner, draft());
  assert.deepEqual(plain(await b.api.list(other)), []);
  await assert.rejects(b.api.load(other, profile.id), /unavailable/i);
  await assert.rejects(b.api.save(other, {...draft(), id: profile.id}), /unavailable/i);
  await b.api.remove(other, profile.id);
  assert.equal((await b.api.load(owner, profile.id)).api_key, draft().api_key);
});

test('blank key preserves only the exact normalized connection, every save has fresh IV', async () => {
  const b = browser(), profile = await b.api.save(owner, draft());
  const iv = [...b.idb.stores.get('profiles').values()][0].iv.slice();
  await b.api.save(owner, {...profile, name: 'Renamed', api_key: '', base_url: profile.base_url + '/chat/completions/'});
  assert.equal((await b.api.load(owner, profile.id)).api_key, draft().api_key);
  assert.notDeepEqual([...b.idb.stores.get('profiles').values()][0].iv, iv);
  for (const changes of [{protocol: 'gemini'}, {base_url: 'https://other.example'}]) {
    await assert.rejects(b.api.save(owner, {...profile, ...changes}), /key|endpoint/i);
  }
});

test('retains only matching historical checks, clearing reused old identity on connection change', async () => {
  const b = browser(), profile = await b.api.save(owner, {...draft(), connection_id: 'observed-id', models: ['gpt-example'], checked_at: Date.now()});
  assert.deepEqual(plain(profile.models), ['gpt-example']);
  let saved = await b.api.save(owner, {...profile, name: 'Renamed'});
  assert.deepEqual(plain(saved.models), ['gpt-example']);
  saved = await b.api.save(owner, {...saved, api_key: 'synthetic-key-two'});
  assert.equal(saved.connection_id, null);
  assert.deepEqual(plain(saved.models), []);
  assert.equal(saved.checked_at, null);
  saved = await b.api.save(owner, {...saved, connection_id: 'fresh-observation', models: ['new-model'], checked_at: Date.now()});
  assert.deepEqual(plain(saved.models), ['new-model']);
  saved = await b.api.save(owner, {...saved, base_url: 'https://new.example', api_key: 'synthetic-key-three',
    connection_id: 'new-connection', models: ['new-model'], checked_at: Date.now()});
  assert.equal(saved.connection_id, 'new-connection');
  saved = await b.api.save(owner, {...saved, connection_id: 'unrelated', models: ['unrelated'], checked_at: Date.now()});
  assert.deepEqual(plain(saved.models), []);
});

test('enforces max20 per account and rejects malformed model history', async () => {
  const b = browser();
  for (let i = 0; i < 20; i++) await b.api.save(owner, {...draft(), name: 'Profile ' + i});
  await assert.rejects(b.api.save(owner, draft()), /20/);
  assert.ok(await b.api.save(other, draft()));
  for (const changes of [{models: ['bad model']}, {models: 'model'}, {models: null}, {checked_at: -1}, {checked_at: Date.now() + 120000}]) {
    await assert.rejects(b.api.save(other, {...draft(), ...changes}), /history|model|check/i);
  }
});

test('authenticates encrypted key against owner, profile and endpoint metadata', async () => {
  const b = browser(), a = await b.api.save(owner, draft()), second = await b.api.save(owner, {...draft(), name: 'Second'});
  const rows = b.idb.stores.get('profiles'), rowA = rows.get(JSON.stringify([owner, a.id]));
  const rowB = rows.get(JSON.stringify([owner, second.id]));
  rows.set(JSON.stringify([owner, second.id]), {...rowB, iv: rowA.iv, ciphertext: rowA.ciphertext});
  await assert.rejects(b.api.load(owner, second.id), /unavailable/i);
  rows.set(JSON.stringify([owner, a.id]), {...rowA, base_url: 'https://other.example'});
  await assert.rejects(b.api.load(owner, a.id), /unavailable/i);
});

test('persists scoped local/server choices without storing keys and deletes without fallback', async () => {
  const b = browser(), profile = await b.api.save(owner, draft());
  b.api.setActive(owner, {scope: 'server', id: 'server-profile'});
  assert.deepEqual(plain(browser({storage: b.storage}).api.active(owner)), {scope: 'server', id: 'server-profile'});
  assert.equal(b.api.active(other), null);
  b.api.setActive(owner, {scope: 'local', id: profile.id});
  assert.deepEqual(plain(browser({storage: b.storage}).api.active(owner)), {scope: 'local', id: profile.id});
  assert.equal([...b.storage.keys()][0], 'vjbot_ai_active_v1:' + owner);
  assert.equal(JSON.stringify([...b.storage]).includes(draft().api_key), false);
  await b.api.remove(owner, profile.id);
  assert.deepEqual(plain(b.api.active(owner)), {scope: 'none', id: ''});
  assert.deepEqual(plain(await b.api.list(owner)), []);
  await assert.rejects(b.api.prepareRequest('/api/chat', {method: 'POST', body: '{}'}, owner), /No API profile selected/i);
  assert.deepEqual(plain(browser({storage: b.storage}).api.active(owner)), {scope: 'none', id: ''});
  b.api.setActive(owner, null);
  assert.equal(b.api.active(owner), null);
});

test('storage failures and corrupt choices fail closed without volatile success', async () => {
  const b = browser({brokenStorage: true});
  assert.throws(() => b.api.setActive(owner, {scope: 'local', id: 'id'}), /storage|browser/i);
  assert.throws(() => b.api.active(owner), /storage|browser/i);
  const good = browser();
  good.storage.set('vjbot_ai_active_v1:' + owner, '{bad');
  assert.throws(() => good.api.active(owner), /unavailable|corrupt/i);
  assert.throws(() => good.api.setActive(owner, {scope: 'bogus', id: 'x'}), /Invalid/i);
});

test('only exact intended same-origin inference POST paths receive an immutable override', async () => {
  const b = browser(), profile = await b.api.save(owner, draft());
  b.api.setActive(owner, {scope: 'local', id: profile.id});
  const options = Object.freeze({method: 'POST', headers: Object.freeze({'X-CSRF-Token': 'synthetic-csrf'}), body: JSON.stringify({message: 'Hello'})});
  for (const path of ['/api/chat', '/api/kaiwa/evaluate', '/api/practice/coach', '/api/stt', '/api/ai/test', 'https://tutor.example/api/chat']) {
    const prepared = await b.api.prepareRequest(path, options, owner), body = JSON.parse(prepared.body);
    assert.notEqual(prepared, options);
    assert.equal(body.api_connection.api_key, draft().api_key);
    assert.equal(body.api_connection.model, draft().model);
    assert.equal(body.message, 'Hello');
    assert.equal(options.body, '{"message":"Hello"}');
  }
  for (const path of ['/api/chat?x=1', '/api/chat#x', '/api/chat/', '/api/ai/models', '/api/ai/models/test',
    '//other.example/api/chat', 'https://other.example/api/chat', '/other/../api/chat', '/api/%63hat']) {
    const prepared = await b.api.prepareRequest(path, options, owner);
    assert.equal(JSON.parse(prepared.body).api_connection, undefined);
  }
  const get = await b.api.prepareRequest('/api/chat', {method: 'GET'}, owner);
  assert.equal(get.body, undefined);
});

test('stale selection, malformed request bodies and missing device storage never use server fallback', async () => {
  const b = browser();
  b.api.setActive(owner, {scope: 'local', id: 'missing-profile'});
  await assert.rejects(b.api.prepareRequest('/api/chat', {method: 'POST', body: '{}'}, owner), /unavailable/i);
  const profile = await b.api.save(owner, draft());
  b.api.setActive(owner, {scope: 'local', id: profile.id});
  for (const body of ['not JSON', 'null', '[]', 3, {}]) {
    await assert.rejects(b.api.prepareRequest('/api/chat', {method: 'POST', body}, owner), /request|JSON/i);
  }
  const unavailable = browser({idb: null, storage: b.storage});
  await assert.rejects(unavailable.api.prepareRequest('/api/chat', {method: 'POST', body: '{}'}, owner), /unavailable/i);
  await assert.rejects(unavailable.api.list(owner), /IndexedDB|browser/i);
  await assert.rejects(unavailable.api.save(owner, draft()), /IndexedDB|browser/i);
});

test('an explicit server selection pins the intended profile instead of silently following global activation', async () => {
  const b = browser({idb: null}), options = {method: 'POST', body: '{}'};
  assert.deepEqual(plain(await b.api.prepareRequest('/api/chat', options, owner)), options);
  b.api.setActive(owner, {scope: 'server', id: 'server-profile'});
  const prepared = await b.api.prepareRequest('/api/chat', options, owner);
  assert.equal(new Headers(prepared.headers).get('X-VJBot-Profile'), 'server-profile');
  assert.equal(prepared.body, '{}');
  assert.equal(options.headers, undefined);
});

test('corrupt schema and missing account encryption keys fail without exposing stored details', async () => {
  const b = browser(), profile = await b.api.save(owner, draft());
  const rows = b.idb.stores.get('profiles'), slot = JSON.stringify([owner, profile.id]), row = rows.get(slot);
  rows.set(slot, {...row, models: 'corrupt'});
  await assert.rejects(b.api.list(owner), /unavailable/i);
  await assert.rejects(b.api.load(owner, profile.id), /unavailable/i);
  rows.set(slot, row);
  b.idb.stores.get('keys').clear();
  await assert.rejects(b.api.load(owner, profile.id), /unavailable/i);
});

test('explicit none selection blocks inference but never injects into unrelated endpoints', async () => {
  const b = browser({idb: null}), options = {method: 'POST', body: '{}'};
  b.api.setActive(owner, {scope: 'none', id: ''});
  await assert.rejects(b.api.prepareRequest('/api/chat', options, owner), /No API profile selected/i);
  assert.deepEqual(plain(await b.api.prepareRequest('/api/ai/models', options, owner)), options);
});

test('clearing account data erases only that owner profiles and CryptoKey and keeps no-selection', async () => {
  const b = browser();
  await b.api.save(owner, draft());
  await b.api.save(owner, {...draft(), name: 'Second'});
  const retained = await b.api.save(other, draft());
  b.api.setActive(other, {scope: 'local', id: retained.id});
  await b.api.clear(owner);
  assert.deepEqual(plain(await b.api.list(owner)), []);
  assert.equal(b.idb.stores.get('keys').has(JSON.stringify(owner)), false);
  assert.deepEqual(plain(b.api.active(owner)), {scope: 'none', id: ''});
  assert.equal((await b.api.load(other, retained.id)).api_key, draft().api_key);
  assert.deepEqual(plain(b.api.active(other)), {scope: 'local', id: retained.id});
  await b.api.clear(owner);
  assert.deepEqual(plain(await b.api.list(owner)), []);
});

test('clear still attempts credential deletion when localStorage is blocked and reports the failure', async () => {
  const b = browser();
  await b.api.save(owner, draft());
  const blocked = browser({idb: b.idb, brokenStorage: true});
  await assert.rejects(blocked.api.clear(owner), /storage|browser/i);
  assert.deepEqual(plain(await b.api.list(owner)), []);
  assert.equal(b.idb.stores.get('keys').has(JSON.stringify(owner)), false);
});

test('voice references persist per owner independently of chat and inject only a saved Gemini key', async () => {
  const b = browser(), chat = await b.api.save(owner, draft());
  const voice = await b.api.save(owner, {...draft(), name: 'Voice', protocol: 'gemini', model: '', api_key: 'synthetic-voice-key'});
  b.api.setActive(owner, {scope: 'local', id: chat.id});
  b.api.setVoice(owner, {scope: 'local', id: voice.id});
  const reloaded = browser({idb: b.idb, storage: b.storage});
  assert.deepEqual(plain(reloaded.api.voice(owner)), {scope: 'local', id: voice.id});
  assert.equal(reloaded.api.voice(other), null);
  const options = {method: 'POST', body: '{"text":"こんにちは"}', headers: {'X-VJBot-Profile': 'stale-chat'}};
  for (const path of ['/api/tts', 'https://tutor.example/api/tts']) {
    const result = await reloaded.api.prepareRequest(path, options, owner);
    assert.equal(JSON.parse(result.body).api_connection.api_key, 'synthetic-voice-key');
    assert.equal(JSON.parse(result.body).api_connection.model, '');
    assert.equal(new Headers(result.headers).get('X-VJBot-Profile'), null);
  }
  b.api.setActive(owner, {scope: 'none', id: ''});
  assert.equal(JSON.parse((await b.api.prepareRequest('/api/tts', options, owner)).body).api_connection.api_key, 'synthetic-voice-key');
  assert.equal(JSON.stringify([...b.storage]).includes('synthetic-voice-key'), false);
  await assert.rejects(b.api.prepareRequest('/api/chat', {method:'POST',body:'{}'}, owner), /No API profile/i);
});

test('recorded transcription keeps the active OpenAI key while read-aloud uses its independent Gemini key', async () => {
  const b = browser(), options = {method:'POST',body:'{}'};
  const chat = await b.api.save(owner, {...draft(),base_url:'https://api.openai.com/v1',api_key:'synthetic-openai-transcription-key'});
  const voice = await b.api.save(owner, {...draft(),protocol:'gemini',base_url:'https://generativelanguage.googleapis.com',model:'',api_key:'synthetic-gemini-read-aloud-key'});
  b.api.setActive(owner, {scope:'local',id:chat.id});
  b.api.setVoice(owner, {scope:'local',id:voice.id});
  const transcription = JSON.parse((await b.api.prepareRequest('/api/stt', options, owner)).body).api_connection;
  const speech = JSON.parse((await b.api.prepareRequest('/api/tts', options, owner)).body).api_connection;
  assert.equal(transcription.api_key,'synthetic-openai-transcription-key');
  assert.equal(transcription.base_url,'https://api.openai.com/v1');
  assert.equal(speech.api_key,'synthetic-gemini-read-aloud-key');
  assert.equal(speech.protocol,'gemini');
});

test('missing, corrupt, deleted, unsupported and inaccessible voice choices never borrow chat', async () => {
  const b = browser(), chat = await b.api.save(owner, {...draft(),base_url:'https://chat-proxy.example/v1'}), options = {method:'POST',body:'{}'};
  b.api.setActive(owner, {scope:'local',id:chat.id});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /voice/i);
  b.api.setVoice(owner, {scope:'local',id:chat.id});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /native Gemini|official OpenAI/i);
  const proxy = await b.api.save(owner, {...draft(),protocol:'gemini',base_url:'https://proxy.example.com'});
  b.api.setVoice(owner, {scope:'local',id:proxy.id});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /native Gemini|official OpenAI/i);
  const voice = await b.api.save(owner, {...draft(),protocol:'gemini',model:''});
  b.api.setVoice(owner, {scope:'local',id:voice.id});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, other), /voice/i);
  await b.api.remove(owner, voice.id);
  assert.deepEqual(plain(b.api.voice(owner)), {scope:'none',id:''});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /voice/i);
  b.storage.set('vjbot_voice_profile_v1:' + owner, '{corrupt');
  assert.throws(() => b.api.voice(owner), /unavailable/i);
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /unavailable/i);
  b.api.setVoice(owner, {scope:'local',id:'missing'});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /unavailable/i);
  const blocked = browser({storage:b.storage,brokenStorage:true});
  assert.throws(() => blocked.api.setVoice(owner, {scope:'server',id:'voice'}), /storage/i);
  await assert.rejects(blocked.api.prepareRequest('/api/tts', options, owner), /storage/i);
});

test('server voice is explicitly pinned and clear does not borrow another owner or chat selection', async () => {
  const b = browser(), options = {method:'POST',body:'{}'};
  b.api.setVoice(owner, {scope:'server',id:'server-voice'});
  b.api.setVoice(other, {scope:'server',id:'other-voice'});
  b.api.setActive(owner, {scope:'server',id:'chat'});
  assert.equal(new Headers((await b.api.prepareRequest('/api/tts', options, owner)).headers).get('X-VJBot-Profile'), 'server-voice');
  await b.api.clear(owner);
  assert.deepEqual(plain(b.api.voice(owner)), {scope:'none',id:''});
  assert.deepEqual(plain(b.api.voice(other)), {scope:'server',id:'other-voice'});
  await assert.rejects(b.api.prepareRequest('/api/tts', options, owner), /voice/i);
});

test('voice changes invalidate in-flight encrypted loads, including changing away and back', async () => {
  const b = browser(), a = await b.api.save(owner, {...draft(),protocol:'gemini',model:''});
  const next = await b.api.save(owner, {...draft(),protocol:'gemini',model:'',api_key:'second-voice-key'});
  b.api.setVoice(owner, {scope:'local',id:a.id});
  const pending = b.api.prepareRequest('/api/tts', {method:'POST',body:'{}'}, owner);
  b.api.setVoice(owner, {scope:'local',id:next.id});
  b.api.setVoice(owner, {scope:'local',id:a.id});
  await assert.rejects(pending, /unavailable/i);
  assert.equal(JSON.parse((await b.api.prepareRequest('/api/tts', {method:'POST',body:'{}'}, owner)).body).api_connection.api_key,draft().api_key);
});

test('voice notifications follow actual owned selection and cross-tab reference changes, not chat switches', () => {
  const b = browser();
  b.context.signedInUser = {user_id:owner};
  let changes = 0;
  b.context.addEventListener('vjbot-voice-changed', () => {changes++;});
  b.api.setVoice(owner, {scope:'server',id:'voice-a'});
  b.api.setVoice(owner, {scope:'server',id:'voice-a'});
  b.api.setActive(owner, {scope:'server',id:'chat-b'});
  b.api.setVoice(other, {scope:'server',id:'other-voice'});
  assert.equal(changes,1);
  const storageEvent = key => {
    const event = new Event('storage');Object.defineProperty(event,'key',{value:key});
    b.context.dispatchEvent(event);
  };
  storageEvent('vjbot_ai_active_v1:' + owner);
  storageEvent('vjbot_voice_profile_v1:' + other);
  assert.equal(changes,1);
  b.storage.set('vjbot_voice_profile_v1:' + owner, JSON.stringify({scope:'server',id:'voice-b'}));
  storageEvent('vjbot_voice_profile_v1:' + owner);
  assert.equal(changes,2);
  assert.deepEqual(plain(b.api.voice(owner)),{scope:'server',id:'voice-b'});
});

test('official OpenAI voice-only profiles remain independent and cannot act as unconfigured chat', async () => {
  const b = browser(), voice = await b.api.save(owner, {...draft(),model:'',api_key:'synthetic-openai-voice'});
  b.api.setVoice(owner,{scope:'local',id:voice.id});
  b.api.setActive(owner,{scope:'local',id:voice.id});
  const prepared = await b.api.prepareRequest('/api/tts',{method:'POST',body:'{"speech_model":"gpt-4o-mini-tts"}'},owner);
  assert.equal(JSON.parse(prepared.body).api_connection.protocol,'openai');
  assert.equal(JSON.parse(prepared.body).api_connection.model,'');
  assert.equal(JSON.parse(prepared.body).api_connection.api_key,'synthetic-openai-voice');
  await assert.rejects(b.api.prepareRequest('/api/chat',{method:'POST',body:'{}'},owner),/choose|model/i);
});

test('only exact platform OpenAI voice refs persist and only exact speech POSTs receive the platform header', async () => {
  const b = browser(), options = {method:'POST',body:'{}'};
  b.api.setActive(owner,{scope:'server',id:'chat-profile'});
  b.api.setVoice(owner,{scope:'platform',id:'openai'});
  assert.deepEqual(plain(browser({storage:b.storage}).api.voice(owner)),{scope:'platform',id:'openai'});
  assert.equal(b.api.voice(other),null);
  for (const choice of [{scope:'platform',id:'other'}, {scope:'platform',id:'https://evil.example'}]) {
    assert.throws(()=>b.api.setVoice(owner,choice),/Invalid/i);
  }
  assert.throws(()=>b.api.setActive(owner,{scope:'platform',id:'openai'}),/Invalid/i);
  b.storage.set('vjbot_ai_active_v1:' + other,JSON.stringify({scope:'platform',id:'openai'}));
  assert.throws(()=>b.api.active(other),/unavailable/i);
  for (const path of ['/api/tts','https://tutor.example/api/tts']) {
    const prepared=await b.api.prepareRequest(path,options,owner);
    assert.equal(new Headers(prepared.headers).get('X-VJBot-Profile'),'platform_openai');
    assert.equal(prepared.body,'{}');
  }
  for (const path of ['/api/tts?x=1','/api/tts/','/other/../api/tts','https://evil.example/api/tts']) {
    assert.deepEqual(plain(await b.api.prepareRequest(path,options,owner)),options);
  }
  assert.equal(new Headers((await b.api.prepareRequest('/api/chat',options,owner)).headers).get('X-VJBot-Profile'),'chat-profile');
  assert.deepEqual(plain(await b.api.prepareRequest('/api/tts',{method:'GET'},owner)),{method:'GET'});
});


test('corrupt independent voice storage cannot block deleting selected chat credentials', async () => {
  const b = browser(), chat = await b.api.save(owner, draft());
  const retained = await b.api.save(owner, {...draft(), name:'Retained voice', protocol:'gemini', model:''});
  b.api.setActive(owner, {scope:'local', id:chat.id});
  b.storage.set('vjbot_voice_profile_v1:' + owner, '{corrupt');
  await b.api.remove(owner, chat.id);
  assert.deepEqual(plain(b.api.active(owner)), {scope:'none', id:''});
  assert.deepEqual(plain(await b.api.list(owner)).map(row => row.id), [retained.id]);
  await assert.rejects(b.api.load(owner, chat.id), /unavailable/i);
  assert.equal(b.storage.get('vjbot_voice_profile_v1:' + owner), '{corrupt');
  assert.throws(() => b.api.voice(owner), /unavailable/i);
});
