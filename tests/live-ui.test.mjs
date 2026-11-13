import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function liveUI({microphone,reply}={}) {
  const elements=new Map(),windowEvents={},tracks=[{enabled:true,stopped:false,stop(){this.stopped=true;}}],requests=[];
  const stream={getTracks:()=>tracks,getAudioTracks:()=>tracks};
  const element=id=>{
    if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:'',dataset:{},attributes:{},events:{},
      addEventListener(name,handler){this.events[name]=handler;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},
      play:async()=>{}});
    return elements.get(id);
  };
  const channel={readyState:'open',events:{},sent:[],closed:false,addEventListener(name,fn){this.events[name]=fn;},send(value){this.sent.push(JSON.parse(value));},close(){this.closed=true;},emit(event){this.events.message({data:JSON.stringify(event)});}};
  let peer;
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
    location:{hash:'#classroom'},navigator:{mediaDevices:{getUserMedia:microphone || (async()=>stream)}},
    apiFetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body),signal:options.signal});return reply?reply():Response.json({model:'gpt-live-1',voice:'shida',id:'live_test',sdp:'answer',greeting:'こんにちは'});},
    document:{getElementById:element,querySelector:element,querySelectorAll:()=>[]},addEventListener:(name,fn)=>{windowEvents[name]=fn;}});
  context.window=context;vm.runInContext(readFileSync('static/live.js','utf8'),context);
  return {context,element,channel,tracks,requests,stream,peer:()=>peer,windowEvents};
}

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
    assert.equal(ui.element('live-teacher-caption').textContent,'こんにちは！');assert.equal(ui.element('live-user-caption').textContent,'はい');
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
