let signedInUser=null,accountUnavailable=true,preparingSignIn=false,localAdminAvailable=false;
let renderedAccountOwner=null,renderedAccountAdmin=false,voiceRevision=0;
window.addEventListener?.('vjbot-voice-changed',()=>{voiceRevision++;});
function usesAntigravityOAuth(owner) {
  if (!owner) return false;
  const key='vjbot_ai_method:'+owner, saved=localStorage.getItem(key);
  if(saved==='google'){localStorage.setItem(key,'antigravity');return true;}
  return saved==='antigravity';
}
function antigravityConnectionId(owner) {
  const value=owner&&localStorage.getItem('vjbot_ai_oauth:'+owner);
  return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)?value:null;
}
async function apiFetch(path,options={}) {
  if(signedInUser) {
    const owner=signedInUser.user_id;
    const inference=['/api/chat','/api/kaiwa/evaluate','/api/practice/coach','/api/tts','/api/stt','/api/ai/test'].includes(path)&&options.method?.toUpperCase()==='POST';
    const speech=inference&&path==='/api/tts', voice=speech||path==='/api/stt', revision=voiceRevision;
    const managed=inference&&signedInUser.is_admin===true;
    let oauth,connectionId,method,voiceChoice,prepared=options;
    if(managed) {
      const headers=new Headers(options.headers);
      headers.set('X-VJBot-Profile','platform_openai');
      prepared={...options,headers};
    } else {
      try {
        method=inference&&!voice?usesAntigravityOAuth(owner):false;
        oauth=Boolean(method);
        connectionId=oauth?antigravityConnectionId(owner):null;
        if(oauth&&!connectionId)return Response.json({detail:'Chọn kết nối Antigravity đã lưu trong Cài đặt.',code:'api_profile_unavailable'},{status:409});
      } catch { return Response.json({detail:'Không truy cập được nơi lưu lựa chọn kết nối. Khôi phục bộ nhớ trình duyệt trước khi dùng AI.',code:'api_profile_unavailable'},{status:409}); }
      if(inference&&!oauth&&!window.VJProfiles)return Response.json({detail:'Chức năng kết nối API chưa tải được. Tải lại trang trước khi dùng AI.',code:'api_profile_unavailable'},{status:503});
      if(speech) {
        try {
          const selected=VJProfiles.voice(owner);
          if(!selected||selected.scope==='none')throw new Error('No voice selected');
          voiceChoice=JSON.stringify(selected);
        } catch { return Response.json({detail:'Chọn tài khoản đọc thành tiếng khả dụng trong phần Âm thanh của Cài đặt.',code:'api_profile_unavailable'},{status:409}); }
      }
      try {
        if(oauth) {
          const headers=new Headers(options.headers);
          headers.set('X-VJBot-Profile','antigravity_oauth:'+connectionId);
          prepared={...options,headers};
        } else if(window.VJProfiles)prepared=await VJProfiles.prepareRequest(path,options,owner);
      } catch { return Response.json({detail:'Kết nối API đã chọn không khả dụng. Mở Cài đặt để chọn lại hoặc sửa kết nối.',code:'api_profile_unavailable'},{status:409}); }
      try {
        if(speech&&(revision!==voiceRevision||voiceChoice!==JSON.stringify(VJProfiles.voice(owner))))
          return Response.json({detail:'Kết nối đọc thành tiếng đã thay đổi. Bấm Nghe lại.',code:'api_profile_unavailable'},{status:409});
        if(inference&&!voice&&(usesAntigravityOAuth(owner)!==method||(oauth&&antigravityConnectionId(owner)!==connectionId)))
          return Response.json({detail:'Kết nối AI đã chọn đã thay đổi. Hãy gửi lại yêu cầu.',code:'api_profile_unavailable'},{status:409});
      } catch { return Response.json({detail:'Không truy cập được nơi lưu lựa chọn kết nối.',code:'api_profile_unavailable'},{status:409}); }
    }
    if(signedInUser?.user_id!==owner)return Response.json({detail:'Tài khoản đăng nhập đã thay đổi.'},{status:401});
    if(inference&&(signedInUser.is_admin===true)!==managed)
      return Response.json({detail:'Quyền truy cập AI đã thay đổi. Hãy gửi lại yêu cầu.',code:'api_profile_unavailable'},{status:409});
    const headers=new Headers(prepared.headers);
    headers.set('X-VJBot-Account',owner);
    const response=await fetch(path,{...prepared,headers}).catch(error=>{
      if(error.name==='TypeError')throw Object.assign(new Error('Không kết nối được với máy chủ. Kiểm tra mạng rồi thử lại; yêu cầu không được tự động gửi lại.'),{userFacing:true});
      throw error;
    });
    if(response.status===401){signedInUser=null;accountUnavailable=true;renderAccount();window.handleSessionExpired?.();openAccount('Phiên đăng nhập đã hết hạn. Đăng nhập lại để lưu tiến độ.');}
    return response;
  }
  if(accountUnavailable){openAccount('Kết nối lại tài khoản trước khi lưu tiến độ.');return Response.json({detail:'Tài khoản chưa sẵn sàng.'},{status:503});}
  openAccount('Đăng nhập để học và lưu tiến độ.');
  return Response.json({detail:'Cần đăng nhập.'},{status:401});
}

function renderAccount(){
  const owner=signedInUser?.user_id||null,admin=signedInUser?.is_admin===true;
  if(owner!==renderedAccountOwner||admin!==renderedAccountAdmin){renderedAccountOwner=owner;renderedAccountAdmin=admin;window.dispatchEvent?.(new Event('vjbot-voice-changed'));}
  document.querySelectorAll?.('[data-enter=dashboard]').forEach(b=>b.textContent=signedInUser?'Vào học ↗':'Đăng nhập');
  const initial = document.getElementById('topbar-user-initial');
  if (initial) initial.textContent = (signedInUser?.name || '?').trim().charAt(0).toUpperCase();
  document.getElementById('topbar-user-name').textContent=signedInUser?.name||'Đăng nhập';
  document.getElementById('auth-user').textContent=signedInUser?signedInUser.name:'Đăng nhập';
  document.getElementById('auth-methods').hidden=!!signedInUser;
  document.getElementById('google-signin').hidden=!!signedInUser;
  document.getElementById('auth-logout').hidden=!signedInUser;
  document.getElementById('tab-btn-admin').hidden=!signedInUser?.is_admin;
  for(const [id,value] of [['sidebar-account-name',signedInUser?.name || 'Đăng nhập'],['sidebar-account-role',signedInUser?.is_admin?'Quản trị viên':'Học viên'],['sidebar-account-initial',(signedInUser?.name || '?').charAt(0).toUpperCase()]]){const node=document.getElementById(id);if(node)node.textContent=value;}
  const adminNav=document.getElementById('settings-admin-nav');
  const voice=document.getElementById('btn-voice-input');if(voice)voice.hidden=!signedInUser?.is_admin;
  if(adminNav)adminNav.hidden=!signedInUser?.is_admin;
  globalThis.checkLiveAccount?.();
}
async function openAccount(message=''){
  const dialog=document.getElementById('auth-dialog');
  if(dialog.open)return;
  setAuthMode(false);
  dialog.showModal();
  if(!signedInUser)document.getElementById('auth-email').focus();
  document.getElementById('auth-status').textContent=typeof message==='string'?message:'';
  if(!signedInUser)await prepareGoogleSignIn();
}
async function prepareGoogleSignIn(){
  if(preparingSignIn)return;
  preparingSignIn=true;
  const status=document.getElementById('google-status'),button=document.getElementById('google-signin');
  button.replaceChildren();
  try{
    const response=await fetch('/api/auth/config');
    if(!response.ok)throw new Error('config');
    const config=await response.json();
    localAdminAvailable=config.local_admin===true;
    configureLoginFields();
    if(!config.client_id){status.textContent='Google chưa được cấu hình. Bạn có thể dùng email.';return;}
    for(let i=0;i<40 && !window.google?.accounts?.id;i++)await new Promise(r=>setTimeout(r,100));
    if(!window.google?.accounts?.id)throw new Error('google');
    google.accounts.id.initialize({client_id:config.client_id,nonce:config.nonce,callback:async({credential})=>{
      status.textContent='Đang đăng nhập…';
      try{
        const response=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential})});
        const data=await response.json();
        if(!response.ok){status.textContent=data.detail || 'Không đăng nhập được. Hãy thử lại.';await prepareGoogleSignIn();return;}
        location.reload();
      }catch{status.textContent='Không kết nối được. Đóng và mở lại đăng nhập để thử lại.';}
    }});
    google.accounts.id.renderButton(button,{theme:'outline',size:'large',text:'signin_with',shape:'rectangular'});
  }catch{status.textContent='Google chưa kết nối được. Bạn có thể dùng email.';}
  finally{preparingSignIn=false;}
}
let registering=false;
function configureLoginFields() {
  const local=localAdminAvailable && !registering;
  document.getElementById('auth-email').type=local?'text':'email';
  document.getElementById('auth-password').minLength=local?1:12;
  const label=document.getElementById('auth-identity-label');if(label)label.textContent=local?'Email hoặc tài khoản quản trị cục bộ':'Email';
}
function setAuthMode(register) {
  registering=register;
  configureLoginFields();
  document.getElementById('auth-user').textContent=signedInUser?signedInUser.name:register?'Tạo tài khoản':'Đăng nhập';
  document.getElementById('auth-name-label').hidden=!register;
  document.getElementById('auth-name').required=register;
  document.getElementById('auth-password').autocomplete=register?'new-password':'current-password';
  document.getElementById('auth-password-hint').hidden=!register;
  document.getElementById('auth-meter').hidden=!register;
  document.getElementById('auth-login-tab').setAttribute('aria-pressed',String(!register));
  document.getElementById('auth-register-tab').setAttribute('aria-pressed',String(register));
  document.getElementById('auth-submit').textContent=register?'Tạo tài khoản':'Đăng nhập';
  document.getElementById('auth-status').textContent='';
  document.getElementById(register?'auth-name':'auth-email').focus();
}
async function setupAccount() {
  document.getElementById('btn-topbar-account').addEventListener('click',()=>openAccount());
  document.getElementById('sidebar-account')?.addEventListener('click',()=>{window.closeAppSidebar?.();openAccount();});
  document.getElementById('auth-close').addEventListener('click',()=>document.getElementById('auth-dialog').close());
  const dialog=document.getElementById('auth-dialog'),password=document.getElementById('auth-password'),toggle=document.getElementById('auth-password-toggle'),meter=document.getElementById('auth-meter');
  password.addEventListener('input',()=>{
    const filled=Math.min(1,password.value.length/12);
    meter.firstElementChild.style.width=filled*100+'%';meter.dataset.ok=String(password.value.length>=12);
  });
  for(const field of document.querySelectorAll?.('#auth-form input')||[]){
    field.addEventListener('invalid',()=>field.setAttribute('aria-invalid','true'));
    field.addEventListener('input',()=>field.removeAttribute('aria-invalid'));
  }
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  toggle.onclick=()=>{const show=password.type==='password';password.type=show?'text':'password';toggle.textContent=show?'Ẩn':'Hiện';toggle.setAttribute('aria-pressed',String(show));toggle.setAttribute('aria-label',show?'Ẩn mật khẩu':'Hiện mật khẩu');};
  document.querySelectorAll?.('[data-level]').forEach(button=>button.onclick=()=>{
    const route='#curriculum/'+button.dataset.level;
    if(signedInUser){location.hash=route;return;}
    sessionStorage.setItem('vjbot_return_route',route);openAccount();setAuthMode(true);
  });
  const status=document.getElementById('auth-status');
  document.getElementById('auth-login-tab').onclick=()=>setAuthMode(false);
  document.getElementById('auth-register-tab').onclick=()=>setAuthMode(true);
  document.querySelectorAll?.('[data-register]').forEach(button=>button.onclick=()=>{openAccount();setAuthMode(true);});
  document.getElementById('auth-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const submit=document.getElementById('auth-submit');if(submit.disabled)return;
    const register=registering;submit.disabled=true;
    status.textContent=register?'Đang tạo tài khoản…':'Đang đăng nhập…';
    try {
      const response=await fetch(register?'/api/auth/register':'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('auth-name').value,email:document.getElementById('auth-email').value,password:document.getElementById('auth-password').value})});
      const data=await response.json();
      if(!response.ok){status.textContent=data.detail || 'Không đăng nhập được.';return;}
      if(!sessionStorage.getItem('vjbot_return_route'))sessionStorage.setItem('vjbot_return_route','#dashboard');
      location.reload();
    }catch{status.textContent='Không kết nối được. Hãy thử lại.';}
    finally{submit.disabled=false;}
  });
  document.getElementById('auth-logout').addEventListener('click',async()=>{
    try{const response=await fetch('/api/auth/logout',{method:'POST'});if(!response.ok)throw new Error('logout');signedInUser=null;renderAccount();sessionStorage.removeItem('vjbot_return_route');location.hash='#landing';location.reload();}
    catch{status.textContent='Chưa đăng xuất được. Hãy thử lại.';}
  });
  try{
    const response=await fetch('/api/auth/session');
    if(!response.ok)throw new Error('session');
    const session=await response.json();signedInUser=session.user;accountUnavailable=false;renderAccount();
    window.dispatchEvent?.(new Event('vjbot-account-ready'));
  }catch{await openAccount('Không kiểm tra được tài khoản. Tải lại trang hoặc đăng nhập lại.');}
}
window.apiFetch=apiFetch;
window.setupAccount=setupAccount;
