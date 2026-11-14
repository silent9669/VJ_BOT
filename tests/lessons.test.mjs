import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const levels=['N5','N4','N3','N2','N1'];
test('pinned LF source content is intact across checkout line endings and every record has an identity, reading or meaning',async()=>{
  const manifest=JSON.parse(await fs.readFile('static/openjlpt/manifest.json','utf8'));
  let total=0;
  for(const [file,count] of Object.entries(manifest.counts)){
    const raw=await fs.readFile('static/openjlpt/'+file),rows=JSON.parse(raw);
    const sourceText=raw.toString('utf8').replace(/\r\n/g,'\n');
    assert.equal(createHash('sha256').update(sourceText,'utf8').digest('hex'),manifest.sha256[file]);
    assert.equal(rows.length,count);total+=count;
    const ids=new Set();
    for(const row of rows){const id=row.id||row.character;assert.ok(id);assert.ok(!ids.has(id));ids.add(id);assert.ok(row.meaning||row.meanings?.length);}
  }
  assert.equal(total,10720);
});
test('all levels load once with source-keyed exercises and attributed reading/listening practice',async()=>{
  const context=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(await fs.readFile('static/'+path,'utf8'))})});
  vm.runInContext(await fs.readFile('static/jlpt-data.js','utf8'),context);
  vm.runInContext(await fs.readFile('static/vi-labels.js','utf8'),context);
  vm.runInContext(await fs.readFile('static/learning.js','utf8'),context);
  for(const level of levels){
    await context.window.ensureLessons(level);const skills=context.window.JLPT_DATA.curriculum[level].skills;
    for(const skill of ['vocabulary','grammar','kanji','reading','listening'])assert.ok(skills[skill].length>=5,level+skill);
    if(level==='N5'){assert.equal(skills.kana.length,20);assert.equal(skills.kana.flatMap(l=>l.items).length,92);}
    for(const lesson of skills.kanji){assert.equal(lesson.drills.length,lesson.items.length);for(const item of lesson.items){assert.ok(item.strokes>0);assert.ok(Array.isArray(item.words));}}
    for(const lesson of skills.grammar.filter(l=>l.source==='OpenJLPT'))assert.equal(lesson.drills.length,1);
    const count=skills.vocabulary.length;await context.window.ensureLessons(level);assert.equal(skills.vocabulary.length,count);
    for(const lesson of skills.vocabulary.filter(x=>x.source)){
      assert.equal(lesson.drills.length,lesson.items.length);for(const q of lesson.drills){assert.ok(Number.isInteger(q.answer_index));assert.ok(q.answer_index>=0 && q.answer_index<q.opts.length);assert.ok(q.item_id);}
    }
    for(const lesson of skills.reading.filter(x=>x.source)){assert.ok(lesson.examples.every(e=>e.source.startsWith('https://tatoeba.org/')));assert.equal(lesson.drills.length,lesson.examples.length);for(const [i,q] of lesson.drills.entries())assert.deepEqual(Array.from(q.example_indexes),[i]);}
  }
});

test('practical roadmaps follow authored goals and link only verified source records',async()=>{
  const context=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(await fs.readFile('static/'+path,'utf8'))})});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js'])vm.runInContext(await fs.readFile('static/'+file,'utf8'),context);
  const course=JSON.parse(await fs.readFile('static/course/practical.json','utf8'));
  const sources=JSON.parse(await fs.readFile('static/course/sources.json','utf8'));
  const sourceIds=new Set(sources.lessons.map(s=>s.id));assert.equal(sourceIds.size,72);
  const ids=new Set();
  for(const unit of course.units){
    assert.ok(!ids.has(unit.id));ids.add(unit.id);
    assert.ok(unit.goal.length>20);assert.ok(unit.dialogue.length>=2);assert.equal(unit.words.length,6);
    for(const ref of unit.source_ids)assert.ok(sourceIds.has(ref),ref);
    for(const prerequisite of unit.prerequisites)assert.ok(ids.has(prerequisite));
    assert.equal(unit.production.criteria.length,3);
    for(const q of unit.questions){assert.ok(q.opts.includes(q.ans));assert.equal(new Set(q.opts).size,q.opts.length);assert.ok(q.explanation.length>20);}
  }
  await context.window.loadPracticalCourse();
  for(const level of levels){
    await context.window.ensureLessons(level);
    const units=context.window.createStudyPlan(level),count=context.window.JLPT_DATA.exams[level].length;
    assert.equal(units.filter(u=>u.type==='situation').length,course.units.filter(u=>u.level===level).length);
    context.window.createStudyPlan(level);assert.equal(context.window.JLPT_DATA.exams[level].length,count);
    for(const unit of units.filter(u=>u.type==='situation')){
      assert.equal(unit.steps.length,2);assert.ok(unit.steps.every(s=>s.ids.length));
      assert.deepEqual(Array.from(unit.steps,s=>s.skill),['vocabulary','reading']);
      assert.ok(context.window.JLPT_DATA.exams[level][unit.examIndex].questions.length);
      assert.equal(unit.exam.questions.length,3);assert.ok(unit.exam.questions.every(q=>q.passage && q.explanation));
    }
    const chapters=units.filter(u=>u.type==='grammar' && u.id!==`${level.toLowerCase()}-teaching:v1`);assert.equal(chapters.length,8);
    for(const chapter of chapters)assert.ok(chapter.steps.every(s=>s.lesson.source==='OpenJLPT' && s.ids.length));
    const step=units.find(u=>!u.optional).steps[0];
    const records=new Map(step.ids.map(id=>[id,{correct:0,incorrect:1,last_correct:0}]));
    assert.equal(context.window.studyStepState(step,records).complete,false);
    for(const r of records.values()){r.correct=1;r.last_correct=1;}
    assert.equal(context.window.studyStepState(step,records).complete,true);
    records.get(step.ids[0]).last_correct=0;
    assert.equal(context.window.studyStepState(step,records).complete,false);
  }
});

test('official resources cover each level and point only to the publisher',async()=>{
  const catalog=JSON.parse(await fs.readFile('static/course/jlpt-resources.json','utf8'));
  const ids=new Set();
  for(const row of catalog.resources){assert.ok(!ids.has(row.id));ids.add(row.id);assert.equal(new URL(row.url).hostname,'www.jlpt.jp');}
  for(const level of levels)for(const type of ['V','G','R','L','answer','script'])assert.ok(ids.has(`jlpt:2018:${level}:${type}`));
});

test('exam identities never share completion or answers between levels',async()=>{
  const context=vm.createContext({window:{}});
  for(const file of ['jlpt-data.js','study-plan.js'])vm.runInContext(await fs.readFile('static/'+file,'utf8'),context);
  const completionIds=new Set(),answerIds=new Set();
  for(const level of levels)for(const [index,exam] of context.window.JLPT_DATA.exams[level].entries()){
    const id=context.examIdentity(level,index);assert.ok(!completionIds.has(id));completionIds.add(id);
    for(const [qIndex,q] of exam.questions.entries()){
      const id=context.quizProgressId(level,index,q,qIndex);assert.ok(!answerIds.has(id));answerIds.add(id);
    }
  }
});


test('practice confirms numeric source positions once and keeps review agreement separate',async()=>{
  const context=vm.createContext({});vm.runInContext(await fs.readFile('static/practice.js','utf8'),context);
  const questions=[{mode:'choice',opts:['a','b'],answer_index:0},{mode:'choice',opts:['c','d'],answer_index:1},{mode:'choice',opts:['e','f'],answer_index:0}];
  const round=context.createPracticeRound(questions);
  assert.equal(round.next(),false);assert.equal(round.answer('invalid'),null);
  assert.equal(round.answer(1).correct,false);assert.equal(round.answer(0),null);
  round.next();assert.equal(round.answer(1).correct,true);round.next();round.answer(1);round.next();
  assert.equal(round.correct,1);assert.deepEqual(Array.from(round.missed),[0,2]);
  const review=context.createPracticeRound(questions,round.missed);
  assert.equal(review.answer(0).originalIndex,0);review.next();assert.equal(review.answer(0).originalIndex,2);review.next();
  assert.equal(review.correct,2);assert.equal(review.missed.length,0);assert.equal(round.correct,1);
});

test('practice distinguishes duplicate option positions, source recall and blocked tasks',async()=>{
  const context=vm.createContext({});vm.runInContext(await fs.readFile('static/practice.js','utf8'),context);
  const tasks=[{mode:'choice',opts:['あれ','あれ'],answer_index:1},
    {mode:'recall',accepted_answers:['あう']},
    {mode:'choice',opts:['a','b'],answer_index:0,unavailable_reason:'Contradictory source'}];
  const round=context.createPracticeRound(tasks);
  assert.equal(round.answer('あれ'),null);assert.equal(round.answer(0).correct,false);round.next();
  assert.equal(round.answer(''),null);assert.equal(round.answer('あう').correct,true);round.next();
  assert.equal(round.answer(0),null);assert.equal(round.checked,false);assert.equal(round.next(),false);
});

test('Erin contains 25 sourced lessons with distinct publisher activity links',async()=>{
  const catalog=JSON.parse(await fs.readFile('static/course/erin-resources.json','utf8'));
  assert.equal(catalog.lessons.length,25);assert.equal(new Set(catalog.lessons.map(l=>l.id)).size,25);
  assert.equal(catalog.pages.length,26);
  for(const lesson of catalog.lessons){
    assert.ok(lesson.title.length>5);assert.equal(lesson.resources.length,9);
    assert.ok(catalog.pages.some(p=>p.url===lesson.page_url && /^[a-f0-9]{64}$/.test(p.sha256)));
    for(const resource of lesson.resources){const url=new URL(resource.url);assert.equal(url.hostname,'www.erin.jpf.go.jp');assert.ok(url.pathname.startsWith(`/en/lesson/${String(lesson.number).padStart(2,'0')}/`));}
  }
});
