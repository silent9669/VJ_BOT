import { scryptAsync } from '@noble/hashes/scrypt.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { isAdmin, recordAdminLogin } from './admin.js';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const cookieValue = (request, name) => (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join('');
export async function hashToken(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))), n => n.toString(16).padStart(2,'0')).join('');
}
function cookie(name,value,age,request) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function json(data,status=200,headers={}) { return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}}); }
export async function sessionUser(request,env) {
  const token=cookieValue(request,'vj_session');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare('SELECT user_id, name FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await hashToken(token),Date.now()).first();
}
// 16 MiB scrypt workspace, with five passes; parameters are fixed for this schema.
async function passwordHash(password,salt) {
  const bytes=await scryptAsync(password,salt,{N:16384,r:8,p:5,dkLen:32});
  return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
}
function equalHash(a,b) {
  let different=a.length^b.length;
  for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
async function createSession(request,env,userId,name,email=null) {
  const token=randomToken();
  const previous=cookieValue(request,'vj_session');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ? OR token_hash = ?').bind(Date.now(),previous?await hashToken(previous):''),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,name,expires_at) VALUES(?,?,?,?)').bind(await hashToken(token),userId,name,Date.now()+7*86400000),
    env.DB.prepare("INSERT OR IGNORE INTO profiles(user_id,level,track,updated_at) VALUES(?,'N5','openjlpt',?)").bind(userId,new Date().toISOString()),
    env.DB.prepare("UPDATE profiles SET name=?,email=?,last_login=?,created_at=COALESCE(created_at,?) WHERE user_id=?").bind(name,email,new Date().toISOString(),new Date().toISOString(),userId)
  ]);
  const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
  headers.append('Set-Cookie',cookie('vj_session',token,7*86400,request));
  headers.append('Set-Cookie',cookie('vj_nonce','',0,request));
  return new Response(JSON.stringify({user:{user_id:userId,name}}),{headers});
}
async function passwordRoute(request,env,register) {
  const raw=await request.text();
  if(raw.length>2048)return json({detail:'Nội dung quá dài.'},413);
  let body;try{body=JSON.parse(raw);}catch{return json({detail:'Dữ liệu không hợp lệ.'},400);}
  const email=typeof body?.email==='string'?body.email.trim().toLowerCase():'';
  const password=body?.password;
  const name=typeof body?.name==='string'?body.name.trim():'';
  if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password!=='string' || password.length<12 || password.length>128 || (register && (!name || name.length>80))) {
    return json({detail:'Nhập email hợp lệ, mật khẩu 12–128 ký tự và tên tối đa 80 ký tự.'},400);
  }
  const bucket=Math.floor(Date.now()/900000);
  const ip=request.headers.get('CF-Connecting-IP') || 'local';
  const keys=await Promise.all(['ip:'+ip,'login:'+ip+':'+email].map(hashToken));
  const attempts=await Promise.all(keys.map(key=>env.DB.prepare('INSERT INTO auth_attempts(key,bucket,count) VALUES(?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(key,bucket).first()));
  await env.DB.prepare('DELETE FROM auth_attempts WHERE bucket < ?').bind(bucket-1).run();
  if(attempts[0].count>100 || attempts[1].count>10)return json({detail:'Quá nhiều lần thử. Vui lòng đợi 15 phút.'},429,{'Retry-After':'900'});
  const account=await env.DB.prepare('SELECT * FROM password_accounts WHERE email=?').bind(email).first();
  // Missing accounts still perform the same expensive hash to avoid a timing oracle.
  const salt=account?.salt || (register?randomToken():'0'.repeat(64));
  const hash=await passwordHash(password,salt);
  if(register) {
    if(account)return json({detail:'Không thể tạo tài khoản với email này. Hãy đăng nhập hoặc dùng email khác.'},409);
    const userId='email:'+crypto.randomUUID();
    // A concurrent registration must never overwrite the existing credential.
    await env.DB.prepare('INSERT OR IGNORE INTO password_accounts(user_id,email,name,password_hash,salt,created_at) VALUES(?,?,?,?,?,?)').bind(userId,email,name,hash,salt,new Date().toISOString()).run();
    const owner=await env.DB.prepare('SELECT user_id FROM password_accounts WHERE email=?').bind(email).first();
    if(owner?.user_id!==userId)return json({detail:'Không thể tạo tài khoản với email này.'},409);
    return createSession(request,env,userId,name,email);
  }
  if(!account || !equalHash(hash,account.password_hash))return json({detail:'Email hoặc mật khẩu không đúng.'},401);
  return createSession(request,env,account.user_id,account.name,email);
}
export async function authRoute(request,env) {
  const path=new URL(request.url).pathname;
  if(['/api/auth/register','/api/auth/login'].includes(path) && request.method==='POST')return passwordRoute(request,env,path.endsWith('/register'));
  if (path==='/api/auth/config' && request.method==='GET') {
    const nonce=randomToken();
    return json({client_id:env.GOOGLE_CLIENT_ID || '',nonce},200,{'Set-Cookie':cookie('vj_nonce',nonce,600,request)});
  }
  if (path==='/api/auth/session' && request.method==='GET') {
    const user=await sessionUser(request,env);
    // A Google account must have its name and verified email on file; older sessions predate that, so sign in again once.
    if(user?.user_id.startsWith('google:') && !(await env.DB.prepare('SELECT email FROM profiles WHERE user_id=?').bind(user.user_id).first())?.email) {
      await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.user_id).run();
      return json({user:null},200,{'Set-Cookie':cookie('vj_session','',0,request)});
    }
    const email=user && (await env.DB.prepare('SELECT email FROM profiles WHERE user_id=?').bind(user.user_id).first())?.email;
    return json({user:user && {...user,email:email||null,is_admin:await isAdmin(env,user.user_id)}});
  }
  if (path==='/api/auth/logout' && request.method==='POST') {
    const token=cookieValue(request,'vj_session');
    if(token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
    return json({ok:true},200,{'Set-Cookie':cookie('vj_session','',0,request)});
  }
  if(path==='/api/auth/google' && request.method==='POST') {
    if(!env.GOOGLE_CLIENT_ID) return json({detail:'Google sign-in chưa được cấu hình.'},503);
    const raw=await request.text();
    if(raw.length>12000)return json({detail:'Credential too large'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({detail:'Invalid JSON'},400);}
    const credential=body?.credential;
    if(typeof credential!=='string' || credential.length>10000) return json({detail:'Invalid credential'},400);
    let payload;
    try {
      ({payload}=await jwtVerify(credential,googleKeys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256']}));
      const nonce=cookieValue(request,'vj_nonce');
      if(!nonce || payload.nonce!==nonce || !payload.sub || payload.email_verified!==true) throw new Error('Invalid claims');
    } catch { return json({detail:'Không xác thực được Google. Vui lòng thử lại.'},401); }
    const userId='google:'+payload.sub;
    const name=typeof payload.name==='string' ? payload.name.slice(0,100) : 'Học viên';
    await recordAdminLogin(env,userId,payload.email);
    return createSession(request,env,userId,name,payload.email.toLowerCase());
  }
  return json({detail:'Not found'},404);
}
