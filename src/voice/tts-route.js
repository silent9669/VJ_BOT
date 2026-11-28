import {cleanBaseUrl, DEFAULT_BASES} from '../llm.js';
import {unseal} from '../ai-secrets.js';
import {authoredVoiceReading, normalizeVoiceText, particleReading, voiceBlank} from './normalizer.js';
import {MAX_SEGMENTS, segmentVoiceText} from './segmenter.js';
import {MAX_AUDIO, VOICE_BASES, VoiceError, synthesizeVoice, voiceCatalog, voiceSettings} from './tts-adapters.js';

export const MAX_VOICE_TEXT = 4000;

const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const profileId = /^[\w-]{1,128}$/;
const bad = () => new VoiceError('tts_invalid_routing',400,'Cấu hình điều hướng giọng nói không hợp lệ.');
const denied = () => new VoiceError('tts_profile_unavailable',403,'Kết nối giọng nói đã chọn không dùng được. Hệ thống không dùng khóa thay thế.');

export async function readVoiceBody(request, maxBytes = 32768, signal) {
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = '';
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal?.addEventListener('abort',cancel,{once:true});
  if (signal?.aborted) cancel();
  try {
    for (;;) {
      const {done,value} = await reader.read();
      signal?.throwIfAborted();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {cancel();return null;}
      text += decoder.decode(value,{stream:true});
    }
  } finally {
    signal?.removeEventListener('abort',cancel);
    reader.releaseLock();
  }
}

export function voiceBase(kind, raw, env) {
  if (!Object.hasOwn(VOICE_BASES,kind) || raw !== undefined && typeof raw !== 'string') throw bad();
  const input = raw?.trim();
  if (!input && !VOICE_BASES[kind]) throw bad();
  const protocol = kind === 'gemini' ? 'gemini' : 'openai';
  const base = input?.replace(/\/+$/,'') || VOICE_BASES[kind];
  const result = cleanBaseUrl(protocol,kind==='elevenlabs' ? base : base?.replace(/\/audio\/speech$/,''));
  if (result.error) throw bad();
  const url = new URL(result.url);
  if (url.hostname.endsWith('.') || url.port) throw bad();
  if (kind==='elevenlabs' && url.origin===VOICE_BASES.elevenlabs && /^(?:\/v1)+$/.test(url.pathname)) return url.origin;
  if (result.url === VOICE_BASES[kind]) return result.url;
  const approved = String(env.VOICE_ALLOWED_ORIGINS || '').split(',').some(origin => origin.trim() === url.origin);
  if (!['elevenlabs','mistral','openai_compatible'].includes(kind) || !approved) throw denied();
  return result.url;
}

function storedKind(row) {
  if (row.protocol === 'openai' && row.base_url === VOICE_BASES.mistral) return 'mistral';
  if (row.protocol === 'openai' && row.base_url !== DEFAULT_BASES.openai) return 'openai_compatible';
  return row.protocol;
}

export async function selectConnection(slot, env, userId, admin, override) {
  const profile = slot.profile, kind = slot.provider;
  if (!object(profile) || !Object.hasOwn(VOICE_BASES,kind)) throw bad();
  if (profile.scope === 'platform') {
    if (!admin || override || kind !== 'openai' || profile.id !== 'openai' || !env.OPENAI_API_KEY) throw denied();
    return {kind,baseUrl:VOICE_BASES.openai,apiKey:env.OPENAI_API_KEY};
  }
  if (admin && !override || !admin && override) throw denied();
  let base, apiKey;
  if (profile.scope === 'local') {
    if (!object(profile.connection)) throw bad();
    base = profile.connection.base_url;
    apiKey = profile.connection.api_key;
  } else if (profile.scope === 'server' && typeof profile.id === 'string' && profileId.test(profile.id)) {
    const row = await env.DB.prepare('SELECT protocol,base_url,key_enc FROM ai_providers WHERE user_id=? AND id=?').bind(userId,profile.id).first();
    if (!row || storedKind(row) !== kind) throw denied();
    base = row.base_url;
    apiKey = await unseal(env,userId,row.key_enc);
  } else throw bad();
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw denied();
  const baseUrl = voiceBase(kind,base,env);
  if ([baseUrl,slot.model,slot.voice_id].some(value => typeof value === 'string' && value.includes(apiKey))) throw bad();
  return {kind,baseUrl,apiKey};
}

function routeSlot(routing, lang) {
  const {primary,mode} = routing;
  if (mode === 'single') return primary;
  const choice = routing[lang];
  if (!object(choice)) throw bad();
  if (mode === 'dual_same_api' && (choice.profile != null || choice.provider !== undefined && choice.provider !== primary.provider)) throw bad();
  const inherited = choice.profile == null;
  if (inherited && choice.provider !== undefined && choice.provider !== primary.provider) throw bad();
  return inherited ? {...primary,...choice,profile:primary.profile} : choice;
}

const problem = error => error instanceof VoiceError ? error : new VoiceError('tts_unavailable',502);

function streamAudio(segments, signal, elevenConcurrency) {
  const encoder = new TextEncoder(), abort = new AbortController();
  const combined = AbortSignal.any([signal,abort.signal]);
  const pending = new Map(), inFlight = new Map();
  let index = 0, bytes = 0, failedAt = segments.length;
  const line = row => encoder.encode(JSON.stringify(row) + '\n');
  return new Response(new ReadableStream({
    async pull(controller) {
      if (signal.aborted) {controller.error(signal.reason);return;}
      if (index === segments.length) {controller.enqueue(line({type:'done',count:index}));controller.close();return;}
      for (let candidate = index; candidate < Math.min(index + 4,failedAt); candidate++) {
        if (pending.has(candidate)) continue;
        const next = segments[candidate], {kind,baseUrl,apiKey} = next.provider;
        const connection = kind === 'elevenlabs' ? (elevenConcurrency === 1 ? 'elevenlabs' : baseUrl + '\0' + apiKey) : null;
        if (connection && (inFlight.get(connection) || 0) >= elevenConcurrency) continue;
        if (connection) inFlight.set(connection,(inFlight.get(connection) || 0) + 1);
        pending.set(candidate,synthesizeVoice(next,next.provider,combined)
          .then(audio => ({audio}),error => {
            failedAt = Math.min(failedAt,candidate);
            return {error:problem(error)};
          })
          .finally(() => {if (connection) inFlight.set(connection,inFlight.get(connection) - 1);}));
      }
      const result = await pending.get(index);
      if (abort.signal.aborted) return;
      if (signal.aborted) {controller.error(signal.reason);return;}
      pending.delete(index);
      bytes += result.audio?.bytes ?? 0;
      const error = result.error ?? (bytes > MAX_AUDIO ? new VoiceError('tts_audio_limit',502) : null);
      if (error) {
        abort.abort();
        controller.enqueue(line({type:'error',index,code:error.code,detail:error.message}));
        controller.close();
        return;
      }
      const {lang,boundary,voice,model} = segments[index];
      const {audioBase64,mimeType,speed} = result.audio;
      controller.enqueue(line({type:'segment',index:index++,lang,boundary,speed,voice,model,audioBase64,mimeType}));
    },
    cancel() {abort.abort();pending.clear();}
  }),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'}});
}

export async function voiceTts(body,env,{userId,admin=false,signal=new AbortController().signal}) {
  try {
    const {routing} = body;
    if (!object(routing) || routing.version !== 2 || !['single','dual_same_api','dual_split_api'].includes(routing.mode) || !object(routing.primary)
      || routing.admin_override !== undefined && typeof routing.admin_override !== 'boolean') throw bad();
    const override = routing.admin_override === true;
    if (body.action === 'catalog') {
      const cursor = body.cursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512)) throw bad();
      return json(await voiceCatalog(await selectConnection(routing.primary,env,userId,admin,override),signal,cursor));
    }
    const mode = body.mode ?? 'bilingual';
    if (body.action !== undefined || body.stream !== true || typeof body.text !== 'string' || !body.text.trim()
      || !['ja','bilingual'].includes(mode) || body.serial !== undefined && typeof body.serial !== 'boolean') throw bad();
    if (body.text.length > MAX_VOICE_TEXT || typeof body.reading === 'string' && body.reading.length > MAX_VOICE_TEXT)
      throw new VoiceError('tts_text_limit',413,'Đoạn cần đọc không được dài quá 4000 ký tự.');
    const ja = routeSlot(routing,'ja');
    const kanjiMode = ja.kanji_mode ?? 'kanji_native';
    if (!['kanji_native','kana_first'].includes(kanjiMode)) throw bad();
    const input = normalizeVoiceText(body.text,{kanjiMode});
    const reading = mode === 'ja' && !voiceBlank.test(input) ? authoredVoiceReading(body.reading) : '';
    const mixLanguages = routing.mode === 'single' && routing.primary.provider === 'mistral';
    const chunks = reading ? [{lang:'ja',text:reading,boundary:'start'}]
      : segmentVoiceText(input,mode,{mixLanguages,splitBlanks:true});
    if (!chunks) throw new VoiceError('tts_segment_limit',413,`Đoạn cần đọc có quá ${MAX_SEGMENTS} phần. Hãy chọn đoạn ngắn hơn.`);
    if (!chunks.length) throw new VoiceError('tts_no_text',400,'Không có chữ để đọc.');
    for (const chunk of chunks) {
      if (!reading && (mixLanguages || chunk.lang === 'ja')) chunk.text = particleReading(chunk.text);
    }
    const routes = new Map();
    for (const {lang} of chunks) {
      if (routes.has(lang)) continue;
      const slot = routeSlot(routing,lang), speed = slot.speed ?? 1;
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.5 || speed > 2) throw bad();
      if (slot.native_speed !== undefined && (slot.provider !== 'openai_compatible' || typeof slot.native_speed !== 'boolean')) throw bad();
      const settings = voiceSettings(slot.provider,slot,lang,routing.mode === 'single');
      const provider = await selectConnection(slot,env,userId,admin,override);
      if (slot.profile.scope === 'platform' && chunks.length > 8)
        throw new VoiceError('tts_segment_limit',413,'Giọng máy chủ hỗ trợ tối đa 8 phần. Hãy chọn đoạn ngắn hơn.');
      routes.set(lang,{provider,speed,native_speed:slot.native_speed,...settings});
    }
    return streamAudio(chunks.map((chunk,index) => ({...chunk,...routes.get(chunk.lang),
      prevText:chunks[index-1]?.lang === chunk.lang ? chunks[index-1].text : undefined,
      nextText:chunks[index+1]?.lang === chunk.lang ? chunks[index+1].text : undefined})),signal,body.serial === true ? 1 : 2);
  } catch (error) {
    const failure = problem(error);
    return json({detail:failure.message,code:failure.code},failure.status);
  }
}
