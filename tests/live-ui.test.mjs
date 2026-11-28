import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function liveUI({microphone,reply,settings,profiles,sttCapabilities,geminiReply,mistralReply,mistralConnect}={}) {
  const elements=new Map(),windowEvents={},tracks=[{enabled:true,stopped:false,stop(){this.stopped=true;}}],requests=[];
  const stream={getTracks:()=>tracks,getAudioTracks:()=>tracks};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:'',dataset:{},attributes:{},events:{},children:[],
      append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}},
      insertBefore(node,next){const at=this.children.indexOf(next);if(at<0)this.children.push(node);else this.children.splice(at,0,node);node.parentNode=this;},
      replaceChildren(){this.children=[];},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);},
      addEventListener(name,handler){this.events[name]=handler;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},
      play:async()=>{},querySelectorAll:()=>[]});
    return elements.get(id);
  };
  const channel={readyState:'open',events:{},sent:[],closed:false,addEventListener(name,fn){this.events[name]=fn;},send(value){this.sent.push(JSON.parse(value));},close(){this.closed=true;},emit(event){this.events.message({data:JSON.stringify(event)});}};
  let peer,permissions=0,socket,room;
  class FakeRoom {
    constructor(){room=this;this.events={};this.published=false;this.localParticipant={publishTrack:async()=>{this.published=true;}};}
    on(name,fn){this.events[name]=fn;}
    async connect(url,token){this.url=url;this.token=token;if(mistralConnect)await mistralConnect();}
    disconnect(){this.closed=true;}
    emit(name,...args){this.events[name]?.(...args);}
  }
  class FakeSocket {
    constructor(url){socket=this;this.url=url;this.events={};this.sent=[];this.readyState=1;}
    addEventListener(name,fn){this.events[name]=fn;}
    send(value){this.sent.push(JSON.parse(value));}
    close(){this.closed=true;}
    emit(name,data){this.events[name]?.({data:typeof data==='string'?data:JSON.stringify(data)});}
  }
  class FakeAudioContext {
    constructor(){this.sampleRate=48000;this.currentTime=0;this.destination={};}
    resume(){return Promise.resolve();}close(){this.closed=true;return Promise.resolve();}
    createAnalyser(){return {fftSize:256,smoothingTimeConstant:0,getByteTimeDomainData(){},connect(){},disconnect(){}};}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
    createScriptProcessor(){return {onaudioprocess:null,connect(){},disconnect(){}};}
    createBuffer(channels,length,rate){return {duration:length/rate,getChannelData(){return new Float32Array(length);}};}
    createBufferSource(){return {buffer:null,connect(){},start(){},disconnect(){}};}
  }
  class Peer {
    constructor(){peer=this;this.events={};this.iceGatheringState='complete';this.connectionState='connected';}
    addTrack(){}addEventListener(name,fn){this.events[name]=fn;}removeEventListener(){}
    async createOffer(){return {type:'offer',sdp:'v=0\r\nm=audio 9 test\r\n'};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.answer=value;channel.emit({type:'session.started'});}
    createDataChannel(){return channel;}
    close(){this.closed=true;}
  }
  const context=vm.createContext({console,Date,JSON,setInterval,clearInterval,setTimeout,clearTimeout,AbortController,AbortSignal,performance,
    RTCPeerConnection:Peer,MediaStream:class{},signedInUser:{user_id:'email:admin',is_admin:settings?.is_admin ?? true},activeCurriculumLevel:'N5',
    WebSocket:FakeSocket,AudioContext:FakeAudioContext,atob,btoa,URL,encodeURIComponent,Float32Array,Int16Array,TextDecoder,
    VJLiveKit:{Room:FakeRoom,RoomEvent:{TrackSubscribed:'ts',TrackUnsubscribed:'tu',DataReceived:'dr',Disconnected:'dc'},Track:{Kind:{Audio:'audio'},Source:{Microphone:'microphone'}}},
    location:{hash:'#classroom'},navigator:{mediaDevices:{getUserMedia:()=>{permissions++;return microphone?microphone():Promise.resolve(stream);}}},
    usesAntigravityOAuth:()=>false,TextEncoder,MediaRecorder:class{},
    apiFetch:async(path,options)=>{
      if(path==='/api/ai/settings')return Response.json(settings??{is_admin:true,source:'platform',platform:{configured:true}});
      if(path==='/api/ai/profiles')return Response.json(profiles);
      requests.push({path,method:options.method,redirect:options.redirect,body:JSON.parse(options.body),signal:options.signal,
        profile:new Headers(options.headers).get('X-VJBot-Profile')});
      if(path==='/api/stt')return sttCapabilities(options);
      if(path==='/api/live/gemini')return geminiReply?geminiReply():Response.json({token:'auth_tokens/test-token',ws:'wss://test/ws',model:'gemini-live',greeting:'こんにちは',commands:{repeat:'lặp lại'}},{status:201});
      if(path==='/api/live/mistral')return options.method==='DELETE'?Response.json({ok:true})
        :mistralReply?mistralReply():Response.json({id:'sess_test1',participantToken:'pt-test',serverUrl:'wss://lk.test',model:'mistral-live',greeting:'こんにちは',commands:{}},{status:201});
      return reply?reply():Response.json({model:'gpt-live-1',voice:'shida',id:'live_test',sdp:'answer',greeting:'こんにちは'});
    },
    document:{getElementById:element,createElement:()=>element('node_'+elements.size),querySelector:element,querySelectorAll:()=>[]},addEventListener:(name,fn)=>{windowEvents[name]=fn;}});
  context.window=context;
  context.VJProfiles={active:()=>null};
  for(const file of ['live-transcript','voice/live-cascaded','live'])vm.runInContext(readFileSync(`static/${file}.js`,'utf8'),context);
  return {context,element,channel,tracks,requests,stream,peer:()=>peer,socket:()=>socket,room:()=>room,permissions:()=>permissions,windowEvents};
}
const captions=(ui,role)=>ui.element('live-transcript').children.filter(row=>row.className==='live-turn '+role).map(row=>row.children[1].textContent).join('');

test('live voice relays only SDP and lesson references, appends exact timed captions and ends cleanly',async()=>{
  const ui=liveUI();
  await ui.element('live-start').events.click();
  try {
    assert.equal(ui.requests[0].path,'/api/live');assert.deepEqual(ui.requests[0].body,{sdp:'v=0\r\nm=audio 9 test\r\n',level:'N5',lesson:null});
    assert.equal(ui.peer().answer.sdp,'answer');
    assert.equal(ui.channel.sent[0].type,'session.commentary.append');
    ui.channel.emit({type:'session.output_transcript.delta',delta:'こんにちは',start_ms:0,end_ms:100});
    ui.channel.emit({type:'session.input_transcript.delta',delta:'はい',start_ms:70,end_ms:150});
    ui.channel.emit({type:'session.output_transcript.delta',delta:'！',start_ms:100,end_ms:200});
    assert.equal(captions(ui,'assistant'),'こんにちは！');assert.equal(captions(ui,'user'),'はい');
    ui.element('live-mute').events.click();assert.equal(ui.tracks[0].enabled,false);
    ui.element('live-mute').events.click();assert.equal(ui.tracks[0].enabled,true);
    ui.element('live-end').events.click();assert.equal(ui.channel.sent.at(-1).type,'session.close');assert.equal(ui.tracks[0].enabled,false);
    assert.notEqual(ui.peer().closed,true);
    ui.channel.emit({type:'session.closed'});assert.equal(ui.peer().closed,true);assert.equal(ui.tracks[0].stopped,true);assert.equal(ui.element('live-start').disabled,false);
  } finally {ui.windowEvents.pagehide();}
});

test('learners with a Gemini connection open a websocket session with timed captions and commands',async()=>{
  const ui=liveUI({settings:{is_admin:false,source:'own',own:{protocol:'gemini',base_url:'',model:'gm'},
    bases:{gemini:'https://generativelanguage.googleapis.com'}}});
  try {
    await ui.element('live-start').events.click();
    assert.equal(ui.requests.length,1);
    assert.equal(ui.requests[0].path,'/api/live/gemini');assert.deepEqual(ui.requests[0].body,{level:'N5',lesson:null});
    const socket=ui.socket();assert.equal(socket.url,'wss://test/ws?access_token=auth_tokens%2Ftest-token');
    socket.emit('open');assert.equal(socket.sent[0].clientContent.turns[0].parts[0].text,'こんにちは');
    socket.emit('message',{setupComplete:{}});
    const audio=Buffer.from(new Int16Array([100,-100,200]).buffer).toString('base64');
    socket.emit('message',{serverContent:{modelTurn:{parts:[{inlineData:{data:audio}}]},outputTranscription:{text:'こんにちは'}}});
    socket.emit('message',{serverContent:{inputTranscription:{text:'はい'}}});
    assert.equal(captions(ui,'assistant'),'こんにちは');assert.equal(captions(ui,'user'),'はい');
    ui.element('live-commands').events.click({target:{dataset:{command:'repeat'}}});
    assert.equal(socket.sent.at(-1).clientContent.turns[0].parts[0].text,'lặp lại');
    ui.element('live-end').events.click();
    assert.equal(socket.closed,true);assert.equal(ui.tracks[0].stopped,true);assert.equal(ui.element('live-start').disabled,false);
    assert.equal(ui.peer(),undefined);
  } finally {ui.windowEvents.pagehide();}
});

test('learners with a Mistral key open a LiveKit room with cumulative captions and a session delete on close',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const ui=liveUI({settings:{is_admin:false,source:'own',own:{protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'m'}}});
  try {
    await ui.element('live-start').events.click();
    assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].path,'/api/live/mistral');
    assert.deepEqual(ui.requests[0].body,{level:'N5',lesson:null});
    const room=ui.room();assert.equal(room.url,'wss://lk.test');assert.equal(room.token,'pt-test');assert.equal(room.published,true);
    t.mock.timers.tick(35000);
    assert.equal(ui.element('live-stage').dataset.active,'true');
    assert.match(ui.element('live-status').textContent,/lượt em nói/i);
    assert.equal(ui.tracks[0].stopped,false);
    const segment=content=>({type:'transcription.segment',id:'s1',role:'assistant',content,final:true});
    room.emit('dr',new TextEncoder().encode(JSON.stringify(segment('こんにちは'))),null,null,'voice_agent.events');
    room.emit('dr',new TextEncoder().encode(JSON.stringify(segment('こんにちは！'))),null,null,'voice_agent.events');
    room.emit('dr',new TextEncoder().encode(JSON.stringify(segment('こんにちは、ラム先生です'))),null,null,'voice_agent.events');
    room.emit('dr',new TextEncoder().encode(JSON.stringify({type:'transcription.segment',id:'u1',role:'user',content:'はい',final:true})),null,null,'voice_agent.events');
    assert.equal(captions(ui,'assistant'),'こんにちは、ラム先生です');assert.equal(captions(ui,'user'),'はい');
    ui.element('live-end').events.click();
    assert.equal(room.closed,true);assert.equal(ui.tracks[0].stopped,true);assert.equal(ui.element('live-start').disabled,false);
    assert.equal(ui.requests.at(-1).path,'/api/live/mistral');assert.deepEqual(ui.requests.at(-1).body,{id:'sess_test1'});
  } finally {ui.windowEvents.pagehide();}
});

test('Mistral Live surfaces non-fatal agent errors and ends the call on fatal ones',async()=>{
  const ui=liveUI({settings:{is_admin:false,source:'own',own:{protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'m'}}});
  try {
    await ui.element('live-start').events.click();
    const room=ui.room(),data=event=>new TextEncoder().encode(JSON.stringify(event));
    room.emit('dr',data({type:'error',source:'tts',code:'x',message:'voice not supported',fatal:false}),null,null,'voice_agent.events');
    assert.match(ui.element('live-status').textContent,/tts: voice not supported/);
    assert.equal(ui.element('live-stage').dataset.active,'true');assert.equal(ui.tracks[0].stopped,false);
    room.emit('dr',data({type:'error',source:'llm',code:'y',message:'model crashed',fatal:true}),null,null,'voice_agent.events');
    assert.equal(ui.element('live-stage').dataset.active,'false');
    assert.match(ui.element('live-status').textContent,/llm: model crashed/);
    assert.equal(ui.element('live-start').disabled,false);assert.equal(ui.tracks[0].stopped,true);
  } finally {ui.windowEvents.pagehide();}
});

test('Mistral Live opens with the selected device profile and closes with the same key',async()=>{
  const ui=liveUI({settings:{is_admin:false,source:'none',own:null}});
  ui.context.signedInUser={user_id:'email:learner',is_admin:false};
  const connection={protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'mistral-small-latest',api_key:'synthetic-device-mistral-key'};
  const {api_key,...metadata}=connection;
  let selection={scope:'local',id:'mistral-device'};
  ui.context.VJProfiles={active:()=>selection,list:async()=>[{id:'mistral-device',...metadata}],load:async(owner,id)=>{
    assert.equal(owner,'email:learner');assert.equal(id,'mistral-device');return connection;
  }};
  try {
    ui.context.openLiveConversation();
    await ui.element('live-start').events.click();
    assert.equal(ui.requests.length,1);
    assert.equal(ui.requests[0].path,'/api/live/mistral');assert.equal(ui.requests[0].method,'POST');
    assert.equal(ui.requests[0].redirect,'error');
    assert.deepEqual(ui.requests[0].body,{level:'N5',lesson:null,api_connection:connection});
    assert.equal(ui.room().published,true);assert.equal(ui.element('live-stage').dataset.active,'true');
    selection={scope:'local',id:'other-device'};
    ui.element('live-end').events.click();
    assert.equal(ui.requests.at(-1).method,'DELETE');assert.equal(ui.requests.at(-1).redirect,'error');
    assert.deepEqual(ui.requests.at(-1).body,{id:'sess_test1',api_connection:connection});
    assert.equal(ui.tracks[0].stopped,true);
  } finally {ui.windowEvents.pagehide();}
});

test('native Mistral creates and deletes with the same explicit server selection even after Chat changes',async()=>{
  const mistral={id:'pinned-mistral',protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'m'};
  const active={id:'active-openai',protocol:'openai',base_url:'https://api.openai.com/v1',model:'gpt'};
  const ui=liveUI({settings:{is_admin:false,own:active},profiles:{active_id:active.id,profiles:[active,mistral]}});
  let selection={scope:'server',id:mistral.id};
  ui.context.VJProfiles={active:()=>selection};
  try{
    ui.context.openLiveConversation();
    assert.match(ui.element('live-status').textContent,/^Kết nối trực tiếp gốc\./);
    assert.equal(ui.permissions(),0);
    await ui.element('live-start').events.click();
    assert.equal(ui.room().published,true);
    selection={scope:'server',id:active.id};
    ui.element('live-end').events.click();
    assert.deepEqual(ui.requests.map(({path,method,body,profile})=>({path,method,body,profile})),[
      {path:'/api/live/mistral',method:'POST',body:{level:'N5',lesson:null},profile:mistral.id},
      {path:'/api/live/mistral',method:'DELETE',body:{id:'sess_test1'},profile:mistral.id}
    ]);
    selection={scope:'server',id:'stale'};
    await ui.element('live-start').events.click();
    assert.equal(ui.permissions(),1,'stale explicit selection never requests another microphone');
    assert.equal(ui.requests.length,2);
    assert.match(ui.element('live-status').textContent,/Cài đặt/);
  }finally{ui.windowEvents.pagehide();}
});

test('native Mistral cannot start without a selected Chat model',async()=>{
  for(const model of [undefined,null,'']){
    const own={id:'pinned',protocol:'openai',base_url:'https://api.mistral.ai/v1',model,connection_id:'saved'};
    const ui=liveUI({settings:{is_admin:false,own}});
    ui.context.VJProfiles={active:()=>({scope:'server',id:own.id})};
    try {
      await ui.element('live-start').events.click();
      assert.equal(ui.permissions(),0);
      assert.equal(ui.requests.length,0);
      assert.match(ui.element('live-status').textContent,/Cài đặt/);
    } finally {ui.windowEvents.pagehide();}
  }
});

test('native Live cannot borrow a dormant Mistral profile while OAuth is selected or profile storage is missing',async()=>{
  const mistral={id:'pinned',protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'mistral-small-latest'};
  for(const blocked of ['oauth','storage']){
    const ui=liveUI({settings:{is_admin:false,own:mistral}});
    if(blocked==='oauth')ui.context.usesAntigravityOAuth=()=>true;
    else delete ui.context.VJProfiles;
    try{
      await ui.element('live-start').events.click();
      assert.equal(ui.permissions(),0);
      assert.equal(ui.requests.length,0);
    }finally{ui.windowEvents.pagehide();}
  }
});

test('clearing the Native Mistral server pin during microphone permission prevents session creation',async()=>{
  const mistral={id:'pinned',protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'mistral-small-latest'};
  const entered=Promise.withResolvers(), granted=Promise.withResolvers();
  let selected={scope:'server',id:mistral.id};
  const ui=liveUI({settings:{is_admin:false,own:mistral},microphone:()=>{entered.resolve();return granted.promise;}});
  ui.context.VJProfiles={active:()=>selected};
  const opening=ui.element('live-start').events.click();
  try{
    await Promise.race([entered.promise,opening]);
    assert.equal(ui.permissions(),1);
    selected={scope:'none'};
    granted.resolve(ui.stream);await opening;
    assert.equal(ui.requests.length,0);
    assert.equal(ui.tracks[0].stopped,true);
    assert.match(ui.element('live-status').textContent,/Kết nối Mistral không còn dùng được/);
  }finally{granted.resolve(ui.stream);await opening;ui.windowEvents.pagehide();}
});

test('ending a Native Mistral call during create closes a late session with the original server pin',async()=>{
  const mistral={id:'original',protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'mistral-small-latest'};
  const entered=Promise.withResolvers(), created=Promise.withResolvers();
  const ui=liveUI({settings:{is_admin:false,own:mistral},mistralReply:()=>{entered.resolve();return created.promise;}});
  let selected={scope:'server',id:mistral.id};
  ui.context.VJProfiles={active:()=>selected};
  const opening=ui.element('live-start').events.click();
  try{
    await Promise.race([entered.promise,opening]);
    assert.equal(ui.requests[0].method,'POST');
    ui.element('live-end').events.click();
    assert.equal(ui.tracks[0].stopped,true);
    assert.equal(ui.requests[0].signal.aborted,false);
    selected={scope:'server',id:'different'};
    created.resolve(Response.json({id:'sess_late'}));await opening;
    assert.equal(ui.room(),undefined);
    assert.deepEqual(ui.requests.slice(1).map(({method,profile,body})=>[method,profile,body]),
      [['DELETE',mistral.id,{id:'sess_late'}]]);
  }finally{created.resolve(Response.json({id:'sess_late'}));await opening;ui.windowEvents.pagehide();}
});

test('Mistral Live does not send a device key after the selected connection changes',async()=>{
  const ui=liveUI({settings:{is_admin:false,own:null}});
  ui.context.signedInUser={user_id:'email:learner',is_admin:false};
  const profile={id:'mistral-device',protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'mistral-small-latest'};
  let selection={scope:'local',id:profile.id};
  ui.context.VJProfiles={active:()=>selection,list:async()=>[profile],load:async()=>{
    selection={scope:'none',id:''};return {...profile,api_key:'synthetic-device-mistral-key'};
  }};
  try {
    await ui.element('live-start').events.click();
    assert.equal(ui.requests.length,0);assert.equal(ui.tracks[0].stopped,true);
    assert.match(ui.element('live-status').textContent,/Kết nối Mistral không còn dùng được/);
  } finally {ui.windowEvents.pagehide();}
});

test('Mistral Live times out while the room is still connecting',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let joined,release;
  const connecting=new Promise(resolve=>{joined=resolve;});
  const ui=liveUI({settings:{is_admin:false,own:{protocol:'openai',base_url:'https://api.mistral.ai/v1',model:'m'}},
    mistralConnect:()=>new Promise(resolve=>{release=resolve;joined();})});
  const start=ui.element('live-start').events.click();
  try {
    await connecting;
    t.mock.timers.tick(35000);
    assert.match(ui.element('live-status').textContent,/hết thời gian/i);
    assert.equal(ui.element('live-start').disabled,false);
    assert.equal(ui.tracks[0].stopped,true);
    assert.deepEqual(ui.requests.at(-1).body,{id:'sess_test1'});
  } finally {
    release?.();await start;ui.windowEvents.pagehide();
  }
});

test('Live uses the latest saved provider when starting a Mistral call',async()=>{
  const settings={is_admin:false,own:{protocol:'openai',base_url:'https://openrouter.ai/api/v1',model:'m'}};
  const ui=liveUI({settings});
  try {
    await ui.element('live-start').events.click();
    assert.equal(ui.requests.length,0);
    settings.own.base_url='https://api.mistral.ai/v1';
    await ui.element('live-start').events.click();
    assert.equal(ui.requests[0]?.path,'/api/live/mistral');
    assert.equal(ui.element('live-stage').dataset.active,'true');
  } finally {ui.windowEvents.pagehide();}
});

test('a learner without a live-capable key gets a guidance message instead of a call',async()=>{
  const ui=liveUI({settings:{is_admin:false,source:'own',own:{protocol:'openai',base_url:'https://openrouter.ai/api/v1',model:'m'}}});
  try {
    await ui.element('live-start').events.click();
    assert.equal(ui.requests.length,0);assert.equal(ui.socket(),undefined);assert.equal(ui.peer(),undefined);
    assert.equal(ui.element('live-status').textContent,'Nói trực tiếp cần kết nối OpenAI chính thức, Gemini gốc hoặc Mistral gốc trong Cài đặt.');
  } finally {ui.windowEvents.pagehide();}
});

function setupCascaded(ui,{source='chat',selection={scope:'server',id:'chat'}}={}){
  const config={mode:'single',primary:{provider:'mistral'},live:{engine:'cascaded',stt_source:source,turn_mode:'ptt'}};
  ui.context.VJVoiceRouting={stored:()=>config,liveConfig:config=>config.live,liveIdentity:config=>JSON.stringify(config)};
  ui.context.VJProfiles={active:()=>selection};
  return config;
}

test('idle Live distinguishes bilingual Mistral from native and points missing Chat to Settings before opening the mic',async()=>{
  const ui=liveUI({settings:{is_admin:false}});
  const config=setupCascaded(ui,{source:'browser',selection:{scope:'none',id:''}});
  try{
    ui.context.openLiveConversation();
    assert.match(ui.element('live-status').textContent,/Giọng song ngữ · Mistral/);
    assert.equal(ui.permissions(),0);assert.equal(ui.requests.length,0);
    await ui.element('live-start').events.click();
    assert.match(ui.element('live-status').textContent,/kết nối trò chuyện.*Cài đặt/i);
    assert.equal(ui.permissions(),0);assert.equal(ui.requests.length,0);
    assert.equal(ui.element('live-start').disabled,false);
    config.live.engine='native';ui.windowEvents['vjbot-voice-changed']();
    assert.match(ui.element('live-status').textContent,/^Kết nối trực tiếp gốc\./);
  }finally{ui.windowEvents.pagehide();}
});

test('cascaded Live probes STT before the mic and navigation cancels the pending preflight',async()=>{
  let release, entered;
  const probing=new Promise(resolve=>{entered=resolve;});
  const ui=liveUI({settings:{is_admin:false},profiles:{profiles:[{id:'chat',model:'gm'}]},
    sttCapabilities:()=>new Promise(resolve=>{release=resolve;entered();})});
  setupCascaded(ui);
  const opening=ui.element('live-start').events.click();
  try{
    await Promise.race([probing,opening]);
    assert.equal(ui.permissions(),0);
    assert.deepEqual(ui.requests[0].body,{action:'capabilities',language:'auto'});
    ui.context.location.hash='#dashboard';ui.windowEvents.hashchange();
    assert(ui.requests[0].signal.aborted);
    release(Response.json({supported:true,provider:'openai'}));await opening;
    assert.equal(ui.permissions(),0);assert.equal(ui.requests.length,1);
    assert.equal(ui.element('live-start').disabled,false);
  }finally{release?.(Response.json({supported:false}));await opening;ui.windowEvents.pagehide();}
});

test('incompatible Chat transcription suggests a concrete STT setting without microphone access',async()=>{
  const ui=liveUI({settings:{is_admin:false},profiles:{profiles:[{id:'chat',model:'gm'}]},
    sttCapabilities:()=>Response.json({supported:false,provider:null})});
  setupCascaded(ui);
  try{
    await ui.element('live-start').events.click();
    assert.equal(ui.permissions(),0);
    assert.deepEqual(ui.requests.map(({path,body})=>[path,body]),[['/api/stt',{action:'capabilities',language:'auto'}]]);
    assert.match(ui.element('live-status').textContent,/không hỗ trợ chép lời.*Cài đặt.*Âm thanh.*Nguồn chép lời/i);
    assert.equal(ui.element('live-start').disabled,false);
  }finally{ui.windowEvents.pagehide();}
});

test('valid STT capability is reused after the click resumes audio and only then opens the mic',async()=>{
  const setup=[];
  const ui=liveUI({settings:{is_admin:false},profiles:{profiles:[{id:'chat',model:'m'}]},
    sttCapabilities:()=>{setup.push('stt');return Response.json({supported:true,provider:'openai'});},
    microphone:()=>{setup.push('mic');return Promise.resolve(ui.stream);},
    reply:()=>Response.json({detail:'Stop after checking setup'},{status:503})});
  const resume=ui.context.AudioContext.prototype.resume;
  ui.context.AudioContext.prototype.resume=function(){setup.push('resume');return resume.call(this);};
  setupCascaded(ui);
  try{
    await ui.element('live-start').events.click();
    assert.deepEqual(setup,['resume','stt','mic']);
    assert.deepEqual(ui.requests.map(({path})=>path),['/api/stt','/api/live/turn']);
  }finally{ui.windowEvents.pagehide();}
});

test('cascaded Live pins the validated server default on a fresh browser without changing preferences',async()=>{
  const ui=liveUI({settings:{is_admin:false,own:{id:'server-default',model:'mistral-small-latest'}},
    sttCapabilities:()=>Response.json({supported:true,provider:'mistral'}),
    reply:()=>Response.json({detail:'Stop after checking setup'},{status:503})});
  setupCascaded(ui,{selection:null});
  try{
    await ui.element('live-start').events.click();
    assert.deepEqual(ui.requests.map(({path,profile})=>[path,profile]),
      [['/api/stt','server-default'],['/api/live/turn','server-default']]);
    assert.equal(ui.context.VJProfiles.active(),null);
  }finally{ui.windowEvents.pagehide();}
});

test('cascaded Live without audio playback permission does not start the microphone',async()=>{
  const ui=liveUI({settings:{is_admin:false},profiles:{profiles:[{id:'chat',model:'m'}]},
    sttCapabilities:()=>Response.json({supported:true,provider:'openai'})});
  setupCascaded(ui);
  ui.context.AudioContext.prototype.resume=()=>Promise.reject(new DOMException('blocked','NotAllowedError'));
  try{
    await ui.element('live-start').events.click();
    assert.equal(ui.permissions(),0);
    assert.match(ui.element('live-status').textContent,/chưa cho phát âm thanh/i);
  }finally{ui.windowEvents.pagehide();}
});

test('unpinned canonical choice guidance does not require a remote Chat connection',async()=>{
  const ui=liveUI({settings:{is_admin:false,own:null},reply:()=>Response.json({detail:'Stop after checking setup'},{status:503})});
  const config=setupCascaded(ui,{source:'browser',selection:null});
  config.live.stt_language='vi';
  ui.context.SpeechRecognition=class{};
  ui.context.teacherContext=()=>({lesson:{id:'grammar:1',level:'N5'},focus:{kind:'question',index:0},task:{mode:'choice'}});
  ui.context.taskRevisionSource=()=> 'task-stable';
  ui.context.taskReference=async()=>({id:'task'});
  try{
    await ui.element('live-start').events.click();
    assert.equal(ui.permissions(),1);
    assert.deepEqual(ui.requests.map(({path})=>path),['/api/live/turn']);
    assert.equal(ui.requests[0].body.focus.kind,'question');
  }finally{ui.windowEvents.pagehide();}
});

test('cancelling microphone permission releases a late microphone without creating a call',async()=>{
  let release;
  const ui=liveUI({microphone:()=>new Promise(resolve=>{release=resolve;})});
  const start=ui.element('live-start').events.click();ui.element('live-end').events.click();release(ui.stream);await start;
  assert.equal(ui.tracks[0].stopped,true);assert.equal(ui.requests.length,0);assert.equal(ui.element('live-start').disabled,false);
});

test('a denied microphone or failed live API leaves no open media connection',async()=>{
  const denied=liveUI({microphone:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}});
  await denied.element('live-start').events.click();assert.match(denied.element('live-status').textContent,/Micro/);assert.equal(denied.requests.length,0);
  const failed=liveUI({reply:async()=>Response.json({detail:'Quota exhausted'},{status:503})});
  await failed.element('live-start').events.click();assert.equal(failed.peer().closed,true);assert.equal(failed.tracks[0].stopped,true);assert.equal(failed.element('live-status').textContent,'Quota exhausted');
});

test('an account change during live setup discards the answer and releases the microphone',async()=>{
  let release,started;
  const sent=new Promise(resolve=>{started=resolve;});
  const ui=liveUI({reply:()=>{started();return new Promise(resolve=>{release=resolve;});}});
  const setup=ui.element('live-start').events.click();await sent;ui.context.signedInUser=null;
  release(Response.json({sdp:'late',greeting:'hello'}));await setup;
  assert.equal(ui.peer().answer,undefined);assert.equal(ui.peer().closed,true);assert.equal(ui.tracks[0].stopped,true);
});

test('opening live shows the panel without requesting a microphone until explicit Start',async()=>{
  const ui=liveUI();
  ui.context.stopLiveConversation();
  const cleanupStatus=ui.element('live-status').textContent;
  await ui.context.openLiveConversation();
  assert.equal(ui.element('classroom-voice').hidden,false);assert.equal(ui.element('classroom-text').hidden,true);
  assert.equal(ui.permissions(),0);assert.equal(ui.requests.length,0);assert.equal(ui.peer(),undefined);
  assert.ok(ui.element('live-status').textContent.trim());
  assert.notEqual(ui.element('live-status').textContent,cleanupStatus);
  await ui.element('live-start').events.click();
  try{
    assert.equal(ui.permissions(),1);assert.equal(ui.requests.length,1);
    for(const [type,delta] of [['session.input_transcript.delta','こんにちは'],['session.output_transcript.delta','こんにちは。'],['session.input_transcript.delta','学生です'],['session.output_transcript.delta','何年生ですか？']])ui.channel.emit({type,delta,start_ms:100,end_ms:200});
    assert.equal(captions(ui,'assistant'),'こんにちは。何年生ですか？');assert.equal(captions(ui,'user'),'こんにちは学生です');
    ui.context.stopLiveConversation();assert.equal(ui.tracks[0].enabled,false);ui.channel.emit({type:'session.closed'});assert.equal(ui.peer().closed,true);
    const endedStatus=ui.element('live-status').textContent;
    await ui.context.openLiveConversation();
    assert.match(endedStatus,/kết thúc/);
    assert.match(ui.element('live-status').textContent,/^Kết nối trực tiếp gốc\./);
    assert.equal(ui.permissions(),1);assert.equal(ui.requests.length,1);
  }finally{ui.windowEvents.pagehide();}
});

test('signed-in learners open the live view without media or fetch until they press start',async()=>{
  const ui=liveUI();ui.context.signedInUser.is_admin=false;await ui.context.openLiveConversation();
  assert.equal(ui.element('classroom-voice').hidden,false);assert.equal(ui.requests.length,0);assert.equal(ui.peer(),undefined);
});

test('switching accounts during an active call disables the mic and clears the previous transcript',async()=>{
  const ui=liveUI();await ui.context.openLiveConversation();await ui.element('live-start').events.click();
  ui.channel.emit({type:'session.input_transcript.delta',delta:'私の話',start_ms:0,end_ms:400});
  ui.context.signedInUser={user_id:'email:other-admin',is_admin:true};ui.context.checkLiveAccount();
  assert.equal(ui.tracks[0].enabled,false);assert.equal(ui.element('live-transcript').children.length,0);
  assert.equal(ui.element('classroom-voice').hidden,true);ui.channel.emit({type:'session.closed'});ui.windowEvents.pagehide();
});

test('waveform measures microphone and teacher media and releases its audio graph on close',async()=>{
  const ui=liveUI(),sources=[];let closed=false,cancelled=false,lines=0;
  const drawing={clearRect(){},beginPath(){},moveTo(){},lineTo(){lines++;},stroke(){}};
  ui.element('live-wave').width=640;ui.element('live-wave').height=96;ui.element('live-wave').getContext=()=>drawing;
  ui.context.AudioContext=class{
    resume(){return Promise.resolve();}close(){closed=true;return Promise.resolve();}
    createAnalyser(){return {getByteTimeDomainData(values){values.fill(144);}};}
    createMediaStreamSource(){const source={connect(){},disconnect(){this.disconnected=true;}};sources.push(source);return source;}
  };
  ui.context.Uint8Array=Uint8Array;ui.context.getComputedStyle=()=>({color:'#325d43'});ui.context.requestAnimationFrame=()=>5;ui.context.cancelAnimationFrame=id=>{cancelled=id===5;};
  await ui.context.openLiveConversation();await ui.element('live-start').events.click();
  ui.peer().events.track({track:{}});assert.equal(sources.length,2);assert.ok(lines>0);
  ui.windowEvents.pagehide();assert.equal(closed,true);assert.equal(cancelled,true);assert.ok(sources.every(source=>source.disconnected));assert.equal(ui.tracks[0].stopped,true);
});

test('blocked autoplay offers an explicit audio action and a late playback rejection stays closed',async()=>{
  const ui=liveUI();let fail=true;
  ui.element('live-audio').play=async()=>{if(fail)throw new Error('autoplay blocked');};
  await ui.context.openLiveConversation();await ui.element('live-start').events.click();ui.peer().events.track({track:{}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.element('live-play-audio').hidden,false);
  ui.element('live-mute').events.click();const mutedStatus=ui.element('live-status').textContent;
  fail=false;await ui.element('live-play-audio').events.click();assert.equal(ui.element('live-play-audio').hidden,true);
  assert.equal(ui.tracks[0].enabled,false);assert.equal(ui.element('live-stage').dataset.turn,'muted');
  assert.equal(ui.element('live-status').textContent,mutedStatus);
  let reject;ui.element('live-audio').play=()=>new Promise((_resolve,fail)=>{reject=fail;});ui.peer().events.track({track:{}});
  ui.windowEvents.pagehide();reject(new Error('closed'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.element('live-play-audio').hidden,true);assert.match(ui.element('live-status').textContent,/kết thúc/);
});
