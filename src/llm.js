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
const GEMINI_INCOMPLETE = new Set(['MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII',
  'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION']);

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

// Compatible endpoints reject top-level string length keywords. Runtime parsers retain these bounds.
function wireSchema(schema) {
  if (!schema.properties) return schema;
  return {...schema, properties: Object.fromEntries(Object.entries(schema.properties).map(([name, field]) => {
    const {minLength, maxLength, ...wireField} = field;
    return [name, wireField];
  }))};
}

function request(protocol, key, model, {system, turns, schema, schemaName, reasoningEffort}) {
  if (protocol === 'openai') {
    // No max_tokens or temperature: newer OpenAI models reject both. Reply length is bounded by the prompt.
    return {headers: {Authorization: `Bearer ${key}`}, body: {model, messages: [...(system ? [{role: 'system', content: system}] : []), ...turns],
      ...(reasoningEffort ? {reasoning_effort:reasoningEffort} : {}),
      ...(schema ? {response_format: {type: 'json_schema', json_schema: {name: ['tutor_reply','voice_translation'].includes(schemaName) ? schemaName : 'kaiwa_evaluation', strict: true, schema}}} : {})}};
  }
  if (protocol === 'anthropic') {
    return {headers: {'x-api-key': key, 'anthropic-version': '2023-06-01'}, body: {model, max_tokens: 1024, ...(system ? {system} : {}), messages: turns,
      ...(schema ? {output_config: {format: {type: 'json_schema', schema}}} : {})}};
  }
  return {
    headers: {'x-goog-api-key': key},
    body: {
      ...(system ? {systemInstruction: {parts: [{text: system}]}} : {}),
      contents: turns.map(t => ({role: t.role === 'assistant' ? 'model' : 'user', parts: [{text: t.content}]})),
      ...(schema ? {generationConfig: {responseMimeType: 'application/json', responseJsonSchema: schema}} : {})
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

// Missing stop metadata is common in compatible proxies; only explicit incomplete/blocked states reject text.
function incomplete(protocol, data) {
  if (protocol === 'openai') return ['length', 'content_filter'].includes(data.choices?.[0]?.finish_reason);
  if (protocol === 'anthropic') return ['max_tokens', 'refusal'].includes(data.stop_reason);
  const candidate = data.candidates?.[0], feedback = data.promptFeedback;
  return GEMINI_INCOMPLETE.has(candidate?.finishReason)
    || Boolean(feedback?.blockReason && feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED')
    || Boolean(feedback?.safetyRatings?.some(rating => rating.blocked)
      || candidate?.safetyRatings?.some(rating => rating.blocked));
}

// Tries provider.models in order (fallback on 404/429/5xx) inside one budget below the browser's 35s timeout.
// Returns {text} or {status}; provider error bodies are never returned because proxies can echo headers back.
export async function callLLM(provider, {system, turns, schema, schemaName}, {budgetMs = 28000, attemptMs = provider.reasoningEffort && provider.reasoningEffort!=='none' ? 27000 : 15000} = {}) {
  schema = schema ? wireSchema(schema) : schema;
  const deadline = Date.now() + budgetMs, history = normalizeTurns(turns);
  let status = 503, retryAfterMs;
  for (const model of provider.models) {
    const left = deadline - Date.now();
    if (left < 1000) break;
    try {
      const {headers, body} = request(provider.protocol, provider.apiKey, model, {system, turns: history, schema, schemaName, reasoningEffort:provider.reasoningEffort});
      const response = await fetch(endpoint(provider.protocol, provider.baseUrl, model), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(Math.min(left, attemptMs)),
        headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)
      });
      if (response.ok) {
        const raw = await response.text();
        if (raw.length <= 400000) {
          const data = JSON.parse(raw), text = incomplete(provider.protocol, data) ? '' : textOf(provider.protocol, data);
          if (text) { console.log('AI ok', provider.source, model); return {text}; }
        }
        status = 502;
        continue;
      }
      status = response.status >= 300 && response.status < 400 ? 502 : response.status;
      retryAfterMs = undefined;
      if (status === 429) {
        const raw = response.headers.get('Retry-After');
        const delay = raw && (/^\d+(?:\.\d+)?$/.test(raw.trim())
          ? Number(raw) * 1000 : Date.parse(raw) - Date.now());
        if (raw && Number.isFinite(delay)) retryAfterMs = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(delay)));
      }
      console.warn('AI', provider.source, model, status);
      if (!RETRYABLE.has(status)) break;
    } catch (error) {
      console.warn('AI', provider.source, model, error.name);
      status = 504;
    }
  }
  return {status, ...(status === 429 && retryAfterMs !== undefined ? {retryAfterMs} : {})};
}

// Draft eligibility only: one generation, stopping at the first visible text rather than its final answer.
// The same deadline covers headers and body; cancelling never waits for the provider to finish.
export async function probeModel(provider, {signal} = {}) {
  if (signal?.aborted) return {status: 504};
  const controller = new AbortController(), abort = () => controller.abort(), deadline = Date.now() + 15000;
  const timer = setTimeout(abort, 15000);
  signal?.addEventListener('abort', abort, {once: true});
  const aborted = new Promise(resolve => {
    controller.signal.addEventListener('abort', () => resolve(null), {once: true});
  });
  let response, reader, status = 504;
  try {
    const {protocol, baseUrl, apiKey, models} = provider;
    const {headers, body} = request(protocol, apiKey, models[0], {
      turns: [{role: 'user', content: 'Reply with the single word OK.'}]
    });
    let url = endpoint(protocol, baseUrl, models[0]);
    if (protocol === 'gemini') {
      url = url.replace(/:generateContent$/, ':streamGenerateContent?alt=sse');
      body.generationConfig = {maxOutputTokens: 128};
    } else {
      body.stream = true;
      if (protocol === 'anthropic') body.max_tokens = 128;
    }
    response = await Promise.race([fetch(url, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers},
      body: JSON.stringify(body)
    }), aborted]);
    if (controller.signal.aborted) return {status: 504};
    if (!response.ok) {
      status = response.status >= 300 && response.status < 400 ? 502 : response.status;
      const raw = status === 429 && response.headers.get('Retry-After');
      const delay = raw && (/^\d+(?:\.\d+)?$/.test(raw.trim())
        ? Number(raw) * 1000 : Date.parse(raw) - Date.now());
      return {status, ...(raw && Number.isFinite(delay)
        ? {retryAfterMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(delay)))} : {})};
    }
    status = 502;
    if (!response.body) return {status};
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let bytes = 0, buffer = '', scan = 0;
    let mode = /(?:\/|\+)json\b/i.test(response.headers.get('Content-Type') || '') ? 'json' : '';
    let event = '', data = [];
    const line = value => {
      if (!value) {
        if (event === 'error') throw new Error('Provider stream error');
        const result = data.length ? probeEvent(protocol, data.join('\n')) : null;
        event = ''; data = [];
        return result;
      }
      const colon = value.indexOf(':'), field = colon < 0 ? value : value.slice(0, colon);
      const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = content;
      if (field === 'data') data.push(content);
      return null;
    };
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (Date.now() >= deadline) controller.abort();
      if (controller.signal.aborted) return {status: 504};
      const {done, value} = chunk;
      if (value) {
        bytes += value.byteLength;
        if (bytes > 256 * 1024) return {status: 502};
        buffer += decoder.decode(value, {stream: true});
      }
      if (done) buffer += decoder.decode();
      if (!mode && buffer.trimStart()) mode = /^[{\[]/.test(buffer.trimStart()) ? 'json' : 'sse';
      if (mode === 'sse') {
        let start = 0, i = scan;
        for (; i < buffer.length; i++) {
          if (buffer[i] !== '\r' && buffer[i] !== '\n') continue;
          if (buffer[i] === '\r' && i === buffer.length - 1 && !done) break;
          const result = line(buffer.slice(start, i));
          if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++;
          start = i + 1;
          if (result?.text) return result;
          if (result?.done) return {status: 502};
        }
        buffer = buffer.slice(start);
        scan = i - start;
      }
      if (done) {
        // JSON is accepted only after EOF; a truncated SSE event is never a successful probe.
        const text = mode === 'json' ? probeText(protocol, JSON.parse(buffer)) : '';
        return text ? {text} : {status: 502};
      }
    }
  } catch {
    return {status: controller.signal.aborted ? 504 : status};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
    // Some providers leave cancellation pending. Do not delay the first-token result on their cleanup.
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}

function probeText(protocol, data, streaming = false) {
  if (data.error || data.type === 'error') throw new Error('Provider stream error');
  if (protocol === 'openai') {
    let content = data.choices?.[0]?.[streaming ? 'delta' : 'message']?.content;
    if (Array.isArray(content)) content = content.filter(part => part && !part.thought
      && (!part.type || ['text', 'output_text'].includes(part.type)) && typeof part.text === 'string');
    if (typeof content !== 'string' && !Array.isArray(content)) return '';
    return textOf(protocol, {choices: [{message: {content}}]});
  }
  if (protocol === 'anthropic' && streaming) {
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
      return typeof data.delta.text === 'string' ? data.delta.text.trim() : '';
    }
    return data.type === 'content_block_start' && data.content_block?.type === 'text'
      && typeof data.content_block.text === 'string' ? data.content_block.text.trim() : '';
  }
  if (protocol === 'anthropic') {
    return textOf(protocol, {content: Array.isArray(data.content)
      ? data.content.filter(part => part?.type === 'text' && typeof part.text === 'string') : []});
  }
  const parts = data.candidates?.[0]?.content?.parts;
  return textOf(protocol, {candidates: [{content: {parts: Array.isArray(parts)
    ? parts.filter(part => typeof part?.text === 'string' && !part.thought) : []}}]});
}

function probeEvent(protocol, raw) {
  if (raw.trim() === '[DONE]') return {done: true};
  const data = JSON.parse(raw), text = probeText(protocol, data, true);
  if (text) return {text};
  return data.type === 'message_stop' || data.choices?.[0]?.finish_reason || data.candidates?.[0]?.finishReason
    ? {done: true} : null;
}

export function failureMessage(status) {
  if (status === 401) return 'The provider rejected this API key. It may be invalid, expired or revoked.';
  if (status === 402) return 'The provider requires credits or a higher spending limit for this model.';
  if (status === 403) return 'The provider denied access to this model or endpoint. Check key permissions and provider policies.';
  if (status === 429) return 'The provider rate limit or quota was reached. Model access is not verified; try later.';
  if (status === 404 || status === 400) return 'The endpoint, model or request is not supported. Check your settings.';
  if (status === 504) return 'The provider timed out. Model access is not verified; try later.';
  return 'The provider request failed. Model access is not verified.';
}

// Discovery does not generate content. Never follow a provider redirect with credentials.
export async function listModels({protocol, baseUrl, apiKey}) {
  const base = cleanBaseUrl(protocol, baseUrl);
  if (base.error) return {status: 400};
  const openRouter = protocol === 'openai' && base.url === 'https://openrouter.ai/api/v1';
  const siliconFlow = protocol === 'openai' && ['https://api.siliconflow.com/v1', 'https://api.siliconflow.cn/v1'].includes(base.url);
  const suffix = protocol === 'openai' ? '/models' : protocol === 'anthropic'
    ? `${base.url.endsWith('/v1') ? '' : '/v1'}/models` : '/v1beta/models';
  const endpoint = base.url + (openRouter ? '/models/user' : suffix);
  const headers = protocol === 'openai' ? {Authorization: `Bearer ${apiKey}`}
    : protocol === 'anthropic' ? {'x-api-key': apiKey, 'anthropic-version': '2023-06-01'}
    : {'x-goog-api-key': apiKey};
  const signal = AbortSignal.timeout(10000);
  const models = new Set(), cursors = new Set();
  let freeOnly = false;
  const catalog = truncated => ({models: [...models].sort(), truncated,
    scope: openRouter ? 'key_filtered' : 'provider_catalog', free_only: freeOnly});
  let cursor = '';
  try {
    if (openRouter) {
      const response = await fetch(base.url + '/key', {headers, redirect: 'manual', signal});
      if (!response.ok) {
        await response.body?.cancel();
        return {status: response.status >= 300 && response.status < 400 ? 502 : response.status};
      }
      const {data: key} = await modelPage(response);
      if (!key || typeof key.is_free_tier !== 'boolean'
        || !(key.limit_remaining === null || Number.isFinite(key.limit_remaining))) return {status: 502};
      if (key.expires_at && (!Number.isFinite(Date.parse(key.expires_at)) || Date.parse(key.expires_at) <= Date.now())) return {status: 401};
      freeOnly = key.is_free_tier || key.limit === 0
        || (key.limit_remaining !== null && key.limit_remaining <= 0)
        || (Number.isFinite(key.effective_budget?.remaining_usd) && key.effective_budget.remaining_usd <= 0);
    }
    for (let page = 0; page < 5; page++) {
      const url = new URL(endpoint);
      if (openRouter) url.searchParams.set('output_modalities', 'text');
      if (siliconFlow) url.searchParams.set('sub_type', 'chat');
      if (protocol === 'gemini') url.searchParams.set('pageSize', '1000');
      if (protocol === 'anthropic') url.searchParams.set('limit', '1000');
      if (cursor) url.searchParams.set(protocol === 'gemini' ? 'pageToken' : 'after_id', cursor);
      const response = await fetch(url.href, {headers, redirect: 'manual', signal});
      if (!response.ok) {
        await response.body?.cancel();
        return {status: response.status >= 300 && response.status < 400 ? 502 : response.status};
      }
      const data = await modelPage(response);
      const rows = protocol === 'gemini' ? data.models : data.data;
      if (!Array.isArray(rows)) return {status: 502};
      for (const row of rows) {
        if (openRouter && Array.isArray(row?.architecture?.output_modalities) && !row.architecture.output_modalities.includes('text')) continue;
        if (freeOnly && !freeTextPricing(row?.pricing)) continue;
        if (protocol === 'gemini' && (!Array.isArray(row?.supportedGenerationMethods) || !row.supportedGenerationMethods.includes('generateContent'))) continue;
        const id = protocol === 'gemini' ? row?.name?.replace(/^models\//, '') : row?.id;
        if (typeof id === 'string' && id.length <= 100 && /^~?[\w.:\/-]+$/.test(id)
          && !(apiKey && id.includes(apiKey))) models.add(id);
        if (models.size === 1000) return catalog(true);
      }
      const next = protocol === 'gemini' ? data.nextPageToken : data.has_more ? data.last_id : '';
      if (!next) {
        if (data.has_more) return {status: 502};
        return catalog(false);
      }
      if (typeof next !== 'string' || next.length > 2048 || cursors.has(next)) return {status: 502};
      cursors.add(next);
      cursor = next;
    }
    return catalog(true);
  } catch {
    return {status: signal.aborted ? 504 : 502};
  }
}

// Unknown pricing is not evidence that a model is free.
function freeTextPricing(pricing) {
  const zero = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value)) && Number(value) === 0;
  return pricing && zero(pricing.prompt) && zero(pricing.completion)
    && (pricing.request === undefined || zero(pricing.request))
    && (pricing.internal_reasoning === undefined || zero(pricing.internal_reasoning));
}

async function modelPage(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, raw = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4000000) throw new Error('Model catalog is too large');
      raw += decoder.decode(value, {stream: true});
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    await reader.cancel();
  }
}
