import {taskResultBasis} from './tutor-context.js';

const objectives=new Set(['meaning','structure','orthography','transformation','communication']);
const normalized=text=>text.normalize('NFC').trim();
// Only local Japanese spacing and one terminal full stop are cosmetic. Keep numbers,
// negation, question marks, internal punctuation and ASCII token boundaries intact.
const japanese='[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー々]';
const localSpace=new RegExp(`(?<=${japanese})[ \\t\\u3000]+(?=${japanese})`,'gu');
const numericBoundary=/(?:[〇零一二三四五六七八九十百千万億兆][ \t\u3000]|[ \t\u3000][〇零一二三四五六七八九十百千万億兆])/u;
const cosmetic=text=>{
  const value=normalized(text);
  return (numericBoundary.test(value)?value:value.replace(localSpace,'')).replace(/(?<!。)。$/u,'');
};

// Literal source agreement is not semantic grading; never rewrite the submission or key.
export function assessTaskResponse(task,submission) {
  const writing=task.mode==='writing',basis=writing?'self_report':Object.hasOwn(submission,'self_rating')?'self_report':taskResultBasis(task);
  const text=typeof submission.response_text==='string'?submission.response_text:null;
  const answers=Array.isArray(task.accepted_answers)?task.accepted_answers:[];
  const source_correct=writing?null:task.mode==='choice'?submission.answer_index===task.answer_index
    :text===null?null:answers.some(answer=>normalized(answer)===normalized(text));
  const objective=objectives.has(task.objective)?task.objective:null;
  const comparison=writing || source_correct===null?'unassessed':source_correct?'reference_match'
    :task.mode!=='choice' && objective!=='orthography' && answers.some(answer=>cosmetic(answer)===cosmetic(text))
      ?'orthographic_difference':'different_reference';
  return {source_correct,basis,verified:!writing && basis==='reviewed_source',
    ...(objective || writing?{assessment:{objective,comparison,submitted_text:text,
      meaning:'uncertain',structure:'uncertain',orthography:comparison==='orthographic_difference'?'cosmetic_difference':'unassessed',
      semantic_verified:false}}:{})};
}
