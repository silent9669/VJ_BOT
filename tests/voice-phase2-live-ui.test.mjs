import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {voiceTts} from '../src/voice/tts-route.js';

const source=name=>readFileSync(new URL(`../static/voice/${name}.js`,import.meta.url),'utf8');
const scripts=['voice-player','live-cascaded'].map(source);
const reference={level:'N5',lesson:{id:'grammar:1',level:'N5'},focus:{kind:'question',index:0},view:'checks',task:{id:'task-id',revision:'revision'}};
const routeSingle={version:2,mode:'single',primary:{speed:1}};
const sttRoute={version:2,provider:'elevenlabs',profile:{scope:'server',id:'stt-test'}};
const segments=[{lang:'ja',boundary:'start',text:'こんにちは。'},{lang:'vi',boundary:'sentence',text:'Chào em.'},
  {lang:'ja',boundary:'inline',text:'どうぞ。'}];
const sse=(event,data)=>`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const segment=(index,indexed=segments[index])=>sse('segment',{index,...indexed});
const done=(items=segments)=>sse('done',{full_text:items.map(row=>row.text).join(' '),count:items.length,japanese_only:false});
const turnResponse=(stream=segments.map((_,i)=>segment(i)).join('')+done())=>new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
const historyReply=(text,playback='completed',generation='complete')=>({role:'assistant',text,generation,playback});
function audioResponse(...langs) {
  const rows=langs.map((lang,index)=>({type:'segment',index,lang,boundary:index?'inline':'start',speed:1,audioBase64:'SUQzBA==',mimeType:'audio/mpeg'}));
  return new Response([...rows,{type:'done',count:rows.length}].map(row=>JSON.stringify(row)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson'}});
}
const deferred=()=>Promise.withResolvers();
const cycle=()=>new Promise(resolve=>setImmediate(resolve));
function pushStream(type) {
  let controller, cancelled=false;
  const encoder=new TextEncoder();
  const response=new Response(new ReadableStream({start(value){controller=value;},cancel(){cancelled=true;}}),{headers:{'Content-Type':type}});
  return {response,write:text=>controller.enqueue(encoder.encode(text)),close:()=>controller.close(),get cancelled(){return cancelled;}};
}

function fixture({live={},fetch,route,recognition=true,recordedRecognition=false,userAgent,playback,worklet=false,chatBinding}={}) {
  let now=0,id=0,valid=true,rms=0;
  const timers=new Map(),calls=[],states=[],captions=[],errors=[],clips=[],audio=[],recorders=[],recognizers=[],nodes=[],modules=[],sttSignals=[];
  const decoded=[], bufferedSources=[], track={stop(){this.stopped=true;}};
  const schedule=(fn,delay,interval)=>{const key=++id;timers.set(key,{fn,at:now+delay,interval});return key;};
  const clear=key=>timers.delete(key);
  function advance(ms) {
    const end=now+ms;
    for (;;) {
      const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if (!next) break;
      const [key,timer]=next;now=timer.at;
      if (timer.interval) timer.at+=timer.interval;else timers.delete(key);
      timer.fn();
    }
    now=end;
  }
  function node() {
    const result={connected:false,disconnected:false,connect(destination){this.connected=true;return destination;},disconnect(){this.disconnected=true;}};
    nodes.push(result);return result;
  }
  class Recorder {
    static isTypeSupported(type){return type.startsWith('audio/webm');}
    constructor(_stream,options){this.mimeType=options.mimeType;this.state='inactive';recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.state='inactive';this.onstop?.();}
    data(size){this.ondataavailable?.({data:new Blob([new Uint8Array(size)],{type:this.mimeType})});}
  }
  class Recognizer {
    constructor(){recognizers.push(this);}
    start(track){this.active=true;this.track=track;}
    stop(){this.active=false;this.onend?.();}
    abort(){this.active=false;this.aborted=true;}
    result(transcript){this.onresult?.({results:[Object.assign([{transcript}],{isFinal:true})]});}
  }
  if (recordedRecognition) Recognizer.available=()=>assert.fail('Capability detection must not contact the speech service');
  const audioContext={destination:{},createMediaStreamSource:node,createGain:()=>Object.assign(node(),{gain:{value:1}}),
    createAnalyser:()=>Object.assign(node(),{getFloatTimeDomainData(buffer){buffer.fill(rms);}}),
    createMediaStreamDestination:()=>Object.assign(node(),{stream:{getAudioTracks:()=>[track]}}),
    createBufferSource(){const result=Object.assign(node(),{start(){this.started=true;},stop(){this.stopped=true;}});bufferedSources.push(result);return result;},
    async decodeAudioData(bytes){decoded.push(bytes.byteLength);return {duration:1};},
    ...(worklet?{audioWorklet:{async addModule(path){modules.push(path);}}}:{})};
  const window={addEventListener(){},MediaRecorder:Recorder,SpeechRecognition:recognition?Recognizer:undefined,
    AudioWorkletNode:class {constructor(){return Object.assign(node(),{port:{onmessage:null}});}},
    VJVoiceStitcher:{create(options){
      assert.equal(options.audioContext,audioContext);
      assert.equal(options.sink,sink);
      const wait=playback ? deferred() : null;
      const result={async append(clip){assert(!result.stopped,'late append entered stopped audio');clips.push(clip);},
        finish:()=>wait?.promise,stop(){result.stopped=true;wait?.resolve();},finishPlayback:()=>wait?.resolve()};
      audio.push(result);return result;
    }}};
  const sink={},mic={};
  const sandbox=vm.createContext({window,AbortController,AbortSignal,TextDecoder,TextEncoder,Blob,btoa,navigator:{userAgent},performance:{now:()=>now},
    setTimeout:schedule,clearTimeout:clear,setInterval:(fn,delay)=>schedule(fn,delay,delay),clearInterval:clear,
    apiFetch(path,options){
      const call={path,body:JSON.parse(options.body),options};calls.push(call);
      const result=fetch?.(call,calls);
      if (result!==undefined) return Promise.resolve(result);
      if (path==='/api/live/turn') return Promise.resolve(turnResponse());
      if (path==='/api/tts') return Promise.resolve(audioResponse(...Array.from(call.body.text.matchAll(/<(ja|vi)>/g),hit=>hit[1])));
      if (path==='/api/stt') return Promise.resolve(Response.json(call.body.action ? {supported:true,provider:'openai'} : {text:'猫です。'}));
      throw new Error(`Unexpected request: ${path}`);
    }});
  for (const script of scripts) vm.runInContext(script,sandbox);
  const engine=window.VJLiveCascaded.create({audioContext,microphone:mic,sink,live:{stt_source:'browser',stt_language:'ja',turn_mode:'ptt',barge_in:true,...live},
    route:route || (async()=>routeSingle),stt:async signal=>{sttSignals.push(signal);return sttRoute;},context:async()=>reference,chatBinding,
    current:()=>valid,onState:state=>states.push(state),onCaption:caption=>captions.push(caption),onError:(message,fatal=false)=>errors.push({message,fatal})});
  return {engine,calls,states,captions,errors,clips,audio,recorders,recognizers,nodes,modules,sttSignals,timers,advance,decoded,bufferedSources,track,
    level:value=>{rms=value;},invalidate:()=>{valid=false;}};
}

test('streams Batch 0 before completion, fetches both batches independently, and appends ordered audio with a cross-batch pause',async()=>{
  const sseStream=pushStream('text/event-stream'), first=deferred(), rest=deferred(), prepared=deferred();
  const f=fixture({route:()=>prepared.promise,fetch(call){
    if (call.path==='/api/live/turn') return sseStream.response;
    if (call.path==='/api/tts') return call.body.text.includes('Chào') ? rest.promise : first.promise;
  }});
  const opening=f.engine.start();await cycle();
  const initial=segment(0);
  sseStream.write(initial.slice(0,17));sseStream.write(initial.slice(17));await cycle();
  prepared.resolve(routeSingle);await cycle();
  assert.deepEqual(f.calls.map(call=>call.path),['/api/live/turn','/api/tts']);
  assert.equal(f.captions[0].text,'こんにちは。');
  for (let i=1;i<segments.length;i++) sseStream.write(segment(i));
  sseStream.write(done());sseStream.close();await cycle();
  const batches=f.calls.slice(1);
  assert.equal(batches.length,2);
  assert.deepEqual(batches.map(call=>call.body.text),['<ja>こんにちは。</ja>','<vi>Chào em.</vi> <ja>どうぞ。</ja>']);
  for (const {body,options} of batches) {
    assert.deepEqual(body.task,reference.task);assert.deepEqual(body.focus,reference.focus);
    assert.equal(body.view,'checks');assert.equal(options.voiceRouting,true);
  }
  rest.resolve(audioResponse('vi','ja'));await cycle();
  assert.equal(f.clips.length,0);
  first.resolve(audioResponse('ja'));await opening;
  assert.deepEqual(f.clips.map(({lang,boundary})=>[lang,boundary]),[['ja','start'],['vi','sentence'],['ja','inline']]);
  assert.deepEqual(f.states.map(state=>state.phase),['connecting','thinking','speaking','listening']);
  assert.equal(f.captions[0].key,f.captions.at(-1).key);
  assert.deepEqual(Object.keys(f.captions[0]).sort(),['end_ms','key','role','start_ms','text']);
  assert.equal(f.errors.length,0);f.engine.stop();assert.equal(f.timers.size,0);
});

const elevenRoute={...routeSingle,primary:{provider:'elevenlabs',speed:1}};

test('ElevenLabs starts the first clip early, then waits for its stream before requesting more',async()=>{
  const first=pushStream('application/x-ndjson');
  const f=fixture({route:async()=>elevenRoute,fetch(call,calls){
    if (call.path==='/api/tts' && calls.length===2) return first.response;
  }});
  const opening=f.engine.start();await cycle();
  assert.equal(f.captions.at(-1).text,segments.map(part=>part.text).join(' '));
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/tts').map(call=>call.body.text),['<ja>こんにちは。</ja>']);
  const [clip,end]=(await audioResponse('ja').text()).trim().split('\n');
  first.write(clip+'\n');await cycle();
  assert.equal(f.clips.length,1);
  assert.equal(f.calls.length,2);
  first.write(end+'\n');first.close();await opening;
  const batches=f.calls.filter(call=>call.path==='/api/tts');
  assert.deepEqual(batches.map(({body})=>[body.text,body.serial]),[
    ['<ja>こんにちは。</ja>',true],['<vi>Chào em.</vi> <ja>どうぞ。</ja>',true]]);
  assert.deepEqual(f.clips.map(({lang})=>lang),['ja','vi','ja']);
  assert.deepEqual(f.errors,[]);
  f.engine.stop();
});

test('an early audio limit does not abort the text stream or lose the completed reply',async()=>{
  const stream=pushStream('text/event-stream');
  const error='ElevenLabs đang xử lý quá nhiều yêu cầu đọc cùng lúc.';
  const f=fixture({route:async()=>elevenRoute,fetch(call,calls){
    if (call.path==='/api/live/turn' && call.body.command==='start') return stream.response;
    if (call.path==='/api/tts' && calls.length===2)
      return new Response(JSON.stringify({type:'error',index:0,code:'tts_concurrency',detail:error})+'\n',
        {headers:{'Content-Type':'application/x-ndjson'}});
  }});
  const opening=f.engine.start();await cycle();
  stream.write(segment(0));await cycle();
  assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].options.signal.aborted,false);
  stream.write(segment(1)+segment(2)+done());stream.close();await opening;
  const text=segments.map(part=>part.text).join(' ');
  assert.equal(f.captions.at(-1).text,text);
  assert.deepEqual(f.errors,[{message:`${error} Câu trả lời vẫn có trong bản chép lời.`,fatal:false}]);
  assert.equal(f.states.at(-1).phase,'listening');
  assert.equal(f.calls.length,2,'do not retry or synthesize the rest of the failed turn');
  await f.engine.sendCommand('repeat');
  assert.equal(f.calls.length,2);
  assert.equal(f.clips.length,0);
  await f.engine.sendCommand('hint');
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body.history,[historyReply(text,'failed')]);
  f.engine.stop();
});

test('other providers can prefetch while an ElevenLabs clip remains pending',async()=>{
  const first=deferred(), parts=segments.slice(0,2);
  const route={version:2,mode:'dual_split_api',primary:{provider:'openai'},ja:{provider:'elevenlabs'},vi:{provider:'openai'}};
  const f=fixture({route:async()=>route,fetch(call){
    if (call.path==='/api/live/turn') return turnResponse(segment(0)+segment(1)+done(parts));
    if (call.path==='/api/tts' && call.body.text.includes('こんにちは')) return first.promise;
  }});
  const opening=f.engine.start();await cycle();
  const batches=f.calls.filter(call=>call.path==='/api/tts');
  assert.deepEqual(batches.map(({body})=>[body.text,body.serial]),[['<ja>こんにちは。</ja>',true],['<vi>Chào em.</vi>',undefined]]);
  assert.equal(f.clips.length,0);
  first.resolve(audioResponse('ja'));await opening;
  assert.deepEqual(f.clips.map(({lang})=>lang),['ja','vi']);
  f.engine.stop();
});

test('an audio playback timeout stops audio but leaves the valid text in session context',async()=>{
  const f=fixture({route:async()=>elevenRoute,playback:true});
  const opening=f.engine.start();await cycle();
  assert.equal(f.states.at(-1).phase,'speaking');
  f.advance(90000);await opening;
  assert.equal(f.states.at(-1).phase,'listening');
  assert.equal(f.audio[0].stopped,true);
  assert.match(f.errors.at(-1).message,/Âm thanh tải hoặc phát quá lâu.*bản chép lời/);
  const followUp=f.engine.sendCommand('hint');await cycle();
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body.history,
    [historyReply(segments.map(part=>part.text).join(' '),'failed')]);
  f.audio.at(-1).finishPlayback();await followUp;
  f.engine.stop();
});

test('single Mistral waits for the first sentence and splits the TTS payload without changing captions',async()=>{
  const stream=pushStream('text/event-stream'), prepared=deferred(), audio=deferred();
  const parts=[{lang:'ja',boundary:'start',text:'まず「元気？」と聞くのは'},
    {lang:'vi',boundary:'inline',text:'là 3.5 điểm.” Còn nữa'}, {lang:'ja',boundary:'inline',text:'犬もいます。'}];
  const f=fixture({route:()=>prepared.promise,fetch(call){
    if(call.path==='/api/live/turn')return stream.response;
    if(call.body.text.includes('元気'))return audio.promise;
  }});
  const opening=f.engine.start();await cycle();
  stream.write(segment(0,parts[0]));await cycle();
  prepared.resolve({...routeSingle,primary:{...routeSingle.primary,provider:'mistral'}});await cycle();
  assert.equal(f.calls.length,1);
  assert.equal(f.captions.at(-1).text,parts[0].text);
  stream.write(segment(1,parts[1]));await cycle();
  assert.deepEqual(f.calls.slice(1).map(call=>call.body.text),['<ja>まず「元気？」と聞くのは</ja> <vi>là 3.5 điểm.”</vi>']);
  stream.write(segment(2,parts[2])+done(parts));stream.close();await cycle();
  assert.deepEqual(f.calls.slice(1).map(call=>call.body.text),['<ja>まず「元気？」と聞くのは</ja> <vi>là 3.5 điểm.”</vi>','<vi>Còn nữa</vi> <ja>犬もいます。</ja>']);
  assert.equal(f.captions.at(-1).text,parts.map(part=>part.text).join(' '));
  assert.equal(f.clips.length,0,'continuation must not overtake the first sentence');
  audio.resolve(audioResponse('ja','vi'));await opening;
  assert.deepEqual(f.clips.map(({lang,boundary})=>[lang,boundary]),[['ja','start'],['vi','inline'],['vi','sentence'],['ja','inline']]);
  assert.equal(f.errors.length,0);f.engine.stop();
});

test('single Mistral does not batch an opening hesitation as a sentence',async()=>{
  for(const openingMark of ['…','...']){
    const stream=pushStream('text/event-stream');
    const parts=[{lang:'ja',boundary:'start',text:`${openingMark} もう一度`},
      {lang:'vi',boundary:'inline',text:'em thử nói lại nhé.'}];
    const f=fixture({route:async()=>({...routeSingle,primary:{provider:'mistral',speed:1}}),fetch(call){
      if(call.path==='/api/live/turn')return stream.response;
      if(call.path==='/api/tts')return audioResponse('ja');
    }});
    const spoken=()=>f.calls.filter(call=>call.path==='/api/tts').map(call=>call.body.text);
    const opening=f.engine.start();await cycle();
    stream.write(segment(0,parts[0]));await cycle();
    const early=spoken();
    stream.write(segment(1,parts[1]));await cycle();
    const first=spoken();
    stream.write(done(parts));stream.close();
    try {
      await opening;
      assert.deepEqual(early,[]);
      assert.deepEqual(first,[`<ja>${parts[0].text}</ja> <vi>${parts[1].text}</vi>`]);
      assert.deepEqual(spoken(),first);
      assert.equal(f.captions.at(-1).text,parts.map(part=>part.text).join(' '));
      assert.equal(f.clips.length,1);
      assert.deepEqual(f.errors,[]);
    } finally {f.engine.stop();}
  }
});

test('single Mistral skips a nonspoken tail without losing captions or replay',async()=>{
  const parts=[{lang:'ja',boundary:'start',text:'こんにちは！😊'}];
  const f=fixture({route:async()=>({...routeSingle,primary:{provider:'mistral',speed:1}}),fetch(call){
    if(call.path==='/api/live/turn')return turnResponse(segment(0,parts[0])+done(parts));
    if(!/\p{L}/u.test(call.body.text.replace(/<\/?ja>/g,'')))return Response.json({detail:'Không có chữ để đọc.'},{status:400});
  }});
  await f.engine.start();
  const spoken=f.calls.filter(call=>call.path==='/api/tts');
  assert.deepEqual(spoken.map(call=>call.body.text),['<ja>こんにちは！</ja>']);
  assert.equal(f.captions.at(-1).text,parts[0].text);
  assert.equal(f.clips.length,1);
  await f.engine.sendCommand('repeat');
  assert.equal(f.calls.filter(call=>call.path==='/api/tts').length,1);
  assert.equal(f.clips.length,2);
  assert.deepEqual(f.errors,[]);
  f.engine.stop();
});

test('single Mistral keeps a formatted numeric tail in the next spoken sentence',async()=>{
  for(const numeric of ['3:15','10〜20%']){
    const parts=[{lang:'vi',boundary:'start',text:`Em đọc số này nhé! ${numeric}`},
      {lang:'ja',boundary:'inline',text:'です。'}];
    const f=fixture({route:async()=>({...routeSingle,primary:{provider:'mistral',speed:1}}),fetch(call){
      if(call.path==='/api/live/turn')return turnResponse(parts.map((part,i)=>segment(i,part)).join('')+done(parts));
    }});
    await f.engine.start();
    assert.deepEqual(f.calls.filter(call=>call.path==='/api/tts').map(call=>call.body.text),[
      '<vi>Em đọc số này nhé!</vi>',`<vi>${numeric}</vi> <ja>です。</ja>`
    ]);
    assert.deepEqual(f.errors,[]);
    f.engine.stop();
  }
});

test('single Mistral flushes an unterminated first sentence on done, and nothing on cancellation',async()=>{
  const parts=[{lang:'vi',boundary:'start',text:'Bài này là'}, {lang:'ja',boundary:'inline',text:'猫'}];
  for(const cancel of [false,true]){
    const stream=pushStream('text/event-stream'), routing={...routeSingle,primary:{provider:'mistral',speed:1}};
    const f=fixture({route:async()=>routing,fetch:call=>call.path==='/api/live/turn'?stream.response:undefined});
    const opening=f.engine.start();await cycle();
    stream.write(parts.map((part,i)=>segment(i,part)).join(''));await cycle();
    assert.equal(f.calls.length,1);
    if(cancel){
      f.engine.stop();await opening;
      assert(stream.cancelled);assert.equal(f.calls.length,1);assert.equal(f.clips.length,0);
    }else{
      stream.write(done(parts));await cycle();
      assert.deepEqual(f.calls.slice(1).map(call=>call.body.text),['<vi>Bài này là</vi> <ja>猫</ja>']);
      stream.close();await opening;
      assert.equal(f.calls.length,2);assert.deepEqual(f.clips.map(part=>part.lang),['vi','ja']);
      f.engine.stop();
    }
    assert.equal(f.errors.length,0);
  }
});

test('other single providers and dual Mistral speak the first part before punctuation',async()=>{
  const parts=[{lang:'ja',boundary:'start',text:'猫'}, {lang:'vi',boundary:'inline',text:'là mèo.'}];
  for(const [mode,provider] of [['single','openai'],['dual_same_api','mistral']]){
    const stream=pushStream('text/event-stream');
    const f=fixture({route:async()=>({mode,primary:{speed:1,provider},ja:{},vi:{}}),
      fetch:call=>call.path==='/api/live/turn'?stream.response:undefined});
    const opening=f.engine.start();await cycle();
    stream.write(segment(0,parts[0]));await cycle();
    assert.deepEqual(f.calls.slice(1).map(call=>call.body.text),['<ja>猫</ja>']);
    stream.write(segment(1,parts[1])+done(parts));stream.close();await opening;
    assert.deepEqual(f.calls.slice(1).map(call=>call.body.text),['<ja>猫</ja>','<vi>là mèo.</vi>']);
    assert.equal(f.errors.length,0);f.engine.stop();
  }
});

test('single Mistral retains the full continuation budget when its first part splits',async()=>{
  const parts=Array.from({length:16},(_,i)=>({
    lang:i%2?'vi':'ja',boundary:i?'inline':'start',text:i%2?`phần ${i}`:`続き ${i}`
  }));
  parts[0].text='最初です。続き 0';
  const stream=pushStream('text/event-stream'),prepared=deferred();
  const f=fixture({route:()=>prepared.promise,fetch:call=>call.path==='/api/live/turn'?stream.response:undefined});
  const opening=f.engine.start();await cycle();
  stream.write(parts.map((part,i)=>segment(i,part)).join('')+done(parts));stream.close();await cycle();
  assert.equal(f.calls.length,1);
  prepared.resolve({...routeSingle,primary:{provider:'mistral',speed:1}});await opening;
  assert.deepEqual(f.calls.slice(1).map(call=>call.body.text),[
    '<ja>最初です。</ja>',
    parts.map(({lang,text},i)=>`<${lang}>${i?text:'続き 0'}</${lang}>`).join(' ')
  ]);
  assert.deepEqual(f.clips.map(part=>part.lang),['ja',...parts.map(part=>part.lang)]);
  assert.equal(f.errors.length,0);f.engine.stop();
});

test('long summaries keep two personal requests and split managed continuation without reordering audio',async()=>{
  for (const [count,routing,sizes] of [
    [12,{...routeSingle,primary:{speed:1,profile:{scope:'server',id:'personal'}}},[1,11]],
    [16,{version:2,mode:'dual_same_api',primary:{speed:1,profile:{scope:'platform',id:'openai'}},ja:{},vi:{}},[1,8,7]]
  ]) {
    const parts=Array.from({length:count},(_,i)=>({lang:i%2?'vi':'ja',boundary:i?'inline':'start',text:i%2?'Em nghe nhé.':'聞いてください。'}));
    const first=deferred();
    const f=fixture({route:async()=>routing,fetch(call){
      if(call.body.command==='summary') return turnResponse(parts.map((part,i)=>segment(i,part)).join('')+done(parts));
      if(call.path==='/api/tts' && call.body.text==='<ja>聞いてください。</ja>') return first.promise;
    }});
    await f.engine.start();
    const before=f.clips.length, issued=f.calls.length;
    const summary=f.engine.sendCommand('summary');await cycle();
    const batches=f.calls.slice(issued).filter(call=>call.path==='/api/tts');
    assert.deepEqual(batches.map(call=>Array.from(call.body.text.matchAll(/<(ja|vi)>/g)).length),sizes);
    assert.equal(f.clips.length,before,'continuation responses cannot overtake batch zero');
    first.resolve(audioResponse('ja'));await summary;
    assert.deepEqual(f.clips.slice(before).map(clip=>clip.lang),parts.map(part=>part.lang));
    assert.equal(f.states.at(-1).phase,'listening');
    assert.equal(f.errors.length,0);
    f.engine.stop();
  }
});

test('commands carry canonical context; repeat is RAM only; slower changes Japanese but never Vietnamese speed in single mode',async()=>{
  const f=fixture();await f.engine.start();
  const openingClips=f.clips.slice(), openingCalls=f.calls.length;
  await f.engine.sendCommand('repeat');
  assert.equal(f.calls.length,openingCalls);
  assert.deepEqual(f.clips.slice(openingClips.length),openingClips);
  for (const command of ['hint','explain','situation','check','slower','summary']) await f.engine.sendCommand(command);
  const turns=f.calls.filter(call=>call.path==='/api/live/turn');
  assert.deepEqual(turns.map(call=>call.body.command),['start','hint','explain','situation','check','slower','summary']);
  assert.deepEqual(turns[1].body,{...reference,command:'hint',transcript:'',history:[historyReply('こんにちは。 Chào em. どうぞ。')],japanese_only:false});
  assert.deepEqual(f.clips.slice(-6).map(({lang,speed})=>[lang,speed]),[['ja',0.88],['vi',1],['ja',0.88],['ja',0.88],['vi',1],['ja',0.88]]);
  assert(f.calls.filter(call=>call.path==='/api/tts').every(call=>call.body.routing.primary.speed===1));
  f.engine.stop();await f.engine.sendCommand('repeat');assert.equal(f.errors.length,0);
});

test('Mistral single voice uses separated audio only when slowing Japanese',async()=>{
  const parts=[{lang:'ja',boundary:'start',text:'「猫」'},{lang:'vi',boundary:'inline',text:'nghĩa là con mèo.'}];
  const primary={provider:'mistral',profile:{scope:'server',id:'voice-test'},voice_id:'voice_clone',speed:1};
  const f=fixture({route:async()=>({...routeSingle,primary}),fetch(call){
    if(call.path==='/api/live/turn')return turnResponse(parts.map((part,i)=>segment(i,part)).join('')+done(parts));
    if(call.body.routing.mode==='single')return audioResponse('ja');
    return audioResponse('ja','vi');
  }});
  await f.engine.start();
  await f.engine.sendCommand('slower');
  const requests=f.calls.filter(call=>call.path==='/api/tts');
  assert.deepEqual(requests.map(call=>call.body.routing),[
    {version:2,mode:'single',primary},
    {version:2,mode:'dual_same_api',primary,ja:{profile:null},vi:{profile:null}}
  ]);
  assert.deepEqual(f.clips.map(({lang,speed})=>[lang,speed]),[['ja',1],['ja',0.88],['vi',1]]);
  assert.deepEqual(f.errors,[]);
  f.engine.stop();
});

test('chat and explicit voice STT route and transcribe strictly through their own paths',async()=>{
  const chatBinding={id:'pinned-chat',revision:7};
  for (const source of ['chat','voice']) {
    const explicit=source==='voice';
    const f=fixture({live:{stt_source:source},chatBinding,fetch(call){
      if (explicit && call.path==='/api/stt' && call.body.action) return Response.json({supported:true,provider:'elevenlabs'});
    }});
    await f.engine.start();assert.equal(f.states.at(-1).sttProvider,explicit?'elevenlabs':'openai');
    f.engine.toggleTalk();f.recorders[0].data(1024);f.advance(400);f.engine.toggleTalk();await cycle();
    const [probe,transcription]=f.calls.filter(call=>call.path==='/api/stt');
    assert.deepEqual(probe.body,{action:'capabilities',language:'ja',...(explicit?{stt_routing:sttRoute}:{})});
    assert.equal(probe.options.voiceRouting,explicit?true:undefined);
    assert.equal(transcription.options.voiceRouting,probe.options.voiceRouting);
    for (const {options} of [probe,transcription]) {
      assert.equal(options.chatBinding,explicit?undefined:chatBinding);
      assert.equal(options.cascadedStt,explicit?undefined:true);
    }
    assert.deepEqual(transcription.body.lesson,reference.lesson);assert.equal(transcription.body.level,'N5');
    assert.equal(transcription.body.mime_type,'audio/webm;codecs=opus');
    assert.equal(transcription.body.language,'ja');
    assert.equal(atob(transcription.body.audio).length,1024);
    assert.deepEqual(transcription.body.stt_routing,explicit?sttRoute:undefined);
    assert.equal(f.sttSignals.length,explicit?2:0);assert.equal(f.recognizers.length,0);
    const learner=f.calls.filter(call=>call.path==='/api/live/turn').at(-1);
    assert.equal(learner.body.command,null);assert.equal(learner.body.transcript,'猫です。');
    assert.equal(learner.options.chatBinding,chatBinding);
    assert(!('chatBinding' in learner.body));
    for (const {options} of f.calls.filter(call=>call.path==='/api/tts')) {
      assert(!('chatBinding' in options));
      assert(!('cascadedStt' in options));
    }
    assert.equal(f.captions.find(caption=>caption.role==='user').text,'猫です。');
    f.engine.stop();
  }
});

test('blocked STT does not switch sources, while browser PTT skips STT and muting aborts recognition',async()=>{
  for (const source of ['chat','voice']) {
    const f=fixture({live:{stt_source:source},fetch:()=>Response.json({supported:false,provider:null})});
    await f.engine.start();
    assert.equal(f.calls.length,1);assert.equal(f.errors[0].fatal,true);assert.match(f.errors[0].message,source==='chat'?/Kết nối trò chuyện/:/không dùng nguồn khác/);
    assert.equal(f.recognizers.length,0);assert.equal(f.timers.size,0);
  }
  const f=fixture();await f.engine.start();
  f.engine.toggleTalk();f.advance(400);f.recognizers[0].result('捨てる');f.engine.setMuted(true);
  assert.equal(f.recognizers[0].aborted,true);assert.equal(f.states.at(-1).muted,true);
  f.engine.toggleTalk();assert.equal(f.recognizers.length,1);
  f.engine.setMuted(false);f.engine.toggleTalk();f.advance(400);f.recognizers[1].result('猫です。');f.engine.toggleTalk();await cycle();
  assert(!f.calls.some(call=>call.path==='/api/stt'));
  assert.deepEqual(f.captions.filter(caption=>caption.role==='user').map(caption=>caption.text),['猫です。']);
  f.engine.stop();assert.equal(f.timers.size,0);
});

test('intentional short push-to-talk keeps はい for either STT while tiny recordings remain local',async()=>{
  for (const source of ['chat','browser']) {
    const f=fixture({live:{stt_source:source},fetch(call){
      if(call.path==='/api/stt' && !call.body.action) return Response.json({text:'はい'});
    }});
    await f.engine.start();f.engine.toggleTalk();f.advance(250);
    if(source==='browser') f.recognizers[0].result('はい');
    else f.recorders[0].data(1024);
    f.engine.toggleTalk();await cycle();
    const learner=f.calls.filter(call=>call.path==='/api/live/turn').at(-1);
    assert.equal(learner.body.transcript,'はい');
    assert.equal(f.calls.filter(call=>call.path==='/api/stt' && !call.body.action).length,source==='chat'?1:0);
    const count=f.calls.length;
    if(source==='chat') {
      f.engine.toggleTalk();f.recorders[1].data(511);f.advance(400);f.engine.toggleTalk();await cycle();
      assert.equal(f.calls.length,count);
    }
    f.engine.stop();
  }
});

test('automatic Browser STT drops noise and only sends the complete confirmed recording, including audio before confirmation',async()=>{
  const f=fixture({worklet:true,recordedRecognition:true,live:{turn_mode:'vad'}});await f.engine.start();
  const port=f.nodes.find(node=>node.port).port;
  const emit=(rms,count)=>{for(let i=0;i<count;i++){f.advance(30);port.onmessage({data:{rms}});}};
  emit(0,10);
  for (let i=0;i<2;i++){emit(0.06,2);f.recorders[i].data(1024);emit(0,3);}
  assert.equal(f.recognizers.length,0);
  assert.equal(f.decoded.length,0);
  emit(0.06,1);f.recorders[2].data(256);
  emit(0.06,4);
  assert.equal(f.states.at(-1).phase,'recording');
  assert.equal(f.recognizers.length,0);
  f.recorders[2].data(768);emit(0,25);await cycle();
  assert.deepEqual(f.decoded,[1024],'The first chunk before VAD confirmation is required');
  const [recognizer]=f.recognizers, [buffer]=f.bufferedSources;
  assert.equal(recognizer.track,f.track);
  assert.equal(buffer.started,undefined);
  recognizer.onaudiostart();assert.equal(buffer.started,true);
  recognizer.result('はい');buffer.onended();await cycle();
  assert.equal(f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body.transcript,'はい');
  assert(!f.calls.some(call=>call.path==='/api/stt'));
  assert.equal(f.track.stopped,true);
  f.engine.stop();assert.equal(f.timers.size,0);
});

test('desktop Chrome 137 can replace pending Browser STT with a confirmed spoken correction',async()=>{
  const f=fixture({worklet:true,userAgent:'Mozilla/5.0 (X11; Linux x86_64) Chrome/137.0.0.0 Safari/537.36',
    live:{turn_mode:'vad'}});await f.engine.start();
  assert.equal(f.states.at(-1).mode,'vad');
  const port=f.nodes.find(node=>node.port).port;
  const emit=(rms,count)=>{for(let i=0;i<count;i++){f.advance(30);port.onmessage({data:{rms}});}};
  emit(0,10);emit(0.06,5);f.recorders[0].data(1024);emit(0,25);await cycle();
  const [old]=f.recognizers;
  const lateResult=old.onresult, lateEnd=old.onend;
  emit(0.06,2);emit(0,3);assert.equal(old.aborted,undefined);
  emit(0.06,5);assert.equal(old.aborted,true);assert.equal(f.states.at(-1).phase,'recording');
  lateResult({results:[Object.assign([{transcript:'古い答え'}],{isFinal:true})]});lateEnd();
  f.recorders[2].data(1024);emit(0,25);await cycle();
  f.recognizers[1].onaudiostart();
  f.recognizers[1].result('いいえ');f.bufferedSources[1].onended();await cycle();
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/live/turn').map(call=>call.body.command||call.body.transcript),['start','いいえ']);
  f.engine.stop();assert.equal(f.timers.size,0);
});

test('microphone-only Browser STT stays on PTT without quietly switching services',async()=>{
  const f=fixture({worklet:true,live:{turn_mode:'vad'}});await f.engine.start();
  assert.equal(f.states.at(-1).mode,'ptt');
  assert.match(f.errors.at(-1).message,/Bấm để nói/);
  f.engine.setMode('vad');assert.equal(f.states.at(-1).mode,'ptt');
  assert.equal(f.recognizers.length,0);
  f.engine.toggleTalk();assert.equal(f.recognizers.length,1);
  assert.equal(f.recognizers[0].track,undefined);
  assert(!f.calls.some(call=>call.path==='/api/stt'));
  f.engine.stop();
});

test('AudioWorklet VAD captures at onset, blocks echo during teacher playback, and aborts after sustained louder speech',async()=>{
  const f=fixture({worklet:true,live:{turn_mode:'vad',stt_source:'chat'},playback:true});
  const opening=f.engine.start();await cycle();
  assert.deepEqual(f.modules,['voice/vad-worklet.js']);
  assert.equal(f.states.at(-1).phase,'speaking');
  const port=f.nodes.find(node=>node.port).port;
  const emit=(rms,count)=>{for (let i=0;i<count;i++){f.advance(30);port.onmessage({data:{rms}});}};
  emit(0.025,8);assert.equal(f.recorders.length,0);
  emit(0.042,9);emit(0,25);await cycle();
  assert.equal(f.audio[0].stopped,undefined,'a 240 ms interjection must not cut off the tutor');
  assert.equal(f.calls.filter(call=>call.path==='/api/stt').length,1);
  assert.equal(f.errors.length,0);
  emit(0.042,1);assert.equal(f.recorders[1].state,'recording');assert.equal(f.audio[0].stopped,undefined);
  emit(0.042,11);assert.equal(f.audio[0].stopped,undefined);
  emit(0.042,1);assert.equal(f.audio[0].stopped,true);assert.equal(f.states.at(-1).phase,'recording');
  f.recorders[1].data(1024);emit(0,25);await cycle();
  assert.equal(f.calls.filter(call=>call.path==='/api/stt').length,2);
  f.engine.stop();await opening;
  assert.equal(port.onmessage,null);assert(f.nodes.every(node=>node.disconnected));assert.equal(f.timers.size,0);
});

test('analyser fallback and PTT respect disabled barge-in; undersized recordings never leave the browser',async()=>{
  const f=fixture({playback:true,live:{turn_mode:'vad',stt_source:'chat',barge_in:false}});
  const opening=f.engine.start();await cycle();f.level(0.1);f.advance(300);
  assert.equal(f.recorders.length,0);
  f.engine.setMode('ptt');f.engine.toggleTalk();assert.equal(f.recorders.length,0);
  f.audio[0].finishPlayback();await opening;
  f.engine.setMode('vad');f.advance(180);assert.equal(f.recorders.length,0,'teacher tail is still gated');
  f.advance(120);assert.equal(f.recorders.length,1,'analyser may capture once the teacher tail ends');
  f.engine.setMode('ptt');assert.equal(f.recorders[0].state,'inactive');
  f.engine.toggleTalk();f.recorders[1].data(511);f.advance(400);f.engine.toggleTalk();
  assert.equal(f.calls.filter(call=>call.path==='/api/stt').length,1);
  assert.equal(f.errors.at(-1).fatal,false);
  f.engine.stop();assert.equal(f.timers.size,0);
});

test('PTT barge-in and later ownership loss cancel readers and suppress stale audio, captions and state',async()=>{
  const first=pushStream('text/event-stream'), next=pushStream('text/event-stream'), late=deferred();
  const f=fixture({fetch(call){
    if (call.path==='/api/live/turn') return call.body.command==='start'?first.response:next.response;
    if (call.path==='/api/tts') return late.promise;
  }});
  const opening=f.engine.start();await cycle();first.write(segment(0));await cycle();
  f.engine.toggleTalk();assert.equal(f.states.at(-1).phase,'recording');
  assert(f.calls[0].options.signal.aborted);assert(f.calls[1].options.signal.aborted);assert(first.cancelled);
  const tts=pushStream('application/x-ndjson');late.resolve(tts.response);await opening;await cycle();
  assert(tts.cancelled);assert.equal(f.clips.length,0);
  f.recognizers[0].result('猫です。');f.advance(400);f.engine.toggleTalk();await cycle();
  const captions=f.captions.length, states=f.states.length;
  f.invalidate();next.write(segment(0));await cycle();
  assert(next.cancelled);assert.equal(f.captions.length,captions);assert.equal(f.states.length,states);
  assert.equal(f.errors.length,0);assert(f.calls.at(-1).options.signal.aborted);assert.equal(f.timers.size,0);
});

test('rejected pre-answer and overflowing turns never enter history or replace replay, and stop reading without retry',async()=>{
  const broken=pushStream('text/event-stream');
  const f=fixture({fetch(call){
    if (call.path!=='/api/live/turn') return;
    if (call.body.command==='hint') return Response.json({detail:'Bài tập đã đổi.',code:'live_task_unavailable'},{status:409});
    if (call.body.command==='check') return broken.response;
  }});
  await f.engine.start();
  const last=f.clips.slice(), calls=f.calls.length;
  await f.engine.sendCommand('hint');
  assert.equal(f.calls.length,calls+1);assert.equal(f.errors.at(-1).message,'Bài tập đã đổi.');
  const check=f.engine.sendCommand('check');await cycle();broken.write(segment(0));await cycle();
  broken.write(sse('error',{code:'live_reply_too_long',detail:'Lượt trả lời quá dài.'}));await check;
  assert(broken.cancelled);assert.equal(f.errors.at(-1).message,'Lượt trả lời quá dài.');
  const beforeReplay=f.clips.length, requests=f.calls.length;
  await f.engine.sendCommand('repeat');assert.equal(f.calls.length,requests);
  assert.deepEqual(f.clips.slice(beforeReplay),last);
  await f.engine.sendCommand('summary');
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body.history,[historyReply('こんにちは。 Chào em. どうぞ。')]);
  f.engine.stop();
});

test('live stream timeout aborts fetch and releases resources without another request',async()=>{
  const stream=pushStream('text/event-stream');
  const f=fixture({fetch:()=>stream.response});
  const opening=f.engine.start();await cycle();f.advance(35000);await opening;
  assert.equal(f.calls.length,1);assert(f.calls[0].options.signal.aborted);assert(stream.cancelled);
  assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/quá lâu/);
  f.engine.stop();assert.equal(f.timers.size,0);
});

test('pending routing does not couple the two fetches after the live stream completes',async()=>{
  const prepared=deferred(), first=deferred();
  const f=fixture({route:()=>prepared.promise,fetch(call){
    if (call.path==='/api/tts' && call.body.text.includes('こんにちは')) return first.promise;
  }});
  const opening=f.engine.start();await cycle();
  assert.equal(f.calls.length,1);
  prepared.resolve(routeSingle);await cycle();
  assert.equal(f.calls.filter(call=>call.path==='/api/tts').length,2);
  assert.equal(f.clips.length,0);
  first.resolve(audioResponse('ja'));await opening;
  assert.deepEqual(f.clips.map(clip=>clip.lang),['ja','vi','ja']);
  f.engine.stop();
});

test('live SSE exceeds its aggregate cap even when every individual event is short',async()=>{
  const stream=pushStream('text/event-stream');
  const f=fixture({fetch:()=>stream.response});
  const opening=f.engine.start();await cycle();
  stream.write(': heartbeat\n'.repeat(22000));
  await opening;
  assert(stream.cancelled);assert.match(f.errors[0].message,/quá lớn/);
  assert.equal(f.calls.length,1);
  f.engine.stop();
});

test('the worklet reports interval RMS, not raw audio',()=>{
  const reports=[];
  let Processor;
  vm.runInNewContext(source('vad-worklet'),{sampleRate:48000,AudioWorkletProcessor:class {
    port={postMessage:row=>reports.push(row)};
  },registerProcessor(name,processor){assert.equal(name,'vjbot-vad-processor');Processor=processor;}});
  const vad=new Processor(), samples=new Float32Array(128).fill(0.25);
  for (let i=0;i<11;i++) assert.equal(vad.process([[samples]]),true);
  assert.equal(reports.length,0);
  vad.process([[samples]]);
  assert.equal(reports.length,1);
  assert.equal(reports[0].rms,0.25);
  assert.deepEqual(Object.keys(reports[0]),['rms']);
});

test('the stitcher stops a pending decode without closing or scheduling on the shared context',async()=>{
  const decoded=deferred();
  let scheduled=0, closed=0;
  const audioContext={state:'running',destination:{},decodeAudioData:()=>decoded.promise,
    createBufferSource(){scheduled++;},close(){closed++;}};
  const window={};
  vm.runInNewContext(source('audio-stitcher'),{window,AbortController,setTimeout,clearTimeout,atob,audioDataUrl:()=> 'data:audio/mpeg;base64,SUQzBA=='});
  const audio=window.VJVoiceStitcher.create({audioContext,sink:{}});
  const playback=audio.append({speed:1,boundary:'start'});
  await cycle();audio.stop();
  await assert.rejects(playback,{name:'AbortError'});
  decoded.resolve({duration:1,numberOfChannels:1});
  await cycle();
  assert.equal(scheduled,0);assert.equal(closed,0);
});

test('only completed turns update the session language preference',async()=>{
  const text=segment(0);
  const end=japanese_only=>sse('done',{full_text:segments[0].text,count:1,japanese_only});
  const f=fixture({fetch(call){
    if (call.path!=='/api/live/turn') return;
    if (call.body.command==='start') return turnResponse(text+end(true));
    if (call.body.command==='hint') return turnResponse(text+end(false)+sse('error',{detail:'Không hợp lệ.'}));
    return turnResponse(text+end(call.body.japanese_only));
  }});
  await f.engine.start();await f.engine.sendCommand('hint');await f.engine.sendCommand('summary');
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/live/turn').map(call=>call.body.japanese_only),[false,true,true]);
  assert.equal(f.errors.length,1);
  f.engine.stop();
});

test('an automatic recording capped at 30 seconds waits for quiet instead of interrupting its own STT',async()=>{
  const result=deferred();
  const f=fixture({live:{turn_mode:'vad',stt_source:'chat'},fetch(call){
    if(call.path==='/api/stt' && !call.body.action)return result.promise;
  }});
  await f.engine.start();
  f.level(0.06);f.advance(500);f.recorders[0].data(2048);
  f.advance(30000);await cycle();
  const transcription=f.calls.at(-1);
  assert.equal(transcription.path,'/api/stt');assert(!transcription.body.action);
  f.advance(800);await cycle();
  assert.equal(f.recorders.length,1);assert.equal(transcription.options.signal.aborted,false);
  f.engine.stop();result.resolve(Response.json({text:'猫です。'}));await cycle();
  assert.equal(transcription.options.signal.aborted,true);
});

test('long Japanese history keeps the newest completed replies inside the byte budget',async()=>{
  const words=['甲','乙','丙','丁','戊','己'];
  const long=[{lang:'ja',boundary:'start',text:'猫'.repeat(200)},
    {lang:'ja',boundary:'inline',text:'犬'.repeat(200)},{lang:'ja',boundary:'inline',text:'鳥'.repeat(200)}];
  const f=fixture({fetch(call){
    if(call.path==='/api/live/turn')return turnResponse(long.map((row,i)=>segment(i,row)).join('')+done(long));
  }});
  await f.engine.start();
  for(const [index,word] of words.entries()){
    f.engine.toggleTalk();f.advance(450);f.recognizers[index].result(word.repeat(1200));f.engine.toggleTalk();await cycle();
  }
  await f.engine.sendCommand('summary');
  const {body}=f.calls.filter(call=>call.path==='/api/live/turn').at(-1);
  assert.equal(body.command,'summary');
  assert(new TextEncoder().encode(JSON.stringify(body)).length<=18*1024);
  assert(body.history.length<12);
  assert.equal(body.history.filter(turn=>turn.role==='user').at(-1).text,'己'.repeat(600));
  assert.equal(f.errors.length,0);
  f.engine.stop();
});

test('barge-in retains learner identity and completed text while marking unfinished playback',async()=>{
  const f=fixture({playback:true});
  const opening=f.engine.start();await cycle();f.audio[0].finishPlayback();await opening;
  f.engine.toggleTalk();f.recognizers[0].result('Em tên là Mai.');f.advance(400);f.engine.toggleTalk();await cycle();
  assert.equal(f.states.at(-1).phase,'speaking');
  f.engine.toggleTalk();f.recognizers[1].result('Thầy nhớ tên em không?');f.advance(400);f.engine.toggleTalk();await cycle();
  const last=f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body;
  assert.equal(last.transcript,'Thầy nhớ tên em không?');
  assert.deepEqual(last.history.slice(-2),[
    {role:'user',text:'Em tên là Mai.'},historyReply(segments.map(part=>part.text).join(' '),'interrupted')
  ]);
  assert.equal(last.history.filter(row=>row.text===last.transcript).length,0);
  f.engine.stop();
});

test('generation interruption keeps visible partial text separate from a complete reply',async()=>{
  const stream=pushStream('text/event-stream');
  const f=fixture({fetch:call=>call.path==='/api/live/turn' && call.body.command==='start'?stream.response:undefined});
  const opening=f.engine.start();await cycle();stream.write(segment(0));await cycle();
  f.engine.toggleTalk();f.recognizers[0].result('Em chưa nghe hết.');f.advance(400);f.engine.toggleTalk();await cycle();
  await opening;
  const last=f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body;
  assert.deepEqual(last.history,[historyReply(segments[0].text,'interrupted','partial')]);
  assert.equal(stream.cancelled,true);
  f.engine.stop();
});

test('generation failure retains the learner turn but not unvalidated assistant output',async()=>{
  const f=fixture({fetch:call=>call.path==='/api/live/turn' && call.body.transcript
    ?turnResponse(segment(0)+sse('error',{code:'live_incomplete',detail:'Lượt trả lời bị ngắt.'})):undefined});
  await f.engine.start();
  f.engine.toggleTalk();f.recognizers[0].result('Em tên là Mai.');f.advance(400);f.engine.toggleTalk();await cycle();
  await f.engine.sendCommand('hint');
  const last=f.calls.filter(call=>call.path==='/api/live/turn').at(-1).body;
  assert.deepEqual(last.history,[historyReply(segments.map(part=>part.text).join(' ')),{role:'user',text:'Em tên là Mai.'}]);
  assert.match(f.errors[0].message,/bị ngắt/);assert.equal(f.states.at(-1).phase,'listening');
  f.engine.stop();
});

test('browser STT requires an explicit language and does not silently force Japanese',async()=>{
  const auto=fixture({live:{stt_language:'auto'}});
  await auto.engine.start();
  assert.equal(auto.calls.length,0);assert.equal(auto.recognizers.length,0);
  assert.match(auto.errors[0].message,/chọn Tiếng Việt hoặc Tiếng Nhật/);
  auto.engine.stop();
  for (const [language,locale] of [['vi','vi-VN'],['ja','ja-JP']]) {
    const f=fixture({live:{stt_language:language}});
    await f.engine.start();f.engine.toggleTalk();
    assert.equal(f.recognizers[0].lang,locale);f.engine.stop();
  }
});

test('automatic API STT is sent once with auto language and a rejected transcript never reaches Chat',async()=>{
  const f=fixture({live:{stt_source:'voice',stt_language:'auto'},fetch(call){
    if(call.path==='/api/stt' && !call.body.action)return Response.json({
      code:'stt_language_unsupported',detail:'Em chọn ngôn ngữ hoặc nói lại nhé.'},{status:422});
  }});
  await f.engine.start();
  f.engine.toggleTalk();f.recorders[0].data(1024);f.advance(400);f.engine.toggleTalk();await cycle();
  assert(f.calls.filter(call=>call.path==='/api/stt').every(call=>call.body.language==='auto'));
  assert.equal(f.calls.filter(call=>call.path==='/api/stt' && !call.body.action).length,1);
  assert.equal(f.calls.filter(call=>call.path==='/api/live/turn').length,1);
  assert.equal(f.captions.filter(row=>row.role==='user').length,0);
  assert.match(f.errors.at(-1).message,/chọn ngôn ngữ/);f.engine.stop();
});

test('a safe correlation id survives a Live error and restores listening without a retry',async()=>{
  const requestId='12345678-1234-4234-8234-123456789abc';
  const f=fixture({fetch:()=>turnResponse(sse('error',{
    code:'live_incomplete',detail:'Câu trả lời bị ngắt.',request_id:requestId}))});
  await f.engine.start();
  assert.equal(f.calls.length,1);assert.equal(f.states.at(-1).phase,'listening');
  assert(f.errors[0].message.includes(requestId));f.engine.stop();
});

test('a learner blank at a TTS batch edge keeps its pause and original caption on replay',async()=>{
  for (const pieces of [['わたしは＿＿＿','です。'],['わたしは','___です。'],['＿＿＿','です。']]) {
    const parts=pieces.map((text,index)=>({lang:'ja',text,boundary:index?'inline':'start'}));
    const f=fixture({fetch:call=>call.path==='/api/live/turn'
      ?turnResponse(parts.map((part,index)=>segment(index,part)).join('')+done(parts)):undefined});
    await f.engine.start();
    assert.equal(f.captions.at(-1).text,pieces.join(' '));
    assert.deepEqual(f.clips.map(clip=>clip.boundary),pieces[0]==='＿＿＿'?['start']:['start','blank']);
    const requests=f.calls.length, clips=f.clips.map(clip=>clip.boundary);
    await f.engine.sendCommand('repeat');
    assert.equal(f.calls.length,requests);
    assert.deepEqual(f.clips.slice(-clips.length).map(clip=>clip.boundary),clips);
    assert.deepEqual(f.errors,[]);f.engine.stop();
  }
});

test('Live batches expanded blanks within actual personal and managed TTS caps, even inside one caption',async t=>{
  const key='synthetic-batch-fixture', requested=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    requested.push(JSON.parse(init.body).input);
    return new Response(Uint8Array.of(73,68,51,4),{headers:{'Content-Type':'audio/mpeg'}});
  });
  for (const managed of [false,true]) {
    const groups=[Array.from({length:18},(_,i)=>`語${i}`),['Em','thử'],['次','です。']];
    const parts=groups.map((words,index)=>({lang:index===1?'vi':'ja',text:words.join(index===1?'___':'＿＿＿'),boundary:index?'inline':'start'}));
    const profile=managed?{scope:'platform',id:'openai'}:{scope:'local',connection:{api_key:key}};
    const routing={version:2,mode:'single',primary:{provider:'openai',profile,voice_id:'alloy'}};
    const f=fixture({route:async()=>routing,fetch:call=>{
      if (call.path==='/api/live/turn') return turnResponse(parts.map((part,i)=>segment(i,part)).join('')+done(parts));
      if (call.path==='/api/tts') return voiceTts(call.body,managed?{OPENAI_API_KEY:key}:{},{userId:'learner',admin:managed});
    }});
    requested.length=0;
    await f.engine.start();
    assert.deepEqual(f.errors,[]);
    assert.deepEqual([...requested].sort(),groups.flat().sort());
    assert.equal(f.captions.at(-1).text,parts.map(part=>part.text).join(' '));
    assert.deepEqual(f.clips.map(clip=>clip.boundary),['start',...Array(17).fill('blank'),'inline','blank','inline','blank']);
    const calls=f.calls.length;
    await f.engine.sendCommand('repeat');
    assert.equal(f.calls.length,calls);assert.equal(f.clips.length,44);
    f.engine.stop();
  }
});

test('excessive blank expansion keeps the caption without spending unbounded synthesis requests',async()=>{
  const parts=[{lang:'ja',text:Array(33).fill('語').join('＿＿＿'),boundary:'start'}];
  const f=fixture({fetch:call=>call.path==='/api/live/turn'?turnResponse(segment(0,parts[0])+done(parts)):undefined});
  await f.engine.start();
  assert.equal(f.calls.filter(call=>call.path==='/api/tts').length,0);
  assert.equal(f.captions.at(-1).text,parts[0].text);
  assert.match(f.errors.at(-1).message,/quá nhiều phần/);f.engine.stop();
});

test('a detached reading stays in the caption but not the following spoken batch',async()=>{
  const parts=[{lang:'ja',text:'食べる。',boundary:'start'},
    {lang:'vi',text:'(taberu) Nghĩa là ăn.',speech_start:8,boundary:'sentence'}];
  const f=fixture({fetch:call=>call.path==='/api/live/turn'?turnResponse(parts.map((part,i)=>segment(i,part)).join('')+done(parts)):undefined});
  await f.engine.start();
  assert.equal(f.captions.at(-1).text,'食べる。 (taberu) Nghĩa là ăn.');
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/tts').map(call=>call.body.text),['<ja>食べる。</ja>','<vi> Nghĩa là ăn.</vi>']);
  assert.deepEqual(f.errors,[]);f.engine.stop();
});

test('first-sentence Mistral batching leaves punctuation inside a parenthetical reading for the TTS normalizer',async()=>{
  const parts=[{lang:'ja',text:'食べる(taberu!)',boundary:'start'},{lang:'vi',text:'nghĩa là ăn.',boundary:'inline'}];
  const f=fixture({route:async()=>({...routeSingle,primary:{provider:'mistral',speed:1}}),fetch:call=>
    call.path==='/api/live/turn'?turnResponse(parts.map((part,i)=>segment(i,part)).join('')+done(parts)):undefined});
  await f.engine.start();
  assert.deepEqual(f.calls.filter(call=>call.path==='/api/tts').map(call=>call.body.text),['<ja>食べる(taberu!)</ja> <vi>nghĩa là ăn.</vi>']);
  assert.deepEqual(f.errors,[]);f.engine.stop();
});
