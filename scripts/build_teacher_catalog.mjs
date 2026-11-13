import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const root = new URL('../static/', import.meta.url);
const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];

function exampleData(example, source) {
  const tatoeba = /^https?:\/\/(?:www\.)?tatoeba\.org\/sentences\/show\/\d+(?:[/?#]|$)/i.test(example.source || '');
  const ungraded = source.includes('OpenJLPT') || tatoeba;
  return {...example, provenance: {
    source: tatoeba ? 'OpenJLPT / Tatoeba' : source,
    ...(example.source ? {url: example.source} : {}),
    ...(ungraded ? {sentence_level_certified: false,
      level_basis: tatoeba ? 'target vocabulary, not sentence-level certification'
        : 'lesson target, not sentence-level certification'} : {})
  }};
}

function compactWord(word) {
  return {jp: word.jp, reading: word.reading || word.ro || '', vi: word.vi || word.meaning_vi || ''};
}

function catalogQuestions(context, item, level, skill) {
  const checks = Array.from(context.lessonQuestions(item, level, skill));
  return Number.isInteger(item.examIndex) ? [...checks, ...(item.drills || []).slice(5)] : checks;
}

function lessonData(context, item, level, skill, course, sourceCatalog) {
  const unit = item.roleplay || course.units.find(unit => unit.id === item.lessonKey
    || item.id === `quiz-lesson:${level}:${unit.id}:review`);
  const source = item.source || item.sourceLabel || 'VJBot';
  const words = Array.from(item.items || item.roleplay?.words || item.targetWords || [], word => ({
    ...word, ...(word.examples ? {examples: Array.from(word.examples, example => exampleData(example, source))} : {})
  }));
  const examples = Array.from(item.examples || item.roleplay?.dialogue || [], example => exampleData(example, source));
  const questions = catalogQuestions(context, item, level, skill).map(question => {
    const example_indexes = examples.flatMap((example, index) =>
      (example.jp && question.q.includes(example.jp)) || question.ans === example.jp || question.ans === example.vi ? [index] : []);
    return {...question, explanation: question.explanation ?? null,
      example_indexes: example_indexes.length ? example_indexes : unit ? examples.map((_, index) => index) : []};
  });
  const sources = [];
  if (unit || source.includes('VJBot')) sources.push({id: 'vjbot', title: 'VJBot',
    authorship: course.authorship, level_note: course.level_note});
  if (source.includes('OpenJLPT')) sources.push({id: 'openjlpt', title: 'OpenJLPT',
    usage: 'Vocabulary-level study track; corpus example sentences are not sentence-level JLPT certified.'});
  if (!sources.length) sources.push({id: source, title: source});
  const sourceIds = new Set(unit?.source_ids || []);
  for (const resource of item.resources || []) sourceIds.add(resource.id);
  sources.push(...sourceCatalog.lessons.filter(resource => sourceIds.has(resource.id)));
  const overview = {
    formula: item.formula || unit?.formula, explanation: item.explanation || unit?.note, meaning_vi: item.meaning_vi,
    passage: item.passage, translation: item.translation, script_jp: item.script_jp, script_vi: item.script_vi,
    words: words.map(compactWord),
    // Beginner tracks classify vocabulary, not the difficulty of attached corpus sentences.
    examples: examples.filter(example => !['N5', 'N4'].includes(level)
      || example.provenance.sentence_level_certified !== false).slice(0, 3),
    task: item.production || unit?.production, external_resources: item.externalResources
  };
  // Normalize VM objects to JSON data without ever slicing serialized JSON or dropping addressable items.
  return JSON.parse(JSON.stringify({
    id: context.activityId(item, level, skill), level,
    title: item.roleplay ? `${item.roleplay.title} · ${item.title}` : item.title || item.jp || 'Bài học',
    goal: item.roleplay?.goal || item.summary || item.meaning_vi || '',
    overview, words, examples, questions, sources,
    reference_url: item.reference_url || unit?.reference_url
  }));
}

// Execute only repository-owned lesson builders at build time, never client or provider code.
export async function buildTeacherCatalog() {
  const context = vm.createContext({window: {}, fetch: async path => {
    const url = new URL(path, root);
    if (!url.href.startsWith(root.href)) throw new Error('Invalid catalog source');
    try {
      const text = await readFile(url, 'utf8');
      return {ok: true, json: async () => JSON.parse(text)};
    } catch (error) {
      if (error.code === 'ENOENT') return {ok: false};
      throw error;
    }
  }});
  for (const file of ['jlpt-data.js', 'vi-labels.js', 'learning.js', 'lesson-checks.js', 'study-plan.js', 'workspace.js', 'completion.js']) {
    vm.runInContext(await readFile(new URL(file, root), 'utf8'), context, {filename: file});
  }
  await context.loadPracticalCourse();
  context.installCourseKaiwa();
  const catalogs = {};
  const {practicalCourse, practicalSources} = vm.runInContext('({practicalCourse, practicalSources})', context);
  for (const level of levels) {
    await context.ensureLessons(level);
    const units = context.createStudyPlan(level);
    const entries = Object.entries(context.window.JLPT_DATA.curriculum[level].skills)
      .flatMap(([skill, lessons]) => lessons.map(item => ({item, skill})));
    entries.push(...units.flatMap(unit => unit.steps.filter(step => !step.kind).map(step => ({item: step.lesson, skill: step.skill}))));
    for (const feature of ['flashcards', 'kaiwa', 'quiz']) {
      entries.push(...context.featureLessons(feature, level).map(item => ({item, skill: feature === 'flashcards' ? 'vocabulary' : 'listening'})));
    }
    const lessons = Object.fromEntries(entries.map(({item, skill}) => {
      const data = lessonData(context, item, level, skill, practicalCourse, practicalSources);
      return [data.id, data];
    }));
    const items = Object.fromEntries(entries.flatMap(({item, skill}) => [
      ...catalogQuestions(context, item, level, skill).map(question => [question.item_id, question.q]),
      ...(item.production ? [[item.id, item.production.prompt]] : []),
      ...(item.dictation ? (item.examples || []).map((example, index) => [`${item.id}:${index}`, example.jp]) : [])
    ]));
    const scenarios = Object.fromEntries(Object.entries(context.window.JLPT_DATA.kaiwaScenarios)
      .filter(([, scenario]) => scenario.level === level || scenario.level === 'ALL')
      .map(([id, scenario]) => [id, {title: scenario.title, context: scenario.context || '',
        prompts: scenario.prompts.map(prompt => prompt.jp || 'こんにちは。よろしくお願いします。')} ]));
    catalogs[level] = {lessons, items, scenarios};
  }
  return catalogs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalogs = await buildTeacherCatalog();
  for (const [level, catalog] of Object.entries(catalogs)) {
    await writeFile(new URL(`course/teacher-${level}.json`, root), JSON.stringify(catalog));
    console.log(`${level}: ${Object.keys(catalog.lessons).length} lessons, ${Object.keys(catalog.items).length} progress items`);
  }
}
