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
  const c=vm.createContext({crypto,AbortSignal,Response,setTimeout:()=>{},signedInUser:{},userId:'qa',chatLessonContext:null,confirm:()=>true,apiFetch,document:{getElementById:element,querySelectorAll:()=>rows.slice()},soundEngine:{playSend(){},playReceive(){},playBlip(){}},mascotMgr:{setState(){}},renderBubble(role,content){const row={role,content,remove(){rows.splice(rows.indexOf(row),1);}};rows.push(row);}});
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

test('lesson history load and deletion use the selected lesson instead of general history',async()=>{
  const paths=[];
  const b=chat(async(path,options)=>{paths.push({path,method:options?.method || 'GET'});return Response.json(options?.method==='DELETE'?{ok:true}:[]);});
  b.c.chatLessonContext={id:'lesson:N5:reading:1',level:'N5'};
  await b.c.loadChatHistory();
  await b.element('btn-clear-chat-history').events.click();
  const expected='/api/history?lesson_id=lesson%3AN5%3Areading%3A1&level=N5';
  assert.deepEqual(paths,[{path:expected,method:'GET'},{path:expected,method:'DELETE'}]);
});
