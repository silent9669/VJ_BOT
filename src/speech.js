import {listModels} from './llm.js';

export const DEFAULT_SPEECH_MODEL = 'gemini-3.8-flash-tts';
const reply = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
// Only this documented Gemini TTS wire family is compatible with Charon and speech_metadata.
export function compatibleSpeechModel(model) {
  return typeof model === 'string' && model.length <= 100
    && /^gemini-3\.8-flash(?:-lite)?-tts(?:-[a-z0-9-]+)?$/.test(model);
}
function speechStyle(text) {
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);
  const vietnamese = /\p{Script=Latin}/u.test(text);
  const delivery = 'Use one warm adult male teacher voice at a natural, unhurried pace. Read the transcript exactly; do not translate, paraphrase, add instructions or pronounce formatting.';
  if (!japanese) return delivery + ' Đọc bằng giọng người Việt bản ngữ, rõ sáu thanh điệu và phụ âm cuối. Ngắt theo cụm nghĩa, không kéo dài nguyên âm hay đều đều từng tiếng. Không mang ngữ điệu tiếng Anh hoặc tiếng Nhật vào tiếng Việt.';
  if (!vietnamese) return delivery + ' 日本語の標準的な発音と自然な高低アクセントで、助詞・長音・促音を明瞭に読んでください。外国語風の抑揚にせず、文の意味に沿って自然に区切ってください。';
  return delivery + ' Phần tiếng Việt dùng phát âm Việt bản ngữ, rõ thanh điệu và phụ âm cuối, không pha ngữ điệu ngoại ngữ. Phần tiếng Nhật dùng phát âm và cao độ chuẩn Nhật, giữ trường âm và âm ngắt. Dừng nhẹ ở ranh giới hai ngôn ngữ rồi chuyển đúng cách phát âm; không phiên âm hay dịch thêm.';
}
function providerFailure(status, discovery = false) {
  if ([401, 403].includes(status)) return reply({detail:'Google từ chối khóa này hoặc quyền giọng nói của nó. Hãy kiểm tra khóa và dự án trong AI Studio.',code:'tts_key_rejected'},403);
  if (status === 402) return reply({detail:'Google yêu cầu thanh toán hoặc tín dụng cho yêu cầu giọng nói này. Hãy kiểm tra dự án trong AI Studio.',code:'tts_billing'},403);
  if (status === 404) return reply({detail:'Dự án đã chọn không dùng được model giọng nói này. Hãy tải lại model hoặc kiểm tra AI Studio.',code:'speech_model_missing'},409);
  if (status === 429) return reply({detail:'Giọng nói Gemini chạm giới hạn tốc độ hoặc hạn mức (429). Hãy kiểm tra giới hạn của dự án trong AI Studio. Hệ thống không dùng giọng khác.',code:discovery?'tts_catalog_unavailable':'tts_quota'},429);
  return reply({detail:discovery?'Không tải lại được model giọng nói. Giọng đã chọn không đổi.':'Không tạo được giọng đọc. Giọng đã chọn không đổi.',code:discovery?'tts_catalog_unavailable':'tts_unavailable'},503);
}
async function catalog(provider) {
  const result = await listModels(provider);
  if (result.status) return {response:providerFailure(result.status,true)};
  return {models:result.models.filter(compatibleSpeechModel), truncated:result.truncated};
}

export async function speechResponse(body, apiKey) {
  const provider = {protocol:'gemini', baseUrl:'https://generativelanguage.googleapis.com', apiKey};
  if (!apiKey) return reply({detail:'Hãy chọn kết nối API key Google Gemini cho giọng đọc Charon. Chat Antigravity là một kết nối riêng.', code:'no_tts'}, 403);
  if (body.action === 'models') {
    const result = await catalog(provider);
    return result.response || reply({models:result.models, truncated:result.truncated, voice:'Charon', default_model:DEFAULT_SPEECH_MODEL, verified:false});
  }
  if (body.action !== undefined) return reply({detail:'Thao tác giọng nói không hợp lệ.'}, 400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 6000) return reply({detail:'Văn bản đọc phải dài từ 1 đến 6000 ký tự.'}, 400);
  const model = body.speech_model ?? DEFAULT_SPEECH_MODEL;
  if (!compatibleSpeechModel(model)) return reply({detail:'Hãy chọn một model Gemini TTS tương thích trong cài đặt Âm thanh.', code:'invalid_speech_model'}, 400);
  // Keep the current default stable. An explicitly selected alternative must be in this key's catalog.
  if (model !== DEFAULT_SPEECH_MODEL) {
    const result = await catalog(provider);
    if (result.response) return result.response;
    if (!result.models.includes(model)) return reply({detail:'Model giọng nói đã chọn không còn trong danh sách. Hãy chọn model khác trong cài đặt Âm thanh.', code:'speech_model_missing'}, 409);
  }
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method:'POST', redirect:'manual', signal:AbortSignal.timeout(45000),
      headers:{'Content-Type':'application/json', 'x-goog-api-key':apiKey},
      body:JSON.stringify({
        contents:[{role:'user', parts:[{text, speech_metadata:{style:speechStyle(text)}}]}],
        generationConfig:{responseModalities:['AUDIO'], speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Charon'}}}}
      })
    });
    if (!response.ok) {
      await response.body?.cancel();
      return providerFailure(response.status);
    }
    const data = await response.json();
    const audio = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
    if (typeof audio?.data !== 'string' || !audio.data) return reply({detail:'Nhà cung cấp giọng nói không trả về âm thanh. Hãy thử lại.', code:'tts_unavailable'}, 503);
    return reply({audioBase64:audio.data, mimeType:audio.mimeType || 'audio/wav', voice:'Charon', model});
  } catch {
    return reply({detail:'Không tạo được giọng đọc. Giọng đã chọn không đổi.', code:'tts_unavailable'}, 503);
  }
}

// Official OpenAI speech uses the resolved profile; custom endpoints never receive speech credentials.
export async function openAISpeechResponse(body, provider) {
  if (body.action === 'models') return reply({models:['gpt-4o-mini-tts'],default_model:'gpt-4o-mini-tts',voice:'alloy',verified:false});
  if (body.action !== undefined) return reply({detail:'Thao tác giọng nói không hợp lệ.'},400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4000) return reply({detail:'Văn bản đọc của OpenAI phải dài từ 1 đến 4000 ký tự.'},400);
  if (body.speech_model !== undefined && body.speech_model !== 'gpt-4o-mini-tts') return reply({detail:'Hãy chọn model OpenAI TTS chính thức trong cài đặt Âm thanh.',code:'invalid_speech_model'},400);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${provider.apiKey}`},
      body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'alloy',input:text,response_format:'mp3'})
    });
    if (!response.ok) { await response.body?.cancel(); return reply({detail:'Giọng nói OpenAI không dùng được lúc này. Hãy thử lại.',code:'tts_unavailable'},response.status===429?429:503); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) return reply({detail:'Không nhận được âm thanh giọng nói.',code:'tts_unavailable'},503);
    let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return reply({mimeType:'audio/mpeg',audioBase64:btoa(binary),voice:'alloy',model:'gpt-4o-mini-tts'});
  } catch { return reply({detail:'Giọng nói OpenAI không dùng được lúc này. Hãy thử lại.',code:'tts_unavailable'},503); }
}
