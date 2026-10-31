import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
async function navigation(){
  const context=vm.createContext({authorizePage:()=>true,TAB_TITLES:{landing:'Home',curriculum:'Courses',lesson:'Lesson',quiz:'Quiz',classroom:'Teacher'}});
  vm.runInContext(await fs.readFile('static/navigation.js','utf8'),context);
  return context;
}
test('course, library and lesson routes preserve level, skill and original identity',async()=>{
  const c=await navigation();
  for(const level of ['N5','N4','N3','N2','N1']){
    const course=c.parseAppRoute(c.appRouteHash('curriculum',{level}));assert.equal(course.level,level);assert.equal(course.view,'plan');
    const library=c.parseAppRoute(c.appRouteHash('curriculum',{level,view:'library',skill:'reading'}));assert.equal(library.skill,'reading');assert.equal(library.view,'library');
    for(const id of ['openjlpt:'+level+':grammar:1','kana:Hiragana:あ/い','erin:01']){
      const route=c.parseAppRoute(c.appRouteHash('lesson',{level,skill:'reading',id}));
      assert.equal(route.tab,'lesson');assert.equal(route.id,id);assert.equal(route.level,level);assert.equal(route.skill,'reading');
    }
  }
});
test('invalid routes fall back without opening an arbitrary level or throwing',async()=>{
  const c=await navigation();
  assert.equal(c.parseAppRoute('#curriculum').level,undefined);
  for(const hash of ['#curriculum/N9','#curriculum/__proto__'])assert.equal(c.parseAppRoute(hash).level,undefined);
  for(const hash of ['#%E0%A4','#constructor','#lesson','#missing'])assert.equal(c.parseAppRoute(hash).tab,'landing');
  assert.equal(c.parseAppRoute('#quiz').tab,'quiz');
  assert.equal(c.parseAppRoute('#curriculum/N2/lesson/nope/id').tab,'curriculum');
});
test('returning from writing opens the course plan with a valid library skill',async()=>{
  const c=await navigation();let destination;
  c.switchTab=(tab,route)=>destination={tab,...route};
  vm.runInContext("currentLesson={level:'N2',skill:'production',returnView:'plan'}",c);
  c.returnToCourse();assert.equal(destination.tab,'curriculum');assert.equal(destination.level,'N2');assert.equal(destination.skill,'grammar');assert.equal(destination.view,'plan');
  vm.runInContext("currentLesson={level:'N4',skill:'listening',returnView:'library'}",c);
  c.returnToCourse();assert.equal(destination.skill,'listening');assert.equal(destination.view,'library');
});
test('navigating away while a lesson loads cannot reopen the old lesson',async()=>{
  const c=await navigation();let finish,opened=false;
  c.location={hash:'#curriculum/N3/lesson/grammar/example'};
  c.document={getElementById:()=>({textContent:''})};
  c.switchTab=()=>vm.runInContext('navigationVersion++',c);
  c.ensureLessons=()=>new Promise(resolve=>{finish=resolve;});
  c.loadPracticalCourse=async()=>{};
  c.createStudyPlan=()=>{opened=true;return [];};
  const pending=c.restoreAppRoute();
  c.switchTab('landing');finish();await pending;
  assert.equal(opened,false);
});
test('browser navigation is ready even while chat history is still loading',async()=>{
  const source=await fs.readFile('static/app.js','utf8');
  const init=source.slice(source.indexOf('(async function init() {'),source.indexOf('\nif (typeof window !== "undefined")'));
  const listeners=new Map();let finishHistory,restored=0;
  const noop=()=>{};
  const c=vm.createContext({signedInUser:{name:'QA'},setupWorkspace:noop,sessionStorage:{getItem:()=>null},initLoadingScreen:noop,initJlptCountdown:noop,initAnatomyTypewriter:noop,mascotMgr:{updateAllSpriteElements:noop},setupAccount:async()=>{},setupEventListeners:noop,setupFloatingSensei:noop,setupSettings:noop,loadGreeting:noop,loadProgress:noop,renderBubble:noop,userId:'qa',location:{hash:'#curriculum'},history:{},document:{getElementById:()=>({})},window:{addEventListener:(type,fn)=>listeners.set(type,fn)},restoreAppRoute:()=>{restored++;},apiFetch:async path=>path.startsWith('/api/profile')?{ok:true,json:async()=>({level:'N5'})}:new Promise(resolve=>{finishHistory=resolve;})});
  const pending=vm.runInContext(init,c);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(finishHistory,'history request started but has not finished');
  assert.equal(typeof listeners.get('hashchange'),'function');
  listeners.get('hashchange')();assert.equal(restored,2);
  finishHistory({ok:true,json:async()=>[]});await pending;
});
test('cancelled lesson history navigation stops before loading or changing lesson state',async()=>{
  const c=await navigation();let checks=0,loaded=false;
  c.location={hash:'#curriculum/N3/lesson/grammar/example'};c.switchTab=()=>{checks++;return false;};
  c.ensureLessons=()=>{loaded=true;};
  c.document={getElementById(){throw new Error('cancelled route mutated the page');}};
  await c.restoreAppRoute();assert.equal(checks,1);assert.equal(loaded,false);
});
