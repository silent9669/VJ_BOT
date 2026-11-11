import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {scanner} from './fixtures/model-scan-clock.mjs';

function settings({consent = true} = {}) {
  const elements = new Map(), requests = [];
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
    VJModelScan: {plan: scanner.plan, run: options => scanner.run({...options,
      now: () => clock, sleep: async ms => { clock += ms; }})},
    document: {getElementById: element, querySelectorAll: () => [], querySelector: selector => element(selector),
      createElement: () => ({value: '', textContent: ''})},
    apiFetch: async (path, options = {}) => {
      requests.push({path, body: JSON.parse(options.body || '{}')});
      if (path === '/api/ai/settings') return Response.json(options.method === 'PUT' ? {ok: true} : {
        source: 'own', can_store: true,
        own: {protocol: 'openai', base_url: 'https://provider.example/v1', model: 'paid', key_last4: 'test'}
      });
      if (path === '/api/ai/models') return Response.json({models: ['paid', 'denied', 'working'], connection_id: 'bound-connection'});
      if (path === '/api/ai/models/test') {
        const {model} = JSON.parse(options.body);
        return model === 'working' ? Response.json({ok: true, model})
          : Response.json({detail: 'Synthetic denial', provider_status: model === 'paid' ? 402 : 403}, {status: 502});
      }
      throw new Error('Unexpected endpoint: ' + path);
    }
  });
  context.window = context;
  vm.runInContext(readFileSync('static/ai-settings.js', 'utf8'), context);
  return {context, element, requests};
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
  assert.ok(probes.every(request => request.body.connection_id === 'bound-connection'));
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
