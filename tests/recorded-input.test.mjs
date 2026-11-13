import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function recording({microphone,reply,supported=true,noRecognition=false,playPromise,mimeType='audio/webm;codecs=opus',setupFailure}={}) {
  const tracks=[{stopped:false,stop(){this.stopped=true;}}],stream={getTracks:()=>tracks},requests=[],timers=new Map(),events={},errors=[],audios=[];
  const button={textContent:'Ghi âm',events:{},listeners:{},attributes:{},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);this.events[name]=fn;},setAttribute(name,value){this.attributes[name]=value;}};
  const input={value:'入力',focus(){},dispatchEvent(){}},status={},playback={hidden:true,style:{},events:{},listeners:{},addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);this.events[name]=fn;}};
  let capture,recognition,revoked=0,permissions=0;
  class Recorder {
    static isTypeSupported(type){return type==='audio/webm;codecs=opus';}
    constructor(){if(setupFailure==='constructor')throw new Error('recorder constructor failed');capture=this;this.mimeType=mimeType;this.state='inactive';}
    start(){if(setupFailure==='start')throw new Error('recorder start failed');this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['audio'],{type:mimeType})});this.onstop();});}
  }
  class Recognition {constructor(){recognition=this;}start(){this.onstart();}stop(){this.stopped=true;this.onend();}abort(){this.aborted=true;this.onend();}}
  const context=vm.createContext({Blob,Event,Response,AbortController,Uint8Array,btoa,console,
    navigator:{mediaDevices:{getUserMedia(){permissions++;return microphone?microphone():Promise.resolve(stream);}}},MediaRecorder:Recorder,SpeechRecognition:noRecognition?undefined:Recognition,
    apiFetch:async(path,options)=>{const body=JSON.parse(options.body);requests.push({path,body,signal:options.signal});return reply?reply(body):Response.json(body.action?{supported}:{text:'こんにちは'});},
    setTimeout:fn=>{timers.set(timers.size+1,fn);return timers.size;},clearTimeout:id=>timers.delete(id),
    URL:{createObjectURL:()=> 'blob:recording',revokeObjectURL(){revoked++;}},Audio:class {
      constructor(){audios.push(this);}play(){return playPromise || Promise.resolve();}pause(){this.paused=true;}removeAttribute(){}load(){}
    },
    location:{hash:'#kaiwa'},signedInUser:{user_id:'owner'},
    document:{addEventListener(){}},addEventListener(name,fn){events[name]=fn;}});
  context.window=context;
  vm.runInContext(readFileSync('static/recorded-input.js','utf8')+'\n'+readFileSync('static/speech-input.js','utf8'),context);
  const controller=context.createJapaneseInput({button,input,status,playbackButton:playback,onError:message=>errors.push(message)});
  return {context,button,input,status,playback,controller,tracks,stream,requests,timers,events,errors,audios,get capture(){return capture;},get recognition(){return recognition;},get revoked(){return revoked;},get permissions(){return permissions;}};
}
test('recording stops the microphone before transcription and preserves the typed answer',async()=>{
  const h=recording();await h.button.events.click();assert.equal(h.capture.state,'recording');assert.equal(h.button.attributes['aria-pressed'],'true');
  await h.button.events.click();assert.equal(h.tracks[0].stopped,true);await tick();
  assert.equal(h.requests[1].path,'/api/stt');assert.equal(h.requests[1].body.mime_type,'audio/webm;codecs=opus');assert.equal(h.input.value,'入力 こんにちは');assert.equal(h.playback.hidden,false);
  h.controller.reset();assert.equal(h.revoked,1);assert.equal(h.playback.hidden,true);assert.equal(h.status.hidden,true);
});
test('navigation cancels a recording permission prompt and releases its late microphone',async()=>{
  let release;const h=recording({microphone:()=>new Promise(resolve=>{release=resolve;})});
  const pending=h.button.events.click();await tick();h.controller.reset();release(h.stream);await pending;
  assert.equal(h.tracks[0].stopped,true);assert.equal(h.capture,undefined);assert.equal(h.requests.length,1);
});
test('cancelled transcription cannot write into another lesson',async()=>{
  let release;const h=recording({reply:body=>body.action?Response.json({supported:true}):new Promise(resolve=>{release=resolve;})});
  await h.button.events.click();await h.button.events.click();await tick();h.controller.reset();h.input.value='next lesson';
  release(Response.json({text:'late answer'}));await tick();assert.equal(h.input.value,'next lesson');assert.equal(h.requests[1].signal.aborted,true);
});
test('unsupported providers use the owned browser fallback with one microphone and no recorded upload',async()=>{
  const h=recording({supported:false});
  assert.equal(h.button.listeners.click.length,1);assert.equal(h.playback.listeners.click.length,1);
  assert.equal(vm.runInContext('japaneseInputs.length',h.context),1);
  assert.equal(h.permissions,0);await h.controller.toggle();
  assert.equal(h.recognition.lang,'ja-JP');assert.equal(h.button.attributes['aria-pressed'],'true');assert.equal(h.controller.active,true);
  assert.equal(h.permissions,1);assert.equal(h.capture.state,'recording');
  h.recognition.onresult({results:[[{transcript:'手入力ではない'}]]});assert.equal(h.input.value,'入力 手入力ではない');
  await h.controller.toggle();assert.equal(h.recognition.stopped,true);assert.equal(h.controller.active,false);await tick();
  assert.equal(h.playback.hidden,false);await h.playback.events.click();assert.equal(h.audios.length,1);
  h.controller.reset();assert.equal(h.audios[0].paused,true);assert.equal(h.requests.length,1);assert.equal(h.status.hidden,true);assert.equal(h.playback.hidden,true);
});
test('microphone denial and recording time limit leave recoverable controls',async()=>{
  const denied=recording({microphone:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}});
  await denied.button.events.click();assert.match(denied.status.textContent,/Cho phép micro/);assert.equal(denied.button.attributes['aria-busy'],'false');
  const h=recording();await h.button.events.click();[...h.timers.values()][0]();await tick();assert.equal(h.tracks[0].stopped,true);assert.equal(h.input.value,'入力 こんにちは');h.controller.reset();
});
test('cancelling capability lookup never falls through into browser capture',async()=>{
  let resolve;const h=recording({reply:()=>new Promise(done=>{resolve=done;})});
  const pending=h.controller.toggle();assert.equal(h.controller.active,true);
  h.events.pagehide();resolve(Response.json({supported:false}));await pending;
  assert.equal(h.permissions,0);assert.equal(h.recognition,undefined);assert.equal(h.controller.active,false);
});
test('capability errors remain visible without changing provider or starting browser recognition',async()=>{
  const h=recording({reply:()=>Response.json({detail:'Selected connection unavailable'},{status:403})});
  await h.controller.toggle();assert.match(h.status.textContent,/Selected connection unavailable/);
  assert.equal(h.permissions,0);assert.equal(h.recognition,undefined);assert.equal(h.requests.length,1);
  assert.equal(h.errors.length,1);assert.equal(h.controller.active,false);assert.equal(h.input.value,'入力');
});
for(const event of ['hashchange','popstate','pagehide','vjbot-account-ready','vjbot-voice-changed'])test(`recorded fallback discards permission after ${event}`,async()=>{
  let resolve;const h=recording({supported:false,microphone:()=>new Promise(done=>{resolve=done;})});
  const pending=h.controller.toggle();await tick();h.events[event]();resolve(h.stream);await pending;
  assert.equal(h.tracks[0].stopped,true);assert.equal(h.capture,undefined);assert.equal(h.recognition,undefined);
  assert.equal(h.controller.active,false);assert.equal(h.requests.length,1);assert.equal(h.playback.hidden,true);
});
test('recorded owner and route guards reject a late stream before lifecycle events',async()=>{
  for(const change of [h=>{h.context.signedInUser={user_id:'other'};},h=>{h.context.location.hash='#dashboard';}]){
    let resolve;const h=recording({microphone:()=>new Promise(done=>{resolve=done;})});
    const pending=h.controller.toggle();await tick();change(h);resolve(h.stream);await pending;
    assert.equal(h.tracks[0].stopped,true);assert.equal(h.capture,undefined);assert.equal(h.requests.length,1);h.controller.reset();
  }
});
test('recorded owner and route guards reject a late transcript before lifecycle events',async()=>{
  for(const change of [h=>{h.context.signedInUser={user_id:'other'};},h=>{h.context.location.hash='#dashboard';}]){
    let resolve;const h=recording({reply:body=>body.action?Response.json({supported:true}):new Promise(done=>{resolve=done;})});
    await h.controller.toggle();await h.controller.toggle();await tick();change(h);
    resolve(Response.json({text:'previous owner'}));await tick();assert.equal(h.input.value,'入力');h.controller.reset();
  }
});
for(const setupFailure of ['constructor','start'])test(`recorded ${setupFailure} failure releases microphone without fallback`,async()=>{
  const h=recording({setupFailure});await h.controller.toggle();
  assert.equal(h.tracks[0].stopped,true);assert.equal(h.recognition,undefined);assert.equal(h.controller.active,false);
  assert.match(h.status.textContent,/recorder.*failed/);assert.equal(h.requests.length,1);
});
test('actual recording MIME survives upload and replay failure remains visible',async()=>{
  const h=recording({mimeType:'audio/mp4',playPromise:Promise.resolve()});
  await h.controller.toggle();await h.controller.toggle();await tick();
  assert.equal(h.requests[1].body.mime_type,'audio/mp4');assert.match(h.status.textContent,/văn bản/);
  h.context.Audio=class {play(){return Promise.reject(new Error('blocked replay'));}pause(){}removeAttribute(){}load(){}};
  await h.playback.events.click();assert.match(h.status.textContent,/blocked replay/);assert.equal(h.input.value,'入力 こんにちは');
});
test('late replay failures cannot overwrite a newer capture',async()=>{
  let reject;const h=recording({playPromise:new Promise((_done,fail)=>{reject=fail;})});
  await h.controller.toggle();await h.controller.toggle();await tick();const replay=h.playback.events.click();
  await h.controller.toggle();const status=h.status.textContent;reject(new Error('obsolete replay'));await replay;
  assert.equal(h.status.textContent,status);assert.equal(h.audios[0].paused,true);h.controller.reset();await tick();
});
test('unsupported speech recognition retains explicit replay recording and manual text',async()=>{
  const h=recording({supported:false,noRecognition:true});await h.controller.toggle();
  assert.match(h.status.textContent,/transcription.*unavailable/i);await h.controller.toggle();await tick();
  assert.equal(h.input.value,'入力');assert.equal(h.playback.hidden,false);assert.equal(h.requests.length,1);
  h.controller.reset();
});
test('completed recorded replay cannot cross owner or route without lifecycle events',async()=>{
  for(const change of [h=>{h.context.signedInUser={user_id:'other'};},h=>{h.context.location.hash='#dashboard';}]){
    const h=recording();await h.controller.toggle();await h.controller.toggle();await tick();
    change(h);await h.playback.events.click();assert.equal(h.audios.length,0);assert.equal(h.revoked,1);assert.equal(h.playback.hidden,true);
  }
});
test('transcription failures preserve manual text without switching to another speech provider',async()=>{
  const h=recording({reply:body=>body.action?Response.json({supported:true}):Response.json({detail:'Selected STT quota exhausted'},{status:429})});
  await h.controller.toggle();await h.controller.toggle();await tick();
  assert.match(h.status.textContent,/Selected STT quota exhausted/);assert.equal(h.input.value,'入力');
  assert.equal(h.recognition,undefined);assert.equal(h.requests.length,2);assert.equal(h.controller.active,false);
  assert.equal(h.tracks[0].stopped,true);assert.equal(h.playback.hidden,false);assert.equal(h.errors.length,1);h.controller.reset();
});
