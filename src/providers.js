import { sessionUser } from './auth.js';
import { isAdmin, listUsers, purgeGuests, userAction, userDetail } from './admin.js';
import { callLLM, cleanBaseUrl, DEFAULT_BASES, failureMessage } from './llm.js';

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const text = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export async function rateLimited(env, userId) {
  const bucket = Math.floor(Date.now() / 60000);
  const usage = await env.DB.prepare('INSERT INTO ai_usage(user_id,bucket,count) VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(userId, bucket).first();
  await env.DB.prepare('DELETE FROM ai_usage WHERE bucket < ?').bind(bucket - 60).run();
  return usage.count > 20;
}

// AES-GCM with a key derived from the AI_KEY_SECRET secret; the user id is authenticated so rows cannot be swapped.
async function aesKey(env) {
  if (!env.AI_KEY_SECRET) return null;
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', text.encode(env.AI_KEY_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, userId, apiKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: text.encode(userId)}, await aesKey(env), text.encode(apiKey)));
  return b64(new Uint8Array([...iv, ...sealed]));
}
async function unseal(env, userId, blob) {
  try {
    const bytes = unb64(blob), key = await aesKey(env);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: text.encode(userId)}, key, bytes.slice(12)));
  } catch { return null; }
}

export const platformModel = env => env.OPENAI_MODEL || 'gpt-4.1-mini';

// Own credentials take precedence. The shared key never leaves the server or serves a free account.
export async function resolveProvider(env, userId) {
  const own = await env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=?').bind(userId).first();
  if (!own) return env.OPENAI_API_KEY && await isAdmin(env, userId)
    ? {source: 'platform', protocol: 'openai', baseUrl: DEFAULT_BASES.openai, apiKey: env.OPENAI_API_KEY, models: [platformModel(env)]}
    : null;
  const apiKey = await unseal(env, userId, own.key_enc);
  if (!apiKey) return {error: 'rekey'};
  return {source: 'own', protocol: own.protocol, baseUrl: own.base_url, apiKey, models: [own.model]};
}

// Gemini speech needs a Google key: only a saved Gemini API that points at Google qualifies.
export async function googleSpeechKey(env, userId) {
  const provider = await resolveProvider(env, userId);
  return provider?.protocol === 'gemini' && new URL(provider.baseUrl).hostname === 'generativelanguage.googleapis.com' ? provider.apiKey : null;
}

export const NO_AI = 'Thêm API key của bạn trong Cài đặt để chat với thầy Lâm.';
export const REKEY = 'Không giải mã được API key đã lưu. Hãy nhập lại trong Cài đặt.';

// Chat and Kaiwa share this: {text} on success, otherwise {response} ready to return.
export async function askAI(env, userId, request) {
  const provider = await resolveProvider(env, userId);
  if (!provider) return {response: json({detail: NO_AI, code: 'no_ai'}, 403)};
  if (provider.error) return {response: json({detail: REKEY, code: 'rekey'}, 409)};
  const result = await callLLM(provider, request);
  if (result.text) return {text: result.text};
  return {response: json({detail: failureMessage(result.status)}, result.status === 429 ? 429 : 503)};
}

async function body(request) {
  const raw = await request.text();
  if (raw.length > 4096) return null;
  try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
}
const modelOk = value => typeof value === 'string' && /^[\w.:\/-]{1,100}$/.test(value);

async function overview(env) {
  const since = days => new Date(Date.now() - days * 86400000).toISOString();
  const count = async (sql, ...p) => (await env.DB.prepare(sql).bind(...p).first()).n;
  const top = await env.DB.prepare(`SELECT c.user_id, count(*) n, (SELECT name FROM sessions s WHERE s.user_id=c.user_id LIMIT 1) name FROM conversations c WHERE c.role='user' AND c.timestamp>=? GROUP BY c.user_id ORDER BY n DESC LIMIT 8`).bind(since(7)).all();
  return {
    shared_ai: {configured: Boolean(env.OPENAI_API_KEY), model: platformModel(env)},
    users: await count('SELECT count(*) n FROM profiles'),
    active_7d: await count("SELECT count(DISTINCT user_id) n FROM conversations WHERE timestamp>=?", since(7)),
    messages_24h: await count("SELECT count(*) n FROM conversations WHERE role='user' AND timestamp>=?", since(1)),
    messages_7d: await count("SELECT count(*) n FROM conversations WHERE role='user' AND timestamp>=?", since(7)),
    own_api_users: await count('SELECT count(*) n FROM ai_providers'),
    top: top.results.map(r => ({name: r.name || 'Học viên ' + r.user_id.slice(-4), messages: r.n}))
  };
}

// /api/ai/* (a learner's own API) and /api/admin/* (platform settings, admins only).
export async function aiRoute(request, env, url) {
  const user = await sessionUser(request, env);
  if (!user) return json({detail: 'Đăng nhập để dùng Sensei và đồng bộ tiến độ.'}, 401);
  const path = url.pathname, method = request.method, admin = await isAdmin(env, user.user_id);

  if (path === '/api/ai/settings' && method === 'GET') {
    const own = await env.DB.prepare('SELECT protocol,base_url,model,key_last4 FROM ai_providers WHERE user_id=?').bind(user.user_id).first();
    const platform = admin ? {configured: Boolean(env.OPENAI_API_KEY), model: platformModel(env)} : null;
    return json({source: own ? 'own' : platform?.configured ? 'platform' : 'none', is_admin: admin, own, platform, bases: DEFAULT_BASES, can_store: Boolean(env.AI_KEY_SECRET)});
  }
  if (path === '/api/ai/settings' && method === 'PUT') {
    const data = await body(request);
    if (!data) return json({detail: 'Dữ liệu không hợp lệ.'}, 400);
    if (!env.AI_KEY_SECRET) return json({detail: 'Máy chủ chưa bật lưu API key.'}, 503);
    const base = cleanBaseUrl(data.protocol, data.base_url);
    if (base.error) return json({detail: base.error}, 400);
    if (!modelOk(data.model)) return json({detail: 'Tên model không hợp lệ.'}, 400);
    const existing = await env.DB.prepare('SELECT key_enc,key_last4 FROM ai_providers WHERE user_id=?').bind(user.user_id).first();
    let sealed = existing?.key_enc, last4 = existing?.key_last4;
    if (data.api_key !== undefined && data.api_key !== '') {
      if (typeof data.api_key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(data.api_key)) return json({detail: 'API key không hợp lệ.'}, 400);
      sealed = await seal(env, user.user_id, data.api_key);
      last4 = data.api_key.slice(-4);
    }
    if (!sealed) return json({detail: 'Nhập API key.'}, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO ai_providers(user_id,protocol,base_url,model,key_enc,key_last4,updated_at) VALUES(?,?,?,?,?,?,?)').bind(user.user_id, data.protocol, base.url, data.model, sealed, last4, new Date().toISOString()).run();
    return json({ok: true});
  }
  if (path === '/api/ai/settings' && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM ai_providers WHERE user_id=?').bind(user.user_id).run();
    return json({ok: true});
  }
  if (path === '/api/ai/test' && method === 'POST') {
    if (await rateLimited(env, user.user_id)) return json({detail: 'Bạn hãy đợi một phút rồi thử lại.'}, 429);
    const asked = await askAI(env, user.user_id, {turns: [{role: 'user', content: 'Reply with the single word OK.'}]});
    return asked.response || json({ok: true});
  }

  if (path.startsWith('/api/admin/')) {
    if (!admin) return json({detail: 'Không có quyền.'}, 403);
    if (path === '/api/admin/overview' && method === 'GET') return json(await overview(env));
    if (path === '/api/admin/users' && method === 'GET') return json(await listUsers(env, url));
    if (path === '/api/admin/user' && method === 'GET') {
      const detail = await userDetail(env, url.searchParams.get('id') || '');
      return detail ? json(detail) : json({detail: 'Không tìm thấy người dùng.'}, 404);
    }
    if (path === '/api/admin/purge-guests' && method === 'POST') return json({removed: await purgeGuests(env)});
    if (path === '/api/admin/user' && method === 'POST') {
      const data = await body(request);
      const error = data ? await userAction(env, user.user_id, data) : 'Dữ liệu không hợp lệ.';
      return error ? json({detail: error}, 400) : json({ok: true});
    }
  }
  return json({detail: 'Not found'}, 404);
}
