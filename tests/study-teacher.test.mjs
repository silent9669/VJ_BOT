import test from 'node:test';
import assert from 'node:assert/strict';
import {practiceCoach} from '../src/practice-coach.js';
import {buildTeacherCatalog} from '../scripts/build_teacher_catalog.mjs';

const connection={protocol:'openai',base_url:'https://synthetic.example.com/v1',model:'selected-chat',api_key:'synthetic-not-a-real-key'};
const lesson={id:'lesson-test',level:'N4'};
const question={q:'Mẫu 〜てくれる có nghĩa gì?',opts:['someone helps me','someone helps others','nobody helps'],ans:'someone helps me',explanation:'SECRET_AUTHORED_EXPLANATION'};
const canonical={id:lesson.id,level:'N4',title:'〜てくれる',goal:'SECRET_ANSWER_GOAL',overview:{meaning_vi:'SECRET_ANSWER_MEANING',formula:'Verb-て + くれる'},
  words:[{jp:'学生',reading:'がくせい',vi:'student',examples:[{jp:'学生です。',vi:'I am a student.'}]}],examples:[{jp:'手伝ってくれます。',vi:'Someone helps me.'}],questions:[question],
  exam_questions:[{q:'Sắp xếp: 何で あれ どうで あれ',opts:['何で','あれ','どうで','あれ'],ans:'どうで'}]};
const env={ASSETS:{fetch:async()=>Response.json({lessons:{[lesson.id]:canonical},items:{},scenarios:{}})},DB:{prepare(){throw new Error('Teaching must not write history or progress or read another saved profile.');}}};
const request=body=>new Request('https://app.test/api/practice/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:'learner',api_connection:connection,lesson,action:'teach',...body})});
const translations={'someone helps me':'ai đó giúp tôi','someone helps others':'ai đó giúp người khác','nobody helps':'không ai giúp','student':'học sinh','I am a student.':'Tôi là học sinh.','Someone helps me.':'Ai đó giúp tôi.','Verb-て + くれる':'Động từ thể て + くれる','SECRET_ANSWER_MEANING':'nghĩa được học','SECRET_ANSWER_GOAL':'mục tiêu đang học'};
async function provider(t,transform=value=>value) {
  const calls=[],original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    const wire=JSON.parse(options.body),evidence=JSON.parse(wire.messages.at(-1).content);
    calls.push({url,wire,evidence});
    const value={reply:'Em hãy chú ý ai được hưởng lợi. Thử nêu vai trò của người nhận nhé?',fields:evidence.fields.map(field=>({key:field.key,text:translations[field.source] || field.source}))};
    return Response.json({choices:[{message:{content:JSON.stringify(transform(value,evidence))}}]});
  };
  t.after(()=>{globalThis.fetch=original;});
  return calls;
}

test('teaching translates every choice without sending the answer key, overview or explanation to the selected chat model',async t=>{
  const calls=await provider(t),before=JSON.stringify(canonical);
  const response=await practiceCoach(request({focus:{kind:'question',index:0}}),env),data=await response.json();
  assert.equal(response.status,200);assert.equal(calls.length,1);
  assert.equal(calls[0].wire.model,'selected-chat');assert.match(calls[0].url,/synthetic\.example\.com/);
  assert.doesNotMatch(JSON.stringify(calls[0].evidence),/SECRET_|"ans"|"correct"|"explanation"/);
  assert.deepEqual(data.fields.filter(f=>f.key.startsWith('question:option:')).map(f=>[f.source,f.text]),question.opts.map(s=>[s,translations[s]]));
  assert.equal(data.answer,undefined);assert.equal(data.correct,undefined);assert.equal(JSON.stringify(canonical),before);
});

test('word, example and reference teaching stay canonical and retain Japanese; duplicate numbered exam segments retain their positions',async t=>{
  await provider(t);
  for(const focus of [null,{kind:'word',index:0},{kind:'example',index:0}]){
    const response=await practiceCoach(request({focus}),env),data=await response.json();
    assert.equal(response.status,200);assert.deepEqual(data.focus,focus);assert.ok(data.reply.includes('Em hãy'));
    assert.ok(data.fields.every(f=>typeof f.source==='string'));
  }
  const response=await practiceCoach(request({focus:{kind:'question',index:0},view:'exam'}),env),data=await response.json();
  assert.equal(response.status,200);assert.deepEqual(data.fields.filter(f=>f.key.startsWith('question:option:')).map(f=>f.text),['何で','あれ','どうで','あれ']);
});

test('forged references, client source/context and answer injection fail before any provider request',async t=>{
  const calls=await provider(t);
  for(const body of [{lesson:{id:'forged',level:'N4'}},{focus:{kind:'word',index:99}},{focus:{kind:'question',index:-1}},
    {view:'exam'},{text:'injected source'},{answer_index:0},{lesson:{...lesson,source:'forged'}},{view:'unknown'}]){
    const response=await practiceCoach(request(body),env);assert.ok([400,409].includes(response.status));
  }
  assert.equal(calls.length,0);
});

test('incomplete, duplicate, changed-Japanese, merged-choice and model-authored grading responses are rejected',async t=>{
  let transform=value=>value;
  await provider(t,value=>transform(value));
  for(const change of [
    v=>({...v,fields:v.fields.slice(1)}),
    v=>({...v,fields:[...v.fields.slice(0,-1),v.fields[0]]}),
    v=>({...v,correct:true}),
    v=>({...v,fields:v.fields.map((f,i)=>i===0?{...f,text:'Mẫu 〜てもらう có nghĩa gì?'}:f)}),
    v=>({...v,fields:v.fields.map(f=>f.key.startsWith('question:option:')?{...f,text:'cùng một nghĩa'}:f)}),
    v=>({...v,fields:v.fields.map((f,i)=>i===1?{...f,source:'forged'}:f)})
  ]){
    transform=change;
    const response=await practiceCoach(request({focus:{kind:'question',index:0}}),env);assert.equal(response.status,503);
  }
});

test('upstream errors are visible and never treated as successful localized content',async t=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:{message:'private diagnostic'}},{status:401});
  t.after(()=>{globalThis.fetch=original;});
  const response=await practiceCoach(request({focus:{kind:'question',index:0}}),env),data=await response.json();
  assert.equal(response.status,503);assert.equal(data.fields,undefined);assert.doesNotMatch(JSON.stringify(data),/private diagnostic|synthetic-not-a-real-key/);
});

test('Japanese-only exam options cannot acquire translated hints or reading clues',async t=>{
  await provider(t,value=>({...value,fields:value.fields.map(field=>field.key==='question:option:1'?{...field,text:'あれ (điều kiện)'}:field)}));
  const response=await practiceCoach(request({focus:{kind:'question',index:0},view:'exam'}),env);
  assert.equal(response.status,503);
});

test('every full-exam catalog retains original question ordering, duplicate segments and correct-option positions beyond preview five',async()=>{
  const catalogs=await buildTeacherCatalog();let exams=0;
  for(const catalog of Object.values(catalogs))for(const entry of Object.values(catalog.lessons))if(entry.exam_questions){
    exams++;assert.ok(entry.exam_questions.length>=3);
    for(const q of entry.exam_questions){assert.ok(q.opts.includes(q.ans));assert.equal(typeof q.item_id,'string');}
  }
  assert.equal(exams,80);
  const repeated=Object.values(catalogs.N1.lessons).flatMap(entry=>entry.exam_questions || []).find(q=>q.opts.join('|')==='何で|あれ|どうで|あれ');
  assert.ok(repeated);assert.equal(repeated.ans,'どうで');
});
