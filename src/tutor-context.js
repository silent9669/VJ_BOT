const LEVELS = new Set(['N5', 'N4', 'N3', 'N2', 'N1']);
let latestCatalog = null;

export function validLessonReference(lesson) {
  return lesson && typeof lesson === 'object' && !Array.isArray(lesson)
    && Object.keys(lesson).every(key => ['id', 'level'].includes(key))
    && typeof lesson.id === 'string' && lesson.id.length > 0 && lesson.id.length <= 300
    && LEVELS.has(lesson.level);
}

export function validFocusReference(focus) {
  return !!focus && typeof focus === 'object' && !Array.isArray(focus)
    && Object.keys(focus).length === 2 && Object.hasOwn(focus, 'kind') && Object.hasOwn(focus, 'index')
    && ['word', 'example', 'question'].includes(focus.kind)
    && Number.isInteger(focus.index) && focus.index >= 0;
}

export async function teacherCatalog(env, level) {
  if (!LEVELS.has(level) || !env.ASSETS) return null;
  if(latestCatalog?.assets===env.ASSETS && latestCatalog.level===level)return latestCatalog.promise;
  // Retain one public level at most; N1 alone is 13 MB before parsing. No learner data is cached.
  const entry={assets:env.ASSETS,level,promise:null};
  entry.promise=(async()=>{
    try {
      // ASSETS resolves by path. Its Vite dev bridge also validates the synthetic request host.
      const response=await env.ASSETS.fetch(new Request(`https://assets.localhost/course/teacher-${level}.json`));
      if(!response.ok)return null;
      const catalog=await response.json();
      return catalog && typeof catalog.lessons==='object' && typeof catalog.items==='object'
        && typeof catalog.scenarios==='object' ? catalog : null;
    } catch { return null; }
  })();
  latestCatalog=entry;
  const catalog=await entry.promise;
  if(!catalog && latestCatalog===entry)latestCatalog=null;
  return catalog;
}

export function catalogLesson(catalog, reference) {
  return Object.hasOwn(catalog.lessons, reference.id) ? catalog.lessons[reference.id] : null;
}

export function validTaskReference(task) {
  return !!task && typeof task === 'object' && !Array.isArray(task)
    && Object.keys(task).length === 2 && typeof task.id === 'string' && task.id.length <= 500
    && typeof task.revision === 'string' && /^[a-f0-9]{64}$/.test(task.revision);
}

export function processingAllowed(value) {
  return value?.processing_allowed !== false && value?.capabilities?.processing !== false
    && value?.review_status !== 'quarantined' && !value?.unavailable_reason;
}

export function referenceProcessingAllowed(value){
  if(!value || typeof value!=='object')return true;
  if(!processingAllowed(value))return false;
  return ['examples','words'].every(key=>!Array.isArray(value[key]) || value[key].every(referenceProcessingAllowed))
    && ['overview','task'].every(key=>!value[key] || referenceProcessingAllowed(value[key]));
}

export function resolveTaskReference(lesson, focus, view, reference, capability = 'processing') {
  const task = focus?.kind === 'question' && validFocusReference(focus) && ['checks','exam'].includes(view)
    ? lesson?.[view === 'exam' ? 'exam_questions' : 'questions']?.[focus.index] : null;
  if (!task || !validTaskReference(reference) || task.task_id !== reference.id || task.revision !== reference.revision) {
    return {error:'This task changed. Reopen the exercise before continuing.',status:409};
  }
  if (!processingAllowed(lesson) || !processingAllowed(task) || task.capabilities?.[capability] === false
    || typeof task.item_id !== 'string' || !task.item_id || typeof task.q !== 'string' || !task.q.trim()
    || !['unreviewed','approved'].includes(task.review_status)
    || !['choice','recall','dictation','writing'].includes(task.mode)
    || task.mode === 'choice' && (!Array.isArray(task.opts) || task.opts.length < 2
      || !task.opts.every(option => typeof option === 'string' && option.trim())
      || !Number.isInteger(task.answer_index) || task.answer_index < 0 || task.answer_index >= task.opts.length)
    || ['recall','dictation'].includes(task.mode) && (!Array.isArray(task.accepted_answers)
      || !task.accepted_answers.length || !task.accepted_answers.every(answer => typeof answer === 'string' && answer.trim()))) {
    return {error:task.unavailable_reason || 'This task is unavailable for teaching or assessment.',status:409};
  }
  return {task,reference:{id:task.task_id,revision:task.revision}};
}

// Allowlist, never redact by alias: source records may have arbitrary solution/gloss fields.
export function taskEvidence(task) {
  return {task_id:task.task_id,item_id:task.item_id,mode:task.mode,q:task.q,instruction:task.instruction || '',
    ...(task.mode === 'dictation' ? {} : {passage:task.passage || '',script_jp:task.script_jp || '',
      target:task.target || '',parts:task.parts || []}),
    opts:task.mode === 'choice' ? task.opts : [],review_status:task.review_status || 'unreviewed',
    ...(['meaning','structure','orthography','transformation','communication'].includes(task.objective)?{objective:task.objective}:{})};
}

export function taskResultBasis(task) {
  if (task.mode === 'writing') return 'self_report';
  // An editorial label alone is not evidence of a real review.
  const review = task.review_metadata;
  return task.review_status === 'approved' && typeof review?.reviewer === 'string' && review.reviewer.trim()
    && typeof review.reviewed_at === 'string' && !Number.isNaN(Date.parse(review.reviewed_at))
    ? 'reviewed_source' : 'source_advisory';
}

// Only the compact overview and one explicitly selected canonical item enter the model request.
export function groundLesson(lesson, focus = null, view = 'checks') {
  if (!lesson || !lesson.overview || !processingAllowed(lesson) || !['checks', 'exam'].includes(view)
    || view === 'exam' && focus?.kind !== 'question') return null;
  let selected = null;
  if (focus !== null) {
    if (!validFocusReference(focus)) return null;
    const items = lesson[focus.kind === 'question' && view === 'exam' ? 'exam_questions'
      : {word: 'words', example: 'examples', question: 'questions'}[focus.kind]];
    if (!Array.isArray(items) || focus.index >= items.length) return null;
    const item = items[focus.index];
    if (!processingAllowed(lesson) || !processingAllowed(item)) return null;
    selected = {kind: focus.kind, index: focus.index, item:focus.kind === 'question' ? taskEvidence(item) : item};
  }
  if(focus?.kind!=='question' && (!referenceProcessingAllowed(lesson.overview)
    || selected && !referenceProcessingAllowed(selected.item)))return null;
  const context = focus?.kind === 'question'
    ? {id:lesson.id,level:lesson.level,focus:selected,...(view === 'exam' ? {view} : {})}
    : {id: lesson.id, level: lesson.level, title: lesson.title, goal: lesson.goal,
      overview: lesson.overview, sources: lesson.sources, reference_url: lesson.reference_url, focus: selected,
      ...(view === 'exam' ? {view} : {})};
  // Fail closed on an oversized canonical object rather than sending malformed partial JSON.
  return JSON.stringify(context).length <= 48000 ? context : null;
}

// Keys select private storage, never model instructions. Legacy messages remain archived.
export function conversationScope(channel, lesson, screen = null) {
  if (channel === 'quick') return `quick:${screen?.route || 'general'}`;
  return lesson ? `lesson:${lesson.level}:${lesson.id}` : 'chat';
}

export function chatEnvelope(message, lesson, screen, learner, history, teaching = null) {
  const learnerHistory = history.filter(turn => turn.role === 'user' && typeof turn.content === 'string')
    .slice(-12).map(turn => ({role: 'user', content: turn.content.slice(0, 6000)}));
  const context_status = lesson ? 'canonical_lesson' : screen ? 'unresolved_screen' : 'no_screen';
  return JSON.stringify({message, reference: {lesson, context_status, learner, history: learnerHistory, teaching}});
}
