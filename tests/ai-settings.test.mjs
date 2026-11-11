import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scanner} from './fixtures/model-scan-clock.mjs';

function settings({consent = true, models = ['paid', 'denied', 'working'], savedModel = 'paid', probe} = {}) {
  const elements = new Map(), requests = [], scanRuns = [];
  let clock = Date.now();
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
    confirm: () => { throw new Error('Browser confirmation must not be used for model checks'); },
    VJModelScan: {plan: scanner.plan, run: options => {
      scanRuns.push({mode: options.mode, dispatchedAt: options.dispatchedAt});
      return scanner.run({...options, now: () => clock, sleep: async ms => { clock += ms; }});
    }},
    document: {getElementById: element, querySelectorAll: () => [], querySelector: selector => element(selector),
      createElement: () => ({value: '', textContent: ''})},
    apiFetch: async (path, options = {}) => {
      requests.push({path, body: JSON.parse(options.body || '{}'), at: clock});
      if (path === '/api/ai/settings') return Response.json(options.method === 'PUT' ? {ok: true} : {
        source: 'own', can_store: true,
        own: {protocol: 'openai', base_url: 'https://provider.example/v1', model: savedModel, key_last4: 'test'}
      });
      if (path === '/api/ai/models') return Response.json({models, connection_id: `connection-${requests.length}`});
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
  return {context, element, requests, scanRuns};
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
  assert.equal(ui.requests.find(request => request.path === '/api/ai/settings' && request.body.model)?.body.model, 'working');
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
