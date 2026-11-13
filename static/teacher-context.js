// Capture source material, not generated feedback or learner submissions. Chat remembers
// the complete context from the screen it hid; other learning surfaces always own theirs.
(function () {
  const EXCLUDED = 'input,textarea,select,output,script,style,#kaiwa-result-card,.practice-feedback,.practice-result,.production-feedback,[data-teacher-exclude],#lesson-completion,#kaiwa-completion,#quiz-feedback-box,#quiz-result-card,.exam-review-table,#simulation-completion';
  let last = null, lastAt = 0, shownHash = '', selection = null;
  function visible(element) {
    if (!element) return false;
    const card=document.getElementById('flashcard-card');
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : node.style;
      // 3D transforms hide a face visually without changing computed visibility.
      if(card && node.matches?.('.card-front,.card-back')){
        const flipped=card.classList.contains('flipped');
        if(node.matches('.card-back')!==flipped)return false;
      }
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  }
  function sourceText(element) {
    if (!visible(element) || element.matches?.(EXCLUDED)) return '';
    const children = element.tagName === 'DETAILS' && !element.open
      ? Array.from(element.childNodes).filter(n => n.tagName === 'SUMMARY') : element.childNodes;
    return Array.from(children || []).map(node => node.nodeType === 3 ? node.textContent : node.nodeType === 1 ? sourceText(node) : '').join('\n');
  }
  function surface(hash = location.hash) {
    const panel = document.querySelector('.tab-panel.active');
    if (!visible(panel) || /^panel-(landing|classroom|admin|settings)$/.test(panel.id)) return null;
    let parts;
    try { parts = (hash || '#' + panel.id.slice(6)).replace(/^#/, '').split('/').map(decodeURIComponent); }
    catch { return null; }
    const [owner, level, view] = parts;
    const activeLevel = /^N[1-5]$/.test(level || '') ? level : '';
    let descriptor = null;
    if (panel.id === 'panel-lesson' && view === 'lesson' && typeof currentLesson !== 'undefined' && currentLesson?.item && currentLesson.level === activeLevel && owner === (currentLesson.owner || 'curriculum') && (owner !== 'curriculum' || parts[3] === currentLesson.skill)) {
      const {item, skill} = currentLesson;
      const ref = buildLessonContext(item, activeLevel, skill);
      const id = parts[parts.length - 1];
      if (id === item.id || id === ref.id) descriptor = {item, skill, lesson: ref};
    } else if (activeLevel && typeof findFeatureLesson === 'function' && (owner === 'flashcards' || typeof practicalCourse === 'undefined' || practicalCourse)) {
      let item, skill;
      if (owner === 'kaiwa' && panel.id === 'panel-kaiwa' && view === 'session' && visible(document.getElementById('kaiwa-session'))) {
        item = findFeatureLesson(owner, activeLevel, `kaiwa-lesson:${activeLevel}:${parts[3]}`); skill = 'listening';
      } else if (owner === 'flashcards' && panel.id === 'panel-flashcards' && view === 'review' && visible(document.getElementById('flashcard-review'))) {
        item = findFeatureLesson(owner, activeLevel, parts[3]); skill = 'vocabulary';
      } else if (owner === 'quiz' && panel.id === 'panel-quiz' && view === 'practice' && visible(document.getElementById('practice-workspace')) && visible(document.getElementById('quiz-card')) && typeof featureLessons === 'function') {
        item = featureLessons(owner, activeLevel).find(item => item.examIndex === Number(parts[3])); skill = 'reading';
      }
      if (item) descriptor = {item, skill, lesson: buildLessonContext(item, activeLevel, skill), quizSession: owner === 'quiz' && view === 'practice'};
    }
    return {panel, descriptor, level: activeLevel, route: (hash || '#' + panel.id.slice(6)).replace(/^#/, '').slice(0, 199)};
  }
  const key = lesson => lesson ? `${lesson.level}:${lesson.id}` : '';
  function validFocus(focus, descriptor) {
    if (!descriptor || !focus || Object.keys(focus).sort().join(',') !== 'index,kind' || !Number.isInteger(focus.index) || focus.index < 0) return null;
    const {item, skill, lesson} = descriptor;
    const collections = {word: item.items || item.roleplay?.words || item.targetWords || [], example: item.examples || item.roleplay?.dialogue || [], question: descriptor.quizSession ? item.drills || [] : typeof lessonQuestions === 'function' ? lessonQuestions(item, lesson.level, skill) : []};
    return collections[focus.kind] && focus.index < collections[focus.kind].length ? {kind: focus.kind, index: focus.index} : null;
  }
  function capture(hash = location.hash) {
    const current = surface(hash);
    if (!current) return null;
    const {panel, descriptor, level, route} = current;
    const session = panel.id === 'panel-kaiwa' && document.getElementById('kaiwa-session');
    const text = (visible(session)
      ? ['kaiwa-context', 'kaiwa-prompt-jp', 'kaiwa-prompt-vi'].map(id => sourceText(document.getElementById(id))).join('\n')
      : sourceText(panel)).replace(/[ \t]+/g, ' ').replace(/ ?\n[ \n]*/g, '\n').trim().slice(0, 3500);
    if (!text) return null;
    const lesson = descriptor?.lesson || null;
    const card=panel.id==='panel-flashcards' && document.getElementById('flashcard-card');
    let focus=key(lesson) === selection?.lesson ? validFocus(selection.focus, descriptor) : null;
    if(descriptor && visible(card) && card.dataset.teacherWordId){
      const index=(descriptor.item.items || []).findIndex(word=>(word.id || `fc-${level}-${word.jp}`)===card.dataset.teacherWordId);
      focus=validFocus({kind:'word',index},descriptor);
    }
    return {screen: {route, title: (panel.id === 'panel-lesson' ? document.getElementById('modal-lesson-title')?.textContent : document.getElementById('topbar-view-title')?.textContent || '').trim().slice(0, 200), level, text}, lesson, focus};
  }
  globalThis.setTeacherFocus = focus => {
    const before=capture();
    const descriptor = surface()?.descriptor;
    const valid = validFocus(focus, descriptor);
    selection = valid ? {lesson: key(descriptor.lesson), focus: valid} : null;
    const after=capture();
    if(key(before?.lesson)!==key(after?.lesson) || JSON.stringify(before?.focus || null)!==JSON.stringify(after?.focus || null))globalThis.invalidateTeacherQuery?.();
  };
  // The hash may already name the destination during hashchange navigation.
  globalThis.markTeacherScreen = () => { if (shownHash !== location.hash) selection = null; shownHash = location.hash; };
  globalThis.rememberTeacherScreen = () => { const context = capture(shownHash || location.hash); if (context) { last = context; lastAt = Date.now(); } };
  globalThis.teacherContext = () => {
    const live = capture();
    if (live) return live;
    // A hidden/empty learning screen must not borrow a different lesson's context.
    const panel = document.querySelector('.tab-panel.active');
    return panel?.id === 'panel-classroom' && Date.now() - lastAt < 30 * 60000 ? last : null;
  };
  globalThis.clearTeacherContext = () => { last = null; lastAt = 0; selection = null; };
})();
