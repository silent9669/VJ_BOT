import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function context(){
  const c=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('static/'+path,'utf8'))})});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js','workspace.js','completion.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),c);
  await c.loadPracticalCourse();return c;
}
test('complete lesson inventories preserve source slots and explicit task modes without fixed-count filler',async()=>{
  const c=await context(),featureIds=new Set(),completionIds=new Set();
  for(const level of ['N5','N4','N3','N2','N1']){
    await c.ensureLessons(level);const units=c.createStudyPlan(level);
    const all=Object.entries(c.window.JLPT_DATA.curriculum[level].skills).flatMap(([skill,lessons])=>lessons.map(item=>({item,skill})));
    all.push(...units.flatMap(u=>u.steps.filter(s=>!s.kind).map(s=>({item:s.lesson,skill:s.skill}))));
    for(const feature of ['flashcards','kaiwa','quiz'])for(const item of c.featureLessons(feature,level)){
      assert.ok(!featureIds.has(item.id),item.id);featureIds.add(item.id);
      const id=c.activityId(item,level,feature);assert.ok(!completionIds.has(id),id);completionIds.add(id);
      all.push({item,skill:feature==='flashcards'?'vocabulary':feature==='quiz'?'quiz':'listening'});
    }
    for(const {item,skill} of all){
      const questions=c.lessonQuestions(item,level,skill);
      assert.equal(new Set(questions.map(q=>q.task_id)).size,questions.length);
      assert.equal(new Set(questions.map(q=>q.item_id)).size,questions.length);
      if(item.production){assert.equal(questions.length,1);assert.equal(questions[0].mode,'writing');}
      else if(item.dictation){assert.equal(questions.length,item.examples.length);assert.ok(questions.every(q=>q.mode==='dictation'));}
      else for(const [index,source] of (item.drills || []).entries()){
        const q=questions[index];
        assert.equal(q.source_position,index);assert.deepEqual(Array.from(q.opts),Array.from(source.opts));
        assert.equal(q.item_id,source.item_id || `${item.id || c.activityId(item,level,skill)}:${index}`);
      }
      for(const q of questions){
        assert.equal(Object.hasOwn(q,'ans'),false);assert.ok(['choice','recall','dictation','writing'].includes(q.mode));
        assert.ok(['unreviewed','quarantined'].includes(q.review_status));
        if(q.unavailable_reason)assert.ok(Object.values(q.capabilities).every(value=>value===false));
        else if(q.mode==='choice'){assert.ok(q.opts.length>=2);assert.ok(Number.isInteger(q.answer_index));assert.ok(q.answer_index>=0 && q.answer_index<q.opts.length);}
        else assert.equal(q.answer_index,null);
      }
    }
  }
});
test('feature lessons restore their own route and canonical completion identity',async()=>{
  const c=await context();c.TAB_TITLES={landing:'Home'};vm.runInContext(fs.readFileSync('static/navigation.js','utf8'),c);
  await c.ensureLessons('N5');const units=c.createStudyPlan('N5');
  for(const owner of ['flashcards','kaiwa','quiz']){
    const item=c.featureLessons(owner,'N5')[0];const hash=c.appRouteHash('lesson',{owner,level:'N5',id:item.id});const route=c.parseAppRoute(hash);
    assert.equal(route.tab,'lesson');assert.equal(route.owner,owner);assert.equal(c.findFeatureLesson(owner,'N5',route.id).id,item.id);
  }
  const unit=units.find(u=>u.type==='situation');const kaiwa=c.featureLessons('kaiwa','N5').find(l=>l.lessonKey===unit.id);assert.equal(c.activityId(kaiwa),`kaiwa:${unit.id}`);
  const quiz=c.featureLessons('quiz','N5')[unit.examIndex];assert.equal(c.activityId(quiz),`test:N5:${unit.exam.id}`);
});
test('quiz descriptors and lesson questions share every original exam position without fake examples',async()=>{
  const c=await context();await c.ensureLessons('N5');
  const lessons=c.featureLessons('quiz','N5');
  assert.ok(lessons.some(item=>item.drills.length>5),'fixture includes a multi-question exam');
  for(const item of lessons){
    const raw=c.window.JLPT_DATA.exams.N5[item.examIndex].questions;
    assert.equal(item.drills.length,raw.length);assert.equal(item.examples.length,0);
    const tasks=c.lessonQuestions(item,'N5','quiz');
    assert.equal(tasks.length,raw.length);
    for(let i=0;i<raw.length;i++){
      assert.equal(item.drills[i].item_id,c.quizProgressId('N5',item.examIndex,raw[i],i));
      assert.equal(item.drills[i].answer_index,raw[i].answer);
      assert.deepEqual(Array.from(tasks[i].opts),Array.from(raw[i].options));
      assert.equal(tasks[i].task_id,`${c.activityId(item)}:question:${i}`);
      assert.equal(tasks[i].passage,raw[i].passage || '');
    }
  }
});
test('speaking completion and lesson completion share identity for built-in and practical scenarios',async()=>{
  const c=await context();await c.ensureLessons('N5');
  const app=fs.readFileSync('static/app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('function loadKaiwaPrompt()'),app.indexOf('// 12. JLPT MOCK EXAM CONTROLLER')),c);
  let captured;
  c.document={getElementById:()=>({}),querySelectorAll:()=>[]};c.mountCompletion=(_host,activity)=>{captured=activity;};
  c.activeKaiwaLevel='N5';c.activeKaiwaPromptIdx=1;
  const lessons=c.featureLessons('kaiwa','N5');
  for(const lesson of lessons){
    c.activeKaiwaKey=lesson.lessonKey;c.loadKaiwaPrompt();
    assert.equal(captured.activity_id,c.activityId(lesson));
  }
});
test('returning from lesson chat preserves feature route for reload',async()=>{
  const c=await context();await c.ensureLessons('N5');c.TAB_TITLES={landing:'Home'};
  vm.runInContext(fs.readFileSync('static/navigation.js','utf8'),c);
  const app=fs.readFileSync('static/app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('async function startReversedLesson(')),c);
  const host={replaceChildren(){},append(...children){this.children=children;}};
  c.document={getElementById:()=>host,createElement:()=>({})};
  c.mountCompletion=()=>{};c.sendMessage=()=>{};c.restartTutorConversation=()=>{};c.updateHeroTopic=()=>{};
  c.sendingMessage=false;c.clearingChat=false;c.chatHistoryLoading=false;c.failedChatMessage=null;c.chatHistoryReady=true;
  c.loadChatHistory=async()=>{};
  let destination;
  c.showLessonDetail=(item,level,skill,fromHistory,owner)=>{destination=c.appRouteHash('lesson',{id:item.id,level,skill,owner});};
  for(const owner of ['flashcards','kaiwa','quiz']){
    const item=c.featureLessons(owner,'N5')[0];
    await c.startReversedLesson(item,'N5','listening',owner);host.children[1].onclick();
    const route=c.parseAppRoute(destination);
    assert.equal(route.owner,owner);assert.equal(c.findFeatureLesson(owner,route.level,route.id).id,item.id);
  }
});

test('writing lessons remain resolvable while the roadmap only contains theory, vocabulary and grammar',async()=>{
  const c=await context();
  for(const level of ['N5','N4','N3','N2','N1']){
    await c.ensureLessons(level);const units=c.createStudyPlan(level);
    assert.ok(units.every(unit=>unit.steps.every(step=>['kana','grammar','vocabulary','reading'].includes(step.skill) && !step.kind)));
    for(const unit of units.filter(unit=>unit.type==='situation')){
      const writing=c.window.JLPT_DATA.curriculum[level].skills.production.find(lesson=>lesson.id===unit.id+':production');
      assert.ok(writing);assert.equal(writing.production.prompt,unit.production.prompt);
      assert.ok(c.featureLessons('quiz',level).some(lesson=>c.activityId(lesson)===`test:${level}:${unit.exam.id}`));
    }
  }
});
