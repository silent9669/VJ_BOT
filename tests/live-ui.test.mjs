import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function liveUI({microphone,reply}={}) {
  const elements=new Map(),windowEvents={},tracks=[{enabled:true,stopped:false,stop(){this.stopped=true;}}],requests=[];
  const stream={getTracks:()=>tracks,getAudioTracks:()=>tracks};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:'',dataset:{},attributes:{},events:{},children:[],
      append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}},
      insertBefore(node,next){const at=this.children.indexOf(next);if(at<0)this.children.push(node);else this.children.splice(at,0,node);node.parentNode=this;},
      replaceChildren(){this.children=[];},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);},
      addEventListener(name,handler){this.events[name]=handler;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},
      play:async()=>{}});
    return elements.get(id);
  };
  const channel={readyState:'open',events:{},sent:[],closed:false,addEventListener(name,fn){this.events[name]=fn;},send(value){this.sent.push(JSON.parse(value));},close(){this.closed=true;},emit(event){this.events.message({data:JSON.stringify(event)});}};
  let peer,permissions=0;
  class Peer {
    constructor(){peer=this;this.events={};this.iceGatheringState='complete';this.connectionState='connected';}
    addTrack(){}addEventListener(name,fn){this.events[name]=fn;}removeEventListener(){}
    async createOffer(){return {type:'offer',sdp:'v=0\r\nm=audio 9 test\r\n'};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.answer=value;channel.emit({type:'session.started'});}
    createDataChannel(){return channel;}
    close(){this.closed=true;}
  }
  const context=vm.createContext({console,Date,JSON,setInterval,clearInterval,setTimeout,clearTimeout,AbortController,
    RTCPeerConnection:Peer,MediaStream:class{},signedInUser:{user_id:'email:admin',is_admin:true},activeCurriculumLevel:'N5',
    location:{hash:'#classroom'},navigator:{mediaDevices:{getUserMedia:()=>{permissions++;return microphone?microphone():Promise.resolve(stream);}}},
    apiFetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body),signal:options.signal});return reply?reply():Response.json({model:'gpt-live-1',voice:'shida',id:'live_test',sdp:'answer',greeting:'こんにちは'});},
    document:{getElementById:element,createElement:()=>element('node_'+elements.size),querySelector:element,querySelectorAll:()=>[]},addEventListener:(name,fn)=>{windowEvents[name]=fn;}});
  context.window=context;vm.runInContext(readFileSync('static/live-transcript.js','utf8'),context);vm.runInContext(readFileSync('static/live.js','utf8'),context);
  return {context,element,channel,tracks,requests,stream,peer:()=>peer,permissions:()=>permissions,windowEvents};
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
    assert.equal(ui.element('live-status').textContent,endedStatus);
    assert.equal(ui.permissions(),1);assert.equal(ui.requests.length,1);
  }finally{ui.windowEvents.pagehide();}
});

test('free accounts cannot start a live conversation through the Voice action',async()=>{
  const ui=liveUI();ui.context.signedInUser.is_admin=false;await ui.context.openLiveConversation();assert.equal(ui.requests.length,0);assert.equal(ui.peer(),undefined);
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
