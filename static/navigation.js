const learningLevels=['N5','N4','N3','N2','N1'];
const learningSkills=['kana','grammar','vocabulary','kanji','reading','listening','production'];
let navigationVersion=0,currentLesson=null;
function parseAppRoute(hash){
  let parts;
  try{parts=hash.replace(/^#/,'').split('/').map(decodeURIComponent);}catch{return {tab:'landing'};}
  const [tab,level,view,skill,id]=parts;
  if(['kaiwa','kanji','flashcards','quiz'].includes(tab))return {tab,level:learningLevels.includes(level)?level:undefined,view:['practice','simulation'].includes(view)?view:undefined,id:skill};
  if(tab!=='curriculum')return {tab:Object.hasOwn(TAB_TITLES,tab) && tab!=='lesson'?tab:'landing'};
  if(!level)return {tab:'curriculum'};
  if(!learningLevels.includes(level))return {tab:'curriculum'};
  if(view==='lesson' && learningSkills.includes(skill) && id)return {tab:'lesson',level,skill,id};
  if(view==='library')return {tab:'curriculum',level,view:'library',skill:learningSkills.includes(skill)?skill:'grammar'};
  return {tab:'curriculum',level,view:'plan'};
}
function appRouteHash(tab,route={}){
  if(['kaiwa','kanji','flashcards','quiz'].includes(tab) && route.level)return `#${tab}/${route.level}${route.view?`/${route.view}/${encodeURIComponent(route.id || '0')}`:''}`;
  if(tab==='lesson')return `#curriculum/${route.level}/lesson/${route.skill}/${encodeURIComponent(route.id)}`;
  if(tab==='curriculum' && route.level)return `#curriculum/${route.level}${route.view==='library'?`/library/${route.skill || 'grammar'}`:''}`;
  return `#${tab}`;
}
function openLevelCourse(level,view='plan',skill='grammar',fromHistory=false){
  switchTab('curriculum',{level,view,skill,fromHistory});
}
function returnToCourse(){
  if(currentLesson?.returnTab==='kanji'){switchTab('kanji',{level:currentLesson.level});return;}
  const level=currentLesson?.level || activeCurriculumLevel;
  const view=currentLesson?.returnView || 'plan';
  openLevelCourse(level,view,view==='library'?currentLesson?.skill || 'grammar':'grammar');
}
async function restoreAppRoute(){
  const route=parseAppRoute(location.hash);
  if(!authorizePage(route.tab,route))return;
  if(route.tab!=='lesson'){switchTab(route.tab,{...route,fromHistory:true});return;}
  if(switchTab('lesson',{...route,fromHistory:true})===false)return;
  const version=navigationVersion;
  const host=document.getElementById('modal-lesson-body');host.textContent='Đang tải bài học…';
  document.getElementById('modal-lesson-title').textContent='Bài học';
  document.getElementById('modal-lesson-badge').textContent=route.level;
  currentLesson={level:route.level,skill:route.skill,returnView:'plan'};
  try{
    await Promise.all([ensureLessons(route.level),loadPracticalCourse()]);
    if(version!==navigationVersion)return;
    const units=createStudyPlan(route.level);
    const lessons=[...units.flatMap(u=>u.steps.filter(s=>!s.kind).map(s=>s.lesson)),...(window.JLPT_DATA.curriculum[route.level].skills[route.skill]||[])];
    let item=lessons.find(l=>activityId(l,route.level,route.skill)===route.id);
    if(!item && route.id.startsWith('jlpt:'))item=officialResourceLesson(route.level,route.id.split(':').at(-1));
    if(!item && route.id.startsWith('erin:')){const source=erinResources.lessons.find(l=>l.id===route.id);if(source)item=erinResourceLesson(source);}
    if(!item)throw new Error('missing');
    showLessonDetail(item,route.level,route.skill,true);
  }catch{
    if(version!==navigationVersion)return;
    host.textContent='Chưa mở được bài học. ';
    const retry=document.createElement('button');retry.className='stage-btn';retry.textContent='Thử lại';retry.onclick=restoreAppRoute;host.append(retry);
  }
}
function officialResourceLesson(level,type){
  const main=jlptResources.resources.find(r=>r.id===`jlpt:2018:${level}:${type}`);
  if(!main || !['V','G','R','L'].includes(type))return null;
  return {id:main.id,title:`${level} · ${main.title}`,sourceLabel:'JLPT · tài liệu chính thức',summary:'Làm bài trên tài liệu gốc, đối chiếu đáp án, rồi đánh dấu hoàn thành tại đây.',externalResources:jlptResources.resources.filter(r=>r.level===level && (r.id===main.id || /:(answer|sheet)$/.test(r.id) || (type==='L' && (r.kind==='audio' || r.id.endsWith(':script')))))};
}
function erinResourceLesson(lesson){
  return {id:lesson.id,title:lesson.title,lesson:lesson.number,sourceLabel:'Japan Foundation · Erin',summary:'Xem hội thoại cơ bản, học mẫu câu và đối chiếu với hội thoại mở rộng trên website gốc.',externalResources:lesson.resources};
}
async function renderLevelCards(){
  const host=document.getElementById('level-cards');
  host.setAttribute('aria-busy','true');
  host.textContent='Đang tải khóa học…';
  try{
    await loadPracticalCourse();
    const descriptions=[['Bắt đầu','Chữ cái, giới thiệu bản thân và những câu dùng hằng ngày.','あ'],['Nền tảng','Kể chuyện, diễn đạt dự định và xử lý tình huống quen thuộc.','話'],['Kết nối','Đọc thông tin, trình bày ý kiến và giao tiếp tự nhiên hơn.','道'],['Mở rộng','Theo dõi lập luận, đọc bài báo và diễn đạt sắc thái.','考'],['Chuyên sâu','Phân tích quan điểm, hàm ý và văn phong trang trọng.','論']];
    host.replaceChildren();
    for(const [index,level] of learningLevels.entries()){
      const [title,description,character]=descriptions[index];
      const chapters=courseChapters.chapters.filter(c=>c.level===level).length;
      const units=practicalCourse.units.filter(u=>u.level===level).length;
      const card=document.createElement('a');card.className='level-course-card';card.href=appRouteHash('curriculum',{level});
      card.innerHTML=`<div class="level-cover" data-level="${level}" aria-hidden="true"><span>${level}</span><img src="assets/courses/${level.toLowerCase()}.svg" alt="" width="300" height="168"><span lang="ja">${character}</span></div><div class="level-card-content"><h3>${level} <span>${title}</span></h3><p>${description}</p><div class="level-card-footer"><span>${chapters} chương · ${units} bài tình huống</span><span aria-hidden="true">↗</span></div></div>`;
      card.onclick=event=>{if(event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey){event.preventDefault();openLevelCourse(level);}};host.append(card);
    }
  }catch{
    host.textContent='Chưa tải được khóa học. ';
    const retry=document.createElement('button');retry.className='stage-btn';retry.textContent='Thử lại';retry.onclick=renderLevelCards;host.append(retry);
  }finally{host.setAttribute('aria-busy','false');}
}
function setupSidebar(){
  const sidebar=document.getElementById('app-sidebar'),toggle=document.getElementById('btn-mobile-sidebar'),backdrop=document.getElementById('sidebar-backdrop');
  const mobile=matchMedia('(max-width: 899px)');
  let expanded=localStorage.getItem('vjbot_sidebar_expanded')==='true';
  const paths={dashboard:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',kanji:'M4 4h16M12 2v6M6 9h12M12 9v12M4 20l8-8 8 8',landing:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',classroom:'M4 4h16v12H4zM8 21l4-5 4 5M8 8h8M8 12h4',curriculum:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16',flashcards:'M7 3h14v15H7zM3 7v14h14',kaiwa:'M4 4h16v12H9l-5 5zM8 8h8M8 12h5',quiz:'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',mastery:'M4 20V10M10 20V4M16 20v-7M22 20H2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'};
  for(const button of sidebar.querySelectorAll('[data-tab]')){
    const label=button.textContent.trim();button.setAttribute('aria-label',label);button.title=label;
    button.insertAdjacentHTML('afterbegin',`<svg class="rail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[button.dataset.tab]}"/></svg>`);
  }
  function draw(open=false){
    document.body.classList.toggle('sidebar-expanded',expanded);
    sidebar.classList.toggle('open',mobile.matches && open);backdrop.classList.toggle('active',mobile.matches && open);
    sidebar.inert=mobile.matches && !open;
    const isOpen=mobile.matches?open:expanded;
    toggle.setAttribute('aria-expanded',String(isOpen));toggle.setAttribute('aria-label',isOpen?'Thu gọn menu':'Mở menu');
    document.querySelector('.app-main').inert=mobile.matches && open;
    document.querySelector('.mobile-bottom-bar').inert=mobile.matches && open;
    document.getElementById('sensei-floating-dock').inert=mobile.matches && open;
  }
  window.closeAppSidebar=()=>draw(false);
  toggle.onclick=()=>{if(mobile.matches){draw(!sidebar.classList.contains('open'));sidebar.querySelector('button')?.focus();}else{expanded=!expanded;localStorage.setItem('vjbot_sidebar_expanded',String(expanded));draw();}};
  const close=document.getElementById('sidebar-close');close.onclick=()=>{draw(false);toggle.focus();};
  backdrop.onclick=()=>{draw(false);toggle.focus();};
  document.addEventListener('keydown',event=>{
    if(!mobile.matches || !sidebar.classList.contains('open'))return;
    if(event.key==='Escape'){draw(false);toggle.focus();}
    if(event.key==='Tab'){
      const buttons=[...sidebar.querySelectorAll('button,a[href]')].filter(e=>e.getClientRects().length),first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  mobile.addEventListener('change',()=>draw(false));draw();
}
