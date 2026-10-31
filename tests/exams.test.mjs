import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const config=JSON.parse(fs.readFileSync('static/course/exams.json','utf8'));
function engine(){const c=vm.createContext({});vm.runInContext(fs.readFileSync('static/exam-engine.js','utf8'),c);return c;}
test('ten publisher workbooks have current section timings and complete answer keys',()=>{
  const timings={N5:[20,40,30],N4:[25,55,35],N3:[30,70,40],N2:[105,50],N1:[110,55]};
  const totals={'2012:N5':[33,32,24],'2012:N4':[34,35,28],'2012:N3':[33,39,27],'2012:N2':[75,31],'2012:N1':[69,36],'2018:N5':[35,32,24],'2018:N4':[35,35,28],'2018:N3':[35,39,28],'2018:N2':[75,32],'2018:N1':[70,37]};
  assert.equal(config.papers.length,10);assert.equal(new Set(config.papers.map(p=>p.level+p.year)).size,10);
  for(const paper of config.papers){
    assert.deepEqual(paper.sections.map(s=>s.minutes),timings[paper.level]);
    assert.deepEqual(paper.sections.map(s=>s.groups.reduce((n,g)=>n+g.answers.length,0)),totals[paper.year+':'+paper.level]);
    for(const section of paper.sections){for(const url of [...section.documents.map(d=>d.url),...section.audio])assert.equal(new URL(url).hostname,'www.jlpt.jp');for(const group of section.groups)assert.ok(group.answers.every(a=>[1,2,3,4].includes(a)));}
  }
});
test('raw exam scoring counts blanks as unanswered and never creates a scaled JLPT score',()=>{
  const c=engine(),paper=config.papers.find(p=>p.level==='N5'&&p.year==='2018'),state=c.freshSimulation(paper);
  const first=c.sectionQuestions(paper.sections[0])[0];state.answers[0][0]=first.answer;state.answers[0][1]=3;
  const score=c.examRawScore(paper,state.answers);assert.equal(score[0].answered,2);assert.equal(score[0].correct,1);assert.equal(score[0].total,35);assert.equal(score[1].answered,0);
});
test('feature level routes round trip without falling through to a default level',()=>{
  const c=vm.createContext({TAB_TITLES:{landing:'Home'},authorizePage:()=>true});vm.runInContext(fs.readFileSync('static/navigation.js','utf8'),c);
  for(const tab of ['kaiwa','flashcards','kanji','quiz'])for(const level of ['N5','N4','N3','N2','N1']){const r=c.parseAppRoute(c.appRouteHash(tab,{level}));assert.equal(r.tab,tab);assert.equal(r.level,level);}
  const r=c.parseAppRoute('#quiz/N3/simulation/2018');assert.equal(r.view,'simulation');assert.equal(r.id,'2018');
});
test('private navigation sends guests to login and remembers the intended page',()=>{
  let stored,opened,tab;const c=vm.createContext({signedInUser:null,sessionStorage:{setItem:(_,v)=>stored=v},appRouteHash:()=> '#kanji/N2',history:{replaceState(){}},switchTab:t=>tab=t,openAccount:()=>opened=true});vm.runInContext(fs.readFileSync('static/workspace.js','utf8'),c);
  assert.equal(c.authorizePage('kanji',{level:'N2'}),false);assert.equal(stored,'#kanji/N2');assert.equal(tab,'landing');assert.equal(opened,true);assert.equal(c.authorizePage('landing'),true);
});
test('all levels add ten distinct mixed sets alongside numeric seeded exam IDs',async()=>{
  const c=vm.createContext({window:{},fetch:async path=>({ok:true,json:async()=>JSON.parse(fs.readFileSync('static/'+path,'utf8'))})});
  for(const file of ['jlpt-data.js','learning.js','workspace.js'])vm.runInContext(fs.readFileSync('static/'+file,'utf8'),c);
  for(const level of ['N5','N4','N3','N2','N1']){
    await c.ensureLessons(level);c.addPracticeSets(level);c.addPracticeSets(level);
    const mixed=c.window.JLPT_DATA.exams[level].filter(e=>typeof e.id==='string'&&e.id.startsWith('mixed:'));assert.equal(mixed.length,10);
    const ids=new Set();for(const exam of mixed)for(const q of exam.questions){assert.ok(q.options.length>=2);assert.ok(q.answer>=0);assert.ok(!ids.has(q.id));ids.add(q.id);}
  }
});
test('paper labels preserve continuous written numbering and integrated listening subquestions',()=>{
  const paper=config.papers.find(p=>p.level==='N1'&&p.year==='2018');
  assert.equal(paper.sections[0].groups[1].labels[0],'7');
  assert.deepEqual(paper.sections[1].groups.at(-1).labels,['1','2','3(1)','3(2)']);
  for(const paper of config.papers)for(const section of paper.sections)for(const group of section.groups)assert.equal(group.labels.length,group.answers.length);
});
test('expired or submitted sections reject answers before a delayed timer callback',()=>{
  const c=engine(),attempt={status:'running',section:0,deadline:1000,answers:[[null]]};
  assert.equal(c.chooseSimulationAnswer(attempt,0,2,999),true);assert.equal(c.chooseSimulationAnswer(attempt,0,3,1000),false);assert.equal(attempt.answers[0][0],2);
  attempt.status='break';assert.equal(c.chooseSimulationAnswer(attempt,0,4,500),false);
});
test('a slow section save cannot render a previous paper after navigation',async()=>{
  const paper=config.papers.find(p=>p.level==='N5'&&p.year==='2018');let resolveSave,draws=0;
  const c=vm.createContext({featureVersion:1,Date,clearInterval(){},document:{getElementById:()=>({pause(){},close(){}}),querySelectorAll:()=>[]}});
  vm.runInContext(fs.readFileSync('static/exam-engine.js','utf8'),c);c.paper=paper;
  vm.runInContext("simulationPaper=paper;simulation=freshSimulation(paper);simulation.section=1;simulation.status='running';",c);
  c.saveSimulation=()=>new Promise(resolve=>resolveSave=resolve);c.drawSimulation=()=>draws++;
  const pending=c.endSimulationSection();c.featureVersion++;
  c.paper=config.papers.find(p=>p.level==='N1'&&p.year==='2018');vm.runInContext('simulationPaper=paper;simulation=freshSimulation(paper)',c);
  resolveSave(true);await pending;assert.equal(draws,0);
});
test('failed save retry sends the attempt rather than its DOM click event',async()=>{
  const paper=config.papers[0],status={textContent:'',append(button){this.button=button;}};let calls=0,body;
  const c=vm.createContext({featureVersion:1,document:{getElementById:()=>status,createElement:()=>({})},apiFetch:async(_,options)=>{body=JSON.parse(options.body);return {ok:++calls>1};}});
  vm.runInContext(fs.readFileSync('static/exam-engine.js','utf8'),c);c.paper=paper;vm.runInContext('simulation=freshSimulation(paper)',c);
  assert.equal(await c.saveSimulation(),false);assert.ok(status.button);
  assert.equal(await status.button.onclick({type:'click'}),true);assert.equal(body.paper_id,'N5:2012');
});
test('dirty exam navigation keeps answers unless the learner explicitly leaves',()=>{
  let restored;const c=vm.createContext({simulationSaveVersion:2,simulationSavedVersion:1,confirm:()=>false,appRouteHash:()=> '#quiz/N1/simulation/2018',history:{replaceState:(_,__,hash)=>restored=hash}});
  vm.runInContext(fs.readFileSync('static/workspace.js','utf8'),c);vm.runInContext("activeAppHash='#quiz/N5/simulation/2018'",c);
  assert.equal(c.confirmWorkspaceNavigation('quiz',{}),false);assert.equal(restored,'#quiz/N5/simulation/2018');assert.equal(c.simulationSavedVersion,1);
  c.confirm=()=>true;assert.equal(c.confirmWorkspaceNavigation('quiz',{}),true);assert.equal(c.simulationSavedVersion,2);
});
