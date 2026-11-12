import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync('static/speech-models.js','utf8');
function fixture(apiFetch) {
  const nodes = new Map(['speech-model','speech-model-status','speech-model-refresh'].map(id => [id, {
    value:'gemini-3.8-flash-tts', textContent:'', children:[], events:{},
    addEventListener(name, action) {this.events[name] = action;},
    replaceChildren() {this.children = [];}, append(option) {this.children.push(option);}
  }]));
  const store = new Map();
  let profile = {scope:'local',id:'gemini-one'}, stops = 0;
  const window = {VJProfiles:{active:() => profile}};
  const c = vm.createContext({window, signedInUser:{user_id:'alice'}, AbortController,
    document:{getElementById:id => nodes.get(id), createElement:() => ({})},
    localStorage:{getItem:key => store.get(key) || null,setItem:(key,value) => store.set(key,value)},
    apiFetch, stopSpeech() {stops++;}
  });
  vm.runInContext(source,c);
  return {c,window,nodes,store,stops:() => stops,profile:value => {profile = value;}};
}
const catalog = models => Response.json({models,voice:'Charon',verified:false});

test('new catalog models are offered without replacing the current speech selection or generating audio', async () => {
  const calls = [];
  let models = ['gemini-3.8-flash-tts'];
  const f = fixture(async (_url, options) => {calls.push(JSON.parse(options.body));return catalog(models);});
  await f.window.refreshSpeechModels();
  const select = f.nodes.get('speech-model');
  models = [...models,'gemini-3.8-flash-lite-tts'];
  await f.window.refreshSpeechModels();
  assert.equal(select.value,'gemini-3.8-flash-tts');
  assert.deepEqual(select.children.map(o => o.value),models);
  assert.ok(calls.every(body => body.action === 'models' && body.text === undefined));
  select.value = models[1]; select.events.change();
  assert.equal(f.window.selectedSpeechModel(),models[1]);
  assert.equal(f.stops(),1);
  await f.window.refreshSpeechModels();
  assert.equal(select.value,models[1]);
});

test('a removed selected model stays explicit instead of silently changing to the first catalog row', async () => {
  const f = fixture(async () => catalog(['gemini-3.8-flash-tts']));
  const select = f.nodes.get('speech-model');
  select.value = 'gemini-3.8-flash-lite-tts'; select.events.change();
  await f.window.refreshSpeechModels();
  assert.equal(select.value,'gemini-3.8-flash-lite-tts');
  assert.equal(f.window.selectedSpeechModel(),'gemini-3.8-flash-lite-tts');
  assert.deepEqual(select.children.map(o => o.value),['gemini-3.8-flash-lite-tts','gemini-3.8-flash-tts']);
});

test('catalog responses from another API profile cannot overwrite the current profile selection', async () => {
  let finish;
  const f = fixture(async () => new Promise(resolve => {finish = resolve;}));
  const old = f.window.refreshSpeechModels();
  f.profile({scope:'server',id:'different'});
  finish(catalog(['gemini-3.8-flash-tts-old']));
  await old;
  assert.ok(!f.nodes.get('speech-model').children.some(o => o.value === 'gemini-3.8-flash-tts-old'));
  assert.equal(f.window.selectedSpeechModel(),'gemini-3.8-flash-tts');
});

test('speech choices remain isolated per signed-in account and selected profile', async () => {
  const f = fixture(async () => catalog(['gemini-3.8-flash-tts','gemini-3.8-flash-lite-tts']));
  const select = f.nodes.get('speech-model');
  select.value = 'gemini-3.8-flash-lite-tts'; select.events.change();
  f.profile({scope:'local',id:'gemini-two'});
  assert.equal(f.window.selectedSpeechModel(),'gemini-3.8-flash-tts');
  f.profile({scope:'local',id:'gemini-one'});
  assert.equal(f.window.selectedSpeechModel(),'gemini-3.8-flash-lite-tts');
  f.c.signedInUser = {user_id:'bob'};
  assert.equal(f.window.selectedSpeechModel(),'gemini-3.8-flash-tts');
});
