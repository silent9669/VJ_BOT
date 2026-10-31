import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const levels=['N5','N4','N3','N2','N1'];
test('pinned lesson files are intact and every record has an identity, reading or meaning',async()=>{
  const manifest=JSON.parse(await fs.readFile('static/openjlpt/manifest.json','utf8'));
  let total=0;
  for(const [file,count] of Object.entries(manifest.counts)){
    const raw=await fs.readFile('static/openjlpt/'+file),rows=JSON.parse(raw);
    assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.sha256[file]);
    assert.equal(rows.length,count);total+=count;
    const ids=new Set();
    for(const row of rows){const id=row.id||row.character;assert.ok(id);assert.ok(!ids.has(id));ids.add(id);assert.ok(row.meaning||row.meanings?.length);}
  }
  assert.equal(total,10720);
});
test('all levels load once with answerable exercises and attributed reading/listening practice',async()=>{
  const context=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(await fs.readFile('static/'+path,'utf8'))})});
  vm.runInContext(await fs.readFile('static/jlpt-data.js','utf8'),context);
  vm.runInContext(await fs.readFile('static/learning.js','utf8'),context);
  for(const level of levels){
    await context.window.ensureLessons(level);const skills=context.window.JLPT_DATA.curriculum[level].skills;
    for(const skill of ['vocabulary','grammar','kanji','reading','listening'])assert.ok(skills[skill].length>=5,level+skill);
    if(level==='N5'){assert.equal(skills.kana.length,20);assert.equal(skills.kana.flatMap(l=>l.items).length,92);}
    for(const lesson of skills.kanji){assert.equal(lesson.drills.length,lesson.items.length);for(const item of lesson.items){assert.ok(item.strokes>0);assert.ok(Array.isArray(item.words));}}
    for(const lesson of skills.grammar.filter(l=>l.source))assert.equal(lesson.drills.length,1);
    const count=skills.vocabulary.length;await context.window.ensureLessons(level);assert.equal(skills.vocabulary.length,count);
    for(const lesson of skills.vocabulary.filter(x=>x.source)){
      assert.equal(lesson.drills.length,lesson.items.length);for(const q of lesson.drills){assert.equal(q.opts.filter(x=>x===q.ans).length,1);assert.equal(new Set(q.opts).size,q.opts.length);assert.ok(q.item_id);}
    }
    for(const lesson of skills.reading.filter(x=>x.source)){assert.ok(lesson.examples.every(e=>e.source.startsWith('https://tatoeba.org/')));}
  }
});

test('practical roadmaps follow authored goals and link only verified source records',async()=>{
  const context=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(await fs.readFile('static/'+path,'utf8'))})});
  for(const file of ['jlpt-data.js','learning.js','study-plan.js'])vm.runInContext(await fs.readFile('static/'+file,'utf8'),context);
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
    assert.equal(units.filter(u=>!u.optional).length,course.units.filter(u=>u.level===level).length);
    context.window.createStudyPlan(level);assert.equal(context.window.JLPT_DATA.exams[level].length,count);
    for(const unit of units.filter(u=>!u.optional)){
      assert.equal(unit.steps.length,3);assert.ok(unit.steps.every(s=>s.ids.length));
      assert.equal(unit.exam.questions.length,3);assert.ok(unit.exam.questions.every(q=>q.passage && q.explanation));
    }
    const step=units.find(u=>!u.optional).steps[0];
    const records=new Map(step.ids.map(id=>[id,{correct:0,incorrect:1,last_correct:0}]));
    assert.equal(context.window.studyStepState(step,records).complete,false);
    for(const r of records.values()){r.correct=1;r.last_correct=1;}
    assert.equal(context.window.studyStepState(step,records).complete,true);
    records.get(step.ids[0]).last_correct=0;
    assert.equal(context.window.studyStepState(step,records).complete,false);
  }
});
