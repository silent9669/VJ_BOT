import {catalogLesson,resolveTaskReference,teacherCatalog,validLessonReference,taskResultBasis} from './tutor-context.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const helps={hint:1,translation:2,source_reveal:4,chat:8};
const attemptPattern=/^[a-zA-Z0-9-]{16,80}$/;
const normalized=text=>text.normalize('NFC').trim();
const receipt=row=>({status:row.answer_payload===null?'assistance_recorded':'recorded',event:row.answer_payload===null?'assist':'answer',
  task:{id:row.task_id,revision:row.revision},item_id:row.item_id,attempt_id:row.attempt_id,
  basis:row.basis,validity:row.validity,disposition:row.disposition,source_correct:row.source_correct===null?null:!!row.source_correct,
  verified:row.basis==='reviewed_source',assistance:row.assistance,revealed:!!row.revealed,
  reveal_response_text:row.reveal_response_text,
  post_answer_help_mask:row.post_answer_help_mask,
  ...(row.answer_payload!==null?{answer_index:row.answer_index,response_text:row.response_text,self_rating:row.self_rating}: {})});

export async function recordTaskAttempt(body,env,expectedEpoch=undefined) {
  const allowed=['user_id','lesson','view','question_index','task','attempt_id','event','answer_index','response_text','self_rating','help'];
  if(!body || Object.keys(body).some(key=>!allowed.includes(key)) || !validLessonReference(body.lesson)
    || !['checks','exam'].includes(body.view) || !Number.isInteger(body.question_index) || body.question_index<0
    || typeof body.attempt_id!=='string' || !attemptPattern.test(body.attempt_id) || !['answer','assist'].includes(body.event)
    || body.event==='assist' && (!Object.hasOwn(helps,body.help) || ['answer_index','self_rating'].some(key=>Object.hasOwn(body,key))
      || Object.hasOwn(body,'response_text') && (body.help!=='source_reveal' || typeof body.response_text!=='string' || body.response_text.length>4000))
    || body.event==='answer' && Object.hasOwn(body,'help'))return json({detail:'Invalid task event.'},400);
  const profile=await env.DB.prepare('SELECT task_evidence_epoch FROM profiles WHERE user_id=?').bind(body.user_id).first();
  const epoch=expectedEpoch===undefined?profile?.task_evidence_epoch:expectedEpoch;
  if(!epoch || profile?.task_evidence_epoch!==epoch)return json({detail:'The learner account changed. Reopen the activity.'},409);
  const catalog=await teacherCatalog(env,body.lesson.level);
  if(!catalog)return json({detail:'The lesson catalog is unavailable. Nothing was recorded.'},503);
  const lesson=catalogLesson(catalog,body.lesson);
  const resolved=resolveTaskReference(lesson,{kind:'question',index:body.question_index},body.view,body.task,body.event==='assist'?'hint':'answer');
  if(resolved.error)return json({detail:resolved.error},resolved.status);
  const task=resolved.task;
  if(body.event==='assist' && Object.hasOwn(body,'response_text') && !['dictation','writing'].includes(task.mode))return json({detail:'Only written or dictation attempts can save pre-reveal text.'},400);
  if(body.event==='answer') {
    const hasIndex=Object.hasOwn(body,'answer_index'),hasText=Object.hasOwn(body,'response_text'),hasRating=Object.hasOwn(body,'self_rating');
    if(task.mode==='choice' ? (!hasIndex || !Number.isInteger(body.answer_index) || body.answer_index<0 || body.answer_index>=task.opts.length || hasText || hasRating)
      : (hasIndex || !hasText || typeof body.response_text!=='string' || !body.response_text.trim() || body.response_text.length>4000
        || hasRating && (!['writing','dictation'].includes(task.mode) || !Number.isInteger(body.self_rating) || body.self_rating<0 || body.self_rating>5))) {
      return json({detail:'Submit the original choice index or the actual text for this task.'},400);
    }
  }
  const identity=JSON.stringify([body.lesson.id,body.lesson.level,body.view,body.question_index,body.task.id,body.task.revision]);
  const payload=body.event==='answer'?JSON.stringify([body.answer_index??null,body.response_text??null,body.self_rating??null]):null;
  const existing=await env.DB.prepare('SELECT * FROM task_attempt_evidence WHERE user_id=? AND attempt_id=?').bind(body.user_id,body.attempt_id).first();
  const legacy=await env.DB.prepare('SELECT result FROM progress_attempts WHERE user_id=? AND attempt_id=?').bind(body.user_id,body.attempt_id).first();
  if(existing?.reveal_response_text!==null && existing?.reveal_response_text!==undefined
    && Object.hasOwn(body,'response_text') && body.response_text!==existing.reveal_response_text
    && (body.event==='assist' || task.mode==='dictation'))return json({detail:'Pre-reveal text is locked to the original attempt.'},409);
  if(legacy || existing && (existing.identity_json!==identity || payload!==null && existing.answer_payload!==null && existing.answer_payload!==payload)) {
    return json({detail:'Attempt ID already belongs to a different task or submission.'},409);
  }
  if(body.event==='answer' && existing?.answer_payload!==null && existing?.answer_payload!==undefined)return json(receipt(existing));
  const now=new Date().toISOString(),basis=Object.hasOwn(body,'self_rating')?'self_report':taskResultBasis(task);
  const sourceCorrect=body.event!=='answer' || task.mode==='writing'?null:task.mode==='choice'
    ?body.answer_index===task.answer_index:task.accepted_answers.some(answer=>normalized(answer)===normalized(body.response_text));
  const writes=[env.DB.prepare(`INSERT OR IGNORE INTO task_attempt_evidence
    (user_id,attempt_id,lesson_id,level,task_id,item_id,revision,view,question_index,mode,identity_json,basis,validity,created_at,account_epoch)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE NOT EXISTS(SELECT 1 FROM progress_attempts WHERE user_id=? AND attempt_id=?)
    AND EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND task_evidence_epoch=?)`).bind(body.user_id,body.attempt_id,lesson.id,lesson.level,task.task_id,task.item_id,task.revision,
      body.view,body.question_index,task.mode,identity,basis,'valid',now,epoch,body.user_id,body.attempt_id,body.user_id,epoch)];
  if(body.event==='assist')writes.push(env.DB.prepare(`UPDATE task_attempt_evidence SET
    help_mask=CASE WHEN answer_payload IS NULL THEN help_mask|? ELSE help_mask END,
    post_answer_help_mask=CASE WHEN answer_payload IS NOT NULL THEN post_answer_help_mask|? ELSE post_answer_help_mask END,
    assistance=CASE WHEN answer_payload IS NULL THEN 'assisted' ELSE assistance END,
    revealed=CASE WHEN answer_payload IS NULL THEN MAX(revealed,?) ELSE revealed END,
    reveal_response_text=CASE WHEN answer_payload IS NULL THEN COALESCE(reveal_response_text,?) ELSE reveal_response_text END
    WHERE user_id=? AND attempt_id=? AND identity_json=? AND account_epoch=?
    AND EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND task_evidence_epoch=?)
    AND (answer_payload IS NOT NULL OR ? IS NULL OR reveal_response_text IS NULL OR reveal_response_text=?)`)
    .bind(helps[body.help],helps[body.help],body.help==='source_reveal'?1:0,body.response_text??null,
      body.user_id,body.attempt_id,identity,epoch,body.user_id,epoch,body.response_text??null,body.response_text??null));
  else writes.push(env.DB.prepare(`UPDATE task_attempt_evidence SET answer_payload=?,answer_index=?,response_text=?,self_rating=?,source_correct=?,basis=?,
    disposition=?,answered_at=? WHERE user_id=? AND attempt_id=? AND identity_json=? AND answer_payload IS NULL AND account_epoch=?
    AND EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND task_evidence_epoch=?)
    AND (mode!='dictation' OR reveal_response_text IS NULL OR reveal_response_text=?)`)
    .bind(payload,body.answer_index??null,body.response_text??null,body.self_rating??null,sourceCorrect===null?null:sourceCorrect?1:0,basis,
      basis==='self_report'?'self_assessed':basis==='source_advisory'?'advisory':'compared',now,body.user_id,body.attempt_id,identity,epoch,body.user_id,epoch,body.response_text??null));
  if(body.event==='answer')writes.push(env.DB.prepare(`INSERT OR IGNORE INTO study_days(user_id,day)
    SELECT ?,? WHERE EXISTS(SELECT 1 FROM task_attempt_evidence WHERE user_id=? AND attempt_id=? AND identity_json=? AND answer_payload=? AND account_epoch=?)
    AND EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND task_evidence_epoch=?)`)
    .bind(body.user_id,now.slice(0,10),body.user_id,body.attempt_id,identity,payload,epoch,body.user_id,epoch));
  await env.DB.batch(writes);
  const saved=await env.DB.prepare('SELECT * FROM task_attempt_evidence WHERE user_id=? AND attempt_id=?').bind(body.user_id,body.attempt_id).first();
  if(body.event==='assist' && saved?.answer_payload===null && Object.hasOwn(body,'response_text') && saved.reveal_response_text!==body.response_text)return json({detail:'Pre-reveal text changed before saving.'},409);
  if(!saved || saved.identity_json!==identity || saved.account_epoch!==epoch || payload!==null && saved.answer_payload!==payload
    || body.event==='assist' && !((saved.help_mask | saved.post_answer_help_mask) & helps[body.help]))return json({detail:'This attempt changed before the event was saved.'},409);
  return json(receipt(saved));
}

export async function taskEvidenceSummary(env,userId) {
  const rows=await env.DB.prepare(`SELECT attempt_id,lesson_id,level,task_id,item_id,revision,view,question_index,mode,
    answer_index,response_text,reveal_response_text,self_rating,source_correct,basis,validity,disposition,assistance,revealed,post_answer_help_mask,answered_at
    FROM task_attempt_evidence WHERE user_id=? AND (answer_payload IS NOT NULL OR reveal_response_text IS NOT NULL) ORDER BY answered_at DESC,attempt_id DESC`).bind(userId).all();
  const summary={verified:{answered:0,correct:0,incorrect:0},source_advisory:{answered:0,correct:0,incorrect:0},self_report:{answered:0},
    legacy_unknown:{answered:0},assisted:{answered:0,revealed:0},assistance_unknown:{answered:0},evidence:rows.results || []};
  for(const row of summary.evidence) {
    if(!row.answered_at)continue;
    const bucket=row.basis==='reviewed_source'?summary.verified:row.basis==='source_advisory'?summary.source_advisory
      :row.basis==='self_report'?summary.self_report:summary.legacy_unknown;
    bucket.answered++;
    if(row.source_correct!==null && 'correct' in bucket)bucket[row.source_correct?'correct':'incorrect']++;
    if(row.assistance==='assisted')summary.assisted.answered++;else summary.assistance_unknown.answered++;
    if(row.revealed)summary.assisted.revealed++;
  }
  return summary;
}
