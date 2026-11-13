import {disconnectAllAntigravity} from './antigravity-gateway.js';
import {clearTutorConversation} from './tutor-session.js';
import {LOCAL_ADMIN_ID} from './local-admin.js';

// Owners require a verified Google login and ADMIN_EMAILS. Registered users may receive revocable admin grants.
const emails = env => (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

export async function recordAdminLogin(env, userId, email) {
  if (typeof email !== 'string' || !emails(env).includes(email.toLowerCase())) return;
  await env.DB.prepare('INSERT OR REPLACE INTO admins(user_id,email,granted_at) VALUES(?,?,?)').bind(userId, email.toLowerCase(), new Date().toISOString()).run();
}

export async function isOwner(env, userId) {
  if (!userId?.startsWith('google:')) return false;
  const row = await env.DB.prepare('SELECT email FROM admins WHERE user_id=?').bind(userId).first();
  return Boolean(row && emails(env).includes(row.email));
}

export async function isAdmin(env, userId) {
  if (userId === LOCAL_ADMIN_ID && !env.LOCAL_TEST_ADMIN_PASSWORD) return false;
  if (!/^(google|email):/.test(userId || '')) return false;
  if (await isOwner(env, userId)) return true;
  return Boolean(await env.DB.prepare('SELECT user_id FROM admin_grants WHERE user_id=?').bind(userId).first());
}

const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const OWNED_TABLES = ['admin_ai_preferences', 'ai_antigravity_oauth_states', 'ai_active_antigravity', 'ai_antigravity_connections', 'ai_google_oauth_states', 'ai_google_oauth', 'exam_attempts', 'completions', 'progress_attempts', 'progress', 'tutor_requests', 'tutor_sessions', 'conversations', 'study_days', 'ai_usage', 'sessions', 'password_accounts', 'ai_active_profiles', 'ai_providers', 'admin_grants', 'admins', 'profiles'];
const RESET_TABLES = ['progress', 'progress_attempts', 'completions', 'exam_attempts', 'study_days'];
const kindOf = id => id.startsWith('google:') ? 'google' : id.startsWith('email:') ? 'email' : 'guest';

// Every table keyed by user_id; used by account deletion and by the admin "delete" action.
export async function deleteUserData(env, userId) {
  await disconnectAllAntigravity(env, userId);
  return env.DB.batch(OWNED_TABLES.map(table => env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(userId)));
}

const USER_SELECT = `SELECT p.user_id, COALESCE(p.name,(SELECT name FROM password_accounts a WHERE a.user_id=p.user_id),(SELECT name FROM sessions s WHERE s.user_id=p.user_id LIMIT 1)) AS name,
  COALESCE(p.email,(SELECT email FROM password_accounts a WHERE a.user_id=p.user_id)) AS email, p.level, p.created_at, p.last_login,
  (SELECT count(*) FROM conversations c WHERE c.user_id=p.user_id AND c.role='user') AS messages,
  (SELECT max(timestamp) FROM conversations c WHERE c.user_id=p.user_id) AS last_chat,
  (SELECT count(*) FROM progress g WHERE g.user_id=p.user_id) AS items,
  (SELECT count(*) FROM completions k WHERE k.user_id=p.user_id) AS completed,
  (SELECT count(*) FROM sessions s WHERE s.user_id=p.user_id AND s.expires_at>?) AS sessions,
  (SELECT protocol||' · '||model||' · …'||key_last4 FROM ai_providers v JOIN ai_active_profiles a ON a.user_id=v.user_id AND a.profile_id=v.id WHERE v.user_id=p.user_id) AS api,
  (SELECT count(*) FROM ai_providers v WHERE v.user_id=p.user_id) AS api_profiles,
  (SELECT email FROM admins m WHERE m.user_id=p.user_id) AS owner_email,
  EXISTS(SELECT 1 FROM admin_grants m WHERE m.user_id=p.user_id) AS granted_admin
  FROM profiles p`;
const shape = (env, {owner_email, granted_admin, ...row}) => {
  const kind = kindOf(row.user_id);
  const owner = kind === 'google' && emails(env).includes(owner_email);
  const admin = owner || (kind !== 'guest' && Boolean(granted_admin));
  return {...row, kind, admin, role: owner ? 'owner' : admin ? 'admin' : 'free'};
};

export async function listUsers(env, url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80), offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
  const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
  const where = q ? " WHERE p.user_id LIKE ?2 ESCAPE '\\' OR p.name LIKE ?2 ESCAPE '\\' OR p.email LIKE ?2 ESCAPE '\\'" : '';
  const rows = await env.DB.prepare(`${USER_SELECT.replace('?', '?1')}${where} ORDER BY COALESCE(p.last_login,p.updated_at) DESC LIMIT 25 OFFSET ${offset}`).bind(...(q ? [Date.now(), like] : [Date.now()])).all();
  const total = await env.DB.prepare(`SELECT count(*) n FROM profiles p${where.replaceAll('?2', '?1')}`).bind(...(q ? [like] : [])).first();
  const guests = await env.DB.prepare("SELECT count(*) n FROM profiles WHERE user_id NOT LIKE 'google:%' AND user_id NOT LIKE 'email:%'").first();
  return {users: rows.results.map(row => shape(env, row)), total: total.n, offset, guests: guests.n};
}

export async function userDetail(env, id) {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE p.user_id=?`).bind(Date.now(), id).first();
  return row ? shape(env, row) : null;
}

const ACTIONS = {
  clear_chat: (env, id) => clearTutorConversation(env, id),
  remove_api: async (env, id) => {
    await disconnectAllAntigravity(env, id);
    return env.DB.batch(['ai_google_oauth_states','ai_google_oauth','ai_active_profiles','ai_providers'].map(table => env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(id)));
  },
  revoke_sessions: (env, id) => env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run(),
  reset_progress: (env, id) => env.DB.batch(RESET_TABLES.map(table => env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(id))),
  delete: (env, id) => deleteUserData(env, id)
};

// Returns an error string, or null on success.
export async function userAction(env, adminId, data) {
  const id = data?.id;
  if (typeof id !== 'string' || !id || id.length > 300 || !(await userDetail(env, id))) return 'Không tìm thấy người dùng.';
  if (data.action === 'set_role') {
    if (!['admin', 'free'].includes(data.role) || kindOf(id) === 'guest') return 'Vai trò không hợp lệ.';
    if (await isOwner(env, id)) return 'Chủ sở hữu được quản lý qua ADMIN_EMAILS trên máy chủ.';
    if (id === adminId) return 'Không thể tự thay đổi quyền quản trị tại đây.';
    if (data.role === 'admin') {
      await env.DB.prepare('INSERT OR REPLACE INTO admin_grants(user_id,granted_by,granted_at) VALUES(?,?,?)').bind(id, adminId, new Date().toISOString()).run();
    } else {
      await env.DB.prepare('DELETE FROM admin_grants WHERE user_id=?').bind(id).run();
    }
    return null;
  }
  if (data.action === 'set_level') {
    if (!LEVELS.includes(data.level)) return 'Cấp độ không hợp lệ.';
    await env.DB.prepare('UPDATE profiles SET level=?,updated_at=? WHERE user_id=?').bind(data.level, new Date().toISOString(), id).run();
    return null;
  }
  if (!ACTIONS[data.action]) return 'Thao tác không hợp lệ.';
  if (data.action === 'delete' && await isOwner(env, id)) return 'Không thể xóa chủ sở hữu trong mục quản trị.';
  if (data.action === 'delete' && id === adminId) return 'Không thể tự xóa tài khoản đang dùng tại đây.';
  await ACTIONS[data.action](env, id);
  return null;
}

// Old anonymous profiles (neither Google nor email) cannot sign in again; this removes them and their data.
export async function purgeGuests(env) {
  const ids = (await env.DB.prepare("SELECT user_id FROM profiles WHERE user_id NOT LIKE 'google:%' AND user_id NOT LIKE 'email:%'").all()).results.map(r => r.user_id);
  for (let i = 0; i < ids.length; i += 10) await Promise.all(ids.slice(i, i + 10).map(id => deleteUserData(env, id)));
  return ids.length;
}
