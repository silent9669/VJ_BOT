import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync('static/app.js','utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(options={}) {
  const elements=new Map(),events=new Map(),recorders=[],recognizers=[],audios=[],blobs=[],revoked=[],errors=[],tts=[];
  let permissions=0,stoppedSpeech=0,liveStarts=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',style:{},dataset:{},hidden:false,disabled:false,events:{},listeners:{},attributes:{},inputEvents:0,children:[],dispatchEvent(event){if(event.type==='input')this.inputEvents++;},classList:{toggle(){},remove(){}},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);this.events[k]=fn;},click(){return this.events.click?.({stopPropagation(){}}) ?? this.onclick?.();}});
    return elements.get(id);
  };
  class Recognition {
    constructor(){recognizers.push(this);}
    start(){if(options.recognitionFailure)throw new Error('recognition setup failed');this.started=true;this.onstart?.();}
    stop(){this.stopped=true;}
    abort(){this.aborted=true;}
    result(text){this.onresult?.({results:[[{transcript:text}]]});}
    end(){this.onend?.();}
  }
  class Recorder {
    constructor(stream){if(options.setupFailure==='constructor')throw new Error('recorder setup failed');this.stream=stream;this.state='inactive';this.mimeType=options.mimeType || 'audio/mp4';recorders.push(this);}
    start(){if(options.setupFailure==='start')throw new Error('recorder start failed');this.state='recording';}
    stop(){this.state='inactive';this.stopped=true;}
    data(text='captured'){this.ondataavailable?.({data:new Blob([text],{type:this.mimeType})});}
    finish(){this.onstop?.();}
  }
  class Audio {
    constructor(url){this.url=url;audios.push(this);}
    play(){return options.playPromise || (options.replayFailure?Promise.reject(new Error('playback blocked')):Promise.resolve());}
    pause(){this.paused=true;}
    removeAttribute(){this.src='';}
    load(){}
  }
  const stream=()=>({track:{stops:0,stop(){this.stops++;}},getTracks(){return [this.track];}});
  const defaultStream=stream();
  const c=vm.createContext({Blob,Audio,URL:{createObjectURL(blob){blobs.push(blob);return `blob:${blobs.length}`;},revokeObjectURL(url){revoked.push(url);}},navigator:{mediaDevices:options.noCapture?undefined:{getUserMedia(){permissions++;return options.permission || Promise.resolve(defaultStream);}}},MediaRecorder:options.noRecorder?undefined:Recorder,document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},location:{hash:'#kaiwa'},signedInUser:{user_id:'owner'},soundEngine:{playSend(){}},stopSpeech(){stoppedSpeech++;},chatError(text){errors.push(text);},setupSidebar(){},openAccount(){},returnToCourse(){},activeCurriculumLevel:'N5',activeKaiwaKey:'scenario',activeKaiwaPromptIdx:0,activeKaiwaLevel:'N5',fcDeck:[{front:'学生',reading:'がくせい'}],fcIdx:0,DAILY_KANJI_DATA:{N5:{char:'学',sample:'学生 (gakusei - student)'}},playGeminiTTS(text,config){tts.push({text,config});}});
  c.Event=Event;c.setTimeout=()=>1;c.clearTimeout=()=>{};
  c.window=c;c.SpeechRecognition=options.noRecognition?undefined:Recognition;
  c.document.createElement=()=>element(`created-${elements.size}`);
  c.restartTutorConversation=()=>{};
  c.addEventListener=(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn);};
  vm.runInContext(readFileSync('static/speech-input.js','utf8'),c);
  c.openLiveConversation=()=>{liveStarts++;c.stopJapaneseInputs();};
  vm.runInContext(source.slice(source.indexOf('function singleSpeechReading('),source.indexOf('function setupEventListeners(')),c);
  vm.runInContext(source.slice(source.indexOf('function setupEventListeners()'),source.indexOf('// 17. BOOTSTRAP INITIALIZATION')),c);
  c.setupEventListeners();
  const emit=name=>{for(const fn of events.get(name)||[])fn();};
  return {c,element,emit,stream,defaultStream,recorders,recognizers,audios,blobs,revoked,errors,tts,get permissions(){return permissions;},get stoppedSpeech(){return stoppedSpeech;},get liveStarts(){return liveStarts;},status:()=>element('kaiwa-mic-status').textContent,start:()=>element('btn-kaiwa-mic').click(),replay:()=>element('btn-kaiwa-play-user').click()};
}

test('permission rejection is visible and manual entry remains available',async()=>{
  const f=fixture({permission:Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}))});
  await f.start();
  assert.match(f.status(),/permission|denied/i);
  assert.equal(f.element('btn-kaiwa-mic').attributes['aria-pressed'],'false');
  assert.equal(f.element('kaiwa-manual-input').disabled,false);
  assert.equal(f.recorders.length,0);
});
for(const setupFailure of ['constructor','start'])test(`recorder ${setupFailure} failure releases the acquired stream`,async()=>{
  const f=fixture({setupFailure});await f.start();
  assert.match(f.status(),/record.*failed|recorder/i);
  assert.equal(f.defaultStream.track.stops,1);
  assert.equal(f.element('btn-kaiwa-mic').attributes['aria-pressed'],'false');
});
for(const event of ['hashchange','popstate','pagehide','vjbot-voice-changed','vjbot-account-ready'])test(`late microphone permission after ${event} is discarded`,async()=>{
  const permission=deferred(),f=fixture({permission:permission.promise});
  const pending=f.start();f.emit(event);const stream=f.stream();permission.resolve(stream);await pending;
  assert.equal(stream.track.stops,1);assert.equal(f.recorders.length,0);assert.equal(f.recognizers.length,0);
});
test('stopping during the permission prompt never starts delayed capture',async()=>{
  const permission=deferred(),f=fixture({permission:permission.promise});
  const pending=f.start();await f.start();permission.resolve(f.defaultStream);await pending;
  assert.equal(f.defaultStream.track.stops,1);assert.equal(f.recorders.length,0);
});
test('explicit stop releases tracks before recognition ends and preserves actual recorded MIME',async()=>{
  const f=fixture({mimeType:'audio/ogg;codecs=opus'});await f.start();
  const recorder=f.recorders[0],recognition=f.recognizers[0];
  await f.start();assert.equal(recognition.stopped,true);assert.equal(recorder.stopped,true);assert.equal(f.defaultStream.track.stops,1);
  recorder.data();recorder.finish();recognition.result('こんにちは');recognition.end();
  assert.equal(f.blobs[0].type,'audio/ogg;codecs=opus');assert.equal(f.element('kaiwa-manual-input').value,'こんにちは');
  assert.match(f.status(),/dừng/i);assert.equal(f.element('btn-kaiwa-play-user').style.display,'inline-flex');
});
test('natural recognition end stops recording without claiming user-requested stop',async()=>{
  const f=fixture();await f.start();f.recognizers[0].end();
  assert.equal(f.recorders[0].stopped,true);assert.equal(f.defaultStream.track.stops,1);assert.match(f.status(),/kết thúc/i);
});
test('replacing capture invalidates old recorder and recognition callbacks',async()=>{
  const f=fixture();await f.start();await f.start();
  const oldRecorder=f.recorders[0],oldRecognition=f.recognizers[0];
  oldRecorder.data('first');oldRecorder.finish();assert.equal(f.blobs.length,1);
  await f.start();assert.deepEqual(f.revoked,['blob:1']);
  oldRecorder.data('stale');oldRecorder.finish();oldRecognition.result('stale transcript');oldRecognition.end();
  assert.equal(f.blobs.length,1);assert.equal(f.element('kaiwa-manual-input').value,'');assert.equal(f.recorders[1].state,'recording');
  await f.start();f.recorders[1].data('second');f.recorders[1].finish();
  assert.equal(await f.blobs[1].text(),'second');
});
test('navigation cancels recording callbacks and removes completed replay resources',async()=>{
  const f=fixture();await f.start();const recorder=f.recorders[0],recognition=f.recognizers[0];
  f.emit('hashchange');recorder.data();recorder.finish();recognition.result('stale');
  assert.equal(f.blobs.length,0);assert.equal(f.defaultStream.track.stops,1);assert.equal(f.element('kaiwa-manual-input').value,'');
  await f.start();await f.start();f.recorders[1].data();f.recorders[1].finish();await f.replay();
  f.emit('pagehide');assert.equal(f.audios[0].paused,true);assert.deepEqual(f.revoked,['blob:1']);assert.equal(f.element('btn-kaiwa-play-user').style.display,'none');
});
test('replay rejection is visible and stale replay rejection cannot overwrite newer capture',async()=>{
  const f=fixture({replayFailure:true});await f.start();await f.start();f.recorders[0].data();f.recorders[0].finish();await f.replay();
  assert.match(f.status(),/playback blocked/);
  const playback=deferred(),g=fixture({playPromise:playback.promise});await g.start();await g.start();g.recorders[0].data();g.recorders[0].finish();
  const replay=g.replay();await g.start();playback.reject(new Error('obsolete'));await replay;
  assert.doesNotMatch(g.status(),/obsolete/);assert.equal(g.audios[0].paused,true);
});
test('recognition unsupported never prompts on setup and explicit recording still supports manual text',async()=>{
  const f=fixture({noRecognition:true});assert.equal(f.permissions,0);assert.match(f.status(),/không chép lời được/i);
  f.element('kaiwa-manual-input').value='手入力';await f.start();await f.start();f.recorders[0].data();f.recorders[0].finish();
  assert.equal(f.element('kaiwa-manual-input').value,'手入力');assert.equal(f.blobs.length,1);assert.equal(f.recognizers.length,0);
});
for(const unavailable of ['noRecorder','noCapture'])test(`${unavailable} is visible without a capture permission prompt`,async()=>{
  const f=fixture({[unavailable]:true,noRecognition:true});await f.start();
  assert.equal(f.permissions,0);assert.match(f.status(),/không ghi âm|không chép lời/i);assert.equal(f.element('kaiwa-manual-input').disabled,false);
});
test('explicit browser controller stops and account changes discard delayed recognition',async()=>{
  const f=fixture(),controller=f.c.createBrowserJapaneseInput({button:f.element('manual-mic'),input:f.element('chat-input'),bindButton:false});
  await controller.toggle();const first=f.recognizers[0];
  await controller.toggle();assert.equal(first.stopped,true);first.result('私です');first.end();assert.equal(f.element('chat-input').value,'私です');
  await controller.toggle();const next=f.recognizers[1];f.c.signedInUser={user_id:'other'};next.result('private');next.end();
  assert.equal(f.element('chat-input').value,'私です');controller.reset();
  assert.equal(next.aborted,true);assert.equal(controller.active,false);assert.equal(f.element('manual-mic').attributes['aria-pressed'],'false');
});
test('browser permission and recognition setup errors remain visible',async()=>{
  const f=fixture({noRecorder:true});await f.start();f.recognizers[0].onerror({error:'not-allowed'});f.recognizers[0].end();
  assert.match(f.status(),/permission|denied/i);
  const g=fixture({recognitionFailure:true});await g.start();assert.match(g.status(),/recognition setup failed/);
});
test('one chat Voice action opens continuous Live without legacy capture or dictation',async()=>{
  const f=fixture(),voice=f.element('btn-voice-input');
  assert.equal(voice.listeners.click.length,1);assert.equal(f.element('btn-kaiwa-mic').listeners.click.length,1);
  voice.click();assert.equal(f.liveStarts,1);assert.equal(f.permissions,0);assert.equal(f.recognizers.length,0);assert.equal(f.recorders.length,0);
  await f.start();const recorder=f.recorders[0];voice.click();
  assert.equal(f.liveStarts,2);assert.equal(recorder.stopped,true);assert.equal(f.defaultStream.track.stops,1);
  recorder.data();recorder.finish();assert.equal(f.blobs.length,0);assert.equal(f.recognizers.length,1);
  assert.equal(f.element('chat-input').value,'');
});
test('non-chat Japanese buttons use Japanese-only mode and only canonical single readings',()=>{
  const f=fixture();f.element('fc-front-text').textContent='学生';f.element('fc-example-jp').textContent='学生です。';f.element('kaiwa-prompt-jp').textContent='こんにちは';f.element('kaiwa-model-text').textContent='はい。';
  for(const id of ['btn-fc-audio-front','btn-fc-audio-back','btn-daily-kanji-tts','btn-kaiwa-play-prompt','btn-kaiwa-model-tts'])f.element(id).click();
  assert.equal(f.tts.length,5);assert.ok(f.tts.every(call=>call.config.japaneseOnly===true));assert.equal(f.tts[0].config.reading,'がくせい');
  assert.equal(f.c.singleSpeechReading('せい / しょう'),'');assert.equal(f.c.singleSpeechReading('がくせい (gakusei)'), '');assert.equal(f.c.singleSpeechReading('学生'),'');
});

test('accepted in-app navigation cancels pending capture before route rendering',async()=>{
  const permission=deferred(),f=fixture({permission:permission.promise}),navigated=new Error('route rendering boundary');
  const pending=f.start();
  f.element('kaiwa-criteria').append({textContent:'Previous assessment'});
  f.element('kaiwa-model-text').textContent='Previous example';
  f.element('kaiwa-result-card').hidden=false;
  f.c.authorizePage=()=>true;f.c.confirmWorkspaceNavigation=()=>true;f.c.rememberTeacherScreen=()=>{throw navigated;};
  vm.runInContext(source.slice(source.indexOf('function switchTab('),source.indexOf('// 8. CHAT')),f.c);
  assert.throws(()=>f.c.switchTab('dashboard'),error=>error===navigated);
  assert.equal(f.element('kaiwa-result-card').hidden,true);
  assert.deepEqual(f.element('kaiwa-criteria').children,[]);
  assert.equal(f.element('kaiwa-model-text').textContent,'');
  permission.resolve(f.defaultStream);await pending;
  assert.equal(f.defaultStream.track.stops,1);assert.equal(f.recorders.length,0);
});

test('owner or route changes invalidate a pending stream even before lifecycle events fire',async()=>{
  for(const change of [f=>{f.c.signedInUser={user_id:'other'};},f=>{f.c.location.hash='#dashboard';}]){
    const permission=deferred(),f=fixture({permission:permission.promise}),pending=f.start();change(f);
    permission.resolve(f.defaultStream);await pending;
    assert.equal(f.defaultStream.track.stops,1);assert.equal(f.recorders.length,0);
  }
});

test('missing recorder permits explicit browser transcription without a recording permission request',()=>{
  const f=fixture({noRecorder:true});f.start();
  assert.equal(f.permissions,0);assert.equal(f.recognizers.length,1);assert.match(f.status(),/chỉ chép lời/i);
  f.recognizers[0].result('入力');assert.equal(f.element('kaiwa-manual-input').value,'入力');
});

test('late replay callbacks cannot overwrite new recording state',async()=>{
  const f=fixture();await f.start();await f.start();f.recorders[0].data();f.recorders[0].finish();await f.replay();
  const ended=f.audios[0].onended,failed=f.audios[0].onerror;
  await f.start();const status=f.status();ended();failed();
  assert.equal(f.status(),status);assert.equal(f.audios[0].paused,true);
});

test('explicit controllers retain typed prefixes, render interim results and emit input',async()=>{
  for(const kind of ['kaiwa','manual']){
    const f=fixture(),input=f.element(kind==='kaiwa'?'kaiwa-manual-input':'chat-input');
    input.value='先に入力';
    if(kind==='kaiwa')await f.start();else await f.c.createBrowserJapaneseInput({button:f.element('manual-mic'),input,bindButton:false}).toggle();
    assert.equal(f.recognizers.length,1);
    const recognition=f.recognizers[0];
    assert.equal(recognition.interimResults,true);
    recognition.onresult({results:[[{transcript:'こんにちは'}],[{transcript:'世界'}]]});
    assert.equal(input.value,'先に入力 こんにちは世界');
    recognition.onresult({results:[[{transcript:'こんにちは。'}]]});
    assert.equal(input.value,'先に入力 こんにちは。');
    assert.equal(input.inputEvents,2);
    if(kind==='kaiwa'){
      await f.start();f.recorders[0].data();f.recorders[0].finish();
      assert.equal(f.element('btn-kaiwa-play-user').hidden,false);
      f.emit('pagehide');assert.equal(f.element('btn-kaiwa-play-user').hidden,true);
    }
  }
});

test('completed browser replay cannot cross owner or route without lifecycle events',async()=>{
  for(const change of [f=>{f.c.signedInUser={user_id:'other'};},f=>{f.c.location.hash='#dashboard';}]){
    const f=fixture();await f.start();await f.start();f.recorders[0].data();f.recorders[0].finish();
    change(f);await f.replay();assert.equal(f.audios.length,0);assert.deepEqual(f.revoked,['blob:1']);
    assert.equal(f.element('btn-kaiwa-play-user').hidden,true);
  }
});
