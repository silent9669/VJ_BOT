export const ADMIN_MODELS = [
  {id:'gpt-4.1-mini', efforts:[]},
  {id:'gpt-5-mini', efforts:['low','medium','high']},
  {id:'gpt-5.4-mini', efforts:['none','low','medium','high','xhigh']},
  {id:'gpt-5.4', efforts:['none','low','medium','high','xhigh']}
];
export const LIVE_VOICES = ['shida','harema','marin','cedar'];

export async function adminAISettings(env, userId) {
  const row = await env.DB.prepare('SELECT model,reasoning_effort,live_voice FROM admin_ai_preferences WHERE user_id=?').bind(userId).first();
  return {model:row?.model || env.OPENAI_MODEL || 'gpt-4.1-mini',
    reasoning_effort:row?.reasoning_effort || '', live_model:'gpt-live-1', live_voice:row?.live_voice || 'shida'};
}

export async function saveAdminAISettings(env, userId, data) {
  const model = ADMIN_MODELS.find(item => item.id === data.model);
  if (!model || !LIVE_VOICES.includes(data.live_voice) || typeof data.reasoning_effort !== 'string'
    || (model.efforts.length ? !model.efforts.includes(data.reasoning_effort) : data.reasoning_effort !== '')) return false;
  await env.DB.prepare(`INSERT INTO admin_ai_preferences(user_id,model,reasoning_effort,live_voice) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET model=excluded.model,reasoning_effort=excluded.reasoning_effort,live_voice=excluded.live_voice`)
    .bind(userId, data.model, data.reasoning_effort, data.live_voice).run();
  return true;
}
