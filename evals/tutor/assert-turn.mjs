const tags=/<\/?(?:ja|vi)>/iu;
const japanese=/[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u;
const welcome=/^(?:[-*"“「]\s*)?(?:(?:thầy(?: lâm)? )?chào(?=\s|\p{P}|$)|xin chào\b|(?:おはよう(?:ございます)?|こんにちは|こんばんは|はじめまして)(?:[！!、。\s]|$))/iu;
const assignedTask=/[?？]|_{2,}|＿+|điền (?:vào )?chỗ trống|em (?:hãy|thử|có thể) (?:đặt|dịch|trả lời|viết|luyện|giới thiệu)/iu;
const greeting=/^(?:chào\b|xin chào\b|hi\b|hello\b|hey\b|おはよう|こんにちは|こんばんは|やあ)/iu;

export function validSegments(segments,reply) {
  if (!Array.isArray(segments) || !segments.length || segments.length>16) return false;
  let length=0;
  return segments.every((part,index)=>{
    if (part?.index!==index || !['ja','vi'].includes(part.lang)
      || !(index ? ['inline','sentence'].includes(part.boundary) : part.boundary==='start')
      || typeof part.text!=='string' || !part.text.trim() || tags.test(part.text)
      || part.speech_start!==undefined && (!Number.isInteger(part.speech_start) || part.speech_start<0 || part.speech_start>part.text.length)) return false;
    length+=part.text.length+9+Number(index>0);
    return length<=4000;
  }) && segments.map(part=>part.text).join(' ')===reply;
}

export default function assertTurn(output,{vars}) {
  const fail=reason=>({pass:false,score:0,reason});
  let row;
  try {row=JSON.parse(output);} catch {return fail('Invalid recording JSON.');}
  if (!row || row.status!==200 || row.error || typeof row.reply!=='string' || !row.reply.trim()) {
    return fail('The tutor turn did not complete successfully. Inspect transport separately.');
  }
  if (tags.test(row.reply) || /^\s*```/.test(row.reply)) return fail('Transport markup was visible to the learner.');
  if (row.channel==='live') {
    if (!validSegments(row.segments,row.reply)) return fail('The final spoken turn does not match the ordered segments.');
  } else if (row.channel!=='chat') return fail('Unknown channel.');
  if (vars.check && vars.check!=='greeting' && welcome.test(row.reply)) return fail('The tutor greeted again before doing the requested work.');
  if (vars.check==='greeting' && (!greeting.test(row.reply) || assignedTask.test(row.reply) || row.opened_new_probe
    || /thầy là (?:thầy )?lâm\b|chào mừng/iu.test(row.reply))) return fail('Return a short greeting without reopening the lesson or introducing the tutor.');
  if (vars.check==='vietnamese-only' && (japanese.test(row.reply) || row.segments?.some(part=>part.lang!=='vi'))) return fail('Japanese was inserted after a Vietnamese-only request.');
  if (vars.check==='japanese-only' && (!japanese.test(row.reply) || row.segments?.some(part=>part.lang!=='ja'))) return fail('The response is not Japanese-only.');
  if (vars.check==='withhold-topic-particle' && (/(?:^|[「『（(\s])は(?:[」』）)\s。]|$)/u.test(row.reply)
    || /(?:私\s*は\s*アン|田中さん\s*は\s*先生)/u.test(row.reply))) return fail('The reply names or fills the withheld answer.');
  return {pass:true,score:1,reason:'Objective checks passed. Meaning, continuity and teaching quality still require transcript review.'};
}
