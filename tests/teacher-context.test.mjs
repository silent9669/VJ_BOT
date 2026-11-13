import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function node(tag='div',text='',children=[]){
  const element={nodeType:1,tagName:tag.toUpperCase(),id:'',hidden:false,style:{},childNodes:[],matches(selector){return selector.split(',').some(s=>s.trim().startsWith('#')?this.id===s.trim().slice(1):['input','textarea','select','output','script','style'].includes(s.trim())&&this.tagName===s.trim().toUpperCase());}};
  if(text)element.childNodes.push({nodeType:3,textContent:text,parentElement:element});
  for(const child of children){child.parentElement=element;element.childNodes.push(child);}
  Object.defineProperty(element,'textContent',{get(){return this.childNodes.map(n=>n.textContent).join('');}});
  return element;
}
function page(hash='#curriculum/N3/lesson/grammar/wa'){
  const ids=new Map(),panel=node();panel.id='panel-lesson';
  const title=node('h1','〜は');ids.set('modal-lesson-title',title);ids.set('topbar-view-title',node('h1','Danh sách'));
  const item={id:'wa',title:'〜は',items:[{jp:'私'},{jp:'先生'}],examples:[{jp:'私は先生です。'}]};
  const c=vm.createContext({document:{querySelector:()=>panel,getElementById:id=>ids.get(id)},location:{hash},Date,activeCurriculumLevel:'N5',currentLesson:{item,level:'N3',skill:'grammar'},buildLessonContext:(item,level)=>({id:item.id,level}),lessonQuestions:()=>[{}]});
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),c);
  c.markTeacherScreen();
  return {c,panel,ids,item,append(element,parent=panel){element.parentElement=parent;parent.childNodes.push(element);return element;}};
}
test('active route level wins over stale curriculum and full context survives leaving for chat',()=>{
  const b=page();b.append(node('p','  Cấu trúc:   Danh từ + は\n\nVí dụ '+ 'x'.repeat(5000)));
  b.c.setTeacherFocus({kind:'word',index:1});
  const live=b.c.teacherContext();
  assert.equal(live.screen.level,'N3');assert.equal(live.screen.route,'curriculum/N3/lesson/grammar/wa');
  assert.match(live.screen.text,/^Cấu trúc: Danh từ \+ は\nVí dụ/);assert.ok(live.screen.text.length<=3500);
  assert.deepEqual(JSON.parse(JSON.stringify(live.lesson)),{id:'wa',level:'N3'});
  b.c.location.hash='#classroom';b.c.rememberTeacherScreen();b.panel.id='panel-classroom';b.c.markTeacherScreen();
  assert.equal(b.c.teacherContext().focus.index,1);assert.equal(b.c.teacherContext().lesson.id,'wa');
});
test('another lesson or a feature hub never inherits the old lesson or focus',()=>{
  const b=page();b.append(node('p','Bài học'));b.c.setTeacherFocus({kind:'word',index:1});b.c.rememberTeacherScreen();
  b.panel.id='panel-kaiwa';b.c.location.hash='#kaiwa/N4';b.c.markTeacherScreen();b.panel.childNodes=[];b.append(node('p','Chọn tình huống N4'));
  const context=b.c.teacherContext();assert.equal(context.lesson,null);assert.equal(context.focus,null);assert.equal(context.screen.level,'N4');
  b.panel.id='panel-lesson';b.c.location.hash='#curriculum/N3/lesson/grammar/other';b.c.markTeacherScreen();
  assert.equal(b.c.teacherContext().lesson,null);assert.equal(b.c.teacherContext().focus,null);
});
test('focus is position-only, bounds checked and bound to canonical lesson',()=>{
  const b=page();b.append(node('p','Từ vựng'));
  for(const focus of [{kind:'word',index:2},{kind:'word',index:-1},{kind:'example',index:1},{kind:'question',index:1},{kind:'word',index:0,text:'injected'}]){
    b.c.setTeacherFocus(focus);assert.equal(b.c.teacherContext().focus,null);
  }
  b.c.setTeacherFocus({kind:'example',index:0});assert.equal(b.c.teacherContext().focus.kind,'example');
  b.c.currentLesson={...b.c.currentLesson,item:{id:'next',items:[{}]}};assert.equal(b.c.teacherContext().focus,null);
});
test('hidden Kaiwa session and ancestors are excluded; visible lists are captured instead',()=>{
  const b=page('#kaiwa/N4');b.panel.id='panel-kaiwa';b.panel.childNodes=[];
  b.append(node('p','Danh sách tình huống N4'));
  const workspace=b.append(node()),session=b.append(node(),workspace);session.id='kaiwa-session';b.ids.set(session.id,session);session.hidden=true;
  for(const [id,text] of [['kaiwa-context','場面'],['kaiwa-prompt-jp','お名前は？'],['kaiwa-prompt-vi','Em tên gì?']]){const el=b.append(node('p',text),session);el.id=id;b.ids.set(id,el);}
  const feedback=b.append(node('div','MODEL OVERRIDE'),session);feedback.id='kaiwa-result-card';
  b.append(node('textarea','SUBMISSION'),session);
  assert.equal(b.c.teacherContext().screen.text,'Danh sách tình huống N4');
  b.c.location.hash='#kaiwa/N4/session/shop';session.hidden=false;
  b.c.findFeatureLesson=()=>({id:'kaiwa-lesson:N4:shop',completionId:'kaiwa:N4:shop'});
  b.c.buildLessonContext=(item,level)=>({id:item.completionId,level});
  let context=b.c.teacherContext();assert.equal(context.screen.text,'場面\nお名前は？\nEm tên gì?');assert.equal(context.lesson.id,'kaiwa:N4:shop');
  workspace.hidden=true;context=b.c.teacherContext();assert.equal(context.lesson,null);assert.equal(context.screen.text,'Danh sách tình huống N4');
});
test('landing has no context and visible reference excludes learner input and feedback',()=>{
  const b=page();b.append(node('p','Reference'));const feedback=b.append(node('div','NOT SOURCE'));feedback.id='kaiwa-result-card';b.append(node('textarea','PRIVATE ANSWER'));
  b.c.getComputedStyle=element=>{assert.equal(element.nodeType,1);return element.style;};
  b.panel.childNodes.push({nodeType:8,textContent:'private comment',parentElement:b.panel});
  assert.equal(b.c.teacherContext().screen.text,'Reference');b.panel.id='panel-landing';assert.equal(b.c.teacherContext(),null);
});
test('supported feature sessions resolve canonical refs, but their lists do not',()=>{
  for(const [panelId,hash,sessionId] of [['panel-flashcards','#flashcards/N4/review/words','flashcard-review'],['panel-quiz','#quiz/N4/practice/2','practice-workspace']]){
    const b=page(hash);b.panel.id=panelId;b.append(node('p','Session'));
    const session=b.append(node());session.id=sessionId;b.ids.set(sessionId,session);
    if(panelId==='panel-quiz'){const card=b.append(node(),session);card.id='quiz-card';b.ids.set(card.id,card);}
    const item={id:'feature',completionId:'canonical',examIndex:2,items:[{jp:'先生'}]};
    b.c.findFeatureLesson=()=>item;b.c.featureLessons=()=>[item];b.c.buildLessonContext=(item,level)=>({id:item.completionId,level});
    if(panelId==='panel-flashcards')b.c.practicalCourse=null;
    assert.equal(b.c.teacherContext().lesson.id,'canonical');
    b.c.setTeacherFocus({kind:'word',index:0});assert.equal(b.c.teacherContext().focus.index,0);
    b.c.location.hash=hash.split('/').slice(0,2).join('/');b.c.markTeacherScreen();
    assert.equal(b.c.teacherContext().lesson,null);assert.equal(b.c.teacherContext().focus,null);
  }
});
