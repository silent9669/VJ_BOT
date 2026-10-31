// Guided units use the same exercise IDs as lessons, so saved answers count in both views.
const studyPlans=new Map();
const studySkillNames={kana:'Bảng chữ cái',vocabulary:'Từ vựng',grammar:'Ngữ pháp',kanji:'Hán tự',reading:'Đọc',listening:'Nghe',production:'Thực hành'};
function lessonQuestions(item,level,skill){
  const questions=item.drills || item.questions || (item.q?[item]:[]);
  return questions.map((q,index)=>({...q,item_id:q.item_id || `${item.id || `lesson:${level}:${skill}:${item.lesson}`}:${index}`,skill}));
}
function lessonProgressIds(item,level,skill){
  if(item.production)return [item.id];
  return item.dictation ? (item.examples||[]).map((_,i)=>`${item.id}:${i}`) : lessonQuestions(item,level,skill).map(q=>q.item_id);
}
let practicalCourse=null,practicalSources=null,practicalLoad=null,courseChapters=null,jlptResources=null,erinResources=null;
async function loadPracticalCourse(){
  if(!practicalLoad)practicalLoad=Promise.all(['practical','sources','chapters','jlpt-resources','erin-resources'].map(async name=>{
    const response=await fetch(`course/${name}.json`);if(!response.ok)throw new Error('course');return response.json();
  })).then(([course,sources,chapters,resources,erin])=>{practicalCourse=course;practicalSources=sources;courseChapters=chapters;jlptResources=resources;erinResources=erin;}).catch(error=>{practicalLoad=null;throw error;});
  return practicalLoad;
}
function createStudyPlan(level){
  if(studyPlans.has(level))return studyPlans.get(level);
  if(!practicalCourse)throw new Error('Course has not loaded');
  const units=[],skills=window.JLPT_DATA.curriculum[level].skills;
  const step=(lesson,skill)=>({lesson,skill,ids:lessonProgressIds(lesson,level,skill)});
  if(level==='N5')units.push({id:'practical:kana',title:'Làm quen bảng chữ cái',goal:'Nhận diện cách đọc các chữ cơ bản trước khi bắt đầu hội thoại.',minutes:60,optional:true,steps:skills.kana.map(l=>step(l,'kana'))});
  for(const chapter of courseChapters.chapters.filter(c=>c.level===level)){
    const lessons=chapter.grammar_ids.map(id=>skills.grammar.find(l=>l.id===`openjlpt:${level}:grammar:${id}`));
    if(lessons.some(l=>!l))throw new Error('Missing chapter source');
    units.push({...chapter,type:'grammar',steps:lessons.map(l=>step(l,'grammar'))});
  }
  for(const unit of practicalCourse.units.filter(u=>u.level===level)){
    const common={roleplay:unit,source:'VJBot',sourceLabel:'VJBot · tiếng Việt',lesson:units.length+1};
    const vocabulary={...common,id:unit.id+':words',title:'Từ cần dùng',summary:unit.goal,items:unit.words};
    vocabulary.drills=unit.words.map((w,i)=>({item_id:`${unit.id}:word:${i}`,q:`${w.jp} (${w.reading}) — nghĩa nào phù hợp?`,opts:unit.words.map(x=>x.vi).filter(x=>x!==w.vi).slice(0,3),ans:w.vi}));
    vocabulary.drills.forEach((q,i)=>q.opts.splice(i%(q.opts.length+1),0,q.ans));
    const situation={...common,id:unit.id+':situation',title:'Đọc, nghe và hiểu tình huống',summary:unit.goal,formula:unit.formula,explanation:unit.note,examples:unit.dialogue,drills:unit.questions.map(q=>({...q,item_id:q.id})),resources:unit.source_ids.map(id=>practicalSources.lessons.find(s=>s.id===id)).filter(Boolean),reference_url:unit.reference_url};
    const production={...common,id:unit.id+':production',title:'Tự trả lời trong tình huống',summary:unit.goal,production:unit.production,roleplay:unit};
    const questions=unit.questions.map((q,i)=>({id:q.id,item_id:q.id,item_type:'reading',sentence:q.q,passage:unit.dialogue.map(d=>d.jp).join('\n'),options:q.opts,answer:q.opts.indexOf(q.ans),explanation:q.explanation,type:'Hiểu tình huống',plain:true}));
    const exam={id:unit.id+':review',title:unit.title,duration_minutes:10,source:'VJBot · tình huống',questions};
    units.push({...unit,type:'situation',steps:[step(vocabulary,'vocabulary'),step(situation,'reading'),step(production,'production')],exam});
  }
  const exams=window.JLPT_DATA.exams[level] ||= [];
  for(const unit of units)if(unit.exam){unit.examIndex=exams.length;exams.push(unit.exam);unit.steps.push({kind:'kaiwa',skill:'kaiwa',lesson:{id:`kaiwa:${unit.id}`,title:'Luyện nói tình huống'},ids:[],unit},{kind:'test',skill:'test',lesson:{id:`test:${level}:${unit.exam.id}`,title:'Kiểm tra tình huống'},ids:[],unit});}
  studyPlans.set(level,units);return units;
}
function examIdentity(level,index){
  const exam=window.JLPT_DATA.exams[level][index];
  return `${level}:${exam.id ?? index+1}`;
}
function quizProgressId(level,index,q,questionIndex){
  return `exam-${examIdentity(level,index)}-q${questionIndex+1}`;
}
function studyStepState(step,records){
  const passed=id=>{const r=records.get(id);return r?.last_correct===1 || r?.last_correct===true || (r?.last_correct==null && (r?.correct||0)>0);};
  const reviewed=step.ids.filter(passed).length;
  const attempted=step.ids.some(id=>records.has(id));
  return {reviewed,total:step.ids.length,complete:step.ids.length>0 && reviewed===step.ids.length,needsReview:attempted && reviewed<step.ids.length};
}
function openStudyStep(step,level){
  if(step.kind==='kaiwa'){startCourseKaiwa(step.unit);return;}
  if(step.kind==='test'){switchTab('quiz',{level,view:'practice',id:String(step.unit.examIndex)});return;}
  showLessonDetail(step.lesson,level,step.skill);
}
let studyPlanRequest=0;
async function renderStudyPlan(level){
  const request=++studyPlanRequest,host=document.getElementById('study-plan');
  const expanded=[...host.querySelectorAll('details[open]')].map(d=>d.dataset.unit);
  host.textContent='Đang tải danh sách bài học…';
  try{
    await Promise.all([ensureLessons(level),loadPracticalCourse()]);
    const units=createStudyPlan(level);
    const [response,completed]=await Promise.all([apiFetch('/api/progress'),loadCompletions()]);
    if(!response.ok)throw new Error('progress');
    const progress=await response.json();if(request!==studyPlanRequest)return;
    const records=new Map((progress.items||[]).map(i=>[i.item_id,i]));
    const required=units.filter(u=>!u.optional);
    const marked=step=>completed.has(activityId(step.lesson,level,step.skill));
    const unitDone=unit=>completed.has(unit.id) || unit.steps.every(marked);
    const done=required.filter(unitDone).length;
    const upcomingUnit=required.find(u=>!unitDone(u));
    const upcoming=upcomingUnit?.steps.find(s=>!marked(s));
    host.innerHTML=`<div class="plan-overview"><div><h3>Bài học ${level}</h3><p>${done} / ${required.length} chương hoàn thành</p>${upcomingUnit?`<p class="plan-current-title">${escapeHtml(upcomingUnit.title)}</p>`:''}</div><button type="button" class="plan-continue">${upcoming?'Học tiếp':'Ôn lại'}</button><progress value="${done}" max="${required.length}" aria-label="Chương hoàn thành"></progress></div><div class="plan-units"></div>`;
    host.querySelector('.plan-continue').onclick=()=>openStudyStep(upcoming || required[0].steps[0],level);
    for(const [index,unit] of units.entries()){
      const detail=document.createElement('details');detail.className='plan-unit';detail.dataset.unit=unit.id;detail.open=units.some(u=>expanded.includes(u.id))?expanded.includes(unit.id):unit===upcomingUnit;detail.dataset.current=String(unit===upcomingUnit);detail.dataset.done=String(unitDone(unit));
      const count=unit.steps.filter(marked).length;
      detail.innerHTML=`<summary><span class="plan-number">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(unit.title)}${unit.optional?' · tùy chọn':''}</strong><span>${unitDone(unit)?'Hoàn thành':`${count}/${unit.steps.length}`}</span></summary><div class="plan-steps"><p class="unit-goal">${escapeHtml(unit.goal)} <span>${unit.type==='grammar'?'Ngữ pháp · nguồn EN':unit.optional?'Kana':'Tình huống · tiếng Việt'} · khoảng ${unit.minutes} phút</span></p></div>`;
      const list=detail.querySelector('.plan-steps');
      for(const step of unit.steps){
        const state=studyStepState(step,records),button=document.createElement('button');button.type='button';button.className='plan-step';button.dataset.done=String(marked(step));if(step===upcoming)button.setAttribute('aria-current','step');
        button.innerHTML=`<span class="plan-skill">${studySkillNames[step.skill] || (step.kind==='kaiwa'?'Kaiwa':'Bài kiểm tra')}</span><span>${escapeHtml(step.lesson.title)}</span><span class="plan-step-status">${marked(step)?'Hoàn thành':state.needsReview?'Cần ôn':'Bắt đầu →'}</span>`;
        button.onclick=()=>openStudyStep(step,level);list.append(button);
      }
      const completion=document.createElement('div');list.append(completion);mountCompletion(completion,{activity_id:unit.id,kind:'roadmap',level,title:unit.title},true);
      detail.addEventListener('toggle',()=>{if(detail.open)for(const other of host.querySelectorAll('.plan-unit'))if(other!==detail)other.open=false;});
      host.querySelector('.plan-units').append(detail);
    }
    const official=document.createElement('section');official.className='official-level-resources';official.innerHTML='<h3>Tài liệu JLPT chính thức</h3><p>Đề luyện 2018 · mở tài liệu tại jlpt.jp</p>';
    for(const type of ['V','G','R','L']){
      const main=jlptResources.resources.find(r=>r.id===`jlpt:2018:${level}:${type}`);
      const button=document.createElement('button');button.className='stage-btn';button.textContent=main.title;
      button.onclick=()=>showLessonDetail(officialResourceLesson(level,type),level,type==='L'?'listening':'reading');
      official.append(button);
    }
    host.append(official);
    if(level==='N5' || level==='N4'){
      const extra=document.createElement('details');extra.className='course-supplements';
      extra.innerHTML='<summary>Hội thoại video · Erin</summary><p>Japan Foundation · 25 bài bổ trợ sơ cấp. Không quy đổi chính thức sang JLPT.</p>';
      for(const lesson of erinResources.lessons){
        const button=document.createElement('button');button.type='button';button.textContent=`${lesson.number}. ${lesson.title}`;
        button.onclick=()=>showLessonDetail(erinResourceLesson(lesson),level,'listening');extra.append(button);
      }
      host.append(extra);
    }
  }catch{if(request!==studyPlanRequest)return;host.textContent='Chưa tải được lộ trình. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Thử lại';retry.onclick=()=>renderStudyPlan(level);host.append(retry);}
}
let curriculumView='plan';
function setCurriculumView(view,navigate=true){
  if(navigate){openLevelCourse(activeCurriculumLevel,view,activeCurriculumSkill);return;}
  curriculumView=view;
  document.getElementById('study-plan').hidden=view!=='plan';
  document.getElementById('lesson-library').hidden=view!=='library';
  document.getElementById('skill-tabs-row').hidden=view!=='library';
  document.querySelectorAll('[data-curriculum-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.curriculumView===view)));
  if(view==='plan')renderStudyPlan(activeCurriculumLevel);
}
window.loadPracticalCourse=loadPracticalCourse;
window.createStudyPlan=createStudyPlan;
window.lessonQuestions=lessonQuestions;
window.lessonProgressIds=lessonProgressIds;
window.studyStepState=studyStepState;
