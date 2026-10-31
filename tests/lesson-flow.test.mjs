import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function context(){
  const c=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('static/'+path,'utf8'))})});
  for(const file of ['jlpt-data.js','learning.js','lesson-checks.js','study-plan.js','workspace.js','completion.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),c);
  const app=fs.readFileSync('static/app.js','utf8');vm.runInContext(app.slice(app.indexOf('function installCourseKaiwa(){'),app.indexOf('function startCourseKaiwa')),c);
  await c.loadPracticalCourse();return c;
}
test('every in-app curriculum and feature lesson has five distinct answerable source-based checks',async()=>{
  const c=await context(),featureIds=new Set(),completionIds=new Set();
  for(const level of ['N5','N4','N3','N2','N1']){
    await c.ensureLessons(level);const units=c.createStudyPlan(level);
    const all=Object.entries(c.window.JLPT_DATA.curriculum[level].skills).flatMap(([skill,lessons])=>lessons.map(item=>({item,skill})));
    all.push(...units.flatMap(u=>u.steps.filter(s=>!s.kind).map(s=>({item:s.lesson,skill:s.skill}))));
    for(const feature of ['flashcards','kaiwa','quiz'])for(const item of c.featureLessons(feature,level)){
      assert.ok(!featureIds.has(item.id),item.id);featureIds.add(item.id);
      const id=c.activityId(item,level,feature);assert.ok(!completionIds.has(id),id);completionIds.add(id);
      all.push({item,skill:feature==='flashcards'?'vocabulary':'listening'});
    }
    for(const {item,skill} of all){
      const questions=c.lessonQuestions(item,level,skill);
      assert.equal(questions.length,5,`${level} ${skill} ${item.id || item.title}`);
      assert.equal(new Set(questions.map(q=>q.item_id)).size,5);
      assert.equal(new Set(questions.map(q=>q.q)).size,5);
      for(const q of questions){assert.ok(q.opts.length>=2);assert.equal(q.opts.filter(o=>o===q.ans).length,1);}
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
test('speaking completion and lesson completion share identity for built-in and practical scenarios',async()=>{
  const c=await context();await c.ensureLessons('N5');
  const app=fs.readFileSync('static/app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('function loadKaiwaPrompt()'),app.indexOf('// 12. JLPT MOCK EXAM CONTROLLER')),c);
  let captured;
  c.document={getElementById:()=>({})};c.mountCompletion=(_host,activity)=>{captured=activity;};
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
  vm.runInContext(app.slice(app.indexOf('function startReversedLesson(')),c);
  const host={replaceChildren(){},append(...children){this.children=children;}};
  c.document={getElementById:()=>host,createElement:()=>({})};
  c.mountCompletion=()=>{};c.sendMessage=()=>{};c.buildLessonContext=item=>item;
  let destination;
  c.showLessonDetail=(item,level,skill,fromHistory,owner)=>{destination=c.appRouteHash('lesson',{id:item.id,level,skill,owner});};
  for(const owner of ['flashcards','kaiwa','quiz']){
    const item=c.featureLessons(owner,'N5')[0];
    c.startReversedLesson(item,'N5','listening',owner);host.children[1].onclick();
    const route=c.parseAppRoute(destination);
    assert.equal(route.owner,owner);assert.equal(c.findFeatureLesson(owner,route.level,route.id).id,item.id);
  }
});
