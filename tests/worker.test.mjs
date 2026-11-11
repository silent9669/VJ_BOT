import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('shared AI and private progress require a session', async () => {
  for (const path of ['/api/exam-attempts','/api/completions','/api/chat','/api/tts','/api/kaiwa/evaluate','/api/progress?user_id=someone']) {
    const response = await worker.fetch(new Request('https://vjbot.test'+path, path.includes('?') ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}), {});
    assert.equal(response.status,401,path);
  }
});
test('cross-origin mutations are refused', async () => {
  const response=await worker.fetch(new Request('https://vjbot.test/api/chat',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'}),{});
  assert.equal(response.status,403);
});
test('unknown API routes return JSON 404', async () => {
  const response=await worker.fetch(new Request('https://vjbot.test/api/unknown'),{});
  assert.equal(response.status,404);
  assert.match(response.headers.get('Content-Type'),/json/);
});

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { hashToken } from '../src/auth.js';
function database() {
  const db=new DatabaseSync(':memory:');
  for(const migration of ['0001_base.sql','0002_sessions.sql','0003_srs_repetitions.sql','0004_progress_display.sql','0005_progress_attempts.sql','0006_learning_responses.sql','0007_completions.sql','0008_exam_attempts.sql','0009_password_accounts.sql','0010_chat_requests.sql','0011_ai_providers.sql','0012_profile_identity.sql','0013_identity_backfill.sql','0014_api_profiles.sql'])db.exec(readFileSync('migrations/'+migration,'utf8'));
  const prepare=sql=>{let params=[];return {bind(...values){params=values;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){db.prepare(sql).run(...params);return {success:true};}};};
  return {prepare,batch:statements=>Promise.all(statements.map(s=>s.run()))};
}
async function asAdmin(env){env.ADMIN_EMAILS='owner@example.test';env.GEMINI_API_KEY='platform-key';await env.DB.prepare("INSERT INTO admins VALUES('google:qa','owner@example.test','now')").run();}
async function withApi(env,request,extra={}){
  env.AI_KEY_SECRET='local-secret';
  const r=await worker.fetch(new Request('https://vjbot.test/api/ai/settings',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'openai',base_url:'https://api.example.com/v1',model:'m1',api_key:'sk-test-12345678',...extra})}),env);
  assert.equal(r.status,200);
}
async function authenticated() {
  const DB=database(),token='a'.repeat(64);
  await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),'google:qa','QA',Date.now()+60000).run();
  return {env:{DB},request:(path,body)=>new Request('https://vjbot.test'+path,{headers:{Cookie:'vj_session='+token,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})})};
}
test('malformed and forged Google credentials cannot create accounts',async()=>{
  const env={DB:database(),GOOGLE_CLIENT_ID:'client'};
  for(const [body,status] of [['{',400],['null',400],[JSON.stringify({credential:'forged.token.value'}),401]]){
    const response=await worker.fetch(new Request('https://vjbot.test/api/auth/google',{method:'POST',body}),env);assert.equal(response.status,status);
  }
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM sessions').first()).n,0);
});
test('progress uses session owner and SRS repetitions restart after a miss',async()=>{
  const {env,request}=await authenticated();
  for(const [correct,expected] of [[true,1],[true,6],[false,1],[true,1]]){
    const response=await worker.fetch(request('/api/progress/record',{user_id:'victim',item_id:'qa-word',correct,quality:correct?4:1}),env);
    assert.equal(response.status,200);assert.equal((await response.json()).interval_days,expected);
  }
  const rows=await env.DB.prepare('SELECT * FROM progress').all();assert.equal(rows.results.length,1);assert.equal(rows.results[0].user_id,'google:qa');assert.equal(rows.results[0].correct,3);
  const response=await worker.fetch(request('/api/progress?user_id=victim'),env);assert.equal((await response.json()).total_learned,1);
});
test('expired sessions are denied and logout removes the active session',async()=>{
  const {env,request}=await authenticated();
  await env.DB.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await worker.fetch(request('/api/progress'),env)).status,401);
  await worker.fetch(request('/api/auth/logout',{}),env);assert.equal((await env.DB.prepare('SELECT count(*) n FROM sessions').first()).n,0);
});
test('AI rate limit stops before the provider and account deletion is isolated',async()=>{
  const {env,request}=await authenticated();
  await env.DB.prepare('INSERT INTO ai_usage VALUES(?,?,20)').bind('google:qa',Math.floor(Date.now()/60000)).run();
  assert.equal((await worker.fetch(request('/api/chat',{message:'hello'}),env)).status,429);
  await env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at) VALUES('victim','N5','openjlpt','now')").run();
  assert.equal((await worker.fetch(request('/api/account/delete',{user_id:'victim'}),env)).status,200);
  assert.ok(await env.DB.prepare("SELECT * FROM profiles WHERE user_id='victim'").first());
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM sessions').first()).n,0);
});
test('TTS sends an explicit reading request and returns the audio part',async()=>{
  const {env,request}=await authenticated(),original=globalThis.fetch;
  env.AI_KEY_SECRET='local-secret';
  await worker.fetch(new Request('https://vjbot.test/api/ai/settings',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'gemini',base_url:'',model:'gemini-3.8-flash',api_key:'test-only-key'})}),env);
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.headers['x-goog-api-key'],'test-only-key');assert.match(url,/gemini-3\.8-flash-tts/);
    const payload=JSON.parse(options.body);assert.match(payload.contents[0].parts[0].text,/Read aloud.*こんにちは/);
    assert.equal(payload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Charon');
    return Response.json({candidates:[{content:{parts:[{text:'metadata'},{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]}}]});
  };
  try{const response=await worker.fetch(request('/api/tts',{text:'こんにちは。'}),env);assert.equal(response.status,200);assert.equal((await response.json()).audioBase64,'UklGRg==');}finally{globalThis.fetch=original;}
});


test('generated exercise labels survive requests and stay private to each account',async()=>{
  const {env,request}=await authenticated();
  const otherToken='b'.repeat(64);
  await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(otherToken),'google:other','Other',Date.now()+60000).run();
  const other=(path,body)=>new Request('https://vjbot.test'+path,{headers:{Cookie:'vj_session='+otherToken,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  for(const [make,display] of [[request,'Cách đọc của あ?'],[other,'Private other label']]){
    const response=await worker.fetch(make('/api/progress/record',{item_id:'kana:Hiragana:あ',display,correct:false,item_type:'kana',level:'N5'}),env);
    assert.equal(response.status,200);
  }
  let data=await (await worker.fetch(request('/api/progress?user_id=google:other'),env)).json();
  assert.equal(data.items[0].display,'Cách đọc của あ?');assert.equal(data.weak_items[0].display,'Cách đọc của あ?');
  await worker.fetch(request('/api/progress/record',{item_id:'kana:Hiragana:あ',correct:true}),env);
  data=await (await worker.fetch(request('/api/progress'),env)).json();
  assert.equal(data.items[0].display,'Cách đọc của あ?');assert.equal(data.items[0].correct,1);assert.equal(data.items[0].incorrect,1);
  const otherData=await (await worker.fetch(other('/api/progress'),env)).json();
  assert.equal(otherData.items[0].display,'Private other label');assert.equal(otherData.items[0].correct,0);
});
test('invalid progress metadata is rejected before storing it',async()=>{
  const {env,request}=await authenticated();
  for(const metadata of [{display:{}},{display:'a'.repeat(2001)},{item_type:{}},{item_id:''}]){
    assert.equal((await worker.fetch(request('/api/progress/record',{item_id:'qa',correct:true,...metadata}),env)).status,400);
  }
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM progress').first()).n,0);
});


test('retrying an answer after a lost response records it only once',async()=>{
  const {env,request}=await authenticated();
  const body={item_id:'retry-word',display:'本',correct:true,attempt_id:'attempt-retry-0001'};
  const first=await (await worker.fetch(request('/api/progress/record',body),env)).json();
  const repeated=await (await worker.fetch(request('/api/progress/record',body),env)).json();
  assert.deepEqual(repeated,first);
  const record=await env.DB.prepare('SELECT correct,repetitions FROM progress').first();
  assert.equal(record.correct,1);assert.equal(record.repetitions,1);
  body.attempt_id='attempt-retry-0002';
  await worker.fetch(request('/api/progress/record',body),env);
  assert.equal((await env.DB.prepare('SELECT correct FROM progress').first()).correct,2);
  await worker.fetch(request('/api/account/delete',{}),env);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM progress_attempts').first()).n,0);
});


test('a written response persists privately and the latest answer determines review state',async()=>{
  const {env,request}=await authenticated();
  const body={item_id:'practical:v1:N5:introductions:production',item_type:'production',correct:true,response_text:'私はアンです。ベトナムから来ました。',attempt_id:'production-save-001'};
  assert.equal((await worker.fetch(request('/api/progress/record',body),env)).status,200);
  let data=await (await worker.fetch(request('/api/progress'),env)).json();
  assert.equal(data.items[0].response_text,body.response_text);assert.equal(data.items[0].last_correct,1);
  await worker.fetch(request('/api/progress/record',{...body,correct:false,attempt_id:'production-save-002'}),env);
  data=await (await worker.fetch(request('/api/progress'),env)).json();assert.equal(data.items[0].last_correct,0);
  assert.equal((await worker.fetch(request('/api/progress/record',{...body,response_text:'x'.repeat(4001)}),env)).status,400);
});


test('completion is reversible, private, idempotent and separate from answer scores',async()=>{
  const {env,request}=await authenticated();
  const payload={activity_id:'lesson:N4:late',kind:'lesson',level:'N4',title:'Báo đến muộn',completed:true,user_id:'victim'};
  for(let i=0;i<2;i++)assert.equal((await worker.fetch(request('/api/completions',payload),env)).status,200);
  const data=await (await worker.fetch(request('/api/completions?user_id=victim'),env)).json();
  assert.equal(data.items.length,1);assert.equal(data.items[0].activity_id,payload.activity_id);
  assert.equal((await env.DB.prepare('SELECT user_id FROM completions').first()).user_id,'google:qa');
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM progress').first()).n,0);
  const token='c'.repeat(64);await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),'other','Other',Date.now()+60000).run();
  const other=new Request('https://vjbot.test/api/completions',{headers:{Cookie:'vj_session='+token}});
  assert.deepEqual((await (await worker.fetch(other,env)).json()).items,[]);
  assert.equal((await worker.fetch(request('/api/completions',{...payload,completed:false}),env)).status,200);
  assert.equal((await (await worker.fetch(request('/api/completions'),env)).json()).items.length,0);
  for(const change of [{completed:'true'},{kind:'wrong'},{activity_id:'<script>'},{title:''}])assert.equal((await worker.fetch(request('/api/completions',{...payload,...change}),env)).status,400);
  await worker.fetch(request('/api/completions',payload),env);
  await worker.fetch(request('/api/account/delete',{}),env);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM completions').first()).n,0);
});

test('reversed chatbot sends level, lesson and turn count to the learner own OpenAI-compatible API',async()=>{
  const {env,request}=await authenticated(),original=globalThis.fetch;await withApi(env,request);
  const lesson={id:'chapter:N3:1',title:'Giải thích kết luận',level:'N3',goal:'Giải thích lại',content:'〜わけだ'};
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.example.com/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer sk-test-12345678');
    const payload=JSON.parse(options.body),system=payload.messages[0];assert.equal(payload.model,'m1');assert.equal(system.role,'system');
    assert.match(system.content,/JLPT N3/);assert.match(system.content,/reversed classroom/);assert.match(system.content,/ONE question/);assert.match(system.content,/〜わけだ/);assert.match(system.content,/Hán Việt/);
    assert.equal(payload.messages.at(-1).content,'Bắt đầu');assert.ok(!('max_tokens' in payload));
    return Response.json({choices:[{message:{content:'Em thử giải thích mẫu này nhé?'}}]});
  };
  try{
    const response=await worker.fetch(request('/api/chat',{message:'Bắt đầu',lesson}),env);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.updated_topic.level,'N3');assert.equal(data.updated_topic.id,lesson.id);assert.ok(!JSON.stringify(data).includes('sk-test'));
    assert.equal((await worker.fetch(request('/api/chat',{message:'test',lesson:{...lesson,content:'x'.repeat(4001)}}),env)).status,400);
  }finally{globalThis.fetch=original;}
});
test('exam attempts persist only for the session owner and reject invalid state',async()=>{
  const {env,request}=await authenticated();
  const attempt={paper_id:'N5:2018',status:'running',section:0,deadline:Date.now()+1200000,answers:[[1,...Array(34).fill(null)],Array(32).fill(null),Array(24).fill(null)],user_id:'victim'};
  assert.equal((await worker.fetch(request('/api/exam-attempts',attempt),env)).status,200);
  const saved=await worker.fetch(request('/api/exam-attempts?paper_id=N5:2018&user_id=victim'),env);
  assert.deepEqual((await saved.json()).attempt.answers,attempt.answers);
  assert.equal((await env.DB.prepare('SELECT user_id FROM exam_attempts').first()).user_id,'google:qa');
  for(const patch of [{answers:[[9]]},{section:-1},{paper_id:'N9:2018'},{deadline:Date.now()+86400000},{status:'passed'}])assert.equal((await worker.fetch(request('/api/exam-attempts',{...attempt,...patch}),env)).status,400);
  await worker.fetch(request('/api/account/delete',{}),env);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM exam_attempts').first()).n,0);
});

test('password accounts register, rotate sessions, isolate data and delete credentials',async()=>{
  const env={DB:database()};
  const auth=(path,body,cookie='')=>worker.fetch(new Request('https://vjbot.test/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}),env);
  const body={email:' Learner@example.test ',name:'Learner',password:'local-test-password-2026'};
  const registered=await auth('register',body);assert.equal(registered.status,200);
  const cookie=registered.headers.get('set-cookie').split(';')[0];
  assert.match(registered.headers.get('set-cookie'),/HttpOnly; SameSite=Lax.*Secure/);
  const user=(await registered.json()).user;assert.match(user.user_id,/^email:/);
  const stored=await env.DB.prepare('SELECT * FROM password_accounts').first();
  assert.equal(stored.email,'learner@example.test');assert.notEqual(stored.password_hash,body.password);assert.equal(stored.password_hash.length,64);
  assert.equal((await auth('register',body)).status,409);
  for(const email of ['learner@example.test','missing@example.test']){
    const bad=await auth('login',{email,password:'incorrect-password'});assert.equal(bad.status,401);assert.equal((await bad.json()).detail,'Email hoặc mật khẩu không đúng.');
  }
  const logged=await auth('login',body,cookie);assert.equal(logged.status,200);
  const newCookie=logged.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,newCookie);
  const privateRequest=(path,method='GET')=>new Request('https://vjbot.test'+path,{method,headers:{Cookie:newCookie}});
  assert.equal((await worker.fetch(new Request('https://vjbot.test/api/progress',{headers:{Cookie:cookie}}),env)).status,401);
  assert.equal((await worker.fetch(privateRequest('/api/progress?user_id=google:victim'),env)).status,200);
  assert.equal((await worker.fetch(privateRequest('/api/account/delete','POST'),env)).status,200);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM password_accounts').first()).n,0);
  assert.equal((await auth('login',body)).status,401);
});
test('password auth validates fields, rejects cross-origin creation and rate limits unknown accounts',async()=>{
  const env={DB:database()};
  const req=(body,headers={})=>new Request('https://vjbot.test/api/auth/login',{method:'POST',headers,body:JSON.stringify(body)});
  for(const body of [null,{}, {email:'bad',password:'password-long-enough'},{email:'valid@example.test',password:'short'}])assert.equal((await worker.fetch(req(body),env)).status,400);
  const valid={email:'missing@example.test',password:'password-long-enough'};
  assert.equal((await worker.fetch(req(valid,{Origin:'https://attacker.test'}),env)).status,403);
  for(let i=0;i<10;i++)assert.equal((await worker.fetch(req(valid),env)).status,401);
  const limited=await worker.fetch(req(valid),env);assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'900');
});

test('shared networks support more than ten successful accounts without blocking unrelated learners',async()=>{
  const env={DB:database()};
  for(let i=0;i<12;i++){
    const response=await worker.fetch(new Request('https://vjbot.test/api/auth/register',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.5'},body:JSON.stringify({email:`learner${i}@example.test`,name:'Learner',password:'shared-network-password'})}),env);
    assert.equal(response.status,200);
  }
});
test('failed chat does not persist a turn and retrying a completed request returns its saved answer once',async()=>{
  const {env,request}=await authenticated();await withApi(env,request);
  const previous=globalThis.fetch;let calls=0;
  const body={message:'こんにちは',request_id:crypto.randomUUID()};
  try{
    globalThis.fetch=async()=>{calls++;return Response.json({error:'upstream unavailable'},{status:503});};
    assert.equal((await worker.fetch(request('/api/chat',body),env)).status,503);
    assert.equal((await env.DB.prepare('SELECT count(*) n FROM conversations').first()).n,0);
    globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:'こんにちは！'}}]});};
    const first=await worker.fetch(request('/api/chat',body),env);assert.equal(first.status,200);
    const retry=await worker.fetch(request('/api/chat',body),env);assert.equal(retry.status,200);assert.equal((await retry.json()).reply,'こんにちは！');
    assert.equal(calls,2);assert.equal((await env.DB.prepare('SELECT count(*) n FROM conversations').first()).n,2);
  }finally{globalThis.fetch=previous;}
});
test('there is no built-in AI: even an admin needs an own API, and speech needs a Google Gemini key',async()=>{
  const {env,request}=await authenticated(),previous=globalThis.fetch;
  env.GEMINI_API_KEY='platform-key';env.ADMIN_EMAILS='owner@example.test';await env.DB.prepare("INSERT INTO admins VALUES('google:qa','owner@example.test','now')").run();
  let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.ok(!JSON.stringify(options).includes('platform-key'));return Response.json({candidates:[{content:{parts:[{inlineData:{data:'UklGRg==',mimeType:'audio/wav'}}]}}]});};
  try{
    for(const [path,body] of [['/api/chat',{message:'xin chào'}],['/api/kaiwa/evaluate',{user_speech:'はい',prompt_jp:'お名前は？'}]]){
      const r=await worker.fetch(request(path,body),env);assert.equal(r.status,403,path);assert.equal((await r.json()).code,'no_ai');
    }
    let r=await worker.fetch(request('/api/tts',{text:'こんにちは'}),env);assert.equal(r.status,403);assert.equal((await r.json()).code,'no_tts');assert.equal(calls,0);
    await withApi(env,request);r=await worker.fetch(request('/api/tts',{text:'こんにちは'}),env);assert.equal(r.status,403);assert.equal(calls,0);
    await worker.fetch(new Request('https://vjbot.test/api/ai/settings',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'gemini',base_url:'https://proxy.example.com',model:'gemini-3.8-flash',api_key:'AIza-12345678'})}),env);
    r=await worker.fetch(request('/api/tts',{text:'こんにちは'}),env);assert.equal(r.status,403);assert.equal(calls,0);
    await worker.fetch(new Request('https://vjbot.test/api/ai/settings',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'gemini',base_url:'',model:'gemini-3.8-flash',api_key:'AIza-12345678'})}),env);
    r=await worker.fetch(request('/api/tts',{text:'こんにちは'}),env);assert.equal(r.status,200);assert.equal(calls,1);
  }finally{globalThis.fetch=previous;}
});
const put=(request,path,body,method='PUT')=>new Request('https://vjbot.test'+path,{method,headers:request('/api/ai/settings').headers,body:body&&JSON.stringify(body)});
test('learners without an admin grant need their own API; their key and URL are the only ones ever used',async()=>{
  const {env,request}=await authenticated(),previous=globalThis.fetch;env.GEMINI_API_KEY='platform-key';env.AI_KEY_SECRET='local-secret';env.ADMIN_EMAILS='owner@example.test';
  const calls=[];globalThis.fetch=async(url,options)=>{calls.push([url,options]);return Response.json({choices:[{message:{content:'ok'}}]});};
  try{
    let r=await worker.fetch(request('/api/chat',{message:'xin chào'}),env);assert.equal(r.status,403);assert.equal((await r.json()).code,'no_ai');assert.equal(calls.length,0);
    assert.equal((await (await worker.fetch(request('/api/ai/settings'),env)).json()).source,'none');
    assert.equal((await worker.fetch(request('/api/admin/overview'),env)).status,403);
    for(const base_url of ['http://api.example.com','https://127.0.0.1/v1','https://localhost/v1','https://vjbot.workers.dev','https://user:pw@api.example.com','https://api.example.com/v1?x=1','https://intranet'])assert.equal((await worker.fetch(put(request,'/api/ai/settings',{protocol:'openai',base_url,model:'m',api_key:'sk-test-12345678'}),env)).status,400,base_url);
    assert.equal((await worker.fetch(put(request,'/api/ai/settings',{protocol:'openai',base_url:'https://api.example.com/v1/',model:'m'}),env)).status,400);
    assert.equal((await worker.fetch(put(request,'/api/ai/settings',{protocol:'openai',base_url:'https://api.example.com/v1/chat/completions',model:'my-model',api_key:'sk-test-12345678'}),env)).status,200);
    const stored=await env.DB.prepare('SELECT * FROM ai_providers').first();assert.equal(stored.base_url,'https://api.example.com/v1');assert.ok(!JSON.stringify(stored).includes('sk-test-12345678'));assert.equal(stored.key_last4,'5678');
    const view=await (await worker.fetch(request('/api/ai/settings'),env)).json();assert.equal(view.source,'own');assert.equal(view.own.key_last4,'5678');assert.ok(!JSON.stringify(view).includes('sk-test'));
    r=await worker.fetch(request('/api/chat',{message:'xin chào'}),env);assert.equal(r.status,200);assert.equal(calls.length,1);
    assert.equal(calls[0][0],'https://api.example.com/v1/chat/completions');assert.equal(calls[0][1].headers.Authorization,'Bearer sk-test-12345678');assert.equal(calls[0][1].redirect,'manual');assert.ok(!JSON.stringify(calls).includes('platform-key'));
    // Updating the model keeps the saved key; a different secret can no longer decrypt it.
    assert.equal((await worker.fetch(put(request,'/api/ai/settings',{protocol:'openai',base_url:'https://api.example.com/v1',model:'other'}),env)).status,200);
    env.AI_KEY_SECRET='rotated';r=await worker.fetch(request('/api/chat',{message:'lại'}),env);assert.equal(r.status,409);assert.equal((await r.json()).code,'rekey');assert.equal(calls.length,1);
    env.AI_KEY_SECRET='local-secret';assert.equal((await worker.fetch(request('/api/ai/test',{}),env)).status,200);
    await worker.fetch(request('/api/account/delete',{}),env);assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_providers').first()).n,0);
  }finally{globalThis.fetch=previous;}
});
test('Anthropic and Gemini native requests use their own headers and history rules',async()=>{
  const {env,request}=await authenticated(),previous=globalThis.fetch;env.AI_KEY_SECRET='local-secret';
  await env.DB.prepare("INSERT INTO conversations(user_id,role,content,timestamp) VALUES('google:qa','bot','Chào em',?)").bind(new Date().toISOString()).run();
  let seen;globalThis.fetch=async(url,options)=>{seen={url,options,body:JSON.parse(options.body)};return Response.json(seen.url.includes('anthropic')?{content:[{type:'text',text:'Claude ok'}]}:{candidates:[{content:{parts:[{text:'Gemini ok'}]}}]});};
  try{
    await worker.fetch(put(request,'/api/ai/settings',{protocol:'anthropic',base_url:'https://api.anthropic.com',model:'claude-sonnet-5-5',api_key:'sk-ant-12345678'}),env);
    let r=await worker.fetch(request('/api/chat',{message:'Bắt đầu'}),env);assert.equal((await r.json()).reply,'Claude ok');
    assert.equal(seen.url,'https://api.anthropic.com/v1/messages');assert.equal(seen.options.headers['x-api-key'],'sk-ant-12345678');assert.ok(!seen.options.headers.Authorization);
    assert.equal(seen.body.max_tokens,1024);assert.match(seen.body.system,/Thầy Lâm/);assert.equal(seen.body.messages[0].role,'user');assert.equal(seen.body.messages.length,1);
    await worker.fetch(put(request,'/api/ai/settings',{protocol:'gemini',base_url:'',model:'gemini-3.8-flash',api_key:'AIza-12345678'}),env);
    r=await worker.fetch(request('/api/chat',{message:'Tiếp'}),env);assert.equal((await r.json()).reply,'Gemini ok');
    assert.equal(seen.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');assert.equal(seen.options.headers['x-goog-api-key'],'AIza-12345678');assert.ok(seen.body.systemInstruction);
  }finally{globalThis.fetch=previous;}
});
test('admin status needs a Google row, a verified email in the current ADMIN_EMAILS and an admin-only overview',async()=>{
  const {env,request}=await authenticated();
  const {isAdmin,recordAdminLogin}=await import('../src/admin.js');
  await recordAdminLogin(env,'google:qa','Owner@Example.test');assert.equal(await isAdmin(env,'google:qa'),false);
  env.ADMIN_EMAILS='owner@example.test';await recordAdminLogin(env,'google:qa','Owner@Example.test');assert.equal(await isAdmin(env,'google:qa'),true);
  await env.DB.prepare("INSERT INTO admins VALUES('email:pw','owner@example.test','now')").run();assert.equal(await isAdmin(env,'email:pw'),false);
  await env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at,name,email) VALUES('google:qa','N5','openjlpt','now','QA','owner@example.test')").run();
  assert.equal((await (await worker.fetch(request('/api/auth/session'),env)).json()).user.is_admin,true);
  const overview=await (await worker.fetch(request('/api/admin/overview'),env)).json();assert.equal(typeof overview.users,'number');assert.ok(Array.isArray(overview.top));
  env.ADMIN_EMAILS='';assert.equal(await isAdmin(env,'google:qa'),false);assert.equal((await worker.fetch(request('/api/admin/overview'),env)).status,403);
});

test('admins manage users: list, search, detail and every action; others are refused',async()=>{
  const {env,request}=await authenticated();env.ADMIN_EMAILS='owner@example.test';env.AI_KEY_SECRET='local-secret';
  const post=(path,body)=>worker.fetch(request(path,body),env),get=path=>worker.fetch(request(path),env);
  assert.equal((await get('/api/admin/users')).status,403);assert.equal((await post('/api/admin/user',{id:'x',action:'delete'})).status,403);
  const {recordAdminLogin}=await import('../src/admin.js');await recordAdminLogin(env,'google:qa','owner@example.test');
  const now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at,name) VALUES('google:qa','N5','openjlpt',?,'QA')").bind(now).run();
  await env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at,name,email,created_at,last_login) VALUES('google:alice','N4','openjlpt',?,'Alice Nguyen','alice@example.test',?,?)").bind(now,now,now).run();
  await env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at,name) VALUES('legacy-guest-1','N5','openjlpt',?,NULL)").bind(now).run();
  await env.DB.prepare("INSERT INTO conversations(user_id,role,content,timestamp) VALUES('google:alice','user','xin chào',?),('google:alice','bot','chào em',?)").bind(now,now).run();
  await env.DB.prepare("INSERT INTO completions(user_id,activity_id,kind,level,title,completed_at) VALUES('google:alice','a1','lesson','N4','Bài 1',?)").bind(now).run();
  await env.DB.prepare("INSERT INTO sessions VALUES('hash-alice','google:alice','Alice Nguyen',?)").bind(Date.now()+60000).run();
  await worker.fetch(new Request('https://vjbot.test/api/ai/settings',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'openai',base_url:'',model:'m',api_key:'sk-test-12345678'})}),env);
  const list=await (await get('/api/admin/users')).json();assert.equal(list.total,3);
  const alice=list.users.find(u=>u.user_id==='google:alice');assert.deepEqual([alice.name,alice.email,alice.kind,alice.level,alice.messages,alice.completed,alice.sessions],['Alice Nguyen','alice@example.test','google','N4',1,1,1]);
  assert.equal(list.users.find(u=>u.user_id==='legacy-guest-1').kind,'guest');assert.equal(list.users.find(u=>u.user_id==='google:qa').admin,true);
  assert.deepEqual((await (await get('/api/admin/users?q=alice')).json()).users.map(u=>u.user_id),['google:alice']);
  assert.equal((await (await get('/api/admin/users?q=%25')).json()).total,0);
  assert.equal((await get('/api/admin/user?id=nobody')).status,404);
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'set_level',level:'N9'})).status,400);
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'set_level',level:'N2'})).status,200);
  assert.equal((await (await get('/api/admin/user?id=google:alice')).json()).level,'N2');
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'clear_chat'})).status,200);assert.equal((await env.DB.prepare("SELECT count(*) n FROM conversations WHERE user_id='google:alice'").first()).n,0);
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'reset_progress'})).status,200);assert.equal((await env.DB.prepare("SELECT count(*) n FROM completions WHERE user_id='google:alice'").first()).n,0);
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'revoke_sessions'})).status,200);assert.equal((await env.DB.prepare("SELECT count(*) n FROM sessions WHERE user_id='google:alice'").first()).n,0);
  await env.DB.prepare("INSERT INTO ai_providers(user_id,id,name,protocol,base_url,model,key_enc,key_last4,updated_at) VALUES('google:alice','alice-api','API','openai','https://api.example.com/v1','m','x','1234',?)").bind(now).run();
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'remove_api'})).status,200);assert.equal((await env.DB.prepare("SELECT count(*) n FROM ai_providers WHERE user_id='google:alice'").first()).n,0);
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'explode'})).status,400);
  assert.equal((await post('/api/admin/user',{id:'google:qa',action:'delete'})).status,400);
  assert.equal((await post('/api/admin/user',{id:'google:alice',action:'delete'})).status,200);
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM profiles WHERE user_id='google:alice'").first()).n,0);assert.equal((await get('/api/admin/user?id=google:alice')).status,404);
});

test('thầy Lâm receives the current screen and learner notes wherever he is summoned',async()=>{
  const {env,request}=await authenticated(),previous=globalThis.fetch;await withApi(env,request);
  await env.DB.prepare("INSERT INTO progress(user_id,item_id,item_type,jlpt_level,correct,incorrect,display) VALUES('google:qa','x1','grammar','N5',0,3,'〜は'),('google:qa','x2','grammar','N5',5,0,'〜です')").run();
  let system='';globalThis.fetch=async(url,options)=>{system=JSON.parse(options.body).messages[0].content;return Response.json({choices:[{message:{content:'ok'}}]});};
  try{
    const screen={route:'quiz/N3',title:'Luyện thi',level:'N3',text:'Câu 2: 〜わけだ nghĩa là gì?\n<script>alert(1)</script>'};
    assert.equal((await worker.fetch(request('/api/chat',{message:'câu này là gì?',screen}),env)).status,200);
    assert.match(system,/JLPT N3/);assert.match(system,/<screen route="quiz\/N3" title="Luyện thi">Câu 2: 〜わけだ nghĩa là gì\?/);assert.ok(!system.includes('<script>'));
    assert.match(system,/Weakest items: 〜は\./);assert.ok(!system.includes('〜です.'));assert.match(system,/never reveal the answer/);
    for(const bad of ['text',{route:1,title:'',text:''},{route:'x',title:'y'},[]])assert.equal((await worker.fetch(request('/api/chat',{message:'hi',screen:bad}),env)).status,400);
    system='';await worker.fetch(request('/api/chat',{message:'xin chào'}),env);assert.ok(!system.includes('SCREEN ('));
    await worker.fetch(request('/api/chat',{message:'dài',screen:{...screen,text:'x'.repeat(9000)}}),env);assert.ok(system.length<20000);assert.ok(!system.includes('x'.repeat(3600)));
  }finally{globalThis.fetch=previous;}
});

test('Google accounts without a stored name and email must sign in again; email accounts are backfilled',async()=>{
  const {env,request}=await authenticated();
  await env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at) VALUES('google:qa','N5','openjlpt','now')").run();
  const response=await worker.fetch(request('/api/auth/session'),env);
  assert.equal((await response.json()).user,null);assert.match(response.headers.get('set-cookie'),/vj_session=;.*Max-Age=0/);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM sessions').first()).n,0);
  const again=await authenticated();
  await again.env.DB.prepare("INSERT INTO profiles(user_id,level,track,updated_at,name,email) VALUES('google:qa','N5','openjlpt','now','QA','qa@example.test')").run();
  assert.equal((await (await worker.fetch(again.request('/api/auth/session'),again.env)).json()).user.user_id,'google:qa');
  const db=again.env.DB;
  await db.prepare("INSERT INTO password_accounts(user_id,email,name,password_hash,salt,created_at) VALUES('email:p1','p1@example.test','Pham','h','s','now')").run();
  await db.prepare("INSERT INTO profiles(user_id,level,track,updated_at) VALUES('email:p1','N5','openjlpt','2026-01-01')").run();
  await db.prepare("INSERT INTO sessions VALUES('h-g','legacy-guest','Khách',?)").bind(Date.now()+1000).run();
  await db.prepare("INSERT INTO profiles(user_id,level,track,updated_at) VALUES('legacy-guest','N5','openjlpt','2026-01-01')").run();
  const {readFileSync}=await import('node:fs');for(const statement of readFileSync('migrations/0013_identity_backfill.sql','utf8').split(';\n').map(s=>s.replace(/^--.*$/gm,'').trim()).filter(Boolean))await db.prepare(statement).run();
  const rows=await db.prepare("SELECT user_id,name,email,created_at FROM profiles WHERE user_id IN ('email:p1','legacy-guest') ORDER BY user_id").all();
  assert.deepEqual(rows.results.map(r=>[r.user_id,r.name,r.email,r.created_at]),[['email:p1','Pham','p1@example.test','2026-01-01'],['legacy-guest','Khách',null,'2026-01-01']]);
});
test('admins can purge old anonymous profiles without touching real accounts',async()=>{
  const {env,request}=await authenticated();env.ADMIN_EMAILS='owner@example.test';
  const post=path=>worker.fetch(request(path,{}),env),run=sql=>env.DB.prepare(sql).run();
  await run("INSERT INTO profiles(user_id,level,track,updated_at,name,email) VALUES('google:qa','N5','openjlpt','now','QA','owner@example.test')");
  await run("INSERT INTO profiles(user_id,level,track,updated_at,name,email) VALUES('google:keep','N5','openjlpt','now','Keep','k@example.test')");
  await run("INSERT INTO profiles(user_id,level,track,updated_at) VALUES('g1','N5','openjlpt','now'),('g2','N5','openjlpt','now')");
  await run("INSERT INTO conversations(user_id,role,content,timestamp) VALUES('g1','user','hi','now'),('google:keep','user','hi','now')");
  assert.equal((await post('/api/admin/purge-guests')).status,403);
  const {recordAdminLogin}=await import('../src/admin.js');await recordAdminLogin(env,'google:qa','owner@example.test');
  assert.equal((await (await worker.fetch(request('/api/admin/users'),env)).json()).guests,2);
  assert.equal((await (await post('/api/admin/purge-guests')).json()).removed,2);
  assert.equal((await env.DB.prepare("SELECT count(*) n FROM profiles").first()).n,2);
  assert.deepEqual((await env.DB.prepare("SELECT user_id FROM conversations").all()).results.map(r=>r.user_id),['google:keep']);
});

test('model discovery uses draft credentials without saving and protects saved endpoint ownership', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const draft = {protocol: 'openai', base_url: 'https://api.example.com/v1/chat/completions', api_key: 'draft-test-key'};
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({url, options});
    return Response.json({data: [{id: 'z-model'}, {id: 'a-model'}, {id: '~vendor/model-latest'}, {id: 'a-model'}, {id: '<unsafe>'}, {id: 'draft-test-key'}, {id: '~~bad'}, {id: '~' + 'x'.repeat(100)}]});
  };
  try {
    const anonymous = await worker.fetch(new Request('https://vjbot.test/api/ai/models', {method: 'POST', body: JSON.stringify(draft)}), {});
    assert.equal(anonymous.status, 401);
    for (const base_url of ['https://127.0.0.1/v1', 'https://localhost/v1', 'http://api.example.com/v1']) {
      assert.equal((await worker.fetch(request('/api/ai/models', {...draft, base_url}), env)).status, 400);
    }
    assert.equal(seen.length, 0);
    const result = await worker.fetch(request('/api/ai/models', draft), env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {models: ['a-model', 'z-model', '~vendor/model-latest'], truncated: false, scope: 'provider_catalog', free_only: false});
    assert.equal(seen[0].url, 'https://api.example.com/v1/models');
    assert.equal(seen[0].options.headers.Authorization, 'Bearer draft-test-key');
    assert.equal(seen[0].options.redirect, 'manual');
    assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_providers').first()).n, 0);
    await withApi(env, request);
    for (const patch of [{base_url: 'https://different.example.com/v1'}, {protocol: 'anthropic'}]) {
      assert.equal((await worker.fetch(request('/api/ai/models', {...draft, api_key: '', ...patch}), env)).status, 400);
    }
    assert.equal(seen.length, 1);
    assert.equal((await worker.fetch(request('/api/ai/models', {...draft, api_key: ''}), env)).status, 200);
    assert.equal(seen[1].options.headers.Authorization, 'Bearer sk-test-12345678');
    env.AI_KEY_SECRET = 'different-secret';
    assert.equal((await worker.fetch(request('/api/ai/models', {...draft, api_key: ''}), env)).status, 409);
    assert.equal(seen.length, 2);
    await env.DB.prepare('INSERT OR REPLACE INTO ai_usage VALUES(?,?,20)').bind('google:qa', Math.floor(Date.now()/60000)).run();
    assert.equal((await worker.fetch(request('/api/ai/models', draft), env)).status, 429);
    assert.equal(seen.length, 2);
  } finally { globalThis.fetch = previous; }
});

test('model discovery follows native pagination and filters Gemini generation capabilities', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(url);
    if (url.includes('googleapis.com')) {
      assert.equal(options.headers['x-goog-api-key'], 'native-test-key');
      return Response.json(url.includes('pageToken=next') ? {models: [{name: 'models/gemini-b', supportedGenerationMethods: ['generateContent']}]}
        : {models: [{name: 'models/embedding', supportedGenerationMethods: ['embedContent']}, {name: 'models/gemini-a', supportedGenerationMethods: ['generateContent']}], nextPageToken: 'next'});
    }
    assert.equal(options.headers['x-api-key'], 'native-test-key');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    return Response.json(url.includes('after_id=claude-a') ? {data: [{id: 'claude-b'}], has_more: false}
      : {data: [{id: 'claude-a'}], has_more: true, last_id: 'claude-a'});
  };
  try {
    for (const [protocol, base_url, models] of [
      ['gemini', 'https://generativelanguage.googleapis.com/v1beta', ['gemini-a', 'gemini-b']],
      ['anthropic', 'https://api.anthropic.com/v1', ['claude-a', 'claude-b']]
    ]) {
      const result = await worker.fetch(request('/api/ai/models', {protocol, base_url, api_key: 'native-test-key'}), env);
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), {models, truncated: false, scope: 'provider_catalog', free_only: false});
    }
    assert.equal(seen.length, 4);
    assert.match(seen[0], /\/v1beta\/models\?pageSize=1000$/);
    assert.match(seen[2], /\/v1\/models\?limit=1000$/);
  } finally { globalThis.fetch = previous; }
});

test('model discovery fails safely on redirects, malformed catalogs and upstream errors', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const draft = {protocol: 'openai', base_url: 'https://api.example.com/v1', api_key: 'private-test-key'};
  let calls = 0;
  try {
    for (const [reply, expected] of [
      [() => new Response('private-test-key', {status: 302, headers: {Location: 'https://other.example.com'}}), 502],
      [() => new Response('private-test-key', {status: 401}), 502],
      [() => new Response('private-test-key', {status: 403}), 502],
      [() => new Response('private-test-key', {status: 429}), 429],
      [() => new Response('private-test-key', {status: 404}), 404],
      [() => Response.json({error: 'private-test-key'}), 502],
      [() => new Response('x'.repeat(4000001)), 502],
      [() => Response.json({data: []}), 200]
    ]) {
      globalThis.fetch = async () => { calls++; return reply(); };
      const response = await worker.fetch(request('/api/ai/models', draft), env);
      assert.equal(response.status, expected);
      const payload = await response.text();
      assert.ok(!payload.includes('private-test-key'));
      if (expected === 200) assert.deepEqual(JSON.parse(payload), {models: [], truncated: false, scope: 'provider_catalog', free_only: false});
    }
    assert.equal(calls, 8);
    globalThis.fetch = async () => Response.json({data: [{id: 'one'}], has_more: true, last_id: 'same'});
    assert.equal((await worker.fetch(request('/api/ai/models', draft), env)).status, 502);
  } finally { globalThis.fetch = previous; }
});

test('OpenRouter discovery authenticates first and excludes paid or unknown-price models for a zero-budget key', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const draft = {protocol: 'openai', base_url: 'https://openrouter.ai/api/v1', api_key: 'router-test-key'};
  let keyStatus = 401, remaining = 0, freeTier = false, expired = false, invalidMetadata = false;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer router-test-key');
    assert.equal(options.redirect, 'manual');
    assert.ok(!options.method || options.method === 'GET');
    if (url.endsWith('/key')) return keyStatus !== 200 ? new Response('router-test-key', {status: keyStatus})
      : Response.json({data: invalidMetadata ? {} : {is_free_tier: freeTier, limit_remaining: remaining, expires_at: expired ? '2000-01-01T00:00:00Z' : null}});
    assert.equal(url, 'https://openrouter.ai/api/v1/models/user?output_modalities=text');
    return Response.json({data: [
      {id: 'free-model', pricing: {prompt: '0', completion: '0', request: '0'}},
      {id: 'paid-model', pricing: {prompt: '0.01', completion: '0.02'}},
      {id: 'unknown-price'}, {id: 'empty-price', pricing: {prompt: '', completion: null}},
      {id: 'request-fee', pricing: {prompt: '0', completion: '0', request: '1'}},
      {id: 'reasoning-fee', pricing: {prompt: '0', completion: '0', internal_reasoning: '1'}},
      {id: 'image-only', pricing: {prompt: '0', completion: '0'}, architecture: {output_modalities: ['image']}}
    ]});
  };
  try {
    assert.equal((await worker.fetch(request('/api/ai/models', draft), env)).status, 502);
    assert.deepEqual(calls, ['https://openrouter.ai/api/v1/key']);
    keyStatus = 200;
    let result = await (await worker.fetch(request('/api/ai/models', draft), env)).json();
    assert.deepEqual(result, {models: ['free-model'], truncated: false, scope: 'key_filtered', free_only: true});
    remaining = null; freeTier = true;
    result = await (await worker.fetch(request('/api/ai/models', draft), env)).json();
    assert.deepEqual(result.models, ['free-model']);
    remaining = 5; freeTier = false;
    result = await (await worker.fetch(request('/api/ai/models', draft), env)).json();
    assert.equal(result.free_only, false); assert.ok(result.models.includes('paid-model'));
    assert.ok(!result.models.includes('image-only'));
    expired = true;
    const before = calls.length;
    assert.equal((await worker.fetch(request('/api/ai/models', draft), env)).status, 502);
    assert.equal(calls.length, before + 1);
    expired = false; invalidMetadata = true;
    assert.equal((await worker.fetch(request('/api/ai/models', draft), env)).status, 502);
    assert.equal(calls.length, before + 2);
    assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_providers').first()).n, 0);
  } finally { globalThis.fetch = previous; }
});

test('selected-model verification blocks unlisted paid models and requires a real generation response', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  let generations = 0, generationStatus = 200;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/key')) return Response.json({data: {is_free_tier: true, limit_remaining: 0}});
    if (url.includes('/models/user')) return Response.json({data: [{id: 'free-model', pricing: {prompt: '0', completion: '0'}}]});
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(JSON.parse(options.body).model, 'free-model');
    generations++;
    return generationStatus === 200 ? Response.json({choices: [{message: {content: 'OK'}}]})
      : new Response('router-test-key', {status: generationStatus});
  };
  try {
    await withApi(env, request, {base_url: 'https://openrouter.ai/api/v1', model: 'paid-model'});
    assert.equal((await worker.fetch(request('/api/ai/test', {}), env)).status, 403);
    assert.equal(generations, 0);
    await withApi(env, request, {base_url: 'https://openrouter.ai/api/v1', model: 'free-model'});
    assert.deepEqual(await (await worker.fetch(request('/api/ai/test', {}), env)).json(), {ok: true, model: 'free-model'});
    for (const status of [401, 402, 403, 429, 504]) {
      generationStatus = status;
      const response = await worker.fetch(request('/api/ai/test', {}), env);
      assert.equal(response.status, status === 429 ? 429 : 503);
      const payload = await response.json();
      assert.equal(payload.ok, undefined);
      assert.ok(!JSON.stringify(payload).includes('router-test-key'));
      if (status === 403) assert.match(payload.detail, /denied access to this model/);
      if (status === 402) assert.match(payload.detail, /credits|spending limit/);
      if (status === 504) assert.match(payload.detail, /timed out/);
    }
    assert.equal(generations, 6);
  } finally { globalThis.fetch = previous; }
});

test('saved credentials remain bound to their endpoint while model aliases can be changed', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Saving must not contact a provider'); };
  try {
    await withApi(env, request);
    const original = await env.DB.prepare('SELECT * FROM ai_providers').first();
    for (const patch of [{base_url: 'https://other.example.com/v1'}, {base_url: 'https://api.example.com/other'}, {protocol: 'anthropic'}]) {
      for (const api_key of [undefined, '']) {
        const response = await worker.fetch(put(request, '/api/ai/settings', {
          protocol: 'openai', base_url: 'https://api.example.com/v1', model: 'other', api_key, ...patch
        }), env);
        assert.equal(response.status, 400);
        assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers').first(), original);
      }
    }
    const settings = {protocol: 'openai', base_url: 'https://api.example.com/v1/chat/completions', model: '~vendor/model-latest'};
    assert.equal((await worker.fetch(put(request, '/api/ai/settings', settings), env)).status, 200);
    const alias = await env.DB.prepare('SELECT * FROM ai_providers').first();
    assert.equal(alias.model, '~vendor/model-latest');
    assert.equal(alias.key_enc, original.key_enc);
    assert.equal(alias.base_url, original.base_url);
    for (const model of ['~~bad', '~', '~' + 'x'.repeat(100), 'vendor/model?token=bad']) {
      assert.equal((await worker.fetch(put(request, '/api/ai/settings', {...settings, model}), env)).status, 400);
    }
    assert.equal((await worker.fetch(put(request, '/api/ai/settings', {
      ...settings, base_url: 'https://other.example.com/v1', api_key: 'explicit-replacement-key'
    }), env)).status, 200);
    const changed = await env.DB.prepare('SELECT * FROM ai_providers').first();
    assert.equal(changed.base_url, 'https://other.example.com/v1');
    assert.notEqual(changed.key_enc, original.key_enc);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});

test('draft model probes require a session and preserve the saved connection', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  await withApi(env, request);
  const stored = await env.DB.prepare('SELECT * FROM ai_providers').first();
  const draft = {protocol: 'openai', base_url: 'https://draft.example.com/v1', api_key: 'draft-probe-key', model: '~vendor/model'};
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    if (options.headers['x-goog-api-key']) return Response.json({candidates: [{content: {parts: [{text: 'OK'}]}}]});
    if (options.headers['x-api-key']) return Response.json({content: [{type: 'text', text: 'OK'}]});
    return Response.json({choices: [{message: {content: 'OK'}}]});
  };
  try {
    const anonymous = new Request('https://vjbot.test/api/ai/models/test', {method: 'POST', body: JSON.stringify(draft)});
    assert.equal((await worker.fetch(anonymous, env)).status, 401);
    for (const invalid of [{...draft, api_key: ''}, {...draft, model: '<invalid>'}]) {
      assert.equal((await worker.fetch(request('/api/ai/models/test', invalid), env)).status, 400);
    }
    assert.equal(calls.length, 0);
    for (const protocol of ['openai', 'anthropic', 'gemini']) {
      const response = await worker.fetch(request('/api/ai/models/test', {...draft, protocol}), env);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {ok: true, model: draft.model});
      assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers').first(), stored);
    }
    assert.ok(calls.every(call => call.url.startsWith('https://draft.example.com/') && call.options.redirect === 'manual'));
    assert.equal(calls[0].options.headers.Authorization, 'Bearer draft-probe-key');
    assert.equal(calls[1].options.headers['x-api-key'], 'draft-probe-key');
    assert.equal(calls[2].options.headers['x-goog-api-key'], 'draft-probe-key');
    const response = await worker.fetch(request('/api/ai/models/test', {
      protocol: 'openai', base_url: stored.base_url, model: 'different-model'
    }), env);
    assert.equal(response.status, 200);
    assert.equal(calls[3].options.headers.Authorization, 'Bearer sk-test-12345678');
    assert.deepEqual(await env.DB.prepare('SELECT * FROM ai_providers').first(), stored);
    await env.DB.prepare('INSERT OR REPLACE INTO ai_usage(user_id,bucket,count) VALUES(?,?,20)')
      .bind(stored.user_id, Math.floor(Date.now() / 60000)).run();
    assert.equal((await worker.fetch(request('/api/ai/models/test', draft), env)).status, 429);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = previous; }
});

test('draft probes never verify empty responses or retry failures and keep provider errors private', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const draft = {protocol: 'openai', base_url: 'https://draft.example.com/v1', api_key: 'draft-probe-key', model: 'candidate'};
  let upstreamStatus = 200, calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (upstreamStatus === 504) throw new Error('synthetic network failure');
    return upstreamStatus === 200 ? Response.json({choices: [{message: {content: ' '}}]})
      : new Response('private-provider-body draft-probe-key', {status: upstreamStatus});
  };
  try {
    for (const status of [200, 401, 402, 403, 404, 429, 503, 504]) {
      upstreamStatus = status;
      const before = calls;
      const response = await worker.fetch(request('/api/ai/models/test', draft), env);
      assert.equal(response.status, [429, 504].includes(status) ? status : 502);
      const data = await response.json();
      assert.equal(data.ok, undefined);
      assert.equal(data.model, 'candidate');
      assert.equal(data.provider_status, status === 200 ? 502 : status);
      assert.ok(!JSON.stringify(data).includes('draft-probe-key'));
      assert.ok(!JSON.stringify(data).includes('private-provider-body'));
      assert.equal(calls, before + 1);
    }
    assert.equal((await env.DB.prepare('SELECT count(*) n FROM ai_providers').first()).n, 0);
  } finally { globalThis.fetch = previous; }
});

test('model cache identities bind actual credentials and reject a saved-key change before inference', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  await withApi(env, request);
  let generations = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') {
      generations++;
      return Response.json({choices: [{message: {content: 'OK'}}]});
    }
    return Response.json({data: [{id: 'm1'}]});
  };
  const draft = {protocol: 'openai', base_url: 'https://api.example.com/v1', api_key: 'sk-test-12345678'};
  const catalog = async patch => {
    const response = await worker.fetch(request('/api/ai/models', {...draft, ...patch}), env);
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const original = (await catalog({})).connection_id;
    assert.equal(typeof original, 'string');
    const restored = await (await worker.fetch(request('/api/ai/settings'), env)).json();
    assert.equal(restored.own.connection_id, original);
    assert.ok(!JSON.stringify(restored).includes(draft.api_key));
    assert.equal(restored.own.key_enc, undefined);
    assert.equal((await catalog({base_url: draft.base_url + '/chat/completions', api_key: ''})).connection_id, original);
    for (const patch of [{api_key: 'new-test-12345678'}, {base_url: 'https://other.example.com/v1'}, {protocol: 'anthropic'}]) {
      assert.notEqual((await catalog(patch)).connection_id, original);
    }
    const probe = {...draft, api_key: '', model: 'm1', connection_id: original};
    assert.equal((await worker.fetch(request('/api/ai/models/test', probe), env)).status, 200);
    await worker.fetch(put(request, '/api/ai/settings', {...draft, model: 'm1', api_key: 'replacement-key-1234'}), env);
    assert.equal((await worker.fetch(request('/api/ai/models/test', probe), env)).status, 409);
    assert.equal(generations, 1);
    assert.notEqual((await catalog({api_key: ''})).connection_id, original);
    assert.notEqual((await (await worker.fetch(request('/api/ai/settings'), env)).json()).own.connection_id, original);
    await env.DB.prepare("UPDATE sessions SET user_id='google:other'").run();
    assert.notEqual((await catalog({})).connection_id, original);
    delete env.AI_KEY_SECRET;
    assert.equal((await catalog({})).connection_id, undefined);
    assert.equal((await worker.fetch(request('/api/ai/models/test', {...probe, api_key: draft.api_key}), env)).status, 409);
    assert.equal(generations, 1);
  } finally { globalThis.fetch = previous; }
});

test('draft probes forward bounded Retry-After metadata without leaking provider bodies', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const draft = {protocol: 'openai', base_url: 'https://api.example.com/v1', api_key: 'retry-test-key', model: 'm'};
  let retry = '12';
  globalThis.fetch = async () => new Response('private retry-test-key', {status: 429, headers: {'Retry-After': retry}});
  try {
    let response = await worker.fetch(request('/api/ai/models/test', draft), env);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).retry_after_ms, 12000);
    retry = new Date(Date.now() + 60000).toUTCString();
    response = await worker.fetch(request('/api/ai/models/test', draft), env);
    const dated = await response.json();
    assert.ok(dated.retry_after_ms > 50000 && dated.retry_after_ms <= 60000);
    retry = 'not-a-delay';
    response = await worker.fetch(request('/api/ai/models/test', draft), env);
    const invalid = await response.json();
    assert.equal(invalid.retry_after_ms, undefined);
    assert.ok(!JSON.stringify(invalid).includes('retry-test-key'));
  } finally { globalThis.fetch = previous; }
});

test('draft probes finish on first visible SSE text and cancel without waiting for stream completion', {timeout: 2000}, async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  let cancelled = false, upstreamSignal, calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    upstreamSignal = options.signal;
    assert.equal(url, 'https://draft.example.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'candidate');
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, undefined);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'
          + 'data: {"choices":[{"delta":{"reasoning_content":"private thought"}}]}\n\n'
          + 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'));
        // Deliberately never close or send the rest of the generation.
      },
      cancel() { cancelled = true; return new Promise(() => {}); }
    }), {headers: {'Content-Type': 'text/event-stream'}});
  };
  try {
    const response = await worker.fetch(request('/api/ai/models/test', {
      protocol: 'openai', base_url: 'https://draft.example.com/v1', api_key: 'draft-stream-key', model: 'candidate'
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true, model: 'candidate'});
    assert.equal(cancelled, true);
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('draft probe forwards client cancellation to its upstream and discards late visible text', async () => {
  const {env, request} = await authenticated(), previous = globalThis.fetch;
  const client = new AbortController();
  let cancelled = false, upstreamSignal, started;
  const ready = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (url, options) => {
    upstreamSignal = options.signal;
    return new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"late text"}}]}\n\n'));
        }, {once: true});
      },
      pull() { started(); },
      cancel() { cancelled = true; }
    }, {highWaterMark: 0}), {headers: {'Content-Type': 'text/event-stream'}});
  };
  try {
    const pending = worker.fetch(new Request(request('/api/ai/models/test', {
      protocol: 'openai', base_url: 'https://draft.example.com', api_key: 'private-probe-key', model: 'candidate'
    }), {signal: client.signal}), env);
    await ready;
    client.abort(new Error('private-probe-key'));
    const response = await pending;
    assert.equal(response.status, 504);
    const result = await response.json();
    assert.equal(result.ok, undefined);
    assert.equal(result.provider_status, 504);
    assert.ok(!JSON.stringify(result).includes('private-probe-key'));
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = previous; }
});
