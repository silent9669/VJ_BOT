import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function inputHarness({media, supported=true}={}){
  let recognition;
  class Recognition { constructor(){recognition=this;} start(){this.onstart();} stop(){this.onend();} abort(){this.onend();} }
  class Recorder { constructor(){this.state='inactive';} start(){this.state='recording';} stop(){this.state='inactive';} }
  const button={disabled:false,textContent:'Nói',events:{},setAttribute(name,value){this[name]=value;},addEventListener(name,fn){this.events[name]=fn;}};
  const input={value:'',focus(){}},status={textContent:''};
  const c=vm.createContext({window:supported?{SpeechRecognition:Recognition,MediaRecorder:Recorder}:{},
    navigator:{mediaDevices:media},setTimeout:()=>1,clearTimeout(){},URL:{revokeObjectURL(){}},Audio:class{},Blob,
    document:{addEventListener(){}},addEventListener(){}});
  vm.runInContext(readFileSync('static/speech-input.js','utf8'),c);
  const controller=c.createJapaneseInput({button,input,status,playbackButton:{hidden:true,style:{},addEventListener(){}}});
  return {button,input,status,controller,get recognition(){return recognition;}};
}
test('speech input offers a real stop action and preserves microphone errors after ending',()=>{
  const h=inputHarness();h.button.events.click();
  assert.equal(h.button['aria-pressed'],'true');
  h.button.events.click();assert.equal(h.button['aria-pressed'],'false');
  h.button.events.click();h.recognition.onerror({error:'not-allowed'});h.recognition.onend();
  assert.match(h.status.textContent,/quyền micro/);
});
test('leaving a speaking screen releases a microphone granted after recognition ended',async()=>{
  let resolve,stopped=0;
  const h=inputHarness({media:{getUserMedia:()=>new Promise(r=>resolve=r)}});
  h.button.events.click();h.controller.reset();
  resolve({getTracks:()=>[{stop(){stopped++;}}]});
  await new Promise(r=>setImmediate(r));
  assert.equal(stopped,1);assert.equal(h.button['aria-pressed'],'false');
});
test('unsupported speech recognition leaves the typed answer usable',()=>{
  const h=inputHarness({supported:false});
  assert.equal(h.button.disabled,true);assert.match(h.status.textContent,/nhập câu trả lời/i);
  assert.equal(h.input.value,'');
});

test('admin legacy API route resolves once to managed settings and Sound does not load personal metadata', () => {
  const app=readFileSync('static/app.js','utf8'),start=app.indexOf('function switchTab(');
  const source=app.slice(start,app.indexOf('\n// ==========================================',start));
  const nodes=new Map(),calls=[],hashes=[];
  const element=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,dataset:{},classList:{toggle(){}},pause(){},
      parentElement:{prepend(){}}});
    return nodes.get(id);
  };
  const c=vm.createContext({
    signedInUser:{user_id:'admin',is_admin:true},TAB_TITLES:{settings:'Cài đặt'},
    authorizePage:()=>true,confirmWorkspaceNavigation:()=>true,stopSpeech(){},
    featureVersion:0,quizRequest:0,fcRequest:0,kaiwaRenderRequest:0,simulationInterval:null,
    navigationVersion:0,curriculumRequest:0,studyPlanRequest:0,examTimerInterval:null,
    clearInterval(){},soundEngine:{playBlip(){}},
    location:{hash:'#settings/api'},history:{
      replaceState(_state,_title,hash){hashes.push(['replace',hash]);},
      pushState(_state,_title,hash){hashes.push(['push',hash]);}
    },
    appRouteHash:(_tab,route)=>'#settings/'+route.view,
    document:{body:{dataset:{}},getElementById:element,querySelector:element,querySelectorAll:()=>[]},
    scrollTo(){},showSettingsArea:area=>area,renderAccountSettings(){},
    renderAiPanels:()=>calls.push('personal-api'),loadVoiceProfiles:()=>calls.push('personal-voice'),
    renderAdminAISettings:()=>calls.push('managed')
  });
  c.window=c;
  vm.runInContext(source,c);
  c.switchTab('settings',{view:'api',fromHistory:true});
  assert.deepEqual(calls,['managed']);
  assert.deepEqual(hashes,[['replace','#settings/admin']]);
  calls.length=0;
  c.switchTab('settings',{view:'sound'});
  assert.deepEqual(calls,[]);
  c.signedInUser.is_admin=false;
  c.switchTab('settings',{view:'sound'});
  assert.deepEqual(calls,['personal-voice']);
});

test('managed voice markup retains Listen and quota notice without a duplicate platform API card', () => {
  const html=readFileSync('static/index.html','utf8');
  assert.doesNotMatch(html,/id="ai-platform(?:-test|-model)?"/);
  assert.match(html,/id="speech-managed-summary"[^>]*hidden[^>]*>OpenAI quản trị · gpt-4o-mini-tts · alloy/);
  assert.match(html,/id="speech-test"[^>]*aria-describedby="speech-test-hint"/);
  const notice=html.match(/id="speech-test-hint"[^>]*>([^<]+)/)?.[1] || '';
  assert.match(notice,/dùng hạn mức/);
  assert.match(notice,/có thể phát sinh phí/);
  assert.match(html,/id="speech-personal-setup"/);
});
