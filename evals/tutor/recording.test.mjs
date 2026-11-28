import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {captureBody,finalizeTurnEvidence,parseLive,rawGeminiText} from './capture.mjs';
import assertTurn from './assert-turn.mjs';
import {controls,verified} from './replay.mjs';
import {turnInput,nextHistory,selectCases} from './cases.mjs';

const frame=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const part={index:0,lang:'ja',boundary:'start',text:'「は」は助詞です。わたしは＿＿＿です。'};
const done={count:1,full_text:part.text,japanese_only:false};

test('raw provider text and learner-visible captions remain separate, with malformed completion rejected',()=>{
  const raw='<ja>「は」は助詞です。わたしは＿＿＿です。</ja>';
  const generated={candidates:[{content:{parts:[{text:'private reasoning',thought:true},{text:raw}]},finishReason:'STOP'}]};
  assert.equal(rawGeminiText(frame('message',generated),true),raw);
  assert.equal(rawGeminiText(JSON.stringify(generated),false),raw);
  assert.deepEqual(parseLive(frame('segment',part)+frame('done',done)),{reply:part.text,segments:[part],japanese_only:false});
  const annotated={...part,text:'(taberu) Nghĩa là ăn.',speech_start:8},caption={...done,full_text:annotated.text};
  assert.deepEqual(parseLive(frame('segment',annotated)+frame('done',caption)).segments,[annotated]);
  assert.equal(parseLive(frame('segment',{...annotated,speech_start:99})+frame('done',caption)).error,'incomplete_stream');
  for (const invalid of [frame('segment',part),frame('segment',part)+frame('done',{...done,count:2}),
    frame('done',done)+frame('segment',part),'data: {\n\n']) assert.ok(parseLive(invalid).error);
  assert.equal(parseLive(frame('error',{code:'live_incomplete',detail:'untrusted upstream text'})).error,'live_incomplete');
});

test('recording a terminal provider frame does not fail when the pending pull is cancelled',async()=>{
  const terminal=new TextEncoder().encode(frame('message',{candidates:[{finishReason:'STOP'}]}));
  const pending=Promise.withResolvers();
  let pulls=0,cancels=0;
  const source=new ReadableStream({
    pull(controller) {
      if (++pulls===1) controller.enqueue(terminal);
      else pending.resolve();
    },
    cancel() {cancels++;}
  },{highWaterMark:0});
  const slot={chunks:[],bytes:0,captureError:false};
  const reader=captureBody(source,slot).getReader();
  assert.deepEqual(await reader.read(),{value:terminal,done:false});
  await pending.promise;
  await reader.cancel();
  assert.equal(cancels,1);
  assert.deepEqual(slot,{chunks:[terminal],bytes:terminal.byteLength,captureError:false});
});

test('a real provider read failure still marks capture incomplete',async()=>{
  const broken=new Error('synthetic read failure');
  const source=new ReadableStream({pull(controller) {controller.error(broken);}});
  const slot={chunks:[],bytes:0,captureError:false};
  await assert.rejects(captureBody(source,slot).getReader().read(),{message:broken.message});
  assert.deepEqual(slot,{chunks:[],bytes:0,captureError:true});
});

test('tag- or whitespace-split credentials are removed from failed evidence and never become Live history',()=>{
  const secrets=['synthetic_gemini_canary_42','c0123456789abcde'.repeat(4)];
  const item={channel:'live',level:'N5'}, input=turnInput(item,{message:'Em hỏi nghĩa.'},null,[]);
  for (const secret of secrets) {
    const middle=Math.floor(secret.length/2), left=secret.slice(0,middle), right=secret.slice(middle);
    const tagged=`<JA>${left}</JA>\n\t\u0085<vi>${right}</vi>`;
    const segments=[{...part,text:left},{index:1,lang:'vi',boundary:'inline',text:right}];
    const reply=`${left} ${right}`;
    const candidates=[
      {channel:'live',error:null,reply:'Nghĩa là chưa đến.',raw_provider_text:tagged},
      {channel:'live',error:null,reply,segments,raw_provider_text:'clean raw'},
      {channel:'live',error:'live_incomplete',reply:null,raw_provider_text:tagged},
      ...[JSON.stringify(tagged),JSON.stringify({reply:tagged}),
        `{"reply":"\\u003cja>${left}</ja>\\u2003<vi>${right}</vi>`].map(raw_provider_text=>({
        channel:'chat',error:'invalid_chat_reply',reply:null,raw_provider_text
      }))
    ];
    for (const row of candidates) {
      assert.equal(finalizeTurnEvidence(row,input,secrets),undefined);
      assert.deepEqual(row,{channel:row.channel,error:'secret_in_output',reply:null,raw_provider_text:null});
    }
    assert.deepEqual(input.history,[]);
  }
});

test('clean raw non-thought text is retained byte-for-byte on successful and failed turns',()=>{
  const raw=' \n{"reply":"<vi>Em đã hiểu.\\t</vi>"} \n';
  const item={channel:'live',level:'N5'},input=turnInput(item,{message:'Em hiểu rồi.'},null,[]);
  const generated={candidates:[{content:{parts:[{text:'synthetic_canary_key',thought:true},{text:raw}]}}]};
  const raw_provider_text=rawGeminiText(frame('message',generated),true);
  const secrets=['synthetic_canary_key'];
  const successful={channel:'live',error:null,reply:'Tốt rồi.',raw_provider_text};
  assert.deepEqual(finalizeTurnEvidence(successful,input,secrets),nextHistory(input,successful.reply));
  assert.equal(successful.raw_provider_text,raw);
  const failed={channel:'live',error:'live_incomplete',reply:null,raw_provider_text};
  assert.equal(finalizeTurnEvidence(failed,input,secrets),undefined);
  assert.equal(failed.raw_provider_text,raw);
});

test('objective controls reject realistic failures without treating quoted Japanese greetings as a restart',()=>{
  for (const {id,row,check,expected} of controls) assert.equal(assertTurn(JSON.stringify(row),{vars:{check}}).pass,expected,id);
});

test('held-out pack uses four three-turn sequences for each channel',async()=>{
  const items=await selectCases('held-out');
  for (const channel of ['chat','live']) {
    assert.equal(items.filter(item=>item.channel===channel).length,4);
    assert.ok(items.filter(item=>item.channel===channel).every(item=>item.steps.length===3));
  }
});

test('paired replay rejects missing raw evidence, altered history and source mismatch',()=>{
  const item={channel:'live',id:'continuity',level:'N5'},steps=[{id:'one',message:'Em tên Mai.'},{id:'two',message:'Nhắc lại tên em.',interruptPrevious:true}];
  const plan={identity:{model:'gemini-3.1-flash-lite',approval_digest:'frozen'},turns:steps.map(step=>({id:`live/continuity/${step.id}`,item,step,calls:1}))};
  let history=[];
  const rows=plan.turns.map(({id,step})=>{
    const input=turnInput(item,step,null,history),reply='Em tên Mai.';
    history=nextHistory(input,reply);
    return {id,channel:'live',input,expected_calls:1,provider_calls:1,upstream_status:200,status:200,error:null,reply,
      raw_provider_text:`<vi>${reply}</vi>`,segments:[{index:0,lang:'vi',boundary:'start',text:reply}],japanese_only:input.japanese_only};
  });
  const report={...plan.identity,turns:rows,network_calls:2};
  assert.equal(verified(report,plan),rows);
  assert.equal(rows[1].input.history.at(-1).playback,'interrupted');
  for (const mutate of [r=>r.turns.pop(),r=>r.turns[1].input.history=[],r=>r.turns[0].raw_provider_text=null,
    r=>r.turns[0].provider_calls=2,r=>r.approval_digest='changed',r=>r.turns[0].error='live_incomplete']) {
    const altered=structuredClone(report);mutate(altered);assert.throws(()=>verified(altered,plan));
  }
});

test('paired replay requires ordered matching Live segments and the exact planned language mode',()=>{
  for (const japaneseOnly of [false,true]) {
    const item={channel:'live',level:'N5',japaneseOnly},step={message:'Giải thích nhé.'},id='live/metadata/one';
    const plan={identity:{approval_digest:'frozen'},turns:[{id,item,step,calls:1}]};
    const input=turnInput(item,step,null,[]);
    const segments=[{...part,text:'そうです。'},{index:1,lang:'ja',boundary:'sentence',text:'もう一度。'}];
    const reply=segments.map(segment=>segment.text).join(' ');
    const row={id,channel:'live',input,expected_calls:1,provider_calls:1,upstream_status:200,status:200,error:null,reply,
      raw_provider_text:`<ja>${reply}</ja>`,segments,japanese_only:japaneseOnly};
    const report={...plan.identity,turns:[row],network_calls:1};
    assert.equal(verified(report,plan),report.turns);
    for (const metadata of [
      {segments:undefined},{segments:[]},{segments:[...segments].reverse()},{reply:'Other text.'},
      {japanese_only:undefined},{japanese_only:Number(japaneseOnly)},{japanese_only:String(japaneseOnly)},{japanese_only:!japaneseOnly}
    ]) assert.throws(()=>verified({...report,turns:[{...row,...metadata}]},plan),/Incomplete or inconsistent recording/);
  }
});

test('recorder cannot make a provider call without the explicit opt-in arguments',()=>{
  const run=spawnSync(process.execPath,[new URL('./capture.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],{encoding:'utf8',timeout:5000});
  assert.equal(run.status,1);assert.equal(run.stdout,'');assert.match(run.stderr,/Capture stopped/);
});
