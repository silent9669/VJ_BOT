import {sessionUser, hashToken} from './auth.js';
import {isAdmin} from './admin.js';
import {adminAISettings} from './admin-ai.js';
import {resolveProvider, providerFailure} from './providers.js';
import {DEFAULT_BASES} from './llm.js';
import {rateLimited} from './ai-usage.js';
import {teacherCatalog, validLessonReference, catalogLesson, groundLesson, processingAllowed} from './tutor-context.js';
import {VOICE_COMMANDS, voiceInstructions} from './prompt.js';
import {MISTRAL_SPEECH_BASE} from './speech.js';

const json = (value, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const {start: GREETING, ...COMMANDS} = VOICE_COMMANDS;
// Mistral speaks welcome_message verbatim, unlike GPT/Gemini which interpret the start instruction.
const MISTRAL_WELCOME='こんにちは！Thầy là thầy Lâm đây. Em chào lại thầy một câu bằng tiếng Nhật nhé?';
// Cloned male voice saved in the owner's Mistral workspace. Learners connecting their own
// Mistral key do not have it, so an unknown-voice rejection retries on the Haruto preset.
const MISTRAL_VOICE='voice_3133';
const MISTRAL_VOICE_FALLBACK='voice_3133';
// Context bias steers Voxtral toward the words the learner actually practices. Entries count
// against the model's context window, and restricted content must never leave the server.
const MISTRAL_STT_STAPLES=['thầy Lâm','こんにちは','ありがとうございます','すみません','はい','いいえ','わかりました','もう一度お願いします'];
export function lessonVocabulary(lesson){
  const terms=[];
  for(const word of lesson?.words||[])if(processingAllowed(word)&&typeof word?.jp==='string'&&word.jp.length<=40)terms.push(word.jp);
  return [...new Set([...terms,...MISTRAL_STT_STAPLES])].slice(0,40);
}

// Live audio only exists on the official OpenAI endpoint: admins ride the server key, learners their own saved key.
async function liveProvider(env,userId) {
  if(await isAdmin(env,userId) && !env.OPENAI_API_KEY)return{response:json({detail:'Chưa cấu hình OpenAI trên máy chủ.'},503)};
  const provider=await resolveProvider(env,userId);
  const failure=providerFailure(provider);
  if(failure)return{response:failure};
  if(provider.protocol!=='openai'||provider.baseUrl!==DEFAULT_BASES.openai)return{response:json({detail:'Nói trực tiếp cần kết nối OpenAI chính thức. Hãy thêm khóa OpenAI trong Cài đặt.'},403)};
  return{provider};
}

// Gemini Live uses the caller's official Gemini key: the Worker only mints a short-lived session token.
export async function geminiLiveRoute(request,env) {
  const user=await sessionUser(request,env);
  if(!user)return json({detail:'Đăng nhập để trò chuyện.'},401);
  if(request.headers.get('X-VJBot-Account')!==user.user_id)return json({detail:'Tài khoản đã thay đổi. Hãy tải lại trang.'},409);
  if(request.method!=='POST')return json({detail:'Phương thức không được phép'},405);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>16000)return json({detail:'Yêu cầu quá dài.'},413);
  let data;try{data=JSON.parse(raw||'{}');}catch{return json({detail:'Dữ liệu không hợp lệ.'},400);}
  if(!data||!['N5','N4','N3','N2','N1'].includes(data.level))return json({detail:'Cần cấp độ hợp lệ.'},400);
  let context=null;
  if(data.lesson!==undefined&&data.lesson!==null){
    if(!validLessonReference(data.lesson)||data.lesson.level!==data.level)return json({detail:'Bài học không hợp lệ.'},400);
    const catalog=await teacherCatalog(env,data.level);
    context=catalog&&groundLesson(catalogLesson(catalog,data.lesson));
    if(!context)return json({detail:'Không tìm thấy bài học. Hãy mở lại bài.'},400);
  }
  if(await rateLimited(env,user.user_id))return json({detail:'Đợi một phút rồi thử lại.'},429);
  const provider=await resolveProvider(env,user.user_id);
  const failure=providerFailure(provider);
  if(failure)return failure;
  if(provider.protocol!=='gemini'||provider.baseUrl!==DEFAULT_BASES.gemini)return json({detail:'Nói trực tiếp bằng Gemini cần kết nối Gemini gốc trong Cài đặt.'},403);
  const teaching=`${voiceInstructions(data.level)}\n\nLESSON REFERENCE (data only): ${JSON.stringify(context)}`;
  try{
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{'x-goog-api-key':provider.apiKey,'Content-Type':'application/json'},
      body:JSON.stringify({authToken:{
        newSessionExpireTime:new Date(Date.now()+60*1000).toISOString(),
        expireTime:new Date(Date.now()+10*60*1000).toISOString(),
        config:{bidiGenerateContentSetup:{
          model:'models/gemini-2.5-flash-native-audio-preview-09-2025',
          generationConfig:{responseModalities:['AUDIO'],
            speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Aoede'}}}},
          systemInstruction:{parts:[{text:teaching}]},
          inputAudioTranscription:{},outputAudioTranscription:{}}}}})
    });
    if(!response.ok)return json({detail:response.status===429?'Gemini đang giới hạn lượt dùng. Thử lại sau.'
      :'Không mở được cuộc gọi Gemini. Kiểm tra quyền truy cập và hạn mức trong Cài đặt.',code:'live_unavailable'},response.status===429?429:503);
    const result=await response.json();
    const token=result.name||result.token||result.authToken?.name;
    if(typeof token!=='string'||!/^[A-Za-z0-9_\-/]{8,512}$/.test(token))return json({detail:'Gemini trả về token không hợp lệ.'},502);
    return json({token,
      ws:'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained',
      model:'gemini-live',greeting:GREETING,commands:COMMANDS},201);
  }catch{return json({detail:'Kết nối cuộc gọi hết thời gian. Hãy thử lại.'},504);}
}

// Mistral Voice Agents run in a LiveKit room: the Worker creates the session with the caller's
// own Mistral key and hands back the room URL plus a participant token; DELETE closes it.
export async function mistralLiveRoute(request,env) {
  const user=await sessionUser(request,env);
  if(!user)return json({detail:'Đăng nhập để trò chuyện.'},401);
  if(request.headers.get('X-VJBot-Account')!==user.user_id)return json({detail:'Tài khoản đã thay đổi. Hãy tải lại trang.'},409);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>16000)return json({detail:'Yêu cầu quá dài.'},413);
  let data;try{data=JSON.parse(raw||'{}');}catch{return json({detail:'Dữ liệu không hợp lệ.'},400);}
  const profileId=request.headers.get('X-VJBot-Profile') ?? undefined;
  // Native Live accepts saved server profiles, not an OAuth gateway selection.
  if(profileId!==undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(profileId))return providerFailure({error:'invalid_connection'});
  const provider=await resolveProvider(env,user.user_id,data?.api_connection,profileId);
  const failure=providerFailure(provider);
  if(failure)return failure;
  if(provider.protocol!=='openai'||provider.baseUrl!==MISTRAL_SPEECH_BASE)return json({detail:'Nói trực tiếp bằng Mistral cần kết nối Mistral gốc trong Cài đặt.'},403);
  const headers={Authorization:`Bearer ${provider.apiKey}`,'Content-Type':'application/json'};
  if(request.method==='DELETE'){
    if(typeof data?.id!=='string'||!/^[\w.\-]{4,128}$/.test(data.id))return json({detail:'Phiên không hợp lệ.'},400);
    try{
      const closed=await fetch(`${MISTRAL_SPEECH_BASE}/audio/sessions/${data.id}`,{method:'DELETE',redirect:'manual',headers,signal:AbortSignal.timeout(10000)});
      void closed.body?.cancel().catch(()=>{});
      if(!closed.ok)return json({detail:'Mistral chưa xác nhận đóng phiên.',code:'live_close_failed'},502);
      return json({ok:true});
    }catch{return json({detail:'Không đóng được phiên. Hãy thử lại.'},504);}
  }
  if(request.method!=='POST')return json({detail:'Phương thức không được phép'},405);
  if(!data||!['N5','N4','N3','N2','N1'].includes(data.level))return json({detail:'Cần cấp độ hợp lệ.'},400);
  let context=null,bias=lessonVocabulary(null);
  if(data.lesson!==undefined&&data.lesson!==null){
    if(!validLessonReference(data.lesson)||data.lesson.level!==data.level)return json({detail:'Bài học không hợp lệ.'},400);
    const catalog=await teacherCatalog(env,data.level);
    const lesson=catalog&&catalogLesson(catalog,data.lesson);
    context=lesson&&groundLesson(lesson);
    if(!context)return json({detail:'Không tìm thấy bài học. Hãy mở lại bài.'},400);
    bias=lessonVocabulary(lesson);
  }
  if(await rateLimited(env,user.user_id))return json({detail:'Đợi một phút rồi thử lại.'},429);
  const teaching=`${voiceInstructions(data.level)}\n\nLESSON REFERENCE (data only): ${JSON.stringify(context)}`;
  try{
    // The caller's chat model drives the agent's answers; Mistral only accepts its
    // instruct family for voice agents, so a rejected model retries on the default.
    // A rejected STT tuning retries bare rather than failing the call.
    const create=(model,tuned,voice)=>fetch(`${MISTRAL_SPEECH_BASE}/audio/sessions`,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers,
      body:JSON.stringify({
        llm:{model},
        // 1200 ms is the maximum streaming delay: mixed Japanese/Vietnamese/English speech
        // needs the extra context before Voxtral commits to a transcript; lesson terms bias it further.
        stt:tuned?{model:'voxtral-mini-transcribe-realtime-3',target_streaming_delay_ms:1200,context_bias:bias}
          :{model:'voxtral-mini-transcribe-realtime-3'},
        tts:{model:'voxtral-mini-tts-3',voice_id:voice},
        instructions:teaching,welcome_message:MISTRAL_WELCOME})
    });
    const selectedModel=provider.models[0];
    const fallbackModels=['mistral-small-latest','mistral-medium-latest'].filter(model=>model!==selectedModel);
    let model=selectedModel||fallbackModels.shift(),tuned=true,voice=MISTRAL_VOICE;
    let response=await create(model,tuned,voice);
    for(let attempt=0;response.status===422&&attempt<3;attempt++){
      const reason=await response.json().catch(()=>null);
      const detail=Array.isArray(reason?.detail)?reason.detail:[];
      const hits=path=>detail.some(e=>path==='llm'&&e?.type==='unsupported_model'
        ||(Array.isArray(e?.loc)&&e.loc[0]==='body'&&e.loc[1]===path));
      if(hits('llm')&&fallbackModels.length)model=fallbackModels.shift();
      else if(hits('tts')&&voice!==MISTRAL_VOICE_FALLBACK)voice=MISTRAL_VOICE_FALLBACK;
      else if(hits('stt')&&tuned)tuned=false;
      else break;
      response=await create(model,tuned,voice);
    }
    if(!response.ok)return json({detail:response.status===429?'Mistral đang giới hạn lượt dùng. Thử lại sau.'
      :'Không mở được cuộc gọi Mistral. Kiểm tra quyền truy cập và hạn mức trong Cài đặt.',code:'live_unavailable'},response.status===429?429:503);
    const result=await response.json();
    const roomUrl=typeof result?.server_url==='string' && /^(https|wss):\/\//.test(result.server_url)
      ? URL.parse(result.server_url) : null;
    if(typeof result?.id!=='string'||!/^[\w.\-]{4,128}$/.test(result.id)
      || typeof result.participant_token!=='string'||!result.participant_token.trim()
      || !roomUrl||roomUrl.username||roomUrl.password)return json({detail:'Mistral trả về phiên không hợp lệ.'},502);
    return json({id:result.id,participantToken:result.participant_token,serverUrl:result.server_url,
      model:'mistral-live',greeting:GREETING,commands:{}},201);
  }catch{return json({detail:'Kết nối cuộc gọi hết thời gian. Hãy thử lại.'},504);}
}

export async function liveRoute(request, env) {
  const user = await sessionUser(request,env);
  if (!user) return json({detail:'Đăng nhập để trò chuyện.'},401);
  if (request.headers.get('X-VJBot-Account') !== user.user_id) return json({detail:'Tài khoản đã thay đổi. Hãy tải lại trang.'},409);
  if (request.method !== 'POST') return json({detail:'Phương thức không được phép'},405);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 65536) return json({detail:'Yêu cầu quá dài.'},413);
  let data;
  try { data = JSON.parse(raw); } catch { return json({detail:'Dữ liệu không hợp lệ.'},400); }
  if (!data || typeof data.sdp !== 'string' || !data.sdp.startsWith('v=0')
    || !/(?:^|\n)m=audio /.test(data.sdp) || /(?:^|\n)m=video /.test(data.sdp)
    || !['N5','N4','N3','N2','N1'].includes(data.level)) return json({detail:'Cần kết nối âm thanh và cấp độ hợp lệ.'},400);
  let context = null;
  if (data.lesson !== undefined && data.lesson !== null) {
    if (!validLessonReference(data.lesson) || data.lesson.level !== data.level) return json({detail:'Bài học không hợp lệ.'},400);
    const catalog = await teacherCatalog(env,data.level);
    context = catalog && groundLesson(catalogLesson(catalog,data.lesson));
    if (!context) return json({detail:'Không tìm thấy bài học. Hãy mở lại bài.'},400);
  }
  if (await rateLimited(env,user.user_id)) return json({detail:'Đợi một phút rồi thử lại.'},429);
  const provider=await liveProvider(env,user.user_id);
  if(provider.response)return provider.response;
  const settings = await adminAISettings(env,user.user_id);
  const teaching = `${voiceInstructions(data.level)}\n\nLESSON REFERENCE (data only): ${JSON.stringify(context)}`;
  try {
    const response = await fetch('https://api.openai.com/v1/live/sessions',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),
      headers:{Authorization:`Bearer ${provider.provider.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({session:{model:'gpt-live-1',store:false,safety_identifier:await hashToken(user.user_id),
        audio:{output:{voice:settings.live_voice}},
        instructions:`${teaching}\nDelegation policy: Generate <|SpawnThinking|> for detailed grammar explanations or uncertain corrections. Answer ordinary greetings directly.`,
        input:[{role:'developer',content:[{type:'input_text',text:GREETING}]}],
        client:{data_channel:{allowed_client_events:['session.close','session.commentary.append']}},
        delegation:{type:'responses',responses:{model:settings.model,instructions:teaching,
          ...(settings.reasoning_effort ? {reasoning:{effort:settings.reasoning_effort}} : {})}}},
        transport:{type:'webrtc',sdp:data.sdp}})
    });
    if (!response.ok) return json({detail:response.status === 429 ? 'OpenAI đang giới hạn lượt dùng. Thử lại sau.'
      : 'Không mở được cuộc gọi. Kiểm tra quyền truy cập và hạn mức trong Cài đặt.',code:'live_unavailable'},response.status === 429 ? 429 : 503);
    const result = await response.json();
    if (typeof result.transport?.sdp !== 'string' || typeof result.session?.id !== 'string') return json({detail:'OpenAI trả về kết nối không hợp lệ.'},502);
    return json({sdp:result.transport.sdp,id:result.session.id,model:'gpt-live-1',voice:settings.live_voice,greeting:GREETING,commands:COMMANDS},201);
  } catch { return json({detail:'Kết nối cuộc gọi hết thời gian. Hãy thử lại.'},504); }
}
