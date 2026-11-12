import {unseal} from './ai-secrets.js';

export const ANTIGRAVITY_PROFILE = 'antigravity_oauth';
export const stateOwner = owner => 'antigravity-oauth\0' + owner;
export const connectionIdOk = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
export const connectionFor = (env, owner, id) => id === undefined
  ? env.DB.prepare(`SELECT c.* FROM ai_antigravity_connections c JOIN ai_active_antigravity a
    ON a.user_id=c.user_id AND a.connection_id=c.login_id WHERE c.user_id=?`).bind(owner).first()
  : env.DB.prepare('SELECT * FROM ai_antigravity_connections WHERE user_id=? AND login_id=?').bind(owner, id).first();
export const connectionsFor = async (env, owner) => (await env.DB.prepare('SELECT * FROM ai_antigravity_connections WHERE user_id=? ORDER BY updated_at,login_id LIMIT 20').bind(owner).all()).results;
export const activateConnection = (env, owner, id) => env.DB.prepare(`INSERT INTO ai_active_antigravity(user_id,connection_id)
  SELECT user_id,login_id FROM ai_antigravity_connections WHERE user_id=? AND login_id=? AND state='active'
  ON CONFLICT(user_id) DO UPDATE SET connection_id=excluded.connection_id RETURNING connection_id`).bind(owner, id).first();
export const pendingFor = (env, owner) => env.DB.prepare('SELECT * FROM ai_antigravity_oauth_states WHERE user_id=?').bind(owner).first();
export const oauthError = (message, status = 409, code = 'oauth_unavailable') => Object.assign(new Error(message), {status, code});
export const modelIdOk = model => typeof model === 'string' && /^[\w.:-]{1,100}$/.test(model) && !/(?:tts|image|transcrib|embedding|audio)/i.test(model);
const unavailable = () => oauthError('Reconnect Antigravity in Settings. No API-key connection was used instead.', 409, 'oauth_reconnect');

export function gatewayConfiguration(env) {
  const required = ['ANTIGRAVITY_GATEWAY_URL', 'ANTIGRAVITY_MANAGEMENT_KEY', 'ANTIGRAVITY_API_KEY', 'AI_KEY_SECRET'];
  const missing = required.filter(key => typeof env[key] !== 'string' || !env[key]);
  if (missing.length) return {missing};
  try {
    const url = new URL(env.ANTIGRAVITY_GATEWAY_URL);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash
      || !(url.protocol === 'https:' || (local && url.protocol === 'http:' && env.ANTIGRAVITY_ALLOW_LOOPBACK === 'true'))
      || env.ANTIGRAVITY_MANAGEMENT_KEY === env.ANTIGRAVITY_API_KEY
      || !['ANTIGRAVITY_MANAGEMENT_KEY', 'ANTIGRAVITY_API_KEY'].every(key => /^[\x21-\x7e]{16,512}$/.test(env[key]))) throw new Error();
    return {missing:[], baseUrl:url.href.replace(/\/$/, ''), managementKey:env.ANTIGRAVITY_MANAGEMENT_KEY, apiKey:env.ANTIGRAVITY_API_KEY};
  } catch { return {missing:['valid dedicated Antigravity gateway configuration']}; }
}

async function boundedJson(response, limit = 1048576) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const decoder = new TextDecoder();
  let raw = '', size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error();
      raw += decoder.decode(value, {stream:true});
    }
    return JSON.parse(raw + decoder.decode());
  } finally { await reader.cancel(); }
}

export async function gatewayRequest(env, path, {method = 'GET', body, allowMissing = false} = {}) {
  const config = gatewayConfiguration(env);
  if (config.missing.length) throw oauthError('Antigravity gateway is not configured on this server.', 503, 'oauth_not_configured');
  try {
    const response = await fetch(config.baseUrl + '/v8/management' + path, {
      method, redirect:'manual', signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer ' + config.managementKey, 'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)})
    });
    if (allowMissing && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    return await boundedJson(response);
  } catch { throw oauthError('Antigravity gateway did not complete this request. No other account or API key was used.', 503); }
}

export async function requireStrictRouting(env) {
  if (await gatewayRequest(env, '/config/routing/force-model-prefix') !== true) {
    throw oauthError('This gateway must enable force-model-prefix before accounts can be connected or used.', 503);
  }
}

export async function pendingPayload(env, pending) {
  try {
    const value = JSON.parse(await unseal(env, stateOwner(pending.user_id), pending.state_enc));
    if (typeof value?.state !== 'string' || !/^[\w-]{16,256}$/.test(value.state)
      || value.gateway_url !== gatewayConfiguration(env).baseUrl) throw new Error();
    return value;
  } catch { throw oauthError('The pending sign-in could not be restored. Keep the connection and retry after server configuration is restored.', 503); }
}

async function ownedCredential(env, row) {
  const config = gatewayConfiguration(env);
  if (!row || config.missing.length || row.gateway_url !== config.baseUrl || row.state !== 'active') throw unavailable();
  await requireStrictRouting(env);
  const files = await gatewayRequest(env, '/credentials');
  const credential = Array.isArray(files.files) && files.files.find(file => file.id === row.auth_id);
  if (!credential || credential.provider !== 'antigravity' || credential.disabled || credential.requires_sign_in) throw unavailable();
  return credential;
}

export async function accountCatalog(env, row) {
  await ownedCredential(env, row);
  const catalog = await gatewayRequest(env, '/credentials/models?name=' + encodeURIComponent(row.auth_id));
  if (!Array.isArray(catalog.models) || catalog.models.length > 1000) throw oauthError('The Antigravity account catalog is unavailable.', 503);
  const routePrefix = row.prefix + '/';
  if (!catalog.models.every(model => model && typeof model.id === 'string' && model.id.length <= routePrefix.length + 100 && model.id.startsWith(routePrefix))) {
    throw oauthError('Antigravity account isolation has not finished. Refresh the model catalog before using chat.', 409);
  }
  return [...new Set(catalog.models.map(model => model.id.slice(routePrefix.length)).filter(modelIdOk))].sort();
}

export async function antigravityProvider(env, owner, id) {
  try {
    if (!connectionIdOk(id)) throw unavailable();
    const row = await connectionFor(env, owner, id), models = await accountCatalog(env, row);
    if (!row.model || !models.includes(row.model)) return {error:'oauth_model'};
    const config = gatewayConfiguration(env);
    return {source:ANTIGRAVITY_PROFILE, protocol:'openai', baseUrl:config.baseUrl + '/v1', apiKey:config.apiKey, models:[row.prefix + '/' + row.model]};
  } catch (error) { return {error:'oauth_reconnect', status:error.status || 503}; }
}

export async function accountUsage(env, row) {
  const checked_at = new Date().toISOString(), connection_id = row.login_id;
  const unknown = () => ({connection_id, available:false, checked_at, models:[], detail:'Provider quota is unavailable. No generation was requested.'});
  try {
    const credential = await ownedCredential(env, row);
    if (typeof credential.auth_index !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(credential.auth_index)
      || typeof credential.project_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(credential.project_id)) return unknown();
    const response = await gatewayRequest(env, '/requests/api-call', {method:'POST', body:{
      auth_index:credential.auth_index, method:'POST',
      url:'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
      header:{Authorization:'Bearer $TOKEN$', 'Content-Type':'application/json', 'User-Agent':'antigravity/1.19.6 windows/amd64'},
      data:JSON.stringify({project:credential.project_id})
    }});
    if (response.status_code !== 200 || typeof response.body !== 'string' || response.body.length > 524288) return unknown();
    const payload = JSON.parse(response.body);
    if (!payload.models || typeof payload.models !== 'object' || Array.isArray(payload.models)) return unknown();
    const entries = Object.entries(payload.models);
    if (entries.length > 1000) return unknown();
    const models = entries.filter(([model]) => /^[A-Za-z0-9_.:/-]{1,200}$/.test(model)).map(([model, value]) => {
      const quota = value?.quotaInfo, fraction = quota?.remainingFraction, reset = quota?.resetTime;
      return {model, remaining_fraction:typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : null,
        reset_at:typeof reset === 'string' && reset.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(reset)
          && Number.isFinite(Date.parse(reset)) && new Date(reset.slice(0,10) + 'T00:00:00Z').toISOString().slice(0,10) === reset.slice(0,10) ? reset : null};
    });
    return {connection_id, available:models.some(model => model.remaining_fraction !== null), checked_at, models};
  } catch { return unknown(); }
}

async function removeCredential(env, authId, owner) {
  const bound = await env.DB.prepare('SELECT user_id FROM ai_antigravity_connections WHERE auth_id=?').bind(authId).first();
  if (bound && bound.user_id !== owner) throw oauthError('This Google account is already linked to a different VJBot account.');
  const removed = await gatewayRequest(env, '/credentials?name=' + encodeURIComponent(authId), {method:'DELETE', allowMissing:true});
  if (removed !== null && removed?.status !== 'ok') throw oauthError('The gateway did not confirm account removal. Retry removal before using this connection.', 503);
}

export async function cancelPending(env, pending) {
  if (!pending) return;
  if (!pending.state_enc) {
    await env.DB.prepare('DELETE FROM ai_antigravity_oauth_states WHERE handle=?').bind(pending.handle).run();
    return;
  }
  const payload = await pendingPayload(env, pending);
  const connection = await connectionFor(env, pending.user_id, pending.handle);
  const cancelled = await gatewayRequest(env, '/oauth/session?state=' + encodeURIComponent(payload.state), {method:'DELETE'});
  if (cancelled.cancelled !== true) {
    const status = await gatewayRequest(env, '/oauth/status?state=' + encodeURIComponent(payload.state));
    if (status.status === 'wait') throw oauthError('Sign-in is finishing. Wait for its result before disconnecting.');
    if (status.saved === true && typeof status.auth_id === 'string' && status.auth_id.length > 0 && status.auth_id.length <= 512) {
      const bound = await env.DB.prepare('SELECT user_id,login_id FROM ai_antigravity_connections WHERE auth_id=?').bind(status.auth_id).first();
      if (!bound) await removeCredential(env, status.auth_id, pending.user_id);
    }
  }
  if (connection) await disconnectAntigravity(env, pending.user_id, pending.handle);
  await env.DB.prepare('DELETE FROM ai_antigravity_oauth_states WHERE handle=? AND state_enc=?').bind(pending.handle, pending.state_enc).run();
}

export async function disconnectAntigravity(env, owner, id) {
  if (!connectionIdOk(id)) throw oauthError('Choose a saved Antigravity connection.', 400);
  const row = await connectionFor(env, owner, id);
  if (!row) throw oauthError('This Antigravity connection is not available.', 404);
  const config = gatewayConfiguration(env);
  if (config.missing.length || config.baseUrl !== row.gateway_url) throw oauthError('Restore the original gateway before removing this account connection.', 503);
  await env.DB.prepare("UPDATE ai_antigravity_connections SET state='disconnecting',updated_at=max(updated_at+1,?) WHERE user_id=? AND login_id=? AND auth_id=?")
    .bind(Date.now(), owner, id, row.auth_id).run();
  await removeCredential(env, row.auth_id, owner);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_active_antigravity WHERE user_id=? AND connection_id=?').bind(owner, id),
    env.DB.prepare('DELETE FROM ai_antigravity_oauth_states WHERE user_id=? AND handle=?').bind(owner, id),
    env.DB.prepare("DELETE FROM ai_antigravity_connections WHERE user_id=? AND login_id=? AND auth_id=? AND state='disconnecting'").bind(owner, id, row.auth_id)
  ]);
}

export async function disconnectAllAntigravity(env, owner) {
  await cancelPending(env, await pendingFor(env, owner));
  for (const row of await connectionsFor(env, owner)) await disconnectAntigravity(env, owner, row.login_id);
}
