import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';

const script=readFileSync('static/voice/voice-player.js','utf8');
const vi={type:'segment',index:0,lang:'vi',boundary:'start',speed:1,audioBase64:'SUQzBA==',mimeType:'audio/mpeg'};
const ja={...vi,index:1,lang:'ja',boundary:'sentence',speed:0.9};
const done={type:'done',count:2};
function response(...rows) {
  const data=rows.map(row=>JSON.stringify(row)+'\n').join('');
  const parts=data.match(/.{1,13}|\n/gu);
  return new Response(new ReadableStream({start(controller){for (const part of parts)controller.enqueue(new TextEncoder().encode(part));controller.close();}}),
    {headers:{'Content-Type':'application/x-ndjson'}});
}
function browser(fetch, prepare=async value=>value) {
  const configuration={version:2,mode:'single',admin_override:false};
  const history=[], slots=new Map();
  const context=vm.createContext({TextDecoder,AbortController,Response,
    apiFetch:async (_path,options)=>{history.push(['request',JSON.parse(options.body)]);return fetch(options);},
    speechStatus:message=>history.push(['status',message]), mascotMgr:{setState(){}},
    window:{addEventListener(){},VJVoiceRouting:{stored:()=>configuration,identity:()=> 'account-routing-revision',prepared:prepare},
      VJVoiceStitcher:{create:()=>({append:async part=>{history.push(['audio',part.lang]);},finish:async()=>{},stop(){}})},
      VJVoiceCache:{key:async (identity,text,ref)=>JSON.stringify([identity,text,ref]),get:async key=>slots.get(key),
        put:async (key,parts,persist)=>{history.push(['cache',persist]);slots.set(key,parts);},clearMemory:()=>slots.clear()}},
    taskReference:async task=>({id:task.id,revision:task.revision})});
  context.stopSpeech=()=>context.window.VJVoice.stop();
  vm.runInContext(script,context);
  return {voice:context.window.VJVoice,history};
}

test('fragmented NDJSON plays in order, even on replay, without a second API call or a private disk entry',async()=>{
  const {voice,history}=browser(()=>response(vi,ja,done));
  const options={lesson:{id:'lesson',level:'N5'},focus:{kind:'question',index:0},task:{id:'test',revision:'current'},privateAudio:true};
  await voice.speak('Xin chào. こんにちは。',options);
  await voice.speak('Xin chào. こんにちは。',options);
  assert.equal(history.filter(([event])=>event==='request').length,1);
  assert.deepEqual(history.filter(([event])=>event==='audio').map(([,lang])=>lang),['vi','ja','vi','ja']);
  assert.deepEqual(history.find(([event])=>event==='request')[1].task,options.task);
  assert.deepEqual(history.filter(([event])=>event==='cache'),[['cache',false]]);
});

test('cache separates bilingual and Japanese-only readings of the same text',async()=>{
  const {voice,history}=browser(()=>response({...ja,index:0,boundary:'start'},{type:'done',count:1}));
  const text='DVDを見ます。';
  await voice.speak(text);
  await voice.speak(text,{mode:'ja',reading:'みます'});
  await voice.speak(text,{mode:'ja',reading:'みる'});
  await voice.speak(text,{mode:'ja',reading:'みます'});
  assert.deepEqual(history.filter(([event])=>event==='request').map(([,request])=>[request.mode,request.reading]),[
    ['bilingual',undefined],['ja','みます'],['ja','みる']]);
});

test('partial streams play only available segments, signal failure and do not poison replay',async()=>{
  let count=0;
  const {voice,history}=browser(()=>++count===1?response(vi):response(vi,ja,done));
  await voice.speak('Xin chào. こんにちは。');
  assert.equal(history.some(([event,message])=>event==='status' && message.includes('chưa tải xong')),true);
  assert.equal(history.some(([event])=>event==='cache'),false);
  await voice.speak('Xin chào. こんにちは。');
  assert.equal(count,2);
  assert.deepEqual(history.filter(([event])=>event==='audio').map(([,lang])=>lang),['vi','vi','ja']);
});

test('a long stream replays all parts only after a fresh profile check',async()=>{
  const records=Array.from({length:16},(_,index)=>({...vi,index,lang:index%2?'ja':'vi'}));
  const preparations=[];
  let revoked=false;
  const {voice,history}=browser(()=>response(...records,{type:'done',count:16}),async (config,_signal,{replay})=>{
    preparations.push(replay);
    if (revoked) throw new Error('Kết nối giọng nói đã bị xóa.');
    return config;
  });
  await voice.speak('A bilingual explanation');
  await voice.speak('A bilingual explanation');
  revoked=true;
  await voice.speak('A bilingual explanation');
  assert.deepEqual(preparations,[false,true,true]);
  assert.equal(history.filter(([event])=>event==='request').length,1);
  assert.deepEqual(history.filter(([event])=>event==='audio').map(([,lang])=>lang),[...records,...records].map(row=>row.lang));
  assert.match(history.at(-1)[1],/đã bị xóa/);
});

test('the player keeps same-voice/model gain changes bounded unless the next peak needs less gain',async()=>{
  const pairs=[
    ['clone','model',0.5],
    ['clone','model',0.025],
    ['clone','model',0.95],
    ['clone','other-model',0.025],
    ['clone','other-model',0.025,1],
    ['clone','other-model',0.025],
    ['another-voice','other-model',0.5],
    [undefined,undefined,0.5],
    [undefined,undefined,0.025],
    ['another-voice',undefined,0.5],
    ['another-voice',undefined,0.025]
  ];
  const clipBuffers=pairs.map(([, , sample,peak])=>{
    const data=new Float32Array(1024).fill(sample);
    if (peak) data[512]=peak;
    return {duration:data.length/24000,length:data.length,sampleRate:24000,numberOfChannels:1,getChannelData:()=>data};
  });
  const gains=[], starts=[];
  const audioContext={state:'running',currentTime:0,destination:{},decodeAudioData:async()=>clipBuffers.shift(),
    createBufferSource(){
      return {playbackRate:{},connect:volume=>volume,disconnect(){},
        start(...args){starts.push(args);queueMicrotask(()=>this.onended?.());}};
    },
    createGain(){
      return {connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(gain){if (gain) gains.push(gain);}}};
    }};
  const window={addEventListener(){}};
  const context=vm.createContext({window,AbortController,TextDecoder,setTimeout,clearTimeout,atob,
    audioDataUrl:row=>`data:${row.mimeType};base64,${row.audioBase64}`});
  vm.runInContext(readFileSync('static/voice/audio-stitcher.js','utf8'),context);
  vm.runInContext(script,context);
  const audio=window.VJVoiceStitcher.create({audioContext});
  const clips=pairs.map(([voice,model],index)=>({...vi,voice,model,index,lang:index===1?'ja':'vi',
    boundary:index===1?'arrow':index?'inline':'start'}));
  await window.VJVoice.consume(response(...clips,{type:'done',count:clips.length}),audio.append,()=>true);
  await audio.finish();
  const normal=0.25178508235883346; // -18 dB RMS target / 0.5 input RMS.
  const expected=[normal,normal*1.35,normal*1.35*0.75,4,0.98,0.98*1.35,normal,normal,4,normal,4];
  assert.equal(gains.length,expected.length);
  for (const [index,gain] of gains.entries()) assert.ok(Math.abs(gain-expected[index])<1e-6,
    `gain for clip ${index}: ${gain}, expected ${expected[index]}`);
  assert.ok(Math.abs(starts[1][0]-starts[0][0]-starts[0][2]-0.26)<1e-8);
});

function settingsFixture(apiFetch,profileReads=[],storage=new Map(),withLive=false) {
  const nodes = new Map();
  function node(tag) {
    return {tag, value:'', children:[], events:{}, attributes:{}, dataset:{},
      get id(){return this.nodeId;},
      set id(id) {this.nodeId=id;nodes.set(id,this);},
      append(...children) {for (const child of children) child.parentElement=this; this.children.push(...children);},
      replaceChildren(...children) {this.children=[];this.append(...children);},
      prepend(child) {child.parentElement=this;this.children.unshift(child);},
      setAttribute(name,value){this.attributes[name]=value;},
      removeAttribute(name){delete this.attributes[name];},
      focus(){this.focused=true;}, addEventListener(event,handler){this.events[event]=handler;}};
  }
  const el=id=>nodes.get('voice-v2-'+id);
  for (const id of ['mode','slots','status','kind','url','url-field','storage','account','account-status','account-cancel',
    'add','remove','routing','preview','settings','key','key-toggle','confirm-title','confirm-description','name','active',
    'bilingual-tab','default-tab','reading-tab','reading-settings','live-tab','live-settings','use-default','default-note','default-status'])
    node('fixture').id='voice-v2-'+id;
  node('fixture').id='speech-legacy-settings';
  if (withLive) {
    for (const id of ['engine','turn','stt','stt-slot','stt-language']) node('select').id='voice-v2-live-'+id;
    node('input').id='voice-v2-live-barge';
    el('live-settings').hidden=true;
    node('label').id='voice-v2-live-stt-slot-field';
    node('div').id='voice-v2-live-options';
    node('p').id='voice-v2-live-browser-stt-hint';
  }
  const dialog=Object.assign(node('dialog'),{open:false,returnValue:'',
    showModal(){this.open=true;},
    close(value=''){this.open=false;this.returnValue=value;const handler=this.events.close;delete this.events.close;handler?.();}});
  dialog.id='voice-v2-confirm-dialog';
  const accountDialog=Object.assign(node('dialog'),{open:false,showModal(){this.open=true;},close(){this.open=false;}});
  accountDialog.id='voice-v2-account-dialog';
  el('account').reset=()=>{for(const id of ['key','name','url'])el(id).value='';el('kind').value='elevenlabs';};
  el('storage').options=[{},{}];
  const owner='learner', removed=[];
  const window = new EventTarget();
  window.removeVoiceProfile=async (...args)=>{removed.push(args);};
  const profiles = [
    {id:'a',scope:'local',name:'ElevenLabs',protocol:'elevenlabs',base_url:'https://api.elevenlabs.io',key_last4:'e123',revision:'1'},
    {id:'b',scope:'local',name:'Gemini',protocol:'gemini',base_url:'https://generativelanguage.googleapis.com',key_last4:'g123',revision:'1'},
    {id:'c',scope:'local',name:'Custom',protocol:'openai_compatible',base_url:'https://tts.example/v1',revision:'1'}
  ];
  const context = vm.createContext({window, signedInUser:{user_id:owner}, Event, CustomEvent, AbortController, AbortSignal, apiFetch,
    VJProfiles:{load:async (_owner,id)=>{profileReads.push('key');return {...profiles.find(profile=>profile.id===id),api_key:'synthetic-fixture-key'};},
      metadata:async (_owner,id)=>{profileReads.push('metadata');return profiles.find(profile=>profile.id===id);}},
    document:{getElementById:id=>nodes.get(id), createElement:node},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  vm.runInContext(readFileSync('static/voice/voice-settings.js','utf8'),context);
  const refresh=()=>window.renderVoiceProfiles(owner,profiles,false,undefined,true);
  refresh();
  function change(id,value) {el(id).value=value;el(id).events.change();}
  return {el,dialog,context,window,profiles,removed,refresh,change,
    saved:()=>JSON.parse(storage.get('vjbot_voice_routing_v2:'+owner)),
    prepare:options=>window.VJVoiceRouting.prepared(JSON.parse(storage.get('vjbot_voice_routing_v2:'+owner)),undefined,options),
    save:()=>el('routing').events.submit({preventDefault(){}}),
    catalog:()=>el('primary-catalog').events.click()};
}

// Keep IndexedDB records across page contexts; load the real routing, cache and player in each.
function persistentCache() {
  const records=new Map();
  const db={transaction(){
    let pending=0;
    const tx={objectStore:()=>({
      get:key=>request(()=>structuredClone(records.get(key))),
      put:(value,key)=>request(()=>records.set(key,structuredClone(value))),
      delete:key=>request(()=>records.delete(key))
    })};
    function request(action) {
      const req={};
      pending++;
      queueMicrotask(()=>{
        req.result=action();
        req.onsuccess?.();
        if (!--pending) tx.oncomplete();
      });
      return req;
    }
    return tx;
  }};
  return {records,indexedDB:{open(){
    const req={result:db};
    queueMicrotask(()=>req.onsuccess());
    return req;
  }}};
}

test('legacy identity replay migrates current synthesis audio without reading keys and ignores prior audio versions',async()=>{
  const oldConfig={version:2,mode:'dual_split_api',admin_override:false,
    primary:{profile:{scope:'local',id:'a'},provider:'elevenlabs',model:'reader',voice_id:'voice',speed:0.9,kanji_mode:'kana_first'},
    ja:{profile:null,speed:0.8,kanji_mode:'kanji_native'},
    vi:{profile:{scope:'local',id:'b'},provider:'gemini',speed:1.1}};
  const text='Xin chào. こんにちは。', options={cacheAudio:true,lesson:{id:'lesson',level:'N5'}};
  const reference={mode:'bilingual',lesson:options.lesson,focus:null,view:'checks'};
  const oldIdentity=JSON.stringify([JSON.stringify(['learner',false]),oldConfig,
    ['https://api.elevenlabs.io',null,'e123','1'],['https://generativelanguage.googleapis.com',null,'g123','1']]);
  const oldKey=createHash('sha256').update(JSON.stringify(['synthesis-5',oldIdentity,text.normalize('NFC'),reference])).digest('hex');
  const staleKey=createHash('sha256').update(JSON.stringify(['synthesis-4',oldIdentity,text.normalize('NFC'),reference])).digest('hex');
  const storage=new Map([['vjbot_voice_routing_v2:learner',JSON.stringify({...oldConfig,live:{engine:'cascaded',stt_source:'browser'}})]]);
  const {records,indexedDB}=persistentCache(), reads=[], requests=[];
  function loadPage() {
    const {window,context}=settingsFixture(path=>{requests.push(path);throw new Error('Unexpected API request');},reads,storage);
    const audio=[], statuses=[];
    window.VJVoiceStitcher={create:()=>({append:async part=>{audio.push(part);},finish:async()=>{},stop(){}})};
    Object.assign(context,{indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,mascotMgr:{setState(){}},
      stopSpeech:()=>window.VJVoice.stop(),speechStatus:message=>statuses.push(message)});
    vm.runInContext(readFileSync('static/voice/audio-cache.js','utf8'),context);
    vm.runInContext(script,context);
    return {window,context,audio,statuses};
  }
  const {window:seed}=loadPage();
  await seed.VJVoiceCache.put(staleKey,[vi],true);
  await seed.VJVoiceCache.put(oldKey,[vi,ja],true);
  assert.equal(records.has(oldKey),true);
  const routing=seed.VJVoiceRouting, identity=routing.identity(routing.stored());
  assert.doesNotMatch(identity,/e123|g123|synthetic-fixture-key/);
  const newKey=await seed.VJVoiceCache.key(identity,text,reference);
  assert.notEqual(newKey,oldKey);

  const revoked=loadPage(), metadata=revoked.context.VJProfiles.metadata;
  revoked.context.VJProfiles.metadata=async (...args)=>({...await metadata(...args),revision:'revoked'});
  await revoked.window.VJVoice.speak(text,options);
  assert.match(revoked.statuses.at(-1),/đã đổi/);
  assert.deepEqual(revoked.audio,[]);
  assert.equal(records.has(newKey),false);

  const upgraded=loadPage();
  await upgraded.window.VJVoice.speak(text,options);
  assert.deepEqual(upgraded.audio,[vi,ja]);
  await new Promise(setImmediate);
  assert.equal(records.has(newKey),true);

  records.delete(oldKey);
  const reloaded=loadPage();
  await reloaded.window.VJVoice.speak(text,options);
  assert.deepEqual(reloaded.audio,[vi,ja]);
  assert.deepEqual(requests,[]);
  assert.deepEqual(reads,Array(5).fill('metadata'));
});

test('saved dual routing preserves single speed across reload without changing either dual speed',()=>{
  const storage=new Map();
  const first=settingsFixture(undefined,[],storage);
  first.change('primary-profile','local:b');
  first.el('primary-speed').value='0.8';
  first.save();
  first.change('mode','dual_same_api');
  first.el('ja-speed').value='1.1';
  first.el('vi-speed').value='0.9';
  first.save();
  const reloaded=settingsFixture(undefined,[],storage);
  reloaded.save();
  assert.deepEqual([reloaded.saved().ja.speed,reloaded.saved().vi.speed],[1.1,0.9]);
  reloaded.change('mode','single');
  reloaded.save();
  assert.equal(reloaded.saved().primary.speed,0.8);
});

test('switches only the affected voice overrides and uses valid speeds for blank inputs',()=>{
  const {el,profiles,refresh,change,save,saved}=settingsFixture();
  change('mode','dual_same_api');change('primary-profile','local:a');
  el('ja-voice').value='old_ja';el('vi-voice').value='old_vi';
  change('primary-profile','local:b');
  el('ja-speed').value=el('vi-speed').value='';
  save();
  assert.deepEqual([saved().ja.speed,saved().vi.speed,saved().ja.voice_id,saved().vi.voice_id],[1,1,undefined,undefined]);
  change('mode','dual_split_api');change('ja-profile','local:a');
  el('ja-voice').value='keep_ja';el('vi-voice').value='old_gemini';
  profiles[1]={...profiles[1],protocol:'openai',base_url:'https://api.openai.com/v1',revision:'2'};
  refresh();
  save();
  assert.deepEqual([saved().primary.provider,saved().ja.voice_id,saved().vi.voice_id],['openai','keep_ja',undefined]);
});

test('hiding split settings in single-voice mode preserves the draft for both languages',()=>{
  const {el,change,save,saved}=settingsFixture();
  change('primary-profile','local:b');
  change('mode','dual_split_api');
  change('ja-profile','local:a');change('vi-profile','local:a');
  el('ja-voice').value='ja_clone';el('vi-voice').value='vi_clone';
  change('mode','single');change('mode','dual_split_api');
  save();
  assert.deepEqual([saved().ja.voice_id,saved().vi.voice_id],['ja_clone','vi_clone']);
});

test('shared and split modes preserve each configured voice draft without applying IDs to another provider',()=>{
  const {el,change,save,saved}=settingsFixture();
  change('primary-profile','local:b');
  change('mode','dual_same_api');
  el('ja-voice').value='shared_ja';
  change('mode','dual_split_api');
  change('ja-profile','local:a');
  el('ja-voice').value='split_ja';
  change('mode','dual_same_api'); save();
  assert.equal(saved().ja.voice_id,'shared_ja');
  change('primary-profile','local:c');
  el('primary-voice').value='custom_fallback';
  el('primary-model').value='custom_model';
  change('mode','dual_split_api'); save();
  assert.equal(saved().ja.voice_id,'split_ja');
  assert.equal(saved().ja.profile.id,'a');
});

test('voice account modal shows only custom URLs and clears revealed secrets on navigation or owner change',()=>{
  const {el,change,context,window}=settingsFixture();
  for(const event of ['hashchange','vjbot-voice-changed','vjbot-account-ready']){
    context.signedInUser={user_id:'learner'};
    el('add').events.click();
    change('kind','openai_compatible');
    assert.equal(el('url-field').hidden,false);
    assert.equal(el('url').required,true);
    el('url').value='https://placeholder.example/v1';
    change('kind','mistral');
    assert.equal(el('url-field').hidden,true);
    assert.equal(el('url').disabled,true);
    assert.equal(el('url').value,'');
    el('key').value='synthetic-draft';
    el('key').type='password';
    el('key-toggle').events.click();
    assert.equal(el('key').type,'text');
    assert.equal(el('account-dialog').open,true);
    if(event==='vjbot-voice-changed')context.signedInUser=null;
    if(event==='vjbot-account-ready')context.signedInUser={user_id:'new-owner'};
    window.dispatchEvent(new Event(event));
    assert.equal(el('account-dialog').open,false);
    assert.equal(el('key').type,'password');
    assert.equal(el('key').value,'');
    assert.equal(el('add').focused,undefined);
  }
});

test('dismissing the voice account dialog returns focus to Add Connection',()=>{
  for (const cancel of [
    el=>el('account-cancel').events.click(),
    el=>el('account-dialog').events.cancel(new Event('cancel',{cancelable:true}))
  ]) {
    const {el}=settingsFixture();
    el('add').events.click();
    el('key').value='synthetic-draft';
    cancel(el);
    assert.equal(el('account-dialog').open,false);
    assert.equal(el('key').value,'');
    assert.equal(el('add').focused,true);
  }
});

test('catalog keeps paging after model selection but starts fresh after a profile switch',async()=>{
  const cursors=[];
  const {el,change,catalog}=settingsFixture(async (_path,request)=>{
    const {cursor}=JSON.parse(request.body);cursors.push(cursor);
    return Response.json({models:[{id:'model'}],voices:[{id:cursor?'second':'first',name:'Voice'}],next_cursor:cursor?null:'next'});
  });
  change('primary-profile','local:a');
  await catalog();
  el('primary-model').value='model';
  await catalog();
  change('primary-profile','local:b');change('primary-profile','local:a');
  await catalog();
  assert.deepEqual(cursors,[undefined,'next',undefined]);
  assert.deepEqual(el('voices-primary').children.map(option=>option.value),['first']);
});

test('ElevenLabs catalog suggests models but keeps the blank default and guides restricted keys',async()=>{
  let code;
  const {el,change,catalog,save,saved}=settingsFixture(async ()=>{
    if (code) return Response.json({code,detail:'Provider refused the request.'},{status:code==='tts_billing'?402:403});
    return Response.json({models:['eleven_v3','eleven_turbo_v2_5','eleven_flash_v2_5','custom_model'].map(id=>({id,languages:['ja','vi']})),voices:[]});
  });
  change('primary-profile','local:a');
  await catalog();
  assert.deepEqual(el('models-primary').children.map(({value,textContent})=>[value,textContent]),[
    ['eleven_v3','Ưu tiên độ rõ Nhật–Việt · ja · vi'],['eleven_turbo_v2_5','Nhanh và rõ cho hội thoại · ja · vi'],
    ['eleven_flash_v2_5','Ưu tiên tốc độ · mặc định · ja · vi'],['custom_model','ja · vi']
  ]);
  code='tts_billing';
  await catalog();
  assert.equal(el('primary-catalog-status').textContent,'Provider refused the request.');
  code='tts_catalog_permission';
  await catalog();
  assert.match(el('primary-catalog-status').textContent,/quyền đọc giọng và model.*nhập tay ID giọng.*để trống hoặc nhập eleven_v3 hay eleven_turbo_v2_5/);
  el('primary-voice').value='manual_voice';
  await save();
  assert.equal(saved().primary.voice_id,'manual_voice');
  assert.ok(!saved().primary.model);
  change('primary-profile','local:b');
  assert.equal(el('primary-catalog-status').textContent,'');
});

test('an in-flight split catalog cannot announce after the slot switches to the primary catalog',async()=>{
  const sent=Promise.withResolvers(), reply=Promise.withResolvers();
  const {el,change}=settingsFixture(async ()=>{
    sent.resolve();
    return reply.promise;
  });
  change('primary-profile','local:a');
  change('mode','dual_split_api');
  change('ja-profile','local:a');
  const pending=el('ja-catalog').events.click();
  await sent.promise;
  change('mode','dual_same_api');
  reply.resolve(Response.json({code:'tts_catalog_permission'},{status:403}));
  await pending;
  assert.equal(el('ja-catalog-status').hidden,true);
  assert.equal(el('ja-catalog-status').textContent,'');
  assert.equal(el('primary-catalog-status').textContent,'');
});

test('Mistral catalog labels clones and known presets across pages without changing option values',async()=>{
  const cursors=[];
  const {el,profiles,refresh,change,catalog}=settingsFixture(async (_path,request)=>{
    const {cursor}=JSON.parse(request.body);cursors.push(cursor);
    return Response.json({models:[{id:'voxtral-mini-tts-3-0'}],voices:cursor ? [
      {id:'voice_3144',name:'Huong',category:'premade',lang:'vi'},
      {id:'voice_unknown',name:'Other provider voice',category:'premade'}
    ] : [
      {id:'clone_id',name:'Teacher',category:'cloned'},
      {id:'voice_3133',name:'Haruto',category:'premade',lang:'ja'}
    ],next_cursor:cursor?null:'next'});
  });
  profiles.push({id:'m',scope:'local',name:'Mistral',protocol:'openai',base_url:'https://api.mistral.ai/v1',revision:'1'});
  refresh();change('primary-profile','local:m');
  await catalog();
  await catalog();
  assert.deepEqual(cursors,[undefined,'next']);
  assert.deepEqual(el('voices-primary').children.map(option=>[option.value,option.textContent]),[
    ['clone_id','Teacher · Giọng nhân bản'],['voice_3133','Haruto · Tiếng Nhật (nam)'],
    ['voice_3144','Huong · Tiếng Việt (nữ)'],['voice_unknown','Other provider voice']
  ]);
});

test('Mistral dual same-account hints describe only blank effective IDs and never save the defaults as overrides',()=>{
  const {el,profiles,refresh,change,save,saved}=settingsFixture();
  profiles.push({id:'m',scope:'local',name:'Mistral',protocol:'openai',base_url:'https://api.mistral.ai/v1',revision:'1'});
  refresh();change('primary-profile','local:m');
  const jaHint=el('ja-preset-hint'), viHint=el('vi-preset-hint');
  assert.equal(jaHint.hidden,true);assert.equal(viHint.hidden,true);
  change('mode','dual_same_api');
  assert.equal(jaHint.hidden,false);assert.equal(viHint.hidden,false);
  assert.match(jaHint.textContent,/Haruto/);assert.match(viHint.textContent,/Huong/);
  el('ja-voice').value='ja_clone';
  el('ja-voice').events.input();
  assert.equal(jaHint.hidden,true);assert.equal(viHint.hidden,false);
  save();
  assert.deepEqual([saved().primary.voice_id,saved().ja.voice_id,saved().vi.voice_id],[undefined,'ja_clone',undefined]);
  el('primary-voice').value='shared_clone';
  el('primary-voice').events.input();
  assert.equal(jaHint.hidden,true);assert.equal(viHint.hidden,true);
  save();
  assert.deepEqual([saved().primary.voice_id,saved().ja.voice_id,saved().vi.voice_id],['shared_clone','ja_clone',undefined]);
  el('primary-voice').value=' ';
  el('primary-voice').events.input();
  assert.equal(viHint.hidden,false);
  change('mode','dual_split_api');
  assert.equal(jaHint.hidden,true);assert.equal(viHint.hidden,true);
});

test('custom speed is opt-in and cannot follow a selected endpoint change',()=>{
  const {el,change,save,saved,profiles,refresh}=settingsFixture();
  change('primary-profile','local:c');
  el('primary-model').value='custom_model';
  el('primary-voice').value='custom_voice';
  save();
  assert.equal(saved().primary.native_speed,undefined);
  assert.equal(saved().primary.speed,undefined);
  el('primary-speed').value='0.8';
  el('primary-native-speed').checked=true;
  assert.equal(el('primary-native-speed').parentElement.children[0],el('primary-native-speed'));
  save();
  assert.equal(saved().primary.native_speed,true);
  assert.equal(saved().primary.speed,0.8);
  change('mode','dual_same_api');
  save();
  assert.equal(saved().primary.speed,0.8);
  assert.equal(saved().ja.speed,1);
  change('mode','single');
  save();
  assert.equal(saved().primary.speed,0.8);
  profiles[2]={...profiles[2],base_url:'https://second-tts.example/v1',revision:'2'};
  refresh();
  el('primary-model').value='new_model';
  el('primary-voice').value='new_voice';
  save();
  assert.equal(saved().primary.native_speed,undefined);
});

test('prepared replay reads local metadata but not the key, and rejects a rotated profile',async()=>{
  const reads=[];
  const {change,save,prepare,profiles}=settingsFixture(undefined,reads);
  change('primary-profile','local:b');
  save();
  const replay=await prepare({replay:true});
  assert.deepEqual(reads,['metadata']);
  assert.equal(replay.primary.profile.connection,undefined);
  const synthesis=await prepare();
  assert.equal(synthesis.primary.profile.connection.api_key,'synthetic-fixture-key');
  profiles[1]={...profiles[1],revision:'2'};
  await assert.rejects(prepare({replay:true}),/đã đổi/);
  assert.deepEqual(reads,['metadata','key','metadata']);
});

test('Phase 1 routes restore native Live; settings change live identity but preserve audio identity',()=>{
  const storage=new Map();
  const key='vjbot_voice_routing_v2:learner';
  storage.set(key,JSON.stringify({version:2,mode:'single',admin_override:false,
    primary:{provider:'gemini',profile:{scope:'local',id:'b'},kanji_mode:'kanji_native'}}));
  const {window,el,change,save,saved}=settingsFixture(undefined,[],storage,true);
  const routing=window.VJVoiceRouting, before=routing.identity(saved()), events=[];
  const liveBefore=routing.liveIdentity(saved());
  const defaults={engine:'cascaded',turn_mode:'vad',barge_in:true,stt_source:'chat',stt_slot:'primary',stt_language:'auto'};
  assert.ok(Object.isFrozen(routing));
  assert.ok(Object.isFrozen(routing.liveConfig(saved())));
  assert.deepEqual({...routing.liveConfig(saved())},{...defaults,engine:'native'});
  assert.deepEqual({...routing.liveConfig(null)},defaults);
  assert.deepEqual({...routing.liveConfig({live:{engine:'unknown',turn_mode:1,barge_in:'false',stt_source:'unknown',stt_slot:'xx',stt_language:'ja-JP'}})},defaults);
  assert.equal(el('live-engine').value,'native');
  assert.equal(el('live-options').hidden,true);
  assert.equal(el('live-stt-slot-field').hidden,true);
  assert.equal(el('live-stt-slot').disabled,true);
  assert.equal(el('live-stt-language').value,'auto');
  window.addEventListener('vjbot-voice-changed',event=>events.push(event.detail));
  change('live-engine','cascaded');
  change('live-stt','voice');
  assert.equal(el('live-stt-slot-field').hidden,false);
  assert.equal(el('live-stt-slot').disabled,false);
  assert.equal(el('live-options').hidden,false);
  el('live-turn').value='ptt';
  el('live-barge').checked=false;
  el('live-stt-slot').value='ja';
  el('live-stt-language').value='ja';
  change('live-engine','native');
  assert.equal(el('live-options').hidden,true);
  assert.ok(['turn','barge','stt','stt-slot','stt-language'].every(name=>el('live-'+name).disabled));
  save();
  const edited={engine:'native',turn_mode:'ptt',barge_in:false,stt_source:'voice',stt_slot:'ja',stt_language:'ja'};
  assert.deepEqual(saved().live,edited);
  assert.equal(routing.identity(saved()),before);
  assert.notEqual(routing.liveIdentity(saved()),liveBefore);
  assert.deepEqual({...events[0].live},edited);
  const again=settingsFixture(undefined,[],storage,true);
  assert.equal(again.el('live-engine').value,'native');
  assert.equal(again.el('live-turn').value,'ptt');
  assert.equal(again.el('live-barge').checked,false);
  assert.equal(again.el('live-stt-slot').value,'ja');
  assert.equal(again.el('live-stt-language').value,'ja');
  again.change('live-engine','cascaded');
  assert.equal(again.el('live-options').hidden,false);
  assert.ok(['turn','barge','stt','stt-slot','stt-language'].every(name=>!again.el('live-'+name).disabled));
  assert.equal(again.el('live-stt-slot').value,'ja');
});

test('new routes default to Cascaded and explicit Cascaded preferences survive reload',()=>{
  const storage=new Map(), first=settingsFixture(undefined,[],storage,true);
  assert.equal(first.el('live-engine').value,'cascaded');
  assert.equal(first.el('live-stt-language').value,'auto');
  assert.equal(first.el('live-browser-stt-hint').hidden,true);
  first.change('primary-profile','local:b');
  first.change('live-stt','browser');
  assert.equal(first.el('live-stt-language').value,'auto');
  assert.equal(first.el('live-browser-stt-hint').hidden,false);
  assert.equal(first.el('live-stt-language').attributes['aria-describedby'],first.el('live-browser-stt-hint').id);
  first.el('live-turn').value='ptt';
  first.el('live-barge').checked=false;
  first.save();
  const reloaded=settingsFixture(undefined,[],storage,true);
  assert.equal(reloaded.el('live-engine').value,'cascaded');
  assert.equal(reloaded.el('live-stt').value,'browser');
  assert.equal(reloaded.el('live-stt-language').value,'auto');
  assert.equal(reloaded.el('live-browser-stt-hint').hidden,false);
  assert.equal(reloaded.el('live-turn').value,'ptt');
  assert.equal(reloaded.el('live-barge').checked,false);
  reloaded.save();
  const prior=reloaded.saved(), routing=reloaded.window.VJVoiceRouting;
  assert.deepEqual(prior.live,{engine:'cascaded',turn_mode:'ptt',barge_in:false,stt_source:'browser',stt_slot:'primary',stt_language:'auto'});
  reloaded.el('live-stt-language').value='vi';
  reloaded.save();
  const again=settingsFixture(undefined,[],storage,true);
  assert.equal(again.el('live-stt-language').value,'vi');
  assert.equal(routing.identity(again.saved()),routing.identity(prior));
  assert.notEqual(routing.liveIdentity(again.saved()),routing.liveIdentity(prior));
  again.change('live-stt','chat');
  assert.equal(again.el('live-browser-stt-hint').hidden,true);
  assert.equal(again.el('live-stt-language').attributes['aria-describedby'],undefined);
  assert.equal(again.el('live-stt-language').value,'vi');
});

test('saving cascaded voice STT rejects an unsupported split slot without replacing the saved route',()=>{
  const {el,window,profiles,refresh,change,save,saved}=settingsFixture(undefined,[],new Map(),true);
  profiles.push({id:'o',scope:'local',name:'OpenAI',protocol:'openai',base_url:'https://api.openai.com/v1',revision:'1'});
  refresh();
  change('mode','dual_split_api');
  change('primary-profile','local:o');
  change('ja-profile','local:b');
  save();
  const prior=saved();
  let changes=0;
  window.addEventListener('vjbot-voice-changed',()=>{changes++;});
  change('live-stt','voice');
  el('live-stt-slot').value='ja';
  save();
  assert.deepEqual(saved(),prior);
  assert.equal(changes,0);
  assert.match(el('status').textContent,/OpenAI.*Mistral.*ElevenLabs/);
  assert.equal(el('live-settings').hidden,false);
  assert.equal(el('live-tab').attributes['aria-selected'],'true');
  assert.equal(el('live-stt').focused,true);
  change('ja-profile','');
  save();
  assert.equal(saved().live.stt_source,'voice');
  assert.equal(saved().live.stt_slot,'ja');
  assert.equal(changes,1);
});

test('explicit STT prepares only the selected effective slot, uses the v2 wire schema and never substitutes an unsupported slot',async()=>{
  const reads=[], requests=[];
  const {window,profiles,refresh}=settingsFixture(async(path,options)=>{
    requests.push({path,options});
    return Response.json({profiles:profiles.filter(row=>row.scope==='server')});
  },reads);
  profiles.push({id:'m',scope:'server',name:'Mistral',protocol:'openai',
    base_url:'https://api.mistral.ai/v1',connection_id:'mistral-confirmed'});
  refresh();
  const routing=window.VJVoiceRouting, primary={provider:'elevenlabs',profile:{scope:'local',id:'a'},voice_id:'reader'};
  const draft={version:2,mode:'dual_split_api',admin_override:false,primary,
    ja:{provider:'mistral',profile:{scope:'server',id:'m'}},vi:{provider:'gemini',profile:{scope:'local',id:'b'}},
    live:{stt_source:'voice',stt_slot:'ja'}};
  const plain=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await routing.preparedStt(draft)),{version:2,admin_override:false,provider:'mistral',profile:{scope:'server',id:'m'}});
  assert.deepEqual(reads,[]);
  assert.deepEqual(requests.map(({path})=>path),['/api/ai/profiles']);
  assert.deepEqual(plain(await routing.preparedStt({...draft,ja:{profile:null}})),{
    version:2,admin_override:false,provider:'elevenlabs',profile:{scope:'local',connection:{
      base_url:'https://api.elevenlabs.io',api_key:'synthetic-fixture-key'}}});
  assert.deepEqual(reads,['key','metadata']);
  await assert.rejects(routing.preparedStt({...draft,live:{stt_source:'voice',stt_slot:'vi'}}),/OpenAI.*Mistral.*ElevenLabs/);
  assert.equal(await routing.preparedStt({...draft,live:{stt_source:'browser'}}),null);
  assert.equal(await routing.preparedStt({...draft,live:undefined}),null);
  assert.deepEqual(reads,['key','metadata']);
  assert.equal(requests.length,1);
  await assert.rejects(routing.preparedStt({...draft,ja:{provider:'mistral',profile:{scope:'server',id:'removed'}}}),/đã đổi/);
  assert.equal(requests.length,1);
  const identity=routing.identity({...draft,primary:{...primary,profile:{...primary.profile,connection:{api_key:'synthetic-private'}}}});
  assert.doesNotMatch(identity,/synthetic-private/);
  profiles[0].key_last4='private-tail';
  assert.doesNotMatch(routing.identity(draft),/private-tail/);
});

test('explicit STT rejects in-flight profile, configuration, role and abort revocation',async()=>{
  for(const revoke of ['profile','metadata','config','role','abort']){
    const {el,window,context,profiles,refresh,change,save,saved}=settingsFixture(undefined,[],new Map(),true);
    change('primary-profile','local:a');
    el('primary-voice').value='reader';
    change('live-stt','voice');
    save();
    const controller=new AbortController(), load=context.VJProfiles.load;
    let release;
    context.VJProfiles.load=async(...args)=>{
      const prior=load(...args);
      return new Promise(resolve=>{release=()=>resolve(prior);});
    };
    const pending=window.VJVoiceRouting.preparedStt(saved(),controller.signal);
    if(revoke==='profile') {
      profiles[0]={...profiles[0],revision:'rotated'};
      refresh();
    } else if(revoke==='metadata') {
      profiles[0]={...profiles[0],revision:'rotated-without-refresh'};
    } else if(revoke==='config') {
      el('live-turn').value='ptt';
      save();
    } else if(revoke==='role') {
      context.signedInUser.is_admin=true;
    } else controller.abort();
    release();
    await assert.rejects(pending,/đã đổi|abort/i);
  }
});

test('administrator STT requires an explicit personal override and the current server fingerprint',async()=>{
  let currentId='initial-connection';
  const {context,window,profiles,refresh}=settingsFixture(async()=>Response.json({profiles:[
    {id:'s',protocol:'openai',base_url:'https://api.openai.com/v1',connection_id:currentId}
  ]}));
  context.signedInUser.is_admin=true;
  profiles.push({id:'s',scope:'server',name:'OpenAI',protocol:'openai',
    base_url:'https://api.openai.com/v1',connection_id:currentId});
  refresh();
  const config={version:2,mode:'single',admin_override:true,live:{stt_source:'voice'},
    primary:{provider:'openai',profile:{scope:'server',id:'s'}}};
  assert.equal((await window.VJVoiceRouting.preparedStt(config)).admin_override,true);
  await assert.rejects(window.VJVoiceRouting.preparedStt({...config,admin_override:false}),/Quyền tài khoản/);
  currentId='rotated-connection';
  await assert.rejects(window.VJVoiceRouting.preparedStt(config),/đã đổi/);
});

test('removing a voice profile uses the native dialog and cancels on dismiss or account switch',async()=>{
  const {el,dialog,context,window,removed,change}=settingsFixture();
  change('primary-profile','local:a');
  const first=el('remove').events.click();
  assert.equal(dialog.open,true);
  assert.match(el('confirm-title').textContent,/ElevenLabs/);
  dialog.close('cancel');
  await first;
  assert.deepEqual(removed,[]);
  const confirmed=el('remove').events.click();
  assert.equal(dialog.open,true);
  dialog.close('delete');
  await confirmed;
  assert.deepEqual(removed,[['learner','local','a']]);
  assert.match(el('status').textContent,/Đã xóa kết nối giọng nói/);
  const backed=el('remove').events.click();
  assert.equal(dialog.open,true);
  window.dispatchEvent(new Event('popstate'));
  await backed;
  assert.equal(dialog.open,false);
  const hashed=el('remove').events.click();
  assert.equal(dialog.open,true);
  window.dispatchEvent(new Event('hashchange'));
  await hashed;
  assert.equal(dialog.open,false);
  const switched=el('remove').events.click();
  assert.equal(dialog.open,true);
  context.signedInUser={user_id:'other-learner'};
  window.dispatchEvent(new Event('vjbot-account-ready'));
  await switched;
  assert.equal(dialog.open,false);
  assert.equal(removed.length,1);
});
