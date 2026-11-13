import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function inputHarness({media, supported=true}={}){
  let recognition;
  class Recognition { constructor(){recognition=this;} start(){this.onstart();} stop(){this.onend();} abort(){this.onend();} }
  const button={disabled:false,textContent:'Nói',events:{},setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.events[name]=fn;}};
  const input={value:'',focus(){}},status={textContent:''};
  const c=vm.createContext({window:supported?{SpeechRecognition:Recognition}:{},navigator:{mediaDevices:media},setTimeout:()=>1,clearTimeout(){},URL:{revokeObjectURL(){}},Audio:class{},Blob,document:{addEventListener(){}},addEventListener(){}});
  vm.runInContext(readFileSync('static/speech-input.js','utf8'),c);
  const controller=c.createJapaneseInput({button,input,status,playbackButton:{hidden:true,addEventListener(){}}});
  return {button,input,status,controller,get recognition(){return recognition;}};
}
test('speech input offers a real stop action and preserves microphone errors after ending',()=>{
  const h=inputHarness();h.button.events.click();
  assert.equal(h.button['aria-pressed'],'true');
  h.button.events.click();assert.equal(h.button['aria-pressed'],'false');
  h.button.events.click();h.recognition.onerror({error:'not-allowed'});h.recognition.onend();
  assert.match(h.status.textContent,/quyền micro/);
});
test('leaving a speaking screen releases a microphone granted after recognition ended',async()=>{
  let resolve,stopped=0;
  const h=inputHarness({media:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  h.button.events.click();h.controller.reset();
  resolve({getTracks:()=>[{stop(){stopped++;}}]});
  await new Promise(r=>setImmediate(r));
  assert.equal(stopped,1);assert.equal(h.button['aria-pressed'],'false');
});
test('unsupported speech recognition leaves the typed answer usable',()=>{
  const h=inputHarness({supported:false});
  assert.equal(h.button.disabled,true);assert.match(h.status.textContent,/nhập câu trả lời/i);
  assert.equal(h.input.value,'');
});
