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
    await Promise.all([ensureLessons(route.level),loadCompletions()]);if(version!==featureVersion)return;
    host.replaceChildren();
    const lessons=window.JLPT_DATA.curriculum[route.level].skills.kanji;
    for(const lesson of lessons){
      const button=document.createElement('button');button.className='kanji-set';
      const chars=document.createElement('span'),label=document.createElement('strong');
      chars.lang='ja';chars.textContent=lesson.items.slice(0,6).map(i=>i.jp).join(' ');label.textContent=`Bộ ${lesson.lesson} · ${lesson.items.length} chữ`;
      button.append(chars,label);button.onclick=()=>{showLessonDetail(lesson,route.level,'kanji');currentLesson.returnTab='kanji';};host.append(button);
    }
    setupLessonFilter(work,lessons,'.kanji-set',lessons.map(lesson=>completionRecords.has(activityId(lesson,route.level,'kanji'))));
  }catch{host.textContent='Chưa tải được Kanji. ';const retry=document.createElement('button');retry.textContent='Thử lại';retry.onclick=()=>renderFeaturePage(feature,route);host.append(retry);}
}
async function renderDashboard(){
  const version=featureVersion;
  const host=document.getElementById('dashboard-content');
  document.getElementById('dashboard-greeting').textContent=`${signedInUser?.name || 'Học viên'} · ${activeCurriculumLevel}`;
  host.textContent='Đang tải tiến độ…';
  try{
    const response=await apiFetch('/api/progress');if(!response.ok)throw new Error('progress');
    const [progress,completed]=await Promise.all([response.json(),loadCompletions()]);
    const due=(progress.items || []).filter(i=>i.next_review && new Date(i.next_review)<=new Date()).length;
    await Promise.all([ensureLessons(activeCurriculumLevel),loadPracticalCourse()]);
    if(version!==featureVersion)return;
    const units=createStudyPlan(activeCurriculumLevel);
    const next=units.filter(u=>!u.optional && !completed.has(u.id)).flatMap(u=>u.steps).find(step=>!completed.has(activityId(step.lesson,activeCurriculumLevel,step.skill)));
    const nextTitle=next?.lesson.title || 'Ôn lại bài học';
    const nextHref=next?appRouteHash('lesson',{level:activeCurriculumLevel,skill:next.skill,id:activityId(next.lesson,activeCurriculumLevel,next.skill)}):`#curriculum/${activeCurriculumLevel}`;
    const required=units.filter(unit=>!unit.optional);
    const chapterDone=unit=>completed.has(unit.id) || unit.steps.every(step=>completed.has(activityId(step.lesson,activeCurriculumLevel,step.skill)));
    const courseRows=required.slice(0,4);
    const recent=[...completed.values()].sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||'')).slice(0,4);
    host.innerHTML=`<a class="dashboard-next" href="${escapeHtml(nextHref)}"><span class="dashboard-next-label">Học tiếp · ${activeCurriculumLevel}</span><h2>${escapeHtml(nextTitle)}</h2><span class="dashboard-next-action">Mở bài học ↗</span></a>
      <dl class="dashboard-numbers"><div><dt>Bài hoàn thành</dt><dd>${completed.size}</dd></div><div><dt>Đến hạn ôn</dt><dd>${due}</dd></div><div><dt>Ngày liên tiếp</dt><dd>${Number(progress.streak_days)||0}</dd></div></dl>
      <div class="dashboard-grid"><section class="dashboard-course"><header class="dashboard-section-heading"><h2>Lộ trình ${activeCurriculumLevel}</h2><a href="#curriculum/${activeCurriculumLevel}">Tất cả ↗</a></header>
        <div class="dashboard-chapters">${courseRows.map((unit,index)=>`<a href="#curriculum/${activeCurriculumLevel}"><span class="dashboard-chapter-index">${String(index+1).padStart(2,'0')}</span><span>${escapeHtml(unit.title)}</span><span>${chapterDone(unit)?'Hoàn thành':unit.steps.filter(step=>completed.has(activityId(step.lesson,activeCurriculumLevel,step.skill))).length+'/'+unit.steps.length}</span></a>`).join('')}</div>
        <nav class="dashboard-levels" aria-label="Khóa học JLPT">${learningLevels.map(level=>`<a href="#curriculum/${level}" ${level===activeCurriculumLevel?'aria-current="true"':''}>${level}</a>`).join('')}</nav></section>
      <section class="dashboard-practice"><header class="dashboard-section-heading"><h2>Luyện tập</h2></header><div class="dashboard-tools"><a href="#classroom"><h3>Thầy Lâm</h3><span>Hỏi &amp; luyện phản xạ</span><span aria-hidden="true">↗</span></a>${Object.entries(featureNames).map(([key,name],index)=>`<a href="#${key}/${activeCurriculumLevel}"><h3>${name}</h3><span>${['Ghi nhớ từ','Hội thoại tình huống','Chữ & cách đọc','Bộ đề theo cấp độ'][index]}</span><span aria-hidden="true">↗</span></a>`).join('')}</div></section></div>
      <section class="dashboard-recent"><header class="dashboard-section-heading"><h2>Vừa hoàn thành</h2><a href="#mastery">Tiến độ ↗</a></header>${recent.map(item=>`<p><span>${escapeHtml(item.level)}</span><strong>${escapeHtml(item.title)}</strong><time>${item.completed_at?new Date(item.completed_at).toLocaleDateString('vi-VN'):''}</time></p>`).join('') || '<p class="dashboard-empty">Chưa có bài hoàn thành.</p>'}</section>`;
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
    const timed=route.view==='catalog' && route.id==='simulation';
    host.innerHTML=`<header class="workspace-heading"><h1>Bài luyện JLPT ${route.level}</h1></header><nav class="exam-catalog-nav" aria-label="Loại bài luyện"><a href="#quiz/${route.level}" ${timed?'':'aria-current="page"'}>Luyện theo bài</a><a href="#quiz/${route.level}/catalog/simulation" ${timed?'aria-current="page"':''}>Thi thử có giờ</a></nav>`;
    if(timed){
      host.innerHTML+=`<p class="exam-source-note">Đề chính thức của Japan Foundation · JEES. Tự đối chiếu đáp án sau mỗi phần; kết quả không quy đổi sang thang điểm JLPT.</p><div class="exam-grid">${examConfig.papers.filter(p=>p.level===route.level).map((p,i)=>`<a class="exam-set official" href="#quiz/${route.level}/simulation/${p.year}"><span class="exam-set-index">${String(i+1).padStart(2,'0')}</span><div class="exam-set-copy"><h2>Đề chính thức ${p.year}</h2><p>${p.sections.reduce((n,s)=>n+s.minutes,0)} phút · ${p.sections.length} phần</p></div><span class="exam-set-action">Chuẩn bị ↗</span></a>`).join('')}</div>`;
    }else{
      const lessons=featureLessons('quiz',route.level);
      host.innerHTML+=`<div class="exam-grid">${lessons.map((e,i)=>`<a class="exam-set" href="#quiz/${route.level}/lesson/${encodeURIComponent(e.id)}"><span class="exam-set-index">${String(i+1).padStart(2,'0')}</span><div class="exam-set-copy"><h2>${escapeHtml(e.title)}</h2><p>${lessonQuestions(e,route.level,'reading').length} câu · ${escapeHtml(e.summary)}</p></div><span class="exam-set-action">${completionRecords.has(activityId(e,route.level,'quiz'))?'Ôn lại':'Luyện bài'} ↗</span></a>`).join('')}</div>`;
      setupLessonFilter(host,lessons,'.exam-set',lessons.map(e=>completionRecords.has(activityId(e,route.level,'quiz'))));
    }
  }catch{host.hidden=false;host.textContent='Chưa mở được bộ đề. ';const b=document.createElement('button');b.textContent='Thử lại';b.onclick=()=>renderExamCatalog({...route,view:undefined});host.append(b);}
}
function featureLessons(feature,level){
  const skills=window.JLPT_DATA.curriculum[level].skills;
  if(feature==='flashcards')return skills.vocabulary.filter(l=>l.items?.length).map(l=>({...l,id:l.id || `lesson:${level}:vocabulary:${l.lesson}`}));
  if(feature==='kaiwa'){
    installCourseKaiwa();
    return Object.entries(window.JLPT_DATA.kaiwaScenarios).filter(([,s])=>s.level===level || s.level==='ALL').map(([key,s])=>{
      const unit=practicalCourse.units.find(u=>u.id===key);
      const prompts=s.prompts.flatMap(p=>[{jp:p.jp,vi:p.vi,ro:p.ro},...(p.responses || [])]);
      // Keep dialogue indexes stable; speaking may ask a separate production question.
      const examples=unit?[...unit.dialogue,...prompts.filter(prompt=>!unit.dialogue.some(example=>example.jp===prompt.jp && example.vi===prompt.vi))]:prompts;
      return {id:`kaiwa-lesson:${level}:${key}`,completionId:s.course?`kaiwa:${key}`:`kaiwa:${level}:${key}`,title:s.title,summary:unit?.goal || s.desc,lessonKey:key,sourceLabel:'VJBot · hội thoại',examples,items:unit?.words,drills:unit?.questions,formula:unit?.formula,explanation:unit?.note};
    });
  }
  if(feature==='quiz'){
    createStudyPlan(level);addPracticeSets(level);
    return window.JLPT_DATA.exams[level].map((exam,index)=>{
      const questions=exam.questions;
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
    setupLessonFilter(host,lessons,'.feature-lesson-card',lessons.map(lesson=>completionRecords.has(activityId(lesson,level,feature))));
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
function setupLessonFilter(host,lessons,selector,done=lessons.map(()=>false)){
  const cards=[...host.querySelectorAll(selector)],texts=lessons.map(lessonSearchText);
  const filter=document.createElement('label');filter.className='lesson-search';filter.textContent='Tìm bài';
  const input=document.createElement('input');input.type='search';input.placeholder='Tên bài, từ hoặc chữ Hán';filter.append(input);
  const statusLabel=document.createElement('label');statusLabel.className='lesson-status';statusLabel.textContent='Tiến độ';
  const status=document.createElement('select');
  for(const [value,text] of [['all','Tất cả'],['todo','Chưa hoàn thành'],['done','Đã hoàn thành']]){const option=document.createElement('option');option.value=value;option.textContent=text;status.append(option);}
  statusLabel.append(status);
  const toolbar=document.createElement('div');toolbar.className='lesson-toolbar';toolbar.append(filter,statusLabel);
  const count=document.createElement('p');count.className='lesson-count';count.setAttribute('role','status');
  const empty=document.createElement('p');empty.className='lesson-filter-empty';empty.hidden=true;empty.textContent='Không tìm thấy bài.';
  const more=document.createElement('button');more.type='button';more.className='stage-btn';more.textContent='Xem thêm 24 bài';
  cards[0]?.parentElement.before(toolbar,count);host.append(empty,more);
  let limit=24;
  const apply=(reset=true)=>{
    if(reset)limit=24;
    const query=input.value.trim().normalize('NFKC').toLocaleLowerCase();let matched=0;
    cards.forEach((card,i)=>{const match=texts[i].includes(query) && (status.value==='all' || done[i]=== (status.value==='done'));card.hidden=!match || matched>=limit;if(match)matched++;});
    empty.hidden=matched>0;count.textContent=`${Math.min(limit,matched)} / ${matched} bài`;more.hidden=matched<=limit;
  };
  input.oninput=()=>apply();status.onchange=()=>apply();more.onclick=()=>{limit+=24;apply(false);};apply();
}
