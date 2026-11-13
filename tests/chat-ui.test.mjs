import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('static/app.js','utf8');
function chat(apiFetch){
  const elements=new Map(),rows=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',style:{},events:{},hidden:false,disabled:false,addEventListener(name,fn){this.events[name]=fn;},querySelectorAll:()=>rows.slice(),click(){return this.events.click?.();}});
    return elements.get(id);
  };
  const c=vm.createContext({crypto,AbortSignal,Response,setTimeout:()=>{},signedInUser:{},userId:'qa',chatLessonContext:null,confirm:()=>true,apiFetch,document:{getElementById:element,querySelectorAll:()=>rows.slice(),querySelector:()=>null},soundEngine:{playSend(){},playReceive(){},playBlip(){}},mascotMgr:{setState(){}},renderBubble(role,content){const row={role,content,remove(){rows.splice(rows.indexOf(row),1);}};rows.push(row);}});
  vm.runInContext(source.slice(source.indexOf('let sendingMessage=false'),source.indexOf('async function loadGreeting()')),c);
  vm.runInContext(source.slice(source.indexOf('  const btnClearChat ='),source.indexOf('  // Level selector click')),c);
  return {c,element,rows};
}
test('failed chat requires retry or discard and retries preserve request identity',async()=>{
  const sent=[];let fail=true;
  const b=chat(async(path,options)=>{
    if(path==='/api/history')return Response.json([]);
    sent.push(JSON.parse(options.body));return fail?Response.json({detail:'Offline'},{status:503}):Response.json({reply:'こんにちは'});
  });
  await b.c.loadChatHistory();await b.c.sendMessage('first');await b.c.sendMessage('second');
  assert.equal(sent.length,1);assert.equal(b.rows.length,1);assert.equal(b.element('chat-discard').hidden,false);
  fail=false;await b.element('chat-retry').onclick();
  assert.equal(sent.length,2);assert.equal(sent[0].request_id,sent[1].request_id);
  assert.equal(b.rows.length,2);assert.equal(b.element('chat-error').hidden,true);
});
test('history is single-flight and blocks sends until restored',async()=>{
  let resolveHistory,calls=0;
  const b=chat(()=>{calls++;return new Promise(resolve=>{resolveHistory=resolve;});});
  const pending=b.c.loadChatHistory();await b.c.loadChatHistory();await b.c.sendMessage('too early');
  assert.equal(calls,1);assert.equal(b.rows.length,0);
  resolveHistory(Response.json([{role:'bot',content:'saved'}]));await pending;
  assert.equal(b.rows[0].content,'saved');
});
test('clearing history locks sends until the delete settles and restores the welcome state',async()=>{
  let resolveDelete,calls=0;
  const b=chat((path,options)=>{calls++;return options?.method==='DELETE'?new Promise(resolve=>{resolveDelete=resolve;}):Response.json([{role:'bot',content:'saved'}]);});
  await b.c.loadChatHistory();const pending=b.element('btn-clear-chat-history').events.click();
  await b.c.sendMessage('during delete');await b.element('btn-clear-chat-history').events.click();
  assert.equal(calls,2);assert.equal(b.element('btn-send-message').disabled,true);
  resolveDelete(Response.json({ok:true}));await pending;
  assert.equal(b.rows.length,0);assert.equal(b.element('chat-welcome').style.display,'');assert.equal(b.element('btn-send-message').disabled,false);
});
test('discard reloads server history before another send is allowed',async()=>{
  const b=chat(async(path)=>path==='/api/history'?Response.json([]):Response.json({detail:'unavailable'},{status:503}));
  await b.c.loadChatHistory();await b.c.sendMessage('unsent');
  b.element('chat-discard').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(b.rows.length,0);assert.equal(b.element('chat-error').hidden,true);
});

test('floating chat is single-flight and retries the same question without losing its identity',async()=>{
  const elements=new Map(),sent=[];let finish,fail=true;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:id==='sensei-floating-popover',value:'',events:{},addEventListener(name,fn){this.events[name]=fn;},setAttribute(){},focus(){},animate(){return {cancel(){}};}});return elements.get(id);};
  const c=vm.createContext({crypto,AbortSignal,signedInUser:{},sendingMessage:false,clearingChat:false,chatHistoryReady:true,matchMedia:()=>({matches:true}),window:{addEventListener(){}},document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},body:{dataset:{page:'dashboard'}}},mascotMgr:{setState(){}},soundEngine:{playReceive(){}},apiFetch:async(path,options)=>{sent.push(JSON.parse(options.body));return fail?new Promise(resolve=>finish=resolve):Response.json({reply:'回答'});}});
  vm.runInContext(source.slice(source.indexOf('function setupFloatingSensei()'),source.indexOf('// 15. SETTINGS')),c);
  c.setupFloatingSensei();
  element('popover-query-input').value='私の答え';
  const first=element('btn-popover-send').events.click();
  await element('btn-popover-send').events.click();assert.equal(sent.length,1);assert.equal(element('btn-popover-send').disabled,true);
  finish(Response.json({detail:'Try again'},{status:503}));await first;
  assert.equal(element('popover-query-input').value,'私の答え');
  fail=false;await element('btn-popover-send').events.click();
  assert.equal(sent.length,2);assert.equal(sent[0].request_id,sent[1].request_id);
  assert.equal(element('popover-query-input').value,'');assert.equal(element('popover-speech-text').textContent,'回答');
});

test('stopped or superseded speech cannot play a late audio response',async()=>{
  const pending=[],audio=[];
  const elements={};const element=id=>elements[id]??=( {hidden:true,textContent:''} );
  const c=vm.createContext({AbortSignal,AbortController,document:{getElementById:element},window:{speechSynthesis:{cancel(){}}},mascotMgr:{setState(){}},apiFetch:()=>new Promise(resolve=>pending.push(resolve)),audioDataUrl:()=>'',Audio:class{constructor(){audio.push(this);this.paused=false;}async play(){this.played=true;}pause(){this.paused=true;}}});
  vm.runInContext(source.slice(source.indexOf('let speechRequest ='),source.indexOf('// 7. TAB SWITCHER')),c);
  const first=c.playGeminiTTS('一');const second=c.playGeminiTTS('二');
  pending[0](Response.json({audioBase64:'late'}));await first;assert.equal(audio.length,0);
  pending[1](Response.json({audioBase64:'current'}));await second;assert.equal(audio.length,1);assert.equal(audio[0].played,true);
  c.stopSpeechPlayback();assert.equal(audio[0].paused,true);assert.equal(element('speech-player').hidden,true);
});
