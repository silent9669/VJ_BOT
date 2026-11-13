import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';
import {practiceCoach} from '../src/practice-coach.js';

class Node {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.hidden=false;this.textContent='';this.value='';this.attributes={};}
  get isConnected(){return this.root || Boolean(this.parent?.isConnected);}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
  setAttribute(key,value){this.attributes[key]=value;}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
  focus(){this.focused=true;}
}
function page(api,view='checks'){
  const body=new Node('body');body.root=true;
  const listeners=new Map();let mutation;
  const c=vm.createContext({signedInUser:{user_id:'first'},location:{hash:'#curriculum/N4/lesson/grammar/g'},AbortController,AbortSignal,crypto:webcrypto,
    apiFetch:api,document:{body,createElement:tag=>new Node(tag),getElementById:()=>null},
    MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},
    addEventListener:(event,fn)=>{listeners.set(event,[...(listeners.get(event)||[]),fn]);},
    VJProfiles:{active:()=>({scope:'server',id:c.connection||'first'})}});
  c.window=c;
  vm.runInContext(readFileSync('static/study-teacher.js','utf8'),c);
  const host=new Node(),label=new Node('span');label.textContent='someone helps me';body.append(host,label);
  const lesson={id:'g',level:'N4'},focus={kind:'question',index:2};let current=true;
  const cleanup=c.mountStudyTeacher(host,{lesson,focus,view,targets:[c.studyTarget('question:option:0',label,'someone helps me')],isCurrent:()=>current});
  const panel=host.children[0],button=panel.children[1],status=panel.children[2],reply=panel.children[3],chat=panel.children[4];
  const log=chat.children[1],form=chat.children[2],input=form.children[0].children[0],actions=form.children[1].children,chatStatus=chat.children[3];
  return {c,host,label,lesson,focus,panel,button,status,reply,chat,log,form,input,actions,chatStatus,cleanup,mutate:()=>mutation(),changeItem:()=>{current=false;mutation();},
    fire:event=>(listeners.get(event)||[]).forEach(fn=>fn({}))};
}
const result=(body,change={})=>({action:'teach',lesson:body.lesson,focus:body.focus,view:body.view,reply:'Quan sát vai trò của người nhận. Em sẽ dùng cách nói nào?',
  fields:[{key:'question:option:0',source:'someone helps me',text:'ai đó giúp tôi'}],...change});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('explicit teaching changes only presentation; asking again opens inline chat without regenerating the lesson',async()=>{
  const calls=[];const b=page(async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return Response.json(result(JSON.parse(options.body)));});
  b.mutate();assert.equal(calls.length,0);await b.button.onclick();assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/api/practice/coach');assert.deepEqual(calls[0].body,{lesson:b.lesson,focus:b.focus,view:'checks',action:'teach'});
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
  const pending=deferred();let body,signal;
  const b=page(async(_path,options)=>{body=JSON.parse(options.body);signal=options.signal;return pending.promise;});
  const sending=b.button.onclick();
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
    return Response.json(path==='/api/chat'?{reply:'<b>Em thử đổi người nhận nhé.</b>'}:result(body));
  });
  await b.button.onclick();await b.button.onclick();assert.equal(calls.length,1);
  b.input.value='Em chưa rõ ai là người nhận.';await submit(b);
  assert.equal(calls[1].path,'/api/chat');assert.deepEqual(calls[1].body.lesson,b.lesson);assert.deepEqual(calls[1].body.focus,b.focus);
  assert.equal(calls[1].body.message,'Em chưa rõ ai là người nhận.');assert.equal(calls[1].body.channel,'quick');
  assert.equal(calls[1].body.screen.text,'');assert.ok(calls[1].body.request_id);
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
    sent.push(options.body);return failed?Response.json({detail:'Mất kết nối.'},{status:503}):Response.json({reply:'Em nhìn người nhận nhé.'});
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Em chưa hiểu.';await submit(b);
  assert.equal(b.input.value,'Em chưa hiểu.');assert.equal(b.log.children.length,0);assert.match(b.chatStatus.textContent,/Mất kết nối/);
  assert.equal(b.actions[2].hidden,false);assert.equal(b.actions[0].disabled,true);assert.equal(sent.length,1);
  failed=false;await b.actions[2].onclick();assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
  assert.equal(b.log.children.length,2);assert.equal(b.actions[0].disabled,false);assert.equal(b.actions[2].hidden,true);
});

for(const transition of ['owner','connection','route','item'])test(`follow-up discards stale ${transition} responses and clears private drafts`,async()=>{
  const pending=deferred();let signal;
  const b=page(async(path,options)=>{
    if(path!=='/api/chat')return Response.json(result(JSON.parse(options.body)));
    signal=options.signal;return pending.promise;
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Câu hỏi riêng của em.';const sending=submit(b);
  await submit(b);assert.equal(b.actions[0].disabled,true);
  if(transition==='owner')b.c.signedInUser={user_id:'second'};
  if(transition==='connection')b.c.connection='second';
  if(transition==='route')b.c.location.hash='#other';
  if(transition==='item')b.changeItem();else b.mutate();
  assert.equal(signal.aborted,true);pending.resolve(Response.json({reply:'OLD RESPONSE'}));await sending;
  assert.equal(b.chat.hidden,true);assert.equal(b.input.value,'');assert.equal(b.log.children.length,0);
  assert.equal(b.label.textContent,'someone helps me');
});

test('closing chat with Escape aborts it and restores focus without another inference',async()=>{
  const pending=deferred();let signal,calls=0;
  const b=page(async(path,options)=>{
    if(path!=='/api/chat')return Response.json(result(JSON.parse(options.body)));
    calls++;signal=options.signal;return pending.promise;
  });
  await b.button.onclick();await b.button.onclick();b.input.value='Tại sao ạ?';const sending=submit(b);
  b.chat.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(signal.aborted,true);assert.equal(b.chat.hidden,true);assert.equal(b.button.focused,true);
  pending.resolve(Response.json({reply:'LATE'}));await sending;
  assert.equal(b.log.children.length,0);assert.equal(b.label.textContent,'ai đó giúp tôi');assert.equal(calls,1);
});

test('an exam teaching panel keeps the exam view when asking again and retrying a failed question',async()=>{
  const sent=[];let fail=true;
  const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);
    if(path!=='/api/chat')return Response.json(result(body));
    sent.push(options.body);
    return fail?Response.json({detail:'Kết nối bị ngắt.'},{status:503}):Response.json({reply:'Em hãy đối chiếu các lựa chọn trên đề nhé.'});
  },'exam');
  await b.button.onclick();await b.button.onclick();
  b.input.value='Lựa chọn thứ hai có nghĩa gì?';await submit(b);
  assert.equal(b.actions[2].hidden,false);assert.equal(b.log.children.length,0);
  fail=false;await b.actions[2].onclick();
  assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);
  assert.equal(JSON.parse(sent[1]).view,'exam');
  assert.deepEqual(JSON.parse(sent[1]).focus,b.focus);
  assert.equal(b.log.children[1].children[1].textContent,'Em hãy đối chiếu các lựa chọn trên đề nhé.');
  assert.equal(b.label.textContent,'ai đó giúp tôi');
});

test('administrator teaching and follow-up do not depend on private connection storage',async()=>{
  const calls=[];
  const b=page(async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});
    return Response.json(path==='/api/chat'?{reply:'Em đối chiếu vai trò người nhận nhé.'}:result(body));
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
    DB:{prepare(){throw new Error('Teaching must not change progress or grading.');}}};
  const connection={protocol:'openai',base_url:'https://synthetic.example.com/v1',model:'teaching-test',api_key:'test-only'};
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>{
    const evidence=JSON.parse(JSON.parse(options.body).messages.at(-1).content);calls.push(evidence);
    return Response.json({choices:[{message:{content:JSON.stringify({
      reply:'Em thử tự giới thiệu tên và công việc của mình nhé?',
      fields:evidence.fields.map(field=>({key:field.key,text:field.key==='explanation'
        ? 'Em hãy nói tên, quê quán và nghề nghiệp bằng ba câu.'
        : field.key==='example:vi'?'Em hãy viết phần giới thiệu về bản thân, gồm tên, quê quán và nghề nghiệp.':field.source}))
    })}}]});
  };
  t.after(()=>{globalThis.fetch=original;});
  const b=page(async(_path,options)=>practiceCoach(new Request('https://app.test/api/practice/coach',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(options.body),user_id:'learner',api_connection:connection})
  }),env));
  b.cleanup();
  b.c.fetch=async path=>({ok:true,json:async()=>JSON.parse(readFileSync('static/'+path,'utf8'))});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js','workspace.js','completion.js'])
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
    const panel=reference.children.find(child=>child.tagName==='aside');
    await panel.children[1].onclick();
    assert.equal(panel.children[3].hidden,false,panel.children[2].textContent);
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
  const panel=card.children[1].children[0];
  await panel.children[1].onclick();
  assert.equal(panel.children[3].hidden,false,panel.children[2].textContent);
  assert.equal(translation.textContent,'Em hãy viết phần giới thiệu về bản thân, gồm tên, quê quán và nghề nghiệp.');
  assert.equal(b.calls.at(-1).evidence.example.jp,unit.production.question_jp);
  assert.equal(b.calls.at(-1).fields.find(field=>field.key==='example:vi').source,unit.production.prompt);
  const canonical=b.catalogs.N5.lessons[descriptor.completionId];
  assert.equal(canonical.examples[unit.dialogue.length].jp,prompt.jp);
  assert.deepEqual(canonical.examples.slice(0,unit.dialogue.length).map(example=>example.jp),Array.from(unit.dialogue,example=>example.jp));
});
