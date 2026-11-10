// One chat call over three wire formats: OpenAI-compatible, Anthropic (Claude) and Gemini native.
// A provider is {protocol, baseUrl, apiKey, models}. Never build one from fields of two different sources.
export const DEFAULT_BASES = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com'
};
const SUFFIX = {openai: /\/chat\/completions$/, anthropic: /\/v1\/messages$/, gemini: /\/v1(beta)?$/};
// Hosts a learner-supplied URL must never reach: local names, our own Worker, IP literals.
const BLOCKED_HOST = /(^|\.)(localhost|local|internal|localdomain|home|lan|workers\.dev|dangphuc\.me)$/i;
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

export function cleanBaseUrl(protocol, raw) {
  if (!DEFAULT_BASES[protocol]) return {error: 'Loại API không hợp lệ.'};
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return {url: DEFAULT_BASES[protocol]};
  let url;
  try { url = new URL(text); } catch { return {error: 'URL không hợp lệ.'}; }
  const host = url.hostname;
  if (text.length > 200 || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || BLOCKED_HOST.test(host)) {
    return {error: 'URL phải là https công khai, không kèm tài khoản, tham số hay địa chỉ IP.'};
  }
  const path = url.pathname.replace(/\/+$/, '').replace(SUFFIX[protocol], '');
  return {url: url.origin + path};
}

function endpoint(protocol, base, model) {
  if (protocol === 'openai') return `${base}/chat/completions`;
  if (protocol === 'anthropic') return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  return `${base}${/\/v1(beta)?$/.test(base) ? '' : '/v1beta'}/models/${encodeURIComponent(model)}:generateContent`;
}

// Anthropic needs the first turn from the user; every protocol is happier with strict alternation.
export function normalizeTurns(turns) {
  const out = [];
  for (const turn of turns) {
    if (!turn.content?.trim()) continue;
    if (!out.length && turn.role !== 'user') continue;
    if (out.at(-1)?.role === turn.role) out.at(-1).content += '\n\n' + turn.content;
    else out.push({role: turn.role, content: turn.content});
  }
  return out;
}

function request(protocol, key, model, {system, turns, json}) {
  if (protocol === 'openai') {
    // No max_tokens or temperature: newer OpenAI models reject both. Reply length is bounded by the prompt.
    return {headers: {Authorization: `Bearer ${key}`}, body: {model, messages: [...(system ? [{role: 'system', content: system}] : []), ...turns]}};
  }
  if (protocol === 'anthropic') {
    return {headers: {'x-api-key': key, 'anthropic-version': '2023-06-01'}, body: {model, max_tokens: 1024, ...(system ? {system} : {}), messages: turns}};
  }
  return {
    headers: {'x-goog-api-key': key},
    body: {
      ...(system ? {systemInstruction: {parts: [{text: system}]}} : {}),
      contents: turns.map(t => ({role: t.role === 'assistant' ? 'model' : 'user', parts: [{text: t.content}]})),
      ...(json ? {generationConfig: {responseMimeType: 'application/json'}} : {})
    }
  };
}

function textOf(protocol, data) {
  if (protocol === 'openai') {
    const content = data.choices?.[0]?.message?.content;
    return (Array.isArray(content) ? content.map(p => p.text || '').join('') : content || '').trim();
  }
  if (protocol === 'anthropic') return (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('').trim();
  return (data.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
}

// Tries provider.models in order (fallback on 404/429/5xx) inside one budget below the browser's 35s timeout.
// Returns {text} or {status}; provider error bodies are never returned because proxies can echo headers back.
export async function callLLM(provider, {system, turns, json = false}, {budgetMs = 28000, attemptMs = 15000} = {}) {
  const deadline = Date.now() + budgetMs, history = normalizeTurns(turns);
  let status = 503;
  for (const model of provider.models) {
    const left = deadline - Date.now();
    if (left < 1000) break;
    try {
      const {headers, body} = request(provider.protocol, provider.apiKey, model, {system, turns: history, json});
      const response = await fetch(endpoint(provider.protocol, provider.baseUrl, model), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(Math.min(left, attemptMs)),
        headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)
      });
      if (response.ok) {
        const raw = await response.text();
        if (raw.length <= 400000) {
          const text = textOf(provider.protocol, JSON.parse(raw));
          if (text) { console.log('AI ok', provider.source, model); return {text}; }
        }
        status = 502;
        continue;
      }
      status = response.status >= 300 && response.status < 400 ? 502 : response.status;
      console.warn('AI', provider.source, model, status);
      if (!RETRYABLE.has(status)) break;
    } catch (error) {
      console.warn('AI', provider.source, model, error.name);
      status = 504;
    }
  }
  return {status};
}

export function failureMessage(status) {
  if (status === 429) return 'API của bạn báo hết lượt. Hãy thử lại sau ít phút.';
  if (status === 401 || status === 403) return 'API key bị từ chối. Kiểm tra lại trong Cài đặt.';
  if (status === 404 || status === 400) return 'Endpoint hoặc model không đúng. Kiểm tra lại trong Cài đặt.';
  return 'API của bạn chưa kết nối được. Vui lòng thử lại sau.';
}
