import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function transcript(reply){
  const node=()=>({children:[],dataset:{},attributes:{},textContent:'',events:{},scrollTop:0,scrollHeight:400,clientHeight:400,
    append(...nodes){for(const n of nodes){this.children.push(n);n.parentNode=this;}},
    insertBefore(n,next){const at=this.children.indexOf(next);if(at<0)this.children.push(n);else this.children.splice(at,0,n);n.parentNode=this;},
    replaceChildren(){this.children=[];},remove(){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);},
    setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.events[k]=v;}});
  const host=node(),timers=new Map(),requests=[];let now=100000,sequence=0;
  const context=vm.createContext({document:{createElement:node},AbortController,Date:{now:()=>now},
    signedInUser:{user_id:'email:admin',is_admin:true},
    setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id),
    apiFetch:async(path,options)=>{const body=JSON.parse(options.body);requests.push({path,body,signal:options.signal,at:now});return reply?reply(body):Response.json({translations:body.segments.map(s=>({id:s.id,text_vi:'Dịch: '+s.text}))});}});
  context.window=context;vm.runInContext(readFileSync('static/live-transcript.js','utf8'),context);
  const api=context.createLiveTranscript(host);api.reset();
  return {api,host,context,requests,timers,add(role,text,start,end=start+500,id){api.add({type:role==='user'?'session.input_transcript.delta':'session.output_transcript.delta',delta:text,start_ms:start,end_ms:end,event_id:id});},
    async flush(){const [id,item]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0] || [];if(!item)return;timers.delete(id);now=item.at;item.fn();await new Promise(resolve=>setImmediate(resolve));}};
}
const text=row=>row.children[1].textContent;
const vi=row=>row.children[2].textContent;
const stamp=row=>row.children[0].children[1].textContent;

test('groups by speaker and session timestamps, preserving exact fragments, repeats and overlap',async()=>{
  const b=transcript();
  b.add('assistant','はい',3000,3500,'a');b.add('user','学生',1000,2000,'u');b.add('user','です。',2000,2300,'u2');
  b.add('assistant','、はい。',3500,4000,'b');b.add('assistant','、はい。',3500,4000,'b');
  b.add('user','東京です',5000,6100,'u3');
  assert.deepEqual(b.host.children.map(text),['学生です。','はい、はい。','東京です']);
  assert.deepEqual(b.host.children.map(stamp),['00:01 – 00:02','00:03 – 00:04','00:05 – 00:06']);
  await b.flush();assert.equal(b.requests[0].path,'/api/live/translate');
  assert.deepEqual(b.host.children.map(vi),['Dịch: 学生です。','Dịch: はい、はい。','Dịch: 東京です']);
  assert.equal(b.host.children[0].children[2].lang,'vi');
});

test('rejects malformed events and keeps untrusted text as plain text',async()=>{
  const b=transcript();
  for(const patch of [{start_ms:-1},{end_ms:0},{start_ms:NaN},{end_ms:660001},{delta:7},{delta:''},{type:'other'}])b.api.add({type:'session.input_transcript.delta',delta:'test',start_ms:1,end_ms:2,...patch});
  assert.equal(b.host.children.length,0);
  b.add('user','<img src=x onerror=alert(1)>',0);await b.flush();
  assert.equal(text(b.host.children[0]),'<img src=x onerror=alert(1)>');assert.equal(b.host.children[0].children[1].children.length,0);
});

test('splits sentences and long continuous speech so completed phrases can translate early',async()=>{
  const b=transcript();
  b.add('assistant','こんにちは。',1000,2000);b.add('assistant','「私は学生です。」',2100,4000);b.add('assistant','もう一度',4100,5000);
  b.add('assistant','お願いします',13000,14000);
  assert.deepEqual(b.host.children.map(text),['こんにちは。','「私は学生です。」','もう一度','お願いします']);
  await b.flush();assert.equal(b.requests[0].body.segments.length,4);
  const whitespace=transcript();whitespace.add('user',' ',0);await whitespace.flush();assert.equal(whitespace.requests.length,0);
  whitespace.add('user','はい',500);await whitespace.flush();assert.equal(whitespace.requests[0].body.segments[0].text,' はい');
});

test('late translations cannot replace a changed caption and requests are batched and spaced',async()=>{
  let release;const b=transcript(()=>new Promise(resolve=>{release=resolve;}));
  b.add('user','私',0);await b.flush();b.add('user','は学生です。',500,900);
  release(Response.json({translations:[{id:'caption_0',text_vi:'Tôi'}]}));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(vi(b.host.children[0]),'Đang dịch…');await b.flush();
  assert.equal(b.requests[1].body.segments[0].text,'私は学生です。');assert.ok(b.requests[1].at-b.requests[0].at>=4000);
  b.api.stop();
});

test('translation failure retains original captions and offers an explicit retry without a request loop',async()=>{
  let failed=true;const b=transcript(body=>failed?Response.json({detail:'quota'},{status:429}):Response.json({translations:body.segments.map(s=>({id:s.id,text_vi:'Tôi là học sinh.'}))}));
  b.add('user','学生です。',1000);await b.flush();const row=b.host.children[0];
  assert.equal(text(row),'学生です。');assert.equal(row.children[3].hidden,false);assert.equal(b.timers.size,0);
  failed=false;row.children[3].events.click();await b.flush();assert.equal(vi(row),'Tôi là học sinh.');assert.equal(row.children[3].hidden,true);
});

test('a closed voice session finishes translations while navigation and new accounts discard late results',async()=>{
  let release;const b=transcript(()=>new Promise(resolve=>{release=resolve;}));
  b.add('assistant','こんにちは',0);b.api.finish();await b.flush();
  release(Response.json({translations:[{id:'caption_0',text_vi:'Xin chào'}]}));await new Promise(resolve=>setImmediate(resolve));assert.equal(vi(b.host.children[0]),'Xin chào');
  b.api.reset();b.add('user','はい',0);await b.flush();b.api.stop();assert.equal(b.requests.at(-1).signal.aborted,true);
  release(Response.json({translations:[{id:'caption_0',text_vi:'Không được hiện'}]}));await new Promise(resolve=>setImmediate(resolve));assert.notEqual(vi(b.host.children[0]),'Không được hiện');
  b.context.signedInUser={user_id:'email:other',is_admin:true};b.api.accountChanged();assert.equal(b.host.children.length,0);
  b.add('user','stale',2000);assert.equal(b.host.children.length,0);
});

test('deliberate translation cancellation is distinct from failure, preserves captions and retries only on request',async()=>{
  const failed=transcript(()=>Response.json({detail:'quota'},{status:429}));
  failed.add('user','はい。',0);await failed.flush();const failureMessage=vi(failed.host.children[0]);
  failed.api.stop();assert.equal(vi(failed.host.children[0]),failureMessage);
  let release;const b=transcript(body=>new Promise(resolve=>{release=()=>resolve(Response.json({translations:body.segments.map(s=>({id:s.id,text_vi:'late'}))}));}));
  b.add('user','はい。',0);await b.flush();b.api.stop();const row=b.host.children[0];
  assert.equal(b.requests[0].signal.aborted,true);assert.equal(text(row),'はい。');
  assert.ok(vi(row).trim());assert.notEqual(vi(row),failureMessage);assert.equal(row.children[3].hidden,false);
  assert.equal(b.timers.size,0);assert.equal(b.requests.length,1);
  release();await new Promise(resolve=>setImmediate(resolve));assert.notEqual(vi(row),'late');
  row.children[3].events.click();await b.flush();assert.equal(b.requests.length,2);
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(vi(row),'late');
});

test('long conversations retain bounded rows with unique identifiers and split at the input limit',async()=>{
  const b=transcript();for(let i=0;i<305;i++)b.add('user','あ'.repeat(700),i*2000,i*2000+500,'id'+i);
  assert.equal(b.host.children.length,300);await b.flush();
  const batch=b.requests[0].body.segments;assert.ok(batch.length<=8);assert.ok(batch.reduce((n,s)=>n+s.text.length,0)<=6000);
  assert.equal(new Set(batch.map(s=>s.id)).size,batch.length);b.api.stop();
});
