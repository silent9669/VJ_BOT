import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import worker from '../src/worker.js';
import {hashToken} from '../src/auth.js';
import {ANTIGRAVITY_PROFILE} from '../src/antigravity-gateway.js';

const learner = 'google:learner', other = 'google:other';
const key = 'synthetic-stt-voice-key', platformKey = 'synthetic-stt-platform-key';
const recording = 'RIFF0000WAVEaudio';
const audio = {audio:btoa(recording), mime_type:'audio/wav;codecs=pcm'};
const action = {action:'capabilities'};
const reference = id => ({id, level:'N5'});
const routing = (provider, profile, admin_override) => ({version:2, provider, profile, admin_override});
const local = (provider, base_url, admin_override) => routing(provider,{scope:'local',id:'device-voice',connection:{base_url,api_key:key}},admin_override);
const requestFor = (raw, headers = {}, signal) => new Request('https://vjbot.test/api/stt', {
  method:'POST', headers, body:raw, signal, ...(typeof raw === 'string' ? {} : {duplex:'half'})
});
const migrations = new URL('../migrations/', import.meta.url);

async function fixture(t, lessons = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const file of readdirSync(migrations).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file,migrations),'utf8'));
  }
  const DB = {prepare(sql) {
    let params = [];
    return {bind(...values) {params = values; return this;},
      async first() {return db.prepare(sql).get(...params) ?? null;},
      async run() {return db.prepare(sql).run(...params);}};
  }};
  const env = {DB, AI_KEY_SECRET:'synthetic-stt-encryption-key', OPENAI_API_KEY:platformKey, ASSETS:{fetch:async request =>
    new URL(request.url).pathname === '/course/teacher-N5.json'
      ? Response.json({lessons,items:{},scenarios:{}}) : new Response(null,{status:404})}};
  const tokens = new Map([[learner,'a'.repeat(64)],[other,'b'.repeat(64)]]);
  for (const [user,token] of tokens) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hashToken(token),user,user,Date.now()+600000);
  }
  const headers = (user = learner) => ({Cookie:'vj_session='+tokens.get(user),'X-VJBot-Account':user});
  const send = (body, extra = {}, user = learner) => worker.fetch(requestFor(JSON.stringify(body),{...headers(user),...extra}),env);
  async function profile(user, protocol = 'elevenlabs') {
    const response = await worker.fetch(new Request('https://vjbot.test/api/ai/profiles', {method:'POST', headers:headers(user),
      body:JSON.stringify({name:'Voice profile',protocol,model:'',api_key:key})}),env);
    assert.equal(response.status,201);
    return {scope:'server',id:(await response.json()).profile.id};
  }
  const usage = () => db.prepare('SELECT coalesce(sum(count),0) n FROM ai_usage').get().n;
  return {env, db, headers, send, profile, usage};
}

function intercept(t, respond) {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url,...init});
    return respond(calls.length,init);
  };
  t.after(() => {globalThis.fetch=original;});
  return calls;
}

async function reject(response, status, code) {
  assert.equal(response.status,status);
  if (code) assert.equal((await response.json()).code,code);
}

const success = () => Response.json({text:' こんにちは。 ',language_code:'jpn'});

test('Scribe capabilities are free; auto omits language hints through either approved mount',async t => {
  const {send,env,usage} = await fixture(t);
  const calls = intercept(t,success);
  const official = local('elevenlabs','https://api.elevenlabs.io/v1/');
  const custom = local('elevenlabs','https://voice.example/gateway/v1/');
  for (const language of [undefined,'auto','ja','vi']) {
    assert.deepEqual(await (await send({...action,stt_routing:official,language})).json(),{supported:true,provider:'elevenlabs',model:'scribe_v3'});
  }
  assert.deepEqual(await (await send({...action,stt_routing:custom})).json(),{supported:false,provider:null,model:null});
  await reject(await send({...audio,stt_routing:custom}),403,'stt_profile_unavailable');
  assert.equal(usage(),0);
  assert.equal(calls.length,0);
  env.VOICE_ALLOWED_ORIGINS='https://voice.example';
  for (const [stt_routing,language] of [[official,undefined],[custom,'auto']]) {
    const response = await send({...audio,stt_routing,language});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{text:'こんにちは。',language:'ja',language_probability:null});
  }
  assert.deepEqual(calls.map(call => call.url),['https://api.elevenlabs.io/v1/speech-to-text','https://voice.example/gateway/v1/v1/speech-to-text']);
  for (const {method,redirect,headers,body} of calls) {
    assert.deepEqual([method,redirect,headers],['POST','manual',{'xi-api-key':key}]);
    assert.equal(body.get('model_id'),'scribe_v3');
    assert.equal(body.has('language_code'),false);
    assert.equal(body.has('secondary_language_codes'),false);
    assert.equal(body.get('tag_audio_events'),'false');
    assert.equal(body.has('model'),false);
    assert.deepEqual([body.get('file').name,body.get('file').type,await body.get('file').text()],['recording.wav','audio/wav',recording]);
  }
});

test('invalid STT languages fail before a capability probe or recording is routed or billed',async t => {
  const {send,usage}=await fixture(t);
  const calls=intercept(t,success);
  for (const language of [null,'','en','ja-JP','jpn',1,['vi']]) {
    for (const payload of [action,audio]) {
      for (const binding of [{stt_routing:local('elevenlabs')},{}]) {
        const response=await send({...payload,...binding,language});
        assert.equal(response.status,400);
        const error=await response.json();
        assert.equal(error.code,'stt_invalid_language');
        assert.match(error.detail,/Chọn.+Tiếng Việt.+Tiếng Nhật/);
      }
    }
  }
  assert.equal(calls.length,0);
  assert.equal(usage(),0);
});

test('ElevenLabs accepts Japanese, Vietnamese and mixed speech without forwarding wrong-language guesses',async t => {
  const {send}=await fixture(t);
  const valid=[
    {language_code:'jpn',language_probability:0,text:' 今日はスーパーに行きます。 '},
    {language_code:'vie',language_probability:1,text:' Vào buổi sáng em đi học. '},
    {language_code:'ja',language_probability:'0.93',text:' Em muốn tập nói 「学校に行きます」. '},
    {language_code:'vi',language_probability:1.1,text:' Em đọc số 20. '},
    {language_code:'jpn',language_probability:-0.1,text:' はい。 '},
    {language_code:'vie',language_probability:0.74,text:' Dạ.',words:[{type:'word',text:key}]}
  ];
  const rejected=[
    {language_code:'zho',text:'就啊。'},
    {language_code:'hin',text:'सुनिछु हो?'},
    {language_code:'eng',text:'Is anybody there?'},
    {language_code:'jpn',text:'こんにちは。 सुनिछु हो?'},
    {text:'Không có mã ngôn ngữ.'}
  ];
  const noise={language_code:'jpn',text:'[singing]',words:[{type:'audio_event',text:'[singing]'}]};
  const samples=[...valid,...rejected,noise,{text:'  '}];
  const calls=intercept(t,n=>Response.json(samples[n-1]));
  const body={...audio,stt_routing:local('elevenlabs')};
  const metadata=[['ja',0],['vi',1],['ja',null],['vi',null],['ja',null],['vi',0.74]];
  for (const [i,row] of valid.entries()) {
    const response=await send(body);
    assert.equal(response.status,200);
    const [language,language_probability]=metadata[i];
    assert.deepEqual(await response.json(),{text:row.text.trim(),language,language_probability});
  }
  for (const row of rejected) {
    const response=await send(body);
    assert.equal(response.status,422);
    const error=await response.json();
    assert.equal(error.code,'stt_language_unsupported');
    assert.equal(error.text,undefined);
    assert.ok(!error.detail.includes(row.text));
  }
  for (const row of [noise,samples.at(-1)]) {
    const response=await send(body);
    assert.equal(response.status,200,row.text);
    assert.deepEqual(await response.json(),{text:''});
  }
  assert.equal(calls.length,samples.length);
});

test('explicit Scribe language pins a single hint and refuses mismatches without retrying',async t => {
  const {send}=await fixture(t);
  const rows=[
    ['ja',{language_code:'jpn',language_probability:0.4,text:' 学校です。 '}],
    ['vi',{language_code:'vie',language_probability:0.6,text:' Em đi học. '}],
    ['ja',{language_code:'vie',text:'Bản chép không đúng tiếng.'}],
    ['vi',{language_code:'jpn',text:'違う言語です。'}]
  ];
  const calls=intercept(t,n=>Response.json(rows[n-1][1]));
  for (const [i,[language,row]] of rows.entries()) {
    const response=await send({...audio,stt_routing:local('elevenlabs'),language});
    assert.equal(response.status,i<2?200:422);
    if (i<2) assert.deepEqual(await response.json(),{text:row.text.trim(),language,language_probability:row.language_probability});
    else {
      const error=await response.json();
      assert.equal(error.code,'stt_language_mismatch');
      assert.match(error.detail,language==='vi'?/nói lại bằng tiếng Việt/:/nói lại bằng tiếng Nhật/);
      assert.equal(error.text,undefined);
    }
    assert.equal(calls.length,i+1);
    assert.deepEqual(calls[i].body.getAll('language_code'),[language]);
    assert.equal(calls[i].body.has('secondary_language_codes'),false);
  }
});

test('OpenAI and Mistral use the transcription language, never translation, and reject contradictory detection',async t => {
  const {send}=await fixture(t);
  const cases=[
    ['openai','vi',{languages:[{code:'vi'}],text:' Tiếng Việt. '},200],
    ['openai','ja',{languages:[{code:'vi'}],text:'Tiếng Việt.'},422,'stt_language_mismatch'],
    ['openai','auto',{languages:[{code:'ja'},{code:'vi'}],text:'こんにちは。 Em chào thầy.'},200],
    ['openai','auto',{languages:[],text:'Unknown language.'},422,'stt_language_unsupported'],
    ['openai','auto',{languages:[{code:'en'}],text:'English.'},422,'stt_language_unsupported'],
    ['openai','auto',{text:'Привет.'},422,'stt_language_unsupported'],
    ['mistral','ja',{language:null,text:'こんにちは。'},200],
    ['mistral','vi',{language:'vi',text:'Em chào thầy.'},200],
    ['mistral','ja',{language:'vi',text:'Em chào thầy.'},422,'stt_language_mismatch'],
    ['mistral','auto',{language:'ja',text:'こんにちは。'},200],
    ['mistral','auto',{language:'zh',text:'中文。'},422,'stt_language_unsupported']
  ];
  const calls=intercept(t,n=>Response.json(cases[n-1][2]));
  for (const [i,[kind,language,result,status,code]] of cases.entries()) {
    const response=await send({...audio,stt_routing:local(kind),language});
    assert.equal(response.status,status);
    const payload=await response.json();
    if (status===200) assert.deepEqual(payload,{text:result.text.trim()});
    else {
      assert.equal(payload.code,code);
      assert.equal(payload.text,undefined);
      assert.equal(payload.language,undefined);
    }
    assert.equal(calls.length,i+1);
    const {url,body}=calls[i];
    assert.match(url,/\/audio\/transcriptions$/);
    assert.deepEqual(body.getAll('language'),language==='auto'?[]:[language]);
    assert.equal(body.get('return_language'),kind==='mistral' && language==='auto'?'true':null);
  }
});

test('Mistral sends canonical allowed terms only and retries one 422 without bias',async t => {
  const terms = Array.from({length:48},(_,i) => `語彙${i}`);
  const words = [{jp:'禁止',processing_allowed:false},{jp:'隔離',review_status:'quarantined'},
    {jp:'範囲外',capabilities:{processing:false}},{jp:'非公開',unavailable_reason:'blocked'},
    {jp:'長'.repeat(41)},{jp:123},{jp:terms[0]},...terms.map(jp => ({jp}))];
  const {send,usage} = await fixture(t,{long:{words},short:{words:[{jp:'こんにちは'},{jp:'教室'}]}});
  const attempts = [422,200,400,422,422,422,200];
  let cancelled = 0;
  const calls = intercept(t,n => attempts[n-1] === 200 ? success() : new Response(new ReadableStream({
    cancel() {cancelled++;}
  }),{status:attempts[n-1]}));
  const stt_routing = local('mistral');
  assert.equal((await send({...audio,stt_routing,lesson:reference('long'),language:'ja'})).status,200);
  assert.equal(calls.length,2);
  assert.equal(usage(),1);
  assert.equal(cancelled,1);
  const first = calls[0];
  assert.deepEqual([first.url,first.method,first.redirect,first.headers.Authorization,first.body.get('model')],
    ['https://api.mistral.ai/v1/audio/transcriptions','POST','manual',`Bearer ${key}`,'voxtral-mini-transcribe-3']);
  assert.deepEqual(first.body.getAll('context_bias'),terms.slice(0,40));
  assert.notEqual(calls[1].body,first.body);
  assert.equal(await calls[1].body.get('file').text(),recording);
  assert.deepEqual(calls[1].body.getAll('context_bias'),[]);
  assert.deepEqual(calls.slice(0,2).map(call=>call.body.getAll('language')),[['ja'],['ja']]);
  // A generic 400 does not retry, and a second 422 ends an otherwise eligible retry.
  await reject(await send({...audio,stt_routing,lesson:reference('short')}),503);
  assert.equal(calls.length,3);
  assert.deepEqual(calls[2].body.getAll('context_bias'),['こんにちは','教室','thầy Lâm','ありがとうございます','すみません','はい','いいえ','わかりました','もう一度お願いします']);
  await reject(await send({...audio,stt_routing,lesson:reference('short')}),503);
  assert.equal(calls.length,5);
  assert.equal(calls[4].body.has('context_bias'),false);
  await reject(await send({...audio,stt_routing}),503);
  assert.equal(calls.length,6);
  assert.equal(calls[5].body.has('context_bias'),false);
  const api_connection = {protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'mistral-small',api_key:key};
  assert.equal((await send({...audio,api_connection,lesson:reference('short')})).status,200);
  assert.ok(calls[6].body.getAll('context_bias').includes('教室'));
});

test('every STT provider rejects denied and invalid canonical lessons before billing or sending audio',async t => {
  const {send,usage} = await fixture(t,{secret:{processing_allowed:false},quarantined:{review_status:'quarantined'}});
  const calls = intercept(t,success);
  for (const connection of [...['openai','mistral','elevenlabs'].map(provider => ({stt_routing:local(provider)})),
    {api_connection:{protocol:'openai',base_url:'https://api.openai.com/v1',model:'gpt-chat',api_key:key}}]) {
    for (const id of ['secret','quarantined']) {
      const response = await send({...audio,...connection,lesson:reference(id)});
      assert.equal(response.status,409);
      assert.deepEqual(await response.json(),{detail:'Nguồn này không được phép gửi cho nhà cung cấp AI xử lý.'});
    }
    await reject(await send({...audio,...connection,lesson:reference('missing')}),400);
    await reject(await send({...audio,...connection,lesson:{...reference('secret'),words:[{jp:'client term'}]}}),400);
    await reject(await send({...audio,...connection,lesson:{id:'missing',level:'N1'}}),503);
  }
  assert.equal(calls.length,0);
  assert.equal(usage(),0);
});

test('STT checks the account before parsing or resolving either binding and rejects mixed or malformed routing',async t => {
  const {send,env,headers,usage} = await fixture(t);
  const calls = intercept(t,success);
  const stt_routing = local('elevenlabs');
  await reject(await worker.fetch(requestFor('{'),env),401);
  for (const account of [undefined,other]) {
    const {Cookie} = headers();
    const request = requestFor('{',{Cookie,...(account ? {'X-VJBot-Account':account} : {})});
    await reject(await worker.fetch(request,env),409,'account_changed');
    assert.equal(request.bodyUsed,false);
  }
  await reject(await send({...action,stt_routing,api_connection:null}),400,'stt_invalid_routing');
  await reject(await send({...audio,stt_routing},{'X-VJBot-Profile':`${ANTIGRAVITY_PROFILE}:saved`}),400,'stt_invalid_routing');
  for (const malformed of [null,{...stt_routing,version:1},{...stt_routing,admin_override:'false'},
    {...stt_routing,provider:'openai_compatible'},{...stt_routing,profile:undefined,scope:'local',connection:{api_key:key}}]) {
    await reject(await send({...action,stt_routing:malformed}),400,'stt_invalid_routing');
  }
  assert.equal(calls.length,0);
  assert.equal(usage(),0);
});

test('explicit voice selection works with active OAuth or no chat key, rejects stale and foreign profiles, and isolates admin modes',async t => {
  const {env,send,db,profile,usage} = await fixture(t);
  const saved = await profile(learner), mistral = await profile(learner,'mistral');
  const foreign = await profile(other);
  const calls = intercept(t,success);
  const server = routing('elevenlabs',saved);
  assert.deepEqual(await (await send(action)).json(),{supported:false,provider:null,model:null});
  assert.equal((await send({...audio,stt_routing:server})).status,200);
  // An independently active Antigravity account is persisted but STT must not contact its gateway.
  Object.assign(env,{ANTIGRAVITY_GATEWAY_URL:'https://gateway.example',ANTIGRAVITY_API_KEY:'synthetic-gateway-inference',
    ANTIGRAVITY_MANAGEMENT_KEY:'synthetic-gateway-management'});
  db.prepare(`INSERT INTO ai_antigravity_connections(user_id,auth_id,gateway_url,prefix,login_id,model,state,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(learner,'oauth-credential',env.ANTIGRAVITY_GATEWAY_URL,'oauth-prefix','saved','gemini-chat','active',Date.now());
  db.prepare('INSERT INTO ai_active_antigravity VALUES(?,?)').run(learner,'saved');
  const oauthPin = {'X-VJBot-Profile':'antigravity_oauth:saved'};
  assert.deepEqual(await (await send(action,oauthPin)).json(),{supported:false,provider:null,model:null});
  await reject(await send(audio,oauthPin),403,'no_transcription');
  assert.equal(calls.length,1);
  assert.equal(usage(),1);
  assert.equal((await send({...audio,stt_routing:routing('mistral',mistral)})).status,200);
  const platform = routing('openai',{scope:'platform',id:'openai'});
  for (const stt_routing of [routing('elevenlabs',foreign),routing('mistral',saved),platform,local('elevenlabs',undefined,true)]) {
    await reject(await send({...audio,stt_routing}),403,'stt_profile_unavailable');
  }
  db.prepare('DELETE FROM ai_providers WHERE user_id=? AND id=?').run(learner,saved.id);
  await reject(await send({...audio,stt_routing:server}),403,'stt_profile_unavailable');
  db.prepare('INSERT INTO admins VALUES(?,?,?)').run(learner,'admin@example.test','now');
  env.ADMIN_EMAILS = 'admin@example.test';
  await reject(await send({...audio,stt_routing:local('elevenlabs')}),403,'stt_profile_unavailable');
  await reject(await send({...audio,stt_routing:{...platform,admin_override:true}}),403,'stt_profile_unavailable');
  assert.equal(calls.length,2);
  assert.equal(usage(),2);
  assert.equal((await send({...audio,stt_routing:platform})).status,200);
  const override = local('elevenlabs',undefined,true);
  await reject(await send({...audio,stt_routing:override},{'X-VJBot-Profile':'platform_openai'}),400,'stt_invalid_routing');
  assert.equal((await send({...audio,stt_routing:override})).status,200);
  assert.deepEqual(calls.map(call => [call.url,call.headers]),[
    ['https://api.elevenlabs.io/v1/speech-to-text',{'xi-api-key':key}],
    ['https://api.mistral.ai/v1/audio/transcriptions',{Authorization:`Bearer ${key}`}],
    ['https://api.openai.com/v1/audio/transcriptions',{Authorization:`Bearer ${platformKey}`}],
    ['https://api.elevenlabs.io/v1/speech-to-text',{'xi-api-key':key}]
  ]);
});

test('legacy and explicit routing preserve their own provider error status contracts',async t => {
  const {send} = await fixture(t);
  const api_connection = {protocol:'openai',base_url:'https://api.openai.com/v1',api_key:key,model:'test-chat'};
  const calls = intercept(t,n => {
    if (n <= 2) return new Response(key,{status:401});
    if (n <= 4) return new Response(key,{status:402});
    if (n <= 6) return new Response('{');
    throw new Error('Connection failed.');
  });
  const legacy = {...audio,api_connection}, selected = {...audio,stt_routing:local('openai')};
  for (const [body,status] of [[legacy,503],[selected,403],[legacy,402],[selected,402],[legacy,504],[selected,502],[legacy,504],[selected,503]]) {
    const response = await send(body);
    assert.equal(response.status,status);
    const result = await response.json();
    assert.ok(!JSON.stringify(result).includes(key));
    if (status===402) {
      assert.equal(result.code,'stt_billing');
      assert.match(result.detail,/thanh toán.*hạn mức chi tiêu/);
    }
  }
  assert.equal(calls.length,8);
});

test('STT bounds streamed request and response bodies and never reflects upstream secrets',async t => {
  const {send,env,headers,usage} = await fixture(t);
  const stt_routing = local('elevenlabs');
  let requestCancelled = false, responseCancelled = false;
  const oversize = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2*1024*1024));
      controller.enqueue(new Uint8Array(1024*1024+1));
    },
    cancel() {requestCancelled=true;}
  });
  const responses = [429,503,401,402,403,302].map(status => new Response(`private upstream echo ${key}`,{status,
    headers:{Location:'https://redirect.example'}}));
  responses.push(Response.json({text:key}),new Response('{'),Response.json({text:'x'.repeat(6001)}),Response.json(null),
    new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(128*1024));
        controller.enqueue(new Uint8Array(128*1024+1));
      },
      cancel() {responseCancelled=true;}
    })));
  const calls = intercept(t,n => responses[n-1]);
  await reject(await worker.fetch(requestFor(oversize,headers()),env),413);
  assert.equal(requestCancelled,true);
  assert.equal(usage(),0);
  for (const status of [429,503,403,402,403,503,502,502,502,502,502]) {
    const response = await send({...audio,stt_routing});
    assert.equal(response.status,status);
    assert.doesNotMatch(await response.text(),/private upstream echo|synthetic-stt-voice-key/);
  }
  assert.equal(calls.length,11);
  assert.equal(responseCancelled,true);
});

test('caller abort cancels an in-progress transcription response',async t => {
  const {env,headers} = await fixture(t);
  const client = new AbortController();
  let started, cancelled = false;
  const reading = new Promise(resolve => {started=resolve;});
  const calls = intercept(t,() => new Response(new ReadableStream({
    pull() {started();},
    cancel() {cancelled=true;}
  },{highWaterMark:0})));
  const pending = worker.fetch(requestFor(JSON.stringify({...audio,stt_routing:local('elevenlabs')}),headers(),client.signal),env);
  await reading;
  client.abort();
  await reject(await pending,504);
  assert.equal(calls.length,1);
  assert.equal(calls[0].signal.aborted,true);
  assert.equal(cancelled,true);
});
