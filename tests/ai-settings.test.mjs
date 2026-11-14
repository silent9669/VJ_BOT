import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scanner} from './fixtures/model-scan-clock.mjs';

function settings({consent = true, models = ['paid', 'denied', 'working'], savedModel = 'paid', probe,
  storage = new Map(), connection = 'bound-connection', draftConnection = connection, deviceProfiles = new Map(), activeChoice = {value: null}} = {}) {
  const elements = new Map(), requests = [], scanRuns = [];
  const events = new EventTarget();
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
  const context = vm.createContext({Response, AbortController, Date, console, Event,
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
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
    document: {body:{dataset:{page:'settings'}}, getElementById: element, querySelectorAll: () => [], querySelector: selector => element(selector),
      createElement: () => ({value: '', textContent: '', children: [], append(child) { this.children.push(child); }})},
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
  ui.element('ai-recheck-all').checked = true;
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

test('changing the signed-in account isolates its request budget from another account', async () => {
  const ui = settings({models: ['working']});
  ui.element('ai-recheck-all').checked = true;
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  ui.context.signedInUser = {user_id: 'test:other'};
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').events.click();
  assert.equal(ui.scanRuns[1].dispatchedAt.length, 0);
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
    ui.element('ai-recheck-all').checked = true;
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
  assert.match(reloaded.element('ai-model-status').textContent, /mô hình từng phản hồi.*kiểm tra lần cuối/);
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
  ui.element('ai-recheck-all').checked = true;
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
  assert.match(ui.element('ai-selection-hint').textContent, /không được giữ lại khi tải lại trang/);
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

test('returning to Settings preserves an active scan and its progress until every model completes', async () => {
  const replies = new Map(), signals = [];
  const ui = settings({models: ['one', 'two', 'three', 'four', 'five'], probe: (model, options) => {
    signals.push(options.signal);
    return new Promise(resolve => replies.set(model, resolve));
  }});
  await ui.context.renderAiPanels('settings');
  const pending = ui.element('ai-fetch-models').click();
  await new Promise(resolve => setImmediate(resolve));
  replies.get('one')(Response.json({ok: true, model: 'one'}));
  await new Promise(resolve => setImmediate(resolve));
  const progress = ui.element('ai-model-status').textContent;
  const reads = ui.requests.filter(r => r.path === '/api/ai/profiles').length;
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/profiles').length, reads);
  assert.equal(ui.scanRuns.length, 1);
  assert.equal(ui.element('ai-load-progress').value, 1);
  assert.equal(ui.element('ai-model-status').textContent, progress);
  assert.equal(ui.element('ai-stop-models').hidden, false);
  assert.ok(signals.every(signal => !signal.aborted));
  for (const model of ['two', 'three', 'four', 'five']) replies.get(model)(Response.json({ok: true, model}));
  await pending;
  assert.deepEqual(ui.element('ai-model-list').options.map(o => o.value), ['one', 'two', 'three', 'four', 'five']);
  assert.match(ui.element('ai-model-status').textContent, /Hoàn tất: 5\/5/);
});

test('navigation during catalog retrieval or pending consent neither cancels nor starts probes early', async () => {
  const ui = settings({models: ['working'], consent: null});
  await ui.context.renderAiPanels('settings');
  const api = ui.context.apiFetch;
  let releaseCatalog, catalogSignal;
  ui.context.apiFetch = (path, options) => path === '/api/ai/models'
    ? new Promise(resolve => { catalogSignal = options.signal; releaseCatalog = () => resolve(Response.json({models: ['working'], connection_id: 'bound-connection'})); })
    : api(path, options);
  const pending = ui.element('ai-fetch-models').click();
  await new Promise(resolve => setImmediate(resolve));
  await ui.context.renderAiPanels('settings');
  assert.equal(catalogSignal.aborted, false);
  releaseCatalog();
  await new Promise(resolve => setImmediate(resolve));
  await ui.context.renderAiPanels('settings');
  assert.equal(ui.element('ai-confirm-dialog').open, true);
  assert.equal(ui.requests.some(r => r.path === '/api/ai/models/test'), false);
  ui.element('ai-confirm-dialog').close('start');
  await pending;
  assert.deepEqual(ui.element('ai-model-list').options.map(o => o.value), ['working']);
});

test('an earlier delayed Settings render cannot cancel a newly started scan', async () => {
  const replies = [];
  const ui = settings({models: ['one', 'two'], probe: model => new Promise(resolve => replies.push(() => resolve(Response.json({ok: true, model}))))});
  await ui.context.renderAiPanels('settings');
  const api = ui.context.apiFetch;
  let releaseSettings;
  ui.context.apiFetch = (path, options) => path === '/api/ai/profiles'
    ? new Promise(resolve => { releaseSettings = async () => resolve(await api(path, options)); }) : api(path, options);
  const earlierRender = ui.context.renderAiPanels('settings');
  await new Promise(resolve => setImmediate(resolve));
  const pending = ui.element('ai-fetch-models').click();
  await new Promise(resolve => setImmediate(resolve));
  await releaseSettings();
  await earlierRender;
  assert.equal(ui.element('ai-stop-models').hidden, false);
  assert.equal(ui.element('ai-fetch-models').disabled, true);
  replies.forEach(reply => reply());
  await pending;
  assert.deepEqual(ui.element('ai-model-list').options.map(o => o.value), ['one', 'two']);
});

test('returning with another account cancels the previous account scan and discards late responses', async () => {
  const replies = [], signals = [];
  const ui = settings({models: ['one', 'two'], probe: (model, options) => {
    signals.push(options.signal);
    return new Promise(resolve => replies.push(() => resolve(Response.json({ok: true, model}))));
  }});
  await ui.context.renderAiPanels('settings');
  const pending = ui.element('ai-fetch-models').click();
  await new Promise(resolve => setImmediate(resolve));
  ui.context.signedInUser = {user_id: 'test:other'};
  await ui.context.renderAiPanels('settings');
  assert.ok(signals.every(signal => signal.aborted));
  replies.forEach(reply => reply());
  await pending;
  assert.deepEqual(ui.element('ai-model-list').options, []);
});

test('Stop then resume tests only models never dispatched, retaining successful results after reload', async () => {
  const replies = new Map(), models = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const ui = settings({models, savedModel: 'one', probe: model => new Promise(resolve => replies.set(model, resolve))});
  await ui.context.renderAiPanels('settings');
  const first = ui.element('ai-fetch-models').click();
  await new Promise(resolve => setImmediate(resolve));
  replies.get('one')(Response.json({ok: true, model: 'one'}));
  await new Promise(resolve => setImmediate(resolve));
  ui.element('ai-stop-models').click();
  for (const [model, resolve] of replies) if (model !== 'one') resolve(Response.json({ok: true, model}));
  await first;
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 5);
  const reloaded = settings({models, savedModel: 'one', storage: ui.storage});
  await reloaded.context.renderAiPanels('settings');
  assert.match(reloaded.element('ai-fetch-models').textContent, /Tiếp tục với 3/);
  await reloaded.element('ai-fetch-models').click();
  assert.deepEqual(reloaded.requests.filter(r => r.path === '/api/ai/models/test').map(r => r.body.model), ['six', 'seven', 'eight']);
  assert.deepEqual(reloaded.element('ai-model-list').options.map(o => o.value), ['one', 'six', 'seven', 'eight']);
  assert.equal(reloaded.element('ai-load-progress').value, 4);
  assert.match(reloaded.element('ai-model-status').textContent, /4 yêu cầu bị gián đoạn không được gửi lại/);
  const attempts = reloaded.requests.filter(r => r.path === '/api/ai/models/test').length;
  await reloaded.element('ai-fetch-models').click();
  assert.equal(reloaded.requests.filter(r => r.path === '/api/ai/models/test').length, attempts);
});

test('failed and quota responses are not retried by resume; only explicit recheck spends quota again', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').click();
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 3);
  ui.element('ai-recheck-all').checked = true;
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 6);
});

test('checkpoints bind the actual key connection, never cache a raw draft key, and do not cross accounts', async () => {
  const ui = settings({models: ['working'], draftConnection: 'draft-identity'});
  await ui.context.renderAiPanels('settings');
  ui.element('ai-key').value = 'private-checkpoint-key';
  ui.element('ai-key').events.input();
  await ui.element('ai-fetch-models').click();
  assert.equal(JSON.stringify([...ui.storage]).includes('private-checkpoint-key'), false);
  const anotherKey = settings({models: ['working'], storage: ui.storage, connection: 'new-key-identity'});
  await anotherKey.context.renderAiPanels('settings');
  await anotherKey.element('ai-fetch-models').click();
  assert.equal(anotherKey.requests.filter(r => r.path === '/api/ai/models/test').length, 1);
  const anotherAccount = settings({models: ['working'], storage: ui.storage, connection: 'draft-identity'});
  anotherAccount.context.signedInUser = {user_id: 'test:other'};
  await anotherAccount.context.renderAiPanels('settings');
  await anotherAccount.element('ai-fetch-models').click();
  assert.equal(anotherAccount.requests.filter(r => r.path === '/api/ai/models/test').length, 1);
});

test('an invalid checkpoint fails closed until explicit fresh recheck', async () => {
  const ui = settings({models: ['working']});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').click();
  const key = [...ui.storage.keys()].find(k => k.startsWith('vjbot_ai_scan_v1:'));
  ui.storage.set(key, '{invalid');
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 1);
  assert.match(ui.element('ai-model-status').textContent, /Tiến độ kiểm tra đã lưu không hợp lệ/);
  ui.element('ai-recheck-all').checked = true;
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 2);
});

test('continuing a checkpoint honors its persisted quota cooldown before dispatching new models', async () => {
  const ui = settings({models: ['working']});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').click();
  const key = [...ui.storage.keys()].find(k => k.startsWith('vjbot_ai_scan_v1:'));
  const cached = JSON.parse(ui.storage.get(key)), resumeAt = Date.now() + 30000;
  ui.storage.set(key, JSON.stringify({...cached, catalog: ['working', 'new-model'], nextAt: resumeAt}));
  const reloaded = settings({models: ['working', 'new-model'], storage: ui.storage});
  await reloaded.context.renderAiPanels('settings');
  await reloaded.element('ai-fetch-models').click();
  const calls = reloaded.requests.filter(r => r.path === '/api/ai/models/test');
  assert.deepEqual(calls.map(r => r.body.model), ['new-model']);
  assert.ok(calls[0].at >= resumeAt);
});

test('another active scan lock prevents duplicate probes or resetting its checkpoint', async () => {
  const ui = settings({models: ['working']});
  await ui.context.renderAiPanels('settings');
  await ui.element('ai-fetch-models').click();
  const before = JSON.stringify([...ui.storage]);
  ui.element('ai-recheck-all').checked = true;
  ui.context.navigator = {locks: {request: async (_name, _options, callback) => callback(null)}};
  await ui.element('ai-fetch-models').click();
  assert.equal(ui.requests.filter(r => r.path === '/api/ai/models/test').length, 1);
  assert.equal(JSON.stringify([...ui.storage]), before);
  assert.match(ui.element('ai-model-status').textContent, /Một lượt kiểm tra khác/);
});

test('late OAuth readiness cannot reopen chat after switching method or account', async () => {
  for (const changeAccount of [false, true]) {
    const ui = settings({activeChoice: {value: {scope: 'none', id: ''}}});
    let oauth = true, release;
    ui.context.usesAntigravityOAuth = () => oauth;
    ui.context.antigravityConnectionId = () => 'first';
    const api = ui.context.apiFetch;
    ui.context.apiFetch = (path, options) => path === '/api/ai/oauth/antigravity'
      ? new Promise(resolve => { release = resolve; }) : api(path, options);
    const earlier = ui.context.checkAiReady();
    await new Promise(resolve => setImmediate(resolve));
    oauth = false;
    if (changeAccount) ui.context.signedInUser = {user_id: 'test:other'};
    await ui.context.checkAiReady();
    release(Response.json({configured: true, connections:[{id:'first', state:'active', model:'gemini-chat'}]}));
    await earlier;
    assert.equal(ui.element('chat-input').disabled, true);
    assert.equal(ui.element('btn-send-message').disabled, true);
    assert.equal(ui.element('chat-ai-gate').hidden, false);
  }
});

test('unified chooser groups API and OAuth accounts without duplicating profile controls', async () => {
  const ui = settings();
  ui.context.savedOAuthConnections = () => [{id:'oauth-first', name:'Personal Google', model:'native-chat'}];
  await ui.context.renderAiPanels('settings');
  const groups = ui.element('ai-profile-list').children.filter(child => child.label);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].children.map(option => option.value), ['server:saved-profile']);
  assert.equal(groups[1].children[0].value, 'oauth:oauth-first');
  assert.match(groups[1].children[0].textContent, /Personal Google/);
  assert.equal(ui.requests.some(request => request.path.includes('/models')), false);
});

test('adding an API draft preserves the selected saved connection and unsaved fields on reopen', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  ui.element('ai-profile-new').click();
  ui.element('ai-profile-name').value = 'Unsaved draft';
  ui.element('ai-key').value = 'unsaved-secret';
  await ui.context.renderAiPanels('settings');
  assert.equal(ui.element('ai-profile-list').value, 'server:saved-profile');
  assert.equal(ui.element('ai-profile-name').value, 'Unsaved draft');
  assert.equal(ui.element('ai-key').value, 'unsaved-secret');
  assert.equal(JSON.stringify([...ui.storage]).includes('unsaved-secret'), false);
  await ui.element('ai-api-back').click();
  assert.equal(ui.element('ai-profile-list').value, 'server:saved-profile');
  assert.equal(ui.element('ai-profile-name').value, 'Saved provider');
  assert.equal(ui.element('ai-key').value, '');
  assert.equal(ui.element('ai-current-model').textContent, 'paid');
  assert.equal(ui.requests.some(request => request.path.includes('/models')), false);
});

test('selecting OAuth delegates explicit activation and leaves the API voice profile unchanged', async () => {
  const ui = settings();
  await ui.context.renderAiPanels('settings');
  const previous = JSON.stringify(ui.activeChoice.value);
  let connection;
  ui.context.selectAntigravityConnection = async id => { connection = id; };
  ui.element('ai-profile-list').value = 'oauth:second';
  await ui.element('ai-profile-list').events.change();
  assert.equal(connection, 'second');
  assert.equal(JSON.stringify(ui.activeChoice.value), previous);
});

test('OAuth readiness is pinned to the selected row, not the server active connection', async () => {
  const ui = settings();
  ui.context.usesAntigravityOAuth = () => true;
  let connection = 'first';
  ui.context.antigravityConnectionId = () => connection;
  const api = ui.context.apiFetch;
  ui.context.apiFetch = (path, options) => path === '/api/ai/oauth/antigravity'
    ? Promise.resolve(Response.json({configured:true, connected:true, state:'active', model:'other-model',
      connections:[{id:'first', state:'reconnect_required', model:'old'}, {id:'second', state:'active', model:'ready'}]}))
    : api(path, options);
  await ui.context.checkAiReady();
  assert.equal(ui.element('chat-input').disabled, true);
  connection = 'second';
  await ui.context.checkAiReady();
  assert.equal(ui.element('chat-input').disabled, false);
});

test('late OAuth readiness cannot reopen chat after changing only the OAuth connection ID', async () => {
  const ui = settings();
  let connection = 'first', release;
  ui.context.usesAntigravityOAuth = () => true;
  ui.context.antigravityConnectionId = () => connection;
  ui.context.apiFetch = () => new Promise(resolve => { release = resolve; });
  ui.element('chat-input').disabled = true;
  const pending = ui.context.checkAiReady();
  await new Promise(resolve => setImmediate(resolve));
  connection = 'second';
  release(Response.json({configured:true, connections:[{id:'first', state:'active', model:'ready'}]}));
  await pending;
  assert.equal(ui.element('chat-input').disabled, true);
});

test('saving a dedicated voice key leaves chat selection and its unsaved API editor unchanged', async () => {
  const ui=settings();
  await ui.context.renderAiPanels('settings');
  ui.element('ai-profile-new').click();
  ui.element('ai-profile-name').value='Unsaved chat draft';
  ui.element('ai-key').value='unsaved-chat-key';
  const before=JSON.stringify(ui.activeChoice.value);
  const voice=await ui.context.saveVoiceProfile('test:owner',{name:'Voice only',api_key:'synthetic-voice-key'},'local');
  const stored=ui.deviceProfiles.get(voice.id);
  assert.equal(stored.protocol,'gemini');
  assert.equal(stored.base_url,'https://generativelanguage.googleapis.com');
  assert.equal(stored.model,'');
  assert.equal(JSON.stringify(ui.activeChoice.value),before);
  assert.equal(ui.element('ai-profile-name').value,'Unsaved chat draft');
  assert.equal(ui.element('ai-key').value,'unsaved-chat-key');
  assert.equal(ui.requests.some(request=>request.path.includes('/models')),false);
});

test('official OpenAI voice saving fixes its endpoint and empty chat model without changing chat',async()=>{
  const ui=settings();
  await ui.context.renderAiPanels('settings');
  const before=JSON.stringify(ui.activeChoice.value);
  const voice=await ui.context.saveVoiceProfile('test:owner',{name:'OpenAI voice',api_key:'synthetic-openai-key',
    protocol:'openai',base_url:'https://ignored.example'},'local');
  const stored=ui.deviceProfiles.get(voice.id);
  assert.equal(stored.protocol,'openai');
  assert.equal(stored.base_url,'https://api.openai.com/v1');
  assert.equal(stored.model,'');
  assert.equal(JSON.stringify(ui.activeChoice.value),before);
  assert.equal(ui.requests.some(request=>request.path==='/api/tts'||request.path.includes('/models')),false);
  await assert.rejects(ui.context.saveVoiceProfile('test:owner',{name:'Unsupported',api_key:'synthetic-key',protocol:'anthropic'},'local'),/Gemini|OpenAI/);
});

test('regular startup restores only personal voice metadata without selecting chat or discovering models',async()=>{
  const ui=settings();
  const rendered=[];
  ui.context.renderVoiceProfiles=(...args)=>rendered.push(args);
  await ui.context.loadVoiceProfiles();
  assert.equal(rendered.length,1);
  assert.equal(rendered[0][0],'test:owner');
  assert.equal(rendered[0][1][0].scope,'server');
  assert.equal(rendered[0][2],true);
  assert.equal(rendered[0][3],undefined);
  assert.equal(ui.activeChoice.value,null);
  assert.deepEqual(ui.requests.map(request=>request.path),['/api/ai/profiles']);
});


for (const loader of ['loadVoiceProfiles', 'renderAiPanels']) {
  for (const failed of [false, true]) test(`late ${loader} metadata ${failed ? 'failure' : 'success'} cannot discard a newly saved voice`, async () => {
    const ui = settings();
    await ui.context.renderAiPanels('settings');
    ui.element('ai-profile-new').click();
    ui.element('ai-profile-name').value = 'Unchanged chat draft';
    const before = JSON.stringify(ui.activeChoice.value), rendered = [];
    ui.context.renderVoiceProfiles = (_owner, rows) => rendered.push(rows);
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const original = ui.context.apiFetch;
    ui.context.apiFetch = (path, options) => path === '/api/ai/profiles'
      ? new Promise(resolve => { release = resolve; started(); }) : original(path, options);
    const pending = loader === 'renderAiPanels' ? ui.context.renderAiPanels('settings') : ui.context.loadVoiceProfiles();
    await ready;
    const saved = await ui.context.saveVoiceProfile('test:owner', {name:'New voice', api_key:'new-synthetic-voice'}, 'local');
    assert.ok(rendered.at(-1).some(row => row.scope === saved.scope && row.id === saved.id));
    const count = rendered.length;
    release(Response.json(failed ? {detail:'Late metadata failure'} : {profiles:[], can_store:false}, {status:failed ? 503 : 200}));
    await pending;
    assert.equal(rendered.length, count);
    assert.ok(rendered.at(-1).some(row => row.scope === saved.scope && row.id === saved.id));
    assert.equal(JSON.stringify(ui.activeChoice.value), before);
    assert.equal(ui.element('ai-profile-name').value, 'Unchanged chat draft');
  });
}

test('admin settings and readiness ignore stale API/OAuth selections and blocked personal storage', async () => {
  const storage=new Map([['vjbot_ai_method:test:owner','antigravity'],['vjbot_ai_oauth:test:owner','old-oauth']]);
  const activeChoice={value:{scope:'local',id:'old-api'}},ui=settings({storage,activeChoice});
  ui.context.signedInUser.is_admin=true;
  ui.context.dispatchEvent(new Event('vjbot-voice-changed'));
  const blocked=()=>{throw new Error('Personal storage must not be touched');};
  ui.context.VJProfiles=new Proxy({}, {get:blocked});
  ui.context.localStorage=new Proxy({}, {get:blocked});
  ui.context.usesAntigravityOAuth=ui.context.renderAntigravityOAuth=ui.context.savedOAuthConnections=blocked;
  let rendered=0;
  ui.context.renderAdminAISettings=()=>{rendered++;};
  ui.context.apiFetch=async path=>{
    ui.requests.push({path});
    assert.equal(path,'/api/ai/settings');
    return Response.json({source:'platform',is_admin:true,platform:{configured:true},own:{model:'stale-private-model'}});
  };
  await ui.context.renderAiPanels('settings');
  await ui.context.loadVoiceProfiles();
  ui.context.refreshSavedConnections();
  await ui.context.checkAiReady();
  assert.equal(rendered,1);
  assert.equal(ui.element('.classroom-chat-window').dataset.ai,'ready');
  assert.equal(ui.element('chat-input').disabled,false);
  assert.deepEqual(ui.requests.map(request=>request.path),['/api/ai/settings']);
  assert.deepEqual(activeChoice.value,{scope:'local',id:'old-api'});
  assert.equal(storage.get('vjbot_ai_method:test:owner'),'antigravity');
  assert.equal(storage.get('vjbot_ai_oauth:test:owner'),'old-oauth');
});

test('unconfigured managed OpenAI fails readiness without using a saved personal model', async () => {
  const ui=settings({activeChoice:{value:{scope:'server',id:'saved-profile'}}});
  ui.context.signedInUser.is_admin=true;
  ui.context.apiFetch=async path=>{
    ui.requests.push({path});
    return Response.json({source:'platform',is_admin:true,platform:{configured:false},own:{model:'saved-private-model'}});
  };
  await ui.context.checkAiReady();
  assert.equal(ui.element('chat-input').disabled,true);
  assert.match(ui.element('chat-gate-title').textContent,/OPENAI_API_KEY/);
  assert.equal(ui.element('chat-gate-open').textContent,'Mô hình quản trị');
  assert.deepEqual(ui.requests.map(request=>request.path),['/api/ai/settings']);
});

test('late personal metadata after promotion never reads storage or overwrites managed state', async () => {
  const ui=settings();
  let finish;
  ui.context.apiFetch=()=>new Promise(resolve=>{finish=resolve;});
  const pending=ui.context.renderAiPanels('settings');
  ui.context.signedInUser.is_admin=true;
  ui.context.dispatchEvent(new Event('vjbot-voice-changed'));
  let reads=0;
  ui.context.VJProfiles.list=async()=>{reads++;return [];};
  finish(Response.json({profiles:[],can_store:true}));
  await pending;
  assert.equal(reads,0);
  assert.equal(ui.element('ai-form').hidden,true);
});

test('admin settings alias hides personal controls and demotion restores them without mutating choices', async () => {
  const storage=new Map([['vjbot_ai_method:test:owner','antigravity']]),ui=settings({storage});
  const before=JSON.stringify([...storage]);
  ui.element('settings-admin-ai').hidden=true;
  vm.runInContext(readFileSync('static/admin-ai.js','utf8'),ui.context);
  ui.context.signedInUser.is_admin=true;
  ui.context.dispatchEvent(new Event('vjbot-voice-changed'));
  assert.equal(ui.context.showSettingsArea('api'),'admin');
  assert.equal(ui.element('ai-card').hidden,true);
  assert.equal(ui.element('settings-api-nav').hidden,true);
  assert.equal(ui.element('settings-admin-ai').hidden,false);
  assert.equal(ui.element('settings-admin-nav').hidden,false);
  ui.context.signedInUser.is_admin=false;
  ui.context.dispatchEvent(new Event('vjbot-voice-changed'));
  assert.equal(ui.context.showSettingsArea('api'),'api');
  assert.equal(ui.element('ai-card').hidden,false);
  assert.equal(ui.element('settings-api-nav').hidden,false);
  assert.equal(ui.element('settings-admin-ai').hidden,true);
  assert.equal(ui.element('settings-admin-nav').hidden,true);
  assert.equal(JSON.stringify([...storage]),before);
  assert.equal(ui.requests.length,0);
});

test('managed model settings keep reasoning and Live preferences with explicit configuration errors', async () => {
  const ui=settings(),rendered=[];
  ui.context.signedInUser.is_admin=true;
  ui.context.renderVoiceProfiles=(...args)=>rendered.push(args);
  const requests=[];
  ui.context.apiFetch=async(path,options={})=>{
    requests.push({path,options});
    assert.equal(path,'/api/admin/ai');
    return Response.json(options.method==='PUT'?{ok:true}:{
      configured:false,models:[{id:'managed-model',efforts:['low','high']}],voices:['shida','harema'],
      settings:{model:'managed-model',reasoning_effort:'high',live_voice:'harema'}
    });
  };
  vm.runInContext(readFileSync('static/admin-ai.js','utf8'),ui.context);
  await ui.context.renderAdminAISettings();
  assert.equal(ui.element('admin-text-model').value,'managed-model');
  assert.equal(ui.element('admin-reasoning').value,'high');
  assert.equal(ui.element('admin-live-voice').value,'harema');
  assert.match(ui.element('admin-ai-message').textContent,/OPENAI_API_KEY/);
  assert.equal(rendered.at(-1)[3].configured,false);
  await ui.element('admin-ai-form').events.submit({preventDefault(){}});
  assert.deepEqual(JSON.parse(requests.at(-1).options.body),
    {model:'managed-model',reasoning_effort:'high',live_voice:'harema'});
  assert.equal(ui.requests.length,0);
});

test('late managed preferences cannot populate a different owner or a demoted account', async () => {
  for(const change of ['owner','role']) {
    const ui=settings();
    ui.context.signedInUser.is_admin=true;
    let finish;
    ui.context.apiFetch=()=>new Promise(resolve=>{finish=resolve;});
    vm.runInContext(readFileSync('static/admin-ai.js','utf8'),ui.context);
    const pending=ui.context.renderAdminAISettings();
    if(change==='owner')ui.context.signedInUser={user_id:'other',is_admin:true};
    else ui.context.signedInUser.is_admin=false;
    ui.context.dispatchEvent(new Event('vjbot-voice-changed'));
    finish(Response.json({configured:true,models:[{id:'old-model',efforts:['high']}],voices:['shida'],
      settings:{model:'old-model',reasoning_effort:'high',live_voice:'shida'}}));
    await pending;
    assert.equal(ui.element('admin-text-model').children.length,0);
    assert.equal(ui.element('admin-ai-save').disabled,true);
    assert.doesNotMatch(ui.element('admin-model-preview').textContent,/old-model/);
  }
});

test('unreadable settings responses give Vietnamese recovery while authored errors stay specific',async()=>{
  const ui=settings();
  let calls=0;
  ui.context.apiFetch=async()=>{calls++;return new Response('<html>Unavailable</html>',{status:502});};
  await ui.context.renderAiPanels('settings');
  assert.match(ui.element('ai-status').textContent,/Máy chủ trả về dữ liệu không đọc được/);
  assert.match(ui.element('ai-status').textContent,/không được tự động gửi lại/);
  assert.doesNotMatch(ui.element('ai-status').textContent,/SyntaxError|Unexpected token|<html>/);
  assert.equal(calls,1);
  const detail='Kết nối này cần được cấp lại quyền truy cập.';
  ui.context.apiFetch=async()=>Response.json({detail},{status:409});
  await ui.context.renderAiPanels('settings');
  assert.equal(ui.element('ai-status').textContent,detail);
});

test('connection key visibility and storage help remain Vietnamese without changing fields',async()=>{
  const ui=settings();
  await ui.context.renderAiPanels('settings');
  assert.equal(ui.element('ai-key').type,'password');
  assert.equal(ui.element('ai-key-toggle').attributes['aria-label'],'Hiện khóa API');
  ui.element('ai-key-toggle').events.click();
  assert.equal(ui.element('ai-key').type,'text');
  assert.equal(ui.element('ai-key-toggle').attributes['aria-label'],'Ẩn khóa API');
  ui.element('ai-profile-storage').value='local';
  ui.element('ai-profile-storage').events.change();
  assert.match(ui.element('ai-profile-storage-hint').textContent,/mã hóa.*không đồng bộ/);
  assert.match(ui.element('ai-profile-storage-hint').textContent,/Trình duyệt bị xâm nhập vẫn có thể truy cập khóa/);
  ui.element('ai-profile-storage').value='server';
  ui.element('ai-profile-storage').events.change();
  assert.match(ui.element('ai-profile-storage-hint').textContent,/lưu mã hóa trên máy chủ/);
  assert.match(ui.element('ai-profile-storage-hint').textContent,/Thiết bị khác đăng nhập cùng tài khoản/);
  assert.equal(ui.requests.some(request=>request.path.includes('/models')),false);
});
