import {hashToken, sessionUser} from './auth.js';
import {seal} from './ai-secrets.js';
import {probeModel} from './llm.js';
import {rateLimited} from './ai-usage.js';
import {accountCatalog, accountUsage, activateConnection, cancelPending, connectionFor, connectionIdOk, connectionsFor,
  disconnectAntigravity, gatewayConfiguration, gatewayRequest, modelIdOk, oauthError, pendingFor, pendingPayload, requireStrictRouting, stateOwner} from './antigravity-gateway.js';

const ROOT = '/api/ai/oauth/antigravity';
const json = (value, status = 200) => Response.json(value, {status, headers:{'Cache-Control':'no-store'}});
const sessionHash = request => hashToken((request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('vj_session='))?.slice(11) || '');
const clearPending = (env, pending) => env.DB.prepare('DELETE FROM ai_antigravity_oauth_states WHERE handle=?').bind(pending.handle).run();
const publicConnection = row => ({connected:!!row, model:row?.state === 'active' ? row.model : '', state:row?.state || 'disconnected'});
const savedConnection = row => ({id:row.login_id, name:row.name, model:row.model, state:row.state});
const requiredId = id => {
  if (!connectionIdOk(id)) throw oauthError('Hãy chọn một kết nối Antigravity đã lưu.', 400);
  return id;
};
async function ownedConnection(env, owner, id) {
  const row = await connectionFor(env, owner, requiredId(id));
  if (!row) throw oauthError('Kết nối Antigravity này không khả dụng.', 404);
  return row;
}

async function readBody(request) {
  const reader = request.body?.getReader(), decoder = new TextDecoder();
  let raw = '', size = 0;
  if (reader) {
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) throw oauthError('Yêu cầu OAuth quá lớn.', 413);
        raw += decoder.decode(value, {stream:true});
      }
      raw += decoder.decode();
    } finally { await reader.cancel(); }
  }
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw oauthError('Yêu cầu OAuth không hợp lệ.', 400); }
}

function authorization(value) {
  try {
    const url = new URL(value.url), redirect = new URL(url.searchParams.get('redirect_uri'));
    if (value.status !== 'ok' || url.origin !== 'https://accounts.google.com' || !['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname)
      || typeof value.state !== 'string' || !/^[\w-]{16,256}$/.test(value.state) || url.searchParams.get('state') !== value.state
      || redirect.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(redirect.hostname) || !redirect.port
      || redirect.pathname !== '/oauth-callback' || redirect.username || redirect.password || redirect.search || redirect.hash) throw new Error();
    const selectedUrl = new URL(url.href);
    selectedUrl.searchParams.set('prompt', 'consent select_account');
    return {state:value.state, authorization_url:selectedUrl.href, redirect_uri:redirect.href};
  } catch { throw oauthError('Cổng kết nối không trả về địa chỉ cấp quyền Antigravity hợp lệ.', 503); }
}

async function start(request, env, owner, config, data) {
  const count = await env.DB.prepare('SELECT count(*) n FROM ai_antigravity_connections WHERE user_id=?').bind(owner).first();
  if (count.n >= 20) throw oauthError('Bạn có thể lưu tối đa 20 tài khoản Antigravity.');
  const name = data.name === undefined ? 'Tài khoản Antigravity ' + (count.n + 1) : data.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw oauthError('Hãy đặt tên tài khoản từ 1 đến 80 ký tự.', 400);
  const existing = (await env.DB.prepare('SELECT * FROM ai_antigravity_oauth_states').all()).results;
  for (const pending of existing) {
    const linked = await connectionFor(env, pending.user_id, pending.handle);
    if (linked?.state === 'active') { await clearPending(env, pending); continue; }
    if (pending.expires_at > Date.now()) throw oauthError('Đang có một lượt đăng nhập Antigravity chờ xử lý. Hãy hoàn tất hoặc hủy trước khi bắt đầu lượt khác.');
    await cancelPending(env, pending);
  }
  await requireStrictRouting(env);
  const handle = crypto.randomUUID(), expires = Date.now() + 300000;
  const reserved = await env.DB.prepare('INSERT OR IGNORE INTO ai_antigravity_oauth_states(handle,user_id,session_hash,expires_at,slot) VALUES(?,?,?,?,1) RETURNING handle')
    .bind(handle, owner, await sessionHash(request), expires).first();
  if (!reserved) throw oauthError('Một lượt đăng nhập Antigravity khác đã bắt đầu. Hãy thử lại sau khi lượt đó kết thúc.');
  try {
    const payload = {...authorization(await gatewayRequest(env, '/oauth/auth-url?provider=antigravity&is_webui=true')), gateway_url:config.baseUrl, name:name.trim()};
    const encrypted = await seal(env, stateOwner(owner), JSON.stringify(payload));
    const saved = await env.DB.prepare('UPDATE ai_antigravity_oauth_states SET state_enc=? WHERE handle=? RETURNING handle').bind(encrypted, handle).first();
    if (!saved) throw oauthError('Kết nối VJBot đã thay đổi trước khi bắt đầu đăng nhập.');
    return json({handle, authorization_url:payload.authorization_url, expires_at:expires});
  } catch (error) {
    const pending = await pendingFor(env, owner);
    if (pending?.handle === handle && !pending.state_enc) await clearPending(env, pending);
    throw error;
  }
}

async function ownedPending(request, env, owner, handle) {
  requiredId(handle);
  const pending = await pendingFor(env, owner);
  if (!pending || pending.handle !== handle || pending.session_hash !== await sessionHash(request)) throw oauthError('Lượt đăng nhập này không thuộc phiên VJBot hiện tại.', 400);
  if (pending.expires_at <= Date.now()) { await cancelPending(env, pending); throw oauthError('Lượt đăng nhập đã hết hạn. Hãy kết nối lại Antigravity.'); }
  return pending;
}

async function finish(request, env, owner, handle, config) {
  requiredId(handle);
  const current = await connectionFor(env, owner, handle);
  if (current?.state === 'active') return json({...publicConnection(current), connection_id:current.login_id, status:'ok'});
  if (current?.state === 'disconnecting') throw oauthError('Tài khoản đang ngắt kết nối. Hãy hoàn tất việc gỡ trước khi bắt đầu lượt đăng nhập khác.');
  const pending = await ownedPending(request, env, owner, handle), payload = await pendingPayload(env, pending);
  const result = await gatewayRequest(env, '/oauth/status?state=' + encodeURIComponent(payload.state));
  if (result.status === 'wait') return json({status:'wait'});
  if (result.status === 'ok' && result.saved === true && result.adopted === false && !result.requires_sign_in
    && typeof result.auth_id === 'string' && result.auth_id.length > 0 && result.auth_id.length <= 512) return json({status:'wait'});
  if (result.status !== 'ok' || result.saved !== true || result.adopted !== true || result.requires_sign_in
    || typeof result.auth_id !== 'string' || !result.auth_id || result.auth_id.length > 512) {
    await clearPending(env, pending);
    throw oauthError('Đăng nhập Antigravity chưa tạo được tài khoản hoạt động. Hãy bắt đầu lại và xem kỹ các quyền Google.');
  }
  const bound = await env.DB.prepare('SELECT * FROM ai_antigravity_connections WHERE auth_id=?').bind(result.auth_id).first();
  if (bound && bound.user_id !== owner) {
    await clearPending(env, pending);
    throw oauthError('Tài khoản Google này đã được liên kết với một tài khoản VJBot khác.');
  }
  if (bound?.state === 'disconnecting') throw oauthError('Hãy hoàn tất việc gỡ tài khoản này trước khi kết nối lại.');
  const id = bound?.login_id || handle, prefix = bound?.prefix || 'vjbot-' + handle.replaceAll('-', '');
  if (!bound) {
    const saved = await env.DB.prepare(`INSERT OR IGNORE INTO ai_antigravity_connections(user_id,auth_id,gateway_url,prefix,login_id,state,updated_at,name)
      SELECT user_id,?,?,?,?, 'binding',?,? FROM ai_antigravity_oauth_states WHERE handle=? AND session_hash=? AND expires_at>?
      AND (SELECT count(*) FROM ai_antigravity_connections WHERE user_id=?)<20 RETURNING login_id`)
      .bind(result.auth_id, config.baseUrl, prefix, handle, Date.now(), payload.name || 'Tài khoản Antigravity', handle, await sessionHash(request), Date.now(), owner).first();
    const row = await connectionFor(env, owner, id);
    if (!saved && (row?.auth_id !== result.auth_id || row?.state !== 'binding')) throw oauthError('Kết nối Antigravity đã thay đổi trong lúc đăng nhập.');
  } else {
    if (bound.gateway_url !== config.baseUrl) throw oauthError('Hãy khôi phục cổng kết nối ban đầu trước khi kết nối lại tài khoản này.', 503);
    const reserved = await env.DB.prepare("UPDATE ai_antigravity_connections SET state='binding',updated_at=max(updated_at+1,?) WHERE user_id=? AND login_id=? AND state IN ('binding','active') RETURNING login_id")
      .bind(Date.now(), owner, id).first();
    if (!reserved) throw oauthError('Kết nối Antigravity đã thay đổi trong lúc đăng nhập.');
  }
  await requireStrictRouting(env);
  const patched = await gatewayRequest(env, '/credentials/fields', {method:'PATCH', body:{name:result.auth_id, prefix, request_retry:0}});
  if (patched?.status !== 'ok') throw oauthError('Cổng kết nối chưa xác nhận việc tách riêng tài khoản. Hãy làm mới để hoàn tất đăng nhập.', 503);
  const activated = await env.DB.prepare("UPDATE ai_antigravity_connections SET state='active',updated_at=max(updated_at+1,?) WHERE user_id=? AND login_id=? AND auth_id=? AND state='binding' RETURNING login_id")
    .bind(Date.now(), owner, id, result.auth_id).first();
  if (!activated || !await activateConnection(env, owner, id)) throw oauthError('Kết nối Antigravity đã bị gỡ trong lúc đăng nhập.');
  await clearPending(env, pending);
  const row = await connectionFor(env, owner, id);
  return json({...publicConnection(row), connection_id:id, status:'ok'});
}

async function manualCallback(request, env, owner, data) {
  const pending = await ownedPending(request, env, owner, data.handle), payload = await pendingPayload(env, pending);
  let callback;
  try {
    callback = new URL(data.redirect_url);
    const expected = new URL(payload.redirect_uri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.username || callback.password || callback.hash
      || callback.searchParams.get('state') !== payload.state || !(callback.searchParams.get('code') || callback.searchParams.get('error'))) throw new Error();
  } catch { throw oauthError('Hãy dán chính xác URL chuyển hướng trả về của lượt đăng nhập Antigravity này.', 400); }
  await gatewayRequest(env, '/oauth/callback', {method:'POST', body:{provider:'antigravity', redirect_url:callback.href}});
  return json({status:'wait'});
}

async function selectModel(env, owner, data) {
  if (!modelIdOk(data.model)) throw oauthError('Hãy chọn mô hình trò chuyện bằng văn bản.', 400);
  const row = await ownedConnection(env, owner, data.connection_id), models = await accountCatalog(env, row);
  if (!models.includes(data.model)) throw oauthError('Mô hình này không có trong danh sách của tài khoản Antigravity hiện tại.');
  if (await rateLimited(env, owner)) throw oauthError('Quá nhiều yêu cầu AI. Hãy thử lại sau một phút.', 429);
  const config = gatewayConfiguration(env);
  const result = await probeModel({protocol:'openai', baseUrl:config.baseUrl + '/v1', apiKey:config.apiKey, models:[row.prefix + '/' + data.model]});
  if (!result.text) throw oauthError('Mô hình Antigravity đã chọn không trả về văn bản. Hãy kiểm tra quyền truy cập và hạn mức.', result.status === 429 ? 429 : 503, 'oauth_model_unverified');
  const saved = await env.DB.prepare("UPDATE ai_antigravity_connections SET model=?,updated_at=max(updated_at+1,?) WHERE user_id=? AND login_id=? AND prefix=? AND model=? AND updated_at=? AND state='active' RETURNING login_id")
    .bind(data.model, Date.now(), owner, row.login_id, row.prefix, row.model, row.updated_at).first();
  if (!saved) throw oauthError('Kết nối Antigravity đã thay đổi. Hãy làm mới trước khi kiểm tra lại.');
  return json({connection_id:row.login_id, model:data.model, verified:true});
}

export async function antigravityOAuthRoute(request, env) {
  const url = new URL(request.url), path = url.pathname, user = await sessionUser(request, env);
  if (!user) return json({detail:'Hãy đăng nhập VJBot trước khi kết nối Antigravity.'}, 401);
  const expected = request.headers.get('X-VJBot-Account');
  if (expected !== null && expected !== user.user_id) return json({detail:'Tài khoản đăng nhập đã thay đổi.'}, 409);
  if (!['GET','HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) return json({detail:'Nguồn gửi yêu cầu không được phép.'}, 403);
  const config = gatewayConfiguration(env), owner = user.user_id;
  try {
    if (path === ROOT && request.method === 'GET') {
      const row = await connectionFor(env, owner), pending = await pendingFor(env, owner), rows = await connectionsFor(env, owner);
      const ownPending = pending?.state_enc && pending.expires_at > Date.now() && pending.session_hash === await sessionHash(request);
      const payload = ownPending ? await pendingPayload(env, pending) : null;
      return json({configured:!config.missing.length, missing:config.missing, ...publicConnection(row),
        pending:payload ? {handle:pending.handle, authorization_url:payload.authorization_url, expires_at:pending.expires_at} : null,
        capabilities:{chat:'requires_selected_model_and_quota', speech:'separate_gemini_api_key'},
        connections:rows.map(savedConnection), active_id:row?.login_id || null});
    }
    if (config.missing.length) throw oauthError('Máy chủ chưa cấu hình cổng kết nối Antigravity.', 503, 'oauth_not_configured');
    if (path === ROOT + '/start' && request.method === 'POST') {
      if (await rateLimited(env, owner)) throw oauthError('Quá nhiều lần thử đăng nhập. Hãy thử lại sau một phút.', 429);
      return await start(request, env, owner, config, await readBody(request));
    }
    if (path === ROOT + '/status' && request.method === 'POST') return await finish(request, env, owner, (await readBody(request)).handle, config);
    if (path === ROOT + '/callback' && request.method === 'POST') return await manualCallback(request, env, owner, await readBody(request));
    if (path === ROOT + '/cancel' && request.method === 'POST') {
      const data = await readBody(request), pending = await ownedPending(request, env, owner, data.handle);
      await cancelPending(env, pending); return json({cancelled:true});
    }
    const activation = path.match(/^\/api\/ai\/oauth\/antigravity\/connections\/([A-Za-z0-9_-]{1,128})\/activate$/);
    if (activation && request.method === 'POST') {
      await readBody(request);
      const row = await ownedConnection(env, owner, activation[1]);
      if (!await activateConnection(env, owner, row.login_id)) throw oauthError('Tài khoản này chưa sẵn sàng. Hãy hoàn tất đăng nhập hoặc việc gỡ trước.');
      return json({...publicConnection(row), connection_id:row.login_id, active_id:row.login_id});
    }
    if (path === ROOT + '/models' && request.method === 'GET') {
      const row = await ownedConnection(env, owner, url.searchParams.get('connection_id'));
      return json({connection_id:row.login_id, models:await accountCatalog(env, row), verified:false});
    }
    if (path === ROOT + '/usage' && request.method === 'GET') {
      const row = await ownedConnection(env, owner, url.searchParams.get('connection_id'));
      if (await rateLimited(env, owner)) throw oauthError('Quá nhiều yêu cầu AI. Hãy thử lại sau một phút.', 429);
      return json(await accountUsage(env, row));
    }
    if (path === ROOT + '/model' && request.method === 'PUT') return await selectModel(env, owner, await readBody(request));
    if (path === ROOT && request.method === 'DELETE') {
      const data = await readBody(request);
      await disconnectAntigravity(env, owner, requiredId(data.connection_id));
      return json({connection_id:data.connection_id, disconnected:true});
    }
    return json({detail:'Không tìm thấy đường dẫn OAuth.'}, 404);
  } catch (error) {
    return json({detail:error.code ? error.message : 'Chưa lưu được kết nối Antigravity. Hãy thử lại mà không đổi tài khoản.', code:error.code || 'oauth_unavailable'}, error.status || 503);
  }
}
