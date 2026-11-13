const featureNames={flashcards:'Thẻ nhớ',kaiwa:'Luyện nói',kanji:'Kanji',quiz:'Luyện thi JLPT'};
let featureVersion=0,activeAppHash='#landing';
function confirmWorkspaceNavigation(tab,route){
  const target=appRouteHash(tab,route);
  if(target!==activeAppHash && simulationSaveVersion>simulationSavedVersion){
    if(!confirm('Bài thi chưa lưu xong. Rời trang có thể mất đáp án chưa lưu. Vẫn rời trang?')){history.replaceState(null,'',activeAppHash);return false;}
    simulationSavedVersion=simulationSaveVersion;
  }
  activeAppHash=target;return true;
}
function authorizePage(tab,route={}){
  if(tab==='landing' || signedInUser)return true;
  sessionStorage.setItem('vjbot_return_route',appRouteHash(tab,route));
  history.replaceState(null,'','#landing');
  switchTab('landing',{fromHistory:true});
  openAccount();
  return false;
}
function handleSessionExpired(){simulationSavedVersion=simulationSaveVersion;switchTab('landing');}
function setupWorkspace(){
  window.addEventListener('beforeunload',event=>{if(simulationSaveVersion>simulationSavedVersion){event.preventDefault();event.returnValue='';}});
  document.querySelectorAll('[data-enter]').forEach(b=>b.onclick=()=>switchTab(b.dataset.enter));
  document.querySelectorAll('[data-feature-back]').forEach(b=>b.onclick=()=>switchTab(b.dataset.featureBack));
  document.querySelectorAll('.public-nav a[href^="#landing-"]').forEach(a=>a.onclick=e=>{e.preventDefault();document.querySelector(a.getAttribute('href')).scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
}
function featureLevelCards(feature){
  const host=document.getElementById(`${feature}-hub`);
  host.innerHTML=`<header class="workspace-heading"><h1>${featureNames[feature]}</h1></header><div class="level-cards">${learningLevels.map(level=>`<a class="level-course-card" href="#${feature}/${level}"><div class="level-cover" data-level="${level}"><img src="assets/courses/${level.toLowerCase()}.svg" alt="" width="300" height="168"></div><div class="level-card-content"><h2>${level}</h2><div class="level-card-footer"><span aria-hidden="true">↗</span></div></div></a>`).join('')}</div>`;
}
async function renderFeaturePage(feature,route){
  const version=featureVersion;
  const hub=document.getElementById(`${feature}-hub`),work=document.getElementById(`${feature}-workspace`);
  hub.hidden=!!route.level;work.hidden=!route.level;
  const back=work.querySelector('[data-feature-back]');if(back){back.textContent=route.view?'← Danh sách bài':'← Chọn cấp độ';back.onclick=()=>switchTab(feature,route.view?{level:route.level}:{});}
  if(!route.level){featureLevelCards(feature);return;}
  if(feature==='flashcards'){
    if(route.view==='review' && route.id){document.getElementById('flashcard-lesson-list').hidden=true;document.getElementById('flashcard-review').hidden=false;return renderFlashcards(route.level,route.id);}
    return renderFeatureLessonList(feature,route.level);
  }
  if(feature==='kaiwa'){
    if(route.view==='session' && route.id){document.getElementById('kaiwa-lesson-list').hidden=true;document.getElementById('kaiwa-session').hidden=false;activeKaiwaLevel=route.level;activeKaiwaKey=route.id;activeKaiwaPromptIdx=0;return renderKaiwaScenarios();}
    return renderFeatureLessonList(feature,route.level);
  }
  if(feature==='quiz')return renderExamCatalog(route);
  work.innerHTML='<button class="feature-back" id="kanji-back">← Chọn cấp độ</button><h1>Kanji '+route.level+'</h1><div id="kanji-library" class="kanji-library" aria-live="polite">Đang tải…</div>';
  document.getElementById('kanji-back').onclick=()=>switchTab('kanji');
  const host=document.getElementById('kanji-library');
  try{
    await ensureLessons(route.level);if(version!==featureVersion)return;
    host.replaceChildren();
    const lessons=window.JLPT_DATA.curriculum[route.level].skills.kanji;
    for(const lesson of lessons){
      const button=document.createElement('button');button.className='kanji-set';
      const chars=document.createElement('span'),label=document.createElement('strong');
      chars.lang='ja';chars.textContent=lesson.items.slice(0,6).map(i=>i.jp).join(' ');label.textContent=`Bộ ${lesson.lesson} · ${lesson.items.length} chữ`;
      button.append(chars,label);button.onclick=()=>{showLessonDetail(lesson,route.level,'kanji');currentLesson.returnTab='kanji';};host.append(button);
    }
    setupLessonFilter(work,lessons,'.kanji-set');
  }catch{host.textContent='Chưa tải được Kanji. ';const retry=document.createElement('button');retry.textContent='Thử lại';retry.onclick=()=>renderFeaturePage(feature,route);host.append(retry);}
}
async function renderDashboard(){
  const host=document.getElementById('dashboard-content');
  document.getElementById('dashboard-greeting').textContent=`${signedInUser?.name || 'Học viên'} · ${activeCurriculumLevel}`;
  host.textContent='Đang tải tiến độ…';
  try{
    const response=await apiFetch('/api/progress');if(!response.ok)throw new Error('progress');
    const [progress,completed]=await Promise.all([response.json(),loadCompletions()]);
    const due=(progress.items || []).filter(i=>i.next_review && new Date(i.next_review)<=new Date()).length;
    await Promise.all([ensureLessons(activeCurriculumLevel),loadPracticalCourse()]);
    const units=createStudyPlan(activeCurriculumLevel);
    const next=units.filter(u=>!u.optional && !completed.has(u.id)).flatMap(u=>u.steps).find(step=>!completed.has(activityId(step.lesson,activeCurriculumLevel,step.skill)));
    const nextTitle=next?.lesson.title || 'Ôn lại bài học';
    const nextHref=next?appRouteHash('lesson',{level:activeCurriculumLevel,skill:next.skill,id:activityId(next.lesson,activeCurriculumLevel,next.skill)}):`#curriculum/${activeCurriculumLevel}`;
    host.innerHTML=`<div class="dashboard-overview"><a class="dashboard-next" href="${escapeHtml(nextHref)}"><div><span>${activeCurriculumLevel} · Học tiếp</span><h2>${escapeHtml(nextTitle)}</h2><strong>Mở bài học ↗</strong></div><img src="assets/courses/${activeCurriculumLevel.toLowerCase()}.svg" alt="" width="180" height="120"></a><dl class="dashboard-numbers"><div><dt>Hoàn thành</dt><dd>${completed.size}</dd></div><div><dt>Đến hạn ôn</dt><dd>${due}</dd></div><div><dt>Ngày liên tiếp</dt><dd>${Number(progress.streak_days)||0}</dd></div></dl></div><div class="dashboard-grid"><section><h2 class="dashboard-section-title">Luyện tập</h2><div class="dashboard-tools"><a href="#classroom"><span class="dashboard-tool-symbol" aria-hidden="true">↔</span><h3>Lớp học đảo ngược</h3><span aria-hidden="true">↗</span></a>${Object.entries(featureNames).map(([key,name],index)=>`<a href="#${key}/${activeCurriculumLevel}"><span class="dashboard-tool-symbol" aria-hidden="true">${['あ','話','字','問'][index]}</span><h3>${name}</h3><span aria-hidden="true">↗</span></a>`).join('')}<a href="#curriculum"><span class="dashboard-tool-symbol" aria-hidden="true">本</span><h3>Lộ trình N5–N1</h3><span aria-hidden="true">↗</span></a></div></section><section class="dashboard-recent"><h2 class="dashboard-section-title">Vừa hoàn thành</h2>${[...completed.values()].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||'')).slice(0,5).map(i=>`<p><span>${escapeHtml(i.level)}</span>${escapeHtml(i.title)}</p>`).join('') || '<div class="dashboard-empty"><p>Chưa có bài hoàn thành.</p></div>'}</section></div>`;
    globalThis.mountAiBanner?.(host);
  }catch{host.textContent='Chưa tải được tiến độ. ';const retry=document.createElement('button');retry.textContent='Thử lại';retry.onclick=renderDashboard;host.append(retry);}
}
function addPracticeSets(level){
  const exams=window.JLPT_DATA.exams[level];
  if(exams.some(e=>typeof e.id==='string' && e.id.startsWith('mixed:')))return;
  const skills=window.JLPT_DATA.curriculum[level].skills;
  const pools=['vocabulary','kanji','grammar','reading'].map(skill=>skills[skill].filter(l=>l.source==='OpenJLPT').flatMap(l=>(l.drills||[]).map(d=>({...d,skill}))));
  for(let set=0;set<10;set++){
    const drills=pools.flatMap(pool=>pool.slice(set*5,set*5+5));
    if(!drills.length)continue;
    exams.push({id:`mixed:${level}:${set+1}`,title:`Ôn tổng hợp ${set+1}`,source:'VJBot · nhận diện từ OpenJLPT · giải nghĩa EN',duration_minutes:20,questions:drills.map(d=>({id:d.item_id,sentence:d.q,options:d.opts,answer:d.opts.indexOf(d.ans),explanation:d.ans,type:d.skill,plain:true}))});
  }
}
async function renderExamCatalog(route){
  clearInterval(examTimerInterval);examTimerInterval=null;
  clearInterval(simulationInterval);
  const host=document.getElementById('exam-catalog'),practice=document.getElementById('practice-workspace'),simulation=document.getElementById('simulation-workspace');
  host.hidden=false;practice.hidden=true;simulation.hidden=true;host.textContent='Đang tải bộ đề…';
  const version=featureVersion;
  try{
    await Promise.all([ensureLessons(route.level),loadPracticalCourse(),loadExamConfig(),loadCompletions()]);if(version!==featureVersion)return;
    createStudyPlan(route.level);addPracticeSets(route.level);
    if(route.view==='practice'){
      const index=Number(route.id);if(!Number.isInteger(index)||index<0||index>=window.JLPT_DATA.exams[route.level].length)throw new Error('exam');
      host.hidden=true;practice.hidden=false;return renderQuiz(route.level,index);
    }
    if(route.view==='simulation'){
      if(!examConfig.papers.some(p=>p.level===route.level && p.year===route.id))throw new Error('paper');
      host.hidden=true;simulation.hidden=false;return renderSimulation(route.level,route.id);
    }
    host.innerHTML=`<header class="workspace-heading"><h1>JLPT ${route.level}</h1></header><h2>Mô phỏng kỳ thi</h2><p class="exam-source-note">Đề luyện chính thức, đồng hồ theo từng phần. Điểm tự đối chiếu, không quy đổi sang thang điểm JLPT.</p><div class="exam-grid">${examConfig.papers.filter(p=>p.level===route.level).map(p=>`<a class="exam-set official" href="#quiz/${route.level}/simulation/${p.year}"><span>Japan Foundation · JEES</span><h3>Đề luyện chính thức ${p.year}</h3><p>${p.sections.reduce((n,s)=>n+s.minutes,0)} phút · ${p.sections.length} phần</p><strong>Chuẩn bị thi ↗</strong></a>`).join('')}</div><h2>Bộ luyện theo chủ đề</h2><div class="exam-grid">${featureLessons('quiz',route.level).map(e=>`<a class="exam-set" href="#quiz/${route.level}/lesson/${encodeURIComponent(e.id)}"><h3>${escapeHtml(e.title)}</h3><p>${completionRecords.has(activityId(e,route.level,'quiz'))?'Đã hoàn thành':'5 câu'}</p><span>${escapeHtml(e.summary)}</span></a>`).join('')}</div>`;
  }catch{host.hidden=false;host.textContent='Chưa mở được bộ đề. ';const b=document.createElement('button');b.textContent='Thử lại';b.onclick=()=>renderExamCatalog({...route,view:undefined});host.append(b);}
}
function featureLessons(feature,level){
  const skills=window.JLPT_DATA.curriculum[level].skills;
  if(feature==='flashcards')return skills.vocabulary.filter(l=>l.items?.length).map(l=>({...l,id:l.id || `lesson:${level}:vocabulary:${l.lesson}`}));
  if(feature==='kaiwa'){
    installCourseKaiwa();
    return Object.entries(window.JLPT_DATA.kaiwaScenarios).filter(([,s])=>s.level===level || s.level==='ALL').map(([key,s])=>{
      const unit=practicalCourse.units.find(u=>u.id===key);
      return {id:`kaiwa-lesson:${level}:${key}`,completionId:s.course?`kaiwa:${key}`:`kaiwa:${level}:${key}`,title:s.title,summary:unit?.goal || s.desc,lessonKey:key,sourceLabel:'VJBot · hội thoại',examples:unit?.dialogue || s.prompts.flatMap(p=>[{jp:p.jp,vi:p.vi,ro:p.ro},...(p.responses || [])]),items:unit?.words,drills:unit?.questions,formula:unit?.formula,explanation:unit?.note};
    });
  }
  if(feature==='quiz'){
    createStudyPlan(level);addPracticeSets(level);
    return window.JLPT_DATA.exams[level].map((exam,index)=>{
      const questions=exam.questions.slice(0,5);
      return {id:`quiz-lesson:${level}:${exam.id ?? index}`,completionId:`test:${examIdentity(level,index)}`,title:exam.title || `Bộ luyện ${index+1}`,summary:exam.source || 'VJBot · bài luyện',sourceLabel:exam.source || 'VJBot',examIndex:index,examples:questions.map(q=>({jp:(q.sentence || q.sentence_jp || '').replace(/<[^>]+>/g,''),vi:q.explain || q.explanation || q.options[q.answer]})),drills:questions.map((q,i)=>({q:[q.instruction?.replace('chữ Hán được gạch chân', '「'+q.target+'」'),q.passage,(q.sentence || q.sentence_jp || '').replace(/<[^>]+>/g,'')].filter(Boolean).join('\n'),opts:q.options,ans:q.options[q.answer],explanation:q.explain || q.explanation,item_id:quizProgressId(level,index,q,i)}))};
    });
  }
  return [];
}
function findFeatureLesson(feature,level,id){return featureLessons(feature,level).find(l=>l.id===id);}
async function renderFeatureLessonList(feature,level){
  const version=featureVersion,host=document.getElementById(feature==='flashcards'?'flashcard-lesson-list':'kaiwa-lesson-list');
  host.hidden=false;document.getElementById(feature==='flashcards'?'flashcard-review':'kaiwa-session').hidden=true;
  host.textContent='Đang tải bài học…';
  try{
    await Promise.all([ensureLessons(level),loadPracticalCourse(),loadCompletions()]);if(version!==featureVersion)return;
    const lessons=featureLessons(feature,level);
    host.innerHTML=`<header class="workspace-heading"><h1>${featureNames[feature]} ${level}</h1><span>${lessons.length} bài</span></header><div class="feature-lesson-grid">${lessons.map((l,i)=>`<a class="feature-lesson-card" href="#${feature}/${level}/lesson/${encodeURIComponent(l.id)}"><span class="lesson-list-number">${String(i+1).padStart(2,'0')}</span><h2>${escapeHtml(l.title)}</h2><p>${escapeHtml(l.items?.slice(0,4).map(w=>w.jp).join(' · ') || l.summary || '')}</p><span>${completionRecords.has(activityId(l,level,feature))?'Đã hoàn thành':''} ↗</span></a>`).join('')}</div>`;
    setupLessonFilter(host,lessons,'.feature-lesson-card');
  }catch{if(version!==featureVersion)return;host.textContent='Chưa tải được bài học. ';const retry=document.createElement('button');retry.textContent='Thử lại';retry.onclick=()=>renderFeatureLessonList(feature,level);host.append(retry);}
}
function addFeatureLessonAction(item,level,owner){
  if(!owner)return;
  const body=document.getElementById('modal-lesson-body'),back=body.querySelector('.modal-close-action');
  back.textContent=`Về ${featureNames[owner]}`;document.getElementById('btn-close-lesson-modal').textContent=`${featureNames[owner]} ${level}`;
  if(owner==='quiz')return;
  const button=document.createElement('button');button.className='stage-btn';
  button.textContent=owner==='flashcards'?'Ôn bằng thẻ nhớ':'Thực hành hội thoại';
  button.onclick=()=>switchTab(owner,{level,view:owner==='flashcards'?'review':'session',id:owner==='flashcards'?item.id:item.lessonKey});
  body.querySelector('.lesson-footer').prepend(button);
}

function lessonSearchText(lesson){
  return [lesson.title,lesson.summary,...(lesson.items || []).flatMap(item=>[item.jp,item.reading,item.ro,item.vi,item.en])].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase();
}
function setupLessonFilter(host,lessons,selector){
  const cards=[...host.querySelectorAll(selector)],texts=lessons.map(lessonSearchText);
  const filter=document.createElement('label');filter.className='lesson-search';filter.textContent='Tìm bài';
  const input=document.createElement('input');input.type='search';input.placeholder='Tên bài, từ hoặc chữ Hán';filter.append(input);
  const empty=document.createElement('p');empty.className='lesson-filter-empty';empty.hidden=true;empty.setAttribute('role','status');empty.textContent='Không tìm thấy bài.';
  cards[0]?.parentElement.before(filter);host.append(empty);
  input.oninput=()=>{
    const query=input.value.trim().normalize('NFKC').toLocaleLowerCase();let visible=0;
    cards.forEach((card,i)=>{card.hidden=!texts[i].includes(query);if(!card.hidden)visible++;});empty.hidden=visible>0;
  };
}
