import {sessionUser} from '../auth.js';
import {isAdmin} from '../admin.js';
import {resolveProvider} from '../providers.js';
import {ANTIGRAVITY_PROFILE} from '../antigravity-gateway.js';
import {rateLimited} from '../ai-usage.js';
import {catalogLesson, processingAllowed, teacherCatalog, validLessonReference} from '../tutor-context.js';
import {lessonVocabulary} from '../live.js';
import {VOICE_BASES, VOICE_BILLING_DETAIL, VoiceError} from './tts-adapters.js';
import {readVoiceBody, selectConnection} from './tts-route.js';

const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const MAX_AUDIO = 2 * 1024 * 1024;
const MAX_REQUEST = 3 * 1024 * 1024;
const MAX_RESPONSE = 256 * 1024;
const formats = {'audio/webm':'webm','audio/mp4':'mp4','audio/ogg':'ogg','audio/wav':'wav','audio/mpeg':'mp3'};
const engines = {
  openai:{label:'OpenAI',model:'gpt-transcribe'},
  mistral:{label:'Mistral',model:'voxtral-mini-transcribe-3'},
  elevenlabs:{label:'ElevenLabs',model:'scribe_v3'}
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const capabilities = (kind = null) => json({supported:kind !== null,provider:kind,model:engines[kind]?.model ?? null});
const invalidRouting = (detail = 'Cấu hình chép lời không hợp lệ.') => json({detail,code:'stt_invalid_routing'},400);
const unavailable = () => json({detail:'Chưa chép được bản ghi. Thử lại hoặc nhập câu trả lời.'},503);
const invalidTranscript = () => json({detail:'Bản chép lời không hợp lệ.'},502);
const timeout = () => json({detail:'Kết nối chép lời hết thời gian. Thử lại hoặc nhập câu trả lời.'},504);
const languageModes = ['auto','vi','ja'];
const lessonLanguage = code => code==='ja' || code==='jpn' ? 'ja' : code==='vi' || code==='vie' ? 'vi' : null;
const unsupportedLanguage = () => json({detail:'Chưa nhận ra tiếng Việt hoặc tiếng Nhật. Em nói lại một câu ngắn hoặc chọn ngôn ngữ nói trong Âm thanh nhé.',code:'stt_language_unsupported'},422);
const mismatchedLanguage = language => json({detail:`Lời nói không khớp với ngôn ngữ đã chọn. Em nói lại bằng ${language==='vi'?'tiếng Việt':'tiếng Nhật'} hoặc đổi ngôn ngữ nói trong Âm thanh nhé.`,code:'stt_language_mismatch'},422);
// Reject unexpected scripts without stripping kanji, kana or Latin loanwords.
const otherScript = /(?=\p{L})[^\p{scx=Latin}\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]/u;

function audioBytes(data,mime) {
  if(typeof data!=='string' || !data.length || data.length>Math.ceil(MAX_AUDIO/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))return null;
  let bytes;try{bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));}catch{return null;}
  if(bytes.length<12 || bytes.length>MAX_AUDIO)return null;
  const ascii=(at,n)=>String.fromCharCode(...bytes.subarray(at,at+n));
  const valid=mime==='audio/webm'?bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3
    :mime==='audio/mp4'?ascii(4,4)==='ftyp':mime==='audio/ogg'?ascii(0,4)==='OggS'
    :mime==='audio/wav'?ascii(0,4)==='RIFF'&&ascii(8,4)==='WAVE'
    :mime==='audio/mpeg'&&(ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0);
  return valid?bytes:null;
}

async function legacyConnection(env,userId,apiConnection,profileId) {
  // This OAuth gateway cannot transcribe; a capability check must not contact it.
  if (profileId === ANTIGRAVITY_PROFILE || profileId?.startsWith(ANTIGRAVITY_PROFILE + ':')) return null;
  const provider = await resolveProvider(env,userId,apiConnection,profileId);
  // Legacy STT follows the explicit official Chat connection, never a Sound profile.
  const selected = provider?.source === 'platform' || profileId !== undefined || apiConnection !== undefined;
  if (!selected || provider?.protocol !== 'openai' || provider.error) return null;
  const {baseUrl,apiKey} = provider;
  if (baseUrl === VOICE_BASES.openai) return {kind:'openai',baseUrl,apiKey};
  if (baseUrl === VOICE_BASES.mistral) return {kind:'mistral',baseUrl,apiKey};
  return null;
}

async function transcribe(request, {kind,baseUrl,apiKey}, file, filename, bias, explicit, language) {
  const engine = engines[kind], eleven = kind === 'elevenlabs';
  const url = baseUrl + (eleven ? '/v1/speech-to-text' : '/audio/transcriptions');
  const headers = eleven ? {'xi-api-key':apiKey} : {Authorization:`Bearer ${apiKey}`};
  const signal = AbortSignal.any([request.signal,AbortSignal.timeout(25000)]);
  const send = terms => {
    const form = new FormData();
    form.set('file',file,filename);
    form.set(eleven ? 'model_id' : 'model',engine.model);
    if (language!=='auto') form.set(eleven ? 'language_code' : 'language',language);
    else if (kind==='mistral') form.set('return_language','true');
    if (eleven) form.set('tag_audio_events','false');
    for (const term of terms) form.append('context_bias',term);
    return fetch(url,{method:'POST',redirect:'manual',signal,headers,body:form});
  };
  let raw;
  try {
    let response = await send(bias);
    if (bias.length && response.status === 422) {
      void response.body?.cancel().catch(() => {});
      signal.throwIfAborted();
      response = await send([]);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 429) return json({detail:`${engine.label} đang giới hạn lượt dùng. Hãy thử lại sau.`},429);
      if (response.status === 402) return json({detail:VOICE_BILLING_DETAIL,code:'stt_billing'},402);
      if (explicit && [401,403].includes(response.status)) return json({detail:'Nhà cung cấp từ chối khóa chép lời đã chọn.'},403);
      return unavailable();
    }
    raw = await readVoiceBody(response,MAX_RESPONSE,signal);
    signal.throwIfAborted();
  } catch (error) {
    return !explicit || signal.aborted || error?.name === 'TimeoutError' ? timeout() : unavailable();
  }
  let result;
  try {result = JSON.parse(raw);} catch {return explicit ? invalidTranscript() : timeout();}
  if (typeof result?.text !== 'string' || result.text.length > 6000 || result.text.includes(apiKey)) return invalidTranscript();
  const text=result.text.trim();
  if (!text || eleven && Array.isArray(result.words) && result.words.some(part=>part?.type==='audio_event')
    && !result.words.some(part=>part?.type==='word')) return json({text:''});
  if (otherScript.test(text)) return unsupportedLanguage();
  if (eleven) {
    const detected=lessonLanguage(result.language_code);
    if (!detected) return unsupportedLanguage();
    if (language!=='auto' && detected!==language) return mismatchedLanguage(language);
    const probability=result.language_probability;
    return json({text,language:detected,language_probability:Number.isFinite(probability) && probability>=0 && probability<=1 ? probability : null});
  }
  // Mistral may return null (including when language is pinned); do not invent a detection.
  const detected = kind==='mistral' && result.language!=null ? [result.language]
    : kind==='openai' && result.languages!==undefined && Array.isArray(result.languages) ? result.languages.map(entry=>entry?.code)
    : null;
  if (kind==='openai' && result.languages!==undefined && !detected
    || detected && (!detected.length || detected.some(code=>!lessonLanguage(code)))) return unsupportedLanguage();
  if (language!=='auto' && detected?.some(code=>lessonLanguage(code)!==language)) return mismatchedLanguage(language);
  return json({text});
}

export async function transcriptionRoute(request,env) {
  const user = await sessionUser(request,env);
  if (!user) return json({detail:'Đăng nhập để nhập bằng giọng nói.'},401);
  if (request.headers.get('X-VJBot-Account') !== user.user_id) return json({detail:'Tài khoản đã thay đổi. Hãy tải lại.',code:'account_changed'},409);
  if (request.method !== 'POST') return json({detail:'Phương thức không được phép'},405);
  let raw, data;
  try {
    raw = await readVoiceBody(request,MAX_REQUEST,request.signal);
    if (raw === null) return json({detail:'Bản ghi quá lớn. Ghi tối đa 60 giây.'},413);
    data = JSON.parse(raw);
  } catch {return json({detail:'Dữ liệu không hợp lệ.'},400);}
  if (!object(data)) return json({detail:'Dữ liệu không hợp lệ.'},400);
  const {language = 'auto'} = data;
  if (!languageModes.includes(language)) {
    return json({detail:'Chọn Tự nhận diện Việt–Nhật, Tiếng Việt hoặc Tiếng Nhật trong Âm thanh rồi thử lại.',code:'stt_invalid_language'},400);
  }

  const explicit = Object.hasOwn(data,'stt_routing'), routing = data.stt_routing;
  const profileId = request.headers.get('X-VJBot-Profile') ?? undefined;
  if (explicit) {
    if (Object.hasOwn(data,'api_connection') || profileId !== undefined) return invalidRouting('Chỉ gửi một cấu hình chép lời.');
    if (!object(routing) || routing.version !== 2 || typeof routing.provider !== 'string' || !Object.hasOwn(engines,routing.provider)
      || routing.admin_override !== undefined && typeof routing.admin_override !== 'boolean') return invalidRouting();
  }

  const probe = data.action === 'capabilities';
  let lesson = null;
  if (!probe && data.lesson != null) {
    if (!validLessonReference(data.lesson)) return json({detail:'Bài học không hợp lệ.'},400);
    const catalog = await teacherCatalog(env,data.lesson.level);
    if (!catalog) return json({detail:'Chưa tải được danh mục bài học. Hãy thử lại sau.'},503);
    lesson = catalogLesson(catalog,data.lesson);
    if (!lesson) return json({detail:'Không tìm thấy bài học. Hãy mở lại bài.'},400);
    if (!processingAllowed(lesson)) return json({detail:'Nguồn này không được phép gửi cho nhà cung cấp AI xử lý.'},409);
  }

  let connection;
  if (explicit) {
    try {
      connection = await selectConnection({provider:routing.provider,profile:routing.profile},env,user.user_id,
        await isAdmin(env,user.user_id),routing.admin_override === true);
    } catch (error) {
      if (!(error instanceof VoiceError)) throw error;
      if (error.code === 'tts_invalid_routing') return invalidRouting();
      if (error.code !== 'tts_profile_unavailable') throw error;
      if (probe) return capabilities();
      return json({detail:'Kết nối chép lời đã chọn không dùng được. Hệ thống không dùng khóa thay thế.',code:'stt_profile_unavailable'},403);
    }
  } else {
    connection = await legacyConnection(env,user.user_id,data.api_connection,profileId);
  }
  if (probe) return capabilities(connection?.kind);
  if (!connection) return json({detail:'Kết nối OpenAI hoặc Mistral chính thức để chép lời, hoặc nhập câu trả lời.',code:'no_transcription'},403);

  const mime = typeof data.mime_type === 'string' ? data.mime_type.split(';',1)[0].toLowerCase() : '';
  if (!Object.hasOwn(formats,mime)) return json({detail:'Định dạng âm thanh không được hỗ trợ.'},400);
  const bytes = audioBytes(data.audio,mime);
  if (!bytes) return json({detail:'Bản ghi không hợp lệ hoặc quá lớn.'},400);
  if (await rateLimited(env,user.user_id)) return json({detail:'Đợi một phút rồi thử lại.'},429);
  const bias = connection.kind === 'mistral' && lesson ? lessonVocabulary(lesson) : [];
  return transcribe(request,connection,new Blob([bytes],{type:mime}),'recording.'+formats[mime],bias,explicit,language);
}
