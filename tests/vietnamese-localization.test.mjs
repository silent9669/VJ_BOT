import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';
import {groundLesson,referenceProcessingAllowed} from '../src/tutor-context.js';

const levels=['N5','N4','N3','N2','N1'];
const json=path=>JSON.parse(readFileSync(`static/${path}`,'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
function browser(intercept){
  const c=vm.createContext({window:{},fetch:async path=>intercept?.(path) || {ok:true,json:async()=>json(path)}});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js','workspace.js','completion.js'])vm.runInContext(readFileSync(`static/${file}`,'utf8'),c);
  return c;
}
let shared;
function inventory(){
  return shared ||= (async()=>{const c=browser();await c.loadPracticalCourse();for(const level of levels){await c.ensureLessons(level);c.createStudyPlan(level);}return {c,catalogs:await buildTeacherCatalog()};})();
}
// Preserve the FIRST original record for a repeated source gloss, not the last.
const firstUnique=rows=>{const seen=new Set();return rows.filter(row=>!seen.has(row.source_gloss) && seen.add(row.source_gloss));};
function expectedChoices(answer,choices,index,vocabulary=false){
  const wrong=firstUnique(choices).filter(choice=>choice.source_gloss!==answer.source_gloss && choice.source_gloss);
  const offset=vocabulary?index:index%Math.max(1,wrong.length-2);
  const options=wrong.slice(offset,offset+3);
  options.splice(vocabulary?index%4:index%(options.length+1),0,answer);
  return options;
}

test('existing grammar translations and source resource identity survive shared title projection',async()=>{
  const {c,catalogs}=await inventory(),dict=await c.loadViDict(),grammar=json('course/vi-grammar.json');
  assert.equal(Object.keys(grammar).length,807);
  for(const [key,value] of Object.entries(grammar))assert.equal(dict[key],value);
  for(const file of ['sources','erin-resources'])for(const source of json(`course/${file}.json`).lessons){
    const before=plain(source),shown=plain(c.viResource(source,dict));
    assert.deepEqual(source,before);assert.equal(shown.sourceTitle,source.title);assert.equal(shown.title,dict[source.title] || source.title);
    assert.deepEqual({...shown,title:source.title,sourceTitle:undefined},{...source,sourceTitle:undefined});
    assert.deepEqual(plain(c.viResource(shown,dict)),shown);
  }
  const units=c.createStudyPlan('N5'),lesson=units.find(unit=>unit.id==='practical:v1:N5:introductions').steps.find(step=>step.skill==='reading').lesson;
  for(const resource of lesson.resources){
    assert.ok(resource.sourceTitle);assert.equal(resource.title,dict[resource.sourceTitle] || resource.sourceTitle);
    const canonical=catalogs.N5.lessons[lesson.id].sources.find(source=>source.id===resource.id);
    assert.deepEqual(canonical,plain(resource));
  }
});

test('Japanese-bound polysemy reaches references and the original generated answer slot',async()=>{
  const {c,catalogs}=await inventory();
  const cases=[['N2','kanji','党',/đảng/,/bữa tiệc|buổi liên hoan/],['N3','kanji','連',/dẫn/,/chì|bữa tiệc/],['N5','kanji','中',/giữa/,/hèn hạ|có nghĩa là/],['N4','kanji','明',/sáng/,/nhẹ|dễ/],['N5','vocabulary','軽い',/nhẹ/,/ánh sáng/],['N5','vocabulary','パーティー',/tiệc|liên hoan/,/đảng/]];
  for(const [level,skill,jp,yes,no] of cases){
    const lesson=c.window.JLPT_DATA.curriculum[level].skills[skill].find(lesson=>lesson.source==='OpenJLPT' && lesson.items?.some(word=>word.jp===jp));
    const index=lesson.items.findIndex(word=>word.jp===jp),word=lesson.items[index],task=c.lessonQuestions(lesson,level,skill)[index];
    assert.match(word.vi,yes);assert.doesNotMatch(word.vi,no);assert.equal(task.opts[task.answer_index],word.vi);
    assert.equal(task.option_sources[task.answer_index],word.id);
    const canonical=catalogs[level].lessons[lesson.id];assert.equal(canonical.words[index].vi,word.vi);assert.deepEqual(canonical.questions[index].opts,plain(task.opts));
    assert.ok(word.localization.some(entry=>entry.disposition==='contextual'));assert.equal(task.review_status,'unreviewed');
  }
});

test('all generated candidates retain original gloss identity, order and numeric keys before localization',async()=>{
  const {c}=await inventory();
  for(const level of levels){
    const skills=c.window.JLPT_DATA.curriculum[level].skills;
    for(const [kind,skill] of [['vocab','vocabulary'],['kanji','kanji']]){
      const raw=json(`openjlpt/${kind}-${level.toLowerCase()}.json`),choices=raw.map(row=>({id:`openjlpt:${level}:${skill}:${row.id || row.character}`,source_gloss:row.meanings.join('; ')}));
      const lessons=skills[skill].filter(lesson=>lesson.source==='OpenJLPT');
      assert.deepEqual(plain(lessons.flatMap(lesson=>lesson.items.map(word=>word.id))),choices.map(choice=>choice.id));
      for(const lesson of lessons)for(const [index,drill] of lesson.drills.entries()){
        const answer=choices.find(choice=>choice.id===drill.item_id),expected=expectedChoices(answer,choices,index,kind==='vocab');
        assert.deepEqual(plain(drill.option_sources),expected.map(choice=>choice.id));
        assert.equal(drill.answer_index,expected.indexOf(answer));
        if(new Set(drill.opts.map(text=>text.normalize('NFKC').trim().toLocaleLowerCase())).size!==drill.opts.length)assert.equal(drill.processing_allowed,false);
      }
    }
    const rawGrammar=json(`openjlpt/grammar-${level.toLowerCase()}.json`),grammar=rawGrammar.map(row=>({id:`openjlpt:${level}:grammar:${row.id}`,source_gloss:row.meaning}));
    for(const [index,lesson] of skills.grammar.filter(lesson=>lesson.source==='OpenJLPT').entries()){
      const expected=expectedChoices(grammar[index],grammar,index+1),drill=lesson.drills[0];
      assert.deepEqual(plain(drill.option_sources),expected.map(choice=>choice.id));assert.equal(drill.answer_index,expected.indexOf(grammar[index]));
    }
    for(const lesson of skills.reading.filter(lesson=>lesson.source==='OpenJLPT'))for(const [index,drill]of lesson.drills.entries()){
      const expected=expectedChoices(lesson.examples[index],lesson.examples,index);
      assert.deepEqual(plain(drill.option_sources),plain(expected.map(example=>example.id)));assert.equal(drill.answer_index,expected.indexOf(lesson.examples[index]));
    }
  }
});

test('every bound contradiction gates references and meaning tasks but retains valid Japanese reading and dictation',async()=>{
  const {c,catalogs}=await inventory(),entries=json('course/vi-context.json').entries.filter(entry=>entry.disposition==='unavailable');
  for(const entry of entries){
    const [,level,kind]=entry.source_identity.split(':'),lessons=c.window.JLPT_DATA.curriculum[level].skills[kind];
    const lesson=lessons.find(lesson=>lesson.items?.some(word=>word.id===entry.source_identity));
    const word=lesson.items.find(word=>word.id===entry.source_identity),canonical=catalogs[level].lessons[lesson.id];
    if(entry.field.startsWith('meanings')){
      assert.equal(word.processing_allowed,false);assert.equal(referenceProcessingAllowed(canonical.words.find(word=>word.id===entry.source_identity)),false);
      const task=c.lessonQuestions(lesson,level,kind).find(task=>task.source_identity===entry.source_identity && task.mode==='choice');
      assert.ok(task.unavailable_reason);assert.equal(task.capabilities.processing,false);
      if(kind==='vocabulary'){
        const recall=c.lessonQuestions(lesson,level,kind).find(task=>task.source_identity===entry.source_identity && task.mode==='recall');
        assert.equal(recall.capabilities.processing,true);assert.deepEqual(plain(recall.accepted_answers),[word.reading || word.ro]);
        assert.equal(groundLesson(canonical,{kind:'question',index:canonical.questions.findIndex(task=>task.task_id===recall.task_id)})?.focus.item.mode,'recall');
      }
    }else{
      const example=word.examples.find(example=>example.localization?.some(value=>value.field===entry.field));
      assert.equal(example.jp,entry.japanese);assert.equal(example.source_gloss,entry.english);assert.equal(example.processing_allowed,false);
      assert.equal(referenceProcessingAllowed(canonical.words.find(word=>word.id===entry.source_identity)),false);
      const sameSentence=value=>value.jp===example.jp && value.source_gloss===example.source_gloss;
      const reading=c.window.JLPT_DATA.curriculum[level].skills.reading.find(lesson=>lesson.examples?.some(sameSentence));
      assert.ok(reading,'original sentence deduplication retains the affected Japanese/English pair');
      const position=reading.examples.findIndex(sameSentence),task=c.lessonQuestions(reading,level,'reading')[position];
      assert.equal(task.capabilities.processing,false);assert.ok(task.unavailable_reason);
      const readingCanonical=catalogs[level].lessons[reading.id];assert.equal(groundLesson(readingCanonical,{kind:'example',index:position}),null);
      const listening=c.window.JLPT_DATA.curriculum[level].skills.listening.find(lesson=>lesson.dictation && lesson.examples.some(sameSentence));
      const listeningPosition=listening.examples.findIndex(sameSentence),dictation=c.lessonQuestions(listening,level,'listening')[listeningPosition];
      assert.equal(dictation.capabilities.processing,true);assert.deepEqual(plain(dictation.accepted_answers),[entry.japanese]);
    }
    assert.ok(entry.why);assert.ok(word.localization?.every(value=>value.disposition==='unavailable') ?? true);
  }
});

test('translated collisions are unavailable without removing options, shuffling a substitute or changing the key',()=>{
  const c=browser(),answer={id:'a',source_gloss:'first',vi:'cùng nghĩa'},wrong={id:'b',source_gloss:'second',vi:'cùng nghĩa'};
  const task=c.localizedChoice('Q',answer,[wrong],1,'a');
  assert.deepEqual(plain(task.opts),['cùng nghĩa','cùng nghĩa']);assert.equal(task.answer_index,1);
  assert.deepEqual(plain(task.option_sources),['b','a']);assert.ok(task.unavailable_reason);
  assert.equal(c.lessonQuestions({id:'collision',drills:[task]},'N5','vocabulary')[0].capabilities.processing,false);
});

test('missing, malformed or partial context fails closed and a deliberate retry reloads it before any lesson mutation',async()=>{
  for(const failure of ['missing','malformed','partial','wrong-field','wrong-valid-field']){
    let fail=true,requests=0;
    const c=browser(path=>{
      if(path!=='course/vi-context.json')return null;
      requests++;if(!fail)return null;if(failure==='missing')return {ok:false};
      const source=json(path),changed=source.entries.find(entry=>entry.field.startsWith('examples['));
      if(failure==='wrong-field')changed.field=changed.field.replace('.en','.english');
      if(failure==='wrong-valid-field')changed.field=changed.field.replace('[0]','[999]').replace('[1]','[998]');
      return {ok:true,json:async()=>failure==='malformed'?{version:0,entries:[]}:failure==='partial'?{...source,entries:source.entries.slice(1)}:source};
    });
    const skills=c.window.JLPT_DATA.curriculum.N5.skills,before=skills.vocabulary.length;
    await assert.rejects(c.ensureLessons('N5'));assert.equal(skills.vocabulary.length,before);
    fail=false;await c.ensureLessons('N5');assert.equal(requests,2);assert.ok(skills.vocabulary.length>before);
  }
});

test('changed source bindings cannot inherit a contextual approval or a known-bad translation',async()=>{
  const c=browser(),dict=await c.loadViDict(),context=await c.loadViContext(),entry=json('course/vi-context.json').entries[0];
  const result=c.viText({source_identity:entry.source_identity,field:entry.field,japanese:entry.japanese,english:entry.english+' changed'},dict,context);
  assert.equal(result.processing_allowed,false);assert.equal(result.localization.disposition,'unavailable');
  assert.notEqual(result.text,entry.text);
});

test('dictionary loading recovers from a failed fetch without caching empty Vietnamese support',async()=>{
  let fail=true,requests=0;
  const c=browser(path=>{if(path!=='course/vi-dict.json')return null;requests++;return fail?{ok:false}:null;});
  await assert.rejects(c.loadViDict());fail=false;const dict=await c.loadViDict();assert.equal(requests,2);assert.ok(Object.keys(dict).length>28000);
});

test('compact catalogs fit asset and reference limits without dropping any addressable source slots',async()=>{
  const {c,catalogs}=await inventory();
  for(const [level,catalog]of Object.entries(catalogs)){
    assert.ok(Buffer.byteLength(JSON.stringify(catalog))<25*1024*1024,`${level} exceeds the asset limit`);
    for(const lesson of Object.values(catalog.lessons)){
      assert.ok(lesson.words.every(word=>!Object.hasOwn(word,'source_gloss')));
      assert.ok(lesson.examples.every(example=>!Object.hasOwn(example,'source_gloss')));
      assert.ok(JSON.stringify({...lesson,questions:undefined,words:undefined,examples:undefined,exam_questions:undefined}).length<48000);
      for(const [kind,values]of [['word',lesson.words],['example',lesson.examples],['question',lesson.questions]]){
        for(const [index,value]of values.entries()){
          const context=groundLesson(lesson,{kind,index});
          if(context)assert.ok(JSON.stringify(context).length<=48000);
          if(kind==='question'){
            assert.ok(Array.isArray(value.opts));assert.equal(typeof value.q,'string');
            assert.ok(!value.capabilities || Object.values(value.capabilities).some(flag=>flag===false));
            assert.equal(value.revision,createHash('sha256').update(c.taskRevisionSource(value)).digest('hex'));
          }
        }
      }
    }
  }
});
