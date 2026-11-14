import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';
import {practiceCoach} from '../src/practice-coach.js';

class Node {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.hidden=false;this._text='';this.value='';this.attributes={};}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){for(const child of this.children)child.parent=null;this.children=[];this._text=String(value);}
  get isConnected(){return this.root || Boolean(this.parent?.isConnected);}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
  setAttribute(key,value){this.attributes[key]=value;}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
  focus(){this.focused=true;}
  addEventListener(type,listener){(this.listeners??={})[type]??=[];this.listeners[type].push(listener);}
  emit(type){for(const listener of this.listeners?.[type] || [])listener({type});}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const byClass=(node,name)=>descendants(node).find(child=>child.className?.split(' ').includes(name));
const byText=(node,text)=>descendants(node).find(child=>child.tagName==='button' && child.textContent===text);
function panelControls(panel){
  const chat=byClass(panel,'study-teacher-chat'),form=byClass(chat,'study-teacher-compose');
  const actions=byClass(form,'study-teacher-chat-actions');
  return {panel,button:panel.children.find(child=>child.tagName==='button' && child.className==='study-teacher-button'),compare:byText(panel,'Xem bản gốc'),
    status:panel.children.find(child=>child.attributes.role==='status'),reply:byClass(panel,'study-teacher-reply'),chat,
    log:byClass(chat,'study-teacher-messages'),form,input:descendants(form).find(child=>child.tagName==='textarea'),
    send:byText(actions,'Gửi thầy'),close:byText(actions,'Để em thử lại'),retry:byText(actions,'Gửi lại cho thầy'),edit:byText(actions,'Hỏi câu khác'),
    chatStatus:chat.children.find(child=>child.attributes.role==='status')};
}
function page(api,view='checks',{progress,mount=true}={}){
  const body=new Node('body');body.root=true;
  const listeners=new Map(),progressCalls=[];let mutation;
  const c=vm.createContext({signedInUser:{user_id:'first'},location:{hash:'#curriculum/N4/lesson/grammar/g'},AbortController,AbortSignal,crypto:webcrypto,TextEncoder,
    apiFetch:async(path,options)=>{
      if(path!=='/api/progress/record')return api(path,options);
      const request=JSON.parse(options.body);progressCalls.push(request);
      return progress?progress(path,options):Response.json({recorded:true,task:request.task});
    },document:{body,createElement:tag=>new Node(tag),getElementById:()=>null},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},
    addEventListener:(event,fn)=>{listeners.set(event,[...(listeners.get(event)||[]),fn]);},
    VJProfiles:{active:()=>({scope:'server',id:c.connection||'first'})}});
  c.window=c;
  for(const file of ['learning.js','lesson-checks.js','study-plan.js','study-teacher.js'])
    vm.runInContext(readFileSync('static/'+file,'utf8'),c);
  const host=new Node(),options=['someone helps me','someone helps me','I help someone'].map((source,index)=>{
    const button=new Node('button'),label=new Node('span');button.value=String(index);label.textContent=source;button.append(label);return {button,label};
  });
  const label=options[0].label;body.append(host,...options.map(option=>option.button));
  const lesson={id:'g',level:'N4'},focus={kind:'question',index:2};
  const item={id:lesson.id,drills:Array.from({length:3},()=>({
    q:'だれが手伝ってくれますか。',instruction:'Choose the person who helps the speaker.',passage:'友だちが手伝ってくれます。',
    target:'手伝って',opts:options.map(option=>option.label.textContent),answer_index:1
  }))};
  const task=c.lessonQuestions(item,lesson.level,'grammar')[focus.index];let current=true;
  const cleanup=mount?c.mountStudyTeacher(host,{lesson,focus,view,task,
    targets:[c.studyTarget('question:option:0',label,task.opts[0])],isCurrent:()=>current}):()=>{};
  const controls=mount?panelControls(byClass(host,'study-teacher')):{};
  return {c,host,label,options,lesson,focus,item,task,progressCalls,...controls,cleanup,mutate:()=>mutation(),changeItem:()=>{current=false;mutation();},
    fire:event=>(listeners.get(event)||[]).forEach(fn=>fn({}))};
}
const result=(body,change={})=>({action:'teach',lesson:body.lesson,focus:body.focus,view:body.view,task:body.task,reply:'Quan sát vai trò của người nhận. Em sẽ dùng cách nói nào?',
  fields:[{key:'question:option:0',source:'someone helps me',text:'ai đó giúp tôi'}],...change});
const chatResult=(body,reply)=>({reply,task:body.task});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('explicit teaching changes only presentation; asking again opens inline chat without regenerating the lesson',async()=>{
  const calls=[];const b=page(async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return Response.json(result(JSON.parse(options.body)));});
  b.mutate();assert.equal(calls.length,0);await b.button.onclick();assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/api/practice/coach');
  const task=JSON.parse(JSON.stringify(await b.c.taskReference(b.task)));
  assert.deepEqual(calls[0].body,{lesson:b.lesson,focus:b.focus,view:'checks',action:'teach',task});
  assert.equal(task.id,'g:question:2');assert.match(task.revision,/^[a-f0-9]{64}$/);
  assert.equal(b.progressCalls.length,1);assert.deepEqual(b.progressCalls[0],{
    lesson:b.lesson,view:'checks',question_index:2,task,attempt_id:b.progressCalls[0].attempt_id,event:'assist',help:'translation'
  });assert.ok(b.progressCalls[0].attempt_id);
  assert.equal(b.label.textContent,'ai đó giúp tôi');assert.equal(b.reply.hidden,false);
  await b.button.onclick();assert.equal(b.chat.hidden,false);assert.equal(b.input.focused,true);
  assert.equal(b.button.attributes['aria-expanded'],'true');assert.equal(calls.length,1);assert.equal(b.label.textContent,'ai đó giúp tôi');
  b.cleanup();assert.equal(b.label.textContent,'someone helps me');
});

test('source mismatch, extra duplicate field and wrong canonical reference leave original choices intact with explicit retry',async()=>{
  for(const change of [{fields:[{key:'question:option:0',source:'another word',text:'sai nguồn'}]},
    {lesson:{id:'wrong',level:'N4'}},{focus:{kind:'question',index:3}},
    {fields:[{key:'question:option:0',source:'someone helps me',text:'a'},{key:'question:option:0',source:'someone helps me',text:'b'}]}]){
    let calls=0;const b=page(async(_path,options)=>{calls++;return Response.json(result(JSON.parse(options.body),change));});
    await b.button.onclick();assert.equal(b.label.textContent,'someone helps me');assert.equal(b.reply.hidden,true);assert.equal(b.button.disabled,false);assert.equal(calls,1);
  }
});

for(const transition of ['owner','connection','route','item'])test(`${transition} changes discard late teaching and clear completed replies`,async()=>{
  const pending=deferred(),started=deferred();let body,signal;
  const b=page(async(_path,options)=>{body=JSON.parse(options.body);signal=options.signal;started.resolve();return pending.promise;});
  const sending=b.button.onclick();await started.promise;
  if(transition==='owner')b.c.signedInUser={user_id:'second'};
  if(transition==='connection')b.c.connection='second';
  if(transition==='route')b.c.location.hash='#other';
  if(transition==='item')b.changeItem();else b.mutate();
  assert.equal(signal.aborted,true);pending.resolve(Response.json(result(body)));await sending;
  assert.equal(b.label.textContent,'someone helps me');assert.equal(b.reply.hidden,true);assert.equal(b.button.disabled,false);
  const completed=page(async(_path,options)=>Response.json(result(JSON.parse(options.body))));
  await completed.button.onclick();completed.changeItem();assert.equal(completed.reply.hidden,true);assert.equal(completed.label.textContent,'someone helps me');
});

test('model output is text, never HTML; provider failure is visible without automatic retries',async()=>{
  const b=page(async(_path,options)=>Response.json(result(JSON.parse(options.body),{reply:'<img src=x onerror=attack()> Em hãy thử lại.'})));
  await b.button.onclick();assert.match(b.reply.textContent,/<img/);assert.equal(b.reply.children.length,0);
  let calls=0;const failed=page(async()=>{calls++;return Response.json({detail:'Không có quota.'},{status:429});});
  await failed.button.onclick();assert.equal(calls,1);assert.match(failed.status.textContent,/quota/);assert.equal(failed.label.textContent,'someone helps me');
  await failed.button.onclick();assert.equal(calls,2);
});

const submit=b=>b.form.onsubmit({preventDefault(){}});
test('inline questions use canonical focus and isolated multi-turn scope; prose remains plain text',async()=>{
  const calls=[];const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});
    return Response.json(path==='/api/chat'?chatResult(body,'<b>Em thử đổi người nhận nhé.</b>'):result(body));
  });
  await b.button.onclick();await b.button.onclick();assert.equal(calls.length,1);
  b.input.value='Em chưa rõ ai là người nhận.';await submit(b);
  assert.equal(calls[1].path,'/api/chat');assert.deepEqual(calls[1].body.lesson,b.lesson);assert.deepEqual(calls[1].body.focus,b.focus);
  assert.equal(calls[1].body.message,'Em chưa rõ ai là người nhận.');assert.equal(calls[1].body.channel,'quick');
  assert.equal(calls[1].body.screen.text,'');assert.ok(calls[1].body.request_id);
  assert.deepEqual(calls[1].body.task,calls[0].body.task);
  assert.deepEqual(b.progressCalls.map(call=>call.help),['translation','chat']);
  assert.equal(b.progressCalls[0].attempt_id,b.progressCalls[1].attempt_id);
  assert.equal(b.log.children[1].children[1].textContent,'<b>Em thử đổi người nhận nhé.</b>');
  assert.equal(b.log.children[1].children[1].children.length,0);assert.equal(b.input.value,'');assert.equal(b.label.textContent,'ai đó giúp tôi');
  b.input.value='Còn người nói thì sao thầy?';await submit(b);
  assert.equal(calls[1].body.screen.route,calls[2].body.screen.route);assert.notEqual(calls[1].body.request_id,calls[2].body.request_id);
  const other=page(async(_path,options)=>Response.json(result(JSON.parse(options.body))));
  assert.notEqual(other.chat.id,b.chat.id);
});

test('failed follow-up retains the question and retries the identical request only on explicit retry',async()=>{
  const sent=[];let failed=true;
  const b=page(async(path,options)=>{
    if(path!=='/api/chat')return Response.json(result(JSON.parse(options.body)));
    sent.push(options.body);return failed?Response.json({detail:'Mất kết nối.'},{status:503}):Response.json(chatResult(JSON.parse(options.body),'Em nhìn người nhận nhé.'));
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Em chưa hiểu.';await submit(b);
  assert.equal(b.input.value,'Em chưa hiểu.');assert.equal(b.log.children.length,0);assert.match(b.chatStatus.textContent,/Mất kết nối/);
  assert.equal(b.retry.hidden,false);assert.equal(b.send.disabled,true);assert.equal(sent.length,1);
  failed=false;await b.retry.onclick();assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
  assert.equal(b.log.children.length,2);assert.equal(b.send.disabled,false);assert.equal(b.retry.hidden,true);
  assert.deepEqual(b.progressCalls.map(call=>call.help),['translation','chat'],'an identical provider retry does not open another help event');
});

for(const transition of ['owner','connection','route','item'])test(`follow-up discards stale ${transition} responses and clears private drafts`,async()=>{
  const pending=deferred(),started=deferred();let signal,body;
  const b=page(async(path,options)=>{
    if(path!=='/api/chat')return Response.json(result(JSON.parse(options.body)));
    body=JSON.parse(options.body);signal=options.signal;started.resolve();return pending.promise;
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Câu hỏi riêng của em.';const sending=submit(b);await started.promise;
  await submit(b);assert.equal(b.send.disabled,true);
  if(transition==='owner')b.c.signedInUser={user_id:'second'};
  if(transition==='connection')b.c.connection='second';
  if(transition==='route')b.c.location.hash='#other';
  if(transition==='item')b.changeItem();else b.mutate();
  assert.equal(signal.aborted,true);pending.resolve(Response.json(chatResult(body,'OLD RESPONSE')));await sending;
  assert.equal(b.chat.hidden,true);assert.equal(b.input.value,'');assert.equal(b.log.children.length,0);
  assert.equal(b.label.textContent,'someone helps me');
});

test('closing chat with Escape aborts it and restores focus without another inference',async()=>{
  const pending=deferred(),started=deferred();let signal,body,calls=0;
  const b=page(async(path,options)=>{
    if(path!=='/api/chat')return Response.json(result(JSON.parse(options.body)));
    body=JSON.parse(options.body);calls++;signal=options.signal;started.resolve();return pending.promise;
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Tại sao ạ?';const sending=submit(b);await started.promise;
  b.chat.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(signal.aborted,true);assert.equal(b.chat.hidden,true);assert.equal(b.button.focused,true);
  pending.resolve(Response.json(chatResult(body,'LATE')));await sending;
  assert.equal(b.log.children.length,0);assert.equal(b.label.textContent,'ai đó giúp tôi');assert.equal(calls,1);
});

test('original and generated comparison preserves duplicate source choices, option values and the canonical answer index',async()=>{
  const calls=[],b=page(async(path,options)=>{
    calls.push({path,body:JSON.parse(options.body)});return Response.json(result(JSON.parse(options.body)));
  });
  const original=JSON.stringify(b.task),values=b.options.map(option=>option.button.value);
  assert.equal(b.compare.hidden,true);
  await b.button.onclick();assert.equal(b.compare.hidden,false);assert.equal(b.label.textContent,'ai đó giúp tôi');
  assert.equal(b.options[1].label.textContent,'someone helps me','a duplicate choice is still its own source slot');
  await b.compare.onclick();assert.equal(b.label.textContent,'someone helps me');
  await b.compare.onclick();assert.equal(b.label.textContent,'ai đó giúp tôi');
  assert.deepEqual(b.options.map(option=>option.button.value),values);assert.equal(JSON.stringify(b.task),original);
  const attempt=b.c.focusedTaskAttempt(b.lesson,b.focus,'checks',b.task);
  await b.c.recordTaskEvent(attempt,'answer',{answer_index:Number(b.options[1].button.value)});
  assert.equal(b.progressCalls.at(-1).answer_index,1);
  assert.equal(b.progressCalls.at(-1).attempt_id,b.progressCalls[0].attempt_id);
  assert.deepEqual(b.progressCalls.at(-1).task,calls[0].body.task);
  assert.equal(calls.length,1,'comparing presentations and saving the source choice never regenerate AI content');
});

test('question teaching waits for a successful server assistance record before contacting the provider',async()=>{
  const pending=deferred(),started=deferred(),calls=[];let allow=false;
  const b=page(async(path,options)=>{
    assert.equal(allow,true);calls.push(path);return Response.json(result(JSON.parse(options.body)));
  },'checks',{progress:async(_path,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.help,'translation');
    if(allow)return Response.json({recorded:true});
    started.resolve();return pending.promise;
  }});
  const teaching=b.button.onclick();await started.promise;
  assert.equal(calls.length,0);assert.equal(b.label.textContent,'someone helps me');assert.equal(b.reply.hidden,true);
  pending.resolve(Response.json({detail:'Chưa lưu được hỗ trợ.'},{status:503}));await teaching;
  assert.equal(calls.length,0);assert.match(b.status.textContent,/Chưa lưu được hỗ trợ/);assert.equal(b.button.disabled,false);
  allow=true;await b.button.onclick();
  assert.deepEqual(calls,['/api/practice/coach']);assert.equal(b.progressCalls.length,2);
  assert.equal(b.progressCalls[0].attempt_id,b.progressCalls[1].attempt_id);
  assert.deepEqual(b.progressCalls[0].task,b.progressCalls[1].task);assert.equal(b.label.textContent,'ai đó giúp tôi');
});

test('follow-up cannot contact the provider until its assistance record succeeds, including an explicit retry',async()=>{
  const pending=deferred(),started=deferred(),chats=[];let allow=false;
  const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);
    if(path!=='/api/chat')return Response.json(result(body));
    assert.equal(allow,true);chats.push(body);return Response.json(chatResult(body,'Em nhìn người nhận nhé.'));
  },'checks',{progress:async(_path,options)=>{
    const body=JSON.parse(options.body);
    if(body.help==='translation' || allow)return Response.json({recorded:true});
    assert.equal(body.help,'chat');started.resolve();return pending.promise;
  }});
  await b.button.onclick();await b.button.onclick();b.input.value='Em chưa hiểu người nhận.';
  const sending=submit(b);await started.promise;assert.equal(chats.length,0);
  pending.resolve(Response.json({detail:'Chưa lưu được hỗ trợ hỏi bài.'},{status:503}));await sending;
  assert.equal(chats.length,0);assert.equal(b.log.children.length,0);assert.equal(b.input.value,'Em chưa hiểu người nhận.');
  assert.match(b.chatStatus.textContent,/Chưa lưu được hỗ trợ hỏi bài/);assert.equal(b.retry.hidden,false);
  allow=true;await b.retry.onclick();
  assert.equal(chats.length,1);assert.equal(chats[0].message,'Em chưa hiểu người nhận.');
  assert.deepEqual(b.progressCalls.map(call=>call.help),['translation','chat','chat']);
  assert.ok(b.progressCalls.every(call=>call.attempt_id===b.progressCalls[0].attempt_id));
  assert.deepEqual(chats[0].task,b.progressCalls.at(-1).task);
  assert.equal(b.log.children.length,2);assert.equal(b.input.value,'');
});

test('teaching ignores a response for a different task revision without changing the original presentation',async()=>{
  const calls=[],b=page(async(_path,options)=>{
    const body=JSON.parse(options.body);
    calls.push(body);
    return Response.json(result(body,{task:{...body.task,revision:'0'.repeat(64)}}));
  });
  await b.button.onclick();
  assert.equal(b.label.textContent,'someone helps me');assert.equal(b.reply.hidden,true);assert.equal(b.compare.hidden,true);
  assert.equal(b.status.attributes.role,'status');assert.notEqual(b.status.textContent.trim(),'');
  assert.equal(b.button.disabled,false);assert.equal(b.button.attributes['aria-busy'],'false');
  assert.equal(calls.length,1);assert.equal(b.progressCalls.length,1);
  assert.deepEqual(b.options.map(option=>option.label.textContent),['someone helps me','someone helps me','I help someone']);
  assert.deepEqual(b.options.map(option=>option.button.value),['0','1','2']);assert.equal(b.task.answer_index,1);
});

test('follow-up ignores a different task revision and retains the draft for an exact explicit retry',async()=>{
  const sent=[];let wrong=true;
  const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);if(path!=='/api/chat')return Response.json(result(body));
    sent.push(options.body);return Response.json({...chatResult(body,'Em nhìn người nhận nhé.'),
      ...(wrong?{task:{...body.task,revision:'0'.repeat(64)}}:{})});
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Người nhận là ai?';await submit(b);
  assert.equal(b.log.children.length,0);assert.equal(b.input.value,'Người nhận là ai?');
  assert.equal(b.chatStatus.attributes.role,'status');assert.notEqual(b.chatStatus.textContent.trim(),'');
  assert.equal(b.retry.hidden,false);assert.equal(b.send.disabled,true);assert.equal(b.input.readOnly,true);
  assert.equal(sent.length,1,'a rejected response never triggers an automatic provider retry');
  wrong=false;await b.retry.onclick();
  assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal(b.log.children.length,2);
  assert.deepEqual(b.progressCalls.map(call=>call.help),['translation','chat']);
});

test('mountQuizTeaching preserves instruction, passage and marked target before the learner requests AI',()=>{
  const calls=[],b=page(async path=>{calls.push(path);throw new Error('AI requires a click.');},'exam',{mount:false});
  vm.runInContext(readFileSync('static/completion.js','utf8'),b.c);
  const descriptor={...b.item,completionId:'test:N4:fixture',examIndex:0};
  b.c.featureLessons=(feature,level)=>{assert.equal(feature,'quiz');assert.equal(level,'N4');return [descriptor];};
  b.c.activeQuizLevel='N4';b.c.activeQuizTestIdx=0;b.c.examQuestionIdx=2;b.c.currentExamQuestions=b.item.drills;
  const card=new Node('section'),instruction=new Node('p'),passage=new Node('section'),passageText=new Node('p');
  const stem=new Node('p'),mark=new Node('mark'),prefix=new Node('span'),suffix=new Node('span'),grid=new Node('div');
  instruction.className='task-instruction';instruction.textContent=b.task.instruction;
  passage.className='task-stimulus';passageText.textContent=b.task.passage;passage.append(passageText);
  prefix.textContent='だれが';mark.textContent=b.task.target;suffix.textContent='くれますか。';stem.append(prefix,mark,suffix);
  grid.append(...b.options.map(option=>option.button));card.append(instruction,passage,stem,grid);b.host.append(card);
  b.c.document.getElementById=id=>({'quiz-card':card,'quiz-question':stem}[id] || null);
  b.c.document.querySelectorAll=selector=>selector==='#quiz-options-grid .quiz-option-label'?b.options.map(option=>option.label):[];
  const originalText=[instruction,passage,stem].map(node=>node.textContent);
  b.c.mountQuizTeaching();
  assert.deepEqual([instruction,passage,stem].map(node=>node.textContent),originalText);
  assert.equal(instruction.parent,card);assert.equal(passage.parent,card);assert.equal(passageText.parent,passage);
  assert.deepEqual(stem.children,[prefix,mark,suffix]);assert.equal(mark.parent,stem);assert.equal(mark.textContent,b.task.target);
  assert.deepEqual(b.options.map(option=>option.label.textContent),Array.from(b.task.opts));
  assert.ok(panelControls(byClass(card,'study-teacher')).button);
  assert.equal(calls.length,0);assert.equal(b.progressCalls.length,0);
});

test('an exam teaching panel keeps the exam view when asking again and retrying a failed question',async()=>{
  const sent=[];let fail=true;
  const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);
    if(path!=='/api/chat')return Response.json(result(body));
    sent.push(options.body);
    return fail?Response.json({detail:'Kết nối bị ngắt.'},{status:503}):Response.json(chatResult(body,'Em hãy đối chiếu các lựa chọn trên đề nhé.'));
  },'exam');
  await b.button.onclick();await b.button.onclick();
  b.input.value='Lựa chọn thứ hai có nghĩa gì?';await submit(b);
  assert.equal(b.retry.hidden,false);assert.equal(b.log.children.length,0);
  fail=false;await b.retry.onclick();
  assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
  assert.equal(JSON.parse(sent[1]).view,'exam');
  assert.deepEqual(JSON.parse(sent[1]).focus,b.focus);
  assert.deepEqual(JSON.parse(sent[1]).task,JSON.parse(JSON.stringify(await b.c.taskReference(b.task))));
  assert.ok(b.progressCalls.every(call=>call.view==='exam' && call.question_index===b.focus.index));
  assert.equal(b.log.children[1].children[1].textContent,'Em hãy đối chiếu các lựa chọn trên đề nhé.');
  assert.equal(b.label.textContent,'ai đó giúp tôi');
});

test('administrator teaching and follow-up do not depend on private connection storage',async()=>{
  const calls=[];
  const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});
    return Response.json(path==='/api/chat'?chatResult(body,'Em đối chiếu vai trò người nhận nhé.'):result(body));
  });
  b.c.signedInUser.is_admin=true;
  const blocked=()=>{throw new Error('Personal preferences are unavailable');};
  b.c.VJProfiles.active=blocked;b.c.usesAntigravityOAuth=blocked;b.c.antigravityConnectionId=blocked;
  await b.button.onclick();
  assert.equal(b.label.textContent,'ai đó giúp tôi');
  await b.button.onclick();b.input.value='Thầy cho em một ví dụ nhé.';await submit(b);
  assert.equal(calls.length,2);
  assert.equal(b.log.children[1].children[1].textContent,'Em đối chiếu vai trò người nhận nhé.');
  b.c.signedInUser.is_admin=false;b.mutate();
  assert.equal(b.reply.hidden,true);assert.equal(b.chat.hidden,true);
  assert.equal(b.label.textContent,'someone helps me');
});

let catalogPromise;
async function practicalPage(t) {
  const catalogs=await (catalogPromise ??= buildTeacherCatalog()),calls=[];
  const env={ASSETS:{fetch:async request=>Response.json(catalogs[new URL(request.url).pathname.match(/teacher-(N[1-5])/)[1]])},
    DB:{prepare(){throw new Error('Non-question reference teaching must not change progress or grading.');}}};
  const connection={protocol:'openai',base_url:'https://synthetic.example.com/v1',model:'teaching-test',api_key:'test-only'};
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>{
    const evidence=JSON.parse(JSON.parse(options.body).messages.at(-1).content);calls.push(evidence);
    return Response.json({choices:[{message:{content:JSON.stringify({
      reply:'Em thử tự giới thiệu tên và công việc của mình nhé?',
      fields:evidence.fields.map(field=>({key:field.key,text:field.key==='explanation'
        ? 'Em hãy nói tên, quê quán và nghề nghiệp bằng ba câu.'
        : field.key==='example:translation'?`${field.source} — Xin chào lần đầu. Hãy cho tôi biết tên và công việc của bạn.`:field.source}))
    })}}]});
  };
  t.after(()=>{globalThis.fetch=original;});
  const b=page(async(path,options)=>{
    assert.equal(path,'/api/practice/coach');
    const body=JSON.parse(options.body);
    assert.equal(Object.hasOwn(body,'task'),false,'reference teaching must not invent a task reference');
    return practiceCoach(new Request('https://app.test/api/practice/coach',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,user_id:'learner',api_connection:connection})
    }),env);
  },'checks',{mount:false,progress:()=>{throw new Error('Reference teaching must not submit synthetic progress.');}});
  t.after(()=>assert.equal(b.progressCalls.length,0));
  b.c.fetch=async path=>({ok:true,json:async()=>JSON.parse(readFileSync('static/'+path,'utf8'))});
  for(const file of ['jlpt-data.js','vi-labels.js','workspace.js','completion.js'])
    vm.runInContext(readFileSync('static/'+file,'utf8'),b.c);
  await b.c.loadPracticalCourse();await b.c.ensureLessons('N5');
  const units=b.c.createStudyPlan('N5'),unit=units.find(unit=>unit.id==='practical:v1:N5:introductions');
  return {...b,calls,catalogs,unit};
}

test('practical vocabulary and production reference teaching replaces the displayed goal, not the different unit note',async t=>{
  const b=await practicalPage(t),{unit}=b;
  assert.notEqual(unit.goal,unit.note);
  const items=[
    [unit.steps.find(step=>step.skill==='vocabulary').lesson,'vocabulary'],
    [b.c.JLPT_DATA.curriculum.N5.skills.production.find(item=>item.id===unit.id+':production'),'production']
  ];
  for(const [item,skill] of items){
    const reference=new Node('section'),explanation=new Node('p');explanation.textContent=item.explanation || item.summary;
    assert.equal(explanation.textContent,unit.goal);
    reference.append(explanation);b.host.append(reference);b.host.dataset={mode:'read'};
    b.host.querySelector=()=>reference;
    reference.querySelector=selector=>selector==='.lesson-explain'?explanation:null;
    reference.querySelectorAll=()=>[];
    b.c.currentLesson=item;b.c.mountLessonTeaching(b.host,item,'N5',skill);
    const panel=reference.children.find(child=>child.tagName==='aside'),controls=panelControls(panel);
    await controls.button.onclick();
    assert.equal(controls.reply.hidden,false,controls.status.textContent);
    assert.equal(explanation.textContent,'Em hãy nói tên, quê quán và nghề nghiệp bằng ba câu.');
    assert.equal(b.calls.at(-1).fields.find(field=>field.key==='explanation').source,unit.goal);
    assert.equal(item.summary,unit.goal);
  }
});

test('a practical speaking production prompt has a canonical teaching panel without shifting dialogue positions or completion IDs',async t=>{
  const b=await practicalPage(t),{unit}=b;
  const descriptor=b.c.findFeatureLesson('kaiwa','N5',`kaiwa-lesson:N5:${unit.id}`);
  const scenario=b.c.JLPT_DATA.kaiwaScenarios[unit.id],prompt=scenario.prompts[0];
  assert.ok(unit.dialogue.every(example=>example.jp!==prompt.jp));
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.examples.slice(0,unit.dialogue.length))),JSON.parse(JSON.stringify(unit.dialogue)));
  assert.equal(descriptor.completionId,'kaiwa:'+unit.id);
  const card=new Node('section'),translation=new Node('p');translation.textContent=prompt.vi;card.append(translation);b.host.append(card);
  b.c.document.querySelector=selector=>selector==='.kaiwa-prompt-card'?card:null;
  b.c.document.getElementById=id=>id==='kaiwa-prompt-vi'?translation:null;
  b.c.activeKaiwaLevel='N5';b.c.activeKaiwaKey=unit.id;b.c.activeKaiwaPromptIdx=0;
  b.c.mountKaiwaTeaching(scenario,prompt);
  assert.equal(card.children.length,2,'the displayed production question receives its teaching panel');
  const panel=byClass(card,'study-teacher'),controls=panelControls(panel);
  await controls.button.onclick();
  assert.equal(controls.reply.hidden,false,controls.status.textContent);
  assert.equal(translation.textContent,'');
  assert.match(byClass(panel,'study-generated-fields').textContent,/Xin chào lần đầu/);
  assert.equal(b.calls.at(-1).evidence.example.jp,unit.production.question_jp);
  assert.equal(b.calls.at(-1).fields.find(field=>field.key==='example:translation').source,unit.production.question_jp);
  assert.ok(!b.calls.at(-1).fields.some(field=>field.source===unit.production.prompt),'a broader written prompt cannot masquerade as a translation of the spoken question');
  const canonical=b.catalogs.N5.lessons[descriptor.completionId];
  assert.equal(canonical.examples[unit.dialogue.length].jp,prompt.jp);
  assert.deepEqual(canonical.examples.slice(0,unit.dialogue.length).map(example=>example.jp),Array.from(unit.dialogue,example=>example.jp));
});

function practiceHelpPage(api,{progress,writing=false,saved=false}={}){
  const b=page(api,'checks',{progress,mount:false});
  vm.runInContext(readFileSync('static/practice.js','utf8'),b.c);
  const section=new Node('section'),actions=new Node('div');actions.className='practice-actions';
  section.append(actions);b.host.append(section);
  section.querySelector=selector=>selector==='.practice-actions'?actions:null;
  actions.before=element=>{element.parent=section;section.children.splice(section.children.indexOf(actions),0,element);};
  const task=writing?{...b.task,mode:'writing',opts:[],answer_index:null,criteria:['Viết lời mời phù hợp.']}:b.task;
  let current=true;
  const answer=writing?{correct:null,selected:'いっしょに公園へ行きませんか。',saved}:null;
  const cleanup=b.c.mountPracticeCoach(section,b.host,b.lesson,task,b.focus.index,answer,{
    targets:[b.c.studyTarget('question:option:0',b.label,task.opts[0] || b.label.textContent)],isCurrent:()=>current});
  const area=byClass(section,'practice-coach'),content=byClass(area,'practice-help-content');
  area.open=true;
  const teaching=byClass(area,'practice-teaching'),panel=byClass(teaching,'study-teacher');
  teaching.open=true;
  const chat=byClass(area,'study-teacher-chat'),form=byClass(chat,'study-teacher-compose');
  const chatActions=byClass(form,'study-teacher-chat-actions');
  return {...b,section,area,content,task,answer,teaching,panel,chat,form,
    coachButton:content.children.find(child=>child.tagName==='button'),
    coachStatus:content.children.find(child=>child.attributes.role==='status'),
    coachReply:byClass(content,'practice-coach-reply'),
    teachButton:panel.children.find(child=>child.tagName==='button' && child.className==='study-teacher-button'),
    ask:content.children.filter(child=>child.tagName==='button').at(-1),
    input:descendants(form).find(child=>child.tagName==='textarea'),
    close:byText(chatActions,'Để em thử lại'),send:byText(chatActions,'Gửi thầy'),
    log:byClass(chat,'study-teacher-messages'),
    cleanup,changeTask:()=>{current=false;vm.runInContext('practiceCoachRefresh?.()',b.c);b.mutate();},
    collapse:()=>{area.open=false;area.emit('toggle');b.mutate();}};
}

const coachResult=(body,change={})=>({action:body.action,item_id:body.item_id,task:body.task,
  reply:'Em chú ý người nhận hành động nhé.',...change});
const pendingLines=area=>descendants(area).filter(node=>node.attributes.role==='status'
  && !node.hidden && /Thầy đang/.test(node.textContent));

test('practice mounts one composer and serializes hint, teaching and chat operations for the current task',async()=>{
  const calls=[],started=deferred(),pending=deferred();let hintBody;
  const b=practiceHelpPage(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});
    if(body.action==='hint'){hintBody=body;started.resolve();return pending.promise;}
    return Response.json(path==='/api/chat'?chatResult(body,'Ở đây は nêu chủ đề.\n\n私は学生です。'):result(body));
  });
  try{
    assert.equal(descendants(b.area).filter(node=>node.className==='study-teacher-compose').length,1);
    const hint=b.coachButton.onclick();await started.promise;
    await b.coachButton.onclick();await b.teachButton.onclick();
    b.ask.onclick();b.input.value='Thầy giải thích đề giúp em nhé.';await submit(b);
    assert.equal(calls.length,1);assert.equal(b.progressCalls.length,1);
    assert.equal(b.progressCalls[0].help,'hint');assert.equal(pendingLines(b.area).length,1);
    assert.equal(b.log.children.length,0);
    pending.resolve(Response.json(coachResult(hintBody)));await hint;
    assert.equal(b.coachReply.textContent,'Em chú ý người nhận hành động nhé.');
    assert.equal(pendingLines(b.area).length,0);
    await b.teachButton.onclick();assert.equal(calls.length,2);
    assert.equal(b.progressCalls.at(-1).help,'translation');
    await b.teachButton.onclick();assert.equal(calls.length,2,'follow-up opens the existing composer without regenerating teaching');
    await submit(b);assert.equal(calls.length,3);assert.equal(b.progressCalls.at(-1).help,'chat');
    assert.deepEqual(b.progressCalls.map(call=>call.help),['hint','translation','chat']);
    assert.ok(b.progressCalls.every(call=>call.attempt_id===b.progressCalls[0].attempt_id));
    assert.equal(b.log.children[1].children[1].textContent,'Ở đây は nêu chủ đề.\n\n私は学生です。');
    assert.equal(b.log.children[1].children[1].children.length,0);
  }finally{pending.resolve(Response.json(coachResult(hintBody || {})));b.cleanup();}
});

test('practice teaching holds the shared operation lock before its assistance receipt and during inference',async()=>{
  const receipt=deferred(),recording=deferred(),pending=deferred(),started=deferred(),calls=[];
  const b=practiceHelpPage(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});started.resolve();return pending.promise;
  },{progress:async(_path,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.help,'translation');recording.resolve();return receipt.promise;
  }});
  try{
    const teaching=b.teachButton.onclick();await recording.promise;
    await b.coachButton.onclick();b.ask.onclick();b.input.value='Em hỏi thêm nhé.';await submit(b);
    assert.equal(calls.length,0);assert.equal(b.progressCalls.length,1);assert.equal(pendingLines(b.area).length,1);
    receipt.resolve(Response.json({recorded:true}));await started.promise;
    await b.coachButton.onclick();await submit(b);
    assert.equal(calls.length,1);assert.equal(b.progressCalls.length,1);
    pending.resolve(Response.json(result(calls[0].body)));await teaching;
    assert.equal(pendingLines(b.area).length,0);
  }finally{receipt.resolve(Response.json({recorded:true}));pending.resolve(Response.json({}));b.cleanup();}
});

for(const transition of ['collapse','owner','task'])test(`practice ${transition} invalidation aborts help and hides late private output`,async()=>{
  const started=deferred(),pending=deferred();let signal,body;
  const b=practiceHelpPage(async(_path,options)=>{
    signal=options.signal;body=JSON.parse(options.body);started.resolve();return pending.promise;
  });
  try{
    const hint=b.coachButton.onclick();await started.promise;
    if(transition==='collapse')b.collapse();
    else if(transition==='owner'){b.c.signedInUser={user_id:'second'};b.fire('vjbot-account-ready');b.mutate();}
    else b.changeTask();
    assert.equal(signal.aborted,true);
    pending.resolve(Response.json(coachResult(body,{reply:'PRIVATE LATE RESPONSE'})));await hint;
    assert.equal(b.coachReply.hidden,true);assert.doesNotMatch(b.area.textContent,/PRIVATE LATE RESPONSE/);
    assert.equal(b.log.children.length,0);
  }finally{pending.resolve(Response.json({}));b.cleanup();}
});

test('saved writing starts advisory feedback once and retains the exact submitted text',async()=>{
  const started=deferred(),pending=deferred(),calls=[];
  const b=practiceHelpPage(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});started.resolve();return pending.promise;
  },{writing:true,saved:true});
  try{
    await started.promise;await b.coachButton.onclick();await b.teachButton.onclick();b.mutate();
    assert.equal(calls.length,1);assert.equal(calls[0].body.action,'feedback');
    assert.equal(calls[0].body.response_text,b.answer.selected);
    assert.equal(pendingLines(b.area).length,1);
    pending.resolve(Response.json(coachResult(calls[0].body,{source_correct:null,assessment:{comparison:'unassessed'},basis:'self_report',verified:false})));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(b.coachReply.hidden,false);assert.equal(calls.length,1);
    assert.deepEqual(b.progressCalls.map(call=>call.help),['chat']);
    assert.equal(b.coachReply.textContent,'Em chú ý người nhận hành động nhé.');
    assert.doesNotMatch(b.content.textContent,/Đối chiếu với đáp án|Nhận xét của AI, để em tham khảo/);
  }finally{pending.resolve(Response.json({}));b.cleanup();}
  const unsavedCalls=[],unsaved=practiceHelpPage(async(path)=>{unsavedCalls.push(path);return Response.json({});},{writing:true,saved:false});
  try{await new Promise(resolve=>setImmediate(resolve));assert.equal(unsavedCalls.length,0);assert.equal(unsaved.progressCalls.length,0);}
  finally{unsaved.cleanup();}
});

test('an in-flight practice follow-up prevents competing coach and translation requests',async()=>{
  const started=deferred(),pending=deferred(),calls=[];
  const b=practiceHelpPage(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});
    if(path==='/api/chat'){started.resolve();return pending.promise;}
    return Response.json(coachResult(body));
  });
  try{
    b.ask.onclick();b.input.value='Em chưa rõ yêu cầu.';const chat=submit(b);await started.promise;
    await b.coachButton.onclick();await b.teachButton.onclick();await submit(b);
    assert.equal(calls.length,1);assert.equal(pendingLines(b.area).length,1);
    assert.deepEqual(b.progressCalls.map(call=>call.help),['chat']);
    pending.resolve(Response.json(chatResult(calls[0].body,'Em tìm người nhận hành động trước nhé.')));await chat;
    assert.equal(b.log.children.length,2);assert.equal(pendingLines(b.area).length,0);
    await b.coachButton.onclick();assert.equal(calls.length,2);
    assert.deepEqual(b.progressCalls.map(call=>call.help),['chat','hint']);
  }finally{pending.resolve(Response.json({}));b.cleanup();}
});

test('same-account task invalidation clears completed practice help and refuses another request',async()=>{
  let calls=0;
  const b=practiceHelpPage(async(_path,options)=>{
    calls++;return Response.json(coachResult(JSON.parse(options.body)));
  });
  try{
    await b.coachButton.onclick();assert.equal(b.coachReply.hidden,false);assert.equal(calls,1);
    b.changeTask();
    assert.equal(b.coachReply.hidden,true);assert.equal(b.coachReply.textContent,'');
    await b.coachButton.onclick();assert.equal(calls,1);
  }finally{b.cleanup();}
});
