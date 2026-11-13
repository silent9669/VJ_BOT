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
  const c=vm.createContext({signedInUser:{name:'QA'},setupWorkspace:noop,sessionStorage:{getItem:()=>null},initLoadingScreen:noop,initAnatomyTypewriter:noop,mascotMgr:{updateAllSpriteElements:noop},setupAccount:async()=>{},setupEventListeners:noop,setupFloatingSensei:noop,setupSettings:noop,loadGreeting:noop,loadProgress:noop,loadChatHistory:()=>new Promise(resolve=>{finishHistory=resolve;}),renderBubble:noop,userId:'qa',location:{hash:'#curriculum'},history:{},document:{getElementById:()=>({})},window:{addEventListener:(type,fn)=>listeners.set(type,fn)},restoreAppRoute:()=>{restored++;},apiFetch:async path=>path.startsWith('/api/profile')?{ok:true,json:async()=>({level:'N5'})}:new Promise(resolve=>{finishHistory=resolve;})});
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
test('official workbook lessons keep documents, audio and answers within their year and level',async()=>{
  const c=await navigation();
  c.jlptResources=JSON.parse(await fs.readFile('static/course/jlpt-resources.json','utf8'));
  for(const year of ['2012','2018'])for(const level of ['N5','N4','N3','N2','N1'])for(const type of ['V','G','R','L']){
    const lesson=c.officialResourceLesson(level,type,year);
    assert.equal(lesson.id,`jlpt:${year}:${level}:${type}`);
    assert.ok(lesson.externalResources.some(r=>r.id.endsWith(':answer')));
    assert.ok(lesson.externalResources.every(r=>r.year===year && r.level===level && r.url.includes(`/sample${year}/`)));
    if(type==='L')assert.ok(lesson.externalResources.some(r=>r.kind==='audio'));
  }
  assert.equal(c.officialResourceLesson('N5','V').id,'jlpt:2018:N5:V');
  assert.equal(c.officialResourceLesson('N5','V','2099'),null);
});
test('reloading a 2012 resource route restores that workbook instead of the 2018 default',async()=>{
  const c=await navigation();let opened;
  c.jlptResources=JSON.parse(await fs.readFile('static/course/jlpt-resources.json','utf8'));
  c.location={hash:'#curriculum/N3/lesson/listening/jlpt%3A2012%3AN3%3AL'};
  c.document={getElementById:()=>({})};c.switchTab=()=>true;c.ensureLessons=async()=>{};c.loadPracticalCourse=async()=>{};
  c.createStudyPlan=()=>[];c.window={JLPT_DATA:{curriculum:{N3:{skills:{listening:[]}}}}};
  c.showLessonDetail=lesson=>{opened=lesson;};
  await c.restoreAppRoute();assert.equal(opened.id,'jlpt:2012:N3:L');
});

test('settings areas have stable routes and browser back can restore each view',async()=>{
  const c=await navigation();
  for(const view of ['account','api','admin','sound','data']){
    const route=c.parseAppRoute(c.appRouteHash('settings',{view}));assert.equal(route.tab,'settings');assert.equal(route.view,view);
  }
  assert.equal(c.parseAppRoute('#settings/missing').view,'account');
});
