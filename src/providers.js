import { sessionUser } from './auth.js';
import { isAdmin, listUsers, purgeGuests, userAction, userDetail } from './admin.js';
import { callLLM, cleanBaseUrl, DEFAULT_BASES, failureMessage, listModels, probeModel } from './llm.js';
import {seal, unseal} from './ai-secrets.js';
import {antigravityProvider, ANTIGRAVITY_PROFILE, connectionIdOk} from './antigravity-gateway.js';
import {rateLimited} from './ai-usage.js';

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const text = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));



export const platformModel = env => env.OPENAI_MODEL || 'gpt-4.1-mini';
const platformInfo = (env, admin) => admin ? {configured:Boolean(env.OPENAI_API_KEY), model:platformModel(env)} : null;

const activeProfile = (env, userId) => env.DB.prepare(`SELECT p.* FROM ai_providers p
  JOIN ai_active_profiles a ON a.user_id=p.user_id AND a.profile_id=p.id WHERE p.user_id=?`).bind(userId).first();
const connectionBase = (protocol, raw) => typeof protocol === 'string' && Object.hasOwn(DEFAULT_BASES, protocol)
  && (raw === undefined || typeof raw === 'string') ? cleanBaseUrl(protocol, raw) : {error: 'Kết nối API không hợp lệ.'};
const ownedProfile = (env, userId, id) => env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=? AND id=?').bind(userId, id).first();

// An explicitly supplied device connection is transient and never borrows a server key.
export async function resolveProvider(env, userId, override, profileId) {
  if (typeof profileId === 'string' && (profileId === ANTIGRAVITY_PROFILE || profileId.startsWith(ANTIGRAVITY_PROFILE + ':'))) {
    const id = profileId.slice(ANTIGRAVITY_PROFILE.length + 1);
    if (override !== undefined || !connectionIdOk(id)) return {error:'invalid_connection'};
    return antigravityProvider(env, userId, id);
  }
  if (profileId !== undefined && (typeof profileId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profileId)
    || override !== undefined)) return {error: 'invalid_connection'};
  if (override !== undefined) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) return {error: 'invalid_connection'};
    if (typeof override.base_url !== 'string') return {error: 'invalid_connection'};
    const base = connectionBase(override.protocol, override.base_url);
    if (base.error || !modelOk(override.model) || !keyOk(override.api_key)
      || override.model.includes(override.api_key) || base.url.includes(override.api_key)) return {error: 'invalid_connection'};
    return {source: 'device', protocol: override.protocol, baseUrl: base.url, apiKey: override.api_key, models: [override.model]};
  }
  const own = profileId !== undefined ? await ownedProfile(env, userId, profileId) : await activeProfile(env, userId);
  if (!own) {
    if (profileId !== undefined) return {error:'profile_changed'};
    return env.OPENAI_API_KEY && await isAdmin(env, userId)
      ? {source:'platform',protocol:'openai',baseUrl:DEFAULT_BASES.openai,apiKey:env.OPENAI_API_KEY,models:[platformModel(env)]} : null;
  }
  if (!modelOk(own.model)) return {error: 'no_model'};
  const apiKey = await unseal(env, userId, own.key_enc);
  if (!apiKey) return {error: 'rekey'};
  const base = connectionBase(own.protocol, own.base_url);
  if (base.error || !keyOk(apiKey) || own.model.includes(apiKey) || base.url.includes(apiKey)) return {error: 'invalid_connection'};
  return {source: 'own', protocol: own.protocol, baseUrl: base.url, apiKey, models: [own.model]};
}

export const NO_AI = 'Thêm API key và chọn model trong Cài đặt để chat với thầy Lâm.';
export const REKEY = 'Không giải mã được API key đã lưu. Hãy nhập lại trong Cài đặt.';
const providerFailure = provider => !provider || provider.error === 'no_model'
  ? json({detail: NO_AI, code: 'no_ai'}, 403)
  : provider.error === 'rekey' ? json({detail: REKEY, code: 'rekey'}, 409)
  : provider.error === 'profile_changed' ? json({detail: 'The selected API profile no longer exists. Choose a connection in Settings.', code: 'profile_changed'}, 409)
  : provider.error === 'oauth_model' ? json({detail:'Choose and test an Antigravity chat model in Settings.',code:'oauth_model'},403)
  : provider.error === 'oauth_reconnect' ? json({detail:'Reconnect Antigravity in Settings. No API-key connection was used instead.',code:'oauth_reconnect'},provider.status || 409)
  : provider.error ? json({detail: 'Kết nối API không hợp lệ.', code: 'invalid_connection'}, 400) : null;

// Chat and Kaiwa share this: {text} on success, otherwise {response} ready to return.
export async function askAI(env, userId, request, override, profileId, {beforeGeneration} = {}) {
  const provider = await resolveProvider(env, userId, override, profileId);
  const response = providerFailure(provider);
  if (response) return {response};
  if (beforeGeneration && !(await beforeGeneration())) return {response: json({detail: 'This conversation changed before generation. Please send a new message.'}, 409)};
  const result = await callLLM(provider, request);
  if (result.text) return {text: result.text};
  return {response: json({detail: failureMessage(result.status)}, result.status === 429 ? 429 : 503)};
}

// Read-aloud stays on the selected API-key profile; Antigravity is a separate chat connection.
export async function googleSpeechKey(env, userId, override, profileId) {
  if (typeof profileId === 'string' && (profileId === ANTIGRAVITY_PROFILE || profileId.startsWith(ANTIGRAVITY_PROFILE + ':'))) return {response:json({detail:'Antigravity chat does not provide this TTS API. Select a Google Gemini API-key profile for read-aloud.',code:'no_tts'},403)};
  const provider = await resolveProvider(env, userId, override, profileId);
  if (override !== undefined || provider?.error) {
    const response = providerFailure(provider);
    if (response) return {response};
  }
  const google = provider?.protocol === 'gemini' && new URL(provider.baseUrl).hostname === 'generativelanguage.googleapis.com';
  return {apiKey:google ? provider.apiKey : null};
}

async function body(request, limit = 4096) {
  const raw = await request.text();
  if (raw.length > limit || text.encode(raw).byteLength > limit) return null;
  try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
}
const modelOk = value => typeof value === 'string' && value.length <= 100 && /^~?[\w.:\/-]+$/.test(value);
const keyOk = value => typeof value === 'string' && /^[\x21-\x7e]{8,512}$/.test(value);

async function overview(env) {
  const since = days => new Date(Date.now() - days * 86400000).toISOString();
  const count = async (sql, ...p) => (await env.DB.prepare(sql).bind(...p).first()).n;
  const top = await env.DB.prepare(`SELECT c.user_id, count(*) n, (SELECT name FROM sessions s WHERE s.user_id=c.user_id LIMIT 1) name FROM conversations c WHERE c.role='user' AND c.timestamp>=? GROUP BY c.user_id ORDER BY n DESC LIMIT 8`).bind(since(7)).all();
  return {
    shared_ai: {configured:Boolean(env.OPENAI_API_KEY),model:platformModel(env)},
    users: await count('SELECT count(*) n FROM profiles'),
    active_7d: await count("SELECT count(DISTINCT user_id) n FROM conversations WHERE timestamp>=?", since(7)),
    messages_24h: await count("SELECT count(*) n FROM conversations WHERE role='user' AND timestamp>=?", since(1)),
    messages_7d: await count("SELECT count(*) n FROM conversations WHERE role='user' AND timestamp>=?", since(7)),
    own_api_users: await count('SELECT count(DISTINCT user_id) n FROM ai_providers'),
    top: top.results.map(r => ({name: r.name || 'Học viên ' + r.user_id.slice(-4), messages: r.n}))
  };
}

// Opaque cache identity; never expose a plain hash of a learner's API key.
async function connectionId(env, userId, protocol, baseUrl, apiKey) {
  if (!env.AI_KEY_SECRET) return null;
  const key = await crypto.subtle.importKey('raw', text.encode('model-scan-v1\0' + env.AI_KEY_SECRET),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, text.encode(JSON.stringify([userId, protocol, baseUrl, apiKey])));
  return b64(new Uint8Array(signature));
}

async function publicProfile(env, userId, row) {
  const apiKey = await unseal(env, userId, row.key_enc);
  const identity = apiKey ? await connectionId(env, userId, row.protocol, row.base_url, apiKey) : null;
  const historyMatches = identity && row.connection_id === identity;
  return {id: row.id, name: row.name, protocol: row.protocol, base_url: row.base_url, model: row.model,
    key_last4: row.key_last4, connection_id: identity,
    models: historyMatches ? JSON.parse(row.models) : [], checked_at: historyMatches ? row.checked_at : null};
}

async function saveProfile(env, userId, data, existing, requireModel = false) {
  const base = connectionBase(data.protocol, data.base_url);
  if (base.error) return {response: json({detail: base.error}, 400)};
  if (!(modelOk(data.model) || (!requireModel && data.model === ''))) return {response: json({detail: 'Tên model không hợp lệ.'}, 400)};
  const name = data.name === undefined ? existing?.name || 'API' : data.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) return {response: json({detail: 'Tên cấu hình không hợp lệ.'}, 400)};
  const replacingKey = data.api_key !== undefined && data.api_key !== '';
  if (replacingKey && !keyOk(data.api_key)) return {response: json({detail: 'API key không hợp lệ.'}, 400)};
  if (!replacingKey && (!existing || existing.protocol !== data.protocol || existing.base_url !== base.url)) {
    return {response: json({detail: 'Enter an API key for this URL and protocol. The saved key cannot be transferred to another endpoint.'}, 400)};
  }
  const apiKey = replacingKey ? data.api_key : await unseal(env, userId, existing.key_enc);
  if (!apiKey) return {response: json({detail: REKEY, code: 'rekey'}, 409)};
  if (data.model.includes(apiKey) || name.includes(apiKey) || base.url.includes(apiKey)) return {response: json({detail: 'Cấu hình API không hợp lệ.'}, 400)};
  const identity = await connectionId(env, userId, data.protocol, base.url, apiKey);
  let models = existing?.connection_id === identity ? existing.models : '[]';
  let checkedAt = existing?.connection_id === identity ? existing.checked_at : null;
  const hasHistory = data.models !== undefined || data.checked_at !== undefined;
  if (hasHistory) {
    if (!Array.isArray(data.models) || data.models.length > 1000 || data.models.some(m => !modelOk(m) || m.includes(apiKey))
      || !(data.checked_at === null || (Number.isSafeInteger(data.checked_at) && data.checked_at >= 0 && data.checked_at <= Date.now() + 60000))
      || (data.models.length && data.checked_at === null)) return {response: json({detail: 'Lịch sử model không hợp lệ.'}, 400)};
    // Client observations are not access guarantees. Stale/forged connection identities cannot replace good history.
    if (identity && data.connection_id === identity) {
      models = JSON.stringify([...new Set(data.models)]);
      checkedAt = data.checked_at;
    }
  }
  const row = {user_id: userId, id: existing?.id || crypto.randomUUID(), name: name.trim(), protocol: data.protocol,
    base_url: base.url, model: data.model, key_enc: replacingKey ? await seal(env, userId, apiKey) : existing.key_enc,
    key_last4: apiKey.slice(-4), updated_at: new Date().toISOString(), connection_id: identity, models, checked_at: checkedAt};
  const values = [row.name, row.protocol, row.base_url, row.model, row.key_enc, row.key_last4, row.updated_at, identity, models, checkedAt];
  if (existing) {
    // Snapshot ownership and ciphertext are checked again at write time; concurrent key changes cannot be overwritten.
    const changed = await env.DB.prepare(`UPDATE ai_providers SET name=?,protocol=?,base_url=?,model=?,key_enc=?,key_last4=?,updated_at=?,connection_id=?,models=?,checked_at=?
      WHERE user_id=? AND id=? AND key_enc=? AND updated_at=? RETURNING id`)
      .bind(...values, userId, existing.id, existing.key_enc, existing.updated_at).first();
    if (!changed) return {response: json({detail: 'Cấu hình đã thay đổi. Hãy tải lại.'}, 409)};
  } else {
    const inserted = await env.DB.prepare(`INSERT INTO ai_providers(user_id,id,name,protocol,base_url,model,key_enc,key_last4,updated_at,connection_id,models,checked_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM ai_providers WHERE user_id=?) < 20 RETURNING id`)
      .bind(userId, row.id, ...values, userId).first();
    if (!inserted) return {response: json({detail: 'Tối đa 20 cấu hình API.'}, 409)};
  }
  return {row};
}

const activateProfile = (env, userId, id) => env.DB.prepare(`INSERT INTO ai_active_profiles(user_id,profile_id)
  SELECT user_id,id FROM ai_providers WHERE user_id=? AND id=?
  ON CONFLICT(user_id) DO UPDATE SET profile_id=excluded.profile_id RETURNING profile_id`).bind(userId, id).first();

async function removeProfile(env, userId, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_active_profiles WHERE user_id=? AND profile_id=?').bind(userId, id),
    env.DB.prepare('DELETE FROM ai_providers WHERE user_id=? AND id=?').bind(userId, id)
  ]);
}

// /api/ai/* (a learner's own API) and /api/admin/* (platform settings, admins only).
export async function aiRoute(request, env, url) {
  const user = await sessionUser(request, env);
  if (!user) return json({detail: 'Đăng nhập để dùng Sensei và đồng bộ tiến độ.'}, 401);
  const expectedAccount = request.headers.get('X-VJBot-Account');
  if (expectedAccount !== null && expectedAccount !== user.user_id) return json({detail: 'The signed-in account changed. Reload before using API profiles.', code: 'account_changed'}, 409);
  const path = url.pathname, method = request.method, admin = await isAdmin(env, user.user_id);

  if (path === '/api/ai/profiles' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM ai_providers WHERE user_id=? ORDER BY name,id').bind(user.user_id).all();
    const active = await activeProfile(env, user.user_id);
    return json({profiles: await Promise.all(rows.results.map(row => publicProfile(env, user.user_id, row))),
      active_id: active?.id || null, is_admin:admin, platform:platformInfo(env,admin), can_store: Boolean(env.AI_KEY_SECRET)});
  }
  const profilePath = path.match(/^\/api\/ai\/profiles\/([^/]+)(\/activate)?$/);
  if ((path === '/api/ai/profiles' && method === 'POST') || (profilePath && method === 'PUT' && !profilePath[2])) {
    if (!env.AI_KEY_SECRET) return json({detail: 'Máy chủ chưa bật lưu API key.'}, 503);
    const existing = profilePath ? await ownedProfile(env, user.user_id, profilePath[1]) : null;
    if (profilePath && !existing) return json({detail: 'Không tìm thấy cấu hình.'}, 404);
    const data = await body(request, 131072);
    if (!data) return json({detail: 'Dữ liệu không hợp lệ.'}, 400);
    const saved = await saveProfile(env, user.user_id, data, existing);
    return saved.response || json({profile: await publicProfile(env, user.user_id, saved.row)}, existing ? 200 : 201);
  }
  if (profilePath && profilePath[2] && method === 'POST') {
    if (!(await activateProfile(env, user.user_id, profilePath[1]))) return json({detail: 'Không tìm thấy cấu hình.'}, 404);
    return json({ok: true});
  }
  if (profilePath && !profilePath[2] && method === 'DELETE') {
    if (!(await ownedProfile(env, user.user_id, profilePath[1]))) return json({detail: 'Không tìm thấy cấu hình.'}, 404);
    await removeProfile(env, user.user_id, profilePath[1]);
    return json({ok: true});
  }
  if (path === '/api/ai/settings' && method === 'GET') {
    const row = await activeProfile(env, user.user_id);
    const own = row ? await publicProfile(env, user.user_id, row) : null;
    const platform = platformInfo(env,admin);
    return json({source:own?'own':platform?.configured?'platform':'none',is_admin:admin,own,platform,bases:DEFAULT_BASES,can_store:Boolean(env.AI_KEY_SECRET)});
  }
  if (path === '/api/ai/settings' && method === 'PUT') {
    const data = await body(request, 131072);
    if (!data) return json({detail: 'Dữ liệu không hợp lệ.'}, 400);
    if (!env.AI_KEY_SECRET) return json({detail: 'Máy chủ chưa bật lưu API key.'}, 503);
    const existing = await activeProfile(env, user.user_id);
    const saved = await saveProfile(env, user.user_id, data, existing, true);
    if (saved.response) return saved.response;
    if (!existing && !(await activateProfile(env, user.user_id, saved.row.id))) return json({detail: 'Cấu hình đã thay đổi. Hãy tải lại.'}, 409);
    return json({ok: true});
  }
  if (path === '/api/ai/settings' && method === 'DELETE') {
    const existing = await activeProfile(env, user.user_id);
    if (existing) await removeProfile(env, user.user_id, existing.id);
    return json({ok: true});
  }
  if (['/api/ai/models', '/api/ai/models/test'].includes(path) && method === 'POST') {
    const data = await body(request);
    if (!data) return json({detail: 'Invalid model discovery request.'}, 400);
    const base = connectionBase(data.protocol, data.base_url);
    if (base.error) return json({detail: base.error}, 400);
    const probe = path === '/api/ai/models/test';
    if (probe && !modelOk(data.model)) return json({detail: 'Invalid model ID.'}, 400);
    let apiKey = data.api_key;
    if (apiKey !== undefined && apiKey !== '' && (typeof apiKey !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(apiKey))) {
      return json({detail: 'Invalid API key.'}, 400);
    }
    if (!apiKey) {
      const own = data.profile_id === undefined ? await activeProfile(env, user.user_id)
        : typeof data.profile_id === 'string' ? await ownedProfile(env, user.user_id, data.profile_id) : null;
      if (!own || own.protocol !== data.protocol || own.base_url !== base.url) {
        return json({detail: 'Enter an API key for this URL and protocol. The saved key will not be sent to a different endpoint.'}, 400);
      }
      apiKey = await unseal(env, user.user_id, own.key_enc);
      if (!apiKey) return json({detail: REKEY, code: 'rekey'}, 409);
    }
    if ((probe && data.model.includes(apiKey)) || base.url.includes(apiKey)) return json({detail: 'Invalid API connection.'}, 400);
    const identity = await connectionId(env, user.user_id, data.protocol, base.url, apiKey);
    if (probe && data.connection_id !== undefined && (!identity || data.connection_id !== identity)) {
      return json({detail: 'The API connection changed. Fetch models again before testing.'}, 409);
    }
    if (await rateLimited(env, user.user_id)) return json({
      detail: 'Too many requests. Try again in a minute.', retry_after_ms: 61000 - Date.now() % 60000
    }, 429);
    if (probe) {
      const provider = {protocol: data.protocol, baseUrl: base.url, apiKey, models: [data.model], source: 'draft'};
      const result = await probeModel(provider, {signal: request.signal});
      return result.text ? json({ok: true, model: data.model})
        : json({model: data.model, provider_status: result.status, detail: failureMessage(result.status),
          ...(result.retryAfterMs !== undefined ? {retry_after_ms: result.retryAfterMs} : {})},
          [429, 504].includes(result.status) ? result.status : 502);
    }
    const result = await listModels({protocol: data.protocol, baseUrl: base.url, apiKey});
    if (result.models) return json({...result, ...(identity ? {connection_id: identity} : {})});
    const detail = result.status === 404 || result.status === 405
      ? 'This API does not support model listing. Use an endpoint that provides a model catalog.'
      : result.status === 502 ? 'The API returned an invalid model catalog. Check the API URL and provider.' : failureMessage(result.status);
    // A provider's rejected key is not an expired VJBot session.
    return json({detail}, [400, 404, 405, 429, 504].includes(result.status) ? result.status : 502);
  }
  if (path === '/api/ai/test' && method === 'POST') {
    const data = await body(request);
    if (!data) return json({detail: 'Dữ liệu không hợp lệ.'}, 400);
    if (await rateLimited(env, user.user_id)) return json({detail: 'Bạn hãy đợi một phút rồi thử lại.'}, 429);
    const provider = await resolveProvider(env, user.user_id, data.api_connection, request.headers.get('X-VJBot-Profile') ?? undefined);
    const response = providerFailure(provider);
    if (response) return response;
    if (provider.protocol === 'openai' && provider.baseUrl === 'https://openrouter.ai/api/v1') {
      const catalog = await listModels(provider);
      if (!catalog.models) return json({detail: failureMessage(catalog.status)}, catalog.status === 429 ? 429 : 503);
      if (!catalog.models.includes(provider.models[0])) {
        return json({detail: catalog.free_only
          ? 'This key has no paid budget. Choose a listed zero-price candidate; the selected model was not tested.'
          : 'The selected model is not in this key-filtered catalog. Access was not verified; no generation was sent.'}, 403);
      }
    }
    const result = await callLLM(provider, {turns: [{role: 'user', content: 'Reply with the single word OK.'}]});
    return result.text ? json({ok: true, model: provider.models[0]})
      : json({detail: failureMessage(result.status)}, result.status === 429 ? 429 : 503);
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
