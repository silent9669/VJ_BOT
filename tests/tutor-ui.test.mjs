import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';

const app=readFileSync('static/app.js','utf8');
const checks=readFileSync('static/lesson-checks.js','utf8');
const learning=readFileSync('static/learning.js','utf8');
const plan=readFileSync('static/study-plan.js','utf8');
const completion=readFileSync('static/completion.js','utf8');
function loadLearning(context){
  vm.runInContext(readFileSync('static/vi-labels.js','utf8'),context);
  vm.runInContext(completion.slice(completion.indexOf('function activityId('),completion.indexOf('function mountCompletion(')),context);
  vm.runInContext(checks,context);
  vm.runInContext(plan.slice(plan.indexOf('function lessonQuestions('),plan.indexOf('function lessonProgressIds(')),context);
  vm.runInContext(learning,context);
}
function taskFixture(overrides={}){
  const task={q:'第一?',instruction:'',passage:'',script_jp:'',target:'',parts:[],opts:['A','B'],answer_index:0,
    accepted_answers:[],item_id:'q0',task_id:'practice:question:0',source_position:0,mode:'choice',skill:'grammar',
    review_status:'unreviewed',unavailable_reason:'',explanation:'',example_indexes:[],source_language:'vi',
    capabilities:{answer:true,hint:true,evaluation:true,processing:true},...overrides};
  for(const key of ['parts','opts','accepted_answers','example_indexes'])Object.freeze(task[key]);
  Object.freeze(task.capabilities);return Object.freeze(task);
}
const plain=value=>JSON.parse(JSON.stringify(value));
// Small DOM fixture: real parent/child ownership, parsed markup, selectors and events.
// It deliberately does not mock the tutor's handlers or their request ownership.
const decode=text=>text.replace(/&(?:amp|lt|gt|quot|#39);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[x]));
class Element {
  constructor(tag='div'){this.nodeType=1;this.tagName=tag.toUpperCase();this.childNodes=[];this.dataset={};this.style={};this.events={};this.attributes={};this.hidden=false;this.disabled=false;this.value='';}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  get parentNode(){return this.parentElement;}
  get isConnected(){return !!this.parentElement;}
  get classList(){return {contains:name=>(this.className||'').split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...(this.className||'').split(/\s+/),...names])].join(' ');},remove:(...names)=>{this.className=(this.className||'').split(/\s+/).filter(n=>!names.includes(n)).join(' ');},toggle:(name,force)=>{const has=(this.className||'').split(/\s+/).includes(name),add=force??!has;add?this.classList.add(name):this.classList.remove(name);return add;}};}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=String(value);if(name==='class')this.className=String(value);if(name==='hidden'||name==='disabled'||name==='open')this[name]=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
  getAttribute(name){return name==='id'?this.id:name==='class'?this.className:this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];if(name==='hidden'||name==='disabled')this[name]=false;}
  append(...children){for(const child of children){child.parentElement=this;this.childNodes.push(child);}}
  appendChild(child){this.append(child);return child;}
  prepend(child){child.parentElement=this;this.childNodes.unshift(child);}
  before(child){if(this.parentElement){child.parentElement=this.parentElement;this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this),0,child);}}
  after(child){if(this.parentElement){child.remove();child.parentElement=this.parentElement;this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this)+1,0,child);}}
  replaceChildren(...children){for(const child of this.childNodes)child.parentElement=null;this.childNodes=[];this.append(...children);}
  remove(){if(this.parentElement){this.parentElement.childNodes=this.parentElement.childNodes.filter(c=>c!==this);this.parentElement=null;}}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}
  set textContent(text){this.replaceChildren({nodeType:3,textContent:String(text)});}
  get innerText(){return this.textContent;}
  set innerHTML(html){
    this.replaceChildren();const stack=[this];
    for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){
      if(token.startsWith('</')){stack.pop();continue;}
      if(token.startsWith('<')){
        const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;
        const element=new Element(tag);
        for(const attr of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))element.setAttribute(attr[1],decode(attr[2]??attr[3]??attr[4]??''));
        stack.at(-1).append(element);if(!['input','img','br','hr','meta','link','source'].includes(tag)&&!token.endsWith('/>'))stack.push(element);
      }else stack.at(-1).append({nodeType:3,textContent:decode(token)});
    }
  }
  matches(selector){return selector.split(',').some(part=>{
    const path=part.trim().split(/\s+/);let node=this;if(!node.simpleMatch(path.pop()))return false;
    while(path.length){const next=path.pop();node=node.parentElement;while(node&&!node.simpleMatch(next))node=node.parentElement;if(!node)return false;}return true;
  });}
  simpleMatch(selector){
    const attrs=[...selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];
    if(!attrs.every(([,name,value])=>value===undefined?this.getAttribute(name)!==null:this.getAttribute(name)===value))return false;
    selector=selector.replace(/\[[^\]]+\]/g,'');
    const id=selector.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;
    const classes=[...selector.matchAll(/\.([\w-]+)/g)].map(m=>m[1]);if(!classes.every(name=>(this.className||'').split(/\s+/).includes(name)))return false;
    const tag=selector.match(/^[\w-]+/)?.[0];return !tag||tag.toUpperCase()===this.tagName;
  }
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  addEventListener(type,handler){(this.events[type]??=[]).push(handler);}
  dispatch(type,properties={}){const event={key:'',preventDefault(){},target:this,...properties};return Promise.all([this['on'+type]?.(event),...(this.events[type]||[]).map(fn=>fn(event))]);}
  async click(){
    if(this.disabled)return;
    await this.dispatch('click');
    if(this.tagName==='SUMMARY' && this.parentElement?.tagName==='DETAILS'){
      this.parentElement.open=!this.parentElement.open;await this.parentElement.dispatch('toggle');
    }
  }
  focus(){this.focused=true;return this.dispatch('focus');}
  scrollIntoView(){}
}
function dom(){
  const body=new Element('body'),document={body,createElement:tag=>new Element(tag),createTextNode:text=>({nodeType:3,textContent:String(text)}),getElementById:id=>body.querySelector('#'+id),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector)};
  const add=(id,tag='div',parent=body)=>{const element=new Element(tag);element.id=id;parent.append(element);return element;};
  return {document,add,element:id=>document.getElementById(id)};
}
function quick(apiFetch){
  const d=dom(),popover=d.add('sensei-floating-popover');popover.hidden=true;
  for(const id of ['btn-close-popover','btn-popover-send','popover-query-input','popover-speech-text','btn-popover-tts'])d.add(id,id.includes('btn-')?'button':'div',popover);
  d.add('btn-topbar-summon','button');const chip=d.add('chip','button',popover);chip.className='quick-chip-btn';chip.dataset.ask='Ví dụ';
  const timers=new Map(),listeners=new Map();let nextTimer=0;
  const c=vm.createContext({crypto:webcrypto,TextEncoder,AbortController,signedInUser:{user_id:'learner'},location:{hash:'#kaiwa/N3/session/A'},apiFetch,document:d.document,window:{addEventListener:(event,fn)=>{(listeners.get(event)||listeners.set(event,[]).get(event)).push(fn);}},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),soundEngine:{playBlip(){},playReceive(){}},mascotMgr:{setState(){}},playGeminiTTS(){},teacherContext:()=>({screen:{route:c.location.hash.slice(1),level:'N3'},lesson:{id:'kaiwa:N3:A',level:'N3'},focus:{kind:'example',index:1}})});
  loadLearning(c);
  vm.runInContext(app.slice(app.indexOf('function setupFloatingSensei()'),app.indexOf('// 15. SETTINGS')),c);c.setupFloatingSensei();
  return {...d,c,chip,timers,fire:event=>Promise.all((listeners.get(event)||[]).map(fn=>fn({})))};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function focusedQuick(apiFetch){
  const b=quick(apiFetch),panel=b.add('panel-lesson');panel.className='tab-panel active';
  b.add('modal-lesson-title','h1',panel).textContent='Vocabulary';
  b.add('reference','p',panel).textContent='Word A / Word B';
  b.c.location.hash='#curriculum/N3/lesson/vocabulary/words';
  b.c.currentLesson={level:'N3',skill:'vocabulary',item:{id:'words',items:[{id:'A'},{id:'B'}]}};
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),b.c);b.c.markTeacherScreen();
  b.c.setTeacherFocus({kind:'word',index:0});
  return b;
}

test('quick send, Enter and chips share one in-flight owner and send lesson/focus',async()=>{
  const pending=deferred(),sent=[];const b=quick((_path,options)=>{sent.push(JSON.parse(options.body));return pending.promise;});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Câu này';
  const sending=b.element('btn-popover-send').click();b.element('popover-query-input').value='second';
  await b.element('popover-query-input').dispatch('keydown',{key:'Enter'});await b.chip.click();
  assert.equal(sent.length,1);assert.equal(b.element('popover-query-input').value,'second');assert.equal(b.chip.disabled,true);
  assert.deepEqual(sent[0].lesson,{id:'kaiwa:N3:A',level:'N3'});assert.deepEqual(sent[0].focus,{kind:'example',index:1});assert.ok(sent[0].request_id);
  pending.resolve(Response.json({reply:'Câu trả lời'}));await sending;
  assert.equal(b.element('popover-speech-text').textContent,'Câu trả lời');assert.equal(b.chip.disabled,false);
});
test('quick errors are visible, never invent success, never auto-retry, and explicit retry preserves identity',async()=>{
  const sent=[];let response=Response.json({detail:'Provider offline'},{status:503});
  const b=quick(async(_path,options)=>{sent.push(JSON.parse(options.body));return response;});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Hỏi';await b.element('btn-popover-send').click();
  assert.equal(b.element('popover-speech-text').textContent,'Provider offline');assert.equal(b.element('btn-popover-retry').hidden,false);assert.equal(sent.length,1);
  b.element('popover-query-input').value='Tin khác';await b.element('btn-popover-send').click();assert.equal(sent.length,1);
  response=Response.json({});await b.element('btn-popover-retry').click();assert.match(b.element('popover-speech-text').textContent,/chưa trả lời/);assert.deepEqual(sent[1],sent[0]);
  response=Response.json({response:'Đã trả lời'});await b.element('btn-popover-retry').click();assert.deepEqual(sent[2],sent[0]);assert.equal(b.element('btn-popover-retry').hidden,true);
});
test('quick timeout releases controls and offers only explicit retry',async()=>{
  let calls=0;
  const b=quick((_path,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError'))));});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Chờ';const sending=b.element('btn-popover-send').click();
  assert.equal(b.timers.size,1);[...b.timers.values()][0]();await sending;
  assert.match(b.element('popover-speech-text').textContent,/quá lâu/);assert.equal(b.element('btn-popover-send').disabled,false);assert.equal(b.element('btn-popover-retry').hidden,false);assert.equal(calls,1);
});
test('closed and reopened popover ignores an earlier result, including its finally block',async()=>{
  const requests=[];const b=quick(()=>{const request=deferred();requests.push(request);return request.promise;});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Old';const old=b.element('btn-popover-send').click();
  await b.element('btn-close-popover').click();await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='New';const current=b.element('btn-popover-send').click();
  requests[0].resolve(Response.json({reply:'STALE'}));await old;
  assert.equal(b.element('popover-speech-text').textContent,'Thầy đang suy nghĩ…');assert.equal(b.element('btn-popover-send').disabled,true);
  requests[1].resolve(Response.json({reply:'CURRENT'}));await current;assert.equal(b.element('popover-speech-text').textContent,'CURRENT');
});
test('route and focus changes prevent old quick responses from updating the current surface',async()=>{
  for(const change of ['route','focus']){
    const request=deferred(),b=quick(()=>request.promise);
    await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Old';const sending=b.element('btn-popover-send').click();
    if(change==='route'){b.c.location.hash='#kaiwa/N3/session/B';b.c.invalidateTeacherQuery();}
    else b.c.teacherContext=()=>({lesson:{id:'other',level:'N3'},focus:{kind:'word',index:0}});
    request.resolve(Response.json({reply:'STALE'}));await sending;
    assert.doesNotMatch(b.element('popover-speech-text').textContent,/STALE/);assert.equal(b.element('btn-popover-send').disabled,false);assert.equal(b.element('btn-popover-retry').hidden,true);
  }
});
test('a running exam timer does not discard a reply for the unchanged question',async()=>{
  const request=deferred(),started=deferred(),sent=[],b=quick((path,options)=>{
    const body=JSON.parse(options.body);sent.push({path,body});
    if(path==='/api/progress/record')return Promise.resolve(Response.json({task:body.task}));
    started.resolve(body);return request.promise;
  });
  const panel=b.add('panel-quiz');panel.className='tab-panel active';
  const workspace=b.add('practice-workspace','div',panel);b.add('quiz-card','div',workspace);
  const timer=b.add('exam-timer','span',workspace);timer.textContent='24:10';
  b.c.location.hash='#quiz/N3/practice/0';
  b.c.findFeatureLesson=()=>null;b.c.featureLessons=()=>[{id:'exam',examIndex:0,drills:[taskFixture()]}];
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),b.c);b.c.markTeacherScreen();
  b.c.setTeacherFocus({kind:'question',index:0});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Explain this question';
  const sending=b.element('btn-popover-send').click();timer.textContent='24:09';
  const body=await started.promise;
  assert.deepEqual(sent.map(entry=>entry.path),['/api/progress/record','/api/chat']);
  assert.equal(sent[0].body.event,'assist');assert.equal(sent[0].body.help,'chat');assert.equal(sent[0].body.view,'exam');
  assert.deepEqual(body.task,sent[0].body.task);assert.match(body.task.revision,/^[a-f0-9]{64}$/);
  assert.equal(body.task.id,'exam:question:0');
  request.resolve(Response.json({reply:'The explanation for question one',task:body.task}));await sending;
  assert.equal(b.element('popover-speech-text').textContent,'The explanation for question one');
});
test('a changed Kaiwa prompt still invalidates the previous prompt response',async()=>{
  const request=deferred(),b=quick(()=>request.promise);
  const panel=b.add('panel-kaiwa');panel.className='tab-panel active';b.add('kaiwa-session','div',panel);
  const prompts=[{jp:'お名前は？'},{jp:'お仕事は？'}];
  b.c.window.JLPT_DATA={kaiwaScenarios:{A:{prompts}}};
  b.c.findFeatureLesson=()=>({id:'kaiwa-lesson:N3:A',examples:prompts});
  b.c.activeKaiwaKey='A';b.c.activeKaiwaLevel='N3';b.c.activeKaiwaPromptIdx=0;
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),b.c);b.c.markTeacherScreen();
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Explain this question';
  const sending=b.element('btn-popover-send').click();b.c.activeKaiwaPromptIdx=1;
  request.resolve(Response.json({reply:'STALE EXPLANATION'}));await sending;
  assert.doesNotMatch(b.element('popover-speech-text').textContent,/STALE EXPLANATION/);
  assert.equal(b.element('btn-popover-send').disabled,false);
});

test('scenario buttons navigate through addressable session routes and quick scope follows B',async()=>{
  const sent=[],b=quick(async(_path,options)=>{sent.push(JSON.parse(options.body));return Response.json({reply:'B'});});
  b.c.TAB_TITLES={landing:'Home',kaiwa:'Nói'};vm.runInContext(readFileSync('static/navigation.js','utf8'),b.c);
  const container=b.add('kaiwa-scenarios-grid');b.add('kaiwa-level');b.c.kaiwaRenderRequest=0;b.c.activeKaiwaLevel='N3';b.c.activeKaiwaKey='A';
  b.c.window.JLPT_DATA={kaiwaScenarios:{A:{title:'A',level:'N3'},B:{title:'B',level:'N3'}}};b.c.loadPracticalCourse=async()=>{};b.c.installCourseKaiwa=()=>{};b.c.loadKaiwaPrompt=()=>{};
  b.c.switchTab=(tab,route)=>{b.c.invalidateTeacherQuery();b.c.location.hash=b.c.appRouteHash(tab,route);};
  b.c.teacherContext=()=>({screen:{route:b.c.location.hash.slice(1)},lesson:{id:'kaiwa:N3:'+b.c.parseAppRoute(b.c.location.hash).id,level:'N3'},focus:null});
  vm.runInContext(app.slice(app.indexOf('async function renderKaiwaScenarios()'),app.indexOf('function loadKaiwaPrompt()')),b.c);
  await b.c.renderKaiwaScenarios();await container.children[1].click();
  const restored=b.c.parseAppRoute(b.c.location.hash);assert.equal(restored.id,'B');assert.equal(restored.view,'session');
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='B?';await b.element('btn-popover-send').click();assert.equal(sent[0].screen.route,'kaiwa/N3/session/B');
  assert.equal(sent[0].lesson.id,'kaiwa:N3:B');
});

function lesson(globals={}){
  const d=dom(),panel=d.add('panel-lesson');panel.className='tab-panel active';
  for(const id of ['btn-close-lesson-modal','lesson-page','modal-lesson-badge','modal-lesson-title','modal-lesson-body'])d.add(id,'div',panel);
  d.add('topbar-view-title').textContent='Bài học';
  const c=vm.createContext({document:d.document,window:{},location:{hash:''},crypto:webcrypto,TextEncoder,AbortController,AbortSignal,curriculumView:'plan',studyPlans:new Map(),currentLesson:null,activeCurriculumSkill:'grammar',activeCurriculumLevel:'N5',soundEngine:{},playGeminiTTS(){},mountCompletion(){},addFeatureLessonAction(){},renderLessonOutline(){},returnToCourse(){},openStudyStep(){},speechReading:(word)=>word,apiFetch:async()=>Response.json({}),...globals});
  loadLearning(c);
  vm.runInContext(readFileSync('static/practice.js','utf8'),c);
  vm.runInContext(app.slice(app.indexOf('function lessonExampleHtml('),app.indexOf('// 10. FLASHCARDS CONTROLLER')),c);
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),c);
  c.switchTab=(_tab,route)=>{c.rememberTeacherScreen();c.location.hash=`#curriculum/${route.level}/lesson/${route.skill}/${route.id}`;c.markTeacherScreen();return true;};
  return {...d,c};
}
test('opening the second word binds its actual canonical position and a new lesson clears it',async()=>{
  const b=lesson(),item={id:'words',title:'Từ vựng',items:[{jp:'私',vi:'tôi'},{jp:'先生',vi:'giáo viên'}]};
  b.c.showLessonDetail(item,'N3','vocabulary');const word=b.document.querySelectorAll('.word-detail')[1];word.open=true;await word.dispatch('toggle');
  assert.deepEqual(JSON.parse(JSON.stringify(b.c.teacherContext().focus)),{kind:'word',index:1});assert.equal(b.c.teacherContext().lesson.id,'words');
  b.c.showLessonDetail({...item,id:'next'},'N4','vocabulary');assert.equal(b.c.teacherContext().focus,null);assert.equal(b.c.teacherContext().lesson.level,'N4');
});
test('dictation requires an attempt before reveal and saves the actual text as self-report, never correctness',async()=>{
  const b=lesson(),sent=[],revealing=deferred(),started=deferred();
  const item={id:'listening',title:'Nghe',dictation:true,examples:[{jp:'一',vi:'một'},{jp:'二',vi:'hai'}]};
  b.c.apiFetch=async(path,options)=>{
    const body=JSON.parse(options.body);sent.push({path,body});
    if(body.event==='assist'){started.resolve();return revealing.promise;}
    return Response.json({task:body.task,basis:'self_report',source_correct:null});
  };
  b.c.showLessonDetail(item,'N3','listening');await b.document.querySelector('[data-lesson-mode=practice]').click();
  const rows=b.document.querySelectorAll('.lesson-exercise'),first=rows[0],second=rows[1];
  const input=first.querySelector('textarea'),reveal=first.querySelectorAll('button')[1],answer=first.children[3];
  await second.querySelector('button').click();
  assert.deepEqual(plain(b.c.teacherContext().focus),{kind:'question',index:1});
  await reveal.click();assert.equal(answer.hidden,true);assert.equal(sent.length,0);
  input.value='いち';await input.focus();
  assert.deepEqual(plain(b.c.teacherContext().focus),{kind:'question',index:0});
  const revealingAnswer=reveal.click();await started.promise;
  assert.equal(answer.hidden,true,'source transcript remains hidden until assistance is recorded');
  assert.equal(sent[0].body.help,'source_reveal');assert.equal(sent[0].body.event,'assist');
  revealing.resolve(Response.json({task:sent[0].body.task}));await revealingAnswer;
  assert.equal(answer.hidden,false);assert.equal(input.readOnly,true);assert.match(answer.textContent,/一/);
  await answer.querySelector('button').click();
  const saved=sent[1].body;
  assert.equal(saved.event,'answer');assert.equal(saved.response_text,'いち');assert.equal(saved.self_rating,4);
  assert.equal(saved.attempt_id,sent[0].body.attempt_id);assert.deepEqual(saved.task,sent[0].body.task);
  assert.equal(saved.task.id,'listening:question:0');assert.equal(saved.question_index,0);
  for(const key of ['correct','quality','answer_index'])assert.equal(Object.hasOwn(saved,key),false);
  second.querySelector('textarea').value='PRIVATE SUBMISSION';await second.querySelector('textarea').focus();
  assert.equal(b.c.teacherContext().focus.index,1);assert.equal(JSON.stringify(b.c.teacherContext()).includes('PRIVATE SUBMISSION'),false);
});
test('practice focus follows original question position rather than radio option index',async()=>{
  const b=lesson(),questions=[taskFixture(),taskFixture({q:'第二?',answer_index:1,item_id:'q1',task_id:'practice:question:1',source_position:1})];
  b.c.showLessonDetail({id:'practice',title:'Bài tập',drills:questions},'N3','grammar');assert.equal(b.c.teacherContext().focus,null);
  await b.document.querySelector('[data-lesson-mode=practice]').click();assert.equal(b.c.teacherContext().focus.index,0);
  const option=b.document.querySelector('.practice-options input');option.checked=true;await option.dispatch('change');await b.document.querySelector('.practice-session .practice-primary').click();await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(b.c.teacherContext().focus.index,1);await b.document.querySelector('.practice-options input').focus();assert.equal(b.c.teacherContext().focus.index,1);
  await b.document.querySelector('.practice-options input').dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(b.c.teacherContext().focus,null);
  await b.document.querySelector('.practice-result-actions button').click();
  assert.equal(b.c.teacherContext().focus.index,1,'review retains the original canonical index');
  await b.document.querySelector('[data-lesson-mode=read]').click();assert.equal(b.c.teacherContext().focus,null);
});
test('classroom chip clicks send explicit pedagogical intents',async()=>{
  const b=dom(),sent=[];
  for(const id of ['btn-ask-hint','btn-ask-explain','btn-ask-example','btn-ask-check','chat-prompt-chips'])b.add(id,'button');
  const c=vm.createContext({document:b.document,sendMessage:(text,retry,options)=>sent.push(options.intent),restartTutorConversation(){}});
  vm.runInContext(app.slice(app.indexOf('  // Classroom prompt chips'),app.indexOf('  // Classroom form submit')),c);
  for(const id of ['btn-ask-hint','btn-ask-explain','btn-ask-example','btn-ask-check'])await b.element(id).click();
  assert.deepEqual(sent,['hint','explain','situation','check']);
  assert.ok(b.element('btn-restart-chat'),'restart control is present in general chat too');
});

test('SRS ordering retains canonical word identity without capturing either flashcard face',async()=>{
  const b=lesson(),panel=b.element('panel-lesson');panel.id='panel-flashcards';
  const review=b.add('flashcard-review','div',panel),card=b.add('flashcard-card','div',review);
  card.innerHTML='<div class="card-face card-front"><p id="fc-front-text"></p><p id="fc-reading-text"></p></div><div class="card-face card-back"><span id="fc-back-label"></span><button id="btn-fc-audio-back"></button><p id="fc-back-meaning"></p><div class="card-example-box"><p id="fc-example-jp"></p><p id="fc-example-vi"></p></div></div>';
  for(const id of ['fc-counter','fc-badge-lvl','fc-btn-prev','fc-btn-next'])b.add(id,'div',review);
  b.add('fc-face-status','span',review);b.c.soundEngine.playFlip=()=>{};
  b.add('btn-fc-reveal','button',review);
  b.add('controls','div',review).className='fc-controls-bar';
  const item={id:'words',items:[{id:'word-a',jp:'私',vi:'PRIVATE A'},{id:'word-b',jp:'先生',vi:'PRIVATE B',examples:[{jp:'BACK EXAMPLE',vi:'BACK TRANSLATION'}]}]};
  b.c.window.JLPT_DATA={curriculum:{N3:{skills:{vocabulary:[item]}}}};
  b.c.location.hash='#flashcards/N3/review/words';b.c.markTeacherScreen();
  b.c.findFeatureLesson=()=>item;b.c.ensureLessons=async()=>{};
  b.c.apiFetch=async()=>Response.json({items:[{item_id:'word-b',next_review:'2020-01-01'}]});
  let invalidations=0;b.c.invalidateTeacherQuery=()=>invalidations++;
  vm.runInContext(app.slice(app.indexOf('let fcDeck ='),app.indexOf('// 11. KAIWA SPEAKING LAB CONTROLLER')),b.c);
  vm.runInContext(app.slice(app.indexOf('  // Flashcard Flipper click'),app.indexOf('  // Flashcard audio TTS')),b.c);
  await b.c.renderFlashcards('N3','words');
  assert.equal(b.element('fc-front-text').textContent,'先生','reviewed due card sorts ahead of the unseen first word');
  assert.equal(b.c.teacherContext().focus.index,1,'focus is canonical word index, not SRS deck index zero');
  assert.equal(invalidations,1);
  const front=card.querySelector('.card-front'),back=card.querySelector('.card-back');
  assert.equal(front.inert,false);assert.equal(front.getAttribute('aria-hidden'),'false');
  assert.equal(back.inert,true);assert.equal(back.getAttribute('aria-hidden'),'true');
  assert.match(b.element('fc-face-status').textContent,/nghĩa được che/);
  b.c.displayFlashcard();assert.equal(invalidations,1,'same stable word does not invalidate quick ownership');
  assert.equal(Object.hasOwn(b.c.teacherContext().screen,'text'),false);
  await b.element('btn-fc-reveal').click();
  assert.equal(card.classList.contains('flipped'),true);
  assert.equal(front.inert,true);assert.equal(front.getAttribute('aria-hidden'),'true');
  assert.equal(back.inert,false);assert.equal(back.getAttribute('aria-hidden'),'false');
  assert.equal(b.c.teacherContext().focus.index,1);
  assert.equal(JSON.stringify(b.c.teacherContext()).includes('PRIVATE B'),false);
  await card.dispatch('keydown',{key:'Enter'});assert.equal(card.classList.contains('flipped'),false);
  await b.element('btn-fc-reveal').click();
  vm.runInContext('fcIdx=1;displayFlashcard();',b.c);
  assert.equal(b.c.teacherContext().focus.index,0);assert.equal(card.classList.contains('flipped'),false);
  assert.equal(front.inert,false);assert.equal(front.getAttribute('aria-hidden'),'false');
  assert.equal(back.inert,true);assert.equal(back.getAttribute('aria-hidden'),'true');
  assert.equal(invalidations,2,'moving to another automatic word invalidates quick ownership');
  assert.equal(b.element('btn-fc-reveal').getAttribute('aria-expanded'),'false');
  assert.equal(back.querySelector('.card-example-box').hidden,true);
  assert.equal(b.element('btn-fc-audio-back').hidden,true);
  assert.doesNotMatch(b.element('fc-back-label').textContent,/ví dụ/i);
  assert.equal(JSON.stringify(b.c.teacherContext()).includes('PRIVATE A'),false);
  card.dataset.teacherWordId='not-in-this-lesson';assert.equal(b.c.teacherContext().focus,null);
});
test('no due flashcards shows an empty message outside the hidden rating controls',async()=>{
  const b=lesson(),panel=b.element('panel-lesson');panel.id='panel-flashcards';
  const review=b.add('flashcard-review','div',panel),controls=b.add('controls','div',review);controls.className='fc-controls-bar';
  b.add('fc-counter','div',controls);b.add('flashcard-card','div',review);b.add('btn-fc-reveal','button',review);
  const empty=b.add('fc-empty','p',review);empty.hidden=true;b.add('fc-rating-help','p',review);
  const item={id:'words',items:[{id:'word-a',jp:'私',vi:'tôi'}]};
  b.c.window.JLPT_DATA={curriculum:{N3:{skills:{vocabulary:[item]}}}};
  b.c.ensureLessons=async()=>{};
  b.c.apiFetch=async()=>Response.json({items:[{item_id:'word-a',next_review:'2999-01-01'}]});
  vm.runInContext(app.slice(app.indexOf('let fcDeck ='),app.indexOf('// 11. KAIWA SPEAKING LAB CONTROLLER')),b.c);
  await b.c.renderFlashcards('N3','words');
  assert.equal(controls.hidden,true);assert.equal(b.element('flashcard-card').hidden,true);
  assert.equal(empty.hidden,false);assert.ok(empty.textContent.trim());assert.equal(empty.closest('.fc-controls-bar'),null);
  assert.equal(b.element('fc-rating-help').hidden,true);
});
function quiz(){
  const b=lesson(),panel=b.element('panel-lesson');panel.id='panel-quiz';
  const workspace=b.add('practice-workspace','div',panel),card=b.add('quiz-card','div',workspace);
  for(const id of ['quiz-q-num','quiz-q-type','quiz-instruction','quiz-question-sentence','quiz-options-grid'])b.add(id,'div',card);
  const feedback=b.add('quiz-feedback-box','div',card);
  b.add('quiz-feedback-status','strong',feedback);b.add('quiz-feedback-text','p',feedback);
  b.add('btn-quiz-next','button',feedback);
  const result=b.add('quiz-result-card','div',workspace);
  for(const id of ['quiz-final-score-val','quiz-result-praise','quiz-completion'])b.add(id,'div',result);
  b.c.location.hash='#quiz/N3/practice/2';b.c.markTeacherScreen();
  b.c.examTimerInterval=null;b.c.examScore=0;b.c.examAnswers=new Map();b.c.quizRequest=0;
  b.c.activeQuizLevel='N3';b.c.activeQuizTestIdx=2;b.c.examQuestionIdx=8;
  const drills=Array.from({length:20},(_,i)=>taskFixture({q:`QUESTION ${i}`,item_id:`q${i}`,task_id:`test:N3:full:question:${i}`,source_position:i}));
  const item={id:'quiz-full',completionId:'test:N3:full',examIndex:2,drills};
  b.c.currentExamQuestions=b.c.lessonQuestions(item,'N3','reading');
  b.c.findFeatureLesson=()=>item;b.c.featureLessons=()=>[item];
  b.c.window.JLPT_DATA={exams:{N3:[null,null,{title:'Full exam'}]}};b.c.examIdentity=()=> 'N3:full';b.c.loadProgress=()=>{};
  vm.runInContext(app.slice(app.indexOf('function displayQuizQuestion()'),app.indexOf('// 13. MASTERY & PROGRESS CONTROLLER')),b.c);
  return {...b,item,panel};
}
test('full exam and ordinary lesson practice retain the same twenty canonical task positions',()=>{
  const b=quiz();let invalidations=0;b.c.invalidateTeacherQuery=()=>invalidations++;
  b.c.displayQuizQuestion();assert.equal(b.c.teacherContext().focus.index,8);
  assert.equal(b.c.teacherContext().task.task_id,'test:N3:full:question:8');
  assert.equal(b.element('quiz-q-num').textContent,'Câu 9 / 20');
  assert.equal(Object.hasOwn(b.c.teacherContext().screen,'text'),false);
  b.c.setTeacherFocus({kind:'question',index:19});assert.equal(b.c.teacherContext().focus.index,19);
  b.c.setTeacherFocus({kind:'question',index:20});assert.equal(b.c.teacherContext().focus,null);
  b.c.setTeacherFocus({kind:'question',index:8});const beforeFinish=invalidations;b.c.finishExam();
  assert.equal(b.c.teacherContext().lesson,null);assert.equal(b.c.teacherContext().focus,null);
  assert.equal(Object.hasOwn(b.c.teacherContext().screen,'text'),false);assert.ok(invalidations>beforeFinish);
  assert.match(b.element('quiz-completion').textContent,/Chưa xác nhận làm trọn bộ/);
  b.panel.id='panel-lesson';b.c.location.hash='#quiz/N3/lesson/quiz-full';
  b.c.currentLesson={item:b.item,level:'N3',skill:'reading',owner:'quiz'};b.c.markTeacherScreen();
  b.c.setTeacherFocus({kind:'question',index:8});assert.equal(b.c.teacherContext().focus.index,8);
  b.c.setTeacherFocus({kind:'question',index:19});assert.equal(b.c.teacherContext().focus.index,19);
  b.c.setTeacherFocus({kind:'question',index:20});assert.equal(b.c.teacherContext().focus,null);
});
test('full exam grades duplicate option positions and records the original index on its canonical task',async()=>{
  const b=quiz(),sent=[],saved=deferred();
  const task=taskFixture({q:'提出の読みは？',target:'提出',opts:['あれ','あれ','これ','それ'],answer_index:1,
    parts:['あれ','あれ','これ','それ'],passage:'文章を読んでください。',explanation:'POST ANSWER RATIONALE',
    item_id:'q8',task_id:'test:N3:full:question:8',source_position:8});
  b.item.drills[8]=task;b.c.currentExamQuestions=b.c.lessonQuestions(b.item,'N3','reading');
  b.c.apiFetch=async(path,options)=>{const body=JSON.parse(options.body);sent.push({path,body});return Response.json({task:body.task});};
  b.c.displayQuizQuestion();
  assert.equal(b.element('btn-quiz-next').parentElement,b.element('quiz-card'));
  const sentence=b.element('quiz-question-sentence');
  assert.equal(sentence.querySelector('mark').textContent,'提出');
  assert.equal(sentence.querySelector('.task-stimulus').textContent,'文章を読んでください。');
  assert.deepEqual(sentence.querySelectorAll('.task-parts li').map(element=>element.textContent),['あれ','あれ','これ','それ']);
  assert.doesNotMatch(sentence.textContent,/POST ANSWER RATIONALE/);
  assert.deepEqual(b.element('quiz-options-grid').querySelectorAll('.quiz-option-label').map(element=>element.textContent),task.opts);
  b.element('btn-quiz-next').addEventListener('focus',saved.resolve);
  await b.element('quiz-options-grid').children[0].click();await saved.promise;
  assert.equal(sent[0].path,'/api/progress/record');assert.equal(sent[0].body.answer_index,0);
  assert.equal(sent[0].body.question_index,8);assert.equal(sent[0].body.view,'exam');
  assert.equal(sent[0].body.task.id,'test:N3:full:question:8');
  assert.equal(b.c.examAnswers.get(8),false,'same text at another position does not match the stored key');
  assert.equal(b.element('quiz-options-grid').children[1].dataset.state,'correct');
  assert.equal(b.element('quiz-feedback-box').hidden,true);
  assert.equal(b.element('quiz-feedback-text').textContent,'');
});

test('completed quick A is cleared and no longer playable after selecting B, not after timer/same focus',async()=>{
  const b=focusedQuick(async()=>Response.json({reply:'ANSWER FOR A'})),spoken=[];
  b.c.playGeminiTTS=text=>spoken.push(text);
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='A?';await b.element('btn-popover-send').click();
  assert.equal(b.element('btn-popover-tts').disabled,false);
  await b.element('btn-popover-tts').click();assert.deepEqual(spoken,['ANSWER FOR A']);
  b.element('reference').textContent='Word A / Word B · 24:09';
  b.c.setTeacherFocus({kind:'word',index:0});
  assert.equal(b.element('popover-speech-text').textContent,'ANSWER FOR A','unchanged canonical focus ignores timer text');
  b.c.setTeacherFocus({kind:'word',index:1});
  assert.doesNotMatch(b.element('popover-speech-text').textContent,/ANSWER FOR A/);assert.equal(b.element('btn-popover-tts').disabled,true);
  await b.element('btn-popover-tts').click();assert.equal(spoken.length,1);
});
test('failed quick A does not block a new request after selecting B',async()=>{
  const sent=[],b=focusedQuick(async(_path,options)=>{
    sent.push(JSON.parse(options.body));
    return sent.length===1?Response.json({detail:'A failed'},{status:503}):Response.json({reply:'ANSWER FOR B'});
  });
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='A?';await b.element('btn-popover-send').click();
  assert.equal(b.element('btn-popover-retry').hidden,false);
  b.c.setTeacherFocus({kind:'word',index:1});
  assert.equal(b.element('btn-popover-retry').hidden,true);b.element('popover-query-input').value='B?';await b.element('btn-popover-send').click();
  assert.equal(sent.length,2);assert.equal(sent[1].focus.index,1);assert.notEqual(sent[0].request_id,sent[1].request_id);
  assert.equal(b.element('popover-speech-text').textContent,'ANSWER FOR B');
});
test('legacy hidden level picker handlers still navigate through canonical feature routes',async()=>{
  const b=dom(),destinations=[];
  for(const [id,cls] of [['fc-level-picker','fc-lvl-btn'],['quiz-level-picker','quiz-lvl-btn']]){
    const host=b.add(id),button=b.add(id+'-N4','button',host);button.className=cls;button.dataset.lvl='N4';
  }
  const c=vm.createContext({document:b.document,switchTab:(tab,route)=>destinations.push({tab,...route})});
  vm.runInContext(app.slice(app.indexOf('  // Flashcards Level Picker'),app.indexOf('  // Flashcard Flipper click')),c);
  vm.runInContext(app.slice(app.indexOf('  // Quiz Level Picker buttons'),app.indexOf('  const btnQuizRestart =')),c);
  await b.element('fc-level-picker-N4').click();await b.element('quiz-level-picker-N4').click();
  assert.deepEqual(destinations,[{tab:'flashcards',level:'N4'},{tab:'quiz',level:'N4'}]);
});

test('managed administrator practice preserves canonical grading without reading private connection preferences',async()=>{
  const b=lesson(),sent=[];
  const questions=[taskFixture({q:'Chọn quan sát trực tiếp?',opts:['Không có gió lạnh','Phải thay máy'],explanation:'Dấu hiệu không phải kết luận.'})],events=[];
  b.c.signedInUser={user_id:'learner',is_admin:true};
  b.c.usesAntigravityOAuth=()=>{throw new Error('Managed practice must not read private preferences');};
  b.c.apiFetch=async(path,options)=>{
    const body=JSON.parse(options.body);events.push({path,body});
    if(path!=='/api/practice/coach')return Response.json({task:body.task});
    sent.push(body);
    return Response.json({reply:'Hãy phân biệt điều nhìn thấy với kết luận.',action:body.action,item_id:'q0',task:body.task,
      ...(body.action==='feedback'?{answer_index:questions[0].answer_index,correct:false}:{})});
  };
  b.c.showLessonDetail({id:'practice',title:'Bài tập',drills:questions},'N3','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const help=b.document.querySelector('.practice-coach');
  await help.querySelector('button').click();assert.equal(events.length,0,'collapsed help cannot start a request');
  await help.querySelector('summary').click();assert.equal(help.open,true);
  await help.querySelector('button').click();
  assert.equal(sent[0].action,'hint');assert.equal(sent[0].item_id,'q0');assert.equal(sent[0].question_index,0);
  assert.equal(Object.hasOwn(sent[0],'answer_index'),false);
  assert.deepEqual(events.map(entry=>[entry.path,entry.body.event || entry.body.action]),
    [['/api/progress/record','assist'],['/api/practice/coach','hint']]);
  assert.equal(events[0].body.help,'hint');assert.deepEqual(events[0].body.task,sent[0].task);
  assert.match(sent[0].task.revision,/^[a-f0-9]{64}$/);
  await b.document.querySelectorAll('.practice-options input')[1].dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();
  const feedbackHelp=b.document.querySelector('.practice-coach');
  await feedbackHelp.querySelector('summary').click();await feedbackHelp.querySelector('button').click();
  assert.equal(sent[1].answer_index,1);assert.equal(sent[1].action,'feedback');
  assert.deepEqual(events.map(entry=>entry.body.event || entry.body.action),['assist','hint','answer','assist','feedback']);
  assert.equal(events[2].body.answer_index,1);assert.equal(events[2].body.attempt_id,events[0].body.attempt_id);
  assert.equal(events[3].body.help,'chat');assert.deepEqual(sent[1].task,sent[0].task);
  assert.equal(b.document.querySelector('.practice-feedback').hidden,true);
  assert.equal(b.document.querySelector('.practice-feedback').dataset.correct,'false');
  assert.equal(b.document.querySelector('.practice-coach-reply').textContent,'Hãy phân biệt điều nhìn thấy với kết luận.');
});

test('submitting an answer cancels its old hint and rejects a late response without blocking continuation',async()=>{
  const b=lesson(),pending=deferred(),started=deferred();let signal,request;
  b.c.signedInUser={user_id:'learner'};
  b.c.apiFetch=async(path,options)=>{
    const body=JSON.parse(options.body);
    if(path!=='/api/practice/coach')return Response.json({task:body.task});
    signal=options.signal;request=body;started.resolve();return pending.promise;
  };
  b.c.showLessonDetail({id:'practice',title:'Bài tập',drills:[taskFixture()]},'N3','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const help=b.document.querySelector('.practice-coach');await help.querySelector('summary').click();
  const hint=help.querySelector('button').click();
  await Promise.race([started.promise,hint]);assert.ok(request,'the disclosed hint must reach the coach request');
  assert.equal(request.action,'hint');assert.equal(signal.aborted,false);
  await b.document.querySelector('.practice-options input').dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(signal.aborted,true);
  pending.resolve(Response.json({reply:'Old hint must not appear',item_id:'q0',action:'hint',task:request.task}));await hint;
  assert.equal(b.document.querySelector('.practice-coach-reply').textContent,'');
  assert.equal(b.document.querySelector('.practice-session .practice-primary').disabled,false);
});

test('role changes clear pending and completed coaching while unrelated voice changes keep the current hint',async()=>{
  const pending=deferred(),started=deferred(),listeners=new Map();
  const b=lesson({addEventListener:(name,handler)=>listeners.set(name,handler)});let signal,request,held=true;
  b.c.signedInUser={user_id:'learner'};
  b.c.apiFetch=async(path,options)=>{
    const body=JSON.parse(options.body);
    if(path!=='/api/practice/coach')return Response.json({task:body.task});
    signal=options.signal;request=body;started.resolve();
    return held?pending.promise:Response.json({reply:'Gợi ý theo quyền hiện tại.',item_id:'q0',action:'hint',task:body.task});
  };
  b.c.showLessonDetail({id:'practice',title:'Bài tập',drills:[taskFixture()]},'N3','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const help=b.document.querySelector('.practice-coach');await help.querySelector('summary').click();
  const button=help.querySelector('button'),output=help.querySelector('.practice-coach-reply');
  const hint=button.click();
  await Promise.race([started.promise,hint]);assert.ok(request,'the disclosed hint must reach the coach request');
  assert.equal(request.action,'hint');
  listeners.get('vjbot-voice-changed')();
  assert.equal(signal.aborted,false);assert.equal(button.disabled,true);
  b.c.signedInUser.is_admin=true;listeners.get('vjbot-voice-changed')();
  assert.equal(signal.aborted,true);assert.equal(output.hidden,true);
  assert.equal(output.textContent,'');assert.equal(button.disabled,false);
  pending.resolve(Response.json({reply:'Phản hồi quyền cũ.',item_id:'q0',action:'hint',task:request.task}));await hint;
  assert.equal(output.textContent,'');
  held=false;await button.click();assert.equal(output.textContent,'Gợi ý theo quyền hiện tại.');
  b.c.signedInUser.is_admin=false;listeners.get('vjbot-voice-changed')();
  assert.equal(output.hidden,true);assert.equal(output.textContent,'');
  await button.click();assert.equal(output.textContent,'Gợi ý theo quyền hiện tại.');
});

test('practice keeps passage, marked target and duplicate numbered parts without revealing the rationale before an attempt',async()=>{
  const b=lesson(),sent=[],task=taskFixture({q:'提出の読みを選んでください。',target:'提出',
    passage:'明日までに書類を提出してください。',parts:['あれ','あれ','これ','それ'],
    opts:['あれ','あれ','これ','それ'],answer_index:1,explanation:'POST ATTEMPT EXPLANATION'});
  b.c.apiFetch=async(path,options)=>{const body=JSON.parse(options.body);sent.push({path,body});return Response.json({task:body.task});};
  b.c.showLessonDetail({id:'practice',title:'読み方',drills:[task]},'N3','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session');
  assert.equal(b.element('lesson-reference').hidden,true);
  assert.equal(section.querySelector('.task-stimulus').textContent,task.passage);
  assert.equal(section.querySelector('mark').textContent,'提出');
  assert.deepEqual(section.querySelectorAll('.task-parts li').map(element=>element.textContent),task.parts);
  assert.deepEqual(section.querySelectorAll('.practice-option-number').map(element=>element.textContent),['1','2','3','4']);
  assert.equal(section.querySelectorAll('.practice-options input').length,4);
  assert.doesNotMatch(section.textContent,/POST ATTEMPT EXPLANATION/);
  await section.querySelectorAll('.practice-options input')[0].dispatch('change');
  assert.doesNotMatch(section.textContent,/POST ATTEMPT EXPLANATION/);
  await section.querySelector('.practice-primary').click();
  assert.equal(sent[0].body.answer_index,0);assert.equal(sent[0].body.task.id,'practice:question:0');
  assert.equal(section.querySelector('.practice-feedback').dataset.correct,'false');
  assert.equal(section.querySelectorAll('.practice-option')[1].dataset.state,'correct');
  assert.equal(section.querySelector('.practice-feedback').hidden,true);
  assert.equal(section.querySelector('.practice-feedback').textContent,'');
  const markedInput=section.querySelectorAll('.practice-options input')[1],markedLabel=markedInput.getAttribute('aria-label');
  assert.equal(markedInput.value,'1');assert.equal(markedInput.disabled,true);
  assert.equal(markedLabel.split(' · ')[0],'2. あれ');assert.ok(markedLabel.length>'2. あれ'.length);
  assert.notEqual(markedLabel,section.querySelector('.practice-options input').getAttribute('aria-label'));
  assert.equal(task.answer_index,1);assert.deepEqual(task.opts,['あれ','あれ','これ','それ']);
});

test('quarantined source slots stay unavailable without dropping later task positions or permitting completion',async()=>{
  const b=lesson(),sent=[];
  b.c.apiFetch=async(path,options)=>{const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task});};
  const blocked=taskFixture({q:'子どもの ★',source_identity:'N3:1:3',item_id:'blocked'});
  const available=taskFixture({q:'次の問題',item_id:'next',task_id:'practice:question:1',source_position:1});
  b.c.showLessonDetail({id:'practice',title:'原文の位置',drills:[blocked,available]},'N3','reading');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  assert.equal(b.c.teacherContext().focus.index,0);
  assert.equal(b.c.teacherContext().task.review_status,'quarantined');
  assert.equal(b.c.teacherContext().task.capabilities.answer,false);
  assert.equal(b.document.querySelectorAll('.practice-options input').length,0);
  assert.equal(b.document.querySelector('.practice-coach'),null);
  assert.equal(sent.length,0);
  await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(b.c.teacherContext().focus.index,1);
  assert.equal(b.c.teacherContext().task.task_id,'practice:question:1');
  await b.document.querySelector('.practice-options input').dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(sent.length,1);assert.equal(sent[0].question_index,1);assert.equal(sent[0].item_id,undefined);
  await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(b.element('lesson-completion').hidden,true);
});

test('recall accepts typed text and persists it against the normalized task instead of a fabricated choice index',async()=>{
  const b=lesson(),sent=[],task=taskFixture({mode:'recall',q:'先生の読みを書いてください。',opts:[],answer_index:null,
    accepted_answers:['せんせい'],explanation:'SOURCE RECALL RATIONALE'});
  b.c.apiFetch=async(path,options)=>{const body=JSON.parse(options.body);sent.push({path,body});return Response.json({task:body.task});};
  b.c.showLessonDetail({id:'practice',title:'読みを思い出す',drills:[task]},'N3','vocabulary');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const input=b.document.querySelector('.practice-options input'),action=b.document.querySelector('.practice-session .practice-primary');
  assert.equal(input.type,'text');assert.equal(action.disabled,true);
  assert.doesNotMatch(b.document.querySelector('.practice-session').textContent,/せんせい|SOURCE RECALL RATIONALE/);
  input.value=' せんせい ';await input.dispatch('input');await action.click();
  assert.equal(sent[0].body.response_text,' せんせい ');assert.equal(sent[0].body.event,'answer');
  assert.equal(sent[0].body.task.id,'practice:question:0');assert.equal(sent[0].body.question_index,0);
  assert.equal(Object.hasOwn(sent[0].body,'answer_index'),false);
  assert.equal(b.document.querySelector('.practice-feedback').dataset.correct,'true');
  assert.match(b.document.querySelector('.practice-feedback').textContent,/SOURCE RECALL RATIONALE/);
});

test('standalone writing saves raw text without a fabricated self-rating or objective correctness',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{
    if(path==='/api/progress')return Response.json({evidence:[]});
    const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task,basis:'self_report',source_correct:null});
  }});
  b.c.showLessonDetail({id:'writing',title:'書く',production:{prompt:'自己紹介を書いてください。',criteria:['名前を書く'],model:'SOURCE MODEL'}},'N3','production');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.production-task'),input=section.querySelector('textarea');
  assert.equal(section.querySelector('.production-model').hidden,true);
  assert.equal(section.querySelector('.task-writing-criteria').hidden,false);
  input.value='  私はランです。  ';
  await section.querySelector('.production-save').click();
  assert.equal(sent[0].response_text,'  私はランです。  ');assert.equal(Object.hasOwn(sent[0],'self_rating'),false);
  assert.equal(sent[0].task.id,'writing:question:0');assert.equal(sent[0].event,'answer');
  for(const key of ['correct','quality','answer_index'])assert.equal(Object.hasOwn(sent[0],key),false);
});

function questionQuick(apiFetch){
  const b=quick(apiFetch),panel=b.add('panel-quiz');panel.className='tab-panel active';
  const workspace=b.add('practice-workspace','div',panel);b.add('quiz-card','div',workspace);
  b.c.location.hash='#quiz/N3/practice/0';
  const item={id:'exam',examIndex:0,drills:[taskFixture(),taskFixture({q:'第二?',item_id:'q1',source_position:1})]};
  b.c.findFeatureLesson=()=>item;b.c.featureLessons=()=>[item];
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),b.c);b.c.markTeacherScreen();b.c.setTeacherFocus({kind:'question',index:0});
  return b;
}

test('quick question ownership is checked again after the actual asynchronous WebCrypto revision resolves',async()=>{
  const hashing=deferred(),release=deferred(),sent=[];
  const b=questionQuick(async(path,options)=>{const body=JSON.parse(options.body);sent.push({path,body});return Response.json({task:body.task,reply:'STALE'});});
  b.c.crypto={randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:async(...args)=>{
    hashing.resolve();await release.promise;return webcrypto.subtle.digest(...args);
  }}};
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Question A?';
  const sending=b.element('btn-popover-send').click();await hashing.promise;
  assert.equal(b.element('btn-popover-send').disabled,true);
  b.c.setTeacherFocus({kind:'question',index:1});release.resolve();await sending;
  assert.equal(sent.some(entry=>entry.path==='/api/chat'),false);
  assert.doesNotMatch(b.element('popover-speech-text').textContent,/STALE/);
  assert.equal(b.element('btn-popover-send').disabled,false);assert.equal(b.element('btn-popover-retry').hidden,true);
});

test('quick help does not call the model when assistance persistence fails and rejects a mismatched response revision',async()=>{
  for(const failure of ['assist','revision']){
    const sent=[],b=questionQuick(async(path,options)=>{
      const body=JSON.parse(options.body);sent.push({path,body});
      if(path==='/api/progress/record')return failure==='assist'
        ?Response.json({detail:'Assistance was not saved'},{status:503}):Response.json({task:body.task});
      return Response.json({reply:'WRONG REVISION ANSWER',task:{...body.task,revision:'0'.repeat(64)}});
    });
    await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Hint?';await b.element('btn-popover-send').click();
    assert.deepEqual(sent.map(entry=>entry.path),failure==='assist'?['/api/progress/record']:['/api/progress/record','/api/chat']);
    assert.doesNotMatch(b.element('popover-speech-text').textContent,/WRONG REVISION ANSWER/);
    assert.equal(b.element('btn-popover-retry').hidden,false);
    assert.equal(b.element('btn-popover-tts').disabled,true);
  }
});

test('full quiz keeps a quarantined slot visible but offers no answer buttons or score for it',()=>{
  const b=quiz(),sent=[];
  b.item.drills[8]=taskFixture({q:'子どもの ★',source_identity:'N3:1:3',item_id:'blocked-eight',source_position:8});
  b.c.currentExamQuestions=b.c.lessonQuestions(b.item,'N3','reading');
  b.c.apiFetch=async(path,options)=>{sent.push({path,body:JSON.parse(options.body)});return Response.json({});};
  b.c.displayQuizQuestion();
  assert.equal(b.c.teacherContext().task.task_id,'test:N3:full:question:8');
  assert.equal(b.c.teacherContext().task.review_status,'quarantined');
  assert.equal(b.element('quiz-q-num').textContent,'Câu 9 / 20');
  assert.equal(b.element('quiz-options-grid').children.length,0);
  assert.equal(b.element('quiz-feedback-box').hidden,false);
  assert.equal(b.element('btn-quiz-next').disabled,false);
  b.c.handleQuizAnswer(0);
  assert.equal(sent.length,0);assert.equal(b.c.examAnswers.size,0);
  b.c.finishExam();
  assert.match(b.element('quiz-completion').textContent,/Chưa xác nhận làm trọn bộ/);
});

test('listening practice retains task-bound playback while concealing the source transcript',async()=>{
  const b=lesson(),spoken=[],task=taskFixture({script_jp:'PRIVATE_AUDIO_TRANSCRIPT',q:'何を買いますか。'});
  b.c.playGeminiTTS=(text,options)=>spoken.push({text,options});
  b.c.showLessonDetail({id:'listening-task',title:'聞く',drills:[task]},'N3','listening');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session');
  assert.doesNotMatch(section.textContent,/PRIVATE_AUDIO_TRANSCRIPT/);
  await section.querySelector('.task-listen').click();
  assert.equal(spoken[0].text,'PRIVATE_AUDIO_TRANSCRIPT');
  assert.equal(spoken[0].options.task.task_id,'listening-task:question:0');
  assert.equal(spoken[0].options.focus.index,0);
});

test('dictation freezes the pre-reveal snapshot during persistence and restores editability on failure',async()=>{
  const started=deferred(),pending=deferred(),b=lesson({apiFetch:async(path,options)=>{
    if(path!=='/api/progress/record')return Response.json({});
    started.resolve(JSON.parse(options.body));return pending.promise;
  }});
  b.c.showLessonDetail({id:'dictation-race',dictation:true,title:'聞く',examples:[{jp:'聞きました。',vi:'Đã nghe.'}]},'N3','listening');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const row=b.document.querySelector('.lesson-exercise'),input=row.children[1],reveal=row.children[2];
  input.value='聞いた';const revealing=reveal.click(),body=await started.promise;
  assert.equal(input.readOnly,true);assert.equal(body.response_text,'聞いた');assert.equal(row.children[3].hidden,true);
  pending.resolve(Response.json({detail:'Save failed'},{status:503}));await revealing;
  assert.equal(input.readOnly,false);assert.equal(row.children[3].hidden,true);assert.equal(reveal.disabled,false);
});

test('post-answer coaching is unavailable until the actual answer receipt succeeds',async()=>{
  const started=deferred(),pending=deferred(),b=lesson({apiFetch:async(path,options)=>{
    if(path!=='/api/progress/record')return Response.json({});
    const body=JSON.parse(options.body);started.resolve(body);return pending.promise;
  }});
  b.c.showLessonDetail({id:'save-before-feedback',title:'試す',drills:[taskFixture()]},'N3','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  await b.document.querySelector('.practice-options input').dispatch('change');
  const saving=b.document.querySelector('.practice-session .practice-primary').click();await started.promise;
  assert.equal(b.document.querySelector('.practice-coach'),null);
  pending.resolve(Response.json({status:'recorded'}));await saving;
  assert.ok(b.document.querySelector('.practice-coach'));
});

test('task prompts identify actual lexical targets rather than source category labels or blank placeholders',()=>{
  const b=lesson();
  for(const target of ['質問','____'])assert.doesNotMatch(b.c.taskPromptHtml(taskFixture({q:'筆者の考えは何ですか。',target})),/Từ cần xét|<mark>/);
  const marked=b.c.taskPromptHtml(taskFixture({q:'書類を提出する。',target:'提出'}));
  assert.match(marked,/<mark>提出<\/mark>/);assert.doesNotMatch(marked,/Từ cần xét|task-target/);
});

test('open invitation and authored alternative continuations preserve actual learner content and one session without a string key',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{
    const body=JSON.parse(options.body);sent.push({path,body});
    return Response.json({task:body.task,basis:'self_report',source_correct:null,assessment:{comparison:'unassessed',objective:'communication'}});
  }});
  const tasks=[
    {task_key:'invite',mode:'writing',q:'Tự chọn việc muốn làm và mời bạn.',criteria:['Hoạt động do em tự chọn.'],objective:'communication',exchange:{group:'cycle',stage:'invite',prior_task_ids:[]}},
    {task_key:'accept',mode:'writing',q:'Bạn đồng ý. Hãy xác nhận một chi tiết.',criteria:['Phản hồi đúng lời nhận.'],objective:'communication',exchange:{group:'cycle',stage:'accept',prior_task_ids:['invite'],partner_reply:'いいですね。何時にしますか。'}},
    {task_key:'refuse',mode:'writing',q:'Nhánh giả định khác: bạn từ chối. Hãy đáp lại.',criteria:['Không ép người từ chối.'],objective:'communication',exchange:{group:'cycle',stage:'refuse',prior_task_ids:['invite'],partner_reply:'すみません。今日はちょっと。'}}
  ];
  b.c.showLessonDetail({id:'cycle',title:'Mời',drills:tasks,practice_path:['invite','accept','refuse']},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  for(const [index,text] of [' 土曜日、いっしょに料理をしませんか ','午後二時はどうですか。','わかりました。また今度。'].entries()){
    const section=b.document.querySelector('.practice-session'),input=section.querySelector('textarea');
    if(index>0)assert.match(section.textContent,/土曜日、いっしょに料理をしませんか/);
    assert.doesNotMatch(section.textContent,/Đáp án nguồn:/);
    input.value=text;await input.dispatch('input');await section.querySelector('.practice-primary').click();
    assert.equal(section.querySelector('.practice-feedback').dataset.correct,'unknown');
    await section.querySelector('.practice-primary').click();
  }
  const answers=sent.filter(entry=>entry.body.event==='answer');
  assert.equal(answers.length,3);assert.equal(new Set(answers.map(x=>x.body.session_id)).size,1);
  assert.equal(answers[0].body.response_text,' 土曜日、いっしょに料理をしませんか ');
  assert.deepEqual(answers.map(x=>x.body.task.id),['invite','accept','refuse']);
  assert.ok(answers.every(x=>!Object.hasOwn(x.body,'correct')&&!Object.hasOwn(x.body,'prior_response')&&!Object.hasOwn(x.body,'self_rating')));
  assert.equal(b.document.querySelector('.practice-result .practice-score'),null,'ungraded writing must not produce a keyed score');
});

test('cosmetic source differences stay neutral and preserve raw text without claiming a grammar error',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{
    const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task,assessment:{comparison:'orthographic_difference',objective:'structure'}});
  }});
  b.c.showLessonDetail({id:'cosmetic',title:'Cấu trúc',drills:[{q:'Viết câu giới thiệu.',mode:'recall',objective:'structure',accepted_answers:['私は学生です。']}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const input=b.document.querySelector('.practice-options input');input.value=' 私は学生です ';await input.dispatch('input');
  await b.document.querySelector('.practice-session .practice-primary').click();
  assert.equal(sent[0].response_text,' 私は学生です ');
  const feedback=b.document.querySelector('.practice-feedback');
  assert.equal(feedback.dataset.correct,'unknown');
  assert.doesNotMatch(feedback.textContent,/sai ngữ pháp|hiểu sai nghĩa\./);
});

test('te-form stages wait for an actual saved attempt before expansion while full reference starts collapsed',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task});}});
  const drills=[{task_key:'first',q:'Tạo dạng của 食べる.',mode:'recall',accepted_answers:['食べて'],explanation:'Nhóm 2 bỏ る rồi thêm て.'},
    {task_key:'second',q:'Tạo dạng của 飲む.',mode:'recall',accepted_answers:['飲んで']}];
  const item={id:'staged',title:'Thể て',formula:'FULL TABLE',explanation:'FULL FUNCTION NOTES',drills,
    guided_steps:[{title:'Nhóm 2',note:'Xem một ví dụ rồi thử.',example:{jp:'見て',reading:'みて',vi:'dạng て của 見る'},task_ids:['first']},
      {title:'Nhóm 1',note:'Bước sau.',example:{jp:'読んで',reading:'よんで',vi:'dạng て của 読む'},task_ids:['second']}]};
  b.c.showLessonDetail(item,'N5','grammar');
  assert.ok(b.document.querySelector('.lesson-full-reference'));assert.equal(b.document.querySelector('.lesson-full-reference').open,undefined);
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  assert.equal(b.document.querySelector('.task-stage h3').textContent,'Nhóm 2');
  const action=b.document.querySelector('.practice-session .practice-primary');assert.equal(action.disabled,true);
  const input=b.document.querySelector('.practice-options input');input.value='食べるて';await input.dispatch('input');await action.click();
  assert.match(b.document.querySelector('.practice-feedback').textContent,/bỏ る rồi thêm て/);
  assert.equal(sent.length,1);assert.equal(sent[0].response_text,'食べるて');
  await action.click();assert.equal(b.document.querySelector('.practice-session .task-stage h3').textContent,'Nhóm 1');
});

test('saved open writing automatically requests feedback bound to its actual attempt rather than choice aliases',async()=>{
  const sent=[],started=deferred(),feedback=deferred(),b=lesson({signedInUser:{user_id:'learner'},apiFetch:async(path,options)=>{
    const body=JSON.parse(options.body);sent.push({path,body});
    if(path==='/api/practice/coach'){started.resolve(body);return feedback.promise;}
    return Response.json({task:body.task,source_correct:null,assessment:{comparison:'unassessed'}});
  }});
  b.c.showLessonDetail({id:'open',title:'Mời',drills:[{task_key:'open',item_id:'open',mode:'writing',objective:'communication',q:'Tự mời bạn.',criteria:['Một hoạt động do em chọn.']}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  assert.equal(b.document.querySelector('.task-writing-criteria').hidden,false);
  const input=b.document.querySelector('.practice-options textarea');input.value='一緒に料理をしませんか';await input.dispatch('input');
  await b.document.querySelector('.practice-session .practice-primary').click();
  const coaching=await started.promise,answer=sent.find(x=>x.body.event==='answer').body;
  assert.equal(sent.filter(x=>x.path==='/api/practice/coach').length,1);
  assert.equal(b.document.querySelector('.practice-coach').open,true);
  feedback.resolve(Response.json({reply:'Ý nghĩa: em đã mời bạn nấu ăn. Cấu trúc: lời mời lịch sự. Chính tả: không có điều cần sửa.',task:coaching.task,item_id:'open',action:'feedback',source_correct:null,assessment:{comparison:'unassessed'}}));
  await new Promise(setImmediate);
  assert.match(b.document.querySelector('.practice-coach-reply').textContent,/nấu ăn/);
  assert.equal(coaching.response_text,answer.response_text);assert.equal(coaching.attempt_id,answer.attempt_id);assert.equal(coaching.session_id,answer.session_id);
  assert.equal(b.document.querySelector('.practice-feedback').dataset.correct,'unknown');
});

test('switching accounts invalidates the whole mounted exchange before a new account can see prior learner content',async()=>{
  const listeners=new Map(),sent=[],b=lesson({signedInUser:{user_id:'A'},addEventListener:(event,handler)=>{
    if(!listeners.has(event))listeners.set(event,[]);listeners.get(event).push(handler);
  },apiFetch:async(path,options)=>{const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task});}});
  b.c.showLessonDetail({id:'owned',title:'Mời',drills:[
    {task_key:'invite',mode:'writing',q:'Tự mời.',objective:'communication'},
    {task_key:'accept',mode:'writing',q:'Tiếp lời.',objective:'communication',exchange:{group:'cycle',stage:'accept',prior_task_ids:['invite']}}
  ]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const input=b.document.querySelector('textarea');input.value='PRIVATE ACCOUNT A INVITATION';await input.dispatch('input');await b.document.querySelector('.practice-session .practice-primary').click();
  b.c.signedInUser={user_id:'B'};
  for(const handler of listeners.get('vjbot-account-ready')||[])handler({});
  assert.doesNotMatch(b.document.querySelector('.practice-session').textContent,/PRIVATE ACCOUNT A/);
  const section=b.document.querySelector('.practice-session');
  assert.equal(section.children.length,1);assert.equal(section.children[0].getAttribute('role'),'status');
  assert.notEqual(section.children[0].textContent.trim(),'');
  assert.equal(section.querySelector('.practice-primary'),null);
  assert.equal(b.document.querySelector('.practice-session textarea'),null);assert.equal(sent.length,1);
});

test('restart restores keyboard focus to the new run and gives it a fresh session',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task});}});
  b.c.showLessonDetail({id:'restart',title:'Ôn',drills:[{q:'Q',opts:['A','B'],answer_index:0}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();await b.document.querySelector('.practice-options input').dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();await b.document.querySelector('.practice-session .practice-primary').click();
  await b.document.querySelector('.practice-result-actions button').click();
  assert.equal(b.document.querySelector('.practice-session legend').focused,true);
  await b.document.querySelector('.practice-options input').dispatch('change');await b.document.querySelector('.practice-session .practice-primary').click();
  assert.notEqual(sent[0].session_id,sent[1].session_id);
});

test('generic production continuation reuses actual raw learner text without presenting it as an invitation or model answer',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{
    const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task,assessment:{comparison:'unassessed'},source_correct:null});
  }});
  b.c.showLessonDetail({id:'generic-cycle',title:'Bàn giao',practice_path:['produce','revise'],drills:[
    {task_key:'produce',mode:'writing',q:'Tự chọn việc bàn giao và hạn.',criteria:['Giữ hạn do em chọn.'],exchange:{group:'handover',stage:'produce',prior_task_ids:[]}},
    {task_key:'revise',mode:'writing',q:'Kiểm tra hạn trong chính câu đã viết; giữ hoặc sửa có lý do.',criteria:['Dựa trên câu thật.'],exchange:{group:'handover',stage:'revise',prior_task_ids:['produce']}}
  ]},'N3','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const raw='  水曜日までに資料を送ります。  ',input=b.document.querySelector('textarea');
  input.value=raw;await input.dispatch('input');await b.document.querySelector('.practice-session .practice-primary').click();
  await b.document.querySelector('.practice-session .practice-primary').click();
  const section=b.document.querySelector('.practice-session');
  assert.doesNotMatch(section.textContent,/Lời mời|Đáp án nguồn/);
  assert.ok(section.textContent.includes(raw));assert.equal(section.querySelector('textarea').value,'');
  assert.equal(sent[0].response_text,raw);
});

test('an incomplete policy production model is withheld without blocking the real written attempt',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{
    if(path==='/api/progress')return Response.json({evidence:[]});
    const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task});
  }});
  b.c.showLessonDetail({id:'practical:v1:N2:policy:production',title:'Thông báo',production:{
    prompt:'Tóm tắt chính xác ngày hiệu lực và ngoại lệ.',criteria:['Giữ đúng ngày.'],model:'来月から始まります。'
  }},'N2','production');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.production-task');
  assert.equal(section.querySelector('.production-reveal').hidden,true);
  assert.doesNotMatch(section.querySelector('.production-model').textContent,/来月から始まります/);
  assert.match(section.textContent,/来月一日から/);
  section.querySelector('textarea').value='  来月一日から始まります。  ';
  await section.querySelector('.production-save').click();
  assert.equal(sent[0].response_text,'  来月一日から始まります。  ');
  assert.equal(sent[0].event,'answer');assert.equal(Object.hasOwn(sent[0],'correct'),false);
});

test('writing self-check criteria stay concealed until the actual answer is saved, including failed-save retries',async()=>{
  let accept=false;const b=lesson({apiFetch:async(path,options)=>{
    const body=JSON.parse(options.body);return accept?Response.json({task:body.task}):Response.json({detail:'Save failed'},{status:503});
  }});
  b.c.showLessonDetail({id:'heldout-criteria',title:'Gợi nhớ',reviewQuestionIndex:0,delayedReview:true,drills:[
    {task_key:'heldout',mode:'writing',q:'Tự nhớ cách diễn đạt phù hợp.',criteria:['POST_ANSWER_TARGET_FORM'],
      exchange:{group:'closed-cycle',stage:'delayed',prior_task_ids:['earlier'],delay_hours:24}}
  ]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session'),criteria=section.querySelector('.task-writing-criteria'),input=section.querySelector('textarea');
  assert.equal(criteria.hidden,true);input.value='自分の答え。';await input.dispatch('input');
  await section.querySelector('.practice-primary').click();assert.equal(criteria.hidden,true,'failure is not permission to show a target form');
  accept=true;await section.querySelector('.practice-primary').click();assert.equal(criteria.hidden,false);
});

test('grammar formulas show complete compact alternatives without changing optional groups or inventing ambiguous suffixes',()=>{
  const b=lesson(),rows=()=>b.document.querySelectorAll('.grammar-row').map(row=>{
    const parts=row.querySelectorAll('.grammar-part').map(part=>part.textContent);
    const shared=row.closest('.grammar-group')?.querySelector('.grammar-shared .grammar-part');
    if(shared)parts.push(shared.textContent);
    return parts.join(' + ');
  });
  for(const [formula,expected]of [
    ['Động từ thân ます / Tính từ い thân từ / Tính từ な + そうだ',['Động từ thể ます (bỏ ます) + そうだ','Tính từ い (bỏ い) + そうだ','Tính từ な + そうだ']],
    ['Động từ / Tính từ い + そうだ / Tính từ な + だ + そうだ / Danh từ + だ + そうだ',['Động từ + そうだ','Tính từ い + そうだ','Tính từ な + だ + そうだ','Danh từ + だ + そうだ']],
    ['Động từ thể た + ら / Tính từ い thân từ + かったら / Tính từ な + だったら / Danh từ + だったら',['Động từ thể た + ら','Tính từ い (bỏ い) + かったら','Tính từ な + だったら','Danh từ + だったら']],
    ['Danh từ + に + 行く / 来る / 帰る',['Danh từ + に + 行く','Danh từ + に + 来る','Danh từ + に + 帰る']],
    ['Danh từ + です / Tính từ な + です',['Danh từ + です','Tính từ な + です']],
    ['Danh từ (+ の) + いかんで',['Danh từ (+ の) + いかんで']],
    ['Danh từ + です | この + danh từ',['Danh từ + です','この + danh từ']],
    ['Động từ thể từ điển / Danh từ + の + ために',['Động từ thể từ điển / Danh từ + の + ために']],
    ['Động từ / Tính từ な + な / Danh từ + の + とき',['Động từ / Tính từ な + な / Danh từ + の + とき']],
    ['Danh từ + にあって(は / も)',['Danh từ + にあって(は / も)']]
  ]){
    b.c.showLessonDetail({id:'notation',title:'Cách ghép câu',formula},'N4','grammar');
    const raw=b.document.querySelector('.lesson-formula code');
    assert.equal(raw.hidden,true);assert.equal(raw.textContent,formula);
    assert.deepEqual(rows(),expected);
    assert.equal(b.document.querySelector('.grammar-or'),null);
  }
  b.c.showLessonDetail({id:'shared',title:'そうだ',formula:'Động từ thân ます / Tính từ い thân từ / Tính từ な + そうだ'},'N4','grammar');
  assert.equal(b.document.querySelectorAll('.grammar-alternatives .grammar-row').length,3);
  assert.equal(b.document.querySelectorAll('.grammar-plus').length,1);
  assert.equal(b.document.querySelector('.grammar-shared .grammar-part').textContent,'そうだ');
  assert.doesNotMatch(b.document.querySelector('.grammar-layout').textContent,/thân/);
  assert.ok(b.document.querySelector('.lesson-formula').children.every(child=>child.tagName!=='SPAN'));
  b.c.showLessonDetail({id:'policy',title:'Thông báo',formula:'Nに伴い、…。ただし、Nに限り、Vば、…。Vことはできない。'},'N2','grammar');
  assert.deepEqual(b.document.querySelectorAll('.grammar-symbol').map(node=>node.textContent),['N','N','V','V']);
  b.c.showLessonDetail({id:'escaped',title:'Literal notation',formula:'<img src=x onerror=attack()> + です'},'N4','grammar');
  assert.equal(b.document.querySelector('.grammar-layout img'),null);
  assert.match(b.document.querySelector('.grammar-layout').textContent,/<img src=x onerror=attack\(\)>/);
});

test('lesson teaching reformats both AI and original formulas and restores them on account invalidation',async()=>{
  const formula='Động từ + て + ください',translated='Động từ thể て + ください';
  let mutate;
  const b=lesson({signedInUser:{user_id:'first',is_admin:true},addEventListener(){},
    MutationObserver:class{constructor(callback){mutate=callback;}observe(){}},
    apiFetch:async(_path,options)=>{
      const body=JSON.parse(options.body);
      return Response.json({action:'teach',lesson:body.lesson,focus:body.focus,view:body.view,reply:'Dùng để nhờ người khác làm một việc.',
        fields:[{key:'formula',source:formula,text:translated}]});
    }});
  b.c.window=b.c;
  vm.runInContext(readFileSync('static/study-teacher.js','utf8'),b.c);
  b.c.showLessonDetail({id:'formula-lesson',title:'Nhờ giúp đỡ',formula},'N5','grammar');
  const raw=b.document.querySelector('.lesson-formula code'),layout=b.document.querySelector('.grammar-layout');
  const panel=b.document.querySelector('#lesson-reference .study-teacher');
  await panel.querySelector('.study-teacher-button').click();
  assert.equal(raw.textContent,translated);assert.equal(layout.querySelectorAll('.grammar-plus').length,1);
  const compare=panel.querySelectorAll('.study-teacher-button')[1];
  await compare.click();assert.equal(raw.textContent,formula);assert.equal(layout.querySelectorAll('.grammar-plus').length,2);
  await compare.click();assert.equal(raw.textContent,translated);assert.equal(layout.querySelectorAll('.grammar-plus').length,1);
  b.c.signedInUser={user_id:'second',is_admin:true};mutate();
  assert.equal(raw.textContent,formula);assert.equal(layout.querySelectorAll('.grammar-plus').length,2);
  assert.equal(panel.querySelector('.study-teacher-reply').hidden,true);
});

test('AI presentation cannot expose answer feedback before a successful save receipt',async()=>{
  let teaching;
  const b=lesson({mountStudyTeacher:(_section,options)=>{teaching=options;},
    studyTarget:(key,element,source)=>({key,element,source}),apiFetch:async()=>Response.json({detail:'Save unavailable'},{status:503})});
  b.c.showLessonDetail({id:'save-first',title:'Luyện tập',drills:[{q:'選んでください。',opts:['A','B'],answer_index:1,explanation:'PRIVATE UNTIL SAVE'}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session');
  await section.querySelector('.practice-options input').dispatch('change');
  await section.querySelector('.practice-primary').click();
  teaching.onApply();
  assert.equal(section.querySelector('.practice-reason'),null);
  assert.doesNotMatch(section.querySelector('.practice-feedback').textContent,/PRIVATE UNTIL SAVE/);
});

test('choice save failures remain visible and retry hides only the duplicate result, not option marks or AI coaching',async()=>{
  let available=false;
  const sent=[],b=lesson({apiFetch:async(_path,options)=>{
    const body=JSON.parse(options.body);sent.push(body);
    return available?Response.json({task:body.task}):Response.json({detail:'Save unavailable'},{status:503});
  }});
  b.c.showLessonDetail({id:'choice-retry',title:'Luyện tập',drills:[{q:'選んでください。',opts:['A','B'],answer_index:1}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session'),feedback=section.querySelector('.practice-feedback');
  await section.querySelector('.practice-options input').dispatch('change');
  await section.querySelector('.practice-primary').click();
  assert.equal(feedback.hidden,false);assert.match(feedback.textContent,/Save unavailable/);
  assert.equal(section.querySelector('.practice-coach'),null);
  available=true;await section.querySelector('.practice-primary').click();
  assert.equal(feedback.hidden,true);assert.equal(feedback.textContent,'');
  assert.equal(section.querySelectorAll('.practice-option')[0].dataset.state,'incorrect');
  assert.equal(section.querySelectorAll('.practice-option')[1].dataset.state,'correct');
  assert.ok(section.querySelector('.practice-coach'));
  assert.equal(sent.length,2);assert.equal(sent[0].attempt_id,sent[1].attempt_id);
});

test('exam previews show one target cue and one numbered part list without changing source instructions or answer positions',()=>{
  const b=lesson(),instruction='Sắp xếp: [1: うちに, 2: ふらない, 3: はやく, 4: たくさん]';
  const parts=['1. うちに','2. ふらない','3. はやく','4. たくさん'];
  const tasks=[{q:'この計画はとてもすばらしいです。',target:'計画',instruction:'Chọn cách đọc đúng:',opts:['けいがく','けいかく'],answer_index:1},
    {q:'あめが ____ ____ __★__ ____ かえりましょう。',target:'★',instruction,parts,opts:['ふらない','うちに','はやく','たくさん'],answer_index:1}];
  b.c.showLessonDetail({id:'preview',title:'Bộ luyện',examIndex:0,drills:tasks},'N4','reading');
  assert.equal(b.document.querySelectorAll('.task-number').length,2);
  assert.equal(b.document.querySelectorAll('.task-target').length,0);
  assert.equal(b.document.querySelector('mark').textContent,'計画');
  assert.equal(b.document.querySelector('.task-accessible-target').textContent,'Từ được gạch chân: 計画.');
  assert.equal(b.document.querySelector('.task-preview-options').getAttribute('role'),'list');
  assert.equal(b.document.querySelector('.task-choice-number').getAttribute('aria-hidden'),null);
  assert.equal(b.document.querySelectorAll('.task-parts li').length,4);
  assert.deepEqual(b.document.querySelectorAll('.task-parts li').map(x=>x.textContent),parts);
  assert.equal(b.document.querySelectorAll('.task-instruction')[1].textContent,'Sắp xếp');
  assert.equal(tasks[1].instruction,instruction);assert.equal(tasks[1].answer_index,1);
  assert.deepEqual(b.document.querySelectorAll('.task-preview-options')[1].querySelectorAll('li').map(x=>x.children[1].textContent),tasks[1].opts);
});

test('one optional practice help area preserves hints, presentation restoration and saved-answer feedback',async()=>{
  const sent=[],b=lesson({signedInUser:{user_id:'learner',is_admin:true}});
  b.c.window=b.c;b.c.addEventListener=()=>{};b.c.MutationObserver=class{observe(){}};
  vm.runInContext(readFileSync('static/study-teacher.js','utf8'),b.c);
  b.c.apiFetch=async(path,options)=>{
    const body=JSON.parse(options.body);sent.push({path,body});
    if(path==='/api/progress/record')return Response.json({task:body.task});
    if(body.action==='teach')return Response.json({...body,reply:'Đọc từng lựa chọn.',fields:[
      {key:'question:option:0',source:'FIRST',text:'Một'},{key:'question:option:1',source:'SECOND',text:'Hai'}]});
    return Response.json({action:body.action,item_id:'combined-q',task:body.task,reply:body.action==='hint'?'Một gợi ý.':'Xem lại cách chọn.',
      ...(body.action==='feedback'?{answer_index:1,correct:false}:{})});
  };
  b.c.showLessonDetail({id:'combined-help',title:'Luyện',drills:[{q:'選んでください。',opts:['FIRST','SECOND'],answer_index:1,item_id:'combined-q'}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  let area=b.document.querySelector('.practice-coach');
  assert.equal(area.tagName,'DETAILS');assert.equal(Boolean(area.open),false);
  assert.equal(b.document.querySelectorAll('.practice-session .practice-coach').length,1);
  area.open=true;await area.querySelector('button').click();
  assert.equal(area.querySelector('.practice-coach-reply').textContent,'Một gợi ý.');
  const teaching=area.querySelector('.practice-teaching');teaching.open=true;
  await teaching.querySelector('.study-teacher-button').click();
  assert.equal(b.document.querySelectorAll('.practice-option')[0].textContent,'1Một');
  await b.document.querySelector('.practice-options input').dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();
  assert.deepEqual(b.document.querySelectorAll('.practice-option').map(x=>x.children[2].textContent),['FIRST','SECOND']);
  assert.equal(b.document.querySelector('.practice-feedback').hidden,true);
  area=b.document.querySelector('.practice-coach');area.open=true;await area.querySelector('button').click();
  assert.equal(area.querySelector('.practice-coach-reply').textContent,'Xem lại cách chọn.');
  assert.deepEqual(sent.filter(x=>x.path==='/api/practice/coach').map(x=>x.body.action),['hint','teach','feedback']);
  assert.equal(sent.find(x=>x.body.event==='answer').body.answer_index,0);
});

test('recall mismatch remains neutral with one visible sample and all original variants behind a disclosure',async()=>{
  const sent=[],answers=['私は教師です。','わたしは教師です。','私はきょうしです。'],b=lesson({apiFetch:async(_path,options)=>{
    const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task,source_correct:false,assessment:{comparison:'source_mismatch'}});
  }});
  b.c.showLessonDetail({id:'recall-variants',title:'Viết',drills:[{q:'Tự giới thiệu.',mode:'recall',accepted_answers:answers}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const input=b.document.querySelector('.practice-options input');input.value=' 私は先生です。 ';await input.dispatch('input');
  assert.equal(b.document.querySelector('.practice-sample'),null);
  await b.document.querySelector('.practice-session .practice-primary').click();
  const feedback=b.document.querySelector('.practice-feedback'),variants=feedback.querySelector('.practice-variants');
  assert.equal(feedback.dataset.correct,'unknown');assert.equal(feedback.querySelector('.practice-sample').textContent,answers[0]);
  assert.equal(Boolean(variants.open),false);assert.deepEqual(variants.querySelectorAll('li').map(x=>x.textContent),answers.slice(1));
  assert.equal(sent[0].response_text,' 私は先生です。 ');assert.equal(Object.hasOwn(sent[0],'correct'),false);
  assert.deepEqual(answers,['私は教師です。','わたしは教師です。','私はきょうしです。']);
});

function progressFixture(apiFetch){
  const b=lesson({signedInUser:{user_id:'learner'},userId:'learner',apiFetch,showCompletedActivities(){}});
  for(const id of ['mastery-lessons-count','mastery-answers-count','mastery-accuracy-rate','mastery-evidence-summary','mastery-legacy',
    'mastery-streak-val','streak-counter','mastery-exams-count','completed-activities','weak-spots-list'])b.add(id);
  b.c.location.hash='#mastery';b.c.ensureLessons=async()=>{};b.c.loadPracticalCourse=async()=>{};b.c.createStudyPlan=()=>[];b.c.featureLessons=()=>[];
  const items=[{id:'review-a',title:'Bài A',drills:[{q:'A1',item_id:'shared',opts:['A','B'],answer_index:0},{q:'A2',item_id:'second',opts:['C','D'],answer_index:1}]},
    {id:'review-b',title:'Bài B',drills:[{q:'B1',item_id:'shared',opts:['E','F'],answer_index:0}]}];
  b.c.window.JLPT_DATA={curriculum:{N5:{skills:{grammar:items}}}};
  vm.runInContext(app.slice(app.indexOf('async function resolveProgressReview('),app.indexOf('// 14. FLOATING SENSEI DOCK')),b.c);
  return b;
}
test('progress names the exact current question and sends ambiguous history to the library rather than guessing',async()=>{
  const b=progressFixture(async()=>Response.json({total_learned:1,legacy:{accuracy_rate:75},items:[{item_id:'legacy'}],
    evidence:[{item_id:'second',task_id:'review-a:question:1',lesson_id:'review-a',level:'N5',answered_at:'2026-11-14',source_correct:0}],
    weak_items:[{item_id:'shared',jlpt_level:'N5',display:'Bản ghi cũ'}]}));
  await b.c.loadProgress();
  assert.equal(b.element('mastery-answers-count').textContent,'1');assert.equal(b.element('mastery-accuracy-rate').textContent,'75%');
  assert.equal(b.element('mastery-legacy').hidden,false);
  const rows=b.element('weak-spots-list').querySelectorAll('.review-task-card');
  assert.equal(rows[0].querySelector('h4').textContent,'Bài A');assert.match(rows[0].querySelector('p').textContent,/Câu 2: A2/);
  const destinations=[];b.c.switchTab=(tab,route)=>destinations.push({tab,route});
  await rows[1].querySelector('button').click();assert.deepEqual(plain(destinations),[{tab:'curriculum',route:{level:'N5'}}]);assert.equal(b.c.currentLesson,null);
  await rows[0].querySelector('button').click();
  assert.equal(b.c.currentLesson.item.id,'review-a');assert.equal(b.c.currentLesson.item.reviewQuestionIndex,1);
  assert.match(b.document.querySelector('.practice-session').textContent,/A2/);assert.doesNotMatch(b.document.querySelector('.practice-session').textContent,/A1/);
});
test('a previous account progress response cannot overwrite current counts or reveal its review text',async()=>{
  const pending=deferred();let calls=0;
  const b=progressFixture(async()=>++calls===1?pending.promise:Response.json({evidence:[{item_id:'new',answered_at:'2026-11-14'}]}));
  const old=b.c.loadProgress();b.c.signedInUser={user_id:'new-account'};b.c.userId='new-account';await b.c.loadProgress();
  pending.resolve(Response.json({total_learned:99,items:[{item_id:'old'}],weak_items:['PRIVATE OLD REVIEW']}));await old;
  assert.equal(b.element('mastery-answers-count').textContent,'1');assert.equal(b.element('mastery-lessons-count').textContent,'1');
  assert.equal(b.element('mastery-legacy').hidden,true);assert.doesNotMatch(b.element('weak-spots-list').textContent,/PRIVATE OLD REVIEW/);
});
test('progress API failures are visible without fabricated zero scores',async()=>{
  const b=progressFixture(async()=>Response.json({detail:'Unavailable'},{status:503}));
  await b.c.loadProgress();assert.match(b.element('weak-spots-list').textContent,/Chưa tải được tiến độ/);
  assert.equal(b.element('mastery-answers-count').textContent,'—');assert.equal(b.element('mastery-legacy').hidden,true);
});
test('a long lesson outline keeps its current neighborhood visible and every remaining step addressable',async()=>{
  const b=lesson(),steps=Array.from({length:26},(_,i)=>({lesson:{id:`outline-${i}`,title:`Bài ${i+1}`},skill:'grammar'}));
  const host=b.add('lesson-outline','aside');b.c.currentLesson={item:steps[12].lesson,level:'N5',skill:'grammar'};
  b.c.studyPlans.set('N5',[{title:'Chương',steps}]);b.c.studySkillNames={grammar:'Ngữ pháp'};b.c.loadCompletions=async()=>new Set(['outline-11']);
  const opened=[];b.c.openStudyStep=(step,level)=>opened.push({id:step.lesson.id,level});
  vm.runInContext(plan.slice(plan.indexOf('async function renderLessonOutline('),plan.indexOf('let studyPlanRequest=')),b.c);
  await b.c.renderLessonOutline(steps[12].lesson,'N5','grammar');
  assert.equal(host.children[2].querySelectorAll('button').length,5);
  assert.equal(host.querySelector('button[aria-current=step]').textContent,'Bài 13');
  const more=host.querySelector('.lesson-outline-more');assert.equal(Boolean(more.open),false);
  assert.equal(more.querySelectorAll('button').length,21);assert.equal(host.querySelectorAll('button').length,26);
  await more.querySelectorAll('button').at(-1).click();assert.deepEqual(opened,[{id:'outline-25',level:'N5'}]);
});

test('an authored rewrite has an open goal and rubric rather than a forced answer string',()=>{
  const b=lesson(),source=JSON.parse(readFileSync('static/course/n1-teaching.json','utf8')).lessons[0].tasks.find(task=>task.id==='teaching:v1:N1:argument:task:3');
  const task=taskFixture({q:source.prompt,mode:source.mode,opts:[],answer_index:null,criteria:source.criteria,passage:source.passage});
  assert.equal(source.mode,'writing');assert.equal(Object.hasOwn(source,'accepted_variants'),false);
  const host=b.document.createElement('section');host.innerHTML=b.c.taskPromptHtml(task);
  const stem=host.querySelector('.task-instruction-prompt');
  assert.equal(stem.getAttribute('lang'),'vi');assert.equal(stem.querySelectorAll('p').length,2);
  assert.ok(stem.querySelectorAll('p').some(p=>p.textContent==='「手続きは統一されている。しかし、それだけでは、すべての利用者にとって最善だとは断定できない。」'));
  assert.equal(host.querySelector('.task-stimulus').textContent,source.passage);
  for(const text of ['手続きが統一されているからといって、必ずしも全員に最善とはいえない。','手続きを統一したからといって、必ずしも皆にとって最善だとはいえない。']){
    const round=b.c.createPracticeRound([task]),result=round.answer(text);
    assert.equal(result.selected,text);assert.equal(result.correct,null);assert.equal(round.correct,0);
    assert.equal(round.unassessed,1);assert.deepEqual(plain(round.missed),[]);
  }
  assert.equal(task.q,source.prompt);assert.deepEqual(plain(task.accepted_answers),[]);
});
test('instruction paragraphs escape literal markup and mark the lexical target only once',()=>{
  const b=lesson(),q='Em hãy sửa 提出.\n\nGiữ <script>alert(1)</script> như văn bản.\n\nViết 提出 và không bỏ phần <cuối>.';
  const task=taskFixture({q,mode:'writing',target:'提出'}),host=b.document.createElement('section');
  host.innerHTML=b.c.taskPromptHtml(task);
  assert.equal(host.querySelectorAll('.task-stem p').length,3);assert.equal(host.querySelectorAll('mark').length,1);
  assert.equal(host.querySelectorAll('script').length,0);assert.equal(host.querySelectorAll('cuối').length,0);
  assert.match(host.textContent,/<script>alert\(1\)<\/script>/);assert.match(host.textContent,/không bỏ phần <cuối>/);
  assert.equal(task.q,q);
});

test('writing waits for answer persistence, surfaces AI failure once and retries assessment only on request',async()=>{
  const sent=[],firstCoach=deferred();let saved=false,calls=0;
  const b=lesson({apiFetch:async(path,options)=>{
    const body=JSON.parse(options.body);sent.push({path,body});
    if(path==='/api/practice/coach'){
      calls++;firstCoach.resolve();
      return calls===1?Response.json({detail:'Assessment unavailable'},{status:503}):Response.json({
        task:body.task,item_id:'open-retry',action:'feedback',reply:'Ý nghĩa: em đã nói đúng nghề. Cấu trúc: câu lịch sự. Chính tả: không cần sửa.',
        source_correct:null,assessment:{comparison:'unassessed'}});
    }
    return body.event==='answer'&&!saved?Response.json({detail:'Save failed'},{status:503}):Response.json({task:body.task,assessment:{comparison:'unassessed'}});
  }});
  b.c.showLessonDetail({id:'open-retry',title:'Nghề',drills:[{task_key:'open-retry',item_id:'open-retry',mode:'writing',
    q:'Giới thiệu nghề của em.',criteria:['Nói rõ nghề bằng lời lịch sự.']}]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const input=b.document.querySelector('.practice-options textarea'),action=b.document.querySelector('.practice-actions .practice-primary');
  assert.equal(b.document.querySelector('.task-writing-criteria').hidden,false);
  input.value='  教師をしています。  ';await input.dispatch('input');await action.click();
  assert.equal(calls,0);assert.match(b.document.querySelector('.practice-feedback').textContent,/Save failed/);
  saved=true;await action.click();await firstCoach.promise;await new Promise(setImmediate);
  assert.equal(calls,1);assert.match(b.document.querySelector('.practice-coach .study-teacher-status').textContent,/Assessment unavailable/);
  assert.equal(b.document.querySelector('.practice-feedback').dataset.correct,'unknown');assert.equal(action.disabled,false);
  const coach=b.document.querySelector('.practice-coach button');assert.equal(coach.disabled,false);
  await coach.click();assert.equal(calls,2);assert.match(b.document.querySelector('.practice-coach-reply').textContent,/đúng nghề/);
  const requests=sent.filter(entry=>entry.path==='/api/practice/coach').map(entry=>entry.body);
  assert.equal(requests[0].response_text,'  教師をしています。  ');assert.deepEqual(requests[0],requests[1]);
  assert.equal(b.document.querySelector('.practice-feedback').dataset.correct,'unknown');
});

test('first successful recall save reveals the comparison, alternative forms and explanation only after acknowledgment',async()=>{
  const pending=deferred(),started=deferred(),sent=[];
  const b=lesson({apiFetch:async(_path,options)=>{
    const body=JSON.parse(options.body);sent.push(body);started.resolve();return pending.promise;
  }});
  b.c.showLessonDetail({id:'recall-visible',title:'Luyện nhớ',drills:[{
    mode:'recall',q:'Em viết lời chào nhé.',accepted_answers:['こんにちは。','こんにちは'],
    explanation:'Đây là lời chào ban ngày.'
  }]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session'),feedback=section.querySelector('.practice-feedback');
  const input=section.querySelector('.practice-options input'),action=section.querySelector('.practice-primary');
  input.value='こんにちは。';await input.dispatch('input');
  const saving=action.click();await started.promise;
  assert.equal(feedback.hidden,true);assert.equal(section.querySelector('.practice-sample'),null);
  pending.resolve(Response.json({task:sent[0].task,assessment:{comparison:'source_match'}}));await saving;
  assert.equal(feedback.hidden,false);
  assert.equal(feedback.querySelector('.practice-sample').textContent,'こんにちは。');
  assert.match(feedback.querySelector('.practice-variants').textContent,/こんにちは/);
  assert.match(feedback.querySelector('.practice-reason').textContent,/Đây là lời chào ban ngày/);
  assert.equal(sent.length,1);assert.equal(sent[0].response_text,'こんにちは。');
});

test('recall save retry replaces the error with visible source comparison without changing the submitted text',async()=>{
  let available=false;const sent=[];
  const b=lesson({apiFetch:async(_path,options)=>{
    const body=JSON.parse(options.body);sent.push(body);
    return available?Response.json({task:body.task,assessment:{comparison:'orthographic_difference'}})
      :Response.json({detail:'Save unavailable'},{status:503});
  }});
  b.c.showLessonDetail({id:'recall-retry-visible',title:'Luyện nhớ',drills:[{
    mode:'recall',q:'Em viết lời chào nhé.',accepted_answers:['こんにちは。','こんにちは'],
    explanation:'Đây là lời chào ban ngày.'
  }]},'N5','grammar');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.practice-session'),feedback=section.querySelector('.practice-feedback');
  const input=section.querySelector('.practice-options input'),action=section.querySelector('.practice-primary');
  input.value=' こんにちは ';await input.dispatch('input');await action.click();
  assert.equal(feedback.hidden,false);assert.match(feedback.textContent,/Save unavailable/);
  assert.equal(section.querySelector('.practice-sample'),null);assert.equal(section.querySelector('.practice-variants'),null);
  available=true;await action.click();
  assert.equal(feedback.hidden,false);assert.doesNotMatch(feedback.textContent,/Save unavailable/);
  assert.equal(feedback.querySelector('.practice-sample').textContent,'こんにちは');
  assert.ok(feedback.querySelector('.practice-variants'));assert.ok(feedback.querySelector('.practice-reason'));
  assert.equal(feedback.dataset.correct,'unknown');
  assert.equal(sent.length,2);assert.equal(sent[0].attempt_id,sent[1].attempt_id);
  assert.equal(sent[0].response_text,' こんにちは ');assert.deepEqual(sent[1],sent[0]);
});

test('all N5–N1 curriculum and plan formulas use compact rows without modifying source or formation answers',async()=>{
  const corpus=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(readFileSync(`static/${path}`,'utf8'))})});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js','workspace.js'])
    vm.runInContext(readFileSync(`static/${file}`,'utf8'),corpus);
  await corpus.loadPracticalCourse();
  const b=lesson();
  for(const level of ['N5','N4','N3','N2','N1']){
    await corpus.ensureLessons(level);
    const entries=Object.entries(corpus.window.JLPT_DATA.curriculum[level].skills)
      .flatMap(([skill,items])=>items.map(item=>({skill,item})));
    for(const unit of corpus.createStudyPlan(level))for(const step of unit.steps || [])
      if(step.lesson)entries.push({skill:step.skill,item:step.lesson});
    let rendered=false;
    for(const {skill,item}of entries.filter(entry=>entry.item.formula)){
      const before=JSON.stringify(item),answers=JSON.stringify(b.c.lessonQuestions(item,level,skill).map(task=>task.accepted_answers));
      b.c.showLessonDetail(item,level,skill);
      const raw=b.document.querySelector('.lesson-formula code'),layout=b.document.querySelector('.grammar-layout');
      assert.equal(raw.textContent,item.formula,`${level}:${item.id}`);
      assert.equal(raw.hidden,true);assert.equal(layout.querySelector('.grammar-or'),null);
      for(const row of layout.querySelectorAll('.grammar-row')){
        assert.ok(row.textContent.trim() && row.textContent.trim()!=='+',`${level}:${item.id}`);
        assert.ok(row.children.every(child=>child.className==='grammar-chunk'));
      }
      assert.equal(JSON.stringify(item),before,`${level}:${item.id} source changed`);
      assert.equal(JSON.stringify(b.c.lessonQuestions(item,level,skill).map(task=>task.accepted_answers)),answers);
      rendered=true;
    }
    assert.ok(rendered,`No actual formula coverage for ${level}`);
  }
});

test('source readings become inline hiragana without changing Japanese, audio input or Kanji-lesson concealment',()=>{
  const b=lesson(),item={id:'reading-aid',title:'学校',items:[{jp:'学校',reading:'ガッコウ',vi:'trường học'}],
    examples:[{jp:'私は学生です。',reading:'わたしはがくせいです。'},{jp:'学校に行きます。',furigana:'{学校|がっこう}に{行|い}きます。'}]};
  b.c.showLessonDetail(item,'N5','vocabulary');
  assert.equal(b.document.querySelector('.word-detail strong rt').textContent,'がっこう');
  assert.deepEqual(b.document.querySelectorAll('.example-jp rt').map(node=>node.textContent),['わたし','がくせい','がっこう','い']);
  const audio=b.document.querySelectorAll('.example-card .modal-tts-btn');
  assert.equal(decodeURIComponent(audio[0].getAttribute('data-text')),item.examples[0].jp);
  assert.equal(decodeURIComponent(audio[1].getAttribute('data-text')),item.examples[1].furigana);
  b.c.showLessonDetail(item,'N5','kanji');
  assert.equal(b.document.querySelector('.word-detail strong ruby'),null);
  assert.equal(b.document.querySelector('.example-jp ruby'),null);
  assert.equal(b.document.querySelector('.example-jp').textContent,'私は学生です。');
  assert.ok(b.document.querySelector('.lesson-aid-content ruby'));
});

test('reading aids reject mismatched source text, ambiguous kana alignment and unsafe annotations',()=>{
  const b=lesson();
  b.c.showLessonDetail({id:'mismatch',title:'学校',examples:[{jp:'学校です。',furigana:'{別|べつ}の文。',reading:'がっこうです。'}]},'N5','grammar');
  assert.equal(b.document.querySelector('.example-jp rt').textContent,'がっこう');
  assert.doesNotMatch(b.document.querySelector('.example-jp').textContent,/別|べつ/);
  assert.equal(b.c.furiganaHtml('甲あ乙','かあきあく'),'甲あ乙');
  assert.equal(b.c.furiganaHtml('学校','gakkou'),'学校');
  assert.equal(b.c.furiganaHtml('{学校|<img src=x onerror=attack()>}'),'学校');
  assert.match(b.c.furiganaHtml('<学校>','がっこう'),/^&lt;学校&gt;$/);
  b.c.showLessonDetail({id:'listening-aid',title:'聞く',dictation:true,examples:[{jp:'学校です。',reading:'がっこうです。'}]},'N5','listening');
  const transcript=b.document.querySelector('.example-transcript');
  assert.equal(transcript.getAttribute('open'),null);
  assert.equal(transcript.querySelector('rt').textContent,'がっこう');
});
