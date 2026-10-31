import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function browser(fetch){
  const elements=new Map(),storage=new Map();let reloads=0;
  const element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',open:false,events:{},addEventListener(name,fn){this.events[name]=fn;},replaceChildren(){},showModal(){this.open=true;},close(){this.open=false;}});
    return elements.get(id);
  };
  const configs=[],google={accounts:{id:{initialize(config){configs.push(config);},renderButton(){}}}};
  const context=vm.createContext({fetch,google,crypto,Response,Date,JSON,setTimeout,location:{reload(){reloads++;}},document:{getElementById:element},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
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
