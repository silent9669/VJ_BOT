const reasoning=['low','medium','high'];
const deepReasoning=[...reasoning,'xhigh','max'];
export const ADMIN_MODELS = [
  {id:'gpt-6.1-sol',label:'GPT-6.1 Sol',efforts:deepReasoning},
  {id:'gpt-6.1-terra',label:'GPT-6.1 Terra',efforts:['none',...deepReasoning]},
  {id:'gpt-6-luna',label:'GPT-6 Luna',efforts:['none',...deepReasoning]},
  {id:'gpt-6-sol',label:'GPT-6 Sol',efforts:['none',...deepReasoning]},
  {id:'gpt-6-astra',label:'GPT-6 Astra',efforts:deepReasoning},
  {id:'gpt-5.5',label:'GPT-5.5',efforts:[...reasoning,'xhigh']},
  {id:'gpt-5.4',label:'GPT-5.4',efforts:['none',...reasoning,'xhigh']},
  {id:'gpt-5.4-mini',label:'GPT-5.4 mini',efforts:['none',...reasoning,'xhigh']},
  {id:'gpt-5-mini',label:'GPT-5 mini',efforts:reasoning},
  {id:'gpt-4.1',label:'GPT-4.1',efforts:[]},
  {id:'gpt-4.1-mini',label:'GPT-4.1 mini',efforts:[]},
  {id:'gpt-4o',label:'GPT-4o',efforts:[]},
  {id:'o3',label:'o3',efforts:reasoning}
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
