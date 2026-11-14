// Guided units use the same exercise IDs as lessons, so saved answers count in both views.
const studyPlans=new Map();
const studySkillNames={kana:'Bảng chữ cái',vocabulary:'Từ vựng',grammar:'Ngữ pháp',kanji:'Hán tự',reading:'Lý thuyết',listening:'Nghe',production:'Thực hành'};
function lessonQuestions(item,level,skill){
  return normalizedLessonTasks(item,level,skill);
}
function lessonProgressIds(item,level,skill){
  return lessonQuestions(item,level,skill).map(q=>q.item_id);
}
let practicalCourse=null,practicalSources=null,practicalLoad=null,courseChapters=null,jlptResources=null,erinResources=null;
async function loadPracticalCourse(){
  if(!practicalLoad)practicalLoad=Promise.all(['practical','sources','chapters','jlpt-resources','erin-resources'].map(async name=>{
    const response=await fetch(`course/${name}.json`);if(!response.ok)throw new Error('course');return response.json();
  })).then(([course,sources,chapters,resources,erin])=>{practicalCourse=course;practicalSources=sources;courseChapters=chapters;jlptResources=resources;erinResources=erin;}).catch(error=>{practicalLoad=null;throw error;});
  return practicalLoad;
}
function installCourseKaiwa(){
  for(const unit of practicalCourse.units){window.JLPT_DATA.kaiwaScenarios[unit.id]={title:unit.title,desc:unit.goal,level:unit.level,course:true,context:unit.dialogue.map(d=>d.jp).join('\n'),prompts:[{jp:unit.production.question_jp,vi:''}]};}
}
function createStudyPlan(level){
  if(studyPlans.has(level))return studyPlans.get(level);
  if(!practicalCourse)throw new Error('Course has not loaded');
  const units=[],skills=window.JLPT_DATA.curriculum[level].skills;
  const step=(lesson,skill)=>({lesson,skill,ids:lessonProgressIds(lesson,level,skill)});
  if(level==='N5')units.push({id:'practical:kana',title:'Làm quen bảng chữ cái',goal:'Nhận diện cách đọc các chữ cơ bản trước khi bắt đầu hội thoại.',minutes:60,optional:true,steps:skills.kana.map(l=>step(l,'kana'))});
  const editorial=skills.grammar.filter(lesson=>lesson.editorial);
  if(editorial.length)units.push({id:`${level.toLowerCase()}-teaching:v1`,type:'grammar',sourceLabel:'AI biên soạn · chờ bạn duyệt',title:`${level} Việt–Nhật: hiểu và tự vận dụng`,goal:'Bài AI biên soạn có ngữ cảnh và đối chiếu lỗi; chỉ dùng tham khảo, chờ bạn đánh giá trước khi merge.',minutes:editorial.length*10,steps:editorial.map(lesson=>step(lesson,'grammar'))});
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
    const situation={...common,id:unit.id+':situation',title:'Lý thuyết tình huống',summary:unit.goal,formula:unit.formula,explanation:unit.note,passage:unit.dialogue.map(line=>line.jp).join('\n'),examples:unit.dialogue,drills:unit.questions.map(q=>({...q,item_id:q.id,requires_passage:true})),resources:unit.source_ids.map(id=>practicalSources.lessons.find(s=>s.id===id)).filter(Boolean),reference_url:unit.reference_url};
    const production={...common,id:unit.id+':production',title:'Tự trả lời trong tình huống',summary:unit.goal,production:unit.production,roleplay:unit};
    skills.production ||= [];
    if(!skills.production.some(l=>l.id===production.id))skills.production.push(production);
    const questions=unit.questions.map((q,i)=>({id:q.id,item_id:q.id,item_type:'reading',sentence:q.q,passage:unit.dialogue.map(d=>d.jp).join('\n'),options:q.opts,answer:q.opts.indexOf(q.ans),explanation:q.explanation,type:'Hiểu tình huống',plain:true}));
    const exam={id:unit.id+':review',title:unit.title,duration_minutes:10,source:'VJBot · tình huống',questions};
    units.push({...unit,type:'situation',steps:[step(vocabulary,'vocabulary'),step(situation,'reading')],exam});
  }
  const exams=window.JLPT_DATA.exams[level] ||= [];
  for(const unit of units)if(unit.exam){unit.examIndex=exams.length;exams.push(unit.exam);}
  studyPlans.set(level,units);return units;
}
function examIdentity(level,index){
  const exam=window.JLPT_DATA.exams[level][index];
  return `${level}:${exam.id ?? index+1}`;
}
function quizProgressId(level,index,q,questionIndex){
  return `exam-${examIdentity(level,index)}-q${questionIndex+1}`;
}
function studyStepState(step,records,evidence=[],revisions=new Map()){
  const passed=id=>{const r=records.get(id);return r?.last_correct===1 || r?.last_correct===true || (r?.last_correct==null && (r?.correct||0)>0);};
  const reviewed=step.ids.filter(passed).length;
  const attempted=step.ids.some(id=>records.has(id));
  const submitted=new Set(evidence.filter(row=>row.answered_at && row.validity==='valid' && revisions.get(row.task_id)===row.revision && step.ids.includes(row.item_id)).map(row=>row.item_id)).size;
  return {reviewed,submitted,total:step.ids.length,complete:step.ids.length>0 && reviewed===step.ids.length,needsReview:attempted && reviewed<step.ids.length};
}
function openStudyStep(step,level){
  showLessonDetail(step.lesson,level,step.skill);
}
function delayedReviewState(lesson,tasks,evidence,revisions,now=Date.now()){
  const index=tasks.findIndex(task=>task.task_id===lesson.delayed_review_task_id),task=tasks[index];
  if(!task || task.exchange?.stage!=='delayed' || !task.exchange.prior_task_ids.length)return null;
  const prior=task.exchange.prior_task_ids;
  const sessions=new Map();
  for(const row of evidence || []){
    if(!row.session_id || row.validity!=='valid' || !prior.includes(row.task_id) || revisions.get(row.task_id)!==row.revision || !row.answered_at)continue;
    const answered=Date.parse(row.answered_at);if(!Number.isFinite(answered))continue;
    if(!sessions.has(row.session_id))sessions.set(row.session_id,new Map());
    const records=sessions.get(row.session_id),previous=records.get(row.task_id);
    if(!previous || answered>previous.time)records.set(row.task_id,{time:answered,row});
  }
  const completed=[...sessions].filter(([,records])=>prior.every(id=>records.has(id))).map(([session,records])=>({
    session,dueAt:Math.max(...prior.map(id=>records.get(id).time))+(task.exchange.delay_hours || 24)*3600000
  })).sort((a,b)=>b.dueAt-a.dueAt);
  const eligible=completed.find(session=>session.dueAt<=now) || completed.at(-1);
  return eligible?{index,task,session:eligible.session,dueAt:eligible.dueAt,due:now>=eligible.dueAt}:null;
}
// Right-hand outline of the chapter this lesson belongs to: where you are, what is done, one click to any step.
async function renderLessonOutline(item,level,skill,owner){
  const host=document.getElementById('lesson-outline');
  host.hidden=true;host.replaceChildren();
  if(owner)return;
  const id=activityId(item,level,skill),unit=(studyPlans.get(level)||[]).find(u=>u.steps.some(s=>activityId(s.lesson,level,s.skill)===id));
  if(!unit)return;
  let completed;try{completed=await loadCompletions();}catch{completed=new Set();}
  if(!currentLesson || activityId(currentLesson.item,level,currentLesson.skill)!==id)return;
  const done=unit.steps.filter(s=>completed.has(activityId(s.lesson,level,s.skill))).length;
  const head=document.createElement('header'),title=document.createElement('strong'),count=document.createElement('span'),bar=document.createElement('progress');
  title.textContent=unit.title;count.textContent=`${done}/${unit.steps.length}`;bar.max=unit.steps.length;bar.value=done;bar.setAttribute('aria-label','Tiến độ chương');
  head.append(title,count);host.append(head,bar);
  const list=document.createElement('ol');
  for(const step of unit.steps){
    const stepId=activityId(step.lesson,level,step.skill),li=document.createElement('li'),button=document.createElement('button');
    button.type='button';button.dataset.done=String(completed.has(stepId));if(stepId===id)button.setAttribute('aria-current','step');
    const label=document.createElement('span');label.textContent=step.lesson.title;
    const kind=document.createElement('small');kind.textContent=studySkillNames[step.skill]||'';
    button.append(label,kind);button.onclick=()=>openStudyStep(step,level);li.append(button);list.append(li);
  }
  host.append(list);host.hidden=false;
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
    const revisions=new Map(await Promise.all(units.flatMap(unit=>unit.steps).flatMap(step=>lessonQuestions(step.lesson,level,step.skill).map(async task=>[task.task_id,(await taskReference(task)).revision]))));
    if(request!==studyPlanRequest)return;
    const required=units.filter(u=>!u.optional);
    const marked=step=>completed.has(activityId(step.lesson,level,step.skill));
    const unitDone=unit=>completed.has(unit.id) || unit.steps.every(marked);
    const done=required.filter(unitDone).length;
    const upcomingUnit=required.find(u=>!unitDone(u));
    const upcoming=upcomingUnit?.steps.find(s=>!marked(s));
    host.innerHTML=`<div class="plan-overview"><div><h3>Bài học ${level}</h3><p>${done} / ${required.length} chương hoàn thành</p>${upcomingUnit?`<p class="plan-current-title">${escapeHtml(upcomingUnit.title)}</p>`:''}</div><button type="button" class="plan-continue">${upcoming?'Học tiếp':'Ôn lại'}</button><progress value="${done}" max="${required.length}" aria-label="Chương hoàn thành"></progress></div><div class="lesson-toolbar plan-toolbar"><label class="lesson-search">Tìm chương<input type="search" id="plan-search" placeholder="Tên chương hoặc chủ đề"></label><label class="lesson-status">Nhóm bài<select id="plan-category"><option value="all">Tất cả</option><option value="grammar">Ngữ pháp</option><option value="practical">Tình huống</option><option value="optional">Bổ trợ</option></select></label></div><p id="plan-count" class="lesson-count" role="status"></p><div class="plan-units"></div>`;
    host.querySelector('.plan-continue').onclick=()=>openStudyStep(upcoming || required[0].steps[0],level);
    for(const [index,unit] of units.entries()){
      const detail=document.createElement('details');detail.className='plan-unit';detail.dataset.unit=unit.id;detail.open=units.some(u=>expanded.includes(u.id))?expanded.includes(unit.id):unit===upcomingUnit;detail.dataset.current=String(unit===upcomingUnit);detail.dataset.done=String(unitDone(unit));detail.dataset.category=unit.optional?'optional':unit.type==='grammar'?'grammar':'practical';detail.dataset.search=[unit.title,unit.goal,...unit.steps.map(step=>step.lesson.title)].join(' ').normalize('NFKC').toLocaleLowerCase();
      const count=unit.steps.filter(marked).length;
      detail.innerHTML=`<summary><span class="plan-number">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(unit.title)}${unit.optional?' · tùy chọn':''}</strong><span>${unitDone(unit)?'Hoàn thành':`${count}/${unit.steps.length}`}</span></summary><div class="plan-steps"><p class="unit-goal">${escapeHtml(unit.goal)} <span>${escapeHtml(unit.sourceLabel || (unit.type==='grammar'?'Ngữ pháp · OpenJLPT':unit.optional?'Kana':'Tình huống · tiếng Việt'))} · khoảng ${unit.minutes} phút</span></p></div>`;
      const list=detail.querySelector('.plan-steps');
      for(const step of unit.steps){
        const state=studyStepState(step,records,progress.evidence,revisions),button=document.createElement('button');button.type='button';button.className='plan-step';button.dataset.done=String(marked(step));if(step===upcoming)button.setAttribute('aria-current','step');
        button.innerHTML=`<span class="plan-skill">${studySkillNames[step.skill] || (step.kind==='kaiwa'?'Kaiwa':'Bài kiểm tra')}</span><span>${escapeHtml(step.lesson.title)}</span><span class="plan-step-status">${marked(step)?'Em đã đánh dấu':state.submitted?`Đã thử ${state.submitted}/${state.total} · tham khảo`:state.needsReview?'Cần ôn':'Bắt đầu →'}</span>`;
        button.onclick=()=>openStudyStep(step,level);list.append(button);
        if(step.lesson.delayed_review_task_id){
          const tasks=lessonQuestions(step.lesson,level,step.skill),later=delayedReviewState(step.lesson,tasks,progress.evidence,revisions);
          if(later){
            const followup=document.createElement('button');followup.type='button';followup.className='plan-step delayed-review';
            followup.textContent=later.due?'Gợi nhớ tình huống mới · phiên riêng':`Gợi nhớ tình huống mới mở sau ${new Date(later.dueAt).toLocaleString('vi-VN')}`;
            followup.disabled=!later.due;
            followup.onclick=()=>showLessonDetail({...step.lesson,reviewQuestionIndex:later.index,delayedReview:true},level,step.skill);
            list.append(followup);
          }
        }
      }
      const target=unit.steps.find(s=>!marked(s)) || unit.steps[0];
      if(target){const talk=document.createElement('button');talk.type='button';talk.className='plan-step plan-talk';talk.innerHTML='<span class="plan-skill">Thầy Lâm</span><span>Lớp học đảo ngược</span><span class="plan-step-status">Vào lớp →</span>';talk.onclick=()=>{switchTab('classroom');startReversedLesson(target.lesson,level,target.skill);};list.append(talk);}
      const completion=document.createElement('div');list.append(completion);mountCompletion(completion,{activity_id:unit.id,kind:'roadmap',level,title:unit.title},true);
      detail.addEventListener('toggle',()=>{if(detail.open)for(const other of host.querySelectorAll('.plan-unit'))if(other!==detail)other.open=false;});
      host.querySelector('.plan-units').append(detail);
    }
    const filter=()=>{
      const query=host.querySelector('#plan-search').value.trim().normalize('NFKC').toLocaleLowerCase(),category=host.querySelector('#plan-category').value;
      let visible=0;
      for(const unit of host.querySelectorAll('.plan-unit')){unit.hidden=!unit.dataset.search.includes(query) || (category!=='all' && category!==unit.dataset.category);if(!unit.hidden)visible++;}
      host.querySelector('#plan-count').textContent=visible?`${visible} / ${units.length} chương`:'Không tìm thấy chương.';
    };
    host.querySelector('#plan-search').oninput=filter;host.querySelector('#plan-category').onchange=filter;filter();

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
