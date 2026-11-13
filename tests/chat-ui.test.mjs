import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('static/app.js','utf8');
function chat(apiFetch){
  const elements=new Map(),rows=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',style:{},events:{},children:[],hidden:false,disabled:false,append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,fn){this.events[name]=fn;},querySelectorAll:()=>rows.slice(),click(){return this.events.click?.();}});
    return elements.get(id);
  };
  const c=vm.createContext({crypto,AbortSignal,Response,setTimeout:()=>{},signedInUser:{},userId:'qa',chatLessonContext:null,confirm:()=>true,apiFetch,buildLessonContext:(item,level)=>({id:item.id,level}),updateHeroTopic(){},mountCompletion(){},document:{getElementById:element,createElement:()=>({}),querySelectorAll:()=>rows.slice()},soundEngine:{playSend(){},playReceive(){},playBlip(){}},mascotMgr:{setState(){}},renderBubble(role,content){const row={role,content,remove(){rows.splice(rows.indexOf(row),1);}};rows.push(row);}});
  vm.runInContext(source.slice(source.indexOf('let sendingMessage=false'),source.indexOf('async function loadGreeting()')),c);
  vm.runInContext(source.slice(source.indexOf('  const btnClearChat ='),source.indexOf('  // Level selector click')),c);
  vm.runInContext(source.slice(source.indexOf('async function startReversedLesson(')),c);
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

test('main chat sends explicit intent and bound focus, preserving both on retry',async()=>{
  const sent=[];let fail=true;
  const b=chat(async(path,options)=>{
    if(path.startsWith('/api/history'))return Response.json([]);
    sent.push(JSON.parse(options.body));return fail?Response.json({detail:'Offline'},{status:503}):Response.json({response:'答え'});
  });
  b.c.teacherContext=()=>({screen:{route:'curriculum/N3/lesson/grammar/one'},lesson:{id:'one',level:'N3'},focus:{kind:'word',index:2}});
  await b.c.loadChatHistory();await b.c.sendMessage('Gợi ý',false,{intent:'hint'});
  fail=false;await b.element('chat-retry').onclick();
  assert.equal(sent[0].intent,'hint');assert.deepEqual(sent[0].focus,{kind:'word',index:2});
  assert.deepEqual(sent[0].lesson,{id:'one',level:'N3'});assert.deepEqual(sent[1],sent[0]);
});
test('a pinned lesson cannot borrow focus from another remembered lesson',async()=>{
  let body;
  const b=chat(async(path,options)=>{if(path.startsWith('/api/history'))return Response.json([]);body=JSON.parse(options.body);return Response.json({reply:'はい'});});
  await b.c.loadChatHistory();b.c.chatLessonContext={id:'pinned',level:'N4'};
  b.c.teacherContext=()=>({lesson:{id:'different',level:'N3'},screen:{text:'unrelated'},focus:{kind:'question',index:0}});
  await b.c.sendMessage('Tiếp tục',false,{focus:{kind:'word',index:0}});
  assert.equal(body.focus,null);assert.equal(body.screen.text,'unrelated');assert.equal(body.lesson.id,'pinned');
});
test('an explicit restart sends a new turn and never deletes history',async()=>{
  const requests=[];
  const b=chat(async(path,options)=>{requests.push({path,method:options?.method,body:options?.body&&JSON.parse(options.body)});return Response.json(path==='/api/history'?[{role:'bot',content:'archived turn'}]:{reply:'Bắt đầu lại'});});
  await b.c.loadChatHistory();await b.c.restartTutorConversation();
  assert.equal(requests[1].body.intent,'restart');assert.equal(requests[1].method,'POST');
  assert.equal(b.rows[0].content,'archived turn');assert.ok(!requests.some(r=>r.method==='DELETE'));
});
test('lesson entry resumes saved turns, starts only empty history, and explicit restart is a turn',async()=>{
  const sent=[];let saved=true;
  const b=chat(async(path,options)=>{
    if(path.startsWith('/api/history'))return Response.json(saved?[{role:'bot',content:'Em hãy thử lại câu trước.'}]:[]);
    sent.push(JSON.parse(options.body));return Response.json({reply:'Câu hỏi mới'});
  });
  await b.c.startReversedLesson({id:'lesson-one',title:'Bài một'},'N3','grammar');
  assert.equal(sent.length,0);assert.equal(b.rows[0].content,'Em hãy thử lại câu trước.');
  await b.element('chat-lesson-context').children[3].onclick();
  assert.equal(sent[0].intent,'restart');assert.equal(sent[0].lesson.id,'lesson-one');
  saved=false;await b.c.startReversedLesson({id:'lesson-two',title:'Bài hai'},'N4','grammar');
  assert.equal(sent[1].intent,'start');assert.equal(sent[1].lesson.id,'lesson-two');
});
test('inferred lesson scope restores its history before main chat sends a new turn',async()=>{
  const requests=[];
  const b=chat(async(path,options)=>{requests.push(path);return Response.json(path.startsWith('/api/history')?[]:{reply:'はい'});});
  await b.c.loadChatHistory();
  b.c.teacherContext=()=>({lesson:{id:'remembered',level:'N3'},screen:{route:'curriculum/N3/lesson/grammar/remembered'},focus:null});
  await b.c.sendMessage('Tiếp tục bài này');
  assert.deepEqual(requests,['/api/history','/api/history?lesson_id=remembered&level=N3','/api/chat']);
});
