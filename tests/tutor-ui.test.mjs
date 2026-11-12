import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const app=readFileSync('static/app.js','utf8');
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
  const body=new Element('body'),document={body,createElement:tag=>new Element(tag),getElementById:id=>body.querySelector('#'+id),querySelector:selector=>body.querySelector(selector),querySelectorAll:selector=>body.querySelectorAll(selector)};
  const add=(id,tag='div',parent=body)=>{const element=new Element(tag);element.id=id;parent.append(element);return element;};
  return {document,add,element:id=>document.getElementById(id)};
}
function quick(apiFetch){
  const d=dom(),popover=d.add('sensei-floating-popover');popover.hidden=true;
  for(const id of ['btn-close-popover','btn-popover-send','popover-query-input','popover-speech-text','btn-popover-tts'])d.add(id,id.includes('btn-')?'button':'div',popover);
  d.add('btn-topbar-summon','button');const chip=d.add('chip','button',popover);chip.className='quick-chip-btn';chip.dataset.ask='Ví dụ';
  const timers=new Map(),listeners=new Map();let nextTimer=0;
  const c=vm.createContext({crypto,AbortController,signedInUser:{},location:{hash:'#kaiwa/N3/session/A'},apiFetch,document:d.document,window:{addEventListener:(event,fn)=>{(listeners.get(event)||listeners.set(event,[]).get(event)).push(fn);}},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),soundEngine:{playBlip(){},playReceive(){}},mascotMgr:{setState(){}},playGeminiTTS(){},teacherContext:()=>({screen:{route:c.location.hash.slice(1),level:'N3',text:'先生'},lesson:{id:'kaiwa:N3:A',level:'N3'},focus:{kind:'example',index:1}})});
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
  b.c.buildLessonContext=(item,level)=>({id:item.id,level});b.c.lessonQuestions=()=>[];
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
  const request=deferred(),b=quick(()=>request.promise);let remaining='24:10';
  b.c.location.hash='#quiz/N3/practice/0';
  b.c.teacherContext=()=>({screen:{route:'quiz/N3/practice/0',level:'N3',text:`Time ${remaining}\nQuestion one`},lesson:{id:'quiz:N3:0',level:'N3'},focus:{kind:'question',index:0}});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Explain this question';
  const sending=b.element('btn-popover-send').click();remaining='24:09';
  request.resolve(Response.json({reply:'The explanation for question one'}));await sending;
  assert.equal(b.element('popover-speech-text').textContent,'The explanation for question one');
});
test('a changed Kaiwa prompt still invalidates the previous prompt response',async()=>{
  const request=deferred(),b=quick(()=>request.promise);let question='Question one';
  b.c.teacherContext=()=>({screen:{route:'kaiwa/N3/session/A',level:'N3',text:question},lesson:{id:'kaiwa:N3:A',level:'N3'},focus:null});
  await b.element('btn-topbar-summon').click();b.element('popover-query-input').value='Explain this question';
  const sending=b.element('btn-popover-send').click();question='Question two';
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

function lesson(){
  const d=dom(),panel=d.add('panel-lesson');panel.className='tab-panel active';
  for(const id of ['btn-close-lesson-modal','lesson-page','modal-lesson-badge','modal-lesson-title','modal-lesson-body'])d.add(id,'div',panel);
  d.add('topbar-view-title').textContent='Bài học';
  const c=vm.createContext({document:d.document,window:{},location:{hash:''},crypto,curriculumView:'plan',studyPlans:new Map(),currentLesson:null,activeCurriculumSkill:'grammar',activeCurriculumLevel:'N5',soundEngine:{},playGeminiTTS(){},mountCompletion(){},addFeatureLessonAction(){},renderLessonOutline(){},returnToCourse(){},openStudyStep(){},speechReading:(word)=>word,lessonQuestions:()=>[],activityId:item=>item.id,apiFetch:async()=>Response.json({})});
  vm.runInContext(readFileSync('static/learning.js','utf8'),c);
  vm.runInContext(app.slice(app.indexOf('function showLessonDetail('),app.indexOf('// 10. FLASHCARDS CONTROLLER')),c);
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
test('listening play, reveal and input focus bind their example and never capture learner text',async()=>{
  const b=lesson(),item={id:'listening',title:'Nghe',dictation:true,examples:[{jp:'一',vi:'một'},{jp:'二',vi:'hai'}]};
  b.c.showLessonDetail(item,'N3','listening');await b.document.querySelector('[data-lesson-mode=practice]').click();
  const rows=b.document.querySelectorAll('.lesson-exercise');await rows[1].children[0].click();assert.equal(b.c.teacherContext().focus.index,1);
  await rows[0].children[2].click();assert.equal(b.c.teacherContext().focus.index,0);assert.equal(rows[0].children[3].hidden,false);
  rows[1].children[1].value='PRIVATE SUBMISSION';await rows[1].children[1].focus();assert.equal(b.c.teacherContext().focus.index,1);assert.doesNotMatch(b.c.teacherContext().screen.text,/PRIVATE SUBMISSION/);
});
test('practice focus follows original question position rather than radio option index',async()=>{
  const b=lesson(),questions=[{q:'第一?',opts:['A','B'],ans:'A',item_id:'q0'},{q:'第二?',opts:['A','B'],ans:'B',item_id:'q1'}];
  b.c.lessonQuestions=()=>questions;vm.runInContext(readFileSync('static/practice.js','utf8'),b.c);
  b.c.showLessonDetail({id:'practice',title:'Bài tập'},'N3','grammar');assert.equal(b.c.teacherContext().focus,null);
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

test('SRS ordering retains canonical word identity and only the visible flashcard face is captured',async()=>{
  const b=lesson(),panel=b.element('panel-lesson');panel.id='panel-flashcards';
  const review=b.add('flashcard-review','div',panel),card=b.add('flashcard-card','div',review);
  card.innerHTML='<div class="card-face card-front"><p id="fc-front-text"></p><p id="fc-reading-text"></p></div><div class="card-face card-back"><p id="fc-back-meaning"></p><p id="fc-example-jp"></p><p id="fc-example-vi"></p></div>';
  for(const id of ['fc-counter','fc-badge-lvl','fc-btn-prev','fc-btn-next'])b.add(id,'div',review);
  b.add('controls','div',review).className='fc-controls-bar';
  const item={id:'words',items:[{id:'word-a',jp:'私',vi:'PRIVATE A'},{id:'word-b',jp:'先生',vi:'PRIVATE B',examples:[{jp:'BACK EXAMPLE',vi:'BACK TRANSLATION'}]}]};
  b.c.window.JLPT_DATA={curriculum:{N3:{skills:{vocabulary:[item]}}}};
  b.c.location.hash='#flashcards/N3/review/words';b.c.markTeacherScreen();
  b.c.findFeatureLesson=()=>item;b.c.ensureLessons=async()=>{};
  b.c.apiFetch=async()=>Response.json({items:[{item_id:'word-b',next_review:'2020-01-01'}]});
  let invalidations=0;b.c.invalidateTeacherQuery=()=>invalidations++;
  vm.runInContext(app.slice(app.indexOf('let fcDeck ='),app.indexOf('// 11. KAIWA SPEAKING LAB CONTROLLER')),b.c);
  await b.c.renderFlashcards('N3','words');
  assert.equal(b.element('fc-front-text').textContent,'先生','reviewed due card sorts ahead of the unseen first word');
  assert.equal(b.c.teacherContext().focus.index,1,'focus is canonical word index, not SRS deck index zero');
  assert.equal(invalidations,1);
  b.c.displayFlashcard();assert.equal(invalidations,1,'same stable word does not invalidate quick ownership');
  assert.doesNotMatch(b.c.teacherContext().screen.text,/PRIVATE B|BACK EXAMPLE|BACK TRANSLATION/);
  card.classList.add('flipped');
  assert.match(b.c.teacherContext().screen.text,/PRIVATE B/);assert.doesNotMatch(b.c.teacherContext().screen.text,/先生/);
  vm.runInContext('fcIdx=1;displayFlashcard();',b.c);
  assert.equal(b.c.teacherContext().focus.index,0);assert.equal(card.classList.contains('flipped'),false);
  assert.equal(invalidations,2,'moving to another automatic word invalidates quick ownership');
  assert.doesNotMatch(b.c.teacherContext().screen.text,/PRIVATE A/);
  card.dataset.teacherWordId='not-in-this-lesson';assert.equal(b.c.teacherContext().focus,null);
});
test('quiz session question eight keeps full-exam focus while ordinary lesson practice stays capped at five',()=>{
  const b=lesson(),panel=b.element('panel-lesson');panel.id='panel-quiz';
  const workspace=b.add('practice-workspace','div',panel);
  b.add('quiz-heading','h1',workspace).textContent='Quiz N3';
  const card=b.add('quiz-card','div',workspace);
  for(const id of ['quiz-feedback-box','btn-quiz-next','quiz-q-num','quiz-q-type','quiz-instruction','quiz-question-sentence','quiz-options-grid'])b.add(id,'div',card);
  const result=b.add('quiz-result-card','div',workspace);result.textContent='Finished';
  const raw=Array.from({length:20},(_,i)=>({sentence:`QUESTION ${i}`,options:['A','B'],answer:0}));
  const item={id:'quiz-full',completionId:'test:N3:full',examIndex:2,drills:raw.map((q,i)=>({q:q.sentence,opts:q.options,ans:'A',item_id:`q${i}`}))};
  b.c.location.hash='#quiz/N3/practice/2';b.c.markTeacherScreen();
  b.c.findFeatureLesson=()=>item;b.c.featureLessons=()=>[item];b.c.lessonQuestions=()=>item.drills.slice(0,5);
  b.c.currentExamQuestions=raw;b.c.examQuestionIdx=8;
  vm.runInContext(app.slice(app.indexOf('function displayQuizQuestion()'),app.indexOf('function handleQuizAnswer(')),b.c);
  b.c.displayQuizQuestion();assert.equal(b.c.teacherContext().focus.index,8);assert.match(b.c.teacherContext().screen.text,/QUESTION 8/);
  b.c.setTeacherFocus({kind:'question',index:19});assert.equal(b.c.teacherContext().focus.index,19);
  b.c.setTeacherFocus({kind:'question',index:20});assert.equal(b.c.teacherContext().focus,null);
  b.c.examTimerInterval=null;b.c.examScore=0;b.c.activeQuizLevel='N3';b.c.activeQuizTestIdx=2;
  b.c.window.JLPT_DATA={exams:{N3:[null,null,{title:'Full exam'}]}};b.c.examIdentity=()=> 'N3:full';b.c.loadProgress=()=>{};
  let invalidations=0;b.c.invalidateTeacherQuery=()=>invalidations++;
  vm.runInContext(app.slice(app.indexOf('function finishExam()'),app.indexOf('// 13. MASTERY & PROGRESS CONTROLLER')),b.c);
  b.c.setTeacherFocus({kind:'question',index:8});const beforeFinish=invalidations;
  b.c.finishExam();
  assert.equal(b.c.teacherContext().lesson,null);assert.equal(b.c.teacherContext().focus,null);
  assert.doesNotMatch(b.c.teacherContext().screen.text,/QUESTION 8/);assert.ok(invalidations>beforeFinish);
  b.element('modal-lesson-title').textContent='Ordinary lesson practice';
  panel.id='panel-lesson';b.c.location.hash='#quiz/N3/lesson/quiz-full';b.c.currentLesson={item,level:'N3',skill:'reading',owner:'quiz'};b.c.markTeacherScreen();
  b.c.setTeacherFocus({kind:'question',index:8});assert.equal(b.c.teacherContext().focus,null);
  b.c.setTeacherFocus({kind:'question',index:4});assert.equal(b.c.teacherContext().focus.index,4);
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
