import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';

const root = new URL('../static/', import.meta.url);
const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];

function lessonData(context, item, level, skill) {
  return {
    id: context.activityId(item, level, skill), level,
    title: item.roleplay ? `${item.roleplay.title} · ${item.title}` : item.title || item.jp || 'Bài học',
    goal: item.roleplay?.goal || item.summary || item.meaning_vi || '',
    content: JSON.stringify({formula: item.formula, explanation: item.explanation, passage: item.passage,
      translation: item.translation, script_jp: item.script_jp, script_vi: item.script_vi,
      examples: item.examples?.slice(0, 3), words: item.items?.slice(0, 5), task: item.production,
      external_resources: item.externalResources}).slice(0, 3500)
  };
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
      const data = lessonData(context, item, level, skill);
      return [data.id, data];
    }));
    const items = Object.fromEntries(entries.flatMap(({item, skill}) => [
      ...context.lessonQuestions(item, level, skill).map(question => [question.item_id, question.q]),
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
