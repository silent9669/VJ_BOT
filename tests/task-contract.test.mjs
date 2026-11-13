import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';

function context(){
  const c=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(readFileSync('static/'+path,'utf8'))})});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js','workspace.js','completion.js'])vm.runInContext(readFileSync('static/'+file,'utf8'),c);
  return c;
}
const plain=value=>JSON.parse(JSON.stringify(value));
const hash=(c,task)=>createHash('sha256').update(c.taskRevisionSource(task),'utf8').digest('hex');

test('normalization preserves all source positions, duplicate numbered choices and source numeric keys',()=>{
  const c=context();
  const raw={id:'source',drills:Array.from({length:8},(_,i)=>({q:`Task ${i}`,opts:['あれ','あれ','どうで'],answer_index:1,item_id:`word:${i}`,parts:['1. あれ','2. あれ','3. どうで']}))};
  const before=plain(raw),tasks=c.lessonQuestions(raw,'N1','grammar');
  assert.equal(tasks.length,8,'no formula or other source direction exists to append');
  assert.deepEqual(plain(raw),before);
  for(let i=0;i<8;i++){
    const task=tasks[i];
    assert.deepEqual(plain(task.opts),raw.drills[i].opts);assert.deepEqual(plain(task.parts),raw.drills[i].parts);
    assert.equal(task.answer_index,1);assert.equal(task.item_id,`word:${i}`);
    assert.equal(task.task_id,`source:question:${i}`);assert.equal(task.source_position,i);
    assert.equal(task.review_status,'unreviewed');assert.equal(Object.hasOwn(task,'ans'),false);
  }
});

test('short, empty and malformed lessons do not gain filler or invented answer positions',()=>{
  const c=context();
  assert.deepEqual(plain(c.lessonQuestions({id:'empty'},'N5','reading')),[]);
  assert.deepEqual(plain(c.lessonQuestions({id:'external',externalResources:[],drills:[{q:'Q',opts:['a','b'],ans:'a'}]},'N5','reading')),[]);
  const tasks=c.lessonQuestions({id:'short',drills:[
    {q:'Unique source',opts:['b','a'],ans:'a'},
    {q:'Ambiguous string key',opts:['あれ','あれ'],ans:'あれ'},
    {q:'Bad numeric key',opts:['a','b'],answer_index:9},
    {q:'Missing passage',opts:['a','b'],answer_index:0,requires_passage:true},
    {q:'Unknown mode',mode:'unsupported'},
    null,
    {q:42,opts:['a','b'],answer_index:0},
    {q:'Restricted source',opts:['a','b'],answer_index:0,processing_allowed:false}
  ]},'N5','reading');
  assert.equal(tasks.length,8);assert.equal(tasks[0].answer_index,1);
  assert.equal(tasks[1].answer_index,null);
  for(const task of tasks.slice(1)){
    assert.ok(task.unavailable_reason);assert.equal(task.review_status,'unreviewed');
    assert.deepEqual(plain(task.capabilities),{answer:false,hint:false,evaluation:false,processing:false});
  }
  assert.equal(tasks[4].task_id,'short:question:4');
});

test('source-grounded recall appends semantic identities and explicit source answers, not arbitrary gloss alternatives',()=>{
  const c=context(),item={id:'vocab',language:'en',items:[{id:'word:meet',jp:'会う',reading:'あう',vi:'to meet'}],drills:[{q:'会う — source meaning?',opts:['to meet','blue'],answer_index:0,item_id:'word:meet'}]};
  const tasks=c.lessonQuestions(item,'N5','vocabulary');
  assert.equal(tasks.length,2);
  const recall=tasks[1];assert.equal(recall.mode,'recall');assert.equal(recall.answer_index,null);
  assert.deepEqual(plain(recall.opts),[]);assert.deepEqual(plain(recall.accepted_answers),['あう']);
  assert.equal(recall.task_id,'vocab:question:recall:reading:word:meet');
  assert.equal(recall.item_id,'vocab:recall:reading:word:meet');assert.equal(recall.source_position,1);
  assert.equal(recall.source_language,'en');assert.equal(recall.review_status,'unreviewed');
  const grammar=c.lessonQuestions({id:'grammar',title:'〜てください',formula:'Vて + ください'},'N5','grammar');
  assert.equal(grammar.length,1);assert.equal(grammar[0].task_id,'grammar:question:recall:formation');
  assert.deepEqual(plain(grammar[0].accepted_answers),['Vて + ください']);
});

test('dictation and writing have dedicated canonical tasks with reveal-only source responses',async()=>{
  const c=context();await c.loadPracticalCourse();await c.ensureLessons('N5');c.createStudyPlan('N5');
  const skills=c.window.JLPT_DATA.curriculum.N5.skills;
  const listening=skills.listening.find(item=>item.dictation),tasks=c.lessonQuestions(listening,'N5','listening');
  assert.equal(tasks.length,listening.examples.length);
  for(const [i,task] of tasks.entries()){
    assert.equal(task.mode,'dictation');assert.equal(task.item_id,`${listening.id}:${i}`);
    assert.deepEqual(plain(task.accepted_answers),[listening.examples[i].jp]);assert.deepEqual(plain(task.example_indexes),[i]);
    assert.equal(task.script_jp,'');assert.equal(task.passage,'');assert.equal(task.q.includes(listening.examples[i].jp),false);
    assert.equal(task.answer_index,null);assert.equal(task.review_status,'unreviewed');
  }
  const production=skills.production.find(item=>item.id==='practical:v1:N5:introductions:production');
  const writing=c.lessonQuestions(production,'N5','production');assert.equal(writing.length,1);
  assert.equal(writing[0].mode,'writing');assert.equal(writing[0].q,production.production.prompt);
  assert.equal(writing[0].item_id,production.id);assert.equal(writing[0].model,production.production.model);
  assert.deepEqual(plain(writing[0].criteria),plain(production.production.criteria));
  assert.deepEqual(plain(writing[0].accepted_answers),[]);assert.equal(writing[0].answer_index,null);
  assert.deepEqual(plain(c.lessonProgressIds(production,'N5','production')),[production.id]);
});

test('original quiz contradictions are tombstones while N1 duplicate parts stay separately addressable',async()=>{
  const c=context();await c.loadPracticalCourse();const blocked=[];
  for(const level of ['N5','N4','N3','N2','N1']){
    await c.ensureLessons(level);
    for(const item of c.featureLessons('quiz',level)){
      const raw=c.window.JLPT_DATA.exams[level][item.examIndex].questions;
      const tasks=c.lessonQuestions(item,level,'quiz');
      assert.equal(tasks.length,raw.length);assert.equal(item.examples.length,0);
      for(const [i,task] of tasks.entries()){
        assert.equal(task.source_position,i);assert.deepEqual(plain(task.opts),plain(raw[i].options));
        assert.equal(task.answer_index,raw[i].answer);assert.equal(task.passage,raw[i].passage || '');
        if(task.review_status==='quarantined'){
          blocked.push(task.source_identity);assert.equal(i,2);assert.ok(task.unavailable_reason);
          assert.deepEqual(plain(task.capabilities),{answer:false,hint:false,evaluation:false,processing:false});
        }
      }
    }
  }
  assert.deepEqual(blocked.sort(),['N4:1:3','N3:1:3','N3:2:3','N2:1:3','N2:2:3'].sort());
  const n1=c.featureLessons('quiz','N1').find(item=>item.id==='quiz-lesson:N1:2').drills[2];
  assert.deepEqual(plain(n1.opts),['何で','あれ','どうで','あれ']);
  assert.deepEqual(plain(n1.parts),['1. 何で','2. あれ','3: どうで','4. あれ']);
  assert.equal(n1.answer_index,2);assert.equal(n1.review_status,'unreviewed');assert.equal(n1.unavailable_reason,'');
  const n3=c.featureLessons('quiz','N3').find(item=>item.id==='quiz-lesson:N3:1');
  assert.equal(n3.drills.length,4);assert.equal(n3.drills[0].target,'提出');
  assert.equal(n3.drills[0].skill,'kanji');assert.equal(n3.drills[3].skill,'reading');
  assert.equal(n3.drills[3].q.includes(n3.drills[3].passage),false);
});

test('ordinary situation tasks retain dialogue without guessing answer-linked example associations',async()=>{
  const c=context();await c.loadPracticalCourse();await c.ensureLessons('N5');
  const unit=c.createStudyPlan('N5').find(unit=>unit.id==='practical:v1:N5:introductions');
  const lesson=unit.steps.find(step=>step.skill==='reading').lesson;
  const task=c.lessonQuestions(lesson,'N5','reading')[0];
  assert.equal(task.q,'An làm nghề gì?');assert.equal(task.passage,unit.dialogue.map(line=>line.jp).join('\n'));
  assert.deepEqual(plain(task.example_indexes),[]);assert.equal(task.explanation,'An phủ định 学生 và nói 会社員です.');
});

test('revision serialization is exactly task-v1 fixed-order JSON and changes with every bound evidence field',()=>{
  const c=context(),task=c.lessonQuestions({id:'revision',drills:[{q:'Q',opts:['a','a'],answer_index:1,item_id:'progress'}]},'N1','grammar')[0];
  const expected=['task-v1',task.task_id,task.item_id,task.mode,task.q,'','','','',[],['a','a'],1,[],'','unreviewed','',[],'','grammar','vi'];
  assert.equal(c.taskRevisionSource(task),JSON.stringify(expected));
  for(const [field,value] of Object.entries({task_id:'other',item_id:'other',mode:'recall',q:'Other',instruction:'Instruction',passage:'Passage',script_jp:'Script',target:'Target',parts:['1. Part'],opts:['a','b'],answer_index:0,accepted_answers:['a'],explanation:'Because',review_status:'quarantined',unavailable_reason:'Unavailable',criteria:['New criterion'],model:'New source model',skill:'reading',source_language:'en'}))assert.notEqual(hash(c,{...task,[field]:value}),hash(c,task),field);
  assert.equal(hash(c,{...task,revision:'old',example_indexes:[9]}),hash(c,task),'only the frozen revision fields participate');
});

test('catalog uses the same complete canonical inventory and SHA256 revisions in checks and exams',async()=>{
  const c=context(),catalogs=await buildTeacherCatalog();
  let quarantineCount=0;
  for(const catalog of Object.values(catalogs))for(const lesson of Object.values(catalog.lessons)){
    if(lesson.exam_questions)assert.deepEqual(lesson.exam_questions,lesson.questions);
    for(const [index,task] of lesson.questions.entries()){
      assert.equal(Object.hasOwn(task,'ans'),false);assert.equal(task.source_position,index);
      assert.equal(task.revision,hash(c,task));assert.match(task.revision,/^[a-f0-9]{64}$/);
      assert.ok(Object.hasOwn(catalog.items,task.item_id));
      if(task.review_status==='quarantined')quarantineCount++;
    }
  }
  assert.equal(quarantineCount,5);
  const n3=catalogs.N3.lessons['test:N3:1'];assert.equal(n3.questions.length,4);assert.equal(n3.examples.length,0);
  assert.equal(n3.questions[0].skill,'kanji');assert.equal(n3.questions[3].skill,'reading');
  const writing=catalogs.N5.lessons['practical:v1:N5:introductions:production'].questions;
  assert.equal(writing.length,1);assert.equal(writing[0].mode,'writing');
});

test('committed N5 packages use the existing curriculum and canonical tasks without invented scoring authority',async()=>{
  const c=context(),source=JSON.parse(readFileSync('static/course/n5-teaching.json','utf8'));
  await c.loadPracticalCourse();await c.ensureLessons('N5');
  const units=c.createStudyPlan('N5'),unit=units.find(unit=>unit.id==='n5-teaching:v1'),seen=new Set();
  assert.equal(unit.steps.length,source.lessons.length);
  const catalogs=await buildTeacherCatalog();
  for(const step of unit.steps){
    const authored=source.lessons.find(lesson=>lesson.id===step.lesson.id),tasks=c.lessonQuestions(step.lesson,'N5','grammar'),canonical=catalogs.N5.lessons[authored.id];
    for(const prerequisite of authored.prerequisites)assert.ok(seen.has(prerequisite),prerequisite);
    seen.add(authored.id);assert.equal(tasks.length,authored.tasks.length);
    assert.equal(canonical.authorship,'ai_authored');assert.equal(canonical.review.human_approved,false);
    assert.equal(canonical.eligibility.scored_assessment,false);assert.equal(canonical.eligibility.mastery_credit,false);
    assert.deepEqual(canonical.overview.common_errors,authored.common_errors);
    for(const reference of authored.source_refs)assert.ok(canonical.sources.some(source=>source.id===reference.chunk_id && source.role==='background_reference_not_approval'));
    for(const [index,task] of tasks.entries()){
      const original=authored.tasks[index];
      assert.equal(task.task_id,original.id);assert.equal(task.item_id,original.id);assert.equal(task.source_position,index);
      assert.equal(task.explanation,original.rationale);assert.equal(task.review_status,'unreviewed');assert.equal(task.unavailable_reason,'');
      assert.equal(canonical.questions[index].revision,hash(c,task));
      if(original.mode==='choice'){
        assert.deepEqual(plain(task.opts),original.options.map(option=>option.text));
        assert.equal(original.options[task.answer_index].id,original.answer_option_id);
      }else{
        assert.equal(task.mode,'recall');assert.equal(task.answer_index,null);
        assert.deepEqual(plain(task.accepted_answers),original.accepted_variants);
      }
    }
  }
  assert.equal(seen.size,20);
});

test('curriculum attempted coverage requires a current revision and never becomes manual completion or verified mastery',()=>{
  const c=context(),step={ids:['task:one','task:two']},revisions=new Map([['one','current'],['two','current']]);
  const evidence=[{task_id:'one',item_id:'task:one',revision:'current',validity:'valid',answered_at:'now'},
    {task_id:'one',item_id:'task:one',revision:'current',validity:'valid',answered_at:'later'},
    {task_id:'two',item_id:'task:two',revision:'old',validity:'valid',answered_at:'now'}];
  const state=c.studyStepState(step,new Map(),evidence,revisions);
  assert.equal(state.submitted,1);assert.equal(state.complete,false);assert.equal(state.reviewed,0);
  assert.equal(c.studyStepState(step,new Map(),evidence).submitted,0);
});
