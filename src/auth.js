import { createRemoteJWKSet, jwtVerify } from 'jose';
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
export async function authRoute(request,env) {
  const path=new URL(request.url).pathname;
  if (path==='/api/auth/config' && request.method==='GET') {
    const nonce=randomToken();
    return json({client_id:env.GOOGLE_CLIENT_ID || '',nonce},200,{'Set-Cookie':cookie('vj_nonce',nonce,600,request)});
  }
  if (path==='/api/auth/session' && request.method==='GET') return json({user:await sessionUser(request,env)});
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
    const token=randomToken();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
      env.DB.prepare('INSERT INTO sessions(token_hash,user_id,name,expires_at) VALUES(?,?,?,?)').bind(await hashToken(token),userId,name,Date.now()+7*86400000),
      env.DB.prepare("INSERT OR IGNORE INTO profiles(user_id,level,track,updated_at) VALUES(?,'N5','openjlpt',?)").bind(userId,new Date().toISOString())
    ]);
    const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
    headers.append('Set-Cookie',cookie('vj_session',token,7*86400,request));
    headers.append('Set-Cookie',cookie('vj_nonce','',0,request));
    return new Response(JSON.stringify({user:{user_id:userId,name}}),{headers});
  }
  return json({detail:'Not found'},404);
}
