import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const root = '/api/ai/oauth/antigravity';
function controller({choice = 'first', method = 'antigravity', respond, storage = new Map()} = {}) {
  const elements = new Map(), requests = [], timers = new Map();
  let timerId = 0, active = 'first';
  let connections = [{id:'first', name:'Personal', model:'saved-first', state:'active'},
    {id:'second', name:'Work', model:'saved-second', state:'active'}];
  function node(tag = '') {
    return {tag, value:'', textContent:'', children:[], attributes:{}, dataset:{}, hidden:false, disabled:false,
      get options() { return this.children; },
      append(...items) { this.children.push(...items); if (tag === 'select' && !this.value && items[0]) this.value = items[0].value; },
      replaceChildren(...items) { this.children = items; this.value = ''; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus() {},
      querySelectorAll() { return []; }};
  }
  function element(id) {
    if (!elements.has(id)) elements.set(id, node(id === 'ai-oauth-model' ? 'select' : ''));
    return elements.get(id);
  }
  if (choice !== null) storage.set('vjbot_ai_oauth:test:owner', choice);
  storage.set('vjbot_ai_method:test:owner', method);
  const context = vm.createContext({Response, URL, Date, console, signedInUser:{user_id:'test:owner'},
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,value)},
    usesAntigravityOAuth:id => storage.get('vjbot_ai_method:' + id) === 'antigravity',
    antigravityConnectionId:id => { const value = storage.get('vjbot_ai_oauth:' + id); return /^[A-Za-z0-9_-]{1,128}$/.test(value || '') ? value : null; },
    setTimeout:fn => { const id = ++timerId; timers.set(id,fn); return id; }, clearTimeout:id => timers.delete(id),
    document:{getElementById:element, createElement:node},
    apiFetch:async (path, options = {}) => {
      const request = {path, method:options.method || 'GET', body:JSON.parse(options.body || '{}')};
      requests.push(request);
      const custom = respond && await respond(request);
      if (custom) return custom;
      if (path === root && request.method === 'DELETE') {
        connections = connections.filter(row => row.id !== request.body.connection_id);
        if (active === request.body.connection_id) active = null;
        return Response.json({ok:true});
      }
      if (path === root) return Response.json({configured:true, missing:[], connections, active_id:active, pending:null});
      if (path.includes('/connections/')) { active = path.includes('/second/') ? 'second' : 'first'; return Response.json({ok:true}); }
      if (path.includes('/models?')) return Response.json({models:['saved-first','saved-second','draft-candidate']});
      if (path.includes('/usage?')) return Response.json({connection_id:new URL(path,'https://local.test').searchParams.get('connection_id'),
        available:true, checked_at:'2026-11-12T00:00:00Z', models:[{model:'native-tiered', remaining_fraction:0.5, reset_at:null}]});
      if (path.endsWith('/model')) return Response.json({model:request.body.model});
      if (path.endsWith('/start')) return Response.json({handle:'pending', expires_at:Date.now()+60000, authorization_url:'https://accounts.google.com/o/oauth2/auth?state=opaque'});
      if (path.endsWith('/status')) { active = 'second'; return Response.json({status:'ok', connection_id:'second'}); }
      throw new Error('Unexpected endpoint: ' + path);
    }});
  context.window = context;
  context.addEventListener = () => {};
  context.open = () => null;
  vm.runInContext(readFileSync('static/antigravity-oauth.js','utf8'),context);
  return {context, element, requests, storage, async poll() { const [id,fn] = [...timers][0]; timers.delete(id); await fn(); }};
}
const text = node => node.textContent + node.children.map(text).join(' ');

test('first restore uses backend active only for a missing local ID, never explicit none or a deleted choice', async () => {
  for (const choice of [null, '', 'deleted']) {
    const ui = controller({choice});
    await ui.context.renderAntigravityOAuth();
    assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'), choice === null ? 'first' : choice);
    assert.equal(ui.requests.some(row => row.path.includes('/usage?')), choice === null);
    assert.equal(ui.requests.some(row => row.path.endsWith('/model')), false);
  }
});

test('selecting a saved OAuth account activates only that ID without generating or touching API selection', async () => {
  const ui = controller();
  ui.storage.set('vjbot_api_active:test:owner','voice-api-profile');
  await ui.context.renderAntigravityOAuth();
  await ui.context.selectAntigravityConnection('second');
  assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'),'second');
  assert.equal(ui.storage.get('vjbot_api_active:test:owner'),'voice-api-profile');
  assert.ok(ui.requests.some(row => row.path === root + '/connections/second/activate' && row.method === 'POST'));
  assert.equal(ui.requests.some(row => row.path.endsWith('/model')),false);
  assert.ok(ui.requests.some(row => row.path === root + '/usage?connection_id=second'));
});

test('Add OAuth preserves the current method until a completed login returns its new connection ID', async () => {
  const ui = controller({method:'key'});
  await ui.context.renderAntigravityOAuth();
  ui.element('ai-method-oauth').onclick();
  assert.equal(ui.storage.get('vjbot_ai_method:test:owner'),'key');
  await ui.element('ai-oauth-connect').onclick();
  assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'),'first');
  await ui.poll();
  assert.equal(ui.storage.get('vjbot_ai_method:test:owner'),'antigravity');
  assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'),'second');
  assert.equal(ui.requests.some(row => row.method === 'DELETE'),false);
});

test('quota rendering preserves native IDs, distinguishes zero from unknown, and labels past resets', async () => {
  const ui = controller({respond:request => request.path.includes('/usage?') ? Response.json({connection_id:'first', available:true,
    checked_at:'2026-11-12T00:00:00Z', models:[
      {model:'native-tiered<script>', remaining_fraction:0, reset_at:'2020-01-01T00:00:00Z'},
      {model:'native-other', remaining_fraction:null, reset_at:null},
      {model:'native-half', remaining_fraction:0.375, reset_at:null} ]}) : null});
  await ui.context.renderAntigravityOAuth();
  const rows = ui.element('ai-oauth-usage-models').children.map(text);
  assert.match(rows[0], /native-tiered<script>.*0% remaining · exhausted.*Historical reset/);
  assert.match(rows[1], /Remaining usage unknown.*Reset unknown/);
  assert.match(rows[2], /37.5% remaining/);
  assert.equal(ui.element('ai-oauth-usage-meter').value, 0);
  assert.equal(ui.element('ai-oauth-usage-meter').hidden, false);
  assert.deepEqual(ui.element('ai-oauth-usage-models').children.map(row => row.children
    .filter(child => child.tag === 'meter').map(meter => meter.value)), [[0], [], [0.375]]);
  assert.equal(ui.element('ai-oauth-usage').attributes['aria-busy'],'false');
  assert.equal(ui.requests.some(row => row.path.endsWith('/model')),false);
});

test('late catalog and quota replies cannot overwrite a newly selected OAuth account', async () => {
  const releases = [];
  const ui = controller({respond:request => request.path.endsWith('connection_id=first') ? new Promise(resolve => {
    releases.push(() => resolve(Response.json(request.path.includes('/models?') ? {models:['stale-model']} : {
      connection_id:'first', available:true, checked_at:'2026-11-12T00:00:00Z', models:[{model:'stale-quota', remaining_fraction:0}]})));
  }) : null});
  const earlier = ui.context.renderAntigravityOAuth();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.length,2);
  await ui.context.selectAntigravityConnection('second');
  releases.forEach(release => release());
  await earlier;
  assert.equal(ui.element('ai-oauth-model').value,'saved-second');
  assert.doesNotMatch(text(ui.element('ai-oauth-usage-models')),/stale-quota/);
});

test('model refresh restores the saved model, status refresh leaves an uncommitted dropdown alone', async () => {
  const ui = controller();
  await ui.context.renderAntigravityOAuth();
  ui.element('ai-oauth-model').value = 'draft-candidate';
  const quotaCalls = ui.requests.filter(row => row.path.includes('/usage?')).length;
  await ui.context.renderAntigravityOAuth();
  assert.equal(ui.element('ai-oauth-model').value,'draft-candidate');
  ui.element('ai-oauth-model').onchange();
  assert.equal(ui.element('ai-oauth-use').hidden, false);
  assert.equal(ui.element('ai-oauth-test-hint').hidden, false);
  assert.equal(ui.requests.filter(row => row.path.includes('/usage?')).length,quotaCalls);
  await ui.element('ai-oauth-refresh').onclick();
  assert.equal(ui.element('ai-oauth-model').value,'saved-first');
  assert.equal(ui.element('ai-oauth-use').hidden, true);
  ui.element('ai-oauth-model').value = 'draft-candidate';
  await ui.element('ai-oauth-use').onclick();
  const probes = ui.requests.filter(row => row.path.endsWith('/model'));
  assert.equal(ui.element('ai-oauth-use').hidden, true);
  assert.equal(probes.length,1);
  assert.deepEqual(probes[0].body,{connection_id:'first', model:'draft-candidate'});
});

test('deleting one OAuth connection sends an explicit ID, retains others and persists no selection', async () => {
  const ui = controller();
  await ui.context.renderAntigravityOAuth();
  await ui.element('ai-oauth-disconnect').onclick();
  assert.deepEqual(ui.requests.find(row => row.method === 'DELETE').body,{connection_id:'first'});
  assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'),'');
  assert.deepEqual(Array.from(ui.context.savedOAuthConnections(), row => row.id),['second']);
  await ui.context.renderAntigravityOAuth();
  assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'),'');
  assert.equal(ui.element('ai-oauth-usage').hidden,true);
});

test('switching VJBot owner discards pending model test output and never changes the new owner preference', async () => {
  let release;
  const ui = controller({respond:request => request.path.endsWith('/model') ? new Promise(resolve => { release = resolve; }) : null});
  await ui.context.renderAntigravityOAuth();
  const pending = ui.element('ai-oauth-use').onclick();
  await new Promise(resolve => setImmediate(resolve));
  ui.context.signedInUser = {user_id:'test:other'};
  ui.storage.set('vjbot_ai_method:test:other','key');
  release(Response.json({model:'stale-owner-result'}));
  await pending;
  assert.doesNotMatch(ui.element('ai-oauth-status').textContent,/stale-owner-result/);
  assert.equal(ui.storage.has('vjbot_ai_oauth:test:other'),false);
});

test('switching accounts during quota loading keeps refresh enabled after the new account finishes', async () => {
  let release;
  const ui = controller({respond:request => request.path === root + '/usage?connection_id=first'
    ? new Promise(resolve => { release = resolve; }) : null});
  ui.element('ai-oauth-panel').querySelectorAll = () => [ui.element('ai-oauth-usage-refresh')];
  const first = ui.context.renderAntigravityOAuth();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.element('ai-oauth-usage-refresh').disabled, true);
  await ui.context.selectAntigravityConnection('second');
  assert.equal(ui.element('ai-oauth-usage-refresh').disabled, false);
  release(Response.json({connection_id:'first', available:false, models:[]}));
  await first;
  assert.equal(ui.element('ai-oauth-usage-refresh').disabled, false);
});

test('managed administrators neither restore OAuth accounts nor read private browser preferences',async()=>{
  const ui=controller();
  const saved=[...ui.storage];
  ui.context.signedInUser.is_admin=true;
  ui.context.localStorage.getItem=()=>{throw new Error('Managed account must not read OAuth preferences');};
  await ui.context.renderAntigravityOAuth();
  assert.equal(ui.requests.length,0);
  assert.equal(ui.element('ai-oauth-panel').hidden,true);
  assert.equal(ui.element('ai-form').hidden,true);
  assert.equal(ui.context.savedOAuthConnections().length,0);
  assert.deepEqual([...ui.storage],saved);
});

test('promotion discards a late OAuth restore without replacing saved preferences and demotion restores them',async()=>{
  let release;
  const ui=controller({choice:null,respond:request=>request.path===root?new Promise(resolve=>{release=resolve;}):null});
  const restore=ui.context.renderAntigravityOAuth();
  ui.context.signedInUser.is_admin=true;
  release(Response.json({configured:true,connections:[{id:'late',name:'Late',model:'late',state:'active'}],active_id:'late'}));
  await restore;
  assert.equal(ui.storage.has('vjbot_ai_oauth:test:owner'),false);
  assert.equal(ui.context.savedOAuthConnections().length,0);
  ui.context.signedInUser.is_admin=false;
  const resumed=ui.context.renderAntigravityOAuth();
  release(Response.json({configured:true,connections:[{id:'original',name:'Original',model:'original',state:'active'}],active_id:'original'}));
  await resumed;
  assert.equal(ui.storage.get('vjbot_ai_oauth:test:owner'),'original');
  assert.equal(ui.context.savedOAuthConnections()[0].id,'original');
});
