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

// Only the compact overview and one explicitly selected canonical item enter the model request.
export function groundLesson(lesson, focus = null) {
  if (!lesson || !lesson.overview) return null;
  let selected = null;
  if (focus !== null) {
    if (!validFocusReference(focus)) return null;
    const items = lesson[{word: 'words', example: 'examples', question: 'questions'}[focus.kind]];
    if (!Array.isArray(items) || focus.index >= items.length) return null;
    const item = items[focus.index];
    selected = {kind: focus.kind, index: focus.index, item};
    if (focus.kind === 'question') {
      selected.examples = (item.example_indexes || []).map(index => lesson.examples[index]);
    }
  }
  const context = {id: lesson.id, level: lesson.level, title: lesson.title, goal: lesson.goal,
    overview: lesson.overview, sources: lesson.sources, reference_url: lesson.reference_url, focus: selected};
  // Fail closed on an oversized canonical object rather than sending malformed partial JSON.
  return JSON.stringify(context).length <= 48000 ? context : null;
}

// Keys select private storage, never model instructions. Legacy messages remain archived.
export function conversationScope(channel, lesson, screen = null) {
  if (channel === 'quick') return `quick:${screen?.route || 'general'}`;
  return lesson ? `lesson:${lesson.level}:${lesson.id}` : 'chat';
}

export function chatEnvelope(message, lesson, screen, learner, history, teaching = null) {
  return JSON.stringify({message, reference: {lesson, screen, learner, history, teaching}});
}
