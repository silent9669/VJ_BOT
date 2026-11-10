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
  for(const migration of ['0001_base.sql','0002_sessions.sql','0003_srs_repetitions.sql','0004_progress_display.sql','0005_progress_attempts.sql','0006_learning_responses.sql','0007_completions.sql','0008_exam_attempts.sql','0009_password_accounts.sql','0010_chat_requests.sql','0011_ai_providers.sql'])db.exec(readFileSync('migrations/'+migration,'utf8'));
  const prepare=sql=>{let params=[];return {bind(...values){params=values;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){db.prepare(sql).run(...params);return {success:true};}};};
  return {prepare,batch:statements=>Promise.all(statements.map(s=>s.run()))};
}
async function asAdmin(env){env.ADMIN_EMAILS='owner@example.test';env.GEMINI_API_KEY='platform-key';await env.DB.prepare("INSERT INTO admins VALUES('google:qa','owner@example.test','now')").run();}
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
  await env.DB.prepare("INSERT INTO profiles VALUES('victim','N5','openjlpt','now')").run();
  assert.equal((await worker.fetch(request('/api/account/delete',{user_id:'victim'}),env)).status,200);
  assert.ok(await env.DB.prepare("SELECT * FROM profiles WHERE user_id='victim'").first());
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM sessions').first()).n,0);
});
test('TTS sends an explicit reading request and returns the audio part',async()=>{
  const {env,request}=await authenticated(),original=globalThis.fetch;
  env.GEMINI_API_KEY='test-only';
  globalThis.fetch=async(url,options)=>{
    assert.match(url,/gemini-3\.8-flash-tts/);
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

test('reversed chatbot sends level, lesson and turn count to the platform OpenAI-compatible endpoint',async()=>{
  const {env,request}=await authenticated(),original=globalThis.fetch;await asAdmin(env);
  const lesson={id:'chapter:N3:1',title:'Giải thích kết luận',level:'N3',goal:'Giải thích lại',content:'〜わけだ'};
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');assert.equal(options.headers.Authorization,'Bearer platform-key');
    const payload=JSON.parse(options.body),system=payload.messages[0];assert.equal(payload.model,'gemini-3.8-flash');assert.equal(system.role,'system');
    assert.match(system.content,/JLPT N3/);assert.match(system.content,/reversed classroom/);assert.match(system.content,/ONE question/);assert.match(system.content,/〜わけだ/);assert.match(system.content,/Hán Việt/);
    assert.equal(payload.messages.at(-1).content,'Bắt đầu');assert.ok(!('max_tokens' in payload));
    return Response.json({choices:[{message:{content:'Em thử giải thích mẫu này nhé?'}}]});
  };
  try{
    const response=await worker.fetch(request('/api/chat',{message:'Bắt đầu',lesson}),env);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.updated_topic.level,'N3');assert.equal(data.updated_topic.id,lesson.id);assert.ok(!JSON.stringify(data).includes('platform-key'));
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
  const {env,request}=await authenticated();await asAdmin(env);
  const previous=globalThis.fetch;let calls=0;
  const body={message:'こんにちは',request_id:crypto.randomUUID()};
  try{
    globalThis.fetch=async()=>{calls++;return Response.json({error:'upstream unavailable'},{status:503});};
    assert.equal((await worker.fetch(request('/api/chat',body),env)).status,503);
    assert.equal((await env.DB.prepare('SELECT count(*) n FROM conversations').first()).n,0);
    globalThis.fetch=async()=>{calls++;return Response.json({choices:[{message:{content:'こんにちは！'}}]});};
    const first=await worker.fetch(request('/api/chat',body),env);assert.equal(first.status,200);
    const retry=await worker.fetch(request('/api/chat',body),env);assert.equal(retry.status,200);assert.equal((await retry.json()).reply,'こんにちは！');
    assert.equal(calls,5);assert.equal((await env.DB.prepare('SELECT count(*) n FROM conversations').first()).n,2);
  }finally{globalThis.fetch=previous;}
});
test('platform chain falls back across models; admin settings change the platform protocol and models',async()=>{
  const {env,request}=await authenticated();await asAdmin(env);
  const previous=globalThis.fetch,seen=[];
  const ask=async handler=>{seen.length=0;globalThis.fetch=async(url,options)=>{seen.push([url,JSON.parse(options.body).model]);return handler(seen.length,url,options);};return worker.fetch(request('/api/chat',{message:'こんにちは'}),env);};
  try{
    let r=await ask(n=>n===1?Response.json({},{status:404}):Response.json({choices:[{message:{content:'はい、どうぞ。'}}]}));
    assert.equal(r.status,200);assert.equal((await r.json()).reply,'はい、どうぞ。');assert.deepEqual(seen.map(x=>x[1]),['gemini-3.8-flash','gemini-3.6-flash']);
    r=await ask(()=>Response.json({},{status:429}));assert.equal(r.status,429);assert.equal(seen.length,4);
    r=await ask(()=>Response.json({},{status:403}));assert.equal(r.status,503);assert.equal(seen.length,1);assert.match((await r.json()).detail,/Quản trị/);
    assert.equal((await worker.fetch(request('/api/admin/provider',{protocol:'gemini',model:'gemini-x',fallbacks:[]}),env)).status,404);
    const put=await worker.fetch(new Request('https://vjbot.test/api/admin/provider',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'gemini',model:'gemini-x',fallbacks:['gemini-y']})}),env);assert.equal(put.status,200);
    r=await ask((n,url,options)=>{assert.equal(options.headers['x-goog-api-key'],'platform-key');assert.match(url,/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-x:generateContent$/);return Response.json({candidates:[{content:{parts:[{text:'bỏ',thought:true},{text:'OK'}]}}]});});
    assert.equal((await r.json()).reply,'OK');
    const bad=await worker.fetch(new Request('https://vjbot.test/api/admin/provider',{method:'PUT',headers:request('/api/ai/settings').headers,body:JSON.stringify({protocol:'openai',model:'bad model',fallbacks:[]})}),env);assert.equal(bad.status,400);
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
  assert.equal((await (await worker.fetch(request('/api/auth/session'),env)).json()).user.is_admin,true);
  const overview=await (await worker.fetch(request('/api/admin/overview'),env)).json();assert.equal(overview.platform.protocol,'openai');assert.equal(typeof overview.users,'number');assert.ok(Array.isArray(overview.top));
  env.ADMIN_EMAILS='';assert.equal(await isAdmin(env,'google:qa'),false);assert.equal((await worker.fetch(request('/api/admin/overview'),env)).status,403);
});
