import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {planFor} from './identity.mjs';
import {casePacks,turnInput,nextHistory} from './cases.mjs';
import {validSegments} from './assert-turn.mjs';

export const controls=[
  {id:'valid-greeting',check:'greeting',expected:true,row:{channel:'chat',status:200,reply:'Chào em!'}},
  {id:'unexpected-drill',check:'greeting',expected:false,row:{channel:'chat',status:200,reply:'Chào em! Em thử điền: わたしは＿＿＿です。'}},
  {id:'missing-greeting',check:'greeting',expected:false,row:{channel:'chat',status:200,reply:'Hôm nay trời đẹp.'}},
  {id:'double-greeting',check:'greeting',expected:false,row:{channel:'chat',status:200,reply:'Chào em! Chào mừng em tới buổi học.'}},
  {id:'unexpected-welcome',check:'no-welcome',expected:false,row:{channel:'chat',status:200,reply:'Chào em, thầy rất vui! Em dùng mẫu câu này khi nào?'}},
  {id:'named-greeting',check:'no-welcome',expected:false,row:{channel:'chat',status:200,reply:'Chào An-san. Em sẽ đến lúc mấy giờ?'}},
  {id:'unexpected-japanese-welcome',check:'no-welcome',expected:false,row:{channel:'live',status:200,reply:'こんばんは！',segments:[{index:0,lang:'ja',boundary:'start',text:'こんばんは！'}]}},
  {id:'quoted-greeting',check:'no-welcome',expected:true,row:{channel:'chat',status:200,reply:'Cụm 「こんにちは」 là lời chào ban ngày.'}},
  {id:'vietnamese-only-live',check:'vietnamese-only',expected:true,row:{channel:'live',status:200,reply:'Ai nói cũng đã rõ.',segments:[{index:0,lang:'vi',boundary:'start',text:'Ai nói cũng đã rõ.'}]}},
  {id:'wrong-language',check:'vietnamese-only',expected:false,row:{channel:'chat',status:200,reply:'Nghĩa là chưa đến. まだです。'}},
  {id:'broken-live-order',expected:false,row:{channel:'live',status:200,reply:'Em thử lại nhé.',segments:[{index:1,lang:'vi',boundary:'start',text:'Em thử lại nhé.'}]}},
  {id:'disclosed-answer',check:'withhold-topic-particle',expected:false,row:{channel:'chat',status:200,reply:'Điền 「は」 nhé.'}},
  {id:'failed-transport',expected:false,row:{channel:'live',status:200,error:'live_incomplete',reply:'Một phần câu.'}}
];

export function verified(report,plan) {
  if (!report || !Object.entries(plan.identity).every(([key,value])=>report[key]===value)
    || !Array.isArray(report.turns) || report.turns.length!==plan.turns.length) throw new Error('Recording identity or coverage does not match the checkout and plan.');
  let calls=0,history=[],sequence;
  for (const [index,{id,item,step,task,calls:expectedCalls}] of plan.turns.entries()) {
    if (sequence!==item) {history=[];sequence=item;}
    const row=report.turns[index],input=turnInput(item,step,task,history);
    if (row?.id!==id || row.channel!==item.channel || row.expected_calls!==expectedCalls || row.provider_calls!==expectedCalls
      || row.upstream_status!==(expectedCalls?200:null) || row.status!==200 || row.error || !row.reply?.trim()
      || (expectedCalls ? !row.raw_provider_text?.trim() : row.raw_provider_text!==null)
      || item.channel==='live' && (!validSegments(row.segments,row.reply) || row.japanese_only!==input.japanese_only)
      || JSON.stringify(row.input)!==JSON.stringify(input)) throw new Error(`Incomplete or inconsistent recording: ${id}. Inspect retained evidence.`);
    if (item.channel==='live') history=nextHistory(input,row.reply);
    calls+=expectedCalls;
  }
  if (report.network_calls!==calls) throw new Error('Recording request count does not match the plan.');
  return report.turns;
}

export default async function testCases() {
  const base=process.env.VJBOT_TUTOR_EVAL_BASELINE,next=process.env.VJBOT_TUTOR_EVAL_RECORDING;
  if (!base && !next) return controls.map(({id,check,expected,row})=>({
    description:id,vars:{candidate:JSON.stringify(row),check:check ?? ''},metadata:{expected}
  }));
  const dirs=[process.env.VJBOT_TUTOR_EVAL_BASELINE_DIR,process.env.VJBOT_TUTOR_EVAL_CANDIDATE_DIR];
  if (!base || !next || !dirs.every(Boolean)) throw new Error('Replay requires both recordings and matching checkouts.');
  const reports=await Promise.all([base,next].map(async file=>JSON.parse(await readFile(file,'utf8'))));
  const [a,b]=reports;
  if (!casePacks.includes(a?.pack) || a.approval_digest===b?.approval_digest
    || !['pack','protocol','model','provider','case_digest','ground_digest','recorder_digest','node','spacing_ms'].every(key=>a[key]===b?.[key])) {
    throw new Error('Recordings do not share the same model, cases, grounding and recorder.');
  }
  const plans=await Promise.all(dirs.map(root=>planFor(root,a.pack)));
  return reports.flatMap((report,index)=>verified(report,plans[index]).map((row,turn)=>{
    const {item,step}=plans[index].turns[turn];
    const variant=index?'candidate':'baseline';
    return {description:`${variant}:${row.id}`,vars:{candidate:JSON.stringify(row),check:step.check ?? ''},metadata:{
      variant,case_id:row.id,prompt_digest:report.prompt_digest,transport_digest:report.transport_digest,
      comparison:'whole-repair-not-prompt-only',model:report.model,pack:report.pack,
      rubric:[...(item.rubric ?? []),step.rubric]
    }};
  }));
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const result=JSON.parse(await readFile(process.argv[2],'utf8')).results;
  const verdicts=new Map(result.results.map(row=>[row.testCase.description,row.success]));
  if (result.stats.errors!==0 || result.results.length!==controls.length || verdicts.size!==controls.length
    || !controls.every(row=>verdicts.get(row.id)===row.expected)) throw new Error('At least one offline control did not match its expected verdict.');
  console.log(`All ${controls.length} offline controls matched their expected verdicts.`);
}
