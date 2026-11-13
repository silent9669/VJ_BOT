import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync('static/speech-models.js','utf8');
const base = 'https://generativelanguage.googleapis.com';
const profileRow = (id, scope = 'local', patch = {}) => ({id,scope,name:id,protocol:'gemini',base_url:base,...patch});
function fixture(apiFetch, {store = new Map(), voices = new Map([['alice',{scope:'local',id:'gemini-one'}]]), admin = false, unavailable = false} = {}) {
  const nodes = new Map(['speech-model','speech-model-status','speech-model-refresh','speech-profile','ai-oauth-voice-hint',
    'speech-key-form','speech-key-add','speech-key','speech-key-name','speech-key-storage','speech-key-save',
    'speech-key-toggle','speech-key-status','speech-test','speech-key-cancel','speech-key-server','speech-key-provider','speech-model-label',
    'speech-account-controls','speech-personal-setup','speech-managed-summary'].map(id => [id, {
    value:'', textContent:'', children:[], events:{}, disabled:false, hidden:true,
    focus() {}, setAttribute() {}, reportValidity() {return true;},
    reset() {for(const id of ['speech-key','speech-key-name'])nodes.get(id).value='';},
    addEventListener(name, action) {this.events[name] = action;},
    replaceChildren() {this.children = [];}, append(option) {this.children.push(option);}
  }]));
  const events = new EventTarget();
  let changes = 0, broken = unavailable, chat = {scope:'server',id:'chat-only'};
  events.addEventListener('vjbot-voice-changed', () => {changes++;});
  const window = {
    addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),
    VJProfiles:{
      active:() => chat,
      voice:owner => {if (broken) throw new Error('storage unavailable');return voices.get(owner) || null;},
      setVoice(owner, value) {
        if (broken) throw new Error('storage unavailable');
        const previous = JSON.stringify(voices.get(owner)); voices.set(owner, value);
        if (previous !== JSON.stringify(value)) events.dispatchEvent(new Event('vjbot-voice-changed'));
      }
    }
  };
  const c = vm.createContext({window, signedInUser:{user_id:'alice',is_admin:admin}, AbortController, Event,
    document:{getElementById:id => nodes.get(id), createElement:() => ({children:[],append(child){this.children.push(child);}})},
    localStorage:{getItem:key => {if (broken) throw new Error('storage');return store.get(key) ?? null;},
      setItem:(key,value) => {if (broken) throw new Error('storage');store.set(key,value);}},
    apiFetch
  });
  vm.runInContext(source,c);
  const rows = [profileRow('gemini-one'),profileRow('gemini-two'),profileRow('different','server')];
  window.renderVoiceProfiles('alice', rows);
  return {c,window,nodes,store,voices,rows,changes:() => changes,broken:value => {broken = value;},
    profile:value => {voices.set(c.signedInUser.user_id, value);},chat:value => {chat = value;}};
}
const catalog = models => Response.json({models,voice:'Charon',verified:false});
const defaultModel = 'gemini-3.8-flash-tts', alternate = 'gemini-3.8-flash-lite-tts';

test('new catalog models are offered without replacing the current speech selection or generating audio', async () => {
  const calls = [];
  let models = [defaultModel];
  const f = fixture(async (_url, options) => {calls.push(JSON.parse(options.body));return catalog(models);});
  assert.equal(calls.length,0);
  await f.window.refreshSpeechModels();
  const select = f.nodes.get('speech-model');
  models = [...models,alternate];
  await f.window.refreshSpeechModels();
  assert.equal(select.value,defaultModel);
  assert.deepEqual(select.children.map(o => o.value),models);
  assert.ok(calls.every(body => body.action === 'models' && body.text === undefined));
  select.value = alternate; select.events.change();
  assert.equal(f.window.selectedSpeechModel(),alternate);
  assert.equal(f.changes(),1);
  await f.window.refreshSpeechModels();
  assert.equal(select.value,alternate);
  select.events.change();
  assert.equal(f.changes(),1);
});

test('a removed selected model stays explicit instead of silently changing to the first catalog row', async () => {
  const f = fixture(async () => catalog([defaultModel]));
  const select = f.nodes.get('speech-model');
  select.value = alternate; select.events.change();
  await f.window.refreshSpeechModels();
  assert.equal(select.value,alternate);
  assert.equal(f.window.selectedSpeechModel(),alternate);
  assert.deepEqual(select.children.map(o => o.value),[alternate,defaultModel]);
});

test('catalog responses from another voice profile or owner cannot overwrite the current selection', async () => {
  for (const change of ['profile','owner']) {
    let finish;
    const f = fixture(async () => new Promise(resolve => {finish = resolve;}));
    const old = f.window.refreshSpeechModels();
    if (change === 'profile') f.profile({scope:'server',id:'different'});
    else f.c.signedInUser = {user_id:'bob'};
    f.window.dispatchEvent(new Event('vjbot-voice-changed'));
    finish(catalog(['gemini-3.8-flash-tts-old']));
    await old;
    assert.ok(!f.nodes.get('speech-model').children.some(o => o.value === 'gemini-3.8-flash-tts-old'));
    assert.equal(f.window.selectedSpeechModel(),change === 'profile' ? defaultModel : '');
  }
});

test('speech model and voice identity restore per owner/profile, never from chat selection', async () => {
  const f = fixture(async () => catalog([defaultModel,alternate]));
  const identity = f.window.voiceIdentity(), select = f.nodes.get('speech-model');
  select.value = alternate; select.events.change();
  f.chat({scope:'local',id:'unrelated-chat'});
  assert.equal(f.window.voiceIdentity(),identity);
  assert.equal(f.window.selectedSpeechModel(),alternate);
  f.profile({scope:'local',id:'gemini-two'});
  assert.equal(f.window.selectedSpeechModel(),defaultModel);
  f.profile({scope:'local',id:'gemini-one'});
  assert.equal(f.window.selectedSpeechModel(),alternate);
  const reloaded = fixture(async () => {throw new Error('Opening settings must not request a catalog');}, {store:f.store,voices:f.voices});
  assert.equal(reloaded.nodes.get('speech-model').value,alternate);
  assert.equal(reloaded.window.voiceIdentity(),identity);
  f.c.signedInUser = {user_id:'bob'};
  assert.equal(f.window.voiceIdentity(),'');
  assert.equal(f.window.selectedSpeechModel(),'');
  f.profile({scope:'local',id:'gemini-one'});
  assert.equal(f.window.selectedSpeechModel(),'');
  f.window.renderVoiceProfiles('bob',f.rows);
  assert.equal(f.window.selectedSpeechModel(),defaultModel);
});

test('metadata, opening controls and explicit voice changes never fetch a catalog automatically', async () => {
  const calls = [];
  const f = fixture(async (_url, options) => {calls.push(JSON.parse(options.body));return catalog([defaultModel]);});
  f.window.renderVoiceProfiles('alice',f.rows);
  f.window.selectedSpeechModel(); f.window.voiceIdentity();
  assert.equal(calls.length,0);
  const accounts = f.nodes.get('speech-profile');
  accounts.value = 'local:gemini-two';
  await accounts.events.change();
  assert.equal(calls.length,0);
  assert.equal(f.window.voiceIdentity(),JSON.stringify(['alice','local','gemini-two']));
  assert.equal(f.changes(),1);
  accounts.value = 'local:gemini-two';
  await accounts.events.change();
  assert.equal(calls.length,0);
  accounts.value = '';await accounts.events.change();
  assert.equal(f.window.voiceIdentity(),'');
  assert.equal(calls.length,0);
});

test('unsupported or inaccessible choices remain explicit and never rotate to another saved Gemini account', () => {
  const f = fixture(async () => {throw new Error('No automatic fetch');});
  f.profile({scope:'server',id:'missing'});
  f.window.renderVoiceProfiles('alice',f.rows);
  assert.equal(f.nodes.get('speech-profile').value,'server:missing');
  assert.equal(f.nodes.get('speech-model-refresh').disabled,true);
  assert.deepEqual(f.voices.get('alice'),{scope:'server',id:'missing'});
  f.profile({scope:'server',id:'proxy'});
  f.window.renderVoiceProfiles('alice',[...f.rows,profileRow('proxy','server',{base_url:'https://proxy.example.com'})]);
  const flatten = options => options.flatMap(option => [option,...flatten(option.children || [])]);
  assert.ok(!flatten(f.nodes.get('speech-profile').children).some(option => option.textContent === 'proxy'));
  assert.equal(f.nodes.get('speech-profile').value,'server:proxy');
  assert.equal(f.nodes.get('speech-model-refresh').disabled,true);
  f.broken(true);
  f.window.dispatchEvent(new Event('vjbot-voice-changed'));
  assert.equal(f.window.voiceIdentity(),'');
  assert.equal(f.window.selectedSpeechModel(),'');
});

test('corrupt speech preferences fail closed until explicitly replaced', async () => {
  const f = fixture(async () => catalog([defaultModel,alternate]));
  f.store.set('vjbot_speech_model:' + f.window.voiceIdentity(),'../../other');
  assert.equal(f.window.selectedSpeechModel(),'');
  await f.window.refreshSpeechModels();
  assert.equal(f.nodes.get('speech-model').value,'');
  f.nodes.get('speech-model').value = alternate;
  f.nodes.get('speech-model').events.change();
  assert.equal(f.window.selectedSpeechModel(),alternate);
});

test('deleting or changing selected server credentials cancels the old catalog without fetching on metadata load', async () => {
  let finish, calls = 0;
  const f = fixture(async () => {calls++;return new Promise(resolve => {finish = resolve;});});
  f.profile({scope:'server',id:'different'});
  f.window.renderVoiceProfiles('alice',f.rows);
  const before = f.changes();
  const pending = f.window.refreshSpeechModels();
  f.window.renderVoiceProfiles('alice',f.rows.filter(row => row.id !== 'different'));
  assert.equal(f.changes(),before + 1);
  finish(catalog(['gemini-3.8-flash-tts-old']));await pending;
  assert.equal(calls,1);
  assert.ok(!f.nodes.get('speech-model').children.some(o => o.value === 'gemini-3.8-flash-tts-old'));
});

test('owner changes clear visible metadata and other-tab model changes emit voice cancellation without requests', () => {
  let calls = 0;
  const f = fixture(async () => {calls++;return catalog([defaultModel]);});
  const key = f.window.voiceIdentity(), before = f.changes();
  f.store.set('vjbot_speech_model:' + key,alternate);
  const event = new Event('storage');
  Object.defineProperty(event,'key',{value:'vjbot_speech_model:' + key});
  f.window.dispatchEvent(event);
  assert.equal(f.changes(),before + 1);
  assert.equal(f.nodes.get('speech-model').value,alternate);
  f.c.signedInUser = {user_id:'bob'};
  f.window.dispatchEvent(new Event('vjbot-voice-changed'));
  const flattened = f.nodes.get('speech-profile').children.flatMap(option => [option,...(option.children || [])]);
  assert.ok(!flattened.some(option => option.value === 'local:gemini-one'));
  assert.equal(f.window.voiceIdentity(),'');
  assert.equal(calls,0);
});

test('saving a voice key selects only the saved voice reference, clears raw input and sends no generation', async () => {
  let requests = 0, saved;
  const f = fixture(async () => {requests++;return catalog([defaultModel]);});
  f.window.saveVoiceProfile = async (owner, input, scope) => {
    saved = {owner,input,scope};
    f.window.renderVoiceProfiles(owner,[...f.rows,profileRow('new-voice')]);
    return {scope:'local',id:'new-voice',name:input.name};
  };
  f.nodes.get('speech-key-add').events.click();
  f.nodes.get('speech-key-name').value = 'New voice';
  f.nodes.get('speech-key').value = 'synthetic-voice-key';
  await f.nodes.get('speech-key-form').events.submit({preventDefault(){}});
  assert.equal(saved.owner,'alice');
  assert.equal(saved.input.api_key,'synthetic-voice-key');
  assert.equal(f.voices.get('alice').scope,'local');
  assert.equal(f.voices.get('alice').id,'new-voice');
  assert.equal(f.window.VJProfiles.active().id,'chat-only');
  assert.equal(f.nodes.get('speech-key').value,'');
  assert.equal(f.nodes.get('speech-key-form').hidden,true);
  assert.equal(requests,0);
});

test('a late voice save never changes a newer voice choice or reveals an old owner draft', async () => {
  for(const change of ['voice','owner']) {
    let finish;
    const f = fixture(async()=>catalog([defaultModel]));
    f.window.saveVoiceProfile = () => new Promise(resolve=>{finish=resolve;});
    f.nodes.get('speech-key-add').events.click();
    f.nodes.get('speech-key').value='synthetic-voice-key';
    const saving=f.nodes.get('speech-key-form').events.submit({preventDefault(){}});
    if(change==='voice')f.profile({scope:'local',id:'gemini-two'});
    else f.c.signedInUser={user_id:'bob'};
    f.window.dispatchEvent(new Event('vjbot-voice-changed'));
    finish({scope:'local',id:'late-voice',name:'Late voice'});
    await saving;
    assert.equal(f.voices.get('alice').id,change==='voice'?'gemini-two':'gemini-one');
    assert.equal(f.voices.has('bob'),false);
    assert.equal(f.nodes.get('speech-key').value,'');
  }
});

test('Gemini and owned OpenAI choices keep provider-specific models without catalog fallback', async () => {
  let calls=0;
  const f=fixture(async()=>{calls++;return Response.json({models:['gpt-4o-mini-tts'],voice:'alloy'});});
  const rows=[...f.rows,profileRow('openai','server',{protocol:'openai',base_url:'https://api.openai.com/v1',model:''})];
  const accounts=f.nodes.get('speech-profile'),select=f.nodes.get('speech-model');
  select.value=alternate;select.events.change();
  f.window.renderVoiceProfiles('alice',rows,true,{configured:true,model:'chat-model-not-tts'});
  accounts.value='server:openai';accounts.events.change();
  assert.equal(f.window.selectedSpeechModel(),'gpt-4o-mini-tts');
  assert.equal(f.nodes.get('speech-model-label').textContent,'Speech model · alloy');
  await f.window.refreshSpeechModels();
  assert.deepEqual(select.children.map(option=>option.value),['gpt-4o-mini-tts']);
  assert.equal(f.window.VJProfiles.active().id,'chat-only');
  accounts.value='local:gemini-one';accounts.events.change();
  assert.equal(f.window.selectedSpeechModel(),alternate);
  assert.equal(f.nodes.get('speech-model-label').textContent,'Speech model · Charon');
  assert.equal(calls,1);
});

test('regular users never gain a platform choice from stale metadata or saved preferences', () => {
  const f=fixture(async()=>{throw new Error('No automatic fetch');});
  const accounts=f.nodes.get('speech-profile');
  const flatten=rows=>rows.flatMap(row=>[row,...flatten(row.children || [])]);
  f.window.renderVoiceProfiles('alice',f.rows,false,{configured:true});
  assert.ok(!flatten(accounts.children).some(row=>row.value==='platform:openai'));
  f.profile({scope:'platform',id:'openai'});
  f.window.dispatchEvent(new Event('vjbot-voice-changed'));
  assert.equal(accounts.value,'platform:openai');
  assert.equal(f.window.selectedSpeechModel(),'');
  assert.equal(f.nodes.get('speech-test').disabled,true);
  assert.equal(f.voices.get('alice').scope,'platform');
});

test('OpenAI catalog cannot replace a Gemini selection and Listen only invokes the audio consumer', async () => {
  const f=fixture(async()=>Response.json({models:['gpt-4o-mini-tts'],voice:'alloy'}));
  await f.window.refreshSpeechModels();
  assert.match(f.nodes.get('speech-model-status').textContent,/Invalid speech model catalog/);
  assert.equal(f.window.selectedSpeechModel(),defaultModel);
  let listened;
  f.window.playGeminiTTS=(text,options)=>{listened={text,options};};
  f.nodes.get('speech-test').events.click();
  assert.equal(listened.options.japaneseOnly,true);
  assert.match(listened.text,/こんにちは/);
});


test('identical selected voice metadata and chat changes preserve a pending voice catalog', async () => {
  let finish, signal, calls = 0;
  const f = fixture(async (_path, options) => {
    calls++; signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = f.window.refreshSpeechModels();
  const message = f.nodes.get('speech-model-status').textContent;
  f.chat({scope:'local', id:'new-chat'});
  f.window.renderVoiceProfiles('alice', f.rows.map(row => ({...row})), true);
  assert.equal(signal.aborted, false);
  assert.equal(f.nodes.get('speech-model-refresh').disabled, true);
  assert.equal(f.nodes.get('speech-model-status').textContent, message);
  finish(catalog([defaultModel, alternate]));
  await pending;
  assert.equal(calls, 1);
  assert.deepEqual(f.nodes.get('speech-model').children.map(option => option.value), [defaultModel, alternate]);
  assert.equal(f.nodes.get('speech-model-refresh').disabled, false);
});

for (const field of ['connection_id', 'key_last4']) test(`changed selected voice ${field} cancels a pending catalog even with the same profile ID`, async () => {
  let finish, signal;
  const f = fixture(async (_path, options) => {
    signal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = f.window.refreshSpeechModels(), before = f.changes();
  f.window.renderVoiceProfiles('alice', f.rows.map(row => row.id === 'gemini-one' ? {...row, [field]:'changed'} : {...row}));
  assert.equal(signal.aborted, true);
  assert.equal(f.changes(), before + 1);
  finish(catalog([defaultModel, alternate]));
  await pending;
  assert.deepEqual(f.nodes.get('speech-model').children.map(option => option.value), [defaultModel]);
});

test('admin voice needs neither profile APIs nor browser storage and never discovers or generates automatically', async () => {
  let calls=0,listens=0;
  const store=new Map([['vjbot_ai_method:alice','antigravity'],['vjbot_speech_model:stale','private-model']]);
  const f=fixture(async()=>{calls++;throw new Error('No automatic requests');},{admin:true,unavailable:true,store});
  delete f.window.VJProfiles;
  const before=JSON.stringify([...store]),voices=JSON.stringify([...f.voices]);
  assert.equal(f.window.voiceIdentity(),JSON.stringify(['alice','platform','openai']));
  assert.equal(f.window.selectedSpeechModel(),'gpt-4o-mini-tts');
  for(const id of ['speech-profile','speech-key-add','speech-account-controls','speech-personal-setup','speech-key-form'])
    assert.equal(f.nodes.get(id).hidden,true,id);
  assert.equal(f.nodes.get('speech-managed-summary').hidden,false);
  assert.equal(f.nodes.get('speech-test').disabled,false);
  assert.equal(f.nodes.get('speech-model-refresh').disabled,true);
  assert.match(f.nodes.get('speech-model-status').textContent,/gpt-4o-mini-tts.*alloy/);
  await f.window.refreshSpeechModels();
  f.nodes.get('speech-profile').events.change();
  f.nodes.get('speech-model').events.change();
  f.nodes.get('speech-key-add').events.click();
  assert.equal(calls,0);
  f.window.playGeminiTTS=()=>{listens++;};
  f.nodes.get('speech-test').events.click();
  assert.equal(listens,1);
  assert.equal(JSON.stringify([...store]),before);
  assert.equal(JSON.stringify([...f.voices]),voices);
});

test('admin configuration failure is visible and never borrows a private voice', () => {
  const f=fixture(async()=>{throw new Error('No automatic requests');},{admin:true,unavailable:true});
  f.window.renderVoiceProfiles('alice',f.rows,true,{configured:false});
  assert.match(f.nodes.get('speech-model-status').textContent,/OPENAI_API_KEY/);
  assert.equal(f.nodes.get('speech-test').disabled,true);
  assert.equal(f.window.voiceIdentity(),JSON.stringify(['alice','platform','openai']));
  assert.equal(f.window.selectedSpeechModel(),'gpt-4o-mini-tts');
  assert.equal(f.voices.get('alice').id,'gemini-one');
  f.c.signedInUser={user_id:'bob',is_admin:true};
  f.window.dispatchEvent(new Event('vjbot-voice-changed'));
  assert.equal(f.window.voiceIdentity(),JSON.stringify(['bob','platform','openai']));
  assert.equal(f.nodes.get('speech-test').disabled,false);
  assert.doesNotMatch(f.nodes.get('speech-model-status').textContent,/OPENAI_API_KEY/);
});

test('promotion cancels a personal catalog and demotion restores personal controls and preferences unchanged', async () => {
  let finish,signal,calls=0;
  const f=fixture(async(_path,options)=>{
    calls++;signal=options.signal;return new Promise(resolve=>{finish=resolve;});
  });
  f.nodes.get('speech-model').value=alternate;
  f.nodes.get('speech-model').events.change();
  const beforeStore=JSON.stringify([...f.store]),beforeVoices=JSON.stringify([...f.voices]);
  const pending=f.window.refreshSpeechModels();
  f.c.signedInUser.is_admin=true;
  f.broken(true);
  f.window.dispatchEvent(new Event('vjbot-voice-changed'));
  assert.equal(signal.aborted,true);
  assert.equal(f.window.selectedSpeechModel(),'gpt-4o-mini-tts');
  finish(catalog([defaultModel,alternate]));
  await pending;
  assert.equal(f.nodes.get('speech-model').value,'gpt-4o-mini-tts');
  f.broken(false);
  f.c.signedInUser.is_admin=false;
  f.window.dispatchEvent(new Event('vjbot-voice-changed'));
  f.window.renderVoiceProfiles('alice',f.rows);
  assert.equal(f.window.selectedSpeechModel(),alternate);
  assert.equal(f.window.voiceIdentity(),JSON.stringify(['alice','local','gemini-one']));
  for(const id of ['speech-profile','speech-key-add','speech-account-controls','speech-personal-setup'])
    assert.equal(f.nodes.get(id).hidden,false,id);
  assert.equal(f.nodes.get('speech-managed-summary').hidden,true);
  assert.equal(JSON.stringify([...f.store]),beforeStore);
  assert.equal(JSON.stringify([...f.voices]),beforeVoices);
  assert.equal(calls,1);
});
