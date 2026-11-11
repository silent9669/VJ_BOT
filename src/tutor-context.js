const LEVELS = new Set(['N5', 'N4', 'N3', 'N2', 'N1']);

export function validLessonReference(lesson) {
  return lesson && typeof lesson === 'object' && !Array.isArray(lesson)
    && Object.keys(lesson).every(key => ['id', 'level'].includes(key))
    && typeof lesson.id === 'string' && lesson.id.length > 0 && lesson.id.length <= 300
    && LEVELS.has(lesson.level);
}

export async function teacherCatalog(env, level) {
  if (!LEVELS.has(level) || !env.ASSETS) return null;
  const response = await env.ASSETS.fetch(new Request(`https://teacher-assets.invalid/course/teacher-${level}.json`));
  if (!response.ok) return null;
  try {
    const catalog = await response.json();
    return catalog && typeof catalog.lessons === 'object' && typeof catalog.items === 'object'
      && typeof catalog.scenarios === 'object' ? catalog : null;
  } catch { return null; }
}

export function catalogLesson(catalog, reference) {
  return Object.hasOwn(catalog.lessons, reference.id) ? catalog.lessons[reference.id] : null;
}

// Keys select private storage, never model instructions. Legacy messages remain archived.
export function conversationScope(channel, lesson, screen = null) {
  if (channel === 'quick') return `quick:${screen?.route || 'general'}`;
  return lesson ? `lesson:${lesson.level}:${lesson.id}` : 'chat';
}

export function chatEnvelope(message, lesson, screen, learner, history) {
  return JSON.stringify({message, reference: {lesson, screen, learner, history}});
}
