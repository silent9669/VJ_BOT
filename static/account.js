let signedInUser=null,accountUnavailable=true,preparingSignIn=false;
async function apiFetch(path,options={}) {
  if(signedInUser) {
    const response=await fetch(path,options);
    if(response.status===401){signedInUser=null;accountUnavailable=true;renderAccount();window.handleSessionExpired?.();openAccount('Phiên đăng nhập đã hết hạn. Đăng nhập lại để lưu tiến độ.');}
    return response;
  }
  if(accountUnavailable){openAccount('Kết nối lại tài khoản trước khi lưu tiến độ.');return Response.json({detail:'Tài khoản chưa sẵn sàng.'},{status:503});}
  openAccount('Đăng nhập Google để học và lưu tiến độ.');
  return Response.json({detail:'Cần đăng nhập Google.'},{status:401});
}

function renderAccount(){
  document.querySelectorAll?.('[data-enter]').forEach(b=>b.textContent=signedInUser?'Vào góc học tập ↗':'Đăng nhập Google ↗');
  document.getElementById('topbar-user-name').textContent=signedInUser?.name||'Đăng nhập';
  document.getElementById('auth-user').textContent=signedInUser?`Xin chào, ${signedInUser.name}`:'Đăng nhập Google';
  document.getElementById('google-signin').hidden=!!signedInUser;
  document.getElementById('auth-logout').hidden=!signedInUser;
}
async function openAccount(message=''){
  const dialog=document.getElementById('auth-dialog');
  if(dialog.open)return;
  dialog.showModal();
  document.getElementById('auth-status').textContent=typeof message==='string'?message:'';
  if(!signedInUser)await prepareGoogleSignIn();
}
async function prepareGoogleSignIn(){
  if(preparingSignIn)return;
  preparingSignIn=true;
  const status=document.getElementById('auth-status'),button=document.getElementById('google-signin');
  button.replaceChildren();
  try{
    const response=await fetch('/api/auth/config');
    if(!response.ok)throw new Error('config');
    const config=await response.json();
    if(!config.client_id){status.textContent='Đăng nhập đang được cấu hình. Vui lòng thử lại sau.';return;}
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
  }catch{status.textContent='Không tải được đăng nhập. Đóng và mở lại để thử lại.';}
  finally{preparingSignIn=false;}
}
async function setupAccount() {
  document.getElementById('btn-topbar-account').addEventListener('click',()=>openAccount());
  document.getElementById('auth-close').addEventListener('click',()=>document.getElementById('auth-dialog').close());
  const status=document.getElementById('auth-status');
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
