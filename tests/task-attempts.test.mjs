import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {recordTaskAttempt,taskEvidenceSummary} from '../src/task-attempts.js';
import {groundLesson,resolveTaskReference,taskEvidence} from '../src/tutor-context.js';
import {assessTaskResponse} from '../src/task-response.js';

const revision='a'.repeat(64);
const task={task_id:'lesson:question:0',revision,item_id:'original-item',mode:'choice',q:'Choose position',instruction:'Pick the numbered slot',opts:['あれ','何で','あれ'],answer_index:2,review_status:'unreviewed',explanation:'SECRET_RATIONALE',accepted_answers:['SECRET_ACCEPTED'],example_indexes:[0]};
const lesson={id:'lesson',level:'N1',title:'Lesson',goal:'SECRET_GOAL',overview:{explanation:'SECRET_OVERVIEW'},examples:[{jp:'SECRET_EXAMPLE',vi:'SECRET_GLOSS'}],questions:[task],exam_questions:[task]};
const submission=(extra={})=>JSON.parse(JSON.stringify({user_id:'learner',lesson:{id:'lesson',level:'N1'},view:'checks',question_index:0,task:{id:task.task_id,revision},attempt_id:'canonical-attempt-0001',event:'answer',answer_index:2,...extra}));
function fixture(t){
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  sqlite.exec("INSERT INTO profiles(user_id,level,track,updated_at) VALUES('learner','N1','test','now')");
  const DB={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){sqlite.prepare(sql).run(...args);return {success:true};}};},async batch(statements){sqlite.exec('BEGIN');try{for(const statement of statements)await statement.run();sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const canonical=structuredClone(lesson),env={DB,ASSETS:{fetch:async()=>Response.json({lessons:{lesson:canonical},items:{},scenarios:{}})}};
  return {env,sqlite,canonical};
}

test('canonical revisions and quarantine reject before mutation; duplicate option labels compare original indices',async t=>{
  const {env,sqlite,canonical}=fixture(t);
  assert.equal((await recordTaskAttempt(submission({task:{id:task.task_id,revision:'b'.repeat(64)}}),env)).status,409);
  canonical.questions[0].review_status='quarantined';canonical.questions[0].unavailable_reason='Contradictory star slot';
  // A distinct assets identity forces a new canonical snapshot, as a deployment would.
  env.ASSETS={fetch:async()=>Response.json({lessons:{lesson:canonical},items:{},scenarios:{}})};
  assert.equal((await recordTaskAttempt(submission(),env)).status,409);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM task_attempt_evidence').get().n,0);
  canonical.questions[0].review_status='unreviewed';delete canonical.questions[0].unavailable_reason;
  env.ASSETS={fetch:async()=>Response.json({lessons:{lesson:canonical},items:{},scenarios:{}})};
  const first=await (await recordTaskAttempt(submission({answer_index:0}),env)).json();
  assert.equal(first.source_correct,false);assert.equal(first.basis,'source_advisory');assert.equal(first.verified,false);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM progress').get().n,0);
  const summary=await taskEvidenceSummary(env,'learner');assert.equal(summary.source_advisory.incorrect,1);assert.equal(summary.verified.answered,0);
});

test('assist before answer survives exact retries and conflicting identity or payload cannot reuse receipts',async t=>{
  const {env,sqlite}=fixture(t);
  const help=submission({event:'assist',answer_index:undefined,help:'source_reveal'});
  assert.equal((await recordTaskAttempt(help,env)).status,200);
  assert.equal((await recordTaskAttempt(help,env)).status,200);
  const first=await (await recordTaskAttempt(submission(),env)).json();
  assert.equal(first.assistance,'assisted');assert.equal(first.revealed,true);assert.equal(first.source_correct,true);
  assert.deepEqual(await (await recordTaskAttempt(submission(),env)).json(),first);
  assert.equal((await recordTaskAttempt(submission({answer_index:0}),env)).status,409);
  assert.equal((await recordTaskAttempt(submission({view:'exam'}),env)).status,409);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM task_attempt_evidence').get().n,1);
  const row=sqlite.prepare('SELECT * FROM task_attempt_evidence').get();assert.equal(row.answer_index,2);assert.equal(row.revision,revision);assert.equal(row.validity,'valid');
});

test('untracked assistance is unknown, writing is self-report and approval cannot be inferred from a label',async t=>{
  const {env,canonical}=fixture(t);
  canonical.questions[0].review_status='approved';
  const result=await (await recordTaskAttempt(submission(),env)).json();assert.equal(result.basis,'source_advisory');assert.equal(result.assistance,'unknown');
  canonical.questions[0]={...task,mode:'writing',opts:[],answer_index:null};
  env.ASSETS={fetch:async()=>Response.json({lessons:{lesson:canonical},items:{},scenarios:{}})};
  const response=await recordTaskAttempt(submission({attempt_id:'writing-attempt-0001',answer_index:undefined,response_text:'私の文です。',self_rating:4}),env);
  const writing=await response.json();assert.equal(response.status,200);assert.equal(writing.basis,'self_report');assert.equal(writing.source_correct,null);assert.equal(writing.correct,undefined);
});

test('preanswer evidence allowlists aliases and dictation never exposes the transcript',()=>{
  const poisoned={...task,answer:'SECRET_ALIAS',ans:'SECRET_ALIAS',rationale:'SECRET_ALIAS',acceptedanswers:['SECRET_ALIAS'],overview:'SECRET_ALIAS',model:'SECRET_ALIAS'};
  const safe=taskEvidence(poisoned);assert.doesNotMatch(JSON.stringify(safe),/SECRET|answer|rationale|overview|example/);
  const grounded=groundLesson({...lesson,questions:[poisoned]},{kind:'question',index:0});assert.doesNotMatch(JSON.stringify(grounded),/SECRET|answer_index|accepted_answers/);
  const dictation=taskEvidence({...poisoned,mode:'dictation',q:'Listen and type',script_jp:'SECRET_TRANSCRIPT',passage:'SECRET_TRANSCRIPT',target:'SECRET_TRANSCRIPT'});
  assert.doesNotMatch(JSON.stringify(dictation),/SECRET/);
  assert.equal(resolveTaskReference(lesson,{kind:'question',index:0},'checks',{id:task.task_id,revision}).task,task);
});

test('migration preserves historical progress and deletes evidence with an account profile',async t=>{
  const {env,sqlite}=fixture(t);
  sqlite.exec("INSERT INTO progress(user_id,item_id,item_type,jlpt_level,correct,incorrect) VALUES('learner','old','grammar','N1',7,2)");
  await recordTaskAttempt(submission(),env);
  assert.equal(sqlite.prepare('SELECT correct FROM progress').get().correct,7);
  assert.equal(sqlite.prepare('SELECT submission FROM progress_attempts').get(),undefined);
  sqlite.exec("DELETE FROM profiles WHERE user_id='learner'");assert.equal(sqlite.prepare('SELECT count(*) n FROM task_attempt_evidence').get().n,0);
});

test('dictation source reveal and self-rating remain self-assessment with advisory text comparison',async t=>{
  const {env,canonical,sqlite}=fixture(t);
  canonical.questions[0]={...task,mode:'dictation',opts:[],answer_index:null,accepted_answers:['聞きました。']};
  const base={answer_index:undefined,attempt_id:'dictation-attempt-001'};
  const assist=submission({...base,event:'assist',help:'source_reveal',response_text:'聞きました。'});
  const revealed=await (await recordTaskAttempt(assist,env)).json();assert.equal(revealed.reveal_response_text,'聞きました。');
  assert.equal((await recordTaskAttempt({...assist,response_text:'後で変更'},env)).status,409);
  assert.equal((await recordTaskAttempt(submission({...base,response_text:'後で変更',self_rating:4}),env)).status,409);
  const result=await (await recordTaskAttempt(submission({...base,response_text:'聞きました。',self_rating:4}),env)).json();
  assert.equal(result.basis,'self_report');assert.equal(result.source_correct,true);assert.equal(result.verified,false);assert.equal(result.revealed,true);assert.equal(result.self_rating,4);
  assert.equal(sqlite.prepare('SELECT basis FROM task_attempt_evidence').get().basis,'self_report');
  assert.equal((await taskEvidenceSummary(env,'learner')).verified.answered,0);
});

test('post-answer coaching records help separately without changing the original submission or assistance basis',async t=>{
  const {env,sqlite}=fixture(t);
  const before=await (await recordTaskAttempt(submission(),env)).json();
  assert.equal(before.assistance,'unknown');
  const help=submission({event:'assist',answer_index:undefined,help:'chat'});
  const first=await (await recordTaskAttempt(help,env)).json();
  assert.equal(first.post_answer_help_mask,8);
  assert.equal(first.assistance,'unknown');assert.equal(first.source_correct,true);
  assert.equal(first.revealed,false);
  const again=await (await recordTaskAttempt(help,env)).json();
  assert.deepEqual(again,first);
  const row=sqlite.prepare('SELECT * FROM task_attempt_evidence').get();
  assert.equal(row.help_mask,0);assert.equal(row.post_answer_help_mask,8);assert.equal(row.answer_index,2);
  const summary=await taskEvidenceSummary(env,'learner');
  assert.equal(summary.source_advisory.answered,1);assert.equal(summary.assisted.answered,0);
});

for(const transition of ['delete','reset'])test(`an in-flight answer cannot recreate private evidence after account ${transition}`,async t=>{
  const {env,sqlite}=fixture(t),batch=env.DB.batch;
  env.DB.batch=async statements=>{
    if(transition==='delete')sqlite.exec("DELETE FROM profiles WHERE user_id='learner'");
    else sqlite.exec("UPDATE profiles SET task_evidence_epoch=lower(hex(randomblob(16))) WHERE user_id='learner'; DELETE FROM task_attempt_evidence WHERE user_id='learner'");
    return batch(statements);
  };
  const response=await recordTaskAttempt(submission(),env);
  assert.equal(response.status,409);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM task_attempt_evidence').get().n,0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM study_days').get().n,0);
});

test('assistance racing with an answer is classified using stored answer state inside its transaction',async t=>{
  const {env,sqlite}=fixture(t),batch=env.DB.batch;
  let inserted=false;
  env.DB.batch=async statements=>{
    if(!inserted){
      inserted=true;
      await recordTaskAttempt(submission(),{...env,DB:{...env.DB,batch}});
    }
    return batch(statements);
  };
  const response=await recordTaskAttempt(submission({event:'assist',answer_index:undefined,help:'chat'}),env);
  assert.equal(response.status,200);
  const row=sqlite.prepare('SELECT * FROM task_attempt_evidence').get();
  assert.equal(row.answer_index,2);assert.equal(row.help_mask,0);assert.equal(row.post_answer_help_mask,8);
  assert.equal(row.assistance,'unknown');
});

test('objective assessment preserves raw text and literal source keys without grading cosmetic or semantic differences',()=>{
  const reference={...task,mode:'recall',objective:'structure',accepted_answers:['水を二本飲みました。','みずを二本飲みました。']};
  const raw='  水 を二本飲みました  ';
  const cosmetic=assessTaskResponse(reference,{response_text:raw});
  assert.equal(cosmetic.source_correct,false);assert.equal(cosmetic.assessment.comparison,'orthographic_difference');
  assert.equal(cosmetic.assessment.submitted_text,raw);assert.equal(cosmetic.assessment.meaning,'uncertain');assert.equal(cosmetic.assessment.structure,'uncertain');
  assert.equal(assessTaskResponse(reference,{response_text:'みずを二本飲みました。'}).source_correct,true);
  for(const response_text of ['水を二本飲みませんでした。','水を三本飲みました。','水を二本飲みました？','水を二 本飲みました。','水を二本、飲みました。']) {
    assert.equal(assessTaskResponse(reference,{response_text}).assessment.comparison,'different_reference',response_text);
  }
  assert.equal(assessTaskResponse({...reference,objective:'orthography'},{response_text:raw}).assessment.comparison,'different_reference');
  assert.equal(assessTaskResponse({...reference,accepted_answers:['AB CD 12']},{response_text:'ABCD12'}).assessment.comparison,'different_reference');
  assert.equal(assessTaskResponse({...reference,accepted_answers:['水を飲みました。']},{response_text:'みずを飲みました。'}).assessment.comparison,'different_reference');
  assert.deepEqual(reference.accepted_answers,['水を二本飲みました。','みずを二本飲みました。']);
  const writing=assessTaskResponse({...reference,mode:'writing'},{response_text:'水を二本飲みました。'});
  assert.equal(writing.source_correct,null);assert.equal(writing.basis,'self_report');assert.equal(writing.verified,false);assert.equal(writing.assessment.comparison,'unassessed');
});

test('session binding is validated, immutable and retains original text and private feedback fields',async t=>{
  const {env,canonical,sqlite}=fixture(t),session_id='learning-session-0001';
  canonical.questions[0]={...task,mode:'recall',objective:'structure',accepted_answers:['水を飲みました。']};
  const body=submission({answer_index:undefined,response_text:'  水 を飲みました  ',session_id});
  const response=await recordTaskAttempt(body,env),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.session_id,session_id);assert.equal(result.assessment.comparison,'orthographic_difference');
  assert.equal(result.response_text,body.response_text);assert.equal(result.source_correct,false);
  assert.deepEqual(await (await recordTaskAttempt(body,env)).json(),result);
  assert.equal((await recordTaskAttempt({...body,session_id:'learning-session-0002'},env)).status,409);
  assert.equal((await recordTaskAttempt({...body,session_id:undefined},env)).status,400);
  assert.equal((await recordTaskAttempt({...body,session_id:'bad'},env)).status,400);
  const stored=sqlite.prepare('SELECT * FROM task_attempt_evidence').get();
  assert.equal(stored.response_text,body.response_text);assert.equal(stored.session_id,session_id);
  const [evidence]=(await taskEvidenceSummary(env,'learner')).evidence;
  assert.equal(evidence.session_id,session_id);assert.equal(evidence.feedback_json,null);assert.equal(evidence.feedback_at,null);
});

test('canonical exchange requires earlier answers in the owned session, while delayed review requires another due session',async t=>{
  const {env,canonical,sqlite}=fixture(t),session_id='learning-session-0001';
  const invite={...task,task_id:'invite-task',mode:'writing',objective:'communication',exchange:{group:'invite-group',stage:'invite',prior_task_ids:[]}};
  const continuation={...invite,task_id:'accept-task',exchange:{group:'invite-group',stage:'accept',prior_task_ids:['invite-task']}};
  const refusal={...invite,task_id:'refuse-task',exchange:{group:'invite-group',stage:'refuse',prior_task_ids:['invite-task']}};
  const delayed={...invite,task_id:'delayed-task',exchange:{group:'invite-group',stage:'delayed',prior_task_ids:['invite-task','accept-task','refuse-task'],delay_hours:24}};
  canonical.questions=[invite,continuation,refusal,delayed];
  const answer=(index,extra={})=>submission({question_index:index,task:{id:canonical.questions[index].task_id,revision},
    answer_index:undefined,response_text:'一緒に公園へ行きませんか。',session_id,attempt_id:`exchange-attempt-000${index}`,...extra});
  assert.equal((await recordTaskAttempt(answer(1),env)).status,409);
  const invited=await (await recordTaskAttempt(answer(0),env)).json();assert.equal(invited.source_correct,null);assert.equal(invited.verified,false);
  assert.equal((await recordTaskAttempt(answer(1,{session_id:'learning-session-0002'}),env)).status,409);
  assert.equal((await recordTaskAttempt(answer(1),env)).status,200);
  assert.equal((await recordTaskAttempt(answer(3,{session_id:'learning-session-0002'}),env)).status,409);
  sqlite.prepare('UPDATE task_attempt_evidence SET answered_at=?').run(new Date(Date.now()-25*3600000).toISOString());
  assert.equal((await recordTaskAttempt(answer(3,{session_id:'learning-session-0002'}),env)).status,409,'an unfinished cycle is not eligible');
  assert.equal((await recordTaskAttempt(answer(2),env)).status,200);
  assert.equal((await recordTaskAttempt(answer(3,{session_id:'learning-session-0002'}),env)).status,409,'all earlier stages must be due');
  sqlite.prepare('UPDATE task_attempt_evidence SET answered_at=?').run(new Date(Date.now()-25*3600000).toISOString());
  assert.equal((await recordTaskAttempt(answer(3),env)).status,409,'same session is not later independent recall');
  assert.equal((await recordTaskAttempt(answer(3,{session_id:'learning-session-0002'}),env)).status,200);
  const changed=structuredClone(canonical);changed.questions[0].revision='b'.repeat(64);
  env.ASSETS={fetch:async()=>Response.json({lessons:{lesson:changed},items:{},scenarios:{}})};
  assert.equal((await recordTaskAttempt(answer(3,{session_id:'learning-session-0003',attempt_id:'exchange-delayed-0003'}),env)).status,409,'stale invitation revision is not eligibility');
});

test('session answer timestamps strictly order answers even when pending assistance rows were created earlier',async t=>{
  const {env,canonical,sqlite}=fixture(t),session_id='ordered-session-0001';
  const invite={...task,task_id:'ordered-invite',mode:'writing',objective:'communication',exchange:{group:'ordered-group',stage:'invite',prior_task_ids:[]}};
  const continuation={...invite,task_id:'ordered-accept',exchange:{group:'ordered-group',stage:'accept',prior_task_ids:['ordered-invite']}};
  canonical.questions=[invite,continuation];
  const answer=(index,extra={})=>submission({question_index:index,task:{id:canonical.questions[index].task_id,revision},answer_index:undefined,
    response_text:'公園へ行きませんか。',session_id,attempt_id:`ordered-attempt-000${index}`,...extra});
  assert.equal((await recordTaskAttempt(answer(0),env)).status,200);
  assert.equal((await recordTaskAttempt(answer(1,{event:'assist',help:'hint',response_text:undefined}),env)).status,200);
  const latest=new Date(Date.now()+1000).toISOString();
  sqlite.prepare("UPDATE task_attempt_evidence SET answered_at=? WHERE task_id='ordered-invite'").run(latest);
  assert.equal((await recordTaskAttempt(answer(1),env)).status,200);
  const saved=sqlite.prepare("SELECT answered_at FROM task_attempt_evidence WHERE task_id='ordered-accept'").get();
  assert.equal(Date.parse(saved.answered_at),Date.parse(latest)+1);
});
