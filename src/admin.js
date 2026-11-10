// Admin = a Google account whose VERIFIED email is in the ADMIN_EMAILS secret. Password accounts
// have unverified emails, so they can never be admin. Both the grant row and the current secret are checked
// on every request, so removing an email from the secret revokes access immediately.
const emails = env => (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

export async function recordAdminLogin(env, userId, email) {
  if (typeof email !== 'string' || !emails(env).includes(email.toLowerCase())) return;
  await env.DB.prepare('INSERT OR REPLACE INTO admins(user_id,email,granted_at) VALUES(?,?,?)').bind(userId, email.toLowerCase(), new Date().toISOString()).run();
}

export async function isAdmin(env, userId) {
  if (!userId?.startsWith('google:')) return false;
  const row = await env.DB.prepare('SELECT email FROM admins WHERE user_id=?').bind(userId).first();
  return Boolean(row && emails(env).includes(row.email));
}
