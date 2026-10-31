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
let practicalCourse=null,practicalSources=null,practicalLoad=null;
async function loadPracticalCourse(){
  if(!practicalLoad)practicalLoad=Promise.all(['practical','sources'].map(async name=>{
    const response=await fetch(`course/${name}.json`);if(!response.ok)throw new Error('course');return response.json();
  })).then(([course,sources])=>{practicalCourse=course;practicalSources=sources;}).catch(error=>{practicalLoad=null;throw error;});
  return practicalLoad;
}
function createStudyPlan(level){
  if(studyPlans.has(level))return studyPlans.get(level);
  if(!practicalCourse)throw new Error('Course has not loaded');
  const units=[],skills=window.JLPT_DATA.curriculum[level].skills;
  const step=(lesson,skill)=>({lesson,skill,ids:lessonProgressIds(lesson,level,skill)});
  if(level==='N5')units.push({id:'practical:kana',title:'Làm quen bảng chữ cái',goal:'Nhận diện cách đọc các chữ cơ bản trước khi bắt đầu hội thoại.',minutes:60,optional:true,steps:skills.kana.map(l=>step(l,'kana'))});
  for(const unit of practicalCourse.units.filter(u=>u.level===level)){
    const common={source:'VJBot',sourceLabel:'VJBot · tiếng Việt',lesson:units.length+1};
    const vocabulary={...common,id:unit.id+':words',title:'Từ cần dùng',summary:unit.goal,items:unit.words};
    vocabulary.drills=unit.words.map((w,i)=>({item_id:`${unit.id}:word:${i}`,q:`${w.jp} (${w.reading}) — nghĩa nào phù hợp?`,opts:unit.words.map(x=>x.vi).filter(x=>x!==w.vi).slice(0,3),ans:w.vi}));
    vocabulary.drills.forEach((q,i)=>q.opts.splice(i%(q.opts.length+1),0,q.ans));
    const situation={...common,id:unit.id+':situation',title:'Đọc, nghe và hiểu tình huống',summary:unit.goal,formula:unit.formula,explanation:unit.note,examples:unit.dialogue,drills:unit.questions.map(q=>({...q,item_id:q.id})),resources:unit.source_ids.map(id=>practicalSources.lessons.find(s=>s.id===id)).filter(Boolean),reference_url:unit.reference_url};
    const production={...common,id:unit.id+':production',title:'Tự trả lời trong tình huống',summary:unit.goal,production:unit.production,roleplay:unit};
    const questions=unit.questions.map((q,i)=>({id:q.id,item_id:q.id,item_type:'reading',sentence:q.q,passage:unit.dialogue.map(d=>d.jp).join('\n'),options:q.opts,answer:q.opts.indexOf(q.ans),explanation:q.explanation,type:'Hiểu tình huống',plain:true}));
    const exam={id:unit.id+':review',title:unit.title,duration_minutes:10,source:'VJBot · tình huống',questions};
    units.push({...unit,steps:[step(vocabulary,'vocabulary'),step(situation,'reading'),step(production,'production')],exam});
  }
  const exams=window.JLPT_DATA.exams[level] ||= [];
  for(const unit of units)if(unit.exam){unit.examIndex=exams.length;exams.push(unit.exam);}
  studyPlans.set(level,units);return units;
}
function quizProgressId(level,index,q,questionIndex){
  const exam=window.JLPT_DATA.exams[level][index];
  return exam.id?`exam-${exam.id}-q${questionIndex+1}`:`exam-${level}-t${index+1}-q${q.id || questionIndex+1}`;
}
function studyStepState(step,records){
  const passed=id=>{const r=records.get(id);return r?.last_correct===1 || r?.last_correct===true || (r?.last_correct==null && (r?.correct||0)>0);};
  const reviewed=step.ids.filter(passed).length;
  const attempted=step.ids.some(id=>records.has(id));
  return {reviewed,total:step.ids.length,complete:step.ids.length>0 && reviewed===step.ids.length,needsReview:attempted && reviewed<step.ids.length};
}
let studyPlanRequest=0;
async function renderStudyPlan(level){
  const request=++studyPlanRequest,host=document.getElementById('study-plan');
  host.textContent='Đang tải lộ trình…';
  try{
    await Promise.all([ensureLessons(level),loadPracticalCourse()]);
    const units=createStudyPlan(level),response=await apiFetch('/api/progress');
    if(!response.ok)throw new Error('progress');
    const progress=await response.json();if(request!==studyPlanRequest)return;
    const records=new Map((progress.items||[]).map(i=>[i.item_id,i]));
    const required=units.filter(u=>!u.optional);
    const done=required.reduce((n,u)=>n+u.steps.filter(s=>studyStepState(s,records).complete).length,0);
    const total=required.reduce((n,u)=>n+u.steps.length,0);
    const upcoming=units.filter(u=>!u.optional).flatMap(u=>u.steps).find(s=>!studyStepState(s,records).complete);
    host.innerHTML=`<div class="plan-overview"><div><h3>Học để sử dụng · ${level}</h3><p>${done} / ${total} bước hoàn thành · ${units.filter(u=>!u.optional).length} tình huống</p></div><button type="button" class="plan-continue">${upcoming?'Học tiếp':'Ôn lại'}</button><progress value="${done}" max="${total}" aria-label="Bài đã luyện"></progress></div><p class="plan-note">${["N2","N1"].includes(level)?"Bài luyện kỹ năng ngắn; chưa phải giáo trình hoặc đề thi đầy đủ. ":""}<a href="sources.html">Tài liệu & bản nghe gốc ↗</a></p><div class="plan-units"></div>`;
    const open=step=>showLessonDetail(step.lesson,level,step.skill);
    host.querySelector('.plan-continue').onclick=()=>open(upcoming || units[0].steps[0]);
    let expanded=false;
    for(const [index,unit] of units.entries()){
      const completed=unit.steps.filter(s=>studyStepState(s,records).complete).length;
      const detail=document.createElement('details');detail.className='plan-unit';
      if(!expanded && !unit.optional && completed<unit.steps.length){detail.open=true;expanded=true;}
      detail.innerHTML=`<summary><span class="plan-number">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(unit.title)}${unit.optional?" · tùy chọn":""}</strong><span>${completed}/${unit.steps.length}</span></summary><div class="plan-steps"><p class="unit-goal">${escapeHtml(unit.goal || "")} <span>Khoảng ${unit.minutes} phút</span></p></div>`;
      const list=detail.querySelector('.plan-steps');
      for(const step of unit.steps){const state=studyStepState(step,records),button=document.createElement('button');button.type='button';button.className='plan-step';button.innerHTML=`<span class="plan-skill">${studySkillNames[step.skill]}</span><span>${escapeHtml(step.lesson.title)}</span><span class="plan-step-status">${state.complete?(step.skill==='production'?'Tự đánh giá đạt':'Đạt'):state.needsReview?'Cần ôn':`${state.reviewed}/${state.total}`}</span>`;button.onclick=()=>open(step);list.append(button);}
      if(unit.exam){const button=document.createElement('button');button.type='button';button.className='plan-review';const answered=unit.exam.questions.filter((q,i)=>records.has(quizProgressId(level,unit.examIndex,q,i))).length;button.textContent=`Ôn tình huống · ${answered}/${unit.exam.questions.length} câu đã làm`;button.onclick=()=>{switchTab('quiz');renderQuiz(level,unit.examIndex);};list.append(button);}
      host.querySelector('.plan-units').append(detail);
    }
  }catch{if(request!==studyPlanRequest)return;host.textContent='Chưa tải được lộ trình. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Thử lại';retry.onclick=()=>renderStudyPlan(level);host.append(retry);}
}
let curriculumView='plan';
function setCurriculumView(view){
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
