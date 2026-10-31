let signedInUser=null,accountUnavailable=true,preparingSignIn=false;
const guestId=localStorage.getItem('vjbot_user_id') || crypto.randomUUID();
localStorage.setItem('vjbot_user_id',guestId);
const guestKey='vjbot_guest_progress';
function guestProgress() {try{return JSON.parse(localStorage.getItem(guestKey)||'{}');}catch{return {};}}
function progressSummary(items) {
  const list=Object.values(items);const correct=list.reduce((n,x)=>n+x.correct,0),incorrect=list.reduce((n,x)=>n+x.incorrect,0);
  const days=new Set(JSON.parse(localStorage.getItem('vjbot_study_days')||'[]'));
  let streak=0,date=new Date();
  if(!days.has(date.toISOString().slice(0,10))) date.setUTCDate(date.getUTCDate()-1);
  while(days.has(date.toISOString().slice(0,10))){streak++;date.setUTCDate(date.getUTCDate()-1);}
  return {items:list,total_learned:list.length,accuracy_rate:correct+incorrect?Math.round(correct/(correct+incorrect)*100):0,streak_days:streak,weak_spots:list.filter(x=>x.incorrect>x.correct)};
}
async function apiFetch(path,options={}) {
  if(signedInUser) {
    const response=await fetch(path,options);
    if(response.status===401){signedInUser=null;accountUnavailable=true;renderAccount();openAccount('Phiên đăng nhập đã hết hạn. Đăng nhập lại để lưu tiến độ.');}
    return response;
  }
  if(accountUnavailable){openAccount('Kết nối lại tài khoản trước khi lưu tiến độ.');return Response.json({detail:'Tài khoản chưa sẵn sàng.'},{status:503});}
  const route=path.split('?')[0], body=options.body?JSON.parse(options.body):{};
  if(route==='/api/profile') {
    if(options.method==='POST') localStorage.setItem('vjbot_guest_level',body.level);
    return Response.json({level:localStorage.getItem('vjbot_guest_level')||'N5',user_id:guestId});
  }
  if(route==='/api/progress') return Response.json(progressSummary(guestProgress()));
  if(route==='/api/progress/record') {
    const items=guestProgress(),old=items[body.item_id]||{correct:0,incorrect:0};
    if(body.attempt_id && (old.attempt_ids||[]).includes(body.attempt_id))return Response.json({status:'recorded'});
    items[body.item_id]={...old,...body,last_correct:body.correct?1:0,correct:old.correct+(body.correct?1:0),incorrect:old.incorrect+(body.correct?0:1),last_reviewed:new Date().toISOString(),next_review:new Date(Date.now()+(body.correct?86400000:60000)).toISOString()};
    if(body.attempt_id)items[body.item_id].attempt_ids=[...(old.attempt_ids||[]),body.attempt_id].slice(-100);
    localStorage.setItem(guestKey,JSON.stringify(items));
    const days=new Set(JSON.parse(localStorage.getItem('vjbot_study_days')||'[]'));days.add(new Date().toISOString().slice(0,10));localStorage.setItem('vjbot_study_days',JSON.stringify([...days].slice(-400)));
    return Response.json({status:'recorded'});
  }
  if(route==='/api/history') return Response.json([]);
  if(route==='/api/next-topic') return Response.json({display:'〜は〜です',meaning_vi:'A là B',level:localStorage.getItem('vjbot_guest_level')||'N5'});
  if(route==='/api/tts') return Response.json({fallback:true});
  if(route==='/api/account/delete') {for(const key of Object.keys(localStorage)) if(key.startsWith('vjbot_')) localStorage.removeItem(key);return Response.json({success:true});}
  openAccount();
  return Response.json({detail:'Đăng nhập Google để dùng Sensei.'},{status:401});
}
function renderAccount(){
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
    if(!config.client_id){status.textContent='Đăng nhập đang được cấu hình. Bạn vẫn có thể học ở chế độ khách.';return;}
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
    try{const response=await fetch('/api/auth/logout',{method:'POST'});if(!response.ok)throw new Error('logout');location.reload();}
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
