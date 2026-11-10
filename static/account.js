let signedInUser=null,accountUnavailable=true,preparingSignIn=false;
async function apiFetch(path,options={}) {
  if(signedInUser) {
    const response=await fetch(path,options);
    if(response.status===401){signedInUser=null;accountUnavailable=true;renderAccount();window.handleSessionExpired?.();openAccount('Phiên đăng nhập đã hết hạn. Đăng nhập lại để lưu tiến độ.');}
    return response;
  }
  if(accountUnavailable){openAccount('Kết nối lại tài khoản trước khi lưu tiến độ.');return Response.json({detail:'Tài khoản chưa sẵn sàng.'},{status:503});}
  openAccount('Đăng nhập để học và lưu tiến độ.');
  return Response.json({detail:'Cần đăng nhập.'},{status:401});
}

function renderAccount(){
  document.querySelectorAll?.('[data-enter=dashboard]').forEach(b=>b.textContent=signedInUser?'Vào học ↗':'Đăng nhập');
  document.getElementById('topbar-user-name').textContent=signedInUser?.name||'Đăng nhập';
  document.getElementById('auth-user').textContent=signedInUser?signedInUser.name:'Đăng nhập';
  document.getElementById('auth-methods').hidden=!!signedInUser;
  document.getElementById('google-signin').hidden=!!signedInUser;
  document.getElementById('auth-logout').hidden=!signedInUser;
  document.getElementById('tab-btn-admin').hidden=!signedInUser?.is_admin;
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
function setAuthMode(register) {
  registering=register;
  document.getElementById('auth-user').textContent=signedInUser?signedInUser.name:register?'Tạo tài khoản':'Đăng nhập';
  document.getElementById('auth-name-label').hidden=!register;
  document.getElementById('auth-name').required=register;
  document.getElementById('auth-password').autocomplete=register?'new-password':'current-password';
  document.getElementById('auth-password-hint').hidden=!register;
  document.getElementById('auth-login-tab').setAttribute('aria-pressed',String(!register));
  document.getElementById('auth-register-tab').setAttribute('aria-pressed',String(register));
  document.getElementById('auth-submit').textContent=register?'Tạo tài khoản':'Đăng nhập';
  document.getElementById('auth-status').textContent='';
  document.getElementById(register?'auth-name':'auth-email').focus();
}
async function setupAccount() {
  document.getElementById('btn-topbar-account').addEventListener('click',()=>openAccount());
  document.getElementById('auth-close').addEventListener('click',()=>document.getElementById('auth-dialog').close());
  const dialog=document.getElementById('auth-dialog'),password=document.getElementById('auth-password'),toggle=document.getElementById('auth-password-toggle');
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
    try{const response=await fetch('/api/auth/logout',{method:'POST'});if(!response.ok)throw new Error('logout');sessionStorage.removeItem('vjbot_return_route');location.hash='#landing';location.reload();}
    catch{status.textContent='Chưa đăng xuất được. Hãy thử lại.';}
  });
  try{
    const response=await fetch('/api/auth/session');
    if(!response.ok)throw new Error('session');
    const session=await response.json();signedInUser=session.user;accountUnavailable=false;renderAccount();
  }catch{await openAccount('Không kiểm tra được tài khoản. Tải lại trang hoặc đăng nhập lại.');}
}
window.apiFetch=apiFetch;
window.setupAccount=setupAccount;
