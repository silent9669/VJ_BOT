// Capture only canonical lesson/focus references and private scope metadata.
// Chat remembers the learning surface it hid, never a snapshot of DOM content.
(function () {
  let last = null, lastAt = 0, shownHash = '', selection = null;
  function visible(element) {
    if (!element) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(node) : node.style;
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
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
    if (panel.id === 'panel-lesson' && view === 'lesson' && parts.length === (owner === 'curriculum' ? 5 : 4) && typeof currentLesson !== 'undefined' && currentLesson?.item && currentLesson.level === activeLevel && owner === (currentLesson.owner || 'curriculum') && (owner !== 'curriculum' || parts[3] === currentLesson.skill)) {
      const {item, skill} = currentLesson;
      const ref = buildLessonContext(item, activeLevel, skill);
      const id = parts[parts.length - 1];
      if (id === item.id || id === ref.id) descriptor = {item, skill, lesson: ref};
    } else if (parts.length === 4 && activeLevel && typeof findFeatureLesson === 'function' && (owner === 'flashcards' || typeof practicalCourse === 'undefined' || practicalCourse)) {
      let item, skill;
      if (owner === 'kaiwa' && panel.id === 'panel-kaiwa' && view === 'session' && visible(document.getElementById('kaiwa-session'))
        && (typeof activeKaiwaKey === 'undefined' || activeKaiwaKey === parts[3])
        && (typeof activeKaiwaLevel === 'undefined' || activeKaiwaLevel === activeLevel)) {
        item = findFeatureLesson(owner, activeLevel, `kaiwa-lesson:${activeLevel}:${parts[3]}`); skill = 'listening';
      } else if (owner === 'flashcards' && panel.id === 'panel-flashcards' && view === 'review' && visible(document.getElementById('flashcard-review'))) {
        item = findFeatureLesson(owner, activeLevel, parts[3]); skill = 'vocabulary';
      } else if (owner === 'quiz' && panel.id === 'panel-quiz' && view === 'practice' && visible(document.getElementById('practice-workspace')) && visible(document.getElementById('quiz-card')) && typeof featureLessons === 'function') {
        const matches = /^\d+$/.test(parts[3]) ? featureLessons(owner, activeLevel).filter(item => item.examIndex === Number(parts[3])) : [];
        item = matches.length === 1 ? matches[0] : null; skill = 'reading';
      }
      if (item) descriptor = {item, skill, lesson: buildLessonContext(item, activeLevel, skill),
        quizSession: owner === 'quiz' && view === 'practice', scenarioId: owner === 'kaiwa' ? parts[3] : null};
    }
    return {panel, descriptor, level: activeLevel, route: (hash || '#' + panel.id.slice(6)).replace(/^#/, '').slice(0, 199)};
  }
  const key = lesson => lesson ? `${lesson.level}:${lesson.id}` : '';
  function validFocus(focus, descriptor) {
    if (!descriptor || !focus || Object.keys(focus).sort().join(',') !== 'index,kind' || !Number.isInteger(focus.index) || focus.index < 0) return null;
    const {item, skill, lesson} = descriptor;
    const collections={word:item.items || item.roleplay?.words || item.targetWords || [],example:item.examples || item.roleplay?.dialogue || [],question:typeof lessonQuestions==='function'?lessonQuestions(item,lesson.level,skill):[]};
    return collections[focus.kind] && focus.index < collections[focus.kind].length ? {kind: focus.kind, index: focus.index} : null;
  }
  function capture(hash = location.hash) {
    const current = surface(hash);
    if (!current) return null;
    const {panel, descriptor, level, route} = current;
    const lesson = descriptor?.lesson || null;
    const card=panel.id==='panel-flashcards' && document.getElementById('flashcard-card');
    let focus=key(lesson) === selection?.lesson ? validFocus(selection.focus, descriptor) : null;
    if(descriptor && visible(card) && card.dataset.teacherWordId){
      const index=(descriptor.item.items || []).findIndex(word=>(word.id || `fc-${level}-${word.jp}`)===card.dataset.teacherWordId);
      focus=validFocus({kind:'word',index},descriptor);
    }
    if (descriptor?.scenarioId && typeof activeKaiwaPromptIdx !== 'undefined') {
      const prompts = typeof window !== 'undefined' ? window.JLPT_DATA?.kaiwaScenarios?.[descriptor.scenarioId]?.prompts || [] : [];
      const prompt = Number.isInteger(activeKaiwaPromptIdx) && activeKaiwaPromptIdx >= 0
        ? prompts[activeKaiwaPromptIdx % Math.max(prompts.length, 1)] : null;
      const matches = (descriptor.item.examples || []).flatMap((example, index) => prompt?.jp && example.jp === prompt.jp ? [index] : []);
      focus = matches.length === 1 ? validFocus({kind: 'example', index: matches[0]}, descriptor) : null;
    }
    const task=focus?.kind==='question' && descriptor?lessonQuestions(descriptor.item,lesson.level,descriptor.skill)[focus.index]:null;
    return {screen:{route,level},lesson,focus,...(task?{task,view:descriptor.quizSession?'exam':'checks'}:{})};
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
