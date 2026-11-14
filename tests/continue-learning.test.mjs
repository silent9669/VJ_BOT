import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Real curriculum builders and dashboard; only browser DOM, storage and API I/O are replaced.
async function page({storage = new Map(), owner = 'learner:a', level = 'N4', blocked = false, completions = new Map()} = {}) {
  const nodes = new Map();
  const node = () => ({textContent:'',innerHTML:'',hidden:false,dataset:{},
    classList:{add(){}},parentElement:{append(){}},replaceChildren(){},append(){},addEventListener(){},focus(){},
    setAttribute(){},querySelector(){return node();},querySelectorAll(){return []}});
  const document = {getElementById(id) {if (!nodes.has(id)) nodes.set(id,node());return nodes.get(id);},createElement:node};
  const c = vm.createContext({document,window:{},signedInUser:{user_id:owner,name:owner},activeCurriculumLevel:level,
    TAB_TITLES:{dashboard:'Học tập',landing:'VJBot'},
    localStorage:{getItem(key){if(blocked)throw Error('blocked');return storage.get(key)??null;},
      setItem(key,value){if(blocked)throw Error('blocked');storage.set(key,value);}},
    fetch:async path => ({ok:true,json:async()=>JSON.parse(readFileSync('static/'+path,'utf8'))}),
    apiFetch:async()=>({ok:true,json:async()=>({items:[],streak_days:0})})});
  for(const file of ['jlpt-data.js','vi-labels.js','learning.js','lesson-checks.js','study-plan.js','navigation.js','completion.js','workspace.js'])
    vm.runInContext(readFileSync('static/'+file,'utf8'),c);
  c.loadCompletions=async()=>completions;
  await c.ensureLessons(level);await c.loadPracticalCourse();c.createStudyPlan(level);
  return {c,storage,nodes,completions};
}
const lesson = (p,id) => vm.runInContext(`window.JLPT_DATA.curriculum.N4.skills.grammar.find(item=>item.id===${JSON.stringify(id)})`,p.c);
const remember = (p,item,owner=null) => {
  // Allows RED to expose the old visible dashboard behavior rather than a missing-symbol error.
  if(typeof p.c.rememberLearningLesson==='function')p.c.rememberLearningLesson(item,'N4','grammar',owner);
};
async function nextCard(p) {
  await p.c.renderDashboard();
  const html=p.nodes.get('dashboard-content').innerHTML;
  const card=html.match(/<a class="dashboard-next" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(card,'dashboard renders a Continue learning link');
  const decode=text=>text?.replace(/&(?:amp|lt|gt|quot|#39);/g,value=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[value]));
  return {href:decode(card[1]),title:decode(card[2].match(/<h2>(.*?)<\/h2>/s)?.[1])};
}

test('Continue learning resumes 〜てもらう, not the first incomplete N4 lesson',async()=>{
  const p=await page();remember(p,lesson(p,'openjlpt:N4:grammar:te-morau'));
  assert.deepEqual(await nextCard(p),{href:'#curriculum/N4/lesson/grammar/openjlpt%3AN4%3Agrammar%3Ate-morau',title:'〜てもらう'});
});

test('last-opened lesson survives reload and its display title comes from the canonical catalog',async()=>{
  const p=await page();remember(p,{...lesson(p,'openjlpt:N4:grammar:te-morau'),title:'Client title must not be trusted'});
  const reloaded=await page({storage:p.storage});
  assert.equal((await nextCard(reloaded)).title,'〜てもらう');
  assert.ok(![...p.storage.values()].some(value=>value.includes('Client title')),'store a reference, not copied lesson text');
});

test('opening another lesson replaces the resume target; accounts and levels remain isolated',async()=>{
  const p=await page();remember(p,lesson(p,'openjlpt:N4:grammar:te-morau'));remember(p,lesson(p,'openjlpt:N4:grammar:te-kureru'));
  assert.equal((await nextCard(p)).title,'〜てくれる');
  const other=await page({storage:p.storage,owner:'learner:b'});
  assert.equal((await nextCard(other)).title,'Báo trễ có lý do và phương án tiếp theo');
  const n5=await page({storage:p.storage,level:'N5'});
  assert.equal((await nextCard(n5)).title,'Nêu chủ đề bằng は');
});

test('completed resume target advances to the next unfinished lesson without marking previous lessons complete',async()=>{
  const p=await page();remember(p,lesson(p,'openjlpt:N4:grammar:te-morau'));
  p.completions.set('openjlpt:N4:grammar:te-morau',{});
  assert.equal((await nextCard(p)).title,'〜てくれませんか / 〜ていただけませんか');
  assert.equal(p.completions.has('openjlpt:N4:grammar:ageru-kureru-morau'),false);
});

test('removed, malformed and external resume targets fall back to canonical curriculum links',async()=>{
  const p=await page();remember(p,lesson(p,'openjlpt:N4:grammar:te-morau'));
  const key=[...p.storage.keys()][0];assert.ok(key,'resume is saved');
  for(const value of ['not-json','null',JSON.stringify({id:'missing',skill:'grammar',owner:null}),
    JSON.stringify({id:'https://evil.example/',skill:'grammar',owner:null}),JSON.stringify({id:'openjlpt:N4:grammar:te-morau',skill:'fake',owner:null})]) {
    p.storage.set(key,value);
    const reloaded=await page({storage:p.storage});
    assert.equal((await nextCard(reloaded)).title,'Báo trễ có lý do và phương án tiếp theo');
  }
});

test('unavailable browser storage cannot break lesson opening or dashboard fallback',async()=>{
  const p=await page({blocked:true});
  assert.doesNotThrow(()=>remember(p,lesson(p,'openjlpt:N4:grammar:te-morau')));
  assert.ok((await nextCard(p)).href.startsWith('#curriculum/N4/lesson/grammar/'));
});

test('feature lessons resume their feature route and canonical completion identity',async()=>{
  const p=await page();const item=p.c.featureLessons('flashcards','N4')[0];
  if(typeof p.c.rememberLearningLesson==='function')p.c.rememberLearningLesson(item,'N4','vocabulary','flashcards');
  const card=await nextCard(p);
  assert.equal(card.href,'#flashcards/N4/lesson/'+encodeURIComponent(item.id));
  assert.equal(card.title,item.title);
});

test('the real lesson-opening flow records the selected lesson only after successful rendering',async()=>{
  const p=await page();
  const app=readFileSync('static/app.js','utf8');
  const fn=app.slice(app.indexOf('function grammarFormulaHtml('),app.indexOf('// 10. FLASHCARDS CONTROLLER'));
  Object.assign(p.c,{curriculumView:'plan',switchTab:()=>true,renderLessonExercises(){},lessonQuestions:()=>[],
    mountCompletion(){},addFeatureLessonAction(){},renderLessonOutline(){},returnToCourse(){},openStudyStep(){}});
  vm.runInContext(fn,p.c);
  const item={...lesson(p,'openjlpt:N4:grammar:te-morau'),examples:[]};
  p.c.showLessonDetail(item,'N4','grammar');
  assert.equal((await nextCard(p)).title,'〜てもらう');
  p.c.switchTab=()=>false;
  p.c.showLessonDetail(lesson(p,'openjlpt:N4:grammar:te-kureru'),'N4','grammar');
  assert.equal((await nextCard(p)).title,'〜てもらう');
});

test('a dashboard request cannot paint the previous account after sign-in changes while data is loading',async()=>{
  const p=await page();let release;
  p.c.apiFetch=()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({items:[]})});});
  const pending=p.c.renderDashboard();p.c.signedInUser={user_id:'learner:b',name:'B'};release();await pending;
  assert.equal(p.nodes.get('dashboard-content').innerHTML,'');
});
