const LEASE_MS = 60000;
const INTENTS = new Set(['message', 'start', 'hint', 'explain', 'situation', 'check', 'summary', 'restart']);

export const validTutorIntent = value => typeof value === 'string' && INTENTS.has(value);

export async function requestFingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// A database claim, not an isolate-local promise, prevents duplicate paid generations.
export async function claimTutorRequest(env, userId, scope, requestId, fingerprint, now = Date.now()) {
  const token = crypto.randomUUID();
  const previous = await env.DB.prepare('SELECT * FROM tutor_requests WHERE user_id=? AND request_id=?').bind(userId, requestId).first();
  if (previous && (previous.context_key !== scope || previous.fingerprint !== fingerprint)) return {error: 'Request ID belongs to another message or conversation.'};
  if (!previous) {
    const legacy = await env.DB.prepare('SELECT id FROM conversations WHERE user_id=? AND request_id=? LIMIT 1').bind(userId, requestId).first();
    if (legacy) return {error: 'This older request cannot be replayed. Send it as a new message.'};
  }
  await env.DB.prepare("INSERT INTO tutor_requests(user_id,request_id,context_key,fingerprint,status,lease_token,lease_expires) VALUES(?,?,?,?,'pending',?,?) ON CONFLICT(user_id,request_id) DO NOTHING")
    .bind(userId, requestId, scope, fingerprint, token, now + LEASE_MS).run();
  const row = await env.DB.prepare('SELECT * FROM tutor_requests WHERE user_id=? AND request_id=?').bind(userId, requestId).first();
  if (!row || row.context_key !== scope || row.fingerprint !== fingerprint) return {error: 'Request ID belongs to another message or conversation.'};
  if (row.status === 'complete') {
    const saved = await env.DB.prepare("SELECT content FROM conversations WHERE user_id=? AND request_id=? AND context_key=? AND role='bot'").bind(userId, requestId, scope).first();
    return saved ? {cached: saved.content} : {error: 'The saved response is unavailable. Send a new message.'};
  }
  if (row.lease_token === token) return {token};
  const renewed = await env.DB.prepare("UPDATE tutor_requests SET lease_token=?,lease_expires=? WHERE user_id=? AND request_id=? AND status='pending' AND lease_expires<=? RETURNING lease_token")
    .bind(token, now + LEASE_MS, userId, requestId, now).first();
  return renewed ? {token} : {error: 'This message is still being answered. Retry after it finishes.'};
}

export async function claimTutorScope(env, userId, scope, token, now = Date.now()) {
  await env.DB.prepare('INSERT INTO tutor_sessions(user_id,context_key) VALUES(?,?) ON CONFLICT(user_id,context_key) DO NOTHING').bind(userId, scope).run();
  const row = await env.DB.prepare("UPDATE tutor_sessions SET lease_token=?,lease_expires=? WHERE user_id=? AND context_key=? AND (lease_token IS NULL OR lease_expires<=?) AND EXISTS(SELECT 1 FROM tutor_requests WHERE user_id=? AND context_key=? AND lease_token=? AND status='pending' AND lease_expires>?) RETURNING state_json,history_after,revision")
    .bind(token, now + LEASE_MS, userId, scope, now, userId, scope, token, now).first();
  if (!row) return null;
  const state = row.state_json ? JSON.parse(row.state_json) : null;
  return {state, historyAfter: row.history_after, revision: row.revision};
}
// Recheck after provider/key resolution, immediately before starting the upstream request.
export async function renewTutorClaim(env, userId, scope, requestId, token, now = Date.now()) {
  const request = await env.DB.prepare("UPDATE tutor_requests SET lease_expires=? WHERE user_id=? AND request_id=? AND lease_token=? AND status='pending' AND lease_expires>? AND EXISTS(SELECT 1 FROM tutor_sessions WHERE user_id=? AND context_key=? AND lease_token=? AND lease_expires>?) RETURNING lease_token")
    .bind(now + LEASE_MS, userId, requestId, token, now, userId, scope, token, now).first();
  if (!request) return false;
  const session = await env.DB.prepare("UPDATE tutor_sessions SET lease_expires=? WHERE user_id=? AND context_key=? AND lease_token=? AND lease_expires>? AND EXISTS(SELECT 1 FROM tutor_requests WHERE user_id=? AND request_id=? AND lease_token=? AND status='pending' AND lease_expires>?) RETURNING lease_token")
    .bind(now + LEASE_MS, userId, scope, token, now, userId, requestId, token, now).first();
  return Boolean(session);
}


export async function releaseTutorClaim(env, userId, scope, requestId, token) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tutor_requests WHERE user_id=? AND request_id=? AND lease_token=? AND status='pending'").bind(userId, requestId, token),
    env.DB.prepare('UPDATE tutor_sessions SET lease_token=NULL,lease_expires=0 WHERE user_id=? AND context_key=? AND lease_token=?').bind(userId, scope, token)
  ]);
}

export function nextTeachingState(previous, result, intent, lesson, focus) {
  const prior = intent === 'restart' ? null : previous;
  const preserved = ['hint', 'explanation', 'clarify'].includes(result.action);
  const probe = preserved ? prior?.probe || result.open_probe : result.open_probe;
  const finished = ['summary', 'solution'].includes(result.action);
  return {
    probe: finished ? null : probe,
    hint_stage: finished ? 0 : result.action === 'hint' ? Math.min(2, (prior?.hint_stage || 0) + 1) : preserved ? prior?.hint_stage || 0 : 0,
    awaiting: finished || !probe ? 'none' : result.action === 'clarify' ? 'clarification' : intent === 'explain' ? 'explanation' : 'answer',
    lesson: lesson ? {id: lesson.id, level: lesson.level} : null,
    focus: focus || null
  };
}

// All writes are fenced by both leases. A stale generation cannot append a turn after a
// new owner, history deletion or account deletion has invalidated its session.
export async function commitTutorTurn(env, data) {
  const {userId, scope, requestId, token, message, reply, state, historyAfter} = data;
  const guard = "EXISTS(SELECT 1 FROM tutor_sessions WHERE user_id=? AND context_key=? AND lease_token=?) AND EXISTS(SELECT 1 FROM tutor_requests WHERE user_id=? AND request_id=? AND lease_token=? AND status='pending')";
  const fence = [userId, scope, token, userId, requestId, token];
  const timestamp = new Date().toISOString();
  const insert = role => env.DB.prepare(`INSERT INTO conversations(user_id,role,content,timestamp,request_id,context_key) SELECT ?,?,?,?,?,? WHERE ${guard}`)
    .bind(userId, role, role === 'user' ? message : reply, timestamp, requestId, scope, ...fence);
  await env.DB.batch([
    insert('user'), insert('bot'),
    env.DB.prepare(`UPDATE tutor_sessions SET state_json=?,history_after=?,revision=revision+1 WHERE user_id=? AND context_key=? AND lease_token=? AND ${guard}`)
      .bind(JSON.stringify(state), historyAfter, userId, scope, token, ...fence),
    env.DB.prepare("UPDATE tutor_requests SET status='complete',lease_expires=0 WHERE user_id=? AND request_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM tutor_sessions WHERE user_id=? AND context_key=? AND lease_token=?)")
      .bind(userId, requestId, token, userId, scope, token),
    env.DB.prepare('UPDATE tutor_sessions SET lease_token=NULL,lease_expires=0 WHERE user_id=? AND context_key=? AND lease_token=?').bind(userId, scope, token)
  ]);
  const saved = await env.DB.prepare("SELECT c.content FROM conversations c JOIN tutor_requests r ON r.user_id=c.user_id AND r.request_id=c.request_id WHERE c.user_id=? AND c.request_id=? AND c.context_key=? AND c.role='bot' AND r.lease_token=? AND r.status='complete'").bind(userId, requestId, scope, token).first();
  return saved?.content || null;
}

export function clearTutorConversation(env, userId, scope = null) {
  const suffix = scope === null ? 'WHERE user_id=?' : 'WHERE user_id=? AND context_key=?';
  const values = scope === null ? [userId] : [userId, scope];
  return env.DB.batch(['conversations', 'tutor_sessions', 'tutor_requests'].map(table => env.DB.prepare(`DELETE FROM ${table} ${suffix}`).bind(...values)));
}
