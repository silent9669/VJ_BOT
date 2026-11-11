import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scanner} from './fixtures/model-scan-clock.mjs';

function settings({consent = true, models = ['paid', 'denied', 'working'], savedModel = 'paid', probe,
  storage = new Map(), connection = 'bound-connection', draftConnection = connection, deviceProfiles = new Map(), activeChoice = {value: null}} = {}) {
  const elements = new Map(), requests = [], scanRuns = [];
  let clock = Date.now();
  let storedModel = savedModel;
  let savedProfile = {id: 'saved-profile', name: 'Saved provider', protocol: 'openai', base_url: 'https://provider.example/v1',
    model: storedModel, key_last4: 'test', connection_id: connection, models: [], checked_at: null};
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', children: [], events: {}, attributes: {}, dataset: {}, hidden: false, disabled: false,
      get options() { return this.children; },
      addEventListener(name, handler) { this.events[name] = handler; },
      showModal() {
        this.open = true;
        if (consent !== null) queueMicrotask(() => this.close(consent ? 'start' : 'cancel'));
      },
      close(value = '') { this.open = false; this.returnValue = value; this.events.close?.(); },
      click() { return this.events.click?.(); },
      focus() {},
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      removeAttribute(name) { delete this.attributes[name]; },
      replaceChildren(...children) { this.children = children; this.value = ''; },
      append(child) { this.children.push(child); },
      querySelectorAll() { return [...elements.values()]; }
    });
    return elements.get(id);
  };
  const context = vm.createContext({Response, AbortController, Date, console,
    signedInUser: {user_id: 'test:owner'}, switchTab() {},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)},
    VJProfiles: {
      active: () => activeChoice.value, setActive: (_owner, choice) => { activeChoice.value = choice; },
      list: async owner => [...deviceProfiles.values()].filter(p => p.owner === owner).map(({api_key, ...p}) => p),
      load: async (owner, id) => { const profile = deviceProfiles.get(id); if (profile?.owner !== owner) throw new Error('Missing profile'); return profile; },
      save: async (owner, draft) => {
        const id = draft.id || 'device-' + deviceProfiles.size, old = deviceProfiles.get(id);
        const profile = {...draft, id, owner, api_key: draft.api_key || old?.api_key, key_last4: (draft.api_key || old?.api_key || '').slice(-4)};
        deviceProfiles.set(id, profile);
        const {api_key, ...publicProfile} = profile; return publicProfile;
      },
      remove: async (_owner, id) => { deviceProfiles.delete(id); activeChoice.value = {scope: 'none', id: ''}; }
    },
    confirm: () => { throw new Error('Browser confirmation must not be used for model checks'); },
    VJModelScan: {plan: scanner.plan, run: options => {
      scanRuns.push({mode: options.mode, dispatchedAt: options.dispatchedAt});
      return scanner.run({...options, now: () => clock, sleep: async ms => { clock += ms; }});
    }},
    document: {getElementById: element, querySelectorAll: () => [], querySelector: selector => element(selector),
      createElement: () => ({value: '', textContent: ''})},
    apiFetch: async (path, options = {}) => {
      requests.push({path, body: JSON.parse(options.body || '{}'), at: clock});
      if (path === '/api/ai/settings') return Response.json({source: 'own', can_store: true, own: savedProfile});
      if (path === '/api/ai/profiles') return Response.json({profiles: [savedProfile], active_id: savedProfile.id, can_store: true});
      if (path === '/api/ai/profiles/saved-profile' && options.method === 'PUT') {
        savedProfile = {...savedProfile, ...JSON.parse(options.body)};
        return Response.json({profile: savedProfile});
      }
      if (path === '/api/ai/profiles/saved-profile/activate') return Response.json({ok: true});
      if (path === '/api/ai/models') return Response.json({models, connection_id: draftConnection});
      if (path === '/api/ai/models/test') {
        const {model} = JSON.parse(options.body);
        if (probe) return probe(model, options);
        return !['paid', 'denied'].includes(model) ? Response.json({ok: true, model})
          : Response.json({detail: 'Synthetic denial', provider_status: model === 'paid' ? 402 : 403}, {status: 502});
      }
      throw new Error('Unexpected endpoint: ' + path);
    }
  });
  context.window = context;
  vm.runInContext(readFileSync('static/ai-settings.js', 'utf8'), context);
  return {context, element, requests, scanRuns, storage, deviceProfiles, activeChoice};
}

test('catalog entries needing credits or denied by the key are never selectable after automatic verification', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  assert.deepEqual(ui.element('ai-model-list').options.map(option => option.value), ['working']);
  assert.equal(ui.element('ai-model').value, 'working');
  assert.equal(ui.element('ai-save').disabled, false);
  assert.equal(ui.element('ai-models').hidden, false);
  const probes = ui.requests.filter(request => request.path === '/api/ai/models/test');
  assert.deepEqual(probes.map(request => request.body.model), ['paid', 'denied', 'working']);
  assert.equal(ui.element('ai-load-progress').value, 3);
  await ui.element('ai-form').events.submit({preventDefault() {}});
  assert.equal(ui.requests.filter(request => request.path === '/api/ai/models/test').length, 3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.requests.find(request => request.path === '/api/ai/profiles/saved-profile' && request.body.model)?.body.model, 'working');
});

test('declining per-model cost consent sends no probes and offers no catalog-only choices', async () => {
  const ui = settings({consent: false});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  assert.equal(ui.requests.some(request => request.path === '/api/ai/models/test'), false);
  assert.deepEqual(ui.element('ai-model-list').options, []);
  assert.equal(ui.element('ai-save').disabled, true);
  assert.equal(ui.element('ai-models').hidden, true);
});

test('model probes wait for explicit in-app consent and credential edits close the pending dialog', async () => {
  const ui = settings({consent: null});
  await ui.context.renderAiPanels('settings');
  const pending = ui.element('ai-fetch-models').events.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.element('ai-confirm-dialog').open, true);
  assert.equal(ui.requests.some(request => request.path === '/api/ai/models/test'), false);
  ui.element('ai-key').value = 'replacement-test-key';
  ui.element('ai-key').events.input();
  await pending;
  assert.equal(ui.element('ai-confirm-dialog').open, false);
  assert.equal(ui.requests.some(request => request.path === '/api/ai/models/test'), false);
  assert.equal(ui.element('ai-save').disabled, true);
});

test('production scans use burst slots and retain the saved model when it verifies', async () => {
  const ui = settings({models: ['other', 'working', 'third', 'fourth'], savedModel: 'working'});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  const probes = ui.requests.filter(request => request.path === '/api/ai/models/test');
  assert.equal(ui.scanRuns[0].mode, 'burst');
  assert.equal(new Set(probes.map(request => request.at)).size, 1);
  assert.equal(probes[0].body.model, 'working');
  assert.equal(ui.element('ai-model-list').value, 'working');
  assert.equal(ui.element('ai-model').value, 'working');
});

test('repeated scans and edited credentials share the signed-in account rolling budget', async () => {
  const ui = settings({models: Array.from({length: 10}, (_, i) => `model-${i}`)});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  await ui.element('ai-fetch-models').events.click();
  ui.element('ai-key').value = 'replacement-key';
  ui.element('ai-key').events.input();
  await ui.element('ai-fetch-models').events.click();
  const probes = ui.requests.filter(request => request.path === '/api/ai/models/test');
  assert.equal(probes.length, 30);
  assert.equal(probes[18].at - probes[0].at, 0);
  assert.equal(probes[19].at - probes[0].at, 60000);
  assert.equal(probes[20].at - probes[0].at, 60000);
  assert.equal(ui.scanRuns[1].dispatchedAt.length, 10);
  assert.equal(ui.scanRuns[2].dispatchedAt.length, 1);
  assert.ok(Object.isFrozen(ui.scanRuns[1].dispatchedAt));
});

test('changing the signed-in account and logout reset the local budget', async () => {
  const ui = settings({models: ['working']});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  ui.context.signedInUser = {user_id: 'test:other'};
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  assert.equal(ui.scanRuns[1].dispatchedAt.length, 0);
  ui.element('settings-logout').events.click();
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  assert.equal(ui.scanRuns[2].dispatchedAt.length, 0);
});

test('Escape closes cost consent without sending probes', async () => {
  const ui = settings({consent: null});
  await ui.context.renderAiPanels('settings');
  const pending = ui.element('ai-fetch-models').events.click();
  await new Promise(resolve => setImmediate(resolve));
  ui.element('ai-confirm-dialog').close();
  await pending;
  assert.equal(ui.scanRuns.length, 0);
  assert.equal(ui.requests.some(request => request.path === '/api/ai/models/test'), false);
});

test('Stop and credential edits discard every late burst response but retain dispatch accounting', async () => {
  for (const action of ['stop', 'edit']) {
    const replies = [];
    const ui = settings({models: ['one', 'two', 'three', 'four', 'five'],
      probe: model => new Promise(resolve => replies.push(() => resolve(Response.json({ok: true, model}))))});
    await ui.context.renderAiPanels('settings');
    const pending = ui.element('ai-fetch-models').events.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length, 4);
    if (action === 'stop') ui.element('ai-stop-models').events.click();
    else ui.element('ai-key').events.input();
    replies.splice(0).forEach(reply => reply());
    await pending;
    assert.equal(ui.requests.filter(request => request.path === '/api/ai/models/test').length, 4);
    assert.equal(ui.element('ai-model-list').options.length, 0);
    assert.equal(ui.element('ai-save').disabled, true);
    const next = ui.element('ai-fetch-models').events.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.scanRuns[1].dispatchedAt.length, 4);
    ui.element('ai-stop-models').events.click();
    replies.splice(0).forEach(reply => reply());
    await next;
  }
});

test('a rejected key clears already verified choices and discards other active successes', async () => {
  const replies = new Map();
  const ui = settings({models: ['working', 'rejected', 'late'], savedModel: 'working',
    probe: model => new Promise(resolve => replies.set(model, resolve))});
  await ui.context.renderAiPanels('settings');
  const pending = ui.element('ai-fetch-models').events.click();
  await new Promise(resolve => setImmediate(resolve));
  replies.get('working')(Response.json({ok: true, model: 'working'}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.element('ai-model-list').options.length, 1);
  replies.get('rejected')(Response.json({detail: 'Rejected', provider_status: 401}, {status: 502}));
  await new Promise(resolve => setImmediate(resolve));
  replies.get('late')(Response.json({ok: true, model: 'late'}));
  await pending;
  assert.equal(ui.element('ai-model-list').options.length, 0);
  assert.equal(ui.element('ai-save').disabled, true);
});

test('session expiry clears choices even when account handling changes identity before the response', async () => {
  const replies = new Map();
  const ui = settings({models: ['working', 'expired'], savedModel: 'working',
    probe: model => new Promise(resolve => replies.set(model, resolve))});
  await ui.context.renderAiPanels('settings');
  const pending = ui.element('ai-fetch-models').events.click();
  await new Promise(resolve => setImmediate(resolve));
  replies.get('working')(Response.json({ok: true, model: 'working'}));
  await new Promise(resolve => setImmediate(resolve));
  ui.context.signedInUser = null;
  replies.get('expired')(Response.json({detail: 'Session expired'}, {status: 401}));
  await pending;
  assert.equal(ui.element('ai-model-list').options.length, 0);
  assert.equal(ui.element('ai-save').disabled, true);
});

test('saved verified choices survive Settings navigation and a fresh page without generation requests', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  await ui.element('ai-form').events.submit({preventDefault() {}});
  await ui.context.renderAiPanels('settings');
  assert.deepEqual(ui.element('ai-model-list').options.map(o => o.value), ['working']);
  assert.equal(ui.element('ai-model-list').value, 'working');
  assert.equal(ui.element('ai-key').value, '');
  assert.equal(ui.element('ai-key').required, false);
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 3);
  const reloaded = settings({storage: ui.storage, savedModel: 'working'});
  await reloaded.context.renderAiPanels('settings');
  assert.deepEqual(reloaded.element('ai-model-list').options.map(o => o.value), ['working']);
  assert.equal(reloaded.element('ai-save').disabled, false);
  assert.match(reloaded.element('ai-model-status').textContent, /previously responding.*last checked/);
  assert.equal(reloaded.requests.some(r => r.path !== '/api/ai/profiles'), false);
});

test('a checked draft survives navigation but its raw key never enters browser storage', async () => {
  const ui = settings({draftConnection: 'draft-identity'});
  await ui.context.renderAiPanels('settings');
  ui.element('ai-key').value = 'private-draft-key';
  ui.element('ai-key').events.input();
  await ui.element('ai-fetch-models').events.click();
  await ui.context.renderAiPanels('settings');
  assert.equal(ui.element('ai-key').value, 'private-draft-key');
  assert.deepEqual(ui.element('ai-model-list').options.map(o => o.value), ['working']);
  assert.equal(JSON.stringify([...ui.storage]).includes('private-draft-key'), false);
  const reloaded = settings({storage: ui.storage});
  await reloaded.context.renderAiPanels('settings');
  assert.equal(reloaded.element('ai-key').value, '');
  assert.deepEqual(reloaded.element('ai-model-list').options, []);
});

test('another account, rotated connection or malformed cache cannot inherit verified choices', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  const rotated = settings({storage: ui.storage, connection: 'rotated-identity'});
  await rotated.context.renderAiPanels('settings');
  assert.deepEqual(rotated.element('ai-model-list').options, []);
  const other = settings({storage: ui.storage});
  other.context.signedInUser = {user_id: 'test:other'};
  await other.context.renderAiPanels('settings');
  assert.deepEqual(other.element('ai-model-list').options, []);
  for (const [key, value] of ui.storage) {
    ui.storage.set(key, JSON.stringify({...JSON.parse(value), models: ['<script>bad</script>']}));
  }
  const corrupted = settings({storage: ui.storage});
  await corrupted.context.renderAiPanels('settings');
  assert.deepEqual(corrupted.element('ai-model-list').options, []);
});

test('a failed refresh cannot resurrect earlier successful models on reload', async () => {
  let succeeds = true;
  const ui = settings({models: ['working'], probe: model => succeeds ? Response.json({ok: true, model})
    : Response.json({provider_status: 402, detail: 'Credits required'}, {status: 502})});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  succeeds = false;
  await ui.element('ai-fetch-models').events.click();
  const reloaded = settings({storage: ui.storage});
  await reloaded.context.renderAiPanels('settings');
  assert.deepEqual(reloaded.element('ai-model-list').options, []);
});

test('blocked browser storage keeps live results usable and explains that persistence failed', async () => {
  const ui = settings({storage: {get: () => null, set: () => { throw new Error('Blocked'); }, delete: () => {}}});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  assert.deepEqual(ui.element('ai-model-list').options.map(o => o.value), ['working']);
  assert.equal(ui.element('ai-save').disabled, false);
  assert.match(ui.element('ai-selection-hint').textContent, /will not be remembered/);
});

test('a new device profile saves before scanning and restores after reload without uploading the key', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  ui.element('ai-profile-new').click();
  ui.element('ai-profile-name').value = 'Gemini demo';
  ui.element('ai-protocol').value = 'gemini';
  ui.element('ai-base').value = 'https://generativelanguage.googleapis.com';
  ui.element('ai-key').value = 'private-device-profile-key';
  await ui.element('ai-profile-save').click();
  assert.equal(ui.deviceProfiles.size, 1);
  assert.equal(ui.requests.some(r => r.body.api_key === 'private-device-profile-key'), false);
  assert.equal(ui.requests.some(r => r.path === '/api/ai/models'), false);
  const reloaded = settings({deviceProfiles: ui.deviceProfiles, activeChoice: ui.activeChoice});
  await reloaded.context.renderAiPanels('settings');
  assert.equal(reloaded.element('ai-profile-name').value, 'Gemini demo');
  assert.equal(reloaded.element('ai-key').value, '');
  assert.equal(reloaded.element('ai-key').required, false);
  assert.equal(reloaded.element('ai-chat').hidden, true);
  assert.equal(reloaded.requests.some(r => r.path === '/api/ai/models'), false);
});

test('a device key cannot be reused for an edited URL during discovery', async () => {
  const deviceProfiles = new Map([['demo', {owner: 'test:owner', id: 'demo', name: 'Device API',
    protocol: 'openai', base_url: 'https://original.example/v1', model: 'working', models: ['working'],
    checked_at: Date.now(), connection_id: 'device-identity', api_key: 'private-device-key', key_last4: '-key'}]]);
  const ui = settings({deviceProfiles, activeChoice: {value: {scope: 'local', id: 'demo'}}});
  await ui.context.renderAiPanels('settings');
  ui.element('ai-base').value = 'https://different.example/v1';
  ui.element('ai-base').events.input();
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.find(r => r.path === '/api/ai/models').body.api_key, '');
});

test('explicit no-profile state survives Settings and does not restore a server fallback', async () => {
  const ui = settings({activeChoice: {value: {scope: 'none', id: ''}}});
  await ui.context.renderAiPanels('settings');
  assert.equal(ui.element('ai-profile-list').value, '');
  assert.equal(ui.element('ai-base').value, '');
  await ui.context.checkAiReady();
  assert.equal(ui.element('chat-locked').hidden, false);
});
