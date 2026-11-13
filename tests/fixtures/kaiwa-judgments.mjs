export const testRubric = {question: 'お名前とお仕事を教えてください。', requirements: [
  {id: 'requirement_1', description: 'State your name.'},
  {id: 'requirement_2', description: 'State your occupation or current status.'}
]};

// Synthetic upstream judgments, not evidence of Japanese accuracy or model safety.
export function kaiwaJudgment(rubric, speech, overrides = {}) {
  const criterion = {verdict: 'met', evidence: [speech]};
  return {relevance: 'relevant',
    requirements: Object.fromEntries(rubric.requirements.map(item => [item.id, {...criterion, evidence: [...criterion.evidence]}])),
    grammar: {...criterion}, expression: {...criterion}, model_answer: '私はアンです。学生です。よろしくお願いします。', ...overrides};
}
