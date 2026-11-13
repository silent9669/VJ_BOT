import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function recording({microphone,reply,supported=true}={}) {
  const tracks=[{stopped:false,stop(){this.stopped=true;}}],stream={getTracks:()=>tracks},requests=[],timers=new Map();
  const button={textContent:'Ghi âm',events:{},attributes:{},addEventListener(name,fn){this.events[name]=fn;},setAttribute(name,value){this.attributes[name]=value;}};
  const input={value:'入力',focus(){},dispatchEvent(){}},status={},playback={hidden:true,addEventListener(){}};
  let capture,recognition,revoked=0;
  class Recorder {
    static isTypeSupported(type){return type==='audio/webm;codecs=opus';}
    constructor(){capture=this;this.mimeType='audio/webm;codecs=opus';this.state='inactive';}
    start(){this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['audio'])});this.onstop();});}
  }
  class Recognition {constructor(){recognition=this;}start(){this.onstart();}stop(){this.onend();}abort(){this.onend();}}
  const context=vm.createContext({Blob,Event,Response,AbortController,Uint8Array,btoa,console,
    navigator:{mediaDevices:{getUserMedia:microphone||(async()=>stream)}},MediaRecorder:Recorder,SpeechRecognition:Recognition,
    apiFetch:async(path,options)=>{const body=JSON.parse(options.body);requests.push({path,body,signal:options.signal});return reply?reply(body):Response.json(body.action?{supported}:{text:'こんにちは'});},
    setTimeout:fn=>{timers.set(timers.size+1,fn);return timers.size;},clearTimeout:id=>timers.delete(id),
    URL:{createObjectURL:()=> 'blob:recording',revokeObjectURL(){revoked++;}},Audio:class{},
    document:{addEventListener(){}},addEventListener(){}});
  context.window=context;
  vm.runInContext(readFileSync('static/recorded-input.js','utf8')+'\n'+readFileSync('static/speech-input.js','utf8'),context);
  const controller=context.createJapaneseInput({button,input,status,playbackButton:playback});
  return {context,button,input,status,playback,controller,tracks,stream,requests,timers,get capture(){return capture;},get recognition(){return recognition;},get revoked(){return revoked;}};
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
test('unsupported providers keep browser recognition available without sending recorded audio',async()=>{
  const h=recording({supported:false});await h.button.events.click();assert.equal(h.recognition.lang,'ja-JP');assert.equal(h.button.attributes['aria-pressed'],'true');
  h.controller.reset();assert.equal(h.requests.length,1);assert.equal(h.status.hidden,true);
});
test('microphone denial and recording time limit leave recoverable controls',async()=>{
  const denied=recording({microphone:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}});
  await denied.button.events.click();assert.match(denied.status.textContent,/Cho phép micro/);assert.equal(denied.button.attributes['aria-busy'],'false');
  const h=recording();await h.button.events.click();[...h.timers.values()][0]();await tick();assert.equal(h.tracks[0].stopped,true);assert.equal(h.input.value,'入力 こんにちは');h.controller.reset();
});
