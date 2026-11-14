import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function browser(fetch){
  const elements=new Map(),storage=new Map();let reloads=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',open:false,events:{},setAttribute(){},focus(){},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(){},showModal(){this.open=true;},close(){this.open=false;}});
    return elements.get(id);
  };
  const configs=[],google={accounts:{id:{initialize(config){configs.push(config);},renderButton(){}}}};
  const events=new EventTarget();
  const context=vm.createContext({fetch,google,crypto,Response,Headers,Date,JSON,Event,setTimeout,
    addEventListener:events.addEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),
    location:{reload(){reloads++;}},document:{getElementById:element},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
  context.window=context;vm.runInContext(readFileSync('static/account.js','utf8'),context);
  return {context,element,configs,storage,reloads:()=>reloads};
}
test('Google nonce is requested when opening login and refreshed on reopening',async()=>{
  let configs=0;
  const b=browser(async path=>path.endsWith('/session')?Response.json({user:null}):Response.json({client_id:'public-client',nonce:'nonce-'+(++configs)}));
  await b.context.setupAccount();assert.equal(configs,0);
  await b.context.openAccount();assert.equal(b.configs[0].nonce,'nonce-1');
  b.element('auth-dialog').close();await b.context.openAccount();assert.equal(b.configs[1].nonce,'nonce-2');
});
test('failed session checks never silently save account progress as guest progress',async()=>{
  const b=browser(async path=>path.endsWith('/session')?new Response('',{status:503}):Response.json({client_id:'public-client',nonce:'nonce'}));
  await b.context.setupAccount();
  const response=await b.context.apiFetch('/api/progress/record',{method:'POST',body:JSON.stringify({item_id:'word',correct:true})});
  assert.equal(response.status,503);assert.equal(b.storage.has('vjbot_guest_progress'),false);
});
test('expired sessions offer fresh Google sign-in and block local fallback writes',async()=>{
  const b=browser(async path=>{
    if(path.endsWith('/session'))return Response.json({user:{name:'Learner',user_id:'google:test'}});
    if(path.endsWith('/config'))return Response.json({client_id:'public-client',nonce:'fresh'});
    return new Response('',{status:401});
  });
  await b.context.setupAccount();assert.equal(b.element('google-signin').hidden,true);
  assert.equal((await b.context.apiFetch('/api/progress')).status,401);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(b.element('google-signin').hidden,false);assert.equal(b.configs[0].nonce,'fresh');
  assert.equal((await b.context.apiFetch('/api/progress/record',{method:'POST',body:JSON.stringify({item_id:'word',correct:true})})).status,503);
  assert.equal(b.storage.has('vjbot_guest_progress'),false);
});
test('failed logout keeps the page and explains that the session was not closed',async()=>{
  const b=browser(async path=>path.endsWith('/session')?Response.json({user:{name:'Learner'}}):new Response('',{status:503}));
  await b.context.setupAccount();await b.element('auth-logout').events.click();
  assert.equal(b.reloads(),0);assert.match(b.element('auth-status').textContent,/Chưa đăng xuất/);
  assert.equal(b.element('auth-dialog').open,true);
  assert.equal(vm.runInContext('signedInUser.name',b.context),'Learner');
});
test('network failures are actionable without retries and intentional cancellation keeps its AbortError',async()=>{
  let calls=0, failure=new TypeError('Failed to fetch');
  const b=browser(async path=>{
    if(path.endsWith('/session'))return Response.json({user:{name:'Learner',user_id:'owner'}});
    calls++;throw failure;
  });
  await b.context.setupAccount();
  await assert.rejects(b.context.apiFetch('/api/progress'),error=>error.userFacing===true && error.message!==failure.message);
  assert.equal(calls,1);
  failure=Object.assign(new Error('cancelled'),{name:'AbortError'});
  await assert.rejects(b.context.apiFetch('/api/progress'),error=>error===failure);
  assert.equal(calls,2);
  assert.equal(vm.runInContext('signedInUser.user_id',b.context),'owner');
});

test('signed-out learners cannot write progress through the former guest fallback',async()=>{
  const b=browser(async path=>path.endsWith('/session')?Response.json({user:null}):Response.json({client_id:'public-client',nonce:'fresh'}));
  await b.context.setupAccount();
  assert.equal((await b.context.apiFetch('/api/progress/record',{method:'POST',body:JSON.stringify({item_id:'word',correct:true})})).status,401);
  assert.equal(b.storage.has('vjbot_guest_progress'),false);
});

test('an unavailable device profile fails closed without sending a chat request to a server fallback', async () => {
  let calls=0;
  const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'google:test'}});});
  await b.context.setupAccount();
  b.context.VJProfiles={prepareRequest:async()=>{throw new Error('Unavailable device profile');}};
  const response=await b.context.apiFetch('/api/chat',{method:'POST',body:JSON.stringify({message:'hello'})});
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'api_profile_unavailable');
  assert.equal(calls,1);
});

test('changing account while device credentials load prevents the pending request from leaving the browser', async () => {
  let calls=0,release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'google:first'}});});
  await b.context.setupAccount();
  b.context.VJProfiles={prepareRequest:async(_path,options)=>{started();return new Promise(resolve=>{release=()=>resolve(options);});}};
  const pending=b.context.apiFetch('/api/chat',{method:'POST',body:JSON.stringify({message:'hello'})});
  await ready;
  vm.runInContext("signedInUser={user_id:'google:second'}",b.context);
  release();
  assert.equal((await pending).status,401);
  assert.equal(calls,1);
});

test('missing profile support never sends inference through an implicit server connection', async () => {
  let calls=0;
  const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'google:test'}});});
  await b.context.setupAccount();
  const response=await b.context.apiFetch('/api/chat',{method:'POST',body:'{}'});
  assert.equal(response.status,503);
  assert.equal(calls,1);
});

test('credential-bearing writes declare the expected account for server-side cookie drift checks', async () => {
  const requests=[];
  const b=browser(async(path,options)=>{requests.push({path,options});return Response.json({user:{name:'Learner',user_id:'google:first'}});});
  await b.context.setupAccount();
  await b.context.apiFetch('/api/ai/profiles',{method:'POST',body:'{}'});
  assert.equal(new Headers(requests[1].options.headers).get('X-VJBot-Account'),'google:first');
});

test('OAuth inference pins the chosen opaque connection while read-aloud keeps its API profile', async () => {
  const requests=[];
  const b=browser(async(path,options)=>{requests.push({path,options});return Response.json({user:{name:'Learner',user_id:'google:first'}});});
  await b.context.setupAccount();
  b.storage.set('vjbot_ai_method:google:first','antigravity');
  b.storage.set('vjbot_ai_oauth:google:first','opaque-first');
  b.context.VJProfiles={voice:()=>({scope:'server',id:'voice-profile'}),prepareRequest:async(_path,options)=>({...options,headers:{'X-VJBot-Profile':'voice-profile'}})};
  await b.context.apiFetch('/api/chat',{method:'POST',body:'{}'});
  await b.context.apiFetch('/api/kaiwa/evaluate',{method:'POST',body:'{}'});
  await b.context.apiFetch('/api/tts',{method:'POST',body:'{}'});
  await b.context.apiFetch('/api/stt',{method:'POST',body:'{}'});
  assert.equal(new Headers(requests[1].options.headers).get('X-VJBot-Profile'),'antigravity_oauth:opaque-first');
  assert.equal(new Headers(requests[2].options.headers).get('X-VJBot-Profile'),'antigravity_oauth:opaque-first');
  assert.equal(new Headers(requests[3].options.headers).get('X-VJBot-Profile'),'voice-profile');
  assert.equal(new Headers(requests[4].options.headers).get('X-VJBot-Profile'),'voice-profile');
});

test('missing, cleared and malformed OAuth choices fail closed instead of borrowing server active', async () => {
  for(const value of [undefined,'','../gateway/auth.json','antigravity_oauth:other']){
    let calls=0;
    const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'google:first'}});});
    await b.context.setupAccount();
    b.storage.set('vjbot_ai_method:google:first','antigravity');
    if(value!==undefined)b.storage.set('vjbot_ai_oauth:google:first',value);
    const response=await b.context.apiFetch('/api/chat',{method:'POST',body:'{}'});
    assert.equal(response.status,409);
    assert.equal(calls,1);
  }
});

test('OAuth connection preferences never leak between VJBot owners', async () => {
  const requests=[];
  const b=browser(async(path,options)=>{requests.push({path,options});return Response.json({user:{name:'Learner',user_id:'google:first'}});});
  await b.context.setupAccount();
  b.storage.set('vjbot_ai_method:google:first','antigravity');
  b.storage.set('vjbot_ai_oauth:google:first','first-only');
  b.context.VJProfiles={prepareRequest:async(_path,options)=>({...options,headers:{'X-VJBot-Profile':'server:second-profile'}})};
  vm.runInContext("signedInUser={user_id:'google:second'}",b.context);
  await b.context.apiFetch('/api/chat',{method:'POST',body:'{}'});
  assert.equal(new Headers(requests[1].options.headers).get('X-VJBot-Profile'),'server:second-profile');
  b.storage.set('vjbot_ai_method:google:second','antigravity');
  assert.equal((await b.context.apiFetch('/api/chat',{method:'POST',body:'{}'})).status,409);
  assert.equal(requests.length,2);
});

test('switching method while an API profile loads blocks the stale inference request', async () => {
  let calls=0,release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'google:first'}});});
  await b.context.setupAccount();
  b.context.VJProfiles={prepareRequest:async(_path,options)=>{started();return new Promise(resolve=>{release=()=>resolve(options);});}};
  const pending=b.context.apiFetch('/api/chat',{method:'POST',body:'{}'});
  await ready;
  b.storage.set('vjbot_ai_method:google:first','antigravity');
  b.storage.set('vjbot_ai_oauth:google:first','new-choice');
  release();
  assert.equal((await pending).status,409);
  assert.equal(calls,1);
});

test('voice choices and owner changes are rechecked after local or server credential preparation', async () => {
  for (const scope of ['local','server']) {
    for (const changed of ['voice','owner','round-trip']) {
      let release,started,calls=0;
      const ready=new Promise(resolve=>{started=resolve;});
      const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'alice'}});});
      await b.context.setupAccount();
      let selected={scope,id:'voice-a'};
      b.context.VJProfiles={
        voice:()=>selected,
        prepareRequest:async(_path,options)=>{started();await new Promise(resolve=>{release=resolve;});return options;}
      };
      const pending=b.context.apiFetch('/api/tts',{method:'POST',body:'{}'});
      await ready;
      if(changed==='owner')vm.runInContext("signedInUser={user_id:'bob'}",b.context);
      else {
        selected={scope,id:'voice-b'};
        b.context.dispatchEvent(new Event('vjbot-voice-changed'));
        if(changed==='round-trip')selected={scope,id:'voice-a'};
      }
      release();
      assert.equal((await pending).status,changed==='owner'?401:409,scope+'/'+changed);
      assert.equal(calls,1);
    }
  }
});

test('missing or corrupt voice choice fails closed even with a working chat profile', async () => {
  for(const voice of [()=>null,()=>({scope:'none',id:''}),()=>{throw new Error('corrupt');}]) {
    let calls=0,prepared=0;
    const b=browser(async()=>{calls++;return Response.json({user:{name:'Learner',user_id:'alice'}});});
    await b.context.setupAccount();
    b.context.VJProfiles={voice,prepareRequest:async(_path,options)=>{prepared++;return options;}};
    assert.equal((await b.context.apiFetch('/api/tts',{method:'POST',body:'{}'})).status,409);
    assert.equal(calls,1);assert.equal(prepared,0);
  }
});

test('changing API or OAuth chat while voice prepares does not rotate or cancel the pinned voice', async () => {
  let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  const requests=[];
  const b=browser(async(path,options)=>{requests.push({path,options});return Response.json({user:{name:'Learner',user_id:'alice'}});});
  await b.context.setupAccount();
  b.context.VJProfiles={
    voice:()=>({scope:'server',id:'voice-b'}),
    prepareRequest:async(_path,options)=>{started();await new Promise(resolve=>{release=resolve;});return {...options,headers:{'X-VJBot-Profile':'voice-b'}};}
  };
  const pending=b.context.apiFetch('/api/tts',{method:'POST',body:'{}'});
  await ready;
  b.storage.set('vjbot_ai_method:alice','antigravity');
  b.storage.set('vjbot_ai_oauth:alice','oauth-chat');
  release();
  assert.equal((await pending).status,200);
  assert.equal(new Headers(requests[1].options.headers).get('X-VJBot-Profile'),'voice-b');
  assert.equal(new Headers(requests[1].options.headers).get('X-VJBot-Account'),'alice');
});

test('account rendering invalidates voice on owner or administrator-role changes, not routine renders', async () => {
  const b=browser(async()=>Response.json({user:{name:'Learner',user_id:'alice'}}));
  let changes=0;b.context.addEventListener('vjbot-voice-changed',()=>{changes++;});
  await b.context.setupAccount();
  assert.equal(changes,1);
  b.context.renderAccount();assert.equal(changes,1);
  vm.runInContext("signedInUser={user_id:'bob'};renderAccount()",b.context);
  assert.equal(changes,2);
  vm.runInContext("signedInUser.is_admin=true;renderAccount()",b.context);
  assert.equal(changes,3);
  b.context.renderAccount();assert.equal(changes,3);
  vm.runInContext("signedInUser.is_admin=false;renderAccount()",b.context);
  assert.equal(changes,4);
  vm.runInContext('signedInUser=null;renderAccount()',b.context);
  assert.equal(changes,5);
});

test('administrators send managed AI requests without reading private API, OAuth or voice storage',async()=>{
  const calls=[];
  const b=browser(async(path,options)=>{
    if(path.endsWith('/session'))return Response.json({user:{user_id:'alice',name:'Admin',is_admin:true}});
    calls.push({path,options});return Response.json({ok:true});
  });
  await b.context.setupAccount();
  b.storage.set('vjbot_ai_method:alice','antigravity');
  b.storage.set('vjbot_ai_oauth:alice','saved-private-oauth');
  const before=[...b.storage];
  b.context.localStorage.getItem=()=>{throw new Error('Managed AI must not read personal preferences');};
  b.context.VJProfiles={
    prepareRequest(){throw new Error('Managed AI must not read credentials');},
    voice(){throw new Error('Managed voice must not read saved voice');}
  };
  for(const path of ['/api/chat','/api/kaiwa/evaluate','/api/practice/coach','/api/tts','/api/stt','/api/ai/test']){
    const body=JSON.stringify({message:'こんにちは',text:'こんにちは'});
    assert.equal((await b.context.apiFetch(path,{method:'POST',body})).status,200);
    const sent=calls.at(-1),headers=new Headers(sent.options.headers);
    assert.equal(sent.options.body,body);
    assert.equal(headers.get('X-VJBot-Account'),'alice');
    assert.equal(headers.get('X-VJBot-Profile'),'platform_openai');
  }
  assert.equal(calls.length,6);assert.deepEqual([...b.storage],before);
});

test('a role change while private credentials load blocks the stale request before dispatch',async()=>{
  const calls=[];
  const b=browser(async(path,options)=>{
    if(path.endsWith('/session'))return Response.json({user:{user_id:'alice',name:'Learner'}});
    calls.push({path,options});return Response.json({});
  });
  await b.context.setupAccount();
  let release;
  b.context.VJProfiles={prepareRequest:()=>new Promise(resolve=>{release=resolve;})};
  const request=b.context.apiFetch('/api/chat',{method:'POST',body:JSON.stringify({message:'こんにちは'})});
  vm.runInContext('signedInUser.is_admin=true',b.context);
  release({method:'POST',body:JSON.stringify({api_connection:{api_key:'private-must-not-leave'}})});
  assert.equal((await request).status,409);
  assert.equal(calls.length,0);
});
