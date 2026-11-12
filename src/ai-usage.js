// API-key and OAuth generations share the same account-level request allowance.
export async function rateLimited(env, userId) {
  const bucket = Math.floor(Date.now() / 60000);
  const usage = await env.DB.prepare('INSERT INTO ai_usage(user_id,bucket,count) VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(userId, bucket).first();
  await env.DB.prepare('DELETE FROM ai_usage WHERE bucket < ?').bind(bucket - 60).run();
  return usage.count > 20;
}
