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
  const context=vm.createContext({fetch,google,crypto,Response,Headers,Date,JSON,setTimeout,location:{reload(){reloads++;}},document:{getElementById:element},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
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
  b.context.VJProfiles={prepareRequest:async(_path,options)=>({...options,headers:{'X-VJBot-Profile':'server:voice-profile'}})};
  await b.context.apiFetch('/api/chat',{method:'POST',body:'{}'});
  await b.context.apiFetch('/api/kaiwa/evaluate',{method:'POST',body:'{}'});
  await b.context.apiFetch('/api/tts',{method:'POST',body:'{}'});
  await b.context.apiFetch('/api/stt',{method:'POST',body:'{}'});
  assert.equal(new Headers(requests[1].options.headers).get('X-VJBot-Profile'),'antigravity_oauth:opaque-first');
  assert.equal(new Headers(requests[2].options.headers).get('X-VJBot-Profile'),'antigravity_oauth:opaque-first');
  assert.equal(new Headers(requests[3].options.headers).get('X-VJBot-Profile'),'server:voice-profile');
  assert.equal(new Headers(requests[4].options.headers).get('X-VJBot-Profile'),'server:voice-profile');
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
