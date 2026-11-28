// Explicit opt-in only: isolated in-memory Worker, one provider request per planned turn.
import {randomBytes,randomUUID} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {casePacks,turnInput,nextHistory} from './cases.mjs';
import {validSegments} from './assert-turn.mjs';
import {planFor,fileURL,MODEL,PROVIDER,START_SPACING_MS} from './identity.mjs';

function database(db) {
  return {prepare(sql) {
    let params=[];
    return {bind(...values) {params=values;return this;},async first() {return db.prepare(sql).get(...params) ?? null;},
      async all() {return {results:db.prepare(sql).all(...params)};},async run() {db.prepare(sql).run(...params);return {success:true};}};
  },async batch(statements) {
    db.exec('BEGIN');
    try {
      const results=[];
      for (const statement of statements) results.push(await statement.run());
      db.exec('COMMIT');return results;
    } catch (error) {db.exec('ROLLBACK');throw error;}
  }};
}

export function parseLive(raw) {
  const segments=[];
  let completed;
  if (!raw.endsWith('\n\n') || Buffer.byteLength(raw)>256*1024) return {error:'invalid_stream'};
  try {
    for (const frame of raw.slice(0,-2).split('\n\n')) {
      const match=/^event: (segment|done|error)\ndata: (.+)$/.exec(frame);
      if (!match || completed) return {error:'invalid_stream'};
      const row=JSON.parse(match[2]);
      if (match[1]==='error') return {error:/^live_[a-z_]+$/.test(row?.code) ? row.code : 'stream_error'};
      if (match[1]==='done') completed=row;
      else if (row && typeof row==='object') {
        const {index,lang,boundary,text,speech_start}=row;
        segments.push({index,lang,boundary,text,...(speech_start===undefined?{}:{speech_start})});
      } else return {error:'invalid_stream'};
    }
  } catch {return {error:'invalid_stream'};}
  if (!completed || completed.count!==segments.length || !validSegments(segments,completed.full_text)
    || typeof completed.japanese_only!=='boolean') return {error:'incomplete_stream'};
  return {reply:completed.full_text,segments,japanese_only:completed.japanese_only};
}

export function rawGeminiText(raw, live) {
  const frames=live ? raw.replace(/\r\n/g,'\n').split('\n\n').filter(frame=>frame.trim()) : [raw];
  return frames.map(frame=>{
    const body=live ? frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n') : frame;
    if (!body) return '';
    const data=JSON.parse(body);
    return (data.candidates?.[0]?.content?.parts ?? []).filter(part=>typeof part.text==='string' && !part.thought).map(part=>part.text).join('');
  }).join('');
}

export function captureBody(body,slot) {
  const reader=body.getReader();
  let cancelled=false;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  return new ReadableStream({
    async pull(controller) {
      try {
        const {value,done}=await reader.read();
        // The Worker can cancel after the terminal frame while a read is pending.
        if (cancelled) return;
        if (done) {controller.close();return;}
        slot.bytes+=value.byteLength;
        if (slot.bytes>256*1024) throw new Error('Provider evidence exceeded its byte cap.');
        slot.chunks.push(value);controller.enqueue(value);
      } catch (error) {
        if (cancelled) return;
        slot.captureError=true;cancel();controller.error(error);
      }
    },cancel() {cancelled=true;cancel();}
  });
}

function secretIn(text,secrets) {
  if (typeof text!=='string') return false;
  const contains=value=>{
    const compact=value.replace(/<\/?(?:ja|vi)>|[\s\p{White_Space}]+/giu,'');
    return secrets.some(secret=>compact.includes(secret));
  };
  // Raw model text can itself contain JSON escapes, even on a failed turn.
  return contains(text) || text.includes('\\') && contains(text.replace(
    /\\(?:u[\da-fA-F]{4}|["\\/bfnrt])/gu,escape=>JSON.parse(`"${escape}"`)));
}

export function finalizeTurnEvidence(row,input,secrets) {
  // Validated Live segment texts are already represented in the joined reply.
  if ([row.reply,row.raw_provider_text,row.error].some(text=>secretIn(text,secrets))) {
    row.reply=null;row.raw_provider_text=null;delete row.segments;row.error='secret_in_output';
  }
  if (row.channel==='live' && !row.error) return nextHistory(input,row.reply);
}

function permitRejected(row) {
  return [401,402,403,429].includes(row.upstream_status) || [401,402,403,429].includes(row.status);
}

async function capture(args) {
  const [root,pack,expectedIdentity,path,approved,limitText,...extra]=args;
  if (!root || !casePacks.includes(pack) || !/^[0-9a-f]{64}$/.test(expectedIdentity ?? '') || !path
    || approved!=='--approved-live' || !/^[1-9]\d{0,2}$/.test(limitText ?? '') || extra.length || process.stdin.isTTY) {
    throw new Error(`Usage: capture.mjs <checkout> <${casePacks.join('|')}> <approval-digest> <new-output.json> --approved-live <max-requests>; pipe the approved Gemini key on stdin.`);
  }
  const plan=await planFor(root,pack),limit=Number(limitText);
  if (plan.identity.approval_digest!==expectedIdentity) throw new Error('Source, cases or recorder changed after approval.');
  if (plan.identity.expected_calls>limit) throw new Error('Planned requests exceed the approved cap.');
  let key='';
  for await (const chunk of process.stdin.setEncoding('utf8')) {
    key+=chunk;
    if (key.length>512) throw new Error('Invalid credential input.');
  }
  key=key.trim();
  if (!/^[\w.-]{12,256}$/.test(key)) throw new Error('A Gemini key is required on stdin.');
  const output=await open(path,'wx');
  const originalFetch=globalThis.fetch;
  let db,permit,networkCalls=0,previousStart=-Infinity;
  const report={...plan.identity,comparison:'whole-repair-not-prompt-only',network_calls:0,turns:plan.turns.map(({id,item,calls})=>({
    id,channel:item.channel,expected_calls:calls,provider_calls:0,upstream_status:null,status:null,error:'not_run',reply:null,raw_provider_text:null
  }))};
  const save=async()=>{
    const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
    for (let offset=0;offset<bytes.length;) {
      const {bytesWritten}=await output.write(bytes,offset,bytes.length-offset,offset);
      if (!bytesWritten) throw new Error('Could not store evaluation evidence.');
      offset+=bytesWritten;
    }
    await output.truncate(bytes.length);
  };
  try {
    await save();
    globalThis.fetch=async(input,init)=>{
      const slot=permit,url=new URL(input);
      const suffix=slot?.live ? ':streamGenerateContent?alt=sse' : ':generateContent';
      if (!slot?.remaining || networkCalls>=limit || url.origin!==PROVIDER
        || url.pathname+url.search!==`/v1beta/models/${MODEL}${suffix}` || init?.method!=='POST'
        || new Headers(init.headers).get('x-goog-api-key')!==key) {
        if (slot) slot.denied=true;
        throw new Error('Unapproved provider operation.');
      }
      slot.remaining=0;
      if (init.signal?.aborted) throw new Error('Approved turn ended.');
      previousStart=performance.now();networkCalls++;
      const response=await originalFetch(url,{...init,redirect:'error'});
      slot.status=response.status;
      if (!response.ok || !response.body) return response;
      return new Response(captureBody(response.body,slot),{status:response.status,headers:response.headers});
    };
    const [{default:worker},{hashToken}]=await Promise.all([
      import(fileURL(root,'src/worker.js')),import(fileURL(root,'src/auth.js'))
    ]);
    db=new DatabaseSync(':memory:');
    for (const file of readdirSync(resolve(root,'migrations')).filter(name=>/^\d+.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(resolve(root,'migrations',file),'utf8'));
    }
    const token=randomBytes(32).toString('hex'),account='google:tutor-reliability-eval';
    const secrets=[key,token];
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hashToken(token),account,'Tutor Eval',Date.now()+3600000);
    db.prepare('INSERT INTO profiles(user_id,level,track,updated_at) VALUES(?,?,?,?)').run(account,'N5','openjlpt','now');
    const env={DB:database(db),ASSETS:{fetch:async request=>{
      const pathname=new URL(request.url).pathname;
      if (pathname==='/course/learning-corpus.json') return new Response(plan.corpus,{headers:{'Content-Type':'application/json'}});
      const level=pathname.match(/^\/course\/teacher-(N[1-5])\.json$/)?.[1];
      return level ? Response.json(plan.catalogs[level]) : new Response(null,{status:404});
    }}};
    const api_connection={protocol:'gemini',base_url:PROVIDER,model:MODEL,api_key:key};
    let history=[],sequence,failedSequence;
    for (const [index,{item,step,task}] of plan.turns.entries()) {
      if (failedSequence===item) {report.turns[index].error='prior_turn_failed';continue;}
      // Space requests between turns, outside the provider's own response deadline.
      if (networkCalls) await delay(Math.max(0,START_SPACING_MS-(performance.now()-previousStart)));
      if (sequence!==item) {history=[];sequence=item;}
      const row=report.turns[index],chat=item.channel==='chat',input=turnInput(item,step,task,history);
      if (secretIn(JSON.stringify(input),secrets)) {row.error='secret_in_input';await save();break;}
      row.input=input;
      const body={...input,api_connection,...(chat ? {request_id:randomUUID()} : {})};
      const prior=()=>db.prepare('SELECT state_json FROM tutor_sessions WHERE user_id=? AND context_key=?').get(account,`quick:${input.screen?.route}`)?.state_json;
      const before=chat && step.check==='greeting' ? prior() : null;
      const callsBefore=networkCalls,abort=new AbortController();
      permit={live:!chat,remaining:row.expected_calls,denied:false,chunks:[],bytes:0,status:null,captureError:false};
      let response;
      try {
        response=await worker.fetch(new Request(`https://fixture.invalid/api/${chat?'chat':'live/turn'}`,{
          method:'POST',signal:AbortSignal.any([AbortSignal.timeout(35000),abort.signal]),
          headers:{Cookie:`vj_session=${token}`,'Content-Type':'application/json','X-VJBot-Account':account},body:JSON.stringify(body)
        }),env);
        row.status=response.status;
        if (!response.ok) row.error='http_error';
        else if (chat) {
          const data=await response.json();
          if (typeof data.reply!=='string' || !data.reply.trim() || data.reply!==data.response) row.error='invalid_chat_reply';
          else {
            row.reply=data.reply;row.error=null;
            if (step.check==='greeting') {
              const probe=value=>value ? JSON.parse(value).probe ?? null : null;
              row.opened_new_probe=probe(prior())!==probe(before);
            }
          }
        } else if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) row.error='invalid_stream';
        else {
          const spoken=parseLive(await response.text());
          row.error=spoken.error ?? (spoken.japanese_only!==input.japanese_only ? 'unexpected_language_mode' : null);
          if (!row.error) Object.assign(row,spoken);
        }
      } catch {row.error='invalid_response';}
      try {
        if (permit.chunks.length) row.raw_provider_text=rawGeminiText(Buffer.concat(permit.chunks).toString('utf8'),!chat);
      } catch {row.error='invalid_response';}
      if (permit.captureError || row.expected_calls && !row.raw_provider_text?.trim()) row.error ??='raw_capture_incomplete';
      abort.abort();
      if (!response?.bodyUsed) void response?.body?.cancel().catch(()=>{});
      row.provider_calls=networkCalls-callsBefore;row.upstream_status=permit.status;
      if (permit.denied || row.provider_calls!==row.expected_calls
        || row.upstream_status!==(row.expected_calls?200:null)) row.error ??='unexpected_provider_wiring';
      const recordedHistory=finalizeTurnEvidence(row,input,secrets);
      if (recordedHistory) history=recordedHistory;
      permit=null;report.network_calls=networkCalls;
      console.log(`${row.id} ${row.status ?? '-'} upstream=${row.upstream_status ?? '-'} ${row.error ?? 'RECORDED'}`);
      await save();
      if (row.error) {
        // Never retry a failed turn, fabricate its history, or proceed after an auth, quota, or safety failure.
        if (permitRejected(row) || row.error==='secret_in_output' || row.error==='unexpected_provider_wiring') break;
        failedSequence=item;
      }
    }
    await save();
  } finally {globalThis.fetch=originalFetch;db?.close();await output.close();}
  if (report.turns.some(row=>row.error)) process.exitCode=1;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {await capture(process.argv.slice(2));}
  catch {console.error('Capture stopped. Check the retained report, arguments and explicit approval; no automatic retry was made.');process.exitCode=1;}
}
