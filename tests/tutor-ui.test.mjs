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
  click(){return this.disabled?Promise.resolve():this.dispatch('click');}
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
  assert.match(first.querySelector('output').textContent,/không cộng điểm đúng\/sai/);
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
  card.innerHTML='<div class="card-face card-front"><p id="fc-front-text"></p><p id="fc-reading-text"></p></div><div class="card-face card-back"><p id="fc-back-meaning"></p><p id="fc-example-jp"></p><p id="fc-example-vi"></p></div>';
  for(const id of ['fc-counter','fc-badge-lvl','fc-btn-prev','fc-btn-next'])b.add(id,'div',review);
  b.add('fc-face-status','span',review);b.c.soundEngine.playFlip=()=>{};
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
  await card.dispatch('keydown',{key:'Enter'});
  assert.equal(card.classList.contains('flipped'),true);
  assert.equal(front.inert,true);assert.equal(front.getAttribute('aria-hidden'),'true');
  assert.equal(back.inert,false);assert.equal(back.getAttribute('aria-hidden'),'false');
  assert.equal(b.c.teacherContext().focus.index,1);
  assert.equal(JSON.stringify(b.c.teacherContext()).includes('PRIVATE B'),false);
  vm.runInContext('fcIdx=1;displayFlashcard();',b.c);
  assert.equal(b.c.teacherContext().focus.index,0);assert.equal(card.classList.contains('flipped'),false);
  assert.equal(front.inert,false);assert.equal(front.getAttribute('aria-hidden'),'false');
  assert.equal(back.inert,true);assert.equal(back.getAttribute('aria-hidden'),'true');
  assert.equal(invalidations,2,'moving to another automatic word invalidates quick ownership');
  assert.equal(JSON.stringify(b.c.teacherContext()).includes('PRIVATE A'),false);
  card.dataset.teacherWordId='not-in-this-lesson';assert.equal(b.c.teacherContext().focus,null);
});
function quiz(){
  const b=lesson(),panel=b.element('panel-lesson');panel.id='panel-quiz';
  const workspace=b.add('practice-workspace','div',panel),card=b.add('quiz-card','div',workspace);
  for(const id of ['quiz-q-num','quiz-q-type','quiz-instruction','quiz-question-sentence','quiz-options-grid'])b.add(id,'div',card);
  b.add('btn-quiz-next','button',card);
  const feedback=b.add('quiz-feedback-box','div',card);
  b.add('quiz-feedback-status','strong',feedback);b.add('quiz-feedback-text','p',feedback);
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
  assert.match(b.element('quiz-feedback-text').textContent,/POST ANSWER RATIONALE/);
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
  await b.document.querySelector('.practice-coach button').click();
  assert.equal(sent[0].action,'hint');assert.equal(sent[0].item_id,'q0');assert.equal(sent[0].question_index,0);
  assert.equal(Object.hasOwn(sent[0],'answer_index'),false);
  assert.deepEqual(events.map(entry=>[entry.path,entry.body.event || entry.body.action]),
    [['/api/progress/record','assist'],['/api/practice/coach','hint']]);
  assert.equal(events[0].body.help,'hint');assert.deepEqual(events[0].body.task,sent[0].task);
  assert.match(sent[0].task.revision,/^[a-f0-9]{64}$/);
  await b.document.querySelectorAll('.practice-options input')[1].dispatch('change');
  await b.document.querySelector('.practice-session .practice-primary').click();
  await b.document.querySelector('.practice-coach button').click();
  assert.equal(sent[1].answer_index,1);assert.equal(sent[1].action,'feedback');
  assert.deepEqual(events.map(entry=>entry.body.event || entry.body.action),['assist','hint','answer','assist','feedback']);
  assert.equal(events[2].body.answer_index,1);assert.equal(events[2].body.attempt_id,events[0].body.attempt_id);
  assert.equal(events[3].body.help,'chat');assert.deepEqual(sent[1].task,sent[0].task);
  assert.match(b.document.querySelector('.practice-feedback').textContent,/Không có gió lạnh/);
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
  const hint=b.document.querySelector('.practice-coach button').click();
  await started.promise;
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
  const button=b.document.querySelector('.practice-coach button'),output=b.document.querySelector('.practice-coach-reply');
  const hint=button.click();
  await started.promise;
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
  assert.match(section.querySelector('.practice-feedback').textContent,/POST ATTEMPT EXPLANATION/);
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
  assert.match(b.document.querySelector('.practice-result').textContent,/1 câu chưa khả dụng/);
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
  assert.equal(sent[0].body.response_text,'せんせい');assert.equal(sent[0].body.event,'answer');
  assert.equal(sent[0].body.task.id,'practice:question:0');assert.equal(sent[0].body.question_index,0);
  assert.equal(Object.hasOwn(sent[0].body,'answer_index'),false);
  assert.equal(b.document.querySelector('.practice-feedback').dataset.correct,'true');
  assert.match(b.document.querySelector('.practice-feedback').textContent,/SOURCE RECALL RATIONALE/);
});

test('writing self-assessment saves the response and rating without reporting objective correctness',async()=>{
  const sent=[],b=lesson({apiFetch:async(path,options)=>{
    if(path==='/api/progress')return Response.json({evidence:[]});
    const body=JSON.parse(options.body);sent.push(body);return Response.json({task:body.task,basis:'self_report',source_correct:null});
  }});
  b.c.showLessonDetail({id:'writing',title:'書く',production:{prompt:'自己紹介を書いてください。',criteria:['名前を書く'],model:'SOURCE MODEL'}},'N3','production');
  await b.document.querySelector('[data-lesson-mode=practice]').click();
  const section=b.document.querySelector('.production-task'),input=section.querySelector('textarea');
  assert.equal(section.querySelector('.production-model').hidden,true);
  input.value='私はランです。';section.querySelector('input').checked=true;
  await section.querySelector('.production-save').click();
  assert.equal(sent[0].response_text,'私はランです。');assert.equal(sent[0].self_rating,4);
  assert.equal(sent[0].task.id,'writing:question:0');assert.equal(sent[0].event,'answer');
  for(const key of ['correct','quality','answer_index'])assert.equal(Object.hasOwn(sent[0],key),false);
  assert.match(section.querySelector('output').textContent,/chưa có kết luận đúng\/sai/);
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
  assert.match(b.element('quiz-result-praise').textContent,/1 câu tạm ngừng/);
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
  assert.match(marked,/<mark>提出<\/mark>/);assert.match(marked,/Từ cần xét/);
  assert.match(b.c.taskUnavailableMessage(taskFixture({review_status:'quarantined',unavailable_reason:'Technical source conflict'})),/chờ rà soát/);
});
