import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceTts} from '../src/voice/tts-route.js';
import {segmentVoiceText} from '../src/voice/segmenter.js';
import {createSegmentChunker} from '../src/voice/live-turn.js';

const key = 'synthetic-tts-test-key';
const slot = (provider, voice_id, base_url) => ({provider, voice_id,
  profile:{scope:'local',connection:{api_key:key,...(base_url ? {base_url} : {})}}});
const split = (ja, vi) => ({version:2,mode:'dual_split_api',primary:vi,ja,vi:{profile:null}});
const tts = (body, {env = {}, ...context} = {}) => voiceTts(body, env, {userId:'learner', ...context});
const lines = async response => (await response.text()).trim().split('\n').map(line => JSON.parse(line));

function intercept(t, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {globalThis.fetch = original;});
}

const mp3 = () => new Response(Uint8Array.of(73,68,51,4), {headers:{'Content-Type':'audio/mpeg'}});

test('bilingual stream binds each segment to its selected provider and preserves order and boundaries', async t => {
  const calls = [];
  intercept(t, async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push([new URL(url).hostname, body.text ?? body.input, body.language_code]);
    assert.equal(init.redirect, 'manual');
    if (url.includes('mistral.ai')) {
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.equal(body.voice_id, 'voice_3133');
      return Response.json({audio_data:'SUQzBA=='});
    }
    assert.equal(init.headers['xi-api-key'], key);
    assert.match(url, /\/text-to-speech\/vi_voice\?/);
    return mp3();
  });
  const response = await tts({text:'Trợ từ 「は」 → 「{学校|がっこう}に行きます」. <vi>Thử nói nhé.</vi>', mode:'bilingual',stream:true,
    routing:split(slot('mistral','voice_3133'),slot('elevenlabs','vi_voice'))});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^application\/x-ndjson\b/);
  assert.deepEqual((await lines(response)).map(({type,lang,boundary})=>[type,lang,boundary]),[
    ['segment','vi','start'],['segment','ja','inline'],['segment','ja','arrow'],['segment','vi','sentence'],['done',undefined,undefined]]);
  assert.deepEqual(calls, [
    ['api.elevenlabs.io','Trợ từ','vi'], ['api.mistral.ai','「わ」',undefined],
    ['api.mistral.ai','「学校に行きます」.',undefined], ['api.elevenlabs.io','Thử nói nhé.','vi']]);
});

test('one Mistral voice sends one unlabelled mixed REST input per meaningful arrow clause', async t => {
  const calls = [];
  intercept(t, async (url,init) => {
    assert.equal(url,'https://api.mistral.ai/v1/audio/speech');
    calls.push(JSON.parse(init.body));
    return Response.json({audio_data:'SUQzBA=='});
  });
  const model = 'voxtral-mini-tts-3-0', voice = 'voice_custom', speed = 0.85;
  const primary = {...slot('mistral',voice),kanji_mode:'kana_first',speed};
  const text = '→ Trợ từ 「<ja>は</ja>」 (wa) và “へ” (e): <ja>学校(がっこう)へ行きます。</ja> (gakkō e ikimasu) Em đọc nhé! → … → <vi>Tiếng Việt (ví dụ), nhé.</vi> → 私は学生です。「はし」を読みます。(hashi) (âm) → <ja>「たべよう」(tabeyo)</ja> <vi>là cách nói rủ rê.</vi> → <vi>Hãy đọc</vi><ja>DVD</ja><vi>lần nữa.</vi> → <ja>日本語能力試験</ja> (JLPT)';
  const expectedInputs = ['Trợ từ 「わ」 và “え”: がっこうへ行きます。 Em đọc nhé!', 'Tiếng Việt (ví dụ), nhé.', '私は学生です。「はし」を読みます。 (âm)',
    '「たべよう」 là cách nói rủ rê.', 'Hãy đọc DVD lần nữa.', '日本語能力試験 (JLPT)'];
  const routing = {version:2,mode:'single',primary};
  for (const mode of [undefined,null,'bilingual']) {
    const records = await lines(await tts({text,mode,stream:true,routing}));
    assert.deepEqual(records,[
      ...['ja','vi','ja','ja','vi','ja'].map((lang,index)=>({type:'segment',index,lang,boundary:index?'arrow':'start',
        speed,voice,model,audioBase64:'SUQzBA==',mimeType:'audio/mpeg'})),
      {type:'done',count:6}
    ]);
    assert.deepEqual(calls.splice(0),expectedInputs.map(input=>({model,voice_id:voice,input,response_format:'mp3'})));
  }
});

test('Mistral mixed clauses keep tagged numeric text and skip unmarked non-speech', async t => {
  const inputs = [];
  intercept(t, async (_url,init) => {inputs.push(JSON.parse(init.body).input);return mp3();});
  const routing = {version:2,mode:'single',primary:slot('mistral','custom_voice')};
  const records = await lines(await tts({text:'→ … → <ja>３。→ ４? → 10〜20%</ja> → <vi>3.5 → 3:15 → １００％ ～ １２０％</vi> → 29 →',stream:true,routing}));
  assert.deepEqual(inputs,['３。','４?','10〜20%','3.5','3:15','１００％ ～ １２０％']);
  assert.deepEqual(records.map(({type,lang,boundary})=>[type,lang,boundary]),[
    ['segment','ja','start'],['segment','ja','arrow'],['segment','ja','arrow'],['segment','vi','arrow'],
    ['segment','vi','arrow'],['segment','vi','arrow'],['done',undefined,undefined]]);
  const empty = await tts({text:'→ ! → 404',stream:true,routing});
  assert.equal(empty.status,400);
  assert.equal((await empty.json()).code,'tts_no_text');
  assert.equal(inputs.length,6);
});

test('untagged ranges and single numbers follow their Japanese counter in bilingual synthesis', async t => {
  const calls=[];
  intercept(t,async (url,init)=>{
    const body=JSON.parse(init.body);
    calls.push([new URL(url).hostname,body.input ?? body.text]);
    return url.includes('mistral.ai') ? Response.json({audio_data:'SUQzBA=='}) : mp3();
  });
  const routing=split(slot('mistral','voice_3133'),slot('elevenlabs','vi_voice'));
  const counters=['10〜20人。','１０　～　２０人。','5人。'];
  for(const counter of counters) {
    const records=await lines(await tts({text:`Ví dụ: ${counter}`,stream:true,routing}));
    assert.deepEqual(records.map(({lang})=>lang),['vi','ja',undefined]);
    assert.deepEqual(calls.splice(0),[['api.elevenlabs.io','Ví dụ:'],['api.mistral.ai',counter]]);
  }
  for(const value of ['20%','10〜20%']) {
    await lines(await tts({text:`Giảm ${value}\n二割引`,stream:true,routing}));
    assert.deepEqual(calls.splice(0),[['api.elevenlabs.io',`Giảm ${value}`],['api.mistral.ai','二割引']]);
  }
});

test('Japanese-only and dual same-account Mistral keep script routing and preset or explicit voice precedence', async t => {
  const calls = [];
  intercept(t, async (_url,init) => {
    const {input,voice_id} = JSON.parse(init.body);
    calls.push([input,voice_id]);
    return mp3();
  });
  const text = '<vi>Em nghe nhé.</vi> <ja>学校(がっこう)へ行きます。</ja> (gakkō e ikimasu) → <ja>私は学生です。</ja> <vi>Đọc lại nhé.</vi>';
  const primary = slot('mistral','custom_ja');
  const single = {version:2,mode:'single',primary};
  const only = await lines(await tts({text,mode:'ja',stream:true,routing:single}));
  assert.deepEqual(only.map(({type,lang,boundary})=>[type,lang,boundary]),[
    ['segment','ja','start'],['segment','ja','arrow'],['done',undefined,undefined]]);
  assert.deepEqual(calls.splice(0),[['学校へ行きます。','custom_ja'],['私は学生です。','custom_ja']]);

  const dual = {version:2,mode:'dual_same_api',primary:slot('mistral',''),ja:{profile:null},vi:{profile:null}};
  const defaultVoices = await lines(await tts({text,stream:true,routing:dual}));
  assert.deepEqual(defaultVoices.map(({type,lang,boundary})=>[type,lang,boundary]),[
    ['segment','vi','start'],['segment','ja','sentence'],['segment','ja','arrow'],['segment','vi','sentence'],['done',undefined,undefined]]);
  assert.deepEqual(calls.splice(0),[['Em nghe nhé.','voice_3144'],['学校へ行きます。','voice_3133'],
    ['私は学生です。','voice_3133'],['Đọc lại nhé.','voice_3144']]);

  dual.primary.voice_id='shared_clone';
  dual.ja.voice_id='custom_ja';
  assert.deepEqual((await lines(await tts({text,stream:true,routing:dual}))).at(-1),{type:'done',count:4});
  assert.deepEqual(calls.map(row=>row[1]),['shared_clone','custom_ja','custom_ja','shared_clone']);
});

test('Mistral keeps quoted particle pronunciation when slower Live separates languages', async t => {
  const calls=[];
  intercept(t, async (url, init) => {
    assert.equal(url,'https://api.mistral.ai/v1/audio/speech');
    const {input,voice_id}=JSON.parse(init.body);
    calls.push([input,voice_id]);
    return mp3();
  });
  const primary=slot('mistral','voice_clone');
  const text='<ja>助詞の「は」と「へ」を使います。学校へ行きます。</ja> <vi>Em đọc nhé.</vi>';
  const japanese='助詞の「わ」と「え」を使います。学校へ行きます。';
  const single={version:2,mode:'single',primary};
  const split={...single,mode:'dual_same_api',ja:{profile:null},vi:{profile:null}};
  await lines(await tts({text,mode:'bilingual',stream:true,routing:single}));
  assert.deepEqual(calls.splice(0),[[`${japanese} Em đọc nhé.`,'voice_clone']]);
  await lines(await tts({text,mode:'bilingual',stream:true,routing:split}));
  assert.deepEqual(calls,[[japanese,'voice_clone'],['Em đọc nhé.','voice_clone']]);
});

test('display segmentation keeps particle spellings and placeholders; only TTS reads citations phonetically', async t => {
  const text = '<ja>は</ja> → <ja>「へ」</ja> → <ja>学校へ行きます。</ja>';
  assert.deepEqual(segmentVoiceText(text),[
    {lang:'ja',text:'は',boundary:'start'},
    {lang:'ja',text:'「へ」',boundary:'arrow'},
    {lang:'ja',text:'学校へ行きます。',boundary:'arrow'}
  ]);
  assert.deepEqual(segmentVoiceText('猫___が＿＿＿いる。'),[
    {lang:'ja',text:'猫___が＿＿＿いる。',boundary:'start'}
  ]);
  for (const [input,options] of [
    ['<ja>___ ＿＿＿</ja>',{}],
    ['<ja>___ ＿＿＿</ja>',{mixLanguages:true}],
    ['___ ＿＿＿',{hint:'ja'}]
  ]) {
    assert.deepEqual(segmentVoiceText(input,'bilingual',options),[
      {lang:'ja',text:'___ ＿＿＿',boundary:'start'}
    ]);
  }
  const inputs = [];
  intercept(t, async (_url,init) => {inputs.push(JSON.parse(init.body).input);return mp3();});
  const routing = {version:2,mode:'single',primary:slot('openai','alloy')};
  const records = await lines(await tts({text,mode:'ja',stream:true,routing}));
  assert.deepEqual(records.at(-1),{type:'done',count:3});
  assert.deepEqual(inputs,['わ','「え」','学校へ行きます。']);
});

test('synthesis sends attached ASCII and fullwidth blanks only as clip boundaries', async t => {
  const inputs = [];
  intercept(t, async (_url,init) => {inputs.push(JSON.parse(init.body).input);return mp3();});
  const primary = {...slot('mistral','voice_clone'),kanji_mode:'kana_first'};
  const single = {version:2,mode:'single',primary};
  const dual = {...single,mode:'dual_same_api',ja:{profile:null},vi:{profile:null}};
  const text = '___ <vi>__Đọc__ nhé: </vi><ja>**猫**___{学校|がっこう}＿＿＿へ行きます。</ja> (gakkō ___ e ikimasu) → <vi>___Tốt___ lắm!</vi> ＿＿＿';
  for (const [routing,mode,expectedInputs,expectedBoundaries] of [
    [single,'bilingual',['Đọc nhé: 猫','がっこう','へ行きます。','Tốt lắm!'],['start','blank','blank','arrow']],
    [dual,'bilingual',['Đọc nhé:','猫','がっこう','へ行きます。','Tốt lắm!'],['start','inline','blank','blank','arrow']],
    [single,'ja',['猫','がっこう','へ行きます。'],['start','blank','blank']]
  ]) {
    const records = await lines(await tts({text,mode,stream:true,routing}));
    assert.deepEqual(records.map(row=>row.boundary),[...expectedBoundaries,undefined]);
    assert.deepEqual(records.at(-1),{type:'done',count:expectedInputs.length});
    assert.deepEqual(inputs.splice(0),expectedInputs);
  }
  const numbers = await lines(await tts({text:'<ja>３。___４?</ja>',stream:true,routing:single}));
  assert.deepEqual(numbers.map(row=>row.boundary),['start','blank',undefined]);
  assert.deepEqual(inputs.splice(0),['３。','４?']);
  const formatted = await lines(await tts({text:'<ja>**猫**___**犬**____**鳥**</ja>',stream:true,routing:single}));
  assert.deepEqual(formatted.map(row=>row.boundary),['start','blank','blank',undefined]);
  assert.deepEqual(inputs.splice(0),['猫','犬','鳥']);

  for (const text of ['___','<ja>＿＿＿</ja>','___ → ＿＿＿']) {
    const empty = await tts({text,mode:'ja',reading:'くうらん',stream:true,routing:single});
    assert.equal(empty.status,400);
    assert.equal((await empty.json()).code,'tts_no_text');
  }
  assert.deepEqual(inputs,[]);
});

test('shared romaji cleanup preserves reading preference, annotations and grammatical particles', async t => {
  const inputs = [];
  intercept(t, async (_url,init) => {inputs.push(JSON.parse(init.body).input);return mp3();});
  const routing = {version:2,mode:'single',primary:slot('openai','alloy')};
  const text = '<ja>「は」(wa)と「へ」(e)。私は{学校|がっこう}へ行きます。</ja>\n(watashi wa gakkō e ikimasu) <ja>パーティー(paatii)と日々(hibi)。</ja> <vi>Nhắc lại (N5).</vi>';
  for (const kanji_mode of ['kanji_native','kana_first']) {
    routing.primary.kanji_mode=kanji_mode;
    assert.deepEqual((await lines(await tts({text,stream:true,routing}))).at(-1),{type:'done',count:2});
  }
  assert.deepEqual(inputs,['「わ」と「え」。私は学校へ行きます。 パーティーと日々。','Nhắc lại (N5).',
    '「わ」と「え」。私はがっこうへ行きます。 パーティーと日々。','Nhắc lại (N5).']);
});

test('Live captions preserve readings and standalone blanks while TTS only sends spoken clips', async t => {
  const captions = [], chunker = createSegmentChunker({onSegment:item => captions.push(item)});
  const source = '<ja>食べる(taberu)</ja> （＿＿＿！？） <ja>学校（gakkō） Em đọc nhé.</ja>'
    + '食べる(taberu)<ja>走る</ja>（hashiru）<ja>日本語能力試験 (JLPT)</ja> ___!';
  for (const delta of source) chunker.push(delta);
  chunker.flush();
  assert.deepEqual(captions.map(({lang,text,speech_start}) => [lang,text,speech_start]),[
    ['ja','食べる(taberu)',undefined],['ja','（＿＿＿！？）',undefined],['ja','学校（gakkō）',undefined],
    ['vi','Em đọc nhé.',undefined],['ja','食べる(taberu)',undefined],['ja','走る',undefined],['ja','（hashiru）',9],
    ['ja','日本語能力試験 (JLPT)',undefined],['ja','___!',undefined]
  ]);

  const inputs = [];
  intercept(t, async (_url,init) => {inputs.push(JSON.parse(init.body).input);return mp3();});
  const routing = {version:2,mode:'single',primary:slot('openai','alloy')};
  const playback = parts => tts({text:parts
    .map(({lang,text,speech_start}) => `<${lang}>${text.slice(speech_start)}</${lang}>`).join(' '),
    mode:'bilingual',stream:true,routing});
  const records = await lines(await playback(captions));
  assert.deepEqual(records.map(({type,boundary})=>[type,boundary]),[
    ['segment','start'],['segment','blank'],['segment','inline'],['segment','sentence'],['done',undefined]
  ]);
  assert.deepEqual(inputs.splice(0),['食べる','学校','Em đọc nhé.','食べる 走る 日本語能力試験 (JLPT)']);
  const blank = await playback([captions[1],captions.at(-1)]);
  assert.equal(blank.status,400);
  assert.equal((await blank.json()).code,'tts_no_text');
  assert.deepEqual(inputs,[]);
});

test('Mistral mixed mode enforces text, segment, connection and admin limits before synthesis', async t => {
  let calls=0;
  intercept(t, async () => {calls++;return mp3();});
  const routing = {version:2,mode:'single',primary:slot('mistral','custom_voice')};
  const request = text => ({text,stream:true,routing});
  const tooMany = await tts(request(Array(17).fill('Ví dụ 日本語。').join(' → ')));
  assert.equal(tooMany.status,413);
  assert.equal((await tooMany.json()).code,'tts_segment_limit');
  assert.equal((await tts(request('あ'.repeat(4001)))).status,413);
  assert.equal((await tts(request('日本語 và tiếng Việt.'),{admin:true})).status,403);
  routing.primary.profile.connection.base_url='https://voice.example/v1';
  assert.equal((await tts(request('日本語 và tiếng Việt.'))).status,403);
  assert.equal(calls,0);
});

test('Japanese-only listening preserves acronyms in Japanese context and skips Vietnamese', async t => {
  const inputs = [];
  intercept(t, async (_url,init) => {inputs.push(JSON.parse(init.body).input);return mp3();});
  const response = await tts({text:'DVDを見ます。 Em xem DVD. 映画は4Kです。 Em xem NASA\nＪＬＰＴの試験。 USB HDMI対応。 <vi>VI</vi>',mode:'ja',stream:true,
    routing:{version:2,mode:'single',primary:slot('openai','alloy')}});
  assert.equal(response.status,200);
  assert.equal((await lines(response)).at(-1).type,'done');
  assert.deepEqual(inputs,['DVDを見ます。 映画は4Kです。 ＪＬＰＴの試験。 USB HDMI対応。']);
});

test('explicit numeric segments reach playback in the tagged language', async t => {
  const inputs = [];
  intercept(t, async (_url, init) => {
    const {text,language_code} = JSON.parse(init.body);
    inputs.push([language_code,text]);
    return mp3();
  });
  const response = await tts({text:'<ja>３。</ja><vi>3.5</vi>',mode:'bilingual',stream:true,
    routing:{version:2,mode:'single',primary:slot('elevenlabs','only_clone')}});
  assert.equal(response.status,200);
  assert.deepEqual((await lines(response)).at(-1),{type:'done',count:2});
  assert.deepEqual(inputs,[['ja','３。'],['vi','3.5']]);
});

test('one ElevenLabs clone receives both language codes; multilingual v2 rejects VI before provider calls', async t => {
  const requests = [];
  intercept(t, async (url, init) => {requests.push([url,JSON.parse(init.body)]);return mp3();});
  const primary = slot('elevenlabs','only_clone','https://api.elevenlabs.io/v1/');
  const body = {text:'こんにちは。 Xin chào.',stream:true,routing:{version:2,mode:'single',primary}};
  assert.equal((await lines(await tts(body))).at(-1).type,'done');
  assert.deepEqual(requests.map(([url,data])=>[new URL(url).pathname,data.language_code]),[
    ['/v1/text-to-speech/only_clone','ja'], ['/v1/text-to-speech/only_clone','vi']]);
  primary.model = 'eleven_multilingual_v2';
  const rejected = await tts(body);
  assert.equal(rejected.status,400);
  assert.equal((await rejected.json()).code,'tts_language_unsupported');
  assert.equal(requests.length,2);
});

test('custom domains fail closed unless operator approved; redirects never receive a second request', async t => {
  const urls = [];
  intercept(t, async (url) => {urls.push(url); return new Response(null,{status:302,headers:{Location:'https://different.example/audio'}});});
  const primary = {...slot('openai_compatible','custom_voice','https://tts.example/v1/audio/speech'),model:'custom_model'};
  const body = {text:'Xin chào.',stream:true,routing:{version:2,mode:'single',primary}};
  assert.equal((await tts(body)).status,403);
  assert.deepEqual(urls,[]);
  const response = await tts(body,{env:{VOICE_ALLOWED_ORIGINS:'https://tts.example'}});
  const result = await lines(response);
  assert.equal(result[0].type,'error');
  assert.equal(result[0].code,'tts_unavailable');
  assert.deepEqual(urls,['https://tts.example/v1/audio/speech']);
});

test('voice catalog discovers ElevenLabs models and voices without synthesis or leaking a provider echo', async t => {
  const calls = [];
  intercept(t, async (url, init) => {
    calls.push([new URL(url).pathname,init.method]);
    return url.includes('/voices?') ? Response.json({voices:[{voice_id:'clone_x',name:'My clone',category:'cloned'},{voice_id:'echo',name:key}],has_more:false})
      : Response.json([{model_id:'eleven_flash_v2_5',can_do_text_to_speech:true,languages:[{language_id:'ja'},{language_id:'vi'}]}, {model_id:'stt_only',can_do_text_to_speech:false}]);
  });
  const response = await tts({action:'catalog',routing:{version:2,mode:'single',primary:slot('elevenlabs','')}});
  const catalog = await response.json();
  assert.deepEqual(catalog.voices,[{id:'clone_x',name:'My clone',category:'cloned'}]);
  assert.deepEqual(catalog.models,[{id:'eleven_flash_v2_5',languages:['ja','vi']}]);
  assert.deepEqual(calls,[['/v1/models','GET'],['/v2/voices','GET']]);
  assert.equal(JSON.stringify(catalog).includes(key),false);
});

test('voice catalog and playback distinguish billing from a rejected key and catalog permissions', async t => {
  let upstream;
  intercept(t, async () => new Response(`Private provider response ${key}`,{status:upstream}));
  const settings = provider => ({version:2,mode:'single',primary:slot(provider,'demo_voice')});
  for (const [status,code,http] of [[401,'tts_key_rejected',403],[402,'tts_billing',402],[403,'tts_catalog_permission',403],[429,'tts_quota',429]]) {
    upstream = status;
    const response = await tts({action:'catalog',routing:settings('elevenlabs')});
    assert.equal(response.status,http);
    const body = await response.json();
    assert.equal(body.code,code);
    assert.doesNotMatch(body.detail,/Private provider response/);
    if (status===402) assert.match(body.detail,/thanh toán.*hạn mức chi tiêu/);
  }
  for (const [status,code] of [[402,'tts_billing'],[403,'tts_key_rejected']]) {
    upstream = status;
    for (const provider of ['mistral','elevenlabs']) {
      const response = await tts({text:'こんにちは',mode:'ja',stream:true,routing:settings(provider)});
      const [record] = await lines(response);
      assert.equal(record.type,'error');
      assert.equal(record.code,code);
      assert.doesNotMatch(record.detail,/Private provider response/);
    }
  }
});

test('ElevenLabs synthesis maps bounded 429 codes without exposing upstream content', async t => {
  let make;
  intercept(t,async () => make());
  const routing={version:2,mode:'single',primary:slot('elevenlabs','demo_voice')};
  const failure=detail=>()=>Response.json({detail:{...detail,message:`Private upstream ${key}`}},{status:429});
  for (const [response,code,hint] of [
    [failure({code:'concurrent_limit_exceeded',status:'rate_limit_exceeded'}),'tts_concurrency',/cùng lúc/],
    [failure({status:'too_many_concurrent_requests'}),'tts_concurrency',/cùng lúc/],
    [failure({code:'rate_limit_exceeded'}),'tts_rate_limit',/quá nhanh/],
    [failure({code:'system_busy'}),'tts_quota',/giới hạn/],
    [()=>new Response(`<html>${key}</html>`,{status:429}),'tts_quota',/giới hạn/],
    [failure({code:'rate_limit_exceeded',extra:key.repeat(1024)}),'tts_quota',/giới hạn/]
  ]) {
    make=response;
    const [record]=await lines(await tts({text:'こんにちは。',stream:true,routing}));
    assert.deepEqual([record.type,record.code],['error',code]);
    assert.match(record.detail,hint);
    assert.doesNotMatch(JSON.stringify(record),/Private upstream|synthetic-tts-test-key/);
  }
});

test('ElevenLabs catalog distinguishes restricted credentials from invalid keys in bounded 401 replies', async t => {
  let failedPath, rejected, cancelled;
  intercept(t,async (url,init)=>{
    if (init.method==='POST' || url.includes(failedPath)) return rejected();
    return url.includes('/v1/models') ? Response.json([]) : Response.json({voices:[]});
  });
  const routing = {version:2,mode:'single',primary:slot('elevenlabs','manual_voice')};
  const denial = status => () => Response.json({detail:{status,message:`Private provider response ${key}`}},{status:401});
  for (failedPath of ['/v1/models','/v2/voices']) {
    for (const [make,code] of [
      [denial('missing_permissions'),'tts_catalog_permission'],
      [denial('invalid_api_key'),'tts_key_rejected'],
      [() => new Response(null,{status:401}),'tts_key_rejected'],
      [() => new Response('<html>Private provider response</html>',{status:401}),'tts_key_rejected'],
      [() => new Response(new ReadableStream({
        start(controller){controller.enqueue(new Uint8Array(8193));},
        cancel(){cancelled = true;}
      }),{status:401}),'tts_key_rejected']
    ]) {
      rejected = make;
      const response = await tts({action:'catalog',routing});
      assert.equal(response.status,403);
      const body = await response.json();
      assert.equal(body.code,code);
      assert.doesNotMatch(JSON.stringify(body),/Private provider response|missing_permissions|invalid_api_key/);
    }
    assert.equal(cancelled,true);
    cancelled=false;
  }
  rejected=denial('missing_permissions');
  const [record]=await lines(await tts({text:'こんにちは',mode:'ja',stream:true,routing}));
  assert.equal(record.type,'error');
  assert.equal(record.code,'tts_key_rejected','synthesis must not apply the catalog classification');
});

test('ElevenLabs catalog prioritizes billing even when a permissions failure arrives first', async t => {
  let first, permissionStatus;
  intercept(t, async url => {
    const status = url.includes('/v1/models') ? 402 : permissionStatus;
    if (status !== first) await new Promise(resolve => setImmediate(resolve));
    return status===401 ? Response.json({detail:{status:'missing_permissions'}},{status:401}) : new Response(null,{status});
  });
  const routing = {version:2,mode:'single',primary:slot('elevenlabs','')};
  for (permissionStatus of [401,403]) {
    for (first of [402,permissionStatus]) {
      const response = await tts({action:'catalog',routing});
      assert.equal(response.status,402);
      assert.equal((await response.json()).code,'tts_billing');
    }
  }
});

test('approved ElevenLabs proxies retain versioned mounts for catalog and speech',async t=>{
  const calls=[];
  intercept(t,async (url,init)=>{
    calls.push(new URL(url).pathname);
    if (init.method==='POST') return mp3();
    return url.includes('/voices?') ? Response.json({voices:[]}) : Response.json([]);
  });
  const routing={version:2,mode:'single',primary:slot('elevenlabs','clone','https://voice.example/gateway/v1/')};
  const context={env:{VOICE_ALLOWED_ORIGINS:'https://voice.example'}};
  assert.equal((await tts({action:'catalog',routing},context)).status,200);
  assert.equal((await lines(await tts({text:'こんにちは。',stream:true,routing},context))).at(-1).type,'done');
  assert.deepEqual(calls,['/gateway/v1/v1/models','/gateway/v1/v2/voices','/gateway/v1/v1/text-to-speech/clone']);
});

test('more than sixteen segments and unauthorized managed routes fail before synthesis', async t => {
  let calls=0;
  intercept(t, async () => {calls++; return mp3();});
  const routing={version:2,mode:'single',primary:slot('elevenlabs','clone')};
  assert.equal((await tts({text:'あ test '.repeat(9),stream:true,routing})).status,413);
  const platform={version:2,mode:'single',primary:{provider:'openai',profile:{scope:'platform',id:'openai'}}};
  assert.equal((await tts({text:'Xin chào.',stream:true,routing:platform},{env:{OPENAI_API_KEY:key}})).status,403);
  assert.equal((await tts({text:'Xin chào.',stream:true,routing},{admin:true,env:{OPENAI_API_KEY:key}})).status,403);
  assert.equal((await tts({text:'あ test '.repeat(5),stream:true,routing:platform},{admin:true,env:{OPENAI_API_KEY:key}})).status,413);
  assert.equal(calls,0);
});

test('a short grammar explanation with thirteen alternating parts stays in one ordered stream',async t=>{
  const calls=[];
  intercept(t,async (_url,init)=>{calls.push(JSON.parse(init.body));return mp3();});
  const text='Trong tiếng Nhật, trợ từ は đánh dấu chủ đề, còn が nhấn mạnh chủ ngữ. Ví dụ 「私は学生です」 và 「誰が来ますか」. Ngoài ra, trợ từ を đi với tân ngữ như 「本を読みます」 nhé!';
  const routing={version:2,mode:'single',primary:slot('elevenlabs','clone')};
  const records=await lines(await tts({text,stream:true,routing}));
  assert.deepEqual(records.at(-1),{type:'done',count:13});
  assert.deepEqual(records.slice(0,-1).map(row=>[row.lang,row.speed]),Array.from({length:13},(_,i)=>[i%2?'ja':'vi',1]));
  assert.equal(calls.length,13);
  assert.equal(calls[1].text,'わ');
});

test('ElevenLabs gates optional text fields by model and splits native and client speed',async t=>{
  const calls=[];
  intercept(t,async (_url,init)=>{calls.push(JSON.parse(init.body));return mp3();});
  for (const [model,lang,context] of [
    ['eleven_flash_v2_5','ja',true],['eleven_multilingual_v2',undefined,true],
    ['eleven_v3','ja',false],['eleven_v4_turbo','ja',false],['eleven_multilingual_v1',undefined,false]
  ]) {
    const primary={...slot('elevenlabs','clone'),model,speed:0.6};
    const records=await lines(await tts({text:'学校 → 教室',mode:'ja',stream:true,routing:{version:2,mode:'single',primary}}));
    const [first,second]=calls.splice(0);
    const limited=model==='eleven_multilingual_v1';
    assert.deepEqual([first.language_code,first.next_text,second.previous_text,first.voice_settings?.speed,records[0].speed],
      [lang,context?'教室':undefined,context?'学校':undefined,limited?undefined:0.7,limited?0.6:0.6/0.7]);
  }
});

test('native OpenAI speed is not applied again, and an authored Japanese reading overrides Kanji',async t=>{
  const calls=[];
  intercept(t,async (_url,init)=>{calls.push(JSON.parse(init.body));return mp3();});
  const primary={...slot('openai','alloy'),speed:0.8,kanji_mode:'kanji_native'};
  const routing={version:2,mode:'single',primary};
  for (const [text,reading] of [['一日','ついたち'],['一日','いちにち'],['一日','invalid reading'],['歯','は']]) {
    const records=await lines(await tts({text,reading,mode:'ja',stream:true,routing}));
    assert.equal(records[0].speed,1);
  }
  primary.kanji_mode='kana_first';
  await lines(await tts({text:'今日・明日',reading:'きょう・あした',mode:'ja',stream:true,routing}));
  assert.deepEqual(calls.map(body=>[body.input,body.speed]),[['ついたち',0.8],['いちにち',0.8],['一日',0.8],['は',0.8],['きょう・あした',0.8]]);
});

test('same ElevenLabs account never exceeds two concurrent syntheses, even for one language', async t => {
  let active=0,peak=0;
  intercept(t,async()=>{
    peak=Math.max(peak,++active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return mp3();
  });
  const primary=slot('elevenlabs','clone');
  const response=await tts({text:'学校 → 教室 → 駅 → 図書館',stream:true,routing:{version:2,mode:'single',primary}});
  const records=await lines(response);
  assert.deepEqual(records.slice(0,-1).map(record=>record.index),[0,1,2,3]);
  assert.equal(records.at(-1).count,4);
  assert.equal(peak,2);
});

test('serial synthesis allows one ElevenLabs request at a time across split voice profiles', async t => {
  let active=0,peak=0;
  const voices=[];
  intercept(t,async url=>{
    voices.push(new URL(url).pathname.split('/').at(-1));
    peak=Math.max(peak,++active);
    await new Promise(resolve=>setImmediate(resolve));
    active--;
    return mp3();
  });
  const ja=slot('elevenlabs','ja_voice'),vi=slot('elevenlabs','vi_voice');
  ja.profile.connection.api_key='another-synthetic-key';
  const records=await lines(await tts({text:'<ja>学校</ja> <vi>Trường học</vi> <ja>教室</ja>',stream:true,serial:true,routing:split(ja,vi)}));
  assert.deepEqual(records.map(record=>record.lang ?? record.type),['ja','vi','ja','done']);
  assert.deepEqual(voices,['ja_voice','vi_voice','ja_voice']);
  assert.equal(peak,1);
});

test('a buffered ElevenLabs 429 blocks later requests while a preceding clip finishes', async t => {
  const first=Promise.withResolvers(), rejected=Promise.withResolvers(), calls=[];
  intercept(t,async url=>{
    if (new URL(url).hostname==='api.mistral.ai') return first.promise;
    calls.push('ElevenLabs');
    rejected.resolve();
    return Response.json({detail:{code:'concurrent_limit_exceeded'}},{status:429});
  });
  const routing=split(slot('elevenlabs','clone'),slot('mistral','voice_3144'));
  const reading=lines(await tts({text:'<vi>Chào em.</vi> <ja>学校 → 教室</ja>',stream:true,serial:true,routing}));
  await rejected.promise;
  await new Promise(resolve=>setImmediate(resolve));
  first.resolve(mp3());
  const records=await reading;
  assert.deepEqual(records.map(({type,index,code})=>[type,index,code]),[['segment',0,undefined],['error',1,'tts_concurrency']]);
  assert.deepEqual(calls,['ElevenLabs']);
});

test('Mistral catalog identifies account clones and known presets without changing IDs or cursor', async t => {
  intercept(t,async (url,init)=>{
    const target=new URL(url);
    assert.equal(target.pathname,'/v2/audio/voices');
    assert.equal(target.searchParams.get('page_token'),'second');
    assert.equal(init.method,'GET');
    return Response.json({data:[
      {id:'voice_custom',name:'Teacher clone',type:'custom'},
      {id:'01a151d2-8c66-7662-a216-d4c1f38e8642',slug:'voice_3133',name:'Provider JP',type:'preset',languages:['ja']},
      {id:'01a151d2-8c66-7662-a216-d4c1f38e8643',slug:'voice_3144',name:'Provider VI',type:'preset',languages:['vi']},
      {id:'voice_3133',name:'Legacy JP',type:'preset'},
      {id:'voice_other',name:'Other provider voice',type:'preset',languages:['ja']}
    ],next_page_token:'third'});
  });
  const response=await tts({action:'catalog',cursor:'second',routing:{version:2,mode:'single',primary:slot('mistral','')}});
  assert.deepEqual(await response.json(),{models:[{id:'voxtral-mini-tts-3-0'}],
    voices:[
      {id:'voice_custom',name:'Teacher clone',category:'cloned'},
      {id:'01a151d2-8c66-7662-a216-d4c1f38e8642',name:'Haruto',category:'premade',lang:'ja'},
      {id:'01a151d2-8c66-7662-a216-d4c1f38e8643',name:'Huong',category:'premade',lang:'vi'},
      {id:'voice_3133',name:'Haruto',category:'premade',lang:'ja'},
      {id:'voice_other',name:'Other provider voice',category:'premade'}
    ],verified:false,next_cursor:'third'});
});

test('custom profiles preserve client speed unless opted into native speed', async t => {
  const calls=[], speeds=[];
  intercept(t,async (url,init)=>{
    calls.push(new URL(url).pathname);
    if (init.method==='GET') return Response.json({data:[{id:'owner/model'}]});
    assert.equal(JSON.parse(init.body).model,'owner/model');
    speeds.push(JSON.parse(init.body).speed);
    return Response.json({audioBase64:'SUQzBA==',mimeType:'audio/mpeg'});
  });
  const env={VOICE_ALLOWED_ORIGINS:'https://tts.example'};
  const primary=slot('openai_compatible','custom_voice','https://tts.example/v1');
  const routing={version:2,mode:'single',primary};
  const catalog=await (await tts({action:'catalog',routing},{env})).json();
  assert.deepEqual(catalog.models,[{id:'owner/model'}]);
  primary.model=catalog.models[0].id;
  primary.speed=1.1;
  assert.equal((await lines(await tts({text:'Xin chào.',stream:true,routing},{env})))[0].speed,1.1);
  primary.native_speed=true;
  const records=await lines(await tts({text:'Xin chào.',stream:true,routing},{env}));
  assert.equal(records[0].model,'owner/model');
  assert.equal(records[0].type,'segment');
  assert.equal(records[0].speed,1);
  assert.deepEqual(calls,['/v1/models','/v1/audio/speech','/v1/audio/speech']);
  assert.deepEqual(speeds,[undefined,1.1]);
});
